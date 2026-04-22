import { adminContentRepository, createAdminContentRepository } from "./adminContentRepository.js";
import { runInTransaction } from "../../db/transaction.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { getBenchmarkExamplesConfig } from "../../config/benchmarkExamples.js";
import { assessmentPolicyCodec, type ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";
import { localizedTextCodec, type LocalizedTextObject } from "../../codecs/localizedTextCodec.js";
import { NotFoundError } from "../../errors/AppError.js";

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
    createdById: input.actorId,
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: module.id,
    action: auditActions.adminContent.moduleCreated,
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

function normalizeLocalizedTitleSeed(title: string | null | undefined): LocalizedTextObject {
  const parsed = localizedTextCodec.parse(title);
  if (parsed && typeof parsed === "object") {
    return { ...parsed };
  }

  const fallback = typeof parsed === "string" ? parsed.trim() : "";
  if (!fallback) {
    return {};
  }

  return {
    "en-GB": fallback,
    nb: fallback,
    nn: fallback,
  };
}

export async function updateModuleTitle(moduleId: string, titlePatch: LocalizedTextObject, actorId: string) {
  const existingModule = await adminContentRepository.findModuleTitle(moduleId);
  if (!existingModule) {
    throw new NotFoundError("Module", "module_not_found", "Module not found.");
  }

  const title = localizedTextCodec.serialize({
    ...normalizeLocalizedTitleSeed(existingModule.title),
    ...titlePatch,
  });
  const module = await adminContentRepository.updateModuleTitle(moduleId, title);
  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleTitleUpdated,
    actorId,
    metadata: { moduleId, title },
  });
  return module;
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
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleDeleted,
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
    entityType: auditEntityTypes.promptTemplateVersion,
    entityId: promptTemplateVersion.id,
    action: auditActions.adminContent.benchmarkExampleVersionCreated,
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

export async function archiveModule(moduleId: string, actorId: string) {
  const module = await adminContentRepository.findModuleSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  if (module.activeVersionId) {
    throw new Error("Module must be unpublished before it can be archived.");
  }

  if (module.archivedAt) {
    throw new Error("Module is already archived.");
  }

  const result = await adminContentRepository.archiveModule(moduleId, new Date());

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleArchived,
    actorId,
    metadata: { moduleId },
  });

  return result;
}

export async function restoreModule(moduleId: string, actorId: string) {
  const module = await adminContentRepository.findModuleSummary(moduleId);

  if (!module) {
    throw new Error("Module not found.");
  }

  if (!module.archivedAt) {
    throw new Error("Module is not archived.");
  }

  const result = await adminContentRepository.restoreModule(moduleId);

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleRestored,
    actorId,
    metadata: { moduleId },
  });

  return result;
}

export async function unpublishModule(moduleId: string, actorId: string) {
  await ensureModuleExists(moduleId);
  const result = await adminContentRepository.unpublishModule(moduleId);

  await recordAuditEvent({
    entityType: auditEntityTypes.module,
    entityId: moduleId,
    action: auditActions.adminContent.moduleUnpublished,
    actorId,
    metadata: {
      moduleId,
      previousActiveVersionId: result.previousActiveVersionId,
    },
  });

  return result;
}

export async function publishModuleVersion(moduleId: string, moduleVersionId: string, actorId: string) {
  const module = await ensureModuleExists(moduleId);
  const now = new Date();

  const published = await runInTransaction((tx) =>
    createAdminContentRepository(tx).publishModuleVersion(moduleId, moduleVersionId, actorId, now),
  );

  await recordAuditEvent({
    entityType: auditEntityTypes.moduleVersion,
    entityId: moduleVersionId,
    action: auditActions.adminContent.moduleVersionPublished,
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
    },
  };

  const versionNo = await getNextVersionNo("module", input.moduleId);
  const now = new Date();

  const { newVersion, published } = await runInTransaction(async (tx) => {
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
    entityType: auditEntityTypes.moduleVersion,
    entityId: newVersion.id,
    action: auditActions.adminContent.calibrationThresholdsPublished,
    actorId: input.actorId,
    metadata: {
      moduleId: input.moduleId,
      moduleVersionId: newVersion.id,
      versionNo: newVersion.versionNo,
      sourceVersionId: sourceVersion.id,
      totalMin: input.totalMin,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    },
  });

  return published;
}
