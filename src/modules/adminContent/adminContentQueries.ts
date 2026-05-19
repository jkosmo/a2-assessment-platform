import { adminContentRepository } from "./adminContentRepository.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { decodeLocalizedText, safeParseJson, mapMcqSetVersion } from "./adminContentProjections.js";

export type ModuleLibraryStatus = "archived" | "unpublished_draft" | "published" | "ready";

function deriveLibraryStatus(module: {
  archivedAt: Date | null;
  activeVersionId: string | null;
  versions: Array<{ id: string; versionNo: number; publishedAt: Date | null }>;
}): ModuleLibraryStatus {
  if (module.archivedAt) return "archived";
  const latestVersion = module.versions[0] ?? null;
  if (!latestVersion) return "ready";
  if (!module.activeVersionId) return "unpublished_draft";
  const latestIsActive = latestVersion.id === module.activeVersionId;
  if (!latestIsActive) return "unpublished_draft";
  return "published";
}

export async function listLibraryModules(locale: SupportedLocale = "en-GB") {
  const modules = await adminContentRepository.listLibraryModules();

  return modules.map((module) => ({
    id: module.id,
    title: localizeContentText(locale, module.title) ?? module.title,
    certificationLevel: localizeContentText(locale, module.certificationLevel) ?? module.certificationLevel ?? null,
    status: deriveLibraryStatus(module),
    archivedAt: module.archivedAt?.toISOString() ?? null,
    updatedAt: module.updatedAt.toISOString(),
    activeVersionId: module.activeVersionId,
    activeVersionNo: module.activeVersion?.versionNo ?? null,
    latestVersionNo: module.versions[0]?.versionNo ?? null,
    courseCount: module._count.courseModules,
    courses: module.courseModules.map((cm) => ({
      id: cm.course.id,
      title: localizeContentText(locale, cm.course.title) ?? cm.course.title,
    })),
  }));
}

export async function listArchivedModules(locale: SupportedLocale = "en-GB", search?: string) {
  const modules = await adminContentRepository.listArchivedModuleSummaries(search);

  return modules.map((module) => ({
    id: module.id,
    title: localizeContentText(locale, module.title) ?? module.title,
    description: localizeContentText(locale, module.description),
    certificationLevel: localizeContentText(locale, module.certificationLevel) ?? module.certificationLevel ?? null,
    archivedAt: module.archivedAt,
  }));
}

export async function listAdminModules(locale: SupportedLocale = "en-GB") {
  const modules = await adminContentRepository.listModuleSummaries();

  return modules.map((module) => ({
    id: module.id,
    title: localizeContentText(locale, module.title) ?? module.title,
    description: localizeContentText(locale, module.description),
    activeVersion: module.activeVersion
      ? {
          id: module.activeVersion.id,
          versionNo: module.activeVersion.versionNo,
        }
      : null,
  }));
}

