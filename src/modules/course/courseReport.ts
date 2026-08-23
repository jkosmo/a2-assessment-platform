import { courseRepository } from "./courseRepository.js";
import { resolveCourseAudience } from "./cohortStatusService.js";
import { findUserIdsInDepartment } from "../../repositories/userRepository.js";
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

// #969: «hvem er med i dette kurset» besvares ETT sted — `resolveCourseAudience` (#498), det samme
// publikummet kullstatus-dashbordet og påminnelsesjobben bruker. Rapporten hadde sin egen, fjerde
// definisjon: distinkte brukere med INNLEVERING på kursets moduler. Navnet lovet innmelding,
// telleren målte aktivitet, og de to sprikte på to måter som begge nådde ledelsen:
//   - et rent lesekurs uten moduler ga enrolled = 0 samtidig med 25 fullføringer
//   - med datofilteret «siste 30 dager» kunne fullføringene ligge innenfor vinduet og
//     innleveringene utenfor: 12 / 3 = 400 % fullføringsgrad i CSV-en.
//
// Nevneren er publikummet UNIONERT med dem som faktisk har fullført i vinduet. Unionen er ikke
// pynt: en deltaker kan ha fått innmeldingen trukket tilbake, eller ha falt ut av en klasse, etter
// at beviset ble utstedt — da ville nevneren igjen vært mindre enn telleren. Med unionen er
// «fullført» en delmengde av «med i kurset» per konstruksjon, så graden KAN ikke overstige 100 %.
// Det er med vilje løst slik og ikke ved å klippe tallet til 1: en klipping ville skjult
// uenigheten mellom de to tallene i stedet for å fjerne den.
//
// Publikummet er bevisst IKKE datofiltrert (det finnes ingen «var innmeldt i vinduet»-tilstand å
// filtrere på — `resolveCourseAudience` beskriver nåsituasjonen). Fullføringsgraden med datofilter
// leses derfor som «andelen av dagens publikum som fullførte i vinduet».
async function resolveReportAudienceIds(courseId: string, orgUnit: string | undefined): Promise<string[]> {
  const audience = await resolveCourseAudience(courseId);
  const userIds = audience.map((member) => member.userId);
  if (!orgUnit) return userIds;
  return findUserIdsInDepartment(userIds, orgUnit);
}

export async function getCourseReport(
  filters: Pick<ReportFilters, "courseId" | "dateFrom" | "dateTo" | "orgUnit"> = {},
  locale: SupportedLocale = "en-GB",
): Promise<{ rows: CourseReportRow[] }> {
  const courses = await courseRepository.findPublishedCoursesWithModuleDetails(filters);

  const rows: CourseReportRow[] = await Promise.all(
    courses.map(async (course) => {
      // Fullføringene hentes som RADER, ikke som `countCourseCompletions`, fordi nevneren trenger
      // bruker-ID-ene for unionen over. CourseCompletion er unik per (userId, courseId), så
      // radantallet er fortsatt antall distinkte deltakere — `completedParticipants` betyr det
      // samme som før.
      const [audienceUserIds, completions] = await Promise.all([
        resolveReportAudienceIds(course.id, filters.orgUnit),
        courseRepository.findCourseCompletionsForLearnerReport(course.id, filters),
      ]);
      const participantIds = new Set(audienceUserIds);
      for (const completion of completions) {
        participantIds.add(completion.userId);
      }
      const enrolled = participantIds.size;
      const completed = completions.length;

      // ⚠️ #969/#995: modulraden hadde nøyaktig samme feil som kursraden, én etasje ned — telleren
      // var sertifiseringer i vinduet, nevneren innleveringer i vinduet, og de to målte ULIKE
      // mennesker. Med «siste 30 dager» kunne 12 beståtte deles på 3 innleveringer: 400 %.
      //
      // Modulnivået har ingen egen innmelding — man meldes inn i et KURS — så nevneren er kursets
      // publikum, det samme `participantIds` kursraden over bruker. Telleren er de av dem som
      // faktisk besto.
      //
      // Snittet er poenget, ikke en klipping til 100 %: en klipping ville skjult at de to tallene
      // var uenige. Nå er telleren en delmengde av nevneren per konstruksjon.
      const moduleBreakdown = await Promise.all(
        course.modules.map(async (cm) => {
          const passedIds = await courseRepository.findPassedUserIdsForModule(cm.moduleId, filters);
          const passedUsers = passedIds.filter((id) => participantIds.has(id)).length;
          const enrolledUsers = participantIds.size;
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
      if (latest.submissionStatus === "UNDER_REVIEW") {
        underReviewModules += 1;
      } else if (latestDecision?.passFailTotal === true) {
        passedModules += 1;
      } else if (latestDecision?.passFailTotal === false) {
        failedModules += 1;
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
