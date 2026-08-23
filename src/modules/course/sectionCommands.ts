import { prisma } from "../../db/prisma.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { AppError, NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes, agentAuthoringAuditMetadata, type AgentAuthoringContext } from "../../observability/auditEvents.js";
import { assertSectionNotInAnyCourse, assertSectionNotInIssuedCertificate } from "./contentLifecycle.js";
import { importSectionAssets, collectSectionAssetBlobPaths, reclaimAssetBlobs } from "./assetCommands.js";
import { addContentOwner } from "../content/contentOwnershipService.js";
import {
  validateSectionTranslationCompleteness,
  type ValidationIssue,
} from "../adminContent/contentValidationService.js";

// #763 (Layer B): the agent section-create route inlines figures/images (base64), so the JSON body
// can exceed the 5 MB global parser. Sized to cover a handful of SVG figures + localized variants
// after base64 inflation. Applied to ONLY the /sections route prefix in app.ts (mirrors the
// /courses/import pattern); every other endpoint stays at 5 MB.
export const SECTION_CREATE_BODY_LIMIT_BYTES = 15 * 1024 * 1024; // 15 MB

// One inline figure/image an agent supplies alongside a section (see authoringSectionAssetSchema).
export interface SectionAssetImportInput {
  sourceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  sourceLocale?: string | null;
  localizedVariants?: Array<{ locale: string; contentBase64: string }>;
}

// #763 (Layer B): rewrite every `asset:<sourceId>` markdown reference to the created SectionAsset
// id, using the sourceId→newId map from importSectionAssets. Wider grammar ([a-zA-Z0-9_-]) than the
// import path's remap because authoring sourceIds are client-chosen ref tokens (may carry `_`/`-`),
// not DB cuids. Refs with no mapping are left untouched (a mistyped ref is not silently mangled).
export function remapAssetRefs(serializedMarkdown: string, idMap: Map<string, string>): string {
  if (idMap.size === 0) return serializedMarkdown;
  return serializedMarkdown.replace(/asset:([a-zA-Z0-9_-]+)/g, (whole, sourceId: string) => {
    const mapped = idMap.get(sourceId);
    return mapped ? `asset:${mapped}` : whole;
  });
}

// =========================================================================
// #916: the translation publish gate for sections (mirrors #896 S4 for modules)
// =========================================================================
// A section is reading material the participant meets directly, so a language hole has the same
// consequence as it does in a module — and therefore the same rule. The gate lives here, in the
// command layer, rather than on the publish route: a section reaches participants through FOUR
// doors, and a gate on one of them is a detour sign, not a gate. See
// doc/FEATURE_SURFACE_MAP.md § 23.
//
// | Door | Behaviour |
// |------|-----------|
// | `publishSection` (author's button, and the course cascade's publish step) | throws 422 `publish_blocked_by_validation` |
// | `createSection` with auto-publish (`draft` not set) | held back to DRAFT; the write succeeds |
// | `updateSectionContent` (saving IS publishing for sections) | the new version is stored but NOT activated |
// | standalone section import (#916) | always lands unpublished by decision, so it never reaches the gate |
//
// Why the two save doors hold back instead of throwing: for a module, saving a draft and
// publishing are separate actions, so blocking publish costs the author nothing. A section has no
// draft-save — every save publishes. Failing the save would mean an author writing in Norwegian
// could not store their work at all, which trades a language bug for data loss. Holding the
// activation back keeps both the text and the rule, and mirrors the module IMPORT door, which
// resolves exactly the same conflict the same way.
export type SectionTranslationGate = {
  /** True when the section may become (or stay) the participant-visible active version. */
  ok: boolean;
  /** Blocking issues carrying `field` + `missingLocales`, ready for the UI's gap-fill action. */
  issues: ValidationIssue[];
};

/** Run the gate over a section's stored (serialized) title + body. No DB access, no flattening. */
export function evaluateSectionTranslationGate(input: {
  title: string | null | undefined;
  bodyMarkdown: string | null | undefined;
}): SectionTranslationGate {
  const issues = validateSectionTranslationCompleteness(input);
  return { ok: issues.length === 0, issues };
}

// Section CRUD + versioning (#485/B1) for course learning sections (#476).
// Mirrors Module/ModuleVersion: editing content publishes an immutable new
// version and re-points activeVersionId (latest-wins in v1.3.x). Localized
// fields (title, bodyMarkdown) arrive already serialized to JSON strings by the
// route layer, exactly like createCourse.

