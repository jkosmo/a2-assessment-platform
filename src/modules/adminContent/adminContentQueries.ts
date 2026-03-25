import { adminContentRepository } from "./adminContentRepository.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { decodeLocalizedText, safeParseJson, mapMcqSetVersion } from "./adminContentProjections.js";

export async function listArchivedModules(locale: SupportedLocale = "en-GB", search?: string) {
  const modules = await adminContentRepository.listArchivedModuleSummaries(search);

  return modules.map((module) => ({
    id: module.id,
    title: localizeContentText(locale, module.title) ?? module.title,
    description: localizeContentText(locale, module.description),
    certificationLevel: module.certificationLevel,
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
    guidanceText: decodeLocalizedText(version.guidanceText) ?? version.guidanceText,
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
