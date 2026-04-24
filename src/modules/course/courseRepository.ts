import { prisma } from "../../db/prisma.js";
import type { ReportFilters } from "../reporting/types.js";

function buildSubmissionWhere(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
  return {
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  };
}

function buildCompletionWhere(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
  return {
    ...(filters.dateFrom || filters.dateTo
      ? {
          completedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  };
}

function buildCertificationWhere(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
  return {
    ...(filters.dateFrom || filters.dateTo
      ? {
          passedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  };
}

type CourseRepositoryClient = Pick<
  typeof prisma,
  "course" | "courseModule" | "courseCompletion" | "certificationStatus" | "submission"
>;

export function createCourseRepository(client: CourseRepositoryClient = prisma) {
  return {
    findPublishedCoursesContainingModule(moduleId: string) {
      return client.course.findMany({
        where: {
          publishedAt: { not: null },
          archivedAt: null,
          modules: { some: { moduleId } },
        },
        include: {
          modules: {
            orderBy: { sortOrder: "asc" },
            select: { moduleId: true },
          },
        },
      });
    },

    countPassedModulesForUser(userId: string, moduleIds: string[]) {
      return client.certificationStatus.count({
        where: {
          userId,
          moduleId: { in: moduleIds },
          status: { not: "NOT_CERTIFIED" },
        },
      });
    },

    findUserCertificationStatusesForModules(userId: string, moduleIds: string[]) {
      return client.certificationStatus.findMany({
        where: {
          userId,
          moduleId: { in: moduleIds },
        },
        select: { moduleId: true, status: true },
      });
    },

    findCourseCompletion(userId: string, courseId: string) {
      return client.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
      });
    },

    createCourseCompletion(userId: string, courseId: string, moduleSnapshotJson: string) {
      return client.courseCompletion.create({
        data: { userId, courseId, moduleSnapshotJson },
      });
    },

    listCourses() {
      return client.course.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { modules: true } } },
      });
    },

    findCourseById(courseId: string) {
      return client.course.findUnique({
        where: { id: courseId },
        include: {
          modules: {
            orderBy: { sortOrder: "asc" },
            include: {
              module: {
                select: { id: true, title: true, certificationLevel: true, archivedAt: true },
              },
            },
          },
        },
      });
    },

    findPublishedCourses() {
      return client.course.findMany({
        where: { publishedAt: { not: null }, archivedAt: null },
        orderBy: { publishedAt: "asc" },
        include: {
          modules: {
            orderBy: { sortOrder: "asc" },
            select: { moduleId: true },
          },
        },
      });
    },

    findPublishedCoursesWithModuleDetails(filters: Pick<ReportFilters, "courseId"> = {}) {
      return client.course.findMany({
        where: {
          publishedAt: { not: null },
          archivedAt: null,
          ...(filters.courseId ? { id: filters.courseId } : {}),
        },
        orderBy: { publishedAt: "asc" },
        include: {
          modules: {
            orderBy: { sortOrder: "asc" },
            include: {
              module: { select: { id: true, title: true } },
            },
          },
        },
      });
    },

    findUserCourseCompletions(userId: string) {
      return client.courseCompletion.findMany({
        where: { userId },
        include: {
          course: {
            select: { id: true, title: true, certificationLevel: true },
          },
        },
        orderBy: { completedAt: "desc" },
      });
    },

    countCourseCompletions(courseId: string, filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
      return client.courseCompletion.count({
        where: {
          courseId,
          ...buildCompletionWhere(filters),
        },
      });
    },

    countDistinctEnrolledUsersForModules(
      moduleIds: string[],
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      if (moduleIds.length === 0) return Promise.resolve(0);
      return client.submission.groupBy({
        by: ["userId"],
        where: {
          moduleId: { in: moduleIds },
          ...buildSubmissionWhere(filters),
        },
      }).then((rows) => rows.length);
    },

    countPassedUsersForModule(moduleId: string, filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {}) {
      return client.certificationStatus.count({
        where: {
          moduleId,
          status: { not: "NOT_CERTIFIED" },
          ...buildCertificationWhere(filters),
        },
      });
    },

    countUsersWithSubmissionsForModule(
      moduleId: string,
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      return client.submission.groupBy({
        by: ["userId"],
        where: {
          moduleId,
          ...buildSubmissionWhere(filters),
        },
      }).then((rows) => rows.length);
    },

    findLearnerSubmissionsForModules(
      moduleIds: string[],
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      if (moduleIds.length === 0) {
        return Promise.resolve([]);
      }
      return client.submission.findMany({
        where: {
          moduleId: { in: moduleIds },
          ...buildSubmissionWhere(filters),
        },
        orderBy: [{ userId: "asc" }, { moduleId: "asc" }, { submittedAt: "desc" }],
        select: {
          userId: true,
          moduleId: true,
          submittedAt: true,
          submissionStatus: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
            },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: {
              totalScore: true,
              passFailTotal: true,
              finalisedAt: true,
            },
          },
        },
      });
    },

    findCourseCompletionsForLearnerReport(
      courseId: string,
      filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
    ) {
      return client.courseCompletion.findMany({
        where: {
          courseId,
          ...buildCompletionWhere(filters),
        },
        orderBy: [{ userId: "asc" }, { completedAt: "desc" }],
        select: {
          userId: true,
          completedAt: true,
          certificateId: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
            },
          },
        },
      });
    },
  };
}

export const courseRepository = createCourseRepository();
