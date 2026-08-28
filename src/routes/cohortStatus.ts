import { Router, type Request } from "express";
import { prisma } from "../db/prisma.js";
import { getCohortStatus } from "../modules/course/cohortStatusService.js";
import { localizeContentText } from "../i18n/content.js";
import { normalizeLocale } from "../i18n/locale.js";

// #498: teacher/SMO cohort-status dashboard API. Mounted at /api/cohort-status; role-gated to
// SUBJECT_MATTER_OWNER + ADMINISTRATOR + REPORT_READER (see capabilities `cohort_dashboard`).
const cohortStatusRouter = Router();

// GET /api/cohort-status/courses — courses for the dashboard picker.
//
// #967: this listed ONLY published, non-archived courses. A course unpublished mid-cohort therefore
// vanished from the picker without a word — which is exactly the "screen emptied without saying why"
// outcome this dashboard is supposed to avoid, just one step earlier in the flow. The teacher was
// left with participants stuck at OVERDUE and no way to look at them.
//
// ⚠️ Unreachable courses are now INCLUDED and flagged, not hidden. Same principle as the status
// response itself: a reminder is an action aimed at a participant who cannot act on it, so it is
// suppressed — but a dashboard is a question from a teacher, and it deserves an honest answer.
cohortStatusRouter.get("/courses", async (request, response, next) => {
  try {
    const locale = normalizeLocale(request.context?.locale) ?? "nb";
    const courses = await prisma.course.findMany({
      select: { id: true, title: true, publishedAt: true, archivedAt: true },
      orderBy: { createdAt: "desc" },
    });
    response.json({
      courses: courses.map((course) => ({
        id: course.id,
        title: localizeContentText(locale, course.title) ?? course.title ?? course.id,
        published: course.publishedAt !== null,
        archived: course.archivedAt !== null,
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
