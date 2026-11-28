import { prisma } from "../../db/prisma.js";
import { NotFoundError } from "../../errors/AppError.js";
import { deriveStatuses } from "./enrollmentService.js";
import { pairKey } from "./learnerVisibility.js";
import type { EnrollmentStatus } from "./enrollmentStatus.js";
import { enrollmentRepository } from "./enrollmentRepository.js";
import { classRepository } from "./classRepository.js";
import { findActiveParticipants } from "../../repositories/userRepository.js";
import { isReachableParticipant } from "../user/participantReach.js";
import { effectiveDeadline, type ClassDeadlineRow, type IndividualDeadlineRow } from "./effectiveDeadline.js";

// #498: teacher/SMO cohort-status dashboard. Aggregates the EnrollmentStatus (ASSIGNED / IN_PROGRESS /
// OVERDUE / COMPLETED) over a course's EFFECTIVE audience — individual CourseEnrollment rows plus
// class-assigned members (MANUAL classes + the "Alle deltakere" system class; ENTRA classes are not
// resolvable, mirroring the reminder job). One effective row per (user, course): an individual
// enrollment wins over a class assignment; among classes the earliest due date wins. This is the
// read-time analogue of the reminder job's audience expansion (courseReminderService.gatherCandidates),
// but course-scoped and NOT filtered on dueAt (the dashboard shows every participant, due or not).

const STATUSES: EnrollmentStatus[] = ["ASSIGNED", "IN_PROGRESS", "OVERDUE", "COMPLETED"];

type AudienceMember = {
  userId: string;
  /** Fristen etter `effectiveDeadline` (#1192 punkt 2): en tildeling til personen vinner, ellers den tidligste fra klassene. */
  dueAt: Date | null;
  dueSetAt: Date | null;
  source: "individual" | "class";
  classId: string | null;
  className: string | null;
};

export async function resolveCourseAudience(courseId: string): Promise<AudienceMember[]> {
  const map = new Map<string, AudienceMember>();
  // #1192 punkt 2: radene fristen regnes fra, per person. Medlemskap og kilde avgjøres som før; fristen til slutt, ett sted.
  const individualRow = new Map<string, IndividualDeadlineRow>();
  const classRows = new Map<string, ClassDeadlineRow[]>();

  // 1. Individual (explicitly assigned) enrolments — active (non-revoked) rows.
  // #968: samme regel som for klassemedlemmer under. Før talte en deaktivert deltaker med individuell
  // innmelding i publikummet, mens den samme via klasse ikke gjorde det — og påminnelsesjobben
  // hoppet over begge, så «purr» på dashbordet pekte på noen som aldri ville få purringen.
  const enrollments = await enrollmentRepository.findActiveEnrollmentsForCourse(courseId);
  for (const enrollment of enrollments) {
    if (!isReachableParticipant(enrollment.user)) continue;
    individualRow.set(enrollment.userId, { dueAt: enrollment.dueAt, dueSetAt: enrollment.dueSetAt, source: enrollment.source });
    map.set(enrollment.userId, {
      userId: enrollment.userId,
      dueAt: null,
      dueSetAt: null,
      source: "individual",
      classId: null,
      className: null,
    });
  }

  // 2. Class-assigned members. MANUAL = ClassMember rows; system "Alle deltakere" = all active
  //    participants; ENTRA = skipped (membership not resolvable at read time).
  const assignments = await classRepository.findCourseGroupAssignmentsForCourse(courseId);
  let allParticipants: Array<{ id: string; name: string; email: string }> | null = null;
  for (const assignment of assignments) {
    // #1017: vakt, ikke funksjon — ingen ENTRA-klasser kan opprettes i dag (se classConfig.ts).
    if (assignment.class.kind === "ENTRA") continue;
    const members: Array<{ id: string; activeStatus: boolean; isAnonymized: boolean }> = assignment.class.isSystem
      ? (allParticipants ??= await findActiveParticipants()).map((u) => ({ ...u, activeStatus: true, isAnonymized: false }))
      : assignment.class.members.map((m) => m.user);

    for (const user of members) {
      if (!isReachableParticipant(user)) continue;
      const rows = classRows.get(user.id) ?? [];
      rows.push({ dueAt: assignment.dueAt, dueSetAt: assignment.dueSetAt });
      classRows.set(user.id, rows);
      if (map.has(user.id)) continue;
      map.set(user.id, {
        userId: user.id,
        dueAt: null,
        dueSetAt: null,
        source: "class",
        classId: assignment.class.id,
        className: assignment.class.name,
      });
    }
  }

  // Fristen: en tildeling til personen vinner (også uten frist), en SELF-påmelding gjør det ikke; ellers den tidligste fra
  // klassene (`findCourseGroupAssignmentsForCourse` tar bare aktive klasser). Før vant enhver individuell rad, også SELF.
  for (const member of map.values()) {
    const deadline = effectiveDeadline({ individual: individualRow.get(member.userId), classes: classRows.get(member.userId) });
    member.dueAt = deadline.dueAt;
    member.dueSetAt = deadline.dueSetAt;
  }

  return Array.from(map.values());
}

