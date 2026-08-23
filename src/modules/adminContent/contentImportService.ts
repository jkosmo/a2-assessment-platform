// Module + course import from a2-content-export/v1 envelopes (#433 phase 3).
//
// Design notes:
// - Source-environment audit attributes (publishedBy/publishedAt/versionNo) are
//   preserved as opaque display-only strings in the import audit event. They
//   are NEVER linked to the destination's user table or used as foreign keys.
// - createNew always generates fresh module + version IDs in the destination.
// - replaceExisting appends a NEW version chain to the existing module (the
//   destination's history is preserved; the source's version history is NOT
//   replayed — only the activeVersion from the envelope is imported).
// - Failures partway through leave half-imported state behind. createModule +
//   createRubricVersion etc. are not wrapped in a transaction today; this
//   matches the existing admin-content commands' behavior. Cleanup is a
//   follow-up if/when import becomes a frequent operation.

import {
  createModule,
  createRubricVersion,
  createPromptTemplateVersion,
  createMcqSetVersion,
  createModuleVersion,
  publishModuleVersion,
} from "./adminContentCommands.js";
import { adminContentRepository, createAdminContentRepository } from "./adminContentRepository.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { prisma } from "../../db/prisma.js";
import { courseRepository } from "../course/courseRepository.js";
import { createCourse, setCourseModules, setCourseItems, publishCourse, type CourseItemInput } from "../course/courseCommands.js";
import { randomUUID } from "node:crypto";
import { createSection } from "../course/sectionCommands.js";
import { stageSectionAssets, reclaimAssetBlobs, type StagedSectionAsset } from "../course/assetCommands.js";
import { ValidationError } from "../../errors/AppError.js";
import { localizedTextCodec, type LocalizedText } from "../../codecs/localizedTextCodec.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { validateTranslationCompleteness, validateMcqTranslationCompleteness } from "./contentValidationService.js";
import {
  auditActions,
  auditEntityTypes,
  agentAuthoringAuditMetadata,
  type AgentAuthoringContext,
} from "../../observability/auditEvents.js";
import type {
  ExportEnvelope,
  ModuleExportPayload,
  SectionExportPayload,
} from "./adminContentSchemas.js";

export type ImportMode = "createNew" | "replaceExisting";

// #749 (Layer A): the course-import route carries inlined section assets (base64), so the JSON body
// can be far larger than the 5 MB global parser allows. Sized to cover the 25 MB total-asset cap
// after base64 inflation (~1.33×) plus JSON/markdown headroom. Applied to ONLY the course-import
// route in app.ts (module import cannot carry assets — modules have no sections). Keeping every
// other endpoint at 5 MB limits the large-body surface.
export const COURSE_IMPORT_BODY_LIMIT_BYTES = 35 * 1024 * 1024; // 35 MB

// #796: a content import builds its whole module/course graph in one interactive transaction, which can
// exceed Prisma's 5s default (many rows; a large course). Asset blob uploads are staged BEFORE the tx, so
// no network I/O happens inside it — this bounds only the DB work.
const IMPORT_TX_TIMEOUT_MS = 30_000;

// #749 (Layer A): rewrite every `asset:<sourceId>` reference in the serialised section markdown
// to `asset:<newAssetId>` using the source→new id map produced when the section's assets are
// re-created. Refs with no mapping are left untouched (defensive — an author-mistyped ref should
// not be silently mangled). The markdown is the JSON-serialised localized string, so the replace
// runs across every locale value at once. Grammar is the canonical `[a-zA-Z0-9_-]` asset-ref set
// (#754): agent fallback files carry invented sourceIds like `fig-styringslogikker` — a narrower
// class would match only up to the first hyphen and leave the ref dangling.
function remapAssetRefs(serializedMarkdown: string, idMap: Map<string, string>): string {
  if (idMap.size === 0) return serializedMarkdown;
  return serializedMarkdown.replace(/asset:([a-zA-Z0-9_-]+)/g, (whole, sourceId: string) => {
    const mapped = idMap.get(sourceId);
    return mapped ? `asset:${mapped}` : whole;
  });
}

