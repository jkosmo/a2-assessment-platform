import { Router } from "express";
import { courseRepository, computeCourseStatus } from "../modules/course/index.js";
import { localizeContentText } from "../i18n/content.js";
import { normalizeLocale } from "../i18n/locale.js";
import { NotFoundError } from "../errors/AppError.js";
import type { CourseListItem, CourseDetail } from "../modules/course/index.js";

const coursesRouter = Router();

coursesRouter.get("/", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    const courses = await courseRepository.findPublishedCourses();

    const items: CourseListItem[] = await Promise.all(
      courses.map(async (course) => {
        const moduleIds = course.modules.map((m) => m.moduleId);
        const total = moduleIds.length;
        const completed = total > 0
          ? await courseRepository.countPassedModulesForUser(userId, moduleIds)
          : 0;

        return {
          id: course.id,
          title: localizeContentText(locale, course.title) ?? course.title,
          description: localizeContentText(locale, course.description) ?? course.description,
          moduleCount: total,
          progress: {
            completed,
            total,
            courseStatus: computeCourseStatus(completed, total),
          },
        };
      }),
    );

    response.json({ courses: items });
  } catch (error) {
    next(error);
  }
});

coursesRouter.get("/completions", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    const completions = await courseRepository.findUserCourseCompletions(userId);
    const items = completions.map((cc) => ({
      courseId: cc.courseId,
      certificateId: cc.certificateId,
      completedAt: cc.completedAt.toISOString(),
      courseTitle: localizeContentText(locale, cc.course.title) ?? cc.course.title,
      certificationLevel: cc.course.certificationLevel,
    }));
    response.json({ completions: items });
  } catch (error) {
    next(error);
  }
});

coursesRouter.get("/:courseId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    const course = await courseRepository.findCourseById(request.params.courseId);
    if (!course || !course.publishedAt || course.archivedAt) {
      throw new NotFoundError("Course", "course_not_found", "Course not found.");
    }

    const moduleIds = course.modules.map((cm) => cm.moduleId);
    const [certStatuses, passedCount] = await Promise.all([
      courseRepository.findUserCertificationStatusesForModules(userId, moduleIds),
      courseRepository.countPassedModulesForUser(userId, moduleIds),
    ]);

    const certStatusByModuleId = new Map(certStatuses.map((cs) => [cs.moduleId, cs.status]));

    const detail: CourseDetail = {
      id: course.id,
      title: localizeContentText(locale, course.title) ?? course.title,
      description: localizeContentText(locale, course.description) ?? course.description,
      certificationLevel: course.certificationLevel,
      publishedAt: course.publishedAt.toISOString(),
      moduleCount: moduleIds.length,
      progress: {
        completed: passedCount,
        total: moduleIds.length,
        courseStatus: computeCourseStatus(passedCount, moduleIds.length),
      },
      modules: course.modules.map((cm) => {
        const certStatus = certStatusByModuleId.get(cm.moduleId);
        const passed = certStatus !== undefined && certStatus !== "NOT_CERTIFIED";
        return {
          moduleId: cm.moduleId,
          sortOrder: cm.sortOrder,
          title: localizeContentText(locale, cm.module.title) ?? cm.module.title,
          moduleStatus: passed ? "PASSED" : "NOT_STARTED",
        };
      }),
    };

    response.json({ course: detail });
  } catch (error) {
    next(error);
  }
});

export { coursesRouter };