export type CohortStatusCounts = Record<EnrollmentStatus, number>;

export type CohortClassBreakdown = {
  classId: string;
  className: string;
  total: number;
  counts: CohortStatusCounts;
};

export type CohortStatusSummary = {
  courseId: string;
  total: number;
  counts: CohortStatusCounts;
  byClass: CohortClassBreakdown[];
  generatedAt: string;
  // #967: ⚠️ publikum filtreres IKKE naar kurset er utilgjengelig — det ville tomt hele dashbordet
  // for en fagansvarlig som uttrykkelig spurte om DETTE kurset, uten aa si hvorfor. Tilstanden
  // rapporteres i stedet, saa flaten kan forklare hvorfor ingen beveger seg.
  //
  // Dette er motsatt av hva paaminnelsene gjoer med det samme faktumet, og med vilje: en
  // paaminnelse er en handling rettet mot en deltaker som ikke kan svare paa den. Et dashbord er
  // et spoersmaal fra en fagansvarlig som fortjener et aerlig svar.
  coursePublished: boolean;
  courseArchived: boolean;
};

function emptyCounts(): CohortStatusCounts {
  return { ASSIGNED: 0, IN_PROGRESS: 0, OVERDUE: 0, COMPLETED: 0 };
}

// #1156 (QA-porten): statusene for hele kullet i ett kall (`deriveStatuses`, et fast antall spørringer). Før gikk det én deltaker
// om gangen, og med lesing på tvers ble det 7–12 spørringer per person.
export async function getCohortStatus(courseId: string, now: Date = new Date()): Promise<CohortStatusSummary> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, publishedAt: true, archivedAt: true },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  const audience = await resolveCourseAudience(courseId);

  const counts = emptyCounts();
  const byClassMap = new Map<string, CohortClassBreakdown>();

  const statuses = await deriveStatuses(audience.map((member) => ({ userId: member.userId, courseId, dueAt: member.dueAt, dueSetAt: member.dueSetAt })), now);
  for (const member of audience) {
    const status = statuses.get(pairKey(member.userId, courseId))!;
    counts[status] += 1;
    if (member.classId) {
      let bucket = byClassMap.get(member.classId);
      if (!bucket) {
        bucket = { classId: member.classId, className: member.className ?? member.classId, total: 0, counts: emptyCounts() };
        byClassMap.set(member.classId, bucket);
      }
      bucket.counts[status] += 1;
      bucket.total += 1;
    }
  }

  return {
    courseId,
    total: audience.length,
    counts,
    byClass: Array.from(byClassMap.values()),
    generatedAt: now.toISOString(),
    coursePublished: course.publishedAt !== null,
    courseArchived: course.archivedAt !== null,
  };
}
