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
import { createCourse, setCourseModules, publishCourse } from "../course/courseCommands.js";
import { localizedTextCodec, type LocalizedText } from "../../codecs/localizedTextCodec.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import type {
  ExportEnvelope,
  ModuleExportPayload,
} from "./adminContentSchemas.js";

export type ImportMode = "createNew" | "replaceExisting";

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

  const rubric = await createRubricVersion({
    moduleId,
    criteria: payload.activeVersion.rubric.criteria,
    scalingRule: payload.activeVersion.rubric.scalingRule,
    passRule: payload.activeVersion.rubric.passRule,
    active: true,
  });

  const promptTemplate = await createPromptTemplateVersion({
    moduleId,
    systemPrompt: serializeRequired(payload.activeVersion.promptTemplate.systemPrompt),
    userPromptTemplate: serializeRequired(payload.activeVersion.promptTemplate.userPromptTemplate),
    examples: payload.activeVersion.promptTemplate.examples ?? [],
    active: true,
  });

  const mcqSet = await createMcqSetVersion({
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
    taskText: serializeRequired(payload.activeVersion.taskText),
    assessorExpectedContent: serializeLocalized(payload.activeVersion.assessorExpectedContent),
    candidateTaskConstraints: serializeLocalized(payload.activeVersion.candidateTaskConstraints),
    assessmentBlueprint: payload.activeVersion.assessmentBlueprint ?? undefined,
    rubricVersionId: rubric.id,
    promptTemplateVersionId: promptTemplate.id,
    mcqSetVersionId: mcqSet.id,
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
  if (payload.activeVersion.audit?.publishedAt) {
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
  // collision questions). The resulting module IDs are attached to the course
  // in the original sortOrder.
  const importedModules: Array<{ moduleId: string; sortOrder: number }> = [];
  for (const item of payload.course.modules) {
    const imported = await importModulePayload(item.module, {
      actorId: options.actorId,
      mode: "createNew",
    });
    importedModules.push({ moduleId: imported.moduleId, sortOrder: item.sortOrder });
  }

  await setCourseModules(
    courseId,
    importedModules
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({ moduleId: m.moduleId, sortOrder: m.sortOrder })),
  );

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
      moduleCount: importedModules.length,
      sourcePublishedAt: payload.course.audit.publishedAt ?? null,
    },
  });

  return { courseId, moduleIds: importedModules.map((m) => m.moduleId) };
}
