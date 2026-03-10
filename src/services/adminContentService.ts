import { prisma } from "../db/prisma.js";
import { recordAuditEvent } from "./auditService.js";
import { getBenchmarkExamplesConfig } from "../config/benchmarkExamples.js";

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
  active: boolean;
};

type CreateMcqSetVersionInput = {
  moduleId: string;
  title: string;
  active: boolean;
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
  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, activeVersionId: true },
  });

  if (!module) {
    throw new Error("Module not found.");
  }

  return module;
}

export async function createModule(input: CreateModuleInput) {
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    throw new Error("validTo must be on or after validFrom.");
  }

  const module = await prisma.module.create({
    data: {
      title: input.title,
      description: input.description,
      certificationLevel: input.certificationLevel,
      validFrom: input.validFrom,
      validTo: input.validTo,
    },
    select: {
      id: true,
      title: true,
      description: true,
      certificationLevel: true,
      validFrom: true,
      validTo: true,
      createdAt: true,
    },
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

async function getNextVersionNo(model: "rubric" | "prompt" | "mcq" | "module", moduleId: string) {
  if (model === "rubric") {
    const latest = await prisma.rubricVersion.findFirst({
      where: { moduleId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    return (latest?.versionNo ?? 0) + 1;
  }

  if (model === "prompt") {
    const latest = await prisma.promptTemplateVersion.findFirst({
      where: { moduleId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    return (latest?.versionNo ?? 0) + 1;
  }

  if (model === "mcq") {
    const latest = await prisma.mCQSetVersion.findFirst({
      where: { moduleId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    return (latest?.versionNo ?? 0) + 1;
  }

  const latest = await prisma.moduleVersion.findFirst({
    where: { moduleId },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true },
  });
  return (latest?.versionNo ?? 0) + 1;
}

export async function createRubricVersion(input: CreateRubricVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("rubric", input.moduleId);

  return prisma.rubricVersion.create({
    data: {
      moduleId: input.moduleId,
      versionNo,
      criteriaJson: JSON.stringify(input.criteria),
      scalingRuleJson: JSON.stringify(input.scalingRule),
      passRuleJson: JSON.stringify(input.passRule),
      active: input.active,
    },
    select: {
      id: true,
      moduleId: true,
      versionNo: true,
      active: true,
      createdAt: true,
    },
  });
}

export async function createPromptTemplateVersion(input: CreatePromptTemplateVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("prompt", input.moduleId);

  return prisma.promptTemplateVersion.create({
    data: {
      moduleId: input.moduleId,
      versionNo,
      systemPrompt: input.systemPrompt,
      userPromptTemplate: input.userPromptTemplate,
      examplesJson: JSON.stringify(input.examples),
      active: input.active,
    },
    select: {
      id: true,
      moduleId: true,
      versionNo: true,
      active: true,
      createdAt: true,
    },
  });
}

export async function createMcqSetVersion(input: CreateMcqSetVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("mcq", input.moduleId);

  return prisma.mCQSetVersion.create({
    data: {
      moduleId: input.moduleId,
      versionNo,
      title: input.title,
      active: input.active,
      questions: {
        create: input.questions.map((question) => ({
          moduleId: input.moduleId,
          stem: question.stem,
          optionsJson: JSON.stringify(question.options),
          correctAnswer: question.correctAnswer,
          rationale: question.rationale,
          active: true,
        })),
      },
    },
    select: {
      id: true,
      moduleId: true,
      versionNo: true,
      title: true,
      active: true,
      createdAt: true,
      questions: {
        select: {
          id: true,
          stem: true,
          correctAnswer: true,
          active: true,
        },
      },
    },
  });
}

export async function createModuleVersion(input: CreateModuleVersionInput) {
  await ensureModuleExists(input.moduleId);
  const versionNo = await getNextVersionNo("module", input.moduleId);

  const [rubric, promptTemplate, mcqSet] = await Promise.all([
    prisma.rubricVersion.findUnique({
      where: { id: input.rubricVersionId },
      select: { id: true, moduleId: true },
    }),
    prisma.promptTemplateVersion.findUnique({
      where: { id: input.promptTemplateVersionId },
      select: { id: true, moduleId: true },
    }),
    prisma.mCQSetVersion.findUnique({
      where: { id: input.mcqSetVersionId },
      select: { id: true, moduleId: true },
    }),
  ]);

  if (!rubric || rubric.moduleId !== input.moduleId) {
    throw new Error("Rubric version is missing or belongs to another module.");
  }

  if (!promptTemplate || promptTemplate.moduleId !== input.moduleId) {
    throw new Error("Prompt template version is missing or belongs to another module.");
  }

  if (!mcqSet || mcqSet.moduleId !== input.moduleId) {
    throw new Error("MCQ set version is missing or belongs to another module.");
  }

  return prisma.moduleVersion.create({
    data: {
      moduleId: input.moduleId,
      versionNo,
      taskText: input.taskText,
      guidanceText: input.guidanceText,
      rubricVersionId: input.rubricVersionId,
      promptTemplateVersionId: input.promptTemplateVersionId,
      mcqSetVersionId: input.mcqSetVersionId,
    },
    select: {
      id: true,
      moduleId: true,
      versionNo: true,
      taskText: true,
      guidanceText: true,
      rubricVersionId: true,
      promptTemplateVersionId: true,
      mcqSetVersionId: true,
      publishedBy: true,
      publishedAt: true,
      createdAt: true,
    },
  });
}

export async function createBenchmarkExampleVersion(input: CreateBenchmarkExampleVersionInput) {
  await ensureModuleExists(input.moduleId);
  const benchmarkConfig = getBenchmarkExamplesConfig();

  const basePromptTemplate = await prisma.promptTemplateVersion.findUnique({
    where: { id: input.basePromptTemplateVersionId },
    select: {
      id: true,
      moduleId: true,
      systemPrompt: true,
      userPromptTemplate: true,
    },
  });

  if (!basePromptTemplate || basePromptTemplate.moduleId !== input.moduleId) {
    throw new Error("Base prompt template version is missing or belongs to another module.");
  }

  if (input.linkedModuleVersionId) {
    const linkedModuleVersion = await prisma.moduleVersion.findUnique({
      where: { id: input.linkedModuleVersionId },
      select: { id: true, moduleId: true },
    });

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

  const promptTemplateVersion = await prisma.promptTemplateVersion.create({
    data: {
      moduleId: input.moduleId,
      versionNo,
      systemPrompt: basePromptTemplate.systemPrompt,
      userPromptTemplate: basePromptTemplate.userPromptTemplate,
      examplesJson: JSON.stringify(enrichedExamples),
      active: input.active,
    },
    select: {
      id: true,
      moduleId: true,
      versionNo: true,
      active: true,
      createdAt: true,
    },
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

  const published = await prisma.$transaction(async (tx) => {
    const moduleVersion = await tx.moduleVersion.findUnique({
      where: { id: moduleVersionId },
      select: {
        id: true,
        moduleId: true,
        versionNo: true,
        publishedAt: true,
        publishedBy: true,
      },
    });

    if (!moduleVersion || moduleVersion.moduleId !== moduleId) {
      throw new Error("Module version not found for module.");
    }

    const publishedVersion = await tx.moduleVersion.update({
      where: { id: moduleVersionId },
      data: moduleVersion.publishedAt
        ? {}
        : {
            publishedAt: now,
            publishedBy: actorId,
          },
      select: {
        id: true,
        moduleId: true,
        versionNo: true,
        publishedAt: true,
        publishedBy: true,
      },
    });

    await tx.module.update({
      where: { id: moduleId },
      data: { activeVersionId: moduleVersionId },
    });

    return publishedVersion;
  });

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
