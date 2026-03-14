import type {
  AppRole as AppRoleType,
  Prisma,
  SubmissionStatus as SubmissionStatusType,
  DecisionType as DecisionTypeType,
} from "@prisma/client";
import { AppRole } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import type { SupportedLocale } from "../i18n/locale.js";
import { localizeContentText } from "../i18n/content.js";
import {
  getCompletedSubmissionStatuses,
  isSubmissionStatusCompleted,
} from "../services/moduleCompletionPolicyService.js";

const ADMIN_READ_ROLES: AppRoleType[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
  AppRole.REVIEWER,
  AppRole.APPEAL_HANDLER,
  AppRole.REPORT_READER,
];

function hasAdminRead(roles: AppRoleType[]) {
  return roles.some((role) => ADMIN_READ_ROLES.includes(role));
}

const moduleSummarySelect = {
  id: true,
  title: true,
  description: true,
  certificationLevel: true,
  validFrom: true,
  validTo: true,
  activeVersion: {
    select: {
      id: true,
      versionNo: true,
      taskText: true,
      guidanceText: true,
      publishedAt: true,
      rubricVersionId: true,
      promptTemplateVersionId: true,
      mcqSetVersionId: true,
    },
  },
} satisfies Prisma.ModuleSelect;

type ListModulesOptions = {
  includeCompleted?: boolean;
  participantFacing?: boolean;
};

export async function listModules(
  roles: AppRoleType[],
  userId?: string,
  locale: SupportedLocale = "en-GB",
  options: ListModulesOptions = {},
) {
  const now = new Date();
  const adminRead = options.participantFacing ? false : hasAdminRead(roles);

  const modules = await prisma.module.findMany({
    where: adminRead
      ? {}
      : {
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validTo: null }, { validTo: { gte: now } }] },
            { activeVersion: { is: { publishedAt: { not: null } } } },
          ],
        },
    select: moduleSummarySelect,
    orderBy: { title: "asc" },
  });

  if (!userId) {
    return modules.map((module) => ({
      ...module,
      title: localizeContentText(locale, module.title) ?? module.title,
      description: localizeContentText(locale, module.description),
      taskText: localizeContentText(locale, module.activeVersion?.taskText) ?? module.activeVersion?.taskText ?? null,
      guidanceText: localizeContentText(locale, module.activeVersion?.guidanceText),
    }));
  }

  const latestByModule = new Map<
    string,
    {
      id: string;
      submittedAt: Date;
      submissionStatus: SubmissionStatusType;
      latestDecision: {
        totalScore: number;
        passFailTotal: boolean;
        decisionType: DecisionTypeType;
        finalisedAt: Date;
      } | null;
    }
  >();

  if (modules.length > 0) {
    const latestSubmissions = await prisma.submission.findMany({
      where: {
        userId,
        moduleId: { in: modules.map((module) => module.id) },
      },
      orderBy: [{ moduleId: "asc" }, { submittedAt: "desc" }],
      select: {
        id: true,
        moduleId: true,
        submittedAt: true,
        submissionStatus: true,
        decisions: {
          orderBy: { finalisedAt: "desc" },
          take: 1,
          select: {
            totalScore: true,
            passFailTotal: true,
            decisionType: true,
            finalisedAt: true,
          },
        },
      },
    });

    for (const submission of latestSubmissions) {
      if (!latestByModule.has(submission.moduleId)) {
        latestByModule.set(submission.moduleId, {
          id: submission.id,
          submittedAt: submission.submittedAt,
          submissionStatus: submission.submissionStatus,
          latestDecision: submission.decisions[0]
            ? {
                totalScore: submission.decisions[0].totalScore,
                passFailTotal: submission.decisions[0].passFailTotal,
                decisionType: submission.decisions[0].decisionType,
                finalisedAt: submission.decisions[0].finalisedAt,
              }
            : null,
        });
      }
    }
  }

  const mapped = modules.map((module) => {
    const latest = latestByModule.get(module.id);
    return {
      ...module,
      title: localizeContentText(locale, module.title) ?? module.title,
      description: localizeContentText(locale, module.description),
      taskText: localizeContentText(locale, module.activeVersion?.taskText) ?? module.activeVersion?.taskText ?? null,
      guidanceText: localizeContentText(locale, module.activeVersion?.guidanceText),
      participantStatus: latest
        ? {
            latestSubmissionId: latest.id,
            latestSubmittedAt: latest.submittedAt,
            latestStatus: latest.submissionStatus,
            latestDecision: latest.latestDecision,
          }
        : null,
    };
  });

  if (options.includeCompleted === true) {
    return mapped;
  }

  return mapped.filter(
    (module) => !isSubmissionStatusCompleted(module.participantStatus?.latestStatus ?? null),
  );
}

