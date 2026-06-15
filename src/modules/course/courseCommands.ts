import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";

export async function createCourse(input: {
  title: string;
  description?: string | null;
  certificationLevel?: string | null;
  actorId?: string;
}) {
  const course = await prisma.course.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      certificationLevel: input.certificationLevel ?? null,
    },
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: course.id,
    action: auditActions.course.created,
    actorId: input.actorId,
    metadata: { courseId: course.id },
  });

  return course;
}

export async function updateCourse(
  courseId: string,
  input: { title?: string; description?: string | null; certificationLevel?: string | null },
) {
  return prisma.course.update({ where: { id: courseId }, data: input });
}

export async function publishCourse(courseId: string, actorId?: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { _count: { select: { modules: true } } },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  if (course._count.modules === 0) {
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

export async function archiveCourse(courseId: string, actorId?: string) {
  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { archivedAt: new Date() },
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

export async function deleteCourse(courseId: string, actorId?: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");

  await runInTransaction(async (tx) => {
    await tx.courseModule.deleteMany({ where: { courseId } });
    await tx.course.delete({ where: { id: courseId } });
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.course.archived,
    actorId,
    metadata: { courseId },
  });
}

export type CourseItemInput =
  | { type: "MODULE"; moduleId: string }
  | { type: "SECTION"; sectionId: string };

// Sets the full ordered sequence of a course's items — modules and learning
// sections interleaved (#486/B2). sortOrder follows array position. During the
// expand-contract transition this also re-syncs CourseModule from the MODULE
// items so the not-yet-cut-over read paths stay correct.
export async function setCourseItems(courseId: string, items: CourseItemInput[]) {
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

  return runInTransaction(async (tx) => {
    await tx.courseItem.deleteMany({ where: { courseId } });
    await tx.courseModule.deleteMany({ where: { courseId } });
    if (items.length > 0) {
      await tx.courseItem.createMany({
        data: items.map((item, index) => ({
          courseId,
          sortOrder: index,
          itemType: item.type,
          moduleId: item.type === "MODULE" ? item.moduleId : null,
          sectionId: item.type === "SECTION" ? item.sectionId : null,
        })),
      });
      const moduleRows = items
        .map((item, index) => ({ item, index }))
        .filter((entry): entry is { item: { type: "MODULE"; moduleId: string }; index: number } => entry.item.type === "MODULE")
        .map(({ item, index }) => ({ courseId, moduleId: item.moduleId, sortOrder: index }));
      if (moduleRows.length > 0) {
        await tx.courseModule.createMany({ data: moduleRows });
      }
    }
    await tx.course.update({ where: { id: courseId }, data: { updatedAt: new Date() } });
  });
}

export async function setCourseModules(
  courseId: string,
  modules: Array<{ moduleId: string; sortOrder: number }>,
) {
  return runInTransaction(async (tx) => {
    await tx.courseModule.deleteMany({ where: { courseId } });
    // Dual-write to CourseItem (#480 expand-contract). Only MODULE items are
    // managed here so any future SECTION items survive a module re-order.
    await tx.courseItem.deleteMany({ where: { courseId, itemType: "MODULE" } });
    if (modules.length > 0) {
      await tx.courseModule.createMany({
        data: modules.map((m) => ({ courseId, moduleId: m.moduleId, sortOrder: m.sortOrder })),
      });
      await tx.courseItem.createMany({
        data: modules.map((m) => ({
          courseId,
          itemType: "MODULE" as const,
          moduleId: m.moduleId,
          sortOrder: m.sortOrder,
        })),
      });
    }
    await tx.course.update({
      where: { id: courseId },
      data: { updatedAt: new Date() },
    });
  });
}
