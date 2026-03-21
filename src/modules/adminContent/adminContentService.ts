import { adminContentRepository, createAdminContentRepository } from "./adminContentRepository.js";
import { prisma } from "../../db/prisma.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { getBenchmarkExamplesConfig } from "../../config/benchmarkExamples.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import { assessmentPolicyCodec, type ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";
import { localizedTextCodec } from "../../codecs/localizedTextCodec.js";

type CreateRubricVersionInput = {
  moduleId: string;
  criteria: Record<string, unknown>;
  scalingRule: Record<string, unknown>;
  passRule: Record<string, unknown>;
  active: boolean;
};

type CreatePromptTemplateVersionInput = {
  moduleId: string;
  systemPrompt: string;
  userPromptTemplate: string;
  examples: Array<Record<string, unknown>>;
  active?: boolean;
};

type CreateMcqSetVersionInput = {
  moduleId: string;
  title: string;
  active?: boolean;
  questions: Array<{
    stem: string;
    options: string[];
    correctAnswer: string;
    rationale?: string;
  }>;
};

type CreateModuleVersionInput = {
  moduleId: string;
  taskText: string;
  guidanceText?: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqSetVersionId: string;
  submissionSchemaJson?: string;
  assessmentPolicyJson?: string;
};

type CreateModuleInput = {
  title: string;
  description?: string;
  certificationLevel?: string;
  validFrom?: Date;
  validTo?: Date;
  actorId?: string;
};

type CreateBenchmarkExampleVersionInput = {
  moduleId: string;
  basePromptTemplateVersionId: string;
  linkedModuleVersionId?: string;
  examples: Array<Record<string, unknown>>;
  active: boolean;
  actorId?: string;
};

function decodeLocalizedText(input: string | null | undefined) {
  return localizedTextCodec.parse(input);
}

function safeParseJson(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function decodeMcqOption(option: unknown) {
  if (typeof option === "string") {
    return decodeLocalizedText(option) ?? option;
  }

  return option;
}

function mapMcqSetVersion(version: {
  id: string;
  versionNo: number;
  title: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  questions: Array<{
    id: string;
    stem: string;
    optionsJson: string;
    correctAnswer: string;
    rationale: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: version.id,
    versionNo: version.versionNo,
    title: decodeLocalizedText(version.title) ?? version.title,
    active: version.active,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    questions: version.questions.map((question) => {
      const parsedOptions = safeParseJson(question.optionsJson);
      return {
        id: question.id,
        stem: decodeLocalizedText(question.stem) ?? question.stem,
        options: Array.isArray(parsedOptions) ? parsedOptions.map((option) => decodeMcqOption(option)) : [],
        correctAnswer: decodeLocalizedText(question.correctAnswer) ?? question.correctAnswer,
        rationale: decodeLocalizedText(question.rationale) ?? question.rationale,
        active: question.active,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
      };
    }),
  };
}

async function ensureModuleExists(moduleId: string) {
  const module = await adminContentRepository.findModuleSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  return module;
}

export async function createModule(input: CreateModuleInput) {
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    throw new Error("validTo must be on or after validFrom.");
  }

  const module = await adminContentRepository.createModule({
    title: input.title,
    description: input.description,
    certificationLevel: input.certificationLevel,
    validFrom: input.validFrom,
    validTo: input.validTo,
  });

  await recordAuditEvent({
    entityType: "module",
    entityId: module.id,
    action: "module_created",
    actorId: input.actorId,
    metadata: {
      moduleId: module.id,
      title: module.title,
      certificationLevel: module.certificationLevel ?? null,
      validFrom: module.validFrom?.toISOString() ?? null,
      validTo: module.validTo?.toISOString() ?? null,
    },
  });

  return module;
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

export async function deleteModule(moduleId: string, actorId: string) {
  const module = await adminContentRepository.findModuleDeleteSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  const dependencyChecks = [
    ["module versions", module._count.versions],
    ["rubric versions", module._count.rubricVersions],
    ["prompt template versions", module._count.promptTemplateVersions],
    ["MCQ set versions", module._count.mcqSetVersions],
    ["submissions", module._count.submissions],
    ["certification statuses", module._count.certificationStatuses],
  ].filter(([, count]) => typeof count === "number" && count > 0);

  if (module.activeVersionId || dependencyChecks.length > 0) {
    const dependencySummary = [
      module.activeVersionId ? "active published version" : null,
      ...dependencyChecks.map(([label, count]) => `${count} ${label}`),
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Module cannot be deleted because it still has dependencies: ${dependencySummary}.`);
  }

  const deletedModule = await adminContentRepository.deleteModule(moduleId);

  await recordAuditEvent({
    entityType: "module",
    entityId: moduleId,
    action: "module_deleted",
    actorId,
    metadata: {
      moduleId,
      title: deletedModule.title,
    },
  });

  return deletedModule;
}

async function getNextVersionNo(model: "rubric" | "prompt" | "mcq" | "module", moduleId: string) {
  if (model === "rubric") {
    const latest = await adminContentRepository.findLatestRubricVersion(moduleId);
    return (latest?.versionNo ?? 0) + 1;
  }

  if (model === "prompt") {
    const latest = await adminContentRepository.findLatestPromptTemplateVersion(moduleId);
    return (latest?.versionNo ?? 0) + 1;
  }

  if (model === "mcq") {
    const latest = await adminContentRepository.findLatestMcqSetVersion(moduleId);
    return (latest?.versionNo ?? 0) + 1;
  }

  const latest = await adminContentRepository.findLatestModuleVersion(moduleId);
  return (latest?.versionNo ?? 0) + 1;
}

export async function createRubricVersion(input: CreateRubricVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("rubric", input.moduleId);

  return adminContentRepository.createRubricVersion({
    moduleId: input.moduleId,
    versionNo,
    criteriaJson: JSON.stringify(input.criteria),
    scalingRuleJson: JSON.stringify(input.scalingRule),
    passRuleJson: JSON.stringify(input.passRule),
    active: input.active,
  });
}

export async function createPromptTemplateVersion(input: CreatePromptTemplateVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("prompt", input.moduleId);

  return adminContentRepository.createPromptTemplateVersion({
    moduleId: input.moduleId,
    versionNo,
    systemPrompt: input.systemPrompt,
    userPromptTemplate: input.userPromptTemplate,
    examplesJson: JSON.stringify(input.examples),
    active: input.active ?? true,
  });
}

export async function createMcqSetVersion(input: CreateMcqSetVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("mcq", input.moduleId);

  return adminContentRepository.createMcqSetVersion({
    moduleId: input.moduleId,
    versionNo,
    title: input.title,
    active: input.active ?? true,
    questions: input.questions.map((question) => ({
      moduleId: input.moduleId,
      stem: question.stem,
      optionsJson: JSON.stringify(question.options),
      correctAnswer: question.correctAnswer,
      rationale: question.rationale,
      active: true,
    })),
  });
}

export async function createModuleVersion(input: CreateModuleVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("module", input.moduleId);

  const [rubric, promptTemplate, mcqSet] = await adminContentRepository.findVersionDependencies({
    rubricVersionId: input.rubricVersionId,
    promptTemplateVersionId: input.promptTemplateVersionId,
    mcqSetVersionId: input.mcqSetVersionId,
  });

  if (!rubric || rubric.moduleId !== input.moduleId) {
    throw new Error("Rubric version is missing or belongs to another module.");
  }

  if (!promptTemplate || promptTemplate.moduleId !== input.moduleId) {
    throw new Error("Prompt template version is missing or belongs to another module.");
  }

  if (!mcqSet || mcqSet.moduleId !== input.moduleId) {
    throw new Error("MCQ set version is missing or belongs to another module.");
  }

  return adminContentRepository.createModuleVersion({
    moduleId: input.moduleId,
    versionNo,
    taskText: input.taskText,
    guidanceText: input.guidanceText,
    rubricVersionId: input.rubricVersionId,
    promptTemplateVersionId: input.promptTemplateVersionId,
    mcqSetVersionId: input.mcqSetVersionId,
    submissionSchemaJson: input.submissionSchemaJson,
    assessmentPolicyJson: input.assessmentPolicyJson,
  });
}

export async function createBenchmarkExampleVersion(input: CreateBenchmarkExampleVersionInput) {
  await ensureModuleExists(input.moduleId);
  const benchmarkConfig = getBenchmarkExamplesConfig();

  const basePromptTemplate = await adminContentRepository.findPromptTemplateSummary(input.basePromptTemplateVersionId);

  if (!basePromptTemplate || basePromptTemplate.moduleId !== input.moduleId) {
    throw new Error("Base prompt template version is missing or belongs to another module.");
  }

  if (input.linkedModuleVersionId) {
    const linkedModuleVersion = await adminContentRepository.findModuleVersionSummary(input.linkedModuleVersionId);

    if (!linkedModuleVersion || linkedModuleVersion.moduleId !== input.moduleId) {
      throw new Error("Linked module version is missing or belongs to another module.");
    }
  }

  if (input.examples.length === 0) {
    throw new Error("At least one benchmark example is required.");
  }

  if (input.examples.length > benchmarkConfig.maxExamplesPerVersion) {
    throw new Error(
      `Benchmark example count exceeds maxExamplesPerVersion (${benchmarkConfig.maxExamplesPerVersion}).`,
    );
  }

  for (const [index, example] of input.examples.entries()) {
    for (const requiredField of benchmarkConfig.requiredFields) {
      if (!(requiredField in example)) {
        throw new Error(`Benchmark example at index ${index} is missing required field '${requiredField}'.`);
      }
      const value = example[requiredField];
      if (typeof value === "string" && value.length > benchmarkConfig.maxTextLength) {
        throw new Error(
          `Benchmark example field '${requiredField}' at index ${index} exceeds maxTextLength (${benchmarkConfig.maxTextLength}).`,
        );
      }
    }
  }

  const versionNo = await getNextVersionNo("prompt", input.moduleId);
  const enrichedExamples = input.examples.map((example, index) => ({
    ...example,
    benchmarkExampleIndex: index + 1,
    sourcePromptTemplateVersionId: input.basePromptTemplateVersionId,
    sourceModuleVersionId: input.linkedModuleVersionId ?? null,
    benchmarkVersionNo: versionNo,
  }));

  const promptTemplateVersion = await adminContentRepository.createPromptTemplateVersion({
    moduleId: input.moduleId,
    versionNo,
    systemPrompt: basePromptTemplate.systemPrompt,
    userPromptTemplate: basePromptTemplate.userPromptTemplate,
    examplesJson: JSON.stringify(enrichedExamples),
    active: input.active,
  });

  await recordAuditEvent({
    entityType: "prompt_template_version",
    entityId: promptTemplateVersion.id,
    action: "benchmark_example_version_created",
    actorId: input.actorId,
    metadata: {
      moduleId: input.moduleId,
      promptTemplateVersionId: promptTemplateVersion.id,
      sourcePromptTemplateVersionId: input.basePromptTemplateVersionId,
      sourceModuleVersionId: input.linkedModuleVersionId ?? null,
      benchmarkExampleCount: input.examples.length,
      versionNo: promptTemplateVersion.versionNo,
    },
  });

  return {
    ...promptTemplateVersion,
    sourcePromptTemplateVersionId: input.basePromptTemplateVersionId,
    sourceModuleVersionId: input.linkedModuleVersionId ?? null,
    benchmarkExampleCount: input.examples.length,
  };
}

export async function publishModuleVersion(moduleId: string, moduleVersionId: string, actorId: string) {
  const module = await ensureModuleExists(moduleId);
  const now = new Date();

  const published = await prisma.$transaction((tx) =>
    createAdminContentRepository(tx).publishModuleVersion(moduleId, moduleVersionId, actorId, now),
  );

  await recordAuditEvent({
    entityType: "module_version",
    entityId: moduleVersionId,
    action: "module_version_published",
    actorId,
    metadata: {
      moduleId,
      moduleVersionId,
      versionNo: published.versionNo,
      previousActiveVersionId: module.activeVersionId,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    },
  });

  return published;
}

type PublishThresholdsInput = {
  moduleId: string;
  totalMin: number;
  practicalMinPercent: number;
  mcqMinPercent: number;
  borderlineMin: number;
  borderlineMax: number;
  actorId: string;
};

export async function publishModuleVersionWithThresholds(input: PublishThresholdsInput) {
  const module = await ensureModuleExists(input.moduleId);

  if (!module.activeVersionId) {
    throw new Error("Module has no active version to base thresholds on.");
  }

  const sourceVersion = await adminContentRepository.findActiveModuleVersionForClone(module.activeVersionId);

  if (!sourceVersion) {
    throw new Error("Active module version not found.");
  }

  const existingPolicy: ModuleAssessmentPolicy = assessmentPolicyCodec.parse(sourceVersion.assessmentPolicyJson) ?? {};

  const newPolicy: ModuleAssessmentPolicy = {
    ...existingPolicy,
    passRules: {
      ...(existingPolicy.passRules ?? {}),
      totalMin: input.totalMin,
      practicalMinPercent: input.practicalMinPercent,
      mcqMinPercent: input.mcqMinPercent,
      borderlineWindow: {
        min: input.borderlineMin,
        max: input.borderlineMax,
      },
    },
  };

  const versionNo = await getNextVersionNo("module", input.moduleId);
  const now = new Date();

  const { newVersion, published } = await prisma.$transaction(async (tx) => {
    const repo = createAdminContentRepository(tx);
    const newVersion = await repo.createModuleVersion({
      moduleId: input.moduleId,
      versionNo,
      taskText: sourceVersion.taskText,
      guidanceText: sourceVersion.guidanceText ?? undefined,
      rubricVersionId: sourceVersion.rubricVersionId,
      promptTemplateVersionId: sourceVersion.promptTemplateVersionId,
      mcqSetVersionId: sourceVersion.mcqSetVersionId,
      submissionSchemaJson: sourceVersion.submissionSchemaJson ?? undefined,
      assessmentPolicyJson: assessmentPolicyCodec.serialize(newPolicy),
    });
    const published = await repo.publishModuleVersion(input.moduleId, newVersion.id, input.actorId, now);
    return { newVersion, published };
  });

  await recordAuditEvent({
    entityType: "module_version",
    entityId: newVersion.id,
    action: "calibration_thresholds_published",
    actorId: input.actorId,
    metadata: {
      moduleId: input.moduleId,
      moduleVersionId: newVersion.id,
      versionNo: newVersion.versionNo,
      sourceVersionId: sourceVersion.id,
      totalMin: input.totalMin,
      practicalMinPercent: input.practicalMinPercent,
      mcqMinPercent: input.mcqMinPercent,
      borderlineMin: input.borderlineMin,
      borderlineMax: input.borderlineMax,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    },
  });

  return published;
}