export async function getModuleContentBundle(moduleId: string) {
  const module = await adminContentRepository.findModuleContentBundle(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  const moduleVersions = module.versions.map((version) => ({
    id: version.id,
    versionNo: version.versionNo,
    taskText: decodeLocalizedText(version.taskText) ?? version.taskText,
    assessorExpectedContent: decodeLocalizedText(version.assessorExpectedContent) ?? version.assessorExpectedContent,
    candidateTaskConstraints: version.candidateTaskConstraints
      ? (decodeLocalizedText(version.candidateTaskConstraints) ?? version.candidateTaskConstraints)
      : undefined,
    submissionSchema: version.submissionSchemaJson ? safeParseJson(version.submissionSchemaJson) : null,
    assessmentPolicy: version.assessmentPolicyJson ? safeParseJson(version.assessmentPolicyJson) : null,
    rubricVersionId: version.rubricVersionId,
    promptTemplateVersionId: version.promptTemplateVersionId,
    mcqSetVersionId: version.mcqSetVersionId,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  }));

  const rubricVersions = module.rubricVersions.map((version) => ({
    id: version.id,
    versionNo: version.versionNo,
    criteria: safeParseJson(version.criteriaJson),
    scalingRule: safeParseJson(version.scalingRuleJson),
    passRule: safeParseJson(version.passRuleJson),
    active: version.active,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  }));

  const promptTemplateVersions = module.promptTemplateVersions.map((version) => ({
    id: version.id,
    versionNo: version.versionNo,
    systemPrompt: decodeLocalizedText(version.systemPrompt) ?? version.systemPrompt,
    userPromptTemplate: decodeLocalizedText(version.userPromptTemplate) ?? version.userPromptTemplate,
    examples: safeParseJson(version.examplesJson),
    active: version.active,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  }));

  const mcqSetVersions = module.mcqSetVersions.map((version) => mapMcqSetVersion(version));

  const selectedModuleVersion = moduleVersions[0] ?? null;
  const selectedConfigurationSource =
    !selectedModuleVersion
      ? rubricVersions.length > 0 || promptTemplateVersions.length > 0 || mcqSetVersions.length > 0
        ? "latestIndividualVersions"
        : "moduleShellOnly"
      : module.activeVersionId === selectedModuleVersion.id
        ? "activeModuleVersion"
        : "latestModuleVersion";

  const selectedRubricVersion = selectedModuleVersion
    ? rubricVersions.find((version) => version.id === selectedModuleVersion.rubricVersionId) ?? null
    : rubricVersions[0] ?? null;
  const selectedPromptTemplateVersion = selectedModuleVersion
    ? promptTemplateVersions.find((version) => version.id === selectedModuleVersion.promptTemplateVersionId) ?? null
    : promptTemplateVersions[0] ?? null;
  const selectedMcqSetVersion = selectedModuleVersion
    ? mcqSetVersions.find((version) => version.id === selectedModuleVersion.mcqSetVersionId) ?? null
    : mcqSetVersions[0] ?? null;

  return {
    module: {
      id: module.id,
      title: decodeLocalizedText(module.title) ?? module.title,
      description: decodeLocalizedText(module.description) ?? module.description,
      certificationLevel: decodeLocalizedText(module.certificationLevel) ?? module.certificationLevel,
      validFrom: module.validFrom,
      validTo: module.validTo,
      activeVersionId: module.activeVersionId,
      createdAt: module.createdAt,
      updatedAt: module.updatedAt,
    },
    selectedConfiguration: {
      source: selectedConfigurationSource,
      moduleVersion: selectedModuleVersion,
      rubricVersion: selectedRubricVersion,
      promptTemplateVersion: selectedPromptTemplateVersion,
      mcqSetVersion: selectedMcqSetVersion,
    },
    versions: {
      moduleVersions,
      rubricVersions,
      promptTemplateVersions,
      mcqSetVersions,
    },
  };
}

// Helper: build only the inner module payload (without the envelope wrapper)
// for use by both the module-export endpoint and the course-export endpoint
// (which inlines each module's payload).
async function buildModuleExportPayload(
  moduleId: string,
): Promise<import("./adminContentSchemas.js").ModuleExportPayload> {
  const envelope = await buildModuleExportEnvelope(moduleId, { userId: null, email: null });
  if (!envelope.module) {
    throw new Error("Internal: module envelope did not include module payload.");
  }
  return envelope.module;
}

// Course export envelope (#433). Self-contained: inlines each module's full
// activeVersion payload so the destination environment does not need the
// source modules to exist already. Module order preserved via sortOrder.
export async function buildCourseExportEnvelope(
  courseId: string,
  exportedBy: { userId?: string | null; email?: string | null },
): Promise<import("./adminContentSchemas.js").ExportEnvelope> {
  const course = await (await import("../course/courseRepository.js")).courseRepository.findCourseById(courseId);
  if (!course) {
    throw new Error("Course not found.");
  }
  if (!course.modules || course.modules.length === 0) {
    throw new Error("Course has no modules to export.");
  }

  const sortedModules = [...course.modules].sort((a, b) => a.sortOrder - b.sortOrder);
  const modulePayloads = await Promise.all(
    sortedModules.map(async (cm) => ({
      sortOrder: cm.sortOrder,
      module: await buildModuleExportPayload(cm.moduleId),
    })),
  );

  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy.userId ?? null,
    exportedByEmail: exportedBy.email ?? null,
    scope: "course",
    course: {
      course: {
        title: decodeLocalizedText(course.title) as never ?? course.title as never,
        description: (course.description ? decodeLocalizedText(course.description) : null) as never,
        certificationLevel: (course.certificationLevel ? decodeLocalizedText(course.certificationLevel) : null) as never,
        audit: {
          publishedAt: course.publishedAt ? new Date(course.publishedAt).toISOString() : null,
          publishedBy: null,
          publishedByEmail: null,
          sourceVersionNo: null,
        },
        modules: modulePayloads,
      },
    },
  };
}

