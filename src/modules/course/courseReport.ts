import { courseRepository } from "./courseRepository.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import type { ReportFilters } from "../reporting/types.js";

type CourseReportRow = {
  courseId: string;
  courseTitle: string;
  enrolledParticipants: number;
  completedParticipants: number;
  completionRate: number | null;
  moduleBreakdown: Array<{
    moduleId: string;
    moduleTitle: string;
    sortOrder: number;
    passedUsers: number;
    enrolledUsers: number;
    passRate: number | null;
  }>;
};

export async function getCourseReport(
  filters: Pick<ReportFilters, "courseId" | "dateFrom" | "dateTo" | "orgUnit"> = {},
  locale: SupportedLocale = "en-GB",
): Promise<{ rows: CourseReportRow[] }> {
  const courses = await courseRepository.findPublishedCoursesWithModuleDetails(filters);

  const rows: CourseReportRow[] = await Promise.all(
    courses.map(async (course) => {
      const moduleIds = course.modules.map((cm) => cm.moduleId);

      const [enrolled, completed] = await Promise.all([
        courseRepository.countDistinctEnrolledUsersForModules(moduleIds, filters),
        courseRepository.countCourseCompletions(course.id, filters),
      ]);

      const moduleBreakdown = await Promise.all(
        course.modules.map(async (cm) => {
          const [passedUsers, enrolledUsers] = await Promise.all([
            courseRepository.countPassedUsersForModule(cm.moduleId, filters),
            courseRepository.countUsersWithSubmissionsForModule(cm.moduleId, filters),
          ]);
          return {
            moduleId: cm.moduleId,
            moduleTitle: localizeContentText(locale, cm.module.title) ?? cm.module.title,
            sortOrder: cm.sortOrder,
            passedUsers,
            enrolledUsers,
            passRate: enrolledUsers > 0
              ? Math.round((passedUsers / enrolledUsers) * 100) / 100
              : null,
          };
        }),
      );

      return {
        courseId: course.id,
        courseTitle: localizeContentText(locale, course.title) ?? course.title,
        enrolledParticipants: enrolled,
        completedParticipants: completed,
        completionRate: enrolled > 0
          ? Math.round((completed / enrolled) * 100) / 100
          : null,
        moduleBreakdown,
      };
    }),
  );

  return { rows };
}
