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
  "course" | "courseModule" | "courseItem" | "courseCompletion" | "courseSectionRead" | "certificationStatus" | "submission"
>;

export function createCourseRepository(client: CourseRepositoryClient = prisma) {
  return {
    async findPublishedCoursesContainingModule(moduleId: string) {
      const courses = await client.course.findMany({
        where: {
          publishedAt: { not: null },
          archivedAt: null,
          items: { some: { moduleId } },
        },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            select: { moduleId: true },
          },
        },
      });
      return courses.map(({ items, ...rest }) => ({
        ...rest,
        modules: items.filter((i) => i.moduleId).map((i) => ({ moduleId: i.moduleId as string })),
      }));
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

    async listCourses() {
      // #502: tell MODULE-elementer fra CourseItem i stedet for CourseModule; behold _count.modules-shapen.
      const courses = await client.course.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { items: { where: { itemType: "MODULE" } } } } },
      });
      return courses.map(({ _count, ...rest }) => ({ ...rest, _count: { modules: _count.items } }));
    },

    markSectionRead(userId: string, courseId: string, sectionId: string) {
      return client.courseSectionRead.upsert({
        where: { userId_courseId_sectionId: { userId, courseId, sectionId } },
        update: {},
        create: { userId, courseId, sectionId },
      });
    },

    findReadSectionIds(userId: string, courseId: string) {
      return client.courseSectionRead
        .findMany({ where: { userId, courseId }, select: { sectionId: true } })
        .then((rows) => rows.map((r) => r.sectionId));
    },

    findCourseItems(courseId: string) {
      return client.courseItem.findMany({
        where: { courseId },
        orderBy: { sortOrder: "asc" },
        include: {
          // activeVersion.publishedAt (#502-followup): lar deltaker-UI markere avpubliserte moduler
          // som «ikke tilgjengelig» i stedet for en blindvei-klikk.
          module: {
            select: {
              id: true,
              title: true,
              archivedAt: true,
              activeVersionId: true,
              activeVersion: { select: { publishedAt: true } },
            },
          },
          section: { select: { id: true, title: true, archivedAt: true } },
        },
      });
    },

    // #502 contract-fase: `modules` deriveres nå fra CourseItem (MODULE-elementer) i stedet for den
    // gamle CourseModule-join-en, så CourseItem er eneste sannhetskilde. Retur-shapen beholdes
    // ({ moduleId, sortOrder, module }) så konsumentene er uendret.
    async findCourseById(courseId: string) {
      const course = await client.course.findUnique({
        where: { id: courseId },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            include: {
              module: {
                select: { id: true, title: true, certificationLevel: true, archivedAt: true },
              },
            },
          },
        },
      });
      if (!course) return null;
      const { items, ...rest } = course;
      const modules = items
        .filter((item) => item.moduleId && item.module)
        .map((item) => ({ moduleId: item.moduleId as string, sortOrder: item.sortOrder, module: item.module! }));
      return { ...rest, modules };
    },

    async findPublishedCourses() {
      const courses = await client.course.findMany({
        where: { publishedAt: { not: null }, archivedAt: null },
        orderBy: { publishedAt: "asc" },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            select: { moduleId: true },
          },
        },
      });
      return courses.map(({ items, ...rest }) => ({
        ...rest,
        modules: items
          .filter((item) => item.moduleId)
          .map((item) => ({ moduleId: item.moduleId as string })),
      }));
    },

    async findPublishedCoursesWithModuleDetails(filters: Pick<ReportFilters, "courseId"> = {}) {
      const courses = await client.course.findMany({
        where: {
          publishedAt: { not: null },
          archivedAt: null,
          ...(filters.courseId ? { id: filters.courseId } : {}),
        },
        orderBy: { publishedAt: "asc" },
        include: {
          items: {
            where: { itemType: "MODULE" },
            orderBy: { sortOrder: "asc" },
            include: { module: { select: { id: true, title: true } } },
          },
        },
      });
      return courses.map(({ items, ...rest }) => ({
        ...rest,
        modules: items
          .filter((item) => item.moduleId && item.module)
          .map((item) => ({ moduleId: item.moduleId as string, sortOrder: item.sortOrder, module: item.module! })),
      }));
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

    // #550: single completion by certificate ID, including course + participant name, for the
    // printable certificate view. certificateId is unique. Caller must scope to the owner.
    findCourseCompletionByCertificateId(certificateId: string) {
      return client.courseCompletion.findUnique({
        where: { certificateId },
        include: {
          course: { select: { id: true, title: true, certificationLevel: true } },
          user: { select: { id: true, name: true } },
        },
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
