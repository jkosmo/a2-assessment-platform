import { prisma } from "../../db/prisma.js";
import { NotFoundError } from "../../errors/AppError.js";
import { deriveStatus } from "./enrollmentService.js";
import type { EnrollmentStatus } from "./enrollmentStatus.js";
import { enrollmentRepository } from "./enrollmentRepository.js";
import { classRepository } from "./classRepository.js";
import { findActiveParticipants } from "../../repositories/userRepository.js";

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
  dueAt: Date | null;
  source: "individual" | "class";
  classId: string | null;
  className: string | null;
};

export async function resolveCourseAudience(courseId: string): Promise<AudienceMember[]> {
  const map = new Map<string, AudienceMember>();

  // 1. Individual (explicitly assigned) enrolments — active (non-revoked) rows.
  const enrollments = await enrollmentRepository.findActiveEnrollmentsForCourse(courseId);
  for (const enrollment of enrollments) {
    map.set(enrollment.userId, {
      userId: enrollment.userId,
      dueAt: enrollment.dueAt,
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
    if (assignment.class.kind === "ENTRA") continue;
    const members: Array<{ id: string; activeStatus: boolean; isAnonymized: boolean }> = assignment.class.isSystem
      ? (allParticipants ??= await findActiveParticipants()).map((u) => ({ ...u, activeStatus: true, isAnonymized: false }))
      : assignment.class.members.map((m) => m.user);

    for (const user of members) {
      if (!user.activeStatus || user.isAnonymized) continue;
      const existing = map.get(user.id);
      if (existing) {
        // Individual wins; among class assignments keep the earliest due date.
        if (existing.source === "class" && assignment.dueAt && (!existing.dueAt || assignment.dueAt < existing.dueAt)) {
          existing.dueAt = assignment.dueAt;
        }
        continue;
      }
      map.set(user.id, {
        userId: user.id,
        dueAt: assignment.dueAt,
        source: "class",
        classId: assignment.class.id,
        className: assignment.class.name,
      });
    }
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
};

function emptyCounts(): CohortStatusCounts {
  return { ASSIGNED: 0, IN_PROGRESS: 0, OVERDUE: 0, COMPLETED: 0 };
}

// NOTE: deriveStatus runs 1–2 queries per audience member (completion lookup + started probe). Fine for
// typical cohorts; batch the completion/started lookups if cohorts grow large.
export async function getCohortStatus(courseId: string, now: Date = new Date()): Promise<CohortStatusSummary> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  const audience = await resolveCourseAudience(courseId);

  const counts = emptyCounts();
  const byClassMap = new Map<string, CohortClassBreakdown>();

  for (const member of audience) {
    const status = await deriveStatus(member.userId, courseId, member.dueAt, now);
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
  };
}