export async function listCompletedModulesForUser(userId: string, locale: SupportedLocale = "en-GB", limit = 50) {
  const completedStatuses = getCompletedSubmissionStatuses();
  const submissions = await prisma.submission.findMany({
    where: {
      userId,
      submissionStatus: {
        in: completedStatuses,
      },
    },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      moduleId: true,
      submittedAt: true,
      submissionStatus: true,
      module: {
        select: {
          id: true,
          title: true,
        },
      },
      decisions: {
        orderBy: { finalisedAt: "desc" },
        take: 1,
        select: {
          totalScore: true,
          passFailTotal: true,
          decisionType: true,
          finalisedAt: true,
        },
      },
    },
  });

  const modules = new Map<
    string,
    {
      moduleId: string;
      moduleTitle: string;
      latestSubmissionId: string;
      latestCompletedAt: Date;
      latestStatus: string;
      latestDecision: {
        totalScore: number;
        passFailTotal: boolean;
        decisionType: DecisionTypeType;
        finalisedAt: Date;
      } | null;
    }
  >();

  for (const submission of submissions) {
    if (modules.has(submission.moduleId)) {
      continue;
    }

    modules.set(submission.moduleId, {
      moduleId: submission.module.id,
      moduleTitle: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      latestSubmissionId: submission.id,
      latestCompletedAt: submission.submittedAt,
      latestStatus: submission.submissionStatus,
      latestDecision: submission.decisions[0]
        ? {
            totalScore: submission.decisions[0].totalScore,
            passFailTotal: submission.decisions[0].passFailTotal,
            decisionType: submission.decisions[0].decisionType,
            finalisedAt: submission.decisions[0].finalisedAt,
          }
        : null,
    });

    if (modules.size >= limit) {
      break;
    }
  }

  return Array.from(modules.values());
}

export async function getModuleById(
  moduleId: string,
  roles: AppRoleType[],
  locale: SupportedLocale = "en-GB",
  options: { participantFacing?: boolean } = {},
) {
  const now = new Date();
  const adminRead = options.participantFacing ? false : hasAdminRead(roles);

  const module = await prisma.module.findFirst({
    where: {
      id: moduleId,
      ...(adminRead
        ? {}
        : {
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validTo: null }, { validTo: { gte: now } }] },
              { activeVersion: { is: { publishedAt: { not: null } } } },
            ],
          }),
    },
    select: moduleSummarySelect,
  });

  if (!module) {
    return null;
  }

  return {
    ...module,
    title: localizeContentText(locale, module.title) ?? module.title,
    description: localizeContentText(locale, module.description),
    taskText: localizeContentText(locale, module.activeVersion?.taskText) ?? module.activeVersion?.taskText ?? null,
    guidanceText: localizeContentText(locale, module.activeVersion?.guidanceText),
  };
}

export async function getActiveModuleVersion(
  moduleId: string,
  roles: AppRoleType[],
  locale: SupportedLocale = "en-GB",
  options: { participantFacing?: boolean } = {},
) {
  const module = await getModuleById(moduleId, roles, locale, options);
  if (!module || !module.activeVersion) {
    return null;
  }

  const activeVersion = await prisma.moduleVersion.findUnique({
    where: { id: module.activeVersion.id },
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
    },
  });

  if (!activeVersion) {
    return null;
  }

  return {
    ...activeVersion,
    taskText: localizeContentText(locale, activeVersion.taskText) ?? activeVersion.taskText,
    guidanceText: localizeContentText(locale, activeVersion.guidanceText),
  };
}

export async function getModuleWithActiveVersion(moduleId: string) {
  return prisma.module.findUnique({
    where: { id: moduleId },
    include: { activeVersion: true },
  });
}
