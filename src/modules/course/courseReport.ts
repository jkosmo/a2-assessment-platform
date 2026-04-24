import { courseRepository } from "./courseRepository.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import type { ReportFilters } from "../reporting/types.js";
import { computeCourseStatus } from "./courseQueries.js";
import { round2 } from "../reporting/csvExport.js";

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

type CourseLearnerRow = {
  participantId: string;
  participantName: string;
  participantEmail: string;
  participantDepartment: string | null;
  courseId: string;
  courseTitle: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  passedModules: number;
  failedModules: number;
  underReviewModules: number;
  completedModules: number;
  totalModules: number;
  score: number | null;
  latestActivityAt: string | null;
  completedAt: string | null;
  certificateId: string | null;
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

export async function getCourseLearnerReport(
  courseId: string,
  filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit"> = {},
  locale: SupportedLocale = "en-GB",
): Promise<{
  selectedCourseId: string;
  rows: CourseLearnerRow[];
  totals: {
    learners: number;
    completed: number;
    inProgress: number;
  };
}> {
  const [course] = await courseRepository.findPublishedCoursesWithModuleDetails({ courseId });
  if (!course) {
    return {
      selectedCourseId: courseId,
      rows: [],
      totals: {
        learners: 0,
        completed: 0,
        inProgress: 0,
      },
    };
  }

  const moduleIds = course.modules.map((moduleEntry) => moduleEntry.moduleId);
  const [submissions, completions] = await Promise.all([
    courseRepository.findLearnerSubmissionsForModules(moduleIds, filters),
    courseRepository.findCourseCompletionsForLearnerReport(course.id, filters),
  ]);

  const learners = new Map<string, {
    participantId: string;
    participantName: string;
    participantEmail: string;
    participantDepartment: string | null;
    completion: (typeof completions)[number] | null;
    latestActivityAt: Date | null;
    latestByModule: Map<string, (typeof submissions)[number]>;
  }>();

  for (const submission of submissions) {
    const current = learners.get(submission.userId) ?? {
      participantId: submission.user.id,
      participantName: submission.user.name,
      participantEmail: submission.user.email,
      participantDepartment: submission.user.department,
      completion: null,
      latestActivityAt: null,
      latestByModule: new Map<string, (typeof submissions)[number]>(),
    };

    if (!current.latestByModule.has(submission.moduleId)) {
      current.latestByModule.set(submission.moduleId, submission);
    }

    const latestDecisionAt = submission.decisions[0]?.finalisedAt ?? null;
    const activityAt = latestDecisionAt && latestDecisionAt > submission.submittedAt
      ? latestDecisionAt
      : submission.submittedAt;
    if (!current.latestActivityAt || activityAt > current.latestActivityAt) {
      current.latestActivityAt = activityAt;
    }
    learners.set(submission.userId, current);
  }

  for (const completion of completions) {
    const current = learners.get(completion.userId) ?? {
      participantId: completion.user.id,
      participantName: completion.user.name,
      participantEmail: completion.user.email,
      participantDepartment: completion.user.department,
      completion: null,
      latestActivityAt: null,
      latestByModule: new Map<string, (typeof submissions)[number]>(),
    };
    current.completion = completion;
    if (!current.latestActivityAt || completion.completedAt > current.latestActivityAt) {
      current.latestActivityAt = completion.completedAt;
    }
    learners.set(completion.userId, current);
  }

  const rows: CourseLearnerRow[] = Array.from(learners.values()).map((learner) => {
    let passedModules = 0;
    let failedModules = 0;
    let underReviewModules = 0;
    const scores: number[] = [];

    for (const moduleId of moduleIds) {
      const latest = learner.latestByModule.get(moduleId);
      if (!latest) {
        continue;
      }
      const latestDecision = latest.decisions[0] ?? null;
      if (typeof latestDecision?.totalScore === "number") {
        scores.push(latestDecision.totalScore);
      }
      if (latestDecision?.passFailTotal === true) {
        passedModules += 1;
      } else if (latestDecision?.passFailTotal === false) {
        failedModules += 1;
      } else if (latest.submissionStatus === "UNDER_REVIEW") {
        underReviewModules += 1;
      }
    }

    const hasStarted = learner.latestByModule.size > 0 || Boolean(learner.completion);
    const completedModules = learner.completion ? moduleIds.length : passedModules;
    const status = learner.completion
      ? "COMPLETED"
      : computeCourseStatus(passedModules, moduleIds.length, hasStarted);

    return {
      participantId: learner.participantId,
      participantName: learner.participantName,
      participantEmail: learner.participantEmail,
      participantDepartment: learner.participantDepartment,
      courseId: course.id,
      courseTitle: localizeContentText(locale, course.title) ?? course.title,
      status,
      passedModules,
      failedModules,
      underReviewModules,
      completedModules,
      totalModules: moduleIds.length,
      score: scores.length > 0 ? round2(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      latestActivityAt: learner.latestActivityAt?.toISOString() ?? null,
      completedAt: learner.completion?.completedAt.toISOString() ?? null,
      certificateId: learner.completion?.certificateId ?? null,
    };
  });

  return {
    selectedCourseId: course.id,
    rows,
    totals: {
      learners: rows.length,
      completed: rows.filter((row) => row.status === "COMPLETED").length,
      inProgress: rows.filter((row) => row.status === "IN_PROGRESS").length,
    },
  };
}
