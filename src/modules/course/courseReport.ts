import { courseRepository } from "./courseRepository.js";
import { resolveCourseAudience } from "./cohortStatusService.js";
import { findUserIdsInDepartment, findUsersByIds } from "../../repositories/userRepository.js";
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
  readSections: number;
  totalSections: number;
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

/**
 * ⚠️ #996: ÉN definisjon av «hvem er med i dette kurset», for BEGGE rapportflatene.
 *
 * Sammendraget og drilldownen hadde hver sin: sammendraget brukte publikummet (etter #969),
 * drilldownen bygde radene sine av innleveringer. Utfallet var to tall som motsa hverandre i samme
 * klikk — «10 innmeldte» på kursraden, 0 personer i detaljvisningen, tom CSV.
 *
 * Definisjonen er en UNION av tre kilder, og hver av dem er der av en grunn:
 *
 *   tildelt      `resolveCourseAudience` — individuelle innmeldinger + MANUAL/system-klasser
 *   fullført     har et kursbevis i vinduet — kan ha mistet tildelingen etterpå
 *   aktiv        har levert på en av kursets moduler — dekker ENTRA-klasser, som ikke er
 *                oppløsbare hos oss, og som derfor ikke finnes i den første kilden
 *
 * Den siste er lagt til etter at #969 alene KRYMPET nevneren for Entra-tildelte kurs: deltakere som
 * talte før (via innlevering) forsvant. Én fiks gjorde ett tall riktigere og et annet galere.
 *
 * At telleren er en delmengde av nevneren følger nå av konstruksjonen, ikke av en klipping — en
 * klipping ville skjult uenigheten i stedet for å fjerne den.
 */