// #796: a section prepared for a transactional course import. Its asset blobs are already written to
// storage (staged, keyed by the pre-generated `sectionId`); its `bodyMarkdown` already has `asset:<id>`
// refs rewritten to the pre-generated asset row ids; and `blobPaths` lists every blob written so a
// rolled-back import can reclaim them. `persistStagedSection` creates the DB rows inside the import tx.
type StagedImportSection = {
  sectionId: string;
  title: string;
  bodyMarkdown: string;
  stagedAssets: Array<{ id: string; rowData: StagedSectionAsset["rowData"] }>;
  blobPaths: string[];
};

// #796 (staging half — runs BEFORE the import transaction, does blob I/O, no DB writes): pre-generate the
// section id + its asset row ids, write the asset blobs to storage, and rewrite the markdown's
// `asset:<sourceId>` refs to the new asset ids so the persisted version never references source ids.
async function stageSectionForImport(
  section: SectionExportPayload,
  // #916: the standalone `replaceExisting` import stages onto an EXISTING section id, so its asset
  // blobs land under that section's own `sections/<id>/…` prefix instead of an orphan one.
  existingSectionId?: string,
): Promise<StagedImportSection> {
  const sectionId = existingSectionId ?? randomUUID();
  const serializedMarkdown = serializeRequired(section.bodyMarkdown);
  const title = serializeRequired(section.title);
  const assets = section.assets ?? [];

  if (assets.length === 0) {
    return { sectionId, title, bodyMarkdown: serializedMarkdown, stagedAssets: [], blobPaths: [] };
  }

  let staged: StagedSectionAsset[];
  try {
    staged = await stageSectionAssets(sectionId, assets);
  } catch (error) {
    const label = typeof section.title === "string" ? section.title : JSON.stringify(section.title);
    const detail = error instanceof Error ? error.message : String(error);
    // Keep the client-error status (asset validation failures are 400) while adding section context.
    throw new ValidationError(`Failed to import assets for section "${label}": ${detail}`);
  }

  const idMap = new Map<string, string>();
  const stagedAssets = staged.map((asset) => {
    const id = randomUUID();
    idMap.set(asset.sourceId, id);
    return { id, rowData: asset.rowData };
  });

  return {
    sectionId,
    title,
    bodyMarkdown: remapAssetRefs(serializedMarkdown, idMap),
    stagedAssets,
    blobPaths: staged.flatMap((asset) => asset.blobPaths),
  };
}

// #796 (persist half — runs INSIDE the import transaction): create the section (with its pre-generated id
// and already-remapped markdown) and its SectionAsset rows (with pre-generated ids referencing the staged
// blobs). No blob I/O here.
async function persistStagedSection(
  tx: DbTransactionClient,
  staged: StagedImportSection,
  actorId: string,
  // #916: the standalone section import lands UNPUBLISHED (the same rule module import follows
  // after #896 §9 — imported content is reviewed before it reaches participants), so the new door
  // passes `draft: true`.
  //
  // ⚠️ QA 2026-08-18: the note that used to sit here said course import "keeps its existing
  // behaviour — the section is created live". That stopped being true the moment #916 added the
  // gate to `createSection`: `heldBackByTranslationGate = !input.draft && !gate.ok`, and course
  // import passes no flag at all. A section with a one-language title is therefore held back —
  // correctly — but the caller never learned it, so the course was published on top of a section
  // with `activeVersionId: null`. The participant got 200 with an empty body and could still mark
  // it read towards their certificate.
  //
  // The gate state is returned now, exactly as `importModulePayload` already does for modules.
  options?: { draft?: boolean; agent?: AgentAuthoringContext },
): Promise<{ sectionId: string; heldBackByTranslationGate: boolean }> {
  const created = await createSection(
    {
      id: staged.sectionId,
      title: staged.title,
      bodyMarkdown: staged.bodyMarkdown,
      actorId,
      draft: options?.draft,
      agent: options?.agent,
    },
    tx,
  );
  for (const asset of staged.stagedAssets) {
    await tx.sectionAsset.create({ data: { id: asset.id, sectionId: staged.sectionId, ...asset.rowData } });
  }
  return { sectionId: staged.sectionId, heldBackByTranslationGate: created.heldBackByTranslationGate };
}

function serializeLocalized(value: LocalizedText | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return localizedTextCodec.serialize(value as LocalizedText);
}

function serializeRequired(value: LocalizedText): string {
  return localizedTextCodec.serialize(value);
}

