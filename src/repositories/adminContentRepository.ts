import { prisma } from "../db/prisma.js";

type AdminContentRepositoryClient = typeof prisma;

export function createAdminContentRepository(client: AdminContentRepositoryClient = prisma) {
  return {
    findModuleSummary(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, activeVersionId: true },
      });
    },

    createModule(data: {
      title: string;
      description?: string;
      certificationLevel?: string;
      validFrom?: Date;
      validTo?: Date;
    }) {
      return client.module.create({
        data,
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
    },

    findLatestRubricVersion(moduleId: string) {
      return client.rubricVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    findLatestPromptTemplateVersion(moduleId: string) {
      return client.promptTemplateVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    findLatestMcqSetVersion(moduleId: string) {
      return client.mCQSetVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    findLatestModuleVersion(moduleId: string) {
      return client.moduleVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
    },

    createRubricVersion(data: {
      moduleId: string;
      versionNo: number;
      criteriaJson: string;
      scalingRuleJson: string;
      passRuleJson: string;
      active: boolean;
    }) {
      return client.rubricVersion.create({
        data,
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          active: true,
          createdAt: true,
        },
      });
    },

    createPromptTemplateVersion(data: {
      moduleId: string;
      versionNo: number;
      systemPrompt: string;
      userPromptTemplate: string;
      examplesJson: string;
      active: boolean;
    }) {
      return client.promptTemplateVersion.create({
        data,
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          active: true,
          createdAt: true,
        },
      });
    },

    createMcqSetVersion(data: {
      moduleId: string;
      versionNo: number;
      title: string;
      active: boolean;
      questions: Array<{
        moduleId: string;
        stem: string;
        optionsJson: string;
        correctAnswer: string;
        rationale?: string;
        active: boolean;
      }>;
    }) {
      return client.mCQSetVersion.create({
        data: {
          moduleId: data.moduleId,
          versionNo: data.versionNo,
          title: data.title,
          active: data.active,
          questions: {
            create: data.questions,
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
    },

    findVersionDependencies(input: {
      rubricVersionId: string;
      promptTemplateVersionId: string;
      mcqSetVersionId: string;
    }) {
      return Promise.all([
        client.rubricVersion.findUnique({
          where: { id: input.rubricVersionId },
          select: { id: true, moduleId: true },
        }),
        client.promptTemplateVersion.findUnique({
          where: { id: input.promptTemplateVersionId },
          select: { id: true, moduleId: true },
        }),
        client.mCQSetVersion.findUnique({
          where: { id: input.mcqSetVersionId },
          select: { id: true, moduleId: true },
        }),
      ]);
    },

    createModuleVersion(data: {
      moduleId: string;
      versionNo: number;
      taskText: string;
      guidanceText?: string;
      rubricVersionId: string;
      promptTemplateVersionId: string;
      mcqSetVersionId: string;
    }) {
      return client.moduleVersion.create({
        data,
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
    },

    findPromptTemplateSummary(promptTemplateVersionId: string) {
      return client.promptTemplateVersion.findUnique({
        where: { id: promptTemplateVersionId },
        select: {
          id: true,
          moduleId: true,
          systemPrompt: true,
          userPromptTemplate: true,
        },
      });
    },

    findModuleVersionSummary(moduleVersionId: string) {
      return client.moduleVersion.findUnique({
        where: { id: moduleVersionId },
        select: { id: true, moduleId: true },
      });
    },

    publishModuleVersion(moduleId: string, moduleVersionId: string, actorId: string, now: Date) {
      return client.$transaction(async (tx) => {
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
    },
  };
}

export const adminContentRepository = createAdminContentRepository();
