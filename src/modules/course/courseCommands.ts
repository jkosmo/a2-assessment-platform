import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes, agentAuthoringAuditMetadata, type AgentAuthoringContext } from "../../observability/auditEvents.js";
import { assertCourseHasNoInProgressParticipants } from "./contentLifecycle.js";

export async function createCourse(input: {
  title: string;
  description?: string | null;
  certificationLevel?: string | null;
  enrollmentPolicy?: "OPEN" | "RESTRICTED";
  discussionsEnabled?: boolean;
  actorId?: string;
  // AA-5 (#653): agent-orchestrated creates carry a trace in the audit metadata.
  agent?: AgentAuthoringContext;
}) {
  const course = await prisma.course.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      certificationLevel: input.certificationLevel ?? null,
      ...(input.enrollmentPolicy ? { enrollmentPolicy: input.enrollmentPolicy } : {}),
      ...(input.discussionsEnabled !== undefined ? { discussionsEnabled: input.discussionsEnabled } : {}),
    },
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: course.id,
    action: auditActions.course.created,
    actorId: input.actorId,
    metadata: { courseId: course.id, ...agentAuthoringAuditMetadata(input.agent) },
  });

  return course;
}

export async function updateCourse(
  courseId: string,
  input: {
    title?: string;
    description?: string | null;
    certificationLevel?: string | null;
    enrollmentPolicy?: "OPEN" | "RESTRICTED";
    discussionsEnabled?: boolean;
  },
) {
  return prisma.course.update({ where: { id: courseId }, data: input });
}

export async function publishCourse(courseId: string, actorId?: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { _count: { select: { items: { where: { itemType: "MODULE" } } } } },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  if (course._count.items === 0) {
    throw new ValidationError("Cannot publish a course with no modules.");
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { publishedAt: new Date() },
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.course.published,
    actorId,
    metadata: { courseId },
  });

  return updated;
}

// #705: avpubliser et kurs (motstykke til publishCourse). Symmetri med modul/seksjon.
// Bevisst UTEN G3-lås: avpublisering er reversibel (republiser når som helst) og er den «myke»
// måten å ta et kurs ned på mens noen er midt i det. Den harde G3-låsen gjelder kun arkivering
// (som er pensjonering). Frontend bekrefter avpublisering med en advarsel.
export async function unpublishCourse(courseId: string, actorId?: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { publishedAt: null },
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.course.unpublished,
    actorId,
    metadata: { courseId },
  });

  return updated;
}

export async function archiveCourse(courseId: string, actorId?: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  // G3 (aktivitets-lås): blokker arkivering så lenge noen har en påbegynt, ufullført gjennomføring.
  await assertCourseHasNoInProgressParticipants(courseId, "arkiveres");

  // I3: arkivering auto-avpubliserer (publishedAt nullstilles) så «arkivert men publisert» aldri
  // oppstår. Gjenopprett (restoreCourse) lander dermed i Utkast.
  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { archivedAt: new Date(), publishedAt: null },
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.course.archived,
    actorId,
    metadata: { courseId },
  });

  return updated;
}

// #673: gjenopprett et arkivert kurs (nullstill archivedAt). Motstykke til archiveCourse.
export async function restoreCourse(courseId: string, actorId?: string) {
  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { archivedAt: null },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.course.restored,
    actorId,
    metadata: { courseId },
  });
  return updated;
}

export async function deleteCourse(courseId: string, actorId?: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  // #660: CourseCompletion.course is onDelete: Restrict (issued certificates are achievement
  // records we never silently destroy). Without this guard, course.delete fails with a raw FK
  // violation and the route surfaces a generic 500. Block with a clear message and point the
  // author at archiving (the soft-delete) instead.
  const completionCount = await prisma.courseCompletion.count({ where: { courseId } });
  if (completionCount > 0) {
    throw new ValidationError(
      `Cannot delete a course that has ${completionCount} completion${completionCount === 1 ? "" : "s"} ` +
        `(issued certificates). Archive the course instead to keep the completion records.`,
    );
  }

  await runInTransaction(async (tx) => {
    await tx.course.delete({ where: { id: courseId } });
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    // #705: a delete is a delete — was previously mislogged as `archived`.
    action: auditActions.course.deleted,
    actorId,
    metadata: { courseId },
  });
}