async function importModulePayload(
  payload: ModuleExportPayload,
  options: {
    actorId: string;
    mode: ImportMode;
    targetModuleId?: string;
    // v1.2.14 (#456): når false, auto-publiserer ikke selv om kildens audit.publishedAt er
    // satt. Brukes av in-app dupliseringen — kopien skal alltid være utkast inntil
    // forfatter eksplisitt publiserer. Default true bevarer fil-import-flytens atferd.
    autoPublish?: boolean;
  },
  // #796: the whole module graph is built on this single transaction client, so a failure partway
  // through rolls back every row (no standalone module / partial versions / missing audit).
  tx: DbTransactionClient,
  // #896 S4: `heldBackByTranslationGate` is true when the source was published but the package is
  // missing a locale, so this module stayed a draft. A course import needs to know, or it publishes
  // a course whose module is not live.
): Promise<{ moduleId: string; moduleVersionId: string; heldBackByTranslationGate: boolean }> {
  let moduleId: string;
  if (options.mode === "replaceExisting") {
    if (!options.targetModuleId) {
      throw new Error("targetModuleId is required when mode is replaceExisting.");
    }
    const existing = await createAdminContentRepository(tx).findModuleTitle(options.targetModuleId);
    if (!existing) {
      throw new Error("Target module not found for replaceExisting.");
    }
    moduleId = options.targetModuleId;
  } else {
    const newModule = await createModule({
      title: serializeRequired(payload.module.title),
      description: serializeLocalized(payload.module.description),
      certificationLevel: payload.module.certificationLevel
        ? serializeLocalized(payload.module.certificationLevel as LocalizedText)
        : undefined,
      actorId: options.actorId,
    }, tx);
    moduleId = newModule.id;
  }

  // #525/#547/#578: MCQ_ONLY has no rubric/prompt; FREETEXT_ONLY has no MCQ set — skip on import.
  const isMcqOnly = payload.activeVersion.assessmentMode === "MCQ_ONLY";
  const isFreetextOnly = payload.activeVersion.assessmentMode === "FREETEXT_ONLY";

  const rubric =
    isMcqOnly || !payload.activeVersion.rubric
      ? null
      : await createRubricVersion({
          moduleId,
          criteria: payload.activeVersion.rubric.criteria,
          scalingRule: payload.activeVersion.rubric.scalingRule,
          active: true,
        }, tx);

  const promptTemplate =
    isMcqOnly || !payload.activeVersion.promptTemplate
      ? null
      : await createPromptTemplateVersion({
          moduleId,
          systemPrompt: serializeRequired(payload.activeVersion.promptTemplate.systemPrompt),
          userPromptTemplate: serializeRequired(payload.activeVersion.promptTemplate.userPromptTemplate),
          examples: payload.activeVersion.promptTemplate.examples ?? [],
          active: true,
        }, tx);

  const mcqSet =
    isFreetextOnly || !payload.activeVersion.mcqSet
      ? null
      : await createMcqSetVersion({
          moduleId,
          title: serializeRequired(payload.activeVersion.mcqSet.title),
          active: true,
          questions: payload.activeVersion.mcqSet.questions.map((question) => ({
            stem: serializeRequired(question.stem),
            options: question.options.map((option) => serializeRequired(option)),
            correctAnswer: serializeRequired(question.correctAnswer),
            rationale: question.rationale ? serializeRequired(question.rationale) : undefined,
          })),
        }, tx);

  const moduleVersion = await createModuleVersion({
    moduleId,
    assessmentMode: payload.activeVersion.assessmentMode,
    taskText: isMcqOnly || !payload.activeVersion.taskText
      ? undefined
      : serializeRequired(payload.activeVersion.taskText),
    assessorExpectedContent: serializeLocalized(payload.activeVersion.assessorExpectedContent),
    candidateTaskConstraints: serializeLocalized(payload.activeVersion.candidateTaskConstraints),
    assessmentBlueprint: payload.activeVersion.assessmentBlueprint ?? undefined,
    rubricVersionId: rubric?.id,
    promptTemplateVersionId: promptTemplate?.id,
    mcqSetVersionId: mcqSet?.id,
    submissionSchemaJson: payload.activeVersion.submissionSchema
      ? JSON.stringify(payload.activeVersion.submissionSchema)
      : undefined,
    assessmentPolicyJson: payload.activeVersion.assessmentPolicy
      ? JSON.stringify(payload.activeVersion.assessmentPolicy)
      : undefined,
  }, tx);

  // If the source had this module published (audit.publishedAt set), auto-
  // publish the imported version too. Matches the user's design choice for
  // audit-history preservation: if the source was live, the destination
  // should be live. Without this, imported modules end up as drafts and
  // participants get "module not available" when the course references them.
  //
  // v1.2.14 (#456): in-app duplisering passerer autoPublish=false så kopier alltid
  // starter som utkast — forfatter skal eksplisitt publisere etter gjennomgang.
  //
  // #896 S4: auto-publish is the third door into publishing, and the only one that can bring in
  // content no author ever reviewed here. If the package is missing a language, the import still
  // succeeds — failing the whole transaction over a translation gap would lose the import — but
  // the module stays a DRAFT. That is also the agreed import model: imported modules are drafts
  // and publishing is an explicit act. The author publishes it once the gaps are filled, and the
  // ordinary gate tells them which ones.
  // Same field set as the module-publish route and the cascade. A gate that checks fewer fields
  // here is a gate with a hole shaped exactly like an import.
  const importTranslationIssues = [
    ...validateTranslationCompleteness([
      { field: "title", raw: serializeRequired(payload.module.title) },
      ...(payload.module.description
        ? [{ field: "description", raw: serializeLocalized(payload.module.description) }]
        : []),
      ...(isMcqOnly || !payload.activeVersion.taskText
        ? []
        : [{ field: "taskText", raw: serializeRequired(payload.activeVersion.taskText) }]),
      ...(payload.activeVersion.assessorExpectedContent
        ? [{ field: "assessorExpectedContent", raw: serializeLocalized(payload.activeVersion.assessorExpectedContent) }]
        : []),
      ...(payload.activeVersion.candidateTaskConstraints
        ? [{ field: "candidateTaskConstraints", raw: serializeLocalized(payload.activeVersion.candidateTaskConstraints) }]
        : []),
    ]),
    ...validateMcqTranslationCompleteness(
      (payload.activeVersion.mcqSet?.questions ?? []).map((question) => ({
        stem: serializeRequired(question.stem),
        optionsJson: JSON.stringify(question.options.map((option) => serializeRequired(option))),
        correctAnswer: serializeRequired(question.correctAnswer),
        rationale: question.rationale ? serializeRequired(question.rationale) : null,
      })),
    ),
  ];
  // `heldBackByTranslationGate` is reported to the caller, not just acted on locally. A course
  // import publishes the course after its modules; if a module was held back and the course goes
  // live anyway, the published course points at a module with no active version — participants get
  // "module not available", which is invariant I1 violated by the very gate meant to protect them.
  const heldBackByTranslationGate =
    options.autoPublish !== false
    && Boolean(payload.activeVersion.audit?.publishedAt)
    && importTranslationIssues.length > 0;

  if (options.autoPublish !== false && payload.activeVersion.audit?.publishedAt && !heldBackByTranslationGate) {
    await publishModuleVersion(moduleId, moduleVersion.id, options.actorId, tx);
  }

  return { moduleId, moduleVersionId: moduleVersion.id, heldBackByTranslationGate };
}

