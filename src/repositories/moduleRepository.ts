import { AppRole, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

const ADMIN_READ_ROLES: AppRole[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
  AppRole.REVIEWER,
  AppRole.APPEAL_HANDLER,
  AppRole.REPORT_READER,
];

function hasAdminRead(roles: AppRole[]) {
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
      publishedAt: true,
      rubricVersionId: true,
      promptTemplateVersionId: true,
      mcqSetVersionId: true,
    },
  },
} satisfies Prisma.ModuleSelect;

export async function listModules(roles: AppRole[], userId?: string) {
  const now = new Date();
  const adminRead = hasAdminRead(roles);

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
    return modules;
  }

  return Promise.all(
    modules.map(async (module) => {
      const latest = await prisma.submission.findFirst({
        where: { userId, moduleId: module.id },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          submittedAt: true,
          submissionStatus: true,
        },
      });
      return {
        ...module,
        participantStatus: latest
          ? {
              latestSubmissionId: latest.id,
              latestSubmittedAt: latest.submittedAt,
              latestStatus: latest.submissionStatus,
            }
          : null,
      };
    }),
  );
}

export async function getModuleById(moduleId: string, roles: AppRole[]) {
  const now = new Date();
  const adminRead = hasAdminRead(roles);

  return prisma.module.findFirst({
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
}

export async function getActiveModuleVersion(moduleId: string, roles: AppRole[]) {
  const module = await getModuleById(moduleId, roles);
  if (!module || !module.activeVersion) {
    return null;
  }

  return prisma.moduleVersion.findUnique({
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
}
