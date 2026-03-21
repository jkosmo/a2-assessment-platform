import type {
  AppRole as AppRoleType,
  Prisma,
  SubmissionStatus as SubmissionStatusType,
} from "@prisma/client";
import { prisma } from "../db/prisma.js";

export const moduleSummarySelect = {
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
      submissionSchemaJson: true,
      assessmentPolicyJson: true,
      publishedAt: true,
      rubricVersionId: true,
      promptTemplateVersionId: true,
      mcqSetVersionId: true,
    },
  },
} satisfies Prisma.ModuleSelect;

function buildPublishedModuleWhere(now: Date): Prisma.ModuleWhereInput {
  return {
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validTo: null }, { validTo: { gte: now } }] },
      { activeVersion: { is: { publishedAt: { not: null } } } },
    ],
  };
}

export async function queryModules(adminRead: boolean, now: Date) {
  return prisma.module.findMany({
    where: adminRead ? {} : buildPublishedModuleWhere(now),
    select: moduleSummarySelect,
    orderBy: { title: "asc" },
  });
}

export async function queryLatestSubmissionsForModules(userId: string, moduleIds: string[]) {
  return prisma.submission.findMany({
    where: { userId, moduleId: { in: moduleIds } },
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
}

export async function queryCompletedSubmissionsForUser(
  userId: string,
  statuses: SubmissionStatusType[],
  limit: number,
) {
  return prisma.submission.findMany({
    where: { userId, submissionStatus: { in: statuses } },
    orderBy: { submittedAt: "desc" },
    take: limit,
    select: {
      id: true,
      moduleId: true,
      submittedAt: true,
      submissionStatus: true,
      module: { select: { id: true, title: true } },
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
}

export async function queryModuleById(moduleId: string, adminRead: boolean, now: Date) {
  return prisma.module.findFirst({
    where: {
      id: moduleId,
      ...(adminRead ? {} : buildPublishedModuleWhere(now)),
    },
    select: moduleSummarySelect,
  });
}

export async function queryModuleVersion(versionId: string) {
  return prisma.moduleVersion.findUnique({
    where: { id: versionId },
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
    },
  });
}

export async function getModuleWithActiveVersion(moduleId: string) {
  return prisma.module.findUnique({
    where: { id: moduleId },
    include: { activeVersion: true },
  });
}