export async function importModuleFromEnvelope(
  envelope: ExportEnvelope,
  options: {
    actorId: string;
    mode: ImportMode;
    targetModuleId?: string;
    autoPublish?: boolean;
    // AA-5 (#653): agent-orchestrated imports carry a trace in the audit metadata.
    agent?: AgentAuthoringContext;
  },
): Promise<{ moduleId: string; moduleVersionId: string }> {
  if (envelope.scope !== "module" || !envelope.module) {
    throw new Error("Envelope is not a module export.");
  }
  const moduleEnvelope = envelope.module;

  // #796: the whole module graph (module + rubric/prompt/mcq versions + module version + publish) and its
  // import audit commit in ONE transaction. A failure on any step rolls the entire import back — no
  // standalone module, partial versions, or missing audit. Modules carry no blobs, so this is pure DB.
  return runInTransaction(
    async (tx) => {
      const result = await importModulePayload(moduleEnvelope, options, tx);
      await recordAuditEvent(
        {
          entityType: auditEntityTypes.module,
          entityId: result.moduleId,
          action: auditActions.adminContent.moduleImported,
          actorId: options.actorId,
          metadata: {
            moduleId: result.moduleId,
            moduleVersionId: result.moduleVersionId,
            mode: options.mode,
            sourcePublishedAt: moduleEnvelope.activeVersion.audit.publishedAt ?? null,
            sourcePublishedBy: moduleEnvelope.activeVersion.audit.publishedBy ?? null,
            sourceVersionNo: moduleEnvelope.activeVersion.audit.sourceVersionNo ?? null,
            ...agentAuthoringAuditMetadata(options.agent),
          },
        },
        tx,
      );
      return result;
    },
    { timeout: IMPORT_TX_TIMEOUT_MS },
  );
}

