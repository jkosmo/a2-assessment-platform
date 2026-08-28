import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import { hasAnyRole, PARTICIPANTS } from "../../auth/roleSets.js";
import { sendCourseAssignmentNotification } from "../certification/participantNotificationService.js";
import { classRepository, createClassRepository, SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "./classRepository.js";
import { isClassEntraLinkingEnabled } from "./classConfig.js";
import { addContentOwner } from "../content/contentOwnershipService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { operationalEvents } from "../../observability/operationalEvents.js";

// #645/CL-2: class (cohort) business logic — CRUD + membership + course assignment + dynamic
// membership evaluation. Course→class assignment is dynamic: a participant is assigned a course if
// they belong to an assigned class, evaluated at read time (never materialised to CourseEnrollment).

async function requireClass(classId: string) {
  const klass = await classRepository.findClassById(classId);
  if (!klass) throw new NotFoundError("Class", "class_not_found", "Class not found.");
  return klass;
}

export async function createClass(input: { name: string; description?: string | null }, actorId: string | null) {
  const name = input.name?.trim();
  if (!name) throw new ValidationError("Class name is required.");
  const created = await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    const klass = await repo.createClass({ name, description: input.description ?? null, createdById: actorId });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: klass.id,
        action: auditActions.class.created,
        actorId: actorId ?? undefined,
        metadata: { classId: klass.id, name },
      },
      tx,
    );
    return klass;
  });
  // #787 slice 4a: creator becomes sole initial owner (inert until 4b enforcement).
  if (actorId) {
    await addContentOwner({ contentType: "CLASS", contentId: created.id, ownerUserId: actorId, actorUserId: actorId });
  }
  return created;
}

export async function archiveClass(classId: string, actorId: string | null) {
  const klass = await requireClass(classId);
  if (klass.isSystem) throw new ValidationError("System classes cannot be archived.");
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    await repo.archiveClass(classId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.archived,
        actorId: actorId ?? undefined,
        metadata: { classId },
      },
      tx,
    );
  });
}

export async function restoreClass(classId: string, actorId: string | null) {
  const klass = await requireClass(classId);
  if (klass.isSystem) throw new ValidationError("System classes are never archived.");
  if (!klass.archivedAt) return; // already active — idempotent no-op
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    await repo.restoreClass(classId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.restored,
        actorId: actorId ?? undefined,
        metadata: { classId },
      },
      tx,
    );
  });
}

export async function addMember(classId: string, userId: string, actorId: string | null) {
  const klass = await requireClass(classId);
  if (klass.isSystem || klass.kind !== "MANUAL") {
    throw new ValidationError("Members can only be managed on manual (non-system) classes.");
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new ValidationError(`Unknown user id: ${userId}.`);
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    await repo.addMember(classId, userId, actorId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.memberAdded,
        actorId: actorId ?? undefined,
        metadata: { classId, userId },
      },
      tx,
    );
  });
}

export async function removeMember(classId: string, userId: string, actorId: string | null) {
  await requireClass(classId);
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    const result = await repo.removeMember(classId, userId);
    if (result.count > 0) {
      await recordAuditEvent(
        {
          entityType: auditEntityTypes.class,
          entityId: classId,
          action: auditActions.class.memberRemoved,
          actorId: actorId ?? undefined,
          metadata: { classId, userId },
        },
        tx,
      );
    }
  });
}

export async function listClasses() {
  return classRepository.listClasses();
}

export async function listClassMembers(classId: string) {
  await requireClass(classId);
  const members = await classRepository.listMembers(classId);
  return members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, addedAt: m.addedAt.toISOString() }));
}

export async function listClassCourseAssignments(classId: string) {
  await requireClass(classId);
  const rows = await classRepository.listCourseAssignmentsForClass(classId);
  return rows.map((r) => ({
    courseId: r.courseId,
    title: r.course.title,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    // #967: en tildeling til et kurs deltakeren ikke kan aapne er ikke feil i seg selv — men den
    // forklarer hvorfor ingen i klassen beveger seg, og det skal ikke kreve detektivarbeid.
    coursePublished: r.course.publishedAt !== null,
    courseArchived: r.course.archivedAt !== null,
  }));
}