// AA-2 (#650): `draft: true` keeps the section in Utkast (activeVersionId stays
// null) — same state a restored section lands in (I3). Content lives in version 1;
// publishSection re-points to it. Default (false) preserves auto-publish-on-save.
// AA-5 (#653): creation is audited; agent-orchestrated creates carry
// source/clientRef/agentRunId in the metadata.
export async function createSection(input: {
  title: string;
  bodyMarkdown: string;
  actorId?: string;
  draft?: boolean;
  agent?: AgentAuthoringContext;
  // #796: a transactional import pre-generates the section id so its asset blobs can be staged under the
  // final `sections/<id>/…` path before the graph transaction opens. Omitted → the DB generates the id.
  id?: string;
}, tx?: DbTransactionClient) {
  // #916: door 2 of the publish gate. An explicit `draft: true` already keeps the section
  // unpublished; a language hole now does the same. `heldBackByTranslationGate` distinguishes the
  // two for the caller — the author asked for one and did not ask for the other.
  const gate = evaluateSectionTranslationGate({ title: input.title, bodyMarkdown: input.bodyMarkdown });
  const heldBackByTranslationGate = !input.draft && !gate.ok;
  const keepAsDraft = Boolean(input.draft) || heldBackByTranslationGate;

  const run = async (client: DbTransactionClient) => {
    const section = await client.courseSection.create({
      data: { ...(input.id ? { id: input.id } : {}), title: input.title },
    });
    const version = await client.courseSectionVersion.create({
      data: {
        sectionId: section.id,
        versionNo: 1,
        bodyMarkdown: input.bodyMarkdown,
        publishedBy: keepAsDraft ? null : input.actorId ?? null,
        publishedAt: keepAsDraft ? null : new Date(),
      },
    });
    const result = keepAsDraft
      ? await client.courseSection.findUniqueOrThrow({
          where: { id: section.id },
          include: { activeVersion: true },
        })
      : await client.courseSection.update({
          where: { id: section.id },
          data: { activeVersionId: version.id },
          include: { activeVersion: true },
        });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseSection,
        entityId: result.id,
        action: auditActions.section.created,
        actorId: input.actorId,
        metadata: {
          sectionId: result.id,
          draft: keepAsDraft,
          heldBackByTranslationGate,
          ...agentAuthoringAuditMetadata(input.agent),
        },
      },
      client,
    );
    // #787 slice 4a: creator becomes sole initial owner (inert until 4b enforcement).
    if (input.actorId) {
      await addContentOwner({ contentType: "SECTION", contentId: result.id, ownerUserId: input.actorId, actorUserId: input.actorId }, client);
    }
    return { ...result, heldBackByTranslationGate, translationGateIssues: gate.issues };
  };
  return tx ? run(tx) : runInTransaction(run);
}

// #763 (Layer B): create a section AND its inline figures/images in one call. Ordering matches the
// import path (importSectionPayload): create the section (version 1) with the SOURCE markdown →
// import the assets to obtain their new ids → rewrite the version's `asset:<sourceId>` refs to the
// new ids IN PLACE. The in-place update is deliberate: it never publishes a draft (activeVersionId
// and publishedAt are untouched) and keeps a published section published without minting a new
// version. Returns the (refreshed) section plus the sourceId→assetId map for the API response.
// Any invalid asset throws (ValidationError) via importSectionAssets — no silent skip.
export async function createSectionWithAssets(input: {
  title: string;
  bodyMarkdown: string;
  actorId?: string;
  draft?: boolean;
  agent?: AgentAuthoringContext;
  assets: ReadonlyArray<SectionAssetImportInput>;
}) {
  const section = await createSection({
    title: input.title,
    bodyMarkdown: input.bodyMarkdown,
    actorId: input.actorId,
    draft: input.draft,
    agent: input.agent,
  });

  const idMap = await importSectionAssets(section.id, input.assets);

  const remapped = remapAssetRefs(input.bodyMarkdown, idMap);
  if (remapped !== input.bodyMarkdown) {
    const latest = await prisma.courseSectionVersion.findFirst({
      where: { sectionId: section.id },
      orderBy: { versionNo: "desc" },
      select: { id: true },
    });
    if (latest) {
      await prisma.courseSectionVersion.update({
        where: { id: latest.id },
        data: { bodyMarkdown: remapped },
      });
    }
  }

  const refreshed = await prisma.courseSection.findUniqueOrThrow({
    where: { id: section.id },
    include: { activeVersion: true, versions: { orderBy: { versionNo: "desc" }, take: 1 } },
  });
  // #916: carry the gate verdict from createSection through the refresh, or the caller would see a
  // section that is quietly a draft with no explanation of why.
  return {
    section: {
      ...refreshed,
      heldBackByTranslationGate: section.heldBackByTranslationGate,
      translationGateIssues: section.translationGateIssues,
    },
    assetMap: Object.fromEntries(idMap),
  };
}

