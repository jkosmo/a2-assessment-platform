import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";

// Section CRUD + versioning (#485/B1) for course learning sections (#476).
// Mirrors Module/ModuleVersion: editing content publishes an immutable new
// version and re-points activeVersionId (latest-wins in v1.3.x). Localized
// fields (title, bodyMarkdown) arrive already serialized to JSON strings by the
// route layer, exactly like createCourse.

export async function createSection(input: { title: string; bodyMarkdown: string; actorId?: string }) {
  return runInTransaction(async (tx) => {
    const section = await tx.courseSection.create({ data: { title: input.title } });
    const version = await tx.courseSectionVersion.create({
      data: {
        sectionId: section.id,
        versionNo: 1,
        bodyMarkdown: input.bodyMarkdown,
        publishedBy: input.actorId ?? null,
        publishedAt: new Date(),
      },
    });
    return tx.courseSection.update({
      where: { id: section.id },
      data: { activeVersionId: version.id },
      include: { activeVersion: true },
    });
  });
}

export async function updateSectionTitle(sectionId: string, title: string) {
  await assertSectionExists(sectionId);
  return prisma.courseSection.update({
    where: { id: sectionId },
    data: { title },
    include: { activeVersion: true },
  });
}

export async function updateSectionContent(sectionId: string, bodyMarkdown: string, actorId?: string) {
  await assertSectionExists(sectionId);
  return runInTransaction(async (tx) => {
    const last = await tx.courseSectionVersion.findFirst({
      where: { sectionId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    const version = await tx.courseSectionVersion.create({
      data: {
        sectionId,
        versionNo: (last?.versionNo ?? 0) + 1,
        bodyMarkdown,
        publishedBy: actorId ?? null,
        publishedAt: new Date(),
      },
    });
    return tx.courseSection.update({
      where: { id: sectionId },
      data: { activeVersionId: version.id, updatedAt: new Date() },
      include: { activeVersion: true },
    });
  });
}

export function getSection(sectionId: string) {
  return prisma.courseSection.findUnique({
    where: { id: sectionId },
    include: { activeVersion: true },
  });
}

export function listSections() {
  return prisma.courseSection.findMany({
    orderBy: { updatedAt: "desc" },
    include: { activeVersion: { select: { id: true, versionNo: true, publishedAt: true } } },
  });
}

export async function deleteSection(sectionId: string) {
  await assertSectionExists(sectionId);
  const references = await prisma.courseItem.count({ where: { sectionId } });
  if (references > 0) {
    throw new ValidationError("Cannot delete a section that is used in one or more courses.");
  }
  await runInTransaction(async (tx) => {
    // Detach activeVersion FK before deleting versions to avoid the self-reference.
    await tx.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
    await tx.courseSectionVersion.deleteMany({ where: { sectionId } });
    await tx.courseSection.delete({ where: { id: sectionId } });
  });
}

async function assertSectionExists(sectionId: string) {
  const section = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { id: true } });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
}