async function resolveCourseParticipantIds(
  courseId: string,
  moduleIds: string[],
  filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit">,
): Promise<{
  participantIds: Set<string>;
  completions: Awaited<ReturnType<typeof courseRepository.findCourseCompletionsForLearnerReport>>;
  submissions: Awaited<ReturnType<typeof courseRepository.findLearnerSubmissionsForModules>>;
}> {
  const [audienceUserIds, completions, submissions] = await Promise.all([
    resolveReportAudienceIds(courseId, filters.orgUnit),
    courseRepository.findCourseCompletionsForLearnerReport(courseId, filters),
    courseRepository.findLearnerSubmissionsForModules(moduleIds, filters),
  ]);

  const participantIds = new Set(audienceUserIds);
  for (const completion of completions) participantIds.add(completion.userId);
  for (const submission of submissions) participantIds.add(submission.userId);

  return { participantIds, completions, submissions };
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
      // ⚠️ #966/#996: SAMME modulliste som drilldownen. Arkivfilteret ble først lagt bare i
      // drilldownen, og da sprikte de to flatene igjen: unionen «aktiv = har levert på en av
      // kursets moduler» ble regnet over ulike modulsett, så kursraden kunne si «10 innmeldte»
      // mens detaljvisningen viste 9 personer — og modullista viste fem moduler ved siden av rader
      // som sa «4/4». Det er nøyaktig selvmotsigelsen kommentaren over `resolveCourseParticipantIds`
      // sier ikke skal kunne oppstå.
      const activeModules = course.modules.filter((cm) => cm.module?.archivedAt == null);
      const { participantIds, completions } = await resolveCourseParticipantIds(
        course.id,
        activeModules.map((cm) => cm.moduleId),
        filters,
      );
      const enrolled = participantIds.size;
      const completed = completions.length;

      // ⚠️ #969/#996: modulraden hadde nøyaktig samme feil som kursraden, én etasje ned — telleren
      // var sertifiseringer i vinduet, nevneren innleveringer i vinduet, og de to målte ULIKE
      // mennesker. Med «siste 30 dager» kunne 12 beståtte deles på 3 innleveringer: 400 %.
      //
      // Modulnivået har ingen egen innmelding — man meldes inn i et KURS — så nevneren er kursets
      // publikum, det samme `participantIds` kursraden over bruker. Telleren er de av dem som
      // faktisk besto.
      //
      // Snittet er poenget, ikke en klipping til 100 %: en klipping ville skjult at de to tallene
      // var uenige. Nå er telleren en delmengde av nevneren per konstruksjon.
      // #966: arkiverte moduler utelates også her. En arkivert modul med egen pass-rate i lista,
      // ved siden av rader som sier «4/4», er det samme to-tall-problemet én etasje ned.
      const moduleBreakdown = await Promise.all(
        activeModules.map(async (cm) => {
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

  // #966 (produkteier 2026-08-25): «alle seksjoner må være lest». Rapporten stilte tidligere bare
  // modulkravet, og var dermed den ene av fem flatene som var uenig med bevisporten: en deltaker
  // med alle moduler bestått, men uleste seksjoner, sto som «Fullført» her — uten bevis og uten å
  // være ferdig.
  //
  // ⚠️ Arkiverte moduler filtreres nå bort, slik porten har gjort siden #945. Sto det igjen, ville
  // kravet vært uoppfyllelig for et kurs med en arkivert modul, og ingen ville nådd «Fullført» på
  // beregning. Feltet fantes ikke i spørringen før — se `findPublishedCoursesWithModuleDetails`.
  const moduleIds = course.modules
    .filter((moduleEntry) => moduleEntry.module?.archivedAt == null)
    .map((moduleEntry) => moduleEntry.moduleId);
  // ⚠️ #996: SAMME definisjon som sammendraget. Drilldownen bygde tidligere radene sine av
  // innleveringer og fullføringer alene, så en tildelt deltaker som ikke hadde startet fantes ikke
  // her — kursraden sa «10 innmeldte», detaljvisningen viste 0 personer, og CSV-en var tom.
  //
  // To tall som motsier hverandre i samme klikk er verre enn ett tall som er litt feil: brukeren vet
  // ikke hvilket å tro på, og begge ser autoritative ut.
  const { participantIds, completions, submissions } = await resolveCourseParticipantIds(
    course.id,
    moduleIds,
    filters,
  );

  // #966: seksjonskravet hentes fra SAMME dør som bevisporten bruker — deltakerdøra. Den utelater
  // seksjoner deltakeren ikke kan åpne, så et krav som aldri kan oppfylles kan ikke oppstå her.
  const participantItems = await courseRepository.findCourseItemsForParticipant(course.id);
  const requiredSectionIds = participantItems
    .filter((item) => item.itemType === "SECTION" && item.sectionId != null)
    .map((item) => item.sectionId as string);
  const requiredSectionIdSet = new Set(requiredSectionIds);

  const sectionReadRows = await courseRepository.findReadSectionIdsForCourseParticipants(
    course.id,
    Array.from(participantIds),
    filters,
  );
  const readSectionsByUser = new Map<string, Set<string>>();
  // #966: lesing er AKTIVITET. `hasStarted` teller den nå, så «Siste aktivitet» må gjøre det samme
  // — ellers sier raden «Pågår» ved siden av «Siste aktivitet: —» for en deltaker som bare har
  // lest, og de to kolonnene motsier hverandre.
  const latestReadByUser = new Map<string, Date>();
  for (const row of sectionReadRows) {
    if (!requiredSectionIdSet.has(row.sectionId)) continue;
    const set = readSectionsByUser.get(row.userId);
    if (set) set.add(row.sectionId);
    else readSectionsByUser.set(row.userId, new Set([row.sectionId]));
    const seen = latestReadByUser.get(row.userId);
    if (!seen || row.readAt > seen) latestReadByUser.set(row.userId, row.readAt);
  }

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

  // ⚠️ #996: de TILDELTE som ikke har rørt kurset ennå. De har verken innlevering eller kursbevis,
  // så de fantes ikke i noen av løkkene over — og det var nettopp derfor detaljvisningen kunne være
  // tom mens kursraden sa «10 innmeldte».
  //
  // De hentes til slutt, og bare de som mangler: en deltaker med aktivitet har allerede bedre data
  // fra sin egen innlevering. Ett oppslag, avgrenset til dem som faktisk trengs.
  const missingIds = [...participantIds].filter((id) => !learners.has(id));
  if (missingIds.length > 0) {
    for (const user of await findUsersByIds(missingIds)) {
      learners.set(user.id, {
        participantId: user.id,
        participantName: user.name,
        participantEmail: user.email,
        participantDepartment: user.department,
        completion: null,
        latestActivityAt: null,
        latestByModule: new Map<string, (typeof submissions)[number]>(),
      });
    }
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

    const readSections = readSectionsByUser.get(learner.participantId)?.size ?? 0;
    const latestRead = latestReadByUser.get(learner.participantId) ?? null;
    const latestActivityAt =
      latestRead && (!learner.latestActivityAt || latestRead > learner.latestActivityAt)
        ? latestRead
        : learner.latestActivityAt;

    // #966: kravet er moduler OG seksjoner, samme regnestykke som bevisporten og kurslista.
    // `hasStarted` teller nå også lesing: en deltaker som bare har lest, men ikke levert, er i gang
    // — ikke «ikke startet».
    const hasStarted = learner.latestByModule.size > 0 || readSections > 0 || Boolean(learner.completion);
    const completedModules = learner.completion ? moduleIds.length : passedModules;
    const status = learner.completion
      ? "COMPLETED"
      : computeCourseStatus(
          passedModules + readSections,
          moduleIds.length + requiredSectionIds.length,
          hasStarted,
        );

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
      // #966: seksjonene vises fordi de nå AVGJØR statusen. Uten dem ville raden kunne si
      // «4/4 moduler» ved siden av «Pågår», og rapportleseren hadde ingen måte å se hvorfor.
      readSections: learner.completion ? requiredSectionIds.length : readSections,
      totalSections: requiredSectionIds.length,
      score: scores.length > 0 ? round2(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      latestActivityAt: latestActivityAt?.toISOString() ?? null,
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
