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

export async function setCourseModules(
  courseId: string,
  modules: Array<{ moduleId: string; sortOrder: number }>,
) {
  return runInTransaction(async (tx) => {
    await tx.courseModule.deleteMany({ where: { courseId } });
    if (modules.length > 0) {
      await tx.courseModule.createMany({
        data: modules.map((m) => ({ courseId, moduleId: m.moduleId, sortOrder: m.sortOrder })),
      });
    }
  });
}