// Build the versioned export envelope for a single module (#433). Picks the
// currently-active ModuleVersion (or, if none is active, the latest one) and
// inlines the referenced rubric, prompt template, and MCQ set so the resulting
// file can recreate the module in another environment without external lookups.
// publishedBy/publishedAt are preserved as opaque source-env strings — display
// only, NEVER resolved against destination user IDs.
export async function buildModuleExportEnvelope(
  moduleId: string,
  exportedBy: { userId?: string | null; email?: string | null },
): Promise<import("./adminContentSchemas.js").ExportEnvelope> {
  const bundle = await getModuleContentBundle(moduleId);

  const moduleVersion =
    bundle.versions.moduleVersions.find((v) => v.id === bundle.module.activeVersionId)
    ?? bundle.versions.moduleVersions[0]
    ?? null;
  if (!moduleVersion) {
    throw new Error("Module has no versions to export.");
  }

  const rubricVersion =
    bundle.versions.rubricVersions.find((v) => v.id === moduleVersion.rubricVersionId)
    ?? bundle.versions.rubricVersions[0]
    ?? null;
  if (!rubricVersion) {
    throw new Error("Module has no rubric versions to export.");
  }

  const promptTemplateVersion =
    bundle.versions.promptTemplateVersions.find((v) => v.id === moduleVersion.promptTemplateVersionId)
    ?? bundle.versions.promptTemplateVersions[0]
    ?? null;
  if (!promptTemplateVersion) {
    throw new Error("Module has no prompt-template versions to export.");
  }

  const mcqSetVersion =
    bundle.versions.mcqSetVersions.find((v) => v.id === moduleVersion.mcqSetVersionId)
    ?? bundle.versions.mcqSetVersions[0]
    ?? null;
  if (!mcqSetVersion) {
    throw new Error("Module has no MCQ-set versions to export.");
  }

  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy.userId ?? null,
    exportedByEmail: exportedBy.email ?? null,
    scope: "module",
    module: {
      module: {
        title: bundle.module.title as never,
        description: (bundle.module.description ?? null) as never,
        certificationLevel: bundle.module.certificationLevel as never,
      },
      activeVersion: {
        taskText: moduleVersion.taskText as never,
        assessorExpectedContent: (moduleVersion.assessorExpectedContent ?? null) as never,
        candidateTaskConstraints: (moduleVersion.candidateTaskConstraints ?? null) as never,
        assessmentBlueprint: null,
        submissionSchema: (moduleVersion.submissionSchema ?? null) as never,
        assessmentPolicy: (moduleVersion.assessmentPolicy ?? null) as never,
        rubric: {
          criteria: rubricVersion.criteria as Record<string, unknown>,
          scalingRule: rubricVersion.scalingRule as Record<string, unknown>,
          passRule: rubricVersion.passRule as Record<string, unknown>,
          active: true,
        },
        promptTemplate: {
          systemPrompt: promptTemplateVersion.systemPrompt as never,
          userPromptTemplate: promptTemplateVersion.userPromptTemplate as never,
          examples: (promptTemplateVersion.examples ?? []) as Array<Record<string, unknown>>,
          active: true,
        },
        mcqSet: {
          title: mcqSetVersion.title as never,
          questions: mcqSetVersion.questions as never,
          active: true,
        },
        audit: {
          publishedAt: moduleVersion.publishedAt ? new Date(moduleVersion.publishedAt).toISOString() : null,
          publishedBy: moduleVersion.publishedBy ?? null,
          publishedByEmail: null,
          sourceVersionNo: moduleVersion.versionNo,
        },
      },
    },
  };
}
