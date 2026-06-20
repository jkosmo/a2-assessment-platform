import { prisma } from "../../db/prisma.js";
import type { AssessmentMode } from "@prisma/client";

type AdminContentRepositoryClient = Pick<typeof prisma, "module" | "moduleVersion" | "rubricVersion" | "promptTemplateVersion" | "mCQSetVersion" | "courseModule">;

export function createAdminContentRepository(client: AdminContentRepositoryClient = prisma) {
  return {
    listModuleSummaries() {
      return client.module.findMany({
        where: { archivedAt: null },
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

    listLibraryModules() {
      return client.module.findMany({
        orderBy: { title: "asc" },
        select: {
          id: true,
          title: true,
          certificationLevel: true,
          archivedAt: true,
          updatedAt: true,
          activeVersionId: true,
          activeVersion: {
            select: { id: true, versionNo: true },
          },
          versions: {
            orderBy: { versionNo: "desc" },
            take: 1,
            select: { id: true, versionNo: true, publishedAt: true },
          },
          _count: {
            select: { courseModules: true },
          },
          courseModules: {
            select: {
              course: {
                select: { id: true, title: true },
              },
            },
          },
        },
      });
    },

    listArchivedModuleSummaries(search?: string) {
      return client.module.findMany({
        where: {
          archivedAt: { not: null },
          ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
        },
        orderBy: { archivedAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          certificationLevel: true,
          archivedAt: true,
        },
      });
    },

    findModuleSummary(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, activeVersionId: true, archivedAt: true },
      });
    },

    archiveModule(moduleId: string, now: Date) {
      return client.module.update({
        where: { id: moduleId },
        data: { archivedAt: now },
        select: { id: true, title: true, archivedAt: true },
      });
    },

    restoreModule(moduleId: string) {
      return client.module.update({
        where: { id: moduleId },
        data: { archivedAt: null },
        select: { id: true, title: true },
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
      createdById?: string;
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

    findModuleOwner(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, createdById: true },
      });
    },

    findModuleTitle(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: { id: true, title: true },
      });
    },

    async countModuleCourses(moduleId: string) {
      return client.courseModule.count({ where: { moduleId } });
    },

    updateModuleTitle(moduleId: string, title: string) {
      return client.module.update({
        where: { id: moduleId },
        data: { title },
        select: { id: true, title: true },
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

    // v1.2.11: list purge candidates — moduler som aldri har vært publisert nå (activeVersionId
    // null), ikke arkivert, ingen submissions, ikke i noe kurs. Returnerer både id og title
    // pluss avhengighet-tellinger så caller kan vise en preview-liste til brukeren før purge.
    listPurgeCandidates() {
      return client.module.findMany({
        where: {
          activeVersionId: null,
          archivedAt: null,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          updatedAt: true,
          _count: {
            select: {
              submissions: true,
              courseModules: true,
              versions: true,
              rubricVersions: true,
              promptTemplateVersions: true,
              mcqSetVersions: true,
              mcqQuestions: true,
              certificationStatuses: true,
            },
          },
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
              assessorExpectedContent: true,
              candidateTaskConstraints: true,
              assessmentBlueprint: true,
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

    // Returns the most recently created RubricVersion for the module, regardless of `active` flag.
    // Used by the ensure-rubric flow to decide whether auto-generation is needed (#447). Any
    // existing rubric — generic default or task-specific — skips the LLM call.
    findActiveRubricVersionForModule(moduleId: string) {
      return client.rubricVersion.findFirst({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          criteriaJson: true,
          scalingRuleJson: true,
          active: true,
          createdAt: true,
        },
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

    // B3 (#450): patch scalingRule on an existing RubricVersion without bumping versionNo.
    // Used by "Behold kriteriene"-handling — flips the stored blueprint-hash so drift-banner
    // hides, but leaves criteria untouched.
    updateRubricVersionScalingRule(id: string, scalingRuleJson: string) {
      return client.rubricVersion.update({
        where: { id },
        data: { scalingRuleJson },
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

    // #525: MCQ_ONLY module versions only depend on an MCQ set (no rubric/prompt).
    findMcqSetSummary(mcqSetVersionId: string) {
      return client.mCQSetVersion.findUnique({
        where: { id: mcqSetVersionId },
        select: { id: true, moduleId: true },
      });
    },

    createModuleVersion(data: {
      moduleId: string;
      versionNo: number;
      // taskText / rubricVersionId / promptTemplateVersionId are null for MCQ_ONLY modules (#525).
      taskText?: string | null;
      assessorExpectedContent?: string | null;
      candidateTaskConstraints?: string | null;
      assessmentBlueprint?: string | null;
      rubricVersionId?: string | null;
      promptTemplateVersionId?: string | null;
      mcqSetVersionId: string;
      assessmentMode?: AssessmentMode;
      submissionSchemaJson?: string | null;
      assessmentPolicyJson?: string | null;
    }) {
      return client.moduleVersion.create({
        data,
        select: {
          id: true,
          moduleId: true,
          versionNo: true,
          taskText: true,
          assessorExpectedContent: true,
          candidateTaskConstraints: true,
          assessmentBlueprint: true,
          submissionSchemaJson: true,
          assessmentPolicyJson: true,
          rubricVersionId: true,
          promptTemplateVersionId: true,
          mcqSetVersionId: true,
          assessmentMode: true,
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
          assessorExpectedContent: true,
          candidateTaskConstraints: true,
          assessmentBlueprint: true,
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
