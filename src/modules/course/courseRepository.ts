import { prisma } from "../../db/prisma.js";

type CourseRepositoryClient = Pick<
  typeof prisma,
  "course" | "courseModule" | "courseCompletion" | "certificationStatus"
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
  };
}

export const courseRepository = createCourseRepository();
