import { Router } from "express";
import { courseRepository, computeCourseStatus, getSection, checkCourseCompletionForCourse } from "../modules/course/index.js";
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
        // Count all elements — modules + sections (#492). Modules come from the
        // always-populated CourseModule join; sections only exist in CourseItem.
        const moduleIds = course.modules.map((m) => m.moduleId);
        const courseItems = await courseRepository.findCourseItems(course.id);
        const sectionIds = courseItems
          .filter((i) => i.itemType === "SECTION")
          .map((i) => i.sectionId)
          .filter((id): id is string => Boolean(id));
        const [passed, readIds, latestSubmissions] = await Promise.all([
          moduleIds.length > 0
            ? courseRepository.countPassedModulesForUser(userId, moduleIds)
            : Promise.resolve(0),
          sectionIds.length > 0
            ? courseRepository.findReadSectionIds(userId, course.id)
            : Promise.resolve([] as string[]),
          moduleIds.length > 0
            ? queryLatestSubmissionsForModules(userId, moduleIds)
            : Promise.resolve([]),
        ]);
        const readCount = readIds.filter((id) => sectionIds.includes(id)).length;
        const total = moduleIds.length + sectionIds.length;
        const completed = passed + readCount;
        const hasStarted = latestSubmissions.length > 0 || readCount > 0;

        return {
          id: course.id,
          title: localizeContentText(locale, course.title) ?? course.title,
          description: localizeContentText(locale, course.description) ?? course.description,
          moduleCount: moduleIds.length,
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

// #550: single completion by certificate ID, for the printable certificate view. Owner-scoped —
// returns 404 (not 403) for someone else's certificate so existence isn't leaked.
coursesRouter.get("/completions/:certificateId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const locale = normalizeLocale(request.context?.locale) ?? "en-GB";

  try {
    const completion = await courseRepository.findCourseCompletionByCertificateId(
      request.params.certificateId,
    );
    if (!completion || completion.userId !== userId) {
      response.status(404).json({ error: "not_found" });
      return;
    }

    let moduleCount = 0;
    try {
      const snapshot = JSON.parse(completion.moduleSnapshotJson);
      moduleCount = Array.isArray(snapshot) ? snapshot.length : 0;
    } catch {
      moduleCount = 0;
    }

    response.json({
      certificateId: completion.certificateId,
      courseId: completion.courseId,
      courseTitle: localizeContentText(locale, completion.course.title) ?? completion.course.title,
      certificationLevel: completion.course.certificationLevel,
      completedAt: completion.completedAt.toISOString(),
      participantName: completion.user.name,
      moduleCount,
    });
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

    // Mixed module/section sequence (#491/P1) with per-section read state (#492).
    const courseItems = await courseRepository.findCourseItems(course.id);
    const readSectionIds = new Set(await courseRepository.findReadSectionIds(userId, course.id));
    let readSectionCount = 0;
    const items: CourseSequenceItem[] = courseItems.map((item) => {
      if (item.itemType === "SECTION" && item.section) {
        const read = readSectionIds.has(item.section.id);
        if (read) readSectionCount += 1;
        return {
          type: "SECTION",
          sortOrder: item.sortOrder,
          sectionId: item.section.id,
          title: localizeContentText(locale, item.section.title) ?? item.section.title,
          read,
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

    // All elements count toward progress: passed modules + read sections (#492).
    // Module count from the reliable CourseModule join; sections from CourseItem.
    const sectionCount = items.filter((i) => i.type === "SECTION").length;
    const totalElements = moduleIds.length + sectionCount;
    const completedElements = passedCount + readSectionCount;

    const detail: CourseDetail = {
      id: course.id,
      title: localizeContentText(locale, course.title) ?? course.title,
      description: localizeContentText(locale, course.description) ?? course.description,
      certificationLevel: course.certificationLevel,
      publishedAt: course.publishedAt.toISOString(),
      moduleCount: moduleIds.length,
      progress: {
        completed: completedElements,
        total: totalElements,
        courseStatus: computeCourseStatus(completedElements, totalElements, latestSubmissions.length > 0 || readSectionCount > 0),
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

// Mark a section as read for the current participant (#492). Idempotent.
coursesRouter.post("/:courseId/sections/:sectionId/read", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
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
    await courseRepository.markSectionRead(userId, course.id, request.params.sectionId);
    // Reading the final section can be the last gate for certification (#476/#525) — re-check.
    await checkCourseCompletionForCourse({ userId, courseId: course.id });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { coursesRouter };
