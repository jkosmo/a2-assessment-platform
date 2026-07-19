import type { CourseEnrollmentSource, AppRole as AppRoleType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { enrollmentRepository } from "./enrollmentRepository.js";
import { deriveEnrollmentStatus, type EnrollmentStatus } from "./enrollmentStatus.js";
import { getUserClassIds, getClassAssignedCourseDueDates } from "./classService.js";

// #496/EN-2: enrollment service — assign/revoke/list + self-enroll + course visibility. Status is
// always DERIVED here (never stored) from CourseCompletion + progress + dueAt, so it cannot drift.

export interface AssignEnrollmentsInput {
  userIds?: string[];
  department?: string | null;
  dueAt?: Date | null;
}

export interface AssignEnrollmentsResult {
  assignedUserIds: string[];
  source: CourseEnrollmentSource;
}

async function requireCourse(courseId: string): Promise<{ id: string; enrollmentPolicy: string }> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, enrollmentPolicy: true },
  });
  if (!course) {
    throw new NotFoundError("Course", "course_not_found", "Course not found.");
  }
  return course;
}

/**
 * Assign a course to participants — either an explicit list of users (source=INDIVIDUAL) or all
 * active users in a department (source=DEPARTMENT, materialised to individual rows at assign time).
 * Idempotent per user (upsert clears a prior revoke). Each assignment is audited.
 *
 * NB (#645): department assignment finds no users until User.department is populated from Entra;
 * individual assignment is the primary path until then.
 */
export async function assignEnrollments(
  courseId: string,
  input: AssignEnrollmentsInput,
  actorId: string | null,
): Promise<AssignEnrollmentsResult> {
  await requireCourse(courseId);

  const byDepartment = typeof input.department === "string" && input.department.trim().length > 0;
  const explicitUserIds = (input.userIds ?? []).filter((id) => typeof id === "string" && id.length > 0);
  if (!byDepartment && explicitUserIds.length === 0) {
    throw new ValidationError("Provide userIds or a department to assign.");
  }
  const source: CourseEnrollmentSource = byDepartment ? "DEPARTMENT" : "INDIVIDUAL";

  let userIds = explicitUserIds;
  if (byDepartment) {
    const deptUsers = await prisma.user.findMany({
      where: { department: input.department as string, activeStatus: true, isAnonymized: false },
      select: { id: true },
    });
    userIds = deptUsers.map((u) => u.id);
  } else {
    // Validate the explicit ids exist so we never create dangling enrollments.
    const found = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } });
    const foundIds = new Set(found.map((u) => u.id));
    const missing = userIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`Unknown user id(s): ${missing.join(", ")}.`);
    }
  }

  const assignedUserIds: string[] = [];
  for (const userId of userIds) {
    await enrollmentRepository.assignEnrollment({
      userId,
      courseId,
      assignedById: actorId,
      source,
      dueAt: input.dueAt ?? null,
    });
    await recordAuditEvent({
      entityType: auditEntityTypes.course,
      entityId: courseId,
      action: auditActions.enrollment.assigned,
      actorId: actorId ?? undefined,
      metadata: { userId, courseId, source },
    });
    assignedUserIds.push(userId);
  }

  return { assignedUserIds, source };
}

/** Soft-revoke a participant's enrollment. No-op (still 200) if there was no active enrollment. */
export async function revokeEnrollment(courseId: string, userId: string, actorId: string | null): Promise<void> {
  await requireCourse(courseId);
  const result = await enrollmentRepository.revokeEnrollment(userId, courseId);
  if (result.count > 0) {
    await recordAuditEvent({
      entityType: auditEntityTypes.course,
      entityId: courseId,
      action: auditActions.enrollment.revoked,
      actorId: actorId ?? undefined,
      metadata: { userId, courseId },
    });
  }
}

/**
 * Self-enrolment: a participant enrols themselves on an OPEN course (source=SELF). RESTRICTED
 * courses cannot be self-enrolled — they require an SMO/admin assignment.
 */
export async function selfEnroll(courseId: string, userId: string): Promise<void> {
  const course = await requireCourse(courseId);
  if (course.enrollmentPolicy !== "OPEN") {
    throw new ValidationError("This course is restricted — self-enrolment is not allowed.");
  }
  await enrollmentRepository.assignEnrollment({
    userId,
    courseId,
    assignedById: null,
    source: "SELF",
    dueAt: null,
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.enrollment.selfEnrolled,
    actorId: userId,
    metadata: { userId, courseId },
  });
}

// Lightweight "has the user begun this course" probe used for IN_PROGRESS derivation: a read
// section OR any submission against one of the course's modules.
async function hasUserStartedCourse(userId: string, courseId: string): Promise<boolean> {
  const reads = await prisma.courseSectionRead.count({ where: { userId, courseId } });
  if (reads > 0) return true;
  const submissions = await prisma.submission.count({
    where: { userId, module: { courseItems: { some: { courseId } } } },
  });
  return submissions > 0;
}

export async function deriveStatus(userId: string, courseId: string, dueAt: Date | null, now: Date): Promise<EnrollmentStatus> {
  const completion = await prisma.courseCompletion.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  const hasStarted = completion ? true : await hasUserStartedCourse(userId, courseId);
  return deriveEnrollmentStatus({ isCompleted: !!completion, hasStarted, dueAt, now });
}