export async function assignCourseToClass(courseId: string, classId: string, dueAt: Date | null, actorId: string | null) {
  const klass = await requireClass(classId);
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, archivedAt: true, publishedAt: true },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  // #688: archived courses are retired and must not be assignable to a class.
  if (course.archivedAt) throw new ValidationError("Cannot assign an archived course.");
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    await repo.assignCourseToClass(courseId, classId, dueAt, actorId);
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.class,
        entityId: classId,
        action: auditActions.class.courseAssigned,
        actorId: actorId ?? undefined,
        metadata: { classId, courseId },
      },
      tx,
    );
  });

  // #684: email the members that their class was assigned a course. Skipped for the "Alle deltakere"
  // system class (would email the whole org) and for ENTRA classes (no stored member rows). Fire-and-
  // forget so the assignment is not blocked or failed by email delivery.
  //
  // #967: ⚠️ men ikke for et UPUBLISERT kurs. E-posten sier «Logg inn på plattformen for å starte»,
  // og medlemmet logger inn og finner ingenting — kurset er usynlig for deltakere til det
  // publiseres. Med #967 er påminnelsene dessuten stille, så denne e-posten ville vært det ENESTE
  // deltakeren noensinne hørte om kurset.
  //
  // Tildelingen blokkeres IKKE: «tildel utkast nå, publiser senere» er en legitim arbeidsflyt, og
  // #688 blokkerer allerede det som virkelig er feil (arkiverte kurs). Det er varselet som er
  // feiltimet, ikke tildelingen. Undertrykkelsen logges — en e-post som aldri kom er stille.
  if (klass.kind === "MANUAL" && !klass.isSystem) {
    if (course.publishedAt === null) {
      void suppressAssignmentMail(courseId, classId);
    } else {
      void notifyClassMembersOfCourseAssignment(classId, klass.name, course.title, dueAt);
    }
  }
}

async function suppressAssignmentMail(courseId: string, classId: string): Promise<void> {
  try {
    const members = await classRepository.listMembers(classId);
    logOperationalEvent(
      operationalEvents.course.assignmentMailSuppressed,
      {
        courseId,
        classId,
        recipientCount: members.filter((m) => m.user.email).length,
        reason: "unpublished",
      },
      "info",
    );
  } catch {
    /* en uteblitt logglinje skal aldri velte en tildeling som allerede er skrevet */
  }
}

async function notifyClassMembersOfCourseAssignment(
  classId: string,
  className: string,
  courseTitleJson: string,
  dueAt: Date | null,
): Promise<void> {
  try {
    const courseTitle = localizeContentText("nb", courseTitleJson) ?? courseTitleJson;
    const members = await classRepository.listMembers(classId);
    await Promise.allSettled(
      members
        .filter((m) => m.user.email)
        .map((m) =>
          sendCourseAssignmentNotification({
            recipientEmail: m.user.email,
            recipientName: m.user.name,
            courseTitle,
            className,
            dueAt,
          }),
        ),
    );
  } catch {
    /* never let notification failure surface — assignment already succeeded */
  }
}

export async function unassignCourseFromClass(courseId: string, classId: string, actorId: string | null) {
  await runInTransaction(async (tx) => {
    const repo = createClassRepository(tx);
    const result = await repo.unassignCourseFromClass(courseId, classId);
    if (result.count > 0) {
      await recordAuditEvent(
        {
          entityType: auditEntityTypes.class,
          entityId: classId,
          action: auditActions.class.courseUnassigned,
          actorId: actorId ?? undefined,
          metadata: { classId, courseId },
        },
        tx,
      );
    }
  });
}

export interface UserMembershipContext {
  userId: string;
  roles: string[];
  groupIds?: string[];
}

/**
 * The set of class ids a user belongs to, resolved dynamically:
 *  - the "Alle deltakere" system class if the user has the PARTICIPANT role,
 *  - every MANUAL class they are an explicit member of,
 *  - (only when `classEntraLinkingEnabled`) ENTRA classes whose group is in the user's token groups.
 */
export async function getUserClassIds(ctx: UserMembershipContext): Promise<Set<string>> {
  const ids = new Set<string>();
  // #962: går gjennom det delte oppslaget som alt annet. Merk at dette IKKE er en tilgangsvakt —
  // det er medlemskapsutledning: «er denne personen deltaker» avgjør om systemklassen gjelder.
  // Skillet er verdt å holde: en vakt nekter, dette utvider.
  if (hasAnyRole(ctx.roles, PARTICIPANTS)) ids.add(SYSTEM_ALL_PARTICIPANTS_CLASS_ID);

  const manual = await classRepository.findManualMembership(ctx.userId);
  for (const m of manual) ids.add(m.classId);

  if ((ctx.groupIds?.length ?? 0) > 0 && (await isClassEntraLinkingEnabled())) {
    const entraClasses = await prisma.class.findMany({
      where: { kind: "ENTRA", archivedAt: null, entraGroupId: { in: ctx.groupIds as string[] } },
      select: { id: true },
    });
    for (const c of entraClasses) ids.add(c.id);
  }
  return ids;
}

/**
 * course id → earliest (most urgent) due date, for the courses assigned to any of `classIds`.
 * Used by the visibility filter and "my enrollments" to surface class-assigned courses dynamically.
 */
export async function getClassAssignedCourseDueDates(classIds: Set<string>): Promise<Map<string, Date | null>> {
  if (classIds.size === 0) return new Map();
  const rows = await prisma.courseGroupAssignment.findMany({
    where: { classId: { in: [...classIds] } },
    select: { courseId: true, dueAt: true },
  });
  const map = new Map<string, Date | null>();
  for (const r of rows) {
    if (!map.has(r.courseId)) {
      map.set(r.courseId, r.dueAt);
    } else {
      const existing = map.get(r.courseId) ?? null;
      if (r.dueAt && (!existing || r.dueAt < existing)) map.set(r.courseId, r.dueAt);
    }
  }
  return map;
}