export async function updateSectionTitle(sectionId: string, title: string) {
  await assertSectionExists(sectionId);
  return prisma.courseSection.update({
    where: { id: sectionId },
    data: { title },
    include: { activeVersion: true },
  });
}

export async function updateSectionContent(sectionId: string, bodyMarkdown: string, actorId?: string, tx?: DbTransactionClient) {
  const existing = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, title: true },
  });
  if (!existing) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }

  // #916: door 3. Saving a section IS publishing it (latest-wins), so the gate belongs here too.
  // The version is always written — the author's text is never lost — but it only becomes the
  // active, participant-visible one when every gated field carries all three locales.
  const gate = evaluateSectionTranslationGate({ title: existing.title, bodyMarkdown });
  const heldBackByTranslationGate = !gate.ok;

  const run = async (client: DbTransactionClient) => {
    const last = await client.courseSectionVersion.findFirst({
      where: { sectionId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    const version = await client.courseSectionVersion.create({
      data: {
        sectionId,
        versionNo: (last?.versionNo ?? 0) + 1,
        bodyMarkdown,
        publishedBy: heldBackByTranslationGate ? null : actorId ?? null,
        publishedAt: heldBackByTranslationGate ? null : new Date(),
      },
    });
    const section = await client.courseSection.update({
      where: { id: sectionId },
      // Held back: activeVersionId is left exactly as it was. A live section keeps serving the
      // last complete version rather than being silently unpublished (which G2 forbids anyway for
      // a section that sits in a course); a draft section stays a draft.
      data: heldBackByTranslationGate
        ? { updatedAt: new Date() }
        : { activeVersionId: version.id, updatedAt: new Date() },
      include: { activeVersion: true },
    });
    return { ...section, heldBackByTranslationGate, translationGateIssues: gate.issues };
  };
  return tx ? run(tx) : runInTransaction(run);
}

export function getSection(sectionId: string) {
  return prisma.courseSection.findUnique({
    where: { id: sectionId },
    include: {
      activeVersion: true,
      // #916: the editor must show what the author last SAVED, not only what is live. Since the
      // gate can hold a save back from activation, reading only `activeVersion` would make the
      // author's own text vanish on reload — the newest version is the one being edited.
      versions: { orderBy: { versionNo: "desc" }, take: 1 },
    },
  });
}

export function listSections() {
  return prisma.courseSection.findMany({
    orderBy: { updatedAt: "desc" },
    include: { activeVersion: { select: { id: true, versionNo: true, publishedAt: true } } },
  });
}

// #705: enhetlig livssyklus for seksjoner (symmetri med modul/kurs). Seksjoner auto-publiseres
// ved lagring; disse handlingene gir samme Publiser/Avpubliser/Arkiver/Gjenopprett-vokabular.

// Publiser: re-pek activeVersionId til siste versjon (krever at det finnes en versjon med innhold).
export async function publishSection(sectionId: string, actorId?: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, title: true, archivedAt: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (section.archivedAt) {
    throw new ValidationError("Gjenopprett seksjonen før du publiserer den.");
  }
  const latest = await prisma.courseSectionVersion.findFirst({
    where: { sectionId },
    orderBy: { versionNo: "desc" },
    select: { id: true, bodyMarkdown: true },
  });
  if (!latest) {
    throw new ValidationError("Seksjonen har ikke noe innhold å publisere.");
  }
  // #916: door 1 — the explicit publish action, and the step the course cascade calls. Blocking,
  // not a warning: this is the moment the text reaches a participant who may not read the one
  // language it exists in. The issues carry `field` + `missingLocales` so the UI can offer to
  // translate exactly the gaps (#896 S4's contract), not re-parse a sentence.
  const gate = evaluateSectionTranslationGate({ title: section.title, bodyMarkdown: latest.bodyMarkdown });
  if (!gate.ok) {
    throw new AppError(
      "publish_blocked_by_validation",
      422,
      "Pre-publish validation found blocking issues. See `issues` for details.",
      { issues: gate.issues },
    );
  }
  const updated = await runInTransaction(async (tx) => {
    const section = await tx.courseSection.update({
      where: { id: sectionId },
      data: { activeVersionId: latest.id },
      include: { activeVersion: true },
    });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseSection,
        entityId: sectionId,
        action: auditActions.section.published,
        actorId,
        metadata: { sectionId },
      },
      tx,
    );
    return section;
  });
  return updated;
}