export type CourseItemInput =
  | { type: "MODULE"; moduleId: string; discussionsEnabled?: boolean }
  | { type: "SECTION"; sectionId: string; discussionsEnabled?: boolean };

// Sets the full ordered sequence of a course's items — modules and learning
// sections interleaved (#486/B2). sortOrder follows array position. During the
// expand-contract transition this also re-syncs CourseModule from the MODULE
// items so the not-yet-cut-over read paths stay correct.
export async function setCourseItems(
  courseId: string,
  items: CourseItemInput[],
  // AA-5 (#653): audited write; agent runs stamp source/agentRunId into the metadata.
  options?: { actorId?: string; agent?: AgentAuthoringContext },
) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  const moduleIds = items.flatMap((i) => (i.type === "MODULE" ? [i.moduleId] : []));
  const sectionIds = items.flatMap((i) => (i.type === "SECTION" ? [i.sectionId] : []));
  if (new Set(moduleIds).size !== moduleIds.length) {
    throw new ValidationError("A module may appear only once in a course.");
  }
  if (new Set(sectionIds).size !== sectionIds.length) {
    throw new ValidationError("A section may appear only once in a course.");
  }
  if (moduleIds.length > 0) {
    const found = await prisma.module.count({ where: { id: { in: moduleIds } } });
    if (found !== moduleIds.length) throw new ValidationError("One or more modules do not exist.");
  }
  if (sectionIds.length > 0) {
    const found = await prisma.courseSection.count({ where: { id: { in: sectionIds } } });
    if (found !== sectionIds.length) throw new ValidationError("One or more sections do not exist.");
  }

  // #502: CourseItem er eneste sannhetskilde — ingen dual-write til CourseModule lenger.
  const result = await runInTransaction(async (tx) => {
    await tx.courseItem.deleteMany({ where: { courseId } });
    if (items.length > 0) {
      await tx.courseItem.createMany({
        data: items.map((item, index) => ({
          courseId,
          sortOrder: index,
          itemType: item.type,
          moduleId: item.type === "MODULE" ? item.moduleId : null,
          sectionId: item.type === "SECTION" ? item.sectionId : null,
          // #495/T-QA-4: per-element diskusjons-toggle. Editoren sender full ønsket tilstand;
          // default true når feltet ikke er med (bakoverkompatibelt).
          discussionsEnabled: item.discussionsEnabled ?? true,
        })),
      });
    }
    await tx.course.update({ where: { id: courseId }, data: { updatedAt: new Date() } });
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.course.itemsUpdated,
    actorId: options?.actorId,
    metadata: { courseId, itemCount: items.length, ...agentAuthoringAuditMetadata(options?.agent) },
  });
  return result;
}

// Legacy modules-only setter (import + admin PUT /modules). #502: skriver nå CourseItem MODULE-
// elementer i stedet for CourseModule. Erstatter modul-elementene; eventuelle SECTION-elementer
// bevares (re-indekseres etter modulene for stabil sortOrder).
export async function setCourseModules(
  courseId: string,
  modules: Array<{ moduleId: string; sortOrder: number }>,
) {
  return runInTransaction(async (tx) => {
    const sections = await tx.courseItem.findMany({
      where: { courseId, itemType: "SECTION" },
      orderBy: { sortOrder: "asc" },
      select: { sectionId: true, discussionsEnabled: true },
    });
    await tx.courseItem.deleteMany({ where: { courseId } });
    // Bevar den passerte sortOrder for moduler (uendret kontrakt fra før #502); seksjoner legges
    // etter høyeste modul-sortOrder så de overlever en modul-re-set.
    const moduleRows = modules.map((m) => ({
      courseId,
      itemType: "MODULE" as const,
      moduleId: m.moduleId,
      sortOrder: m.sortOrder,
    }));
    const maxModuleOrder = moduleRows.reduce((max, r) => Math.max(max, r.sortOrder), -1);
    const sectionRows = sections.map((s, i) => ({
      courseId,
      itemType: "SECTION" as const,
      sectionId: s.sectionId,
      sortOrder: maxModuleOrder + 1 + i,
      discussionsEnabled: s.discussionsEnabled,
    }));
    if (moduleRows.length + sectionRows.length > 0) {
      await tx.courseItem.createMany({ data: [...moduleRows, ...sectionRows] });
    }
    await tx.course.update({
      where: { id: courseId },
      data: { updatedAt: new Date() },
    });
  });
}
