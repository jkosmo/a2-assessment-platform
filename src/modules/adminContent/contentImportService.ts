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
import { adminContentRepository } from "./adminContentRepository.js";
import { courseRepository } from "../course/courseRepository.js";
import { createCourse, setCourseModules, setCourseItems, publishCourse, type CourseItemInput } from "../course/courseCommands.js";
import { createSection, updateSectionContent } from "../course/sectionCommands.js";
import { importSectionAssets } from "../course/assetCommands.js";
import { ValidationError } from "../../errors/AppError.js";
import { localizedTextCodec, type LocalizedText } from "../../codecs/localizedTextCodec.js";
import { recordAuditEvent } from "../../services/auditService.js";
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

// #749: recreate one learning section (title + markdown) AND its inlined figures/images. Ordering
// matters: the section (and version 1) is created first with the SOURCE markdown, then the assets
// are re-created to obtain their new ids, then a NEW section version is saved whose markdown refs
// point at the new asset ids — so the ACTIVE version never references source ids. Sections without
// assets skip the second save (old asset-less v1 files behave exactly as before). A failure while
// importing an asset throws with the section title for context; any blobs written before the
// failure are orphaned (no row references them) — tolerable for v1, matching createSectionAsset.
async function importSectionPayload(section: SectionExportPayload, actorId: string): Promise<string> {
  const serializedMarkdown = serializeRequired(section.bodyMarkdown);
  const created = await createSection({
    title: serializeRequired(section.title),
    bodyMarkdown: serializedMarkdown,
    actorId,
  });

  const assets = section.assets ?? [];
  if (assets.length === 0) return created.id;

  let idMap: Map<string, string>;
  try {
    idMap = await importSectionAssets(created.id, assets);
  } catch (error) {
    const title = typeof section.title === "string" ? section.title : JSON.stringify(section.title);
    const detail = error instanceof Error ? error.message : String(error);
    // Keep the client-error status (asset validation failures are 400) while adding section context.
    throw new ValidationError(`Failed to import assets for section "${title}": ${detail}`);
  }

  const remapped = remapAssetRefs(serializedMarkdown, idMap);
  if (remapped !== serializedMarkdown) {
    await updateSectionContent(created.id, remapped, actorId);
  }
  return created.id;
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
): Promise<{ moduleId: string; moduleVersionId: string }> {
  let moduleId: string;
  if (options.mode === "replaceExisting") {
    if (!options.targetModuleId) {
      throw new Error("targetModuleId is required when mode is replaceExisting.");
    }
    const existing = await adminContentRepository.findModuleTitle(options.targetModuleId);
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
    });
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
        });

  const promptTemplate =
    isMcqOnly || !payload.activeVersion.promptTemplate
      ? null
      : await createPromptTemplateVersion({
          moduleId,
          systemPrompt: serializeRequired(payload.activeVersion.promptTemplate.systemPrompt),
          userPromptTemplate: serializeRequired(payload.activeVersion.promptTemplate.userPromptTemplate),
          examples: payload.activeVersion.promptTemplate.examples ?? [],
          active: true,
        });

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
        });

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
  });

  // If the source had this module published (audit.publishedAt set), auto-
  // publish the imported version too. Matches the user's design choice for
  // audit-history preservation: if the source was live, the destination
  // should be live. Without this, imported modules end up as drafts and
  // participants get "module not available" when the course references them.
  //
  // v1.2.14 (#456): in-app duplisering passerer autoPublish=false så kopier alltid
  // starter som utkast — forfatter skal eksplisitt publisere etter gjennomgang.
  if (options.autoPublish !== false && payload.activeVersion.audit?.publishedAt) {
    await publishModuleVersion(moduleId, moduleVersion.id, options.actorId);
  }

  return { moduleId, moduleVersionId: moduleVersion.id };
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
  const result = await importModulePayload(envelope.module, options);

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: result.moduleId,
    action: auditActions.adminContent.moduleImported,
    actorId: options.actorId,
    metadata: {
      moduleId: result.moduleId,
      moduleVersionId: result.moduleVersionId,
      mode: options.mode,
      sourcePublishedAt: envelope.module.activeVersion.audit.publishedAt ?? null,
      sourcePublishedBy: envelope.module.activeVersion.audit.publishedBy ?? null,
      sourceVersionNo: envelope.module.activeVersion.audit.sourceVersionNo ?? null,
      ...agentAuthoringAuditMetadata(options.agent),
    },
  });

  return result;
}

