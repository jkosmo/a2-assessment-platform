import { adminContentRepository } from "./adminContentRepository.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { decodeLocalizedText, safeParseJson, mapMcqSetVersion } from "./adminContentProjections.js";
import { ValidationError } from "../../errors/AppError.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";

// v1.2.20 (#460): "published_with_draft" skiller mellom (a) modul som aldri har vært
// publisert (unpublished_draft) og (b) modul som er live med eldre publisert versjon
// pluss en nyere upublisert draft. Sistnevnte vises fortsatt til participants
// (activeVersion er publisert), så label må kommunisere det tydelig.
export type ModuleLibraryStatus =
  | "archived"
  | "unpublished_draft"
  | "published_with_draft"
  | "published"
  | "ready";

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
  if (!latestIsActive) return "published_with_draft";
  return "published";
}

export async function listLibraryModules(
  locale: SupportedLocale = "en-GB",
  viewerUserId?: string,
  viewerIsAdmin = false,
) {
  const modules = await adminContentRepository.listLibraryModules();
  // #787/#836: annotate each module with whether the viewer owns it, so the quality/calibration picker
  // can default to "my modules". Only queried when a viewer id is supplied (unauthenticated → all false).
  const ownedIds = viewerUserId ? await adminContentRepository.listModuleIdsOwnedBy(viewerUserId) : new Set<string>();

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
    ownedByMe: ownedIds.has(module.id),
    // #787 slice 5: admin manages all; a non-admin manages only modules they own (unowned → admin-only).
    // Same rule as the ownership guard, so the library hides the edit/lifecycle actions that would 403.
    canManage: viewerIsAdmin || ownedIds.has(module.id),
    courseCount: module._count.courseItems,
    courses: module.courseItems.map((ci) => ({
      id: ci.course.id,
      title: localizeContentText(locale, ci.course.title) ?? ci.course.title,
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
    assessmentMode: version.assessmentMode,
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
    // Stage-tilbakemelding 2026-08-17: Innstillinger viser fire poengregler der et tomt felt betyr
    // helt ulike ting — og forfatteren kan ikke se hvilke. `totalMin` faller tilbake på denne
    // plattformverdien; de tre andre er AV når de er tomme (decisionService.ts:101-132). Panelet
    // trenger tallet for å kunne vise "70 (plattformstandard)" som plassholder i stedet for å
    // lagre det, som ville frosset en kopi modulen aldri følger igjen.
    //
    // Bevisst IKKE med i eksportkonvolutten (a2-content-export/v1): den flyttes mellom miljøer
    // som kan ha andre regler, og dette er ikke modulinnhold.
    platformDefaults: {
      totalMin: getAssessmentRules().thresholds.totalMin,
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
  const courseRepo = (await import("../course/courseRepository.js")).courseRepository;
  const course = await courseRepo.findCourseById(courseId);
  if (!course) {
    throw new Error("Course not found.");
  }

  // Full mixed sequence — modules + learning sections in order (#512).
  const courseItems = await courseRepo.findCourseItems(courseId);
  if (courseItems.length === 0) {
    throw new Error("Course has no items to export.");
  }

  // #749 (Layer A): running budget for inlined section-asset bytes across the whole envelope.
  // Enforced inside buildSectionExportPayload; throws a ValidationError if the total exceeds the cap.
  const assetBudget = { total: 0 };

  const itemPayloads = await Promise.all(
    [...courseItems]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(async (item) => {
        if (item.itemType === "SECTION" && item.section) {
          const sectionVersion = await buildSectionExportPayload(item.section.id, assetBudget);
          return { type: "SECTION" as const, sortOrder: item.sortOrder, section: sectionVersion };
        }
        const moduleId = item.moduleId ?? item.module?.id;
        if (!moduleId) throw new Error("Course item is missing its module reference.");
        return { type: "MODULE" as const, sortOrder: item.sortOrder, module: await buildModuleExportPayload(moduleId) };
      }),
  );

  // Module-only subset for backward-compatible v1 importers.
  const modulePayloads = itemPayloads
    .filter((p): p is Extract<typeof p, { type: "MODULE" }> => p.type === "MODULE")
    .map((p) => ({ sortOrder: p.sortOrder, module: p.module }));

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
        items: itemPayloads as never,
      },
    },
  };
}

// Inline a learning section's title + active-version markdown for export (#512).
// #749 (Layer A): also inline the section's figures/images (SectionAsset) as base64 so imported
// figures survive the round-trip. The markdown's `asset:<sourceId>` refs are left unchanged;
// import remaps them to the newly created asset ids. `assetBudget` accumulates decoded asset bytes
// across the whole envelope; the envelope-wide cap is enforced here so a figure is never dropped.
async function buildSectionExportPayload(
  sectionId: string,
  assetBudget?: { total: number },
): Promise<import("./adminContentSchemas.js").SectionExportPayload> {
  const { getSection } = await import("../course/sectionCommands.js");
  const { loadSectionAssetsForExport, MAX_EXPORT_ASSET_TOTAL_BYTES } = await import("../course/assetCommands.js");
  const section = await getSection(sectionId);
  if (!section) throw new Error("Section not found for export.");
  // #916: prefer the ACTIVE version, fall back to the newest one. Before the publish gate a section
  // was published the moment it was saved, so "active" was always present; now a section can
  // legitimately sit as a draft — in a course, or freshly imported — and reading only the active
  // version would export an empty body and silently lose the content the file is supposed to carry.
  // `audit.publishedAt` still reports the truth, so the destination knows it was not live.
  const sourceVersion = section.activeVersion ?? section.versions[0] ?? null;
  if (!sourceVersion) {
    throw new Error("Section has no versions to export.");
  }

  const { assets, totalBytes } = await loadSectionAssetsForExport(sectionId);
  if (assetBudget) {
    assetBudget.total += totalBytes;
    if (assetBudget.total > MAX_EXPORT_ASSET_TOTAL_BYTES) {
      throw new ValidationError(
        `Export exceeds the ${MAX_EXPORT_ASSET_TOTAL_BYTES}-byte total-asset cap ` +
          `(figures sum to ${assetBudget.total} bytes). Reduce or split the content before exporting.`,
      );
    }
  }

  return {
    title: (decodeLocalizedText(section.title) as never) ?? (section.title as never),
    bodyMarkdown: (sourceVersion?.bodyMarkdown
      ? decodeLocalizedText(sourceVersion.bodyMarkdown)
      : "") as never,
    audit: {
      // The source's publish state travels with the payload but never decides the destination's:
      // a standalone section import always lands unpublished (#916), and a course import runs the
      // imported section through the same gate as any other publish.
      publishedAt: sourceVersion?.publishedAt ? new Date(sourceVersion.publishedAt).toISOString() : null,
      publishedBy: null,
      publishedByEmail: null,
      sourceVersionNo: sourceVersion?.versionNo ?? null,
    },
    ...(assets.length > 0 ? { assets: assets as never } : {}),
  };
}

// Standalone section export envelope (#916). Same inner payload the course envelope already
// inlines — a section lifted out of a course file and one exported on its own are the same bytes —
// wrapped in the versioned envelope with `scope: "section"`. Assets travel inline as base64 under
// the same 25 MB cap as a course export.
export async function buildSectionExportEnvelope(
  sectionId: string,
  exportedBy: { userId?: string | null; email?: string | null },
): Promise<import("./adminContentSchemas.js").ExportEnvelope> {
  const assetBudget = { total: 0 };
  const section = await buildSectionExportPayload(sectionId, assetBudget);

  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy.userId ?? null,
    exportedByEmail: exportedBy.email ?? null,
    scope: "section",
    section,
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
  // #896 S6: which version to package. Default (undefined) keeps the historical rule — the live
  // version, falling back to the latest — which is what the module list and course export want:
  // a package of what participants actually get.
  //
  // The module WORKSPACE passes the version it is displaying. An author standing in Rediger
  // looking at an unpublished v2 and clicking "Export" got a file containing the published v1,
  // and their newest work silently did not travel.
  moduleVersionId?: string,
): Promise<import("./adminContentSchemas.js").ExportEnvelope> {
  const bundle = await getModuleContentBundle(moduleId);

  const requested = moduleVersionId
    ? bundle.versions.moduleVersions.find((v) => v.id === moduleVersionId)
    : undefined;
  if (moduleVersionId && !requested) {
    throw new Error("Requested module version not found on this module.");
  }

  const moduleVersion =
    requested
    ?? bundle.versions.moduleVersions.find((v) => v.id === bundle.module.activeVersionId)
    ?? bundle.versions.moduleVersions[0]
    ?? null;
  if (!moduleVersion) {
    throw new Error("Module has no versions to export.");
  }

  // #525/#547/#578: MCQ_ONLY modules have no rubric/prompt; FREETEXT_ONLY modules have no MCQ set.
  const isMcqOnly = moduleVersion.assessmentMode === "MCQ_ONLY";
  const isFreetextOnly = moduleVersion.assessmentMode === "FREETEXT_ONLY";

  const rubricVersion =
    bundle.versions.rubricVersions.find((v) => v.id === moduleVersion.rubricVersionId)
    ?? bundle.versions.rubricVersions[0]
    ?? null;
  if (!rubricVersion && !isMcqOnly) {
    throw new Error("Module has no rubric versions to export.");
  }

  const promptTemplateVersion =
    bundle.versions.promptTemplateVersions.find((v) => v.id === moduleVersion.promptTemplateVersionId)
    ?? bundle.versions.promptTemplateVersions[0]
    ?? null;
  if (!promptTemplateVersion && !isMcqOnly) {
    throw new Error("Module has no prompt-template versions to export.");
  }

  const mcqSetVersion =
    bundle.versions.mcqSetVersions.find((v) => v.id === moduleVersion.mcqSetVersionId)
    ?? bundle.versions.mcqSetVersions[0]
    ?? null;
  if (!mcqSetVersion && !isFreetextOnly) {
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
        assessmentMode: moduleVersion.assessmentMode as never,
        taskText: (moduleVersion.taskText ?? null) as never,
        assessorExpectedContent: (moduleVersion.assessorExpectedContent ?? null) as never,
        candidateTaskConstraints: (moduleVersion.candidateTaskConstraints ?? null) as never,
        assessmentBlueprint: null,
        submissionSchema: (moduleVersion.submissionSchema ?? null) as never,
        assessmentPolicy: (moduleVersion.assessmentPolicy ?? null) as never,
        rubric: rubricVersion
          ? {
              criteria: rubricVersion.criteria as Record<string, unknown>,
              scalingRule: rubricVersion.scalingRule as Record<string, unknown>,
              active: true,
            }
          : (null as never),
        promptTemplate: promptTemplateVersion
          ? {
              systemPrompt: promptTemplateVersion.systemPrompt as never,
              userPromptTemplate: promptTemplateVersion.userPromptTemplate as never,
              examples: (promptTemplateVersion.examples ?? []) as Array<Record<string, unknown>>,
              active: true,
            }
          : (null as never),
        // #578: FREETEXT_ONLY modules have no MCQ set — emit null.
        mcqSet: mcqSetVersion
          ? {
              title: mcqSetVersion.title as never,
              // #557: omit rationale entirely when absent instead of emitting `rationale: null`
              // (which the import schema rejected).
              questions: (mcqSetVersion.questions as Array<Record<string, unknown>>).map((q) => {
                if (q.rationale == null) {
                  const { rationale: _drop, ...rest } = q;
                  return rest;
                }
                return q;
              }) as never,
              active: true,
            }
          : (null as never),
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