export interface UserEnrollmentView {
  courseId: string;
  source: CourseEnrollmentSource;
  dueAt: string | null;
  assignedAt: string;
  status: EnrollmentStatus;
}

/** A participant's active enrolments, each with derived status. */
export async function listUserEnrollments(userId: string, now: Date = new Date()): Promise<UserEnrollmentView[]> {
  const enrollments = await enrollmentRepository.findActiveEnrollmentsForUser(userId);
  return Promise.all(
    enrollments.map(async (e) => ({
      courseId: e.courseId,
      source: e.source,
      dueAt: e.dueAt ? e.dueAt.toISOString() : null,
      assignedAt: e.assignedAt.toISOString(),
      status: await deriveStatus(userId, e.courseId, e.dueAt, now),
    })),
  );
}

export interface CourseEnrollmentView {
  userId: string;
  name: string;
  email: string;
  department: string | null;
  source: CourseEnrollmentSource;
  dueAt: string | null;
  assignedAt: string;
  status: EnrollmentStatus;
}

/** All active enrolments on a course (admin view), each with the participant and derived status. */
export async function listCourseEnrollments(courseId: string, now: Date = new Date()): Promise<CourseEnrollmentView[]> {
  await requireCourse(courseId);
  const enrollments = await enrollmentRepository.findActiveEnrollmentsForCourse(courseId);
  return Promise.all(
    enrollments.map(async (e) => ({
      userId: e.userId,
      name: e.user.name,
      email: e.user.email,
      department: e.user.department,
      source: e.source,
      dueAt: e.dueAt ? e.dueAt.toISOString() : null,
      assignedAt: e.assignedAt.toISOString(),
      status: await deriveStatus(e.userId, courseId, e.dueAt, now),
    })),
  );
}

/**
 * Course visibility (#496): OPEN courses are visible to everyone; RESTRICTED courses only to users
 * with an active enrolment OR a class assignment (#645/CL-2). `classAssignedCourseIds` is the set of
 * course ids assigned to a class the user belongs to — computed by the caller via classService.
 */
export async function filterVisibleCourseIds(
  userId: string,
  courses: Array<{ id: string; enrollmentPolicy: string }>,
  classAssignedCourseIds: Set<string> = new Set(),
): Promise<Set<string>> {
  const restrictedIds = courses.filter((c) => c.enrollmentPolicy !== "OPEN").map((c) => c.id);
  const visible = new Set<string>(courses.filter((c) => c.enrollmentPolicy === "OPEN").map((c) => c.id));
  for (const id of restrictedIds) {
    if (classAssignedCourseIds.has(id)) visible.add(id);
  }
  const stillRestricted = restrictedIds.filter((id) => !visible.has(id));
  if (stillRestricted.length > 0) {
    const enrolled = await prisma.courseEnrollment.findMany({
      where: { userId, revokedAt: null, courseId: { in: stillRestricted } },
      select: { courseId: true },
    });
    for (const row of enrolled) visible.add(row.courseId);
  }
  return visible;
}

/**
 * #778/#785: single-course visibility guard for the direct course endpoints (detail / section
 * content / mark-read). The course LIST endpoint filters by `filterVisibleCourseIds`, but the direct
 * endpoints gated only on `publishedAt`, so an unenrolled participant with a RESTRICTED course id
 * could read its content. This mirrors the list logic for one already-fetched course. OPEN
 * short-circuits (no class/enrolment lookups); RESTRICTED requires an enrolment OR class assignment.
 */
export async function isCourseVisibleToUser(input: {
  course: { id: string; enrollmentPolicy: string };
  userId: string;
  roles: AppRoleType[];
  groupIds?: string[];
}): Promise<boolean> {
  if (input.course.enrollmentPolicy === "OPEN") return true;
  const classIds = await getUserClassIds({
    userId: input.userId,
    roles: input.roles,
    groupIds: input.groupIds,
  });
  const classCourseDue = await getClassAssignedCourseDueDates(classIds);
  const visible = await filterVisibleCourseIds(input.userId, [input.course], new Set(classCourseDue.keys()));
  return visible.has(input.course.id);
}

// #495-follow-up (PARTICIPANT_COURSE_ONLY): er modulen del av et publisert kurs som brukeren har
// tilgang til? Brukes til å gate frittstående modul-innlevering for deltakere — modul tatt via
// course player passerer (modulen ligger jo i et tilgjengelig kurs).
export async function isModuleInAccessibleCourse(input: {
  moduleId: string;
  userId: string;
  roles: AppRoleType[];
  groupIds?: string[];
}): Promise<boolean> {
  const links = await prisma.courseItem.findMany({
    where: { moduleId: input.moduleId },
    select: { courseId: true },
  });
  const courseIds = [...new Set(links.map((l) => l.courseId))];
  if (courseIds.length === 0) return false;

  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds }, publishedAt: { not: null }, archivedAt: null },
    select: { id: true, enrollmentPolicy: true },
  });
  if (courses.length === 0) return false;

  const classIds = await getUserClassIds({
    userId: input.userId,
    roles: input.roles,
    groupIds: input.groupIds,
  });
  const classCourseDue = await getClassAssignedCourseDueDates(classIds);
  const visible = await filterVisibleCourseIds(input.userId, courses, new Set(classCourseDue.keys()));
  return courses.some((c) => visible.has(c.id));
}