export async function importCourseFromEnvelope(
  envelope: ExportEnvelope,
  options: {
    actorId: string;
    mode: ImportMode;
    targetCourseId?: string;
  },
): Promise<{ courseId: string; moduleIds: string[] }> {
  if (envelope.scope !== "course" || !envelope.course) {
    throw new Error("Envelope is not a course export.");
  }
  const payload = envelope.course;

  let courseId: string;
  if (options.mode === "replaceExisting") {
    if (!options.targetCourseId) {
      throw new Error("targetCourseId is required when mode is replaceExisting.");
    }
    const existing = await courseRepository.findCourseById(options.targetCourseId);
    if (!existing) {
      throw new Error("Target course not found for replaceExisting.");
    }
    courseId = options.targetCourseId;
  } else {
    const newCourse = await createCourse({
      title: serializeRequired(payload.course.title),
      description: serializeLocalized(payload.course.description),
      certificationLevel: payload.course.certificationLevel
        ? serializeLocalized(payload.course.certificationLevel as LocalizedText)
        : null,
      actorId: options.actorId,
    });
    courseId = newCourse.id;
  }

  // Each inlined module payload is imported via createNew (a course import never
  // tries to replace existing modules — that would conflate two different
  // collision questions). Sections are recreated likewise. #512: prefer the full
  // mixed `items` sequence; fall back to the legacy modules-only list (v1 files).
  const importedModuleIds: string[] = [];
  let sectionCount = 0;

  if (payload.course.items && payload.course.items.length > 0) {
    const ordered = [...payload.course.items].sort((a, b) => a.sortOrder - b.sortOrder);
    const courseItemInputs: CourseItemInput[] = [];
    for (const entry of ordered) {
      if (entry.type === "SECTION") {
        const sectionId = await importSectionPayload(entry.section, options.actorId);
        courseItemInputs.push({ type: "SECTION", sectionId });
        sectionCount += 1;
      } else {
        const imported = await importModulePayload(entry.module, { actorId: options.actorId, mode: "createNew" });
        courseItemInputs.push({ type: "MODULE", moduleId: imported.moduleId });
        importedModuleIds.push(imported.moduleId);
      }
    }
    await setCourseItems(courseId, courseItemInputs);
  } else {
    const importedModules: Array<{ moduleId: string; sortOrder: number }> = [];
    for (const item of payload.course.modules ?? []) {
      const imported = await importModulePayload(item.module, { actorId: options.actorId, mode: "createNew" });
      importedModules.push({ moduleId: imported.moduleId, sortOrder: item.sortOrder });
    }
    importedModules.sort((a, b) => a.sortOrder - b.sortOrder);
    importedModuleIds.push(...importedModules.map((m) => m.moduleId));
    await setCourseModules(
      courseId,
      importedModules.map((m) => ({ moduleId: m.moduleId, sortOrder: m.sortOrder })),
    );
  }

  // Same publish-state-preservation rule as for modules: if source course was
  // published (audit.publishedAt set), publish the destination course too.
  // Must happen AFTER setCourseModules so the published course has its modules.
  if (payload.course.audit?.publishedAt) {
    await publishCourse(courseId, options.actorId);
  }

  await recordAuditEvent({
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
  });

  return { courseId, moduleIds: importedModuleIds };
}
