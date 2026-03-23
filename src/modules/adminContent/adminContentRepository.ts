import { prisma } from "../../db/prisma.js";

type AdminContentRepositoryClient = Pick<typeof prisma, "module" | "moduleVersion" | "rubricVersion" | "promptTemplateVersion" | "mCQSetVersion">;

export function createAdminContentRepository(client: AdminContentRepositoryClient = prisma) {
  return {
    listModuleSummaries() {
      return client.module.findMany({
        orderBy: { title: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          activeVersion: {
            select: {
              id: true,
              versionNo: true,
            },
          },
        },
      });
    },

    findModuleSummary(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, activeVersionId: true },
      });
    },

    findModuleDeleteSummary(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: {
          id: true,
          title: true,
          activeVersionId: true,
          _count: {
            select: {
              versions: true,
              submissions: true,
              mcqSetVersions: true,
              certificationStatuses: true,
              rubricVersions: true,
              promptTemplateVersions: true,
            },
          },
        },
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

    deleteModule(moduleId: string) {
      return client.module.delete({
        where: { id: moduleId },
        select: {
          id: true,
          title: true,
        },
      });
    },

    findModuleContentBundle(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: {
          id: true,
          title: true,
          description: true,
          certificationLevel: true,
          validFrom: true,
          validTo: true,
          activeVersionId: true,
          createdAt: true,
          updatedAt: true,
          versions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              taskText: true,
              guidanceText: true,
              submissionSchemaJson: true,
              assessmentPolicyJson: true,
              rubricVersionId: true,
              promptTemplateVersionId: true,
              mcqSetVersionId: true,
              publishedBy: true,
              publishedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          rubricVersions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              criteriaJson: true,
              scalingRuleJson: true,
              passRuleJson: true,
              active: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          promptTemplateVersions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              systemPrompt: true,
              userPromptTemplate: true,
              examplesJson: true,
              active: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          mcqSetVersions: {
            orderBy: { versionNo: "desc" },
            select: {
              id: true,
              versionNo: true,
              title: true,
              active: true,
              createdAt: true,
              updatedAt: true,
              questions: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  stem: true,
                  optionsJson: true,
                  correctAnswer: true,
                  rationale: true,
                  active: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
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
      submissionSchemaJson?: string;
      assessmentPolicyJson?: string;
    }) {
      return client.moduleVersion.create({
        data,
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          taskText: true,
          guidanceText: true,
          submissionSchemaJson: true,
          assessmentPolicyJson: true,
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

    findActiveModuleVersionForClone(moduleVersionId: string) {
      return client.moduleVersion.findUnique({
        where: { id: moduleVersionId },
        select: {
          id: true,
          moduleId: true,
          taskText: true,
          guidanceText: true,
          rubricVersionId: true,
          promptTemplateVersionId: true,
          mcqSetVersionId: true,
          submissionSchemaJson: true,
          assessmentPolicyJson: true,
        },
      });
    },

    async unpublishModule(moduleId: string) {
      const module = await client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, activeVersionId: true },
      });

      if (!module) {
        throw new Error("Module not found.");
      }

      if (!module.activeVersionId) {
        throw new Error("Module has no active version to unpublish.");
      }

      const previousActiveVersionId = module.activeVersionId;

      await client.module.update({
        where: { id: moduleId },
        data: { activeVersionId: null },
      });

      return { moduleId, previousActiveVersionId };
    },

    async publishModuleVersion(moduleId: string, moduleVersionId: string, actorId: string, now: Date) {
      const moduleVersion = await client.moduleVersion.findUnique({
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

      const publishedVersion = await client.moduleVersion.update({
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

      await client.module.update({
        where: { id: moduleId },
        data: { activeVersionId: moduleVersionId },
      });

      return publishedVersion;
    },
  };
}

export const adminContentRepository = createAdminContentRepository();