// Avpubliser: nullstill activeVersionId. G2 — kan ikke avpublisere en seksjon som ligger i et kurs.
export async function unpublishSection(sectionId: string, actorId?: string) {
  await assertSectionExists(sectionId);
  await assertSectionNotInAnyCourse(sectionId, "avpubliseres");
  const updated = await runInTransaction(async (tx) => {
    const section = await tx.courseSection.update({
      where: { id: sectionId },
      data: { activeVersionId: null },
      include: { activeVersion: true },
    });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseSection,
        entityId: sectionId,
        action: auditActions.section.unpublished,
        actorId,
        metadata: { sectionId },
      },
      tx,
    );
    return section;
  });
  return updated;
}

// Arkiver: G2-vakt + auto-avpubliser (I3). Gjenopprett lander i Utkast.
export async function archiveSection(sectionId: string, actorId?: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, archivedAt: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (section.archivedAt) {
    throw new ValidationError("Seksjonen er allerede arkivert.");
  }
  await assertSectionNotInAnyCourse(sectionId, "arkiveres");
  const updated = await runInTransaction(async (tx) => {
    const section = await tx.courseSection.update({
      where: { id: sectionId },
      data: { archivedAt: new Date(), activeVersionId: null },
      include: { activeVersion: true },
    });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseSection,
        entityId: sectionId,
        action: auditActions.section.archived,
        actorId,
        metadata: { sectionId },
      },
      tx,
    );
    return section;
  });
  return updated;
}

// Gjenopprett: nullstill archivedAt (lander i Utkast — forfatteren re-publiserer bevisst).
export async function restoreSection(sectionId: string, actorId?: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, archivedAt: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (!section.archivedAt) {
    throw new ValidationError("Seksjonen er ikke arkivert.");
  }
  const updated = await runInTransaction(async (tx) => {
    const section = await tx.courseSection.update({
      where: { id: sectionId },
      data: { archivedAt: null },
      include: { activeVersion: true },
    });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseSection,
        entityId: sectionId,
        action: auditActions.section.restored,
        actorId,
        metadata: { sectionId },
      },
      tx,
    );
    return section;
  });
  return updated;
}

export async function deleteSection(sectionId: string, actorId?: string) {
  // #961: tittelen hentes FØR slettingen. Etterpå finnes den ingen steder — revisjonsraden er alt
  // som er igjen, og en id alene lar ingen kjenne igjen hva som forsvant (samme form som
  // modul-sletting, adminContentCommands.ts:376).
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, title: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  // G2: navngir kursene (konsistent med modul-sletting).
  await assertSectionNotInAnyCourse(sectionId, "slettes");
  // #938: G2 over dekker «ligger i et kurs NÅ». Denne dekker «sto i et kursbevis DA» — innhold
  // som er fjernet fra kurset, men som et utstedt diplom fortsatt hviler på.
  await assertSectionNotInIssuedCertificate(sectionId, "slettes");
  // #758: capture the section's asset blob paths before the delete — SectionAsset rows cascade away
  // with the section, so afterwards there is nothing left to look them up from.
  const blobPaths = await collectSectionAssetBlobPaths([sectionId]);
  await runInTransaction(async (tx) => {
    // Detach activeVersion FK before deleting versions to avoid the self-reference.
    await tx.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
    await tx.courseSectionVersion.deleteMany({ where: { sectionId } });
    await tx.courseSection.delete({ where: { id: sectionId } });
    // #961: sporet committes i SAMME transaksjon som slettingen — mønsteret fra #803
    // (courseCommands.deleteCourse). Et spor som committes utenfor transaksjonen er verre enn
    // ingen: da kan det finnes et spor for noe som ble rullet tilbake, eller mangle for noe som
    // faktisk ble slettet. Sletting var den siste livssyklushandlingen på en seksjon uten spor.
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseSection,
        entityId: sectionId,
        action: auditActions.section.deleted,
        actorId,
        metadata: { sectionId, title: section.title },
      },
      tx,
    );
  });
  // After commit: reclaim the storage (best-effort — a failed blob delete never fails the delete).
  await reclaimAssetBlobs(blobPaths);
}

async function assertSectionExists(sectionId: string) {
  const section = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { id: true } });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
}
