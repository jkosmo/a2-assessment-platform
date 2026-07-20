import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes, agentAuthoringAuditMetadata, type AgentAuthoringContext } from "../../observability/auditEvents.js";
import { assertSectionNotInAnyCourse } from "./contentLifecycle.js";
import { importSectionAssets, collectSectionAssetBlobPaths, reclaimAssetBlobs } from "./assetCommands.js";
import { addContentOwner } from "../content/contentOwnershipService.js";

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
}) {
  const created = await runInTransaction(async (tx) => {
    const section = await tx.courseSection.create({ data: { title: input.title } });
    const version = await tx.courseSectionVersion.create({
      data: {
        sectionId: section.id,
        versionNo: 1,
        bodyMarkdown: input.bodyMarkdown,
        publishedBy: input.draft ? null : input.actorId ?? null,
        publishedAt: input.draft ? null : new Date(),
      },
    });
    if (input.draft) {
      return tx.courseSection.findUniqueOrThrow({
        where: { id: section.id },
        include: { activeVersion: true },
      });
    }
    return tx.courseSection.update({
      where: { id: section.id },
      data: { activeVersionId: version.id },
      include: { activeVersion: true },
    });
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: created.id,
    action: auditActions.section.created,
    actorId: input.actorId,
    metadata: {
      sectionId: created.id,
      draft: Boolean(input.draft),
      ...agentAuthoringAuditMetadata(input.agent),
    },
  });
  // #787 slice 4a: creator becomes sole initial owner (inert until 4b enforcement).
  if (input.actorId) {
    await addContentOwner({ contentType: "SECTION", contentId: created.id, ownerUserId: input.actorId, actorUserId: input.actorId });
  }
  return created;
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
    include: { activeVersion: true },
  });
  return { section: refreshed, assetMap: Object.fromEntries(idMap) };
}

export async function updateSectionTitle(sectionId: string, title: string) {
  await assertSectionExists(sectionId);
  return prisma.courseSection.update({
    where: { id: sectionId },
    data: { title },
    include: { activeVersion: true },
  });
}

export async function updateSectionContent(sectionId: string, bodyMarkdown: string, actorId?: string) {
  await assertSectionExists(sectionId);
  return runInTransaction(async (tx) => {
    const last = await tx.courseSectionVersion.findFirst({
      where: { sectionId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    const version = await tx.courseSectionVersion.create({
      data: {
        sectionId,
        versionNo: (last?.versionNo ?? 0) + 1,
        bodyMarkdown,
        publishedBy: actorId ?? null,
        publishedAt: new Date(),
      },
    });
    return tx.courseSection.update({
      where: { id: sectionId },
      data: { activeVersionId: version.id, updatedAt: new Date() },
      include: { activeVersion: true },
    });
  });
}

export function getSection(sectionId: string) {
  return prisma.courseSection.findUnique({
    where: { id: sectionId },
    include: { activeVersion: true },
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
    select: { id: true, archivedAt: true },
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
    select: { id: true },
  });
  if (!latest) {
    throw new ValidationError("Seksjonen har ikke noe innhold å publisere.");
  }
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { activeVersionId: latest.id },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.published,
    actorId,
    metadata: { sectionId },
  });
  return updated;
}

// Avpubliser: nullstill activeVersionId. G2 — kan ikke avpublisere en seksjon som ligger i et kurs.
export async function unpublishSection(sectionId: string, actorId?: string) {
  await assertSectionExists(sectionId);
  await assertSectionNotInAnyCourse(sectionId, "avpubliseres");
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { activeVersionId: null },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.unpublished,
    actorId,
    metadata: { sectionId },
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
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { archivedAt: new Date(), activeVersionId: null },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.archived,
    actorId,
    metadata: { sectionId },
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
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { archivedAt: null },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.restored,
    actorId,
    metadata: { sectionId },
  });
  return updated;
}

export async function deleteSection(sectionId: string) {
  await assertSectionExists(sectionId);
  // G2: navngir kursene (konsistent med modul-sletting).
  await assertSectionNotInAnyCourse(sectionId, "slettes");
  // #758: capture the section's asset blob paths before the delete — SectionAsset rows cascade away
  // with the section, so afterwards there is nothing left to look them up from.
  const blobPaths = await collectSectionAssetBlobPaths([sectionId]);
  await runInTransaction(async (tx) => {
    // Detach activeVersion FK before deleting versions to avoid the self-reference.
    await tx.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
    await tx.courseSectionVersion.deleteMany({ where: { sectionId } });
    await tx.courseSection.delete({ where: { id: sectionId } });
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