// Standalone learning-section import from an `a2-content-export/v1` envelope with `scope: "section"`
// (#916). Counterpart to GET /sections/:id/export-package.
//
// It deliberately reuses the SAME staging path the course import uses — `stageSectionAssets` writes
// the blobs (with #763's SVG sanitisation) before the transaction opens, and `persistStagedSection`
// creates the rows inside it. A second asset path for "the same thing but standalone" is exactly the
// duplication this codebase spent an epic removing.
//
// Two deliberate differences from a course-inlined section:
//   1. It lands UNPUBLISHED (#896 §9's rule for imported content: a human reviews before
//      participants read it). The publish gate (#916) then applies when the author publishes.
//   2. `replaceExisting` appends a NEW, inactive version to an existing section, so a live section
//      keeps serving its current version until the author reviews the import and publishes.
export async function importSectionFromEnvelope(
  envelope: ExportEnvelope,
  options: {
    actorId: string;
    mode: ImportMode;
    targetSectionId?: string;
    agent?: AgentAuthoringContext;
    // #937: sann når konvolutten ble laget av OSS rundt et fragment forfatteren lastet opp, ikke av
    // eksportøren. Da er `exportedAt` importtidspunktet — ikke et eksporttidspunkt.
    envelopeSynthesized?: boolean;
  },
): Promise<{ sectionId: string; sectionVersionId: string; assetCount: number }> {
  if (envelope.scope !== "section" || !envelope.section) {
    throw new Error("Envelope is not a section export.");
  }
  const payload = envelope.section;

  let targetSectionId: string | undefined;
  if (options.mode === "replaceExisting") {
    if (!options.targetSectionId) {
      throw new Error("targetSectionId is required when mode is replaceExisting.");
    }
    const existing = await prisma.courseSection.findUnique({
      where: { id: options.targetSectionId },
      select: { id: true },
    });
    if (!existing) {
      throw new Error("Target section not found for replaceExisting.");
    }
    targetSectionId = existing.id;
  }

  // #796's split: blob I/O BEFORE the transaction, DB rows inside it.
  const staged = await stageSectionForImport(payload, targetSectionId);

  try {
    return await runInTransaction(
      async (tx) => {
        let sectionId: string;
        if (targetSectionId) {
          const last = await tx.courseSectionVersion.findFirst({
            where: { sectionId: targetSectionId },
            orderBy: { versionNo: "desc" },
            select: { versionNo: true },
          });
          // Title is updated, content becomes a new INACTIVE version — the section's live content
          // does not change until the author publishes (and passes the gate).
          await tx.courseSection.update({
            where: { id: targetSectionId },
            data: { title: staged.title, updatedAt: new Date() },
          });
          await tx.courseSectionVersion.create({
            data: {
              sectionId: targetSectionId,
              versionNo: (last?.versionNo ?? 0) + 1,
              bodyMarkdown: staged.bodyMarkdown,
              publishedBy: null,
              publishedAt: null,
            },
          });
          for (const asset of staged.stagedAssets) {
            await tx.sectionAsset.create({ data: { id: asset.id, sectionId: targetSectionId, ...asset.rowData } });
          }
          sectionId = targetSectionId;
        } else {
          // Always a draft on this door, so the gate result adds nothing the caller does not
          // already know — the section is unpublished either way.
          ({ sectionId } = await persistStagedSection(tx, staged, options.actorId, {
            draft: true,
            agent: options.agent,
          }));
        }

        const latest = await tx.courseSectionVersion.findFirstOrThrow({
          where: { sectionId },
          orderBy: { versionNo: "desc" },
          select: { id: true },
        });

        await recordAuditEvent(
          {
            entityType: auditEntityTypes.courseSection,
            entityId: sectionId,
            action: auditActions.adminContent.sectionImported,
            actorId: options.actorId,
            metadata: {
              sectionId,
              sectionVersionId: latest.id,
              mode: options.mode,
              assetCount: staged.stagedAssets.length,
              sourcePublishedAt: payload.audit?.publishedAt ?? null,
              sourceVersionNo: payload.audit?.sourceVersionNo ?? null,
              // Uten dette ville revisjonsraden vært bit for bit lik en import av en EKTE
              // eksportpakke, og ingen kunne i ettertid sett at opphavsdataene var våre egne.
              // Føres bare når den er sann, så eksisterende rader ikke endrer form.
              ...(options.envelopeSynthesized ? { envelopeSynthesized: true, syntheticExportedAt: envelope.exportedAt } : {}),
              ...agentAuthoringAuditMetadata(options.agent),
            },
          },
          tx,
        );

        return { sectionId, sectionVersionId: latest.id, assetCount: staged.stagedAssets.length };
      },
      { timeout: IMPORT_TX_TIMEOUT_MS },
    );
  } catch (error) {
    // Same reclaim contract as the course import: a rolled-back import leaves no orphaned blobs.
    if (staged.blobPaths.length > 0) {
      await reclaimAssetBlobs(staged.blobPaths);
    }
    throw error;
  }
}

