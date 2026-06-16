import { Router } from "express";
import { courseRepository, computeCourseStatus, getSection } from "../modules/course/index.js";
import { renderSectionMarkdown } from "../modules/course/sectionContent.js";
import { localizeContentText } from "../i18n/content.js";
import { normalizeLocale } from "../i18n/locale.js";
import { NotFoundError } from "../errors/AppError.js";
import type { CourseListItem, CourseDetail, CourseSequenceItem } from "../modules/course/index.js";
import { queryLatestSubmissionsForModules } from "../modules/submission/submissionRepository.js";

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
        const [completed, latestSubmissions] = await Promise.all([
          moduleIds.length > 0
            ? courseRepository.countPassedModulesForUser(userId, moduleIds)
            : Promise.resolve(0),
          moduleIds.length > 0
            ? queryLatestSubmissionsForModules(userId, moduleIds)
            : Promise.resolve([]),
        ]);
        const total = moduleIds.length;
        const hasStarted = latestSubmissions.length > 0;

        return {
          id: course.id,
          title: localizeContentText(locale, course.title) ?? course.title,
          description: localizeContentText(locale, course.description) ?? course.description,
          moduleCount: total,
          progress: {
            completed,
            total,
            courseStatus: computeCourseStatus(completed, total, hasStarted),
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
    const [certStatuses, passedCount, latestSubmissions] = await Promise.all([
      courseRepository.findUserCertificationStatusesForModules(userId, moduleIds),
      courseRepository.countPassedModulesForUser(userId, moduleIds),
      moduleIds.length > 0
        ? queryLatestSubmissionsForModules(userId, moduleIds)
        : Promise.resolve([]),
    ]);

    const certStatusByModuleId = new Map(certStatuses.map((cs) => [cs.moduleId, cs.status]));
    const latestSubmissionByModuleId = new Map<string, (typeof latestSubmissions)[number]>();
    for (const submission of latestSubmissions) {
      if (!latestSubmissionByModuleId.has(submission.moduleId)) {
        latestSubmissionByModuleId.set(submission.moduleId, submission);
      }
    }

    // Mixed module/section sequence (#491/P1).
    const courseItems = await courseRepository.findCourseItems(course.id);
    const items: CourseSequenceItem[] = courseItems.map((item) => {
      if (item.itemType === "SECTION" && item.section) {
        return {
          type: "SECTION",
          sortOrder: item.sortOrder,
          sectionId: item.section.id,
          title: localizeContentText(locale, item.section.title) ?? item.section.title,
        };
      }
      const moduleId = item.moduleId ?? item.module?.id ?? "";
      const certStatus = certStatusByModuleId.get(moduleId);
      const passed = certStatus !== undefined && certStatus !== "NOT_CERTIFIED";
      const hasStarted = latestSubmissionByModuleId.has(moduleId);
      return {
        type: "MODULE",
        sortOrder: item.sortOrder,
        moduleId,
        title: localizeContentText(locale, item.module?.title ?? "") ?? item.module?.title ?? moduleId,
        moduleStatus: passed ? "PASSED" : hasStarted ? "IN_PROGRESS" : "NOT_STARTED",
      };
    });

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
        courseStatus: computeCourseStatus(passedCount, moduleIds.length, latestSubmissions.length > 0),
      },
      modules: course.modules.map((cm) => {
        const certStatus = certStatusByModuleId.get(cm.moduleId);
        const passed = certStatus !== undefined && certStatus !== "NOT_CERTIFIED";
        const hasStarted = latestSubmissionByModuleId.has(cm.moduleId);
        return {
          moduleId: cm.moduleId,
          sortOrder: cm.sortOrder,
          title: localizeContentText(locale, cm.module.title) ?? cm.module.title,
          moduleStatus: passed ? "PASSED" : hasStarted ? "IN_PROGRESS" : "NOT_STARTED",
        };
      }),
      items,
    };

    response.json({ course: detail });
  } catch (error) {
    next(error);
  }
});

// Rendered learning-section content for a participant (#491/P1). Validates the
// section belongs to the published course, then returns sanitised HTML in the
// participant's locale.
coursesRouter.get("/:courseId/sections/:sectionId", async (request, response, next) => {
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
    const courseItems = await courseRepository.findCourseItems(course.id);
    const belongs = courseItems.some(
      (item) => item.itemType === "SECTION" && item.sectionId === request.params.sectionId,
    );
    if (!belongs) {
      throw new NotFoundError("CourseSection", "section_not_found", "Section not found in this course.");
    }
    const section = await getSection(request.params.sectionId);
    if (!section) {
      throw new NotFoundError("CourseSection", "section_not_found", "Section not found.");
    }
    const localizedTitle = localizeContentText(locale, section.title) ?? section.title;
    const localizedBody = localizeContentText(locale, section.activeVersion?.bodyMarkdown ?? "") ?? "";
    response.json({ title: localizedTitle, html: renderSectionMarkdown(localizedBody) });
  } catch (error) {
    next(error);
  }
});

export { coursesRouter };
