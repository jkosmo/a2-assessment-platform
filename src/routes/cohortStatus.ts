import { Router, type Request } from "express";
import { prisma } from "../db/prisma.js";
import { getCohortStatus } from "../modules/course/cohortStatusService.js";
import { localizeContentText } from "../i18n/content.js";
import { normalizeLocale } from "../i18n/locale.js";

// #498: teacher/SMO cohort-status dashboard API. Mounted at /api/cohort-status; role-gated to
// SUBJECT_MATTER_OWNER + ADMINISTRATOR + REPORT_READER (see capabilities `cohort_dashboard`).
const cohortStatusRouter = Router();

// GET /api/cohort-status/courses — published, non-archived courses for the dashboard picker.
cohortStatusRouter.get("/courses", async (request, response, next) => {
  try {
    const locale = normalizeLocale(request.context?.locale) ?? "nb";
    const courses = await prisma.course.findMany({
      where: { publishedAt: { not: null }, archivedAt: null },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    response.json({
      courses: courses.map((course) => ({
        id: course.id,
        title: localizeContentText(locale, course.title) ?? course.title ?? course.id,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/cohort-status/course/:courseId — enrollment-status counts (ASSIGNED/IN_PROGRESS/OVERDUE/
// COMPLETED) over the course's effective audience (individual + class-expanded), plus a per-class
// breakdown.
cohortStatusRouter.get("/course/:courseId", async (request: Request<{ courseId: string }>, response, next) => {
  try {
    response.json(await getCohortStatus(request.params.courseId));
  } catch (error) {
    next(error);
  }
});

export { cohortStatusRouter };