export async function importCourseFromEnvelope(
  envelope: ExportEnvelope,
  options: {
    actorId: string;
    mode: ImportMode;
    targetCourseId?: string;
  },
  // #957: samme form som søsterfunksjonene — `importModulePayload` (:336) og `persistStagedSection`
  // (:169) rapporterer begge `heldBackByTranslationGate` oppover. Kursimporten regnet ut flagget,
  // brukte det til å holde kurset som utkast, og kastet det så. Kommentaren over `anyContentHeldBack`
  // lovet at flagget «is reported to the caller, not just acted on locally» — nå gjør det det.
): Promise<{ courseId: string; moduleIds: string[]; heldBackByTranslationGate: boolean }> {
  if (envelope.scope !== "course" || !envelope.course) {
    throw new Error("Envelope is not a course export.");
  }
  const payload = envelope.course;

  // #512: prefer the full mixed `items` sequence; fall back to the legacy modules-only list (v1 files).
  const orderedItems =
    payload.course.items && payload.course.items.length > 0
      ? [...payload.course.items].sort((a, b) => a.sortOrder - b.sortOrder)
      : null;

  // #796: STAGE every section's asset blobs BEFORE the transaction — blob I/O must not happen inside the
  // DB tx (a B1 pool must not hold a connection open across uploads, and the tx would blow its timeout).
  // Each staged section carries its pre-generated id + remapped markdown so the graph builds atomically.
  const stagedSections = new Map<number, StagedImportSection>();
  const stagedBlobPaths: string[] = [];
  if (orderedItems) {
    for (let i = 0; i < orderedItems.length; i += 1) {
      const entry = orderedItems[i];
      if (entry.type === "SECTION") {
        const staged = await stageSectionForImport(entry.section);
        stagedSections.set(i, staged);
        stagedBlobPaths.push(...staged.blobPaths);
      }
    }
  }

  try {
    // #796: build (or extend) the whole course graph — course, sections + their asset rows, modules +
    // their version graphs, the ordered items, the publish flip, and the import audit — in ONE
    // transaction. A failure on any item rolls the entire import back (no standalone modules/sections,
    // partial versions, or a course with no final audit).
    return await runInTransaction(
      async (tx) => {
        let courseId: string;
        if (options.mode === "replaceExisting") {
          if (!options.targetCourseId) {
            throw new Error("targetCourseId is required when mode is replaceExisting.");
          }
          const existing = await tx.course.findUnique({ where: { id: options.targetCourseId }, select: { id: true } });
          if (!existing) {
            throw new Error("Target course not found for replaceExisting.");
          }
          courseId = options.targetCourseId;
        } else {
          const newCourse = await createCourse(
            {
              title: serializeRequired(payload.course.title),
              description: serializeLocalized(payload.course.description),
              certificationLevel: payload.course.certificationLevel
                ? serializeLocalized(payload.course.certificationLevel as LocalizedText)
                : null,
              actorId: options.actorId,
            },
            tx,
          );
          courseId = newCourse.id;
        }

        // Each inlined module payload is imported via createNew (a course import never replaces existing
        // modules — that would conflate two different collision questions). Sections are recreated likewise.
        const importedModuleIds: string[] = [];
        let sectionCount = 0;
        // #896 S4: set when any module in this course could not be auto-published because it is
        // missing a locale. The course must then stay a draft too.
        let anyContentHeldBack = false;

        if (orderedItems) {
          const courseItemInputs: CourseItemInput[] = [];
          for (let i = 0; i < orderedItems.length; i += 1) {
            const entry = orderedItems[i];
            if (entry.type === "SECTION") {
              const staged = stagedSections.get(i);
              if (!staged) throw new Error("Internal: section was not staged before the import transaction.");
              const persisted = await persistStagedSection(tx, staged, options.actorId);
              // A held-back section has no active version, so publishing the course around it would
              // ship a blank page the participant can still mark as read. Same rule as modules.
              if (persisted.heldBackByTranslationGate) anyContentHeldBack = true;
              courseItemInputs.push({ type: "SECTION", sectionId: staged.sectionId });
              sectionCount += 1;
            } else {
              const imported = await importModulePayload(entry.module, { actorId: options.actorId, mode: "createNew" }, tx);
              if (imported.heldBackByTranslationGate) anyContentHeldBack = true;
              courseItemInputs.push({ type: "MODULE", moduleId: imported.moduleId });
              importedModuleIds.push(imported.moduleId);
            }
          }
          await setCourseItems(courseId, courseItemInputs, undefined, tx);
        } else {
          const importedModules: Array<{ moduleId: string; sortOrder: number }> = [];
          for (const item of payload.course.modules ?? []) {
            const imported = await importModulePayload(item.module, { actorId: options.actorId, mode: "createNew" }, tx);
            if (imported.heldBackByTranslationGate) anyContentHeldBack = true;
            importedModules.push({ moduleId: imported.moduleId, sortOrder: item.sortOrder });
          }
          importedModules.sort((a, b) => a.sortOrder - b.sortOrder);
          importedModuleIds.push(...importedModules.map((m) => m.moduleId));
          await setCourseModules(
            courseId,
            importedModules.map((m) => ({ moduleId: m.moduleId, sortOrder: m.sortOrder })),
            tx,
          );
        }

        // Same publish-state-preservation rule as for modules: if the source course was published, publish
        // the destination too — AFTER the items exist so the has-modules check passes.
        //
        // #896 S4: unless a module was held back by the translation gate. publishCourse only checks
        // that a module item EXISTS, not that it is publishable, so publishing here would commit a
        // live course whose module has no active version — the participant hits "module not
        // available". The course waits with its modules; the author publishes both once the gaps
        // are filled.
        if (payload.course.audit?.publishedAt && !anyContentHeldBack) {
          await publishCourse(courseId, options.actorId, tx);
        }

        await recordAuditEvent(
          {
            entityType: auditEntityTypes.course,
            entityId: courseId,
            action: auditActions.adminContent.courseImported,
            actorId: options.actorId,
            metadata: {
              courseId,
              mode: options.mode,
              moduleCount: importedModuleIds.length,
              sectionCount,
              sourcePublishedAt: payload.course.audit.publishedAt ?? null,
            },
          },
          tx,
        );

        // #957: uten flagget her får forfatteren `201 Created` og et kurs som ligger som utkast,
        // uten et ord om hvorfor. `anyContentHeldBack` er den ENESTE kilden til den forklaringen —
        // den utledes ikke av kursets tilstand alene (et kurs kan også være utkast fordi kilden
        // var det).
        return { courseId, moduleIds: importedModuleIds, heldBackByTranslationGate: anyContentHeldBack };
      },
      { timeout: IMPORT_TX_TIMEOUT_MS },
    );
  } catch (error) {
    // #796: the transaction rolled back (or staging/DB failed) — reclaim every blob staged for this failed
    // import so a failure leaves no orphaned storage. Best-effort; a failed reclaim never masks the error.
    if (stagedBlobPaths.length > 0) {
      await reclaimAssetBlobs(stagedBlobPaths);
    }
    throw error;
  }
}
