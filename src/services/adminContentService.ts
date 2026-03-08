import { prisma } from "../db/prisma.js";
import { recordAuditEvent } from "./auditService.js";

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
