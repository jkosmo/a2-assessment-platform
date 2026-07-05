import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { assertSectionNotInAnyCourse } from "./contentLifecycle.js";

// Section CRUD + versioning (#485/B1) for course learning sections (#476).
// Mirrors Module/ModuleVersion: editing content publishes an immutable new
// version and re-points activeVersionId (latest-wins in v1.3.x). Localized
// fields (title, bodyMarkdown) arrive already serialized to JSON strings by the
// route layer, exactly like createCourse.

// AA-2 (#650): `draft: true` keeps the section in Utkast (activeVersionId stays
// null) — same state a restored section lands in (I3). Content lives in version 1;
// publishSection re-points to it. Default (false) preserves auto-publish-on-save.
export async function createSection(input: { title: string; bodyMarkdown: string; actorId?: string; draft?: boolean }) {
  return runInTransaction(async (tx) => {
    const section = await tx.courseSection.create({ data: { title: input.title } });
    const version = await tx.courseSectionVersion.create({
      data: {
        sectionId: section.id,
        versionNo: 1,
        bodyMarkdown: input.bodyMarkdown,
        publishedBy: input.draft ? null : input.actorId ?? null,
        publishedAt: input.draft ? null : new Date(),
      },
    });
    if (input.draft) {
      return tx.courseSection.findUniqueOrThrow({
        where: { id: section.id },
        include: { activeVersion: true },
      });
    }
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

// #705: enhetlig livssyklus for seksjoner (symmetri med modul/kurs). Seksjoner auto-publiseres
// ved lagring; disse handlingene gir samme Publiser/Avpubliser/Arkiver/Gjenopprett-vokabular.

// Publiser: re-pek activeVersionId til siste versjon (krever at det finnes en versjon med innhold).
export async function publishSection(sectionId: string, actorId?: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, archivedAt: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (section.archivedAt) {
    throw new ValidationError("Gjenopprett seksjonen før du publiserer den.");
  }
  const latest = await prisma.courseSectionVersion.findFirst({
    where: { sectionId },
    orderBy: { versionNo: "desc" },
    select: { id: true },
  });
  if (!latest) {
    throw new ValidationError("Seksjonen har ikke noe innhold å publisere.");
  }
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { activeVersionId: latest.id },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.published,
    actorId,
    metadata: { sectionId },
  });
  return updated;
}

// Avpubliser: nullstill activeVersionId. G2 — kan ikke avpublisere en seksjon som ligger i et kurs.
export async function unpublishSection(sectionId: string, actorId?: string) {
  await assertSectionExists(sectionId);
  await assertSectionNotInAnyCourse(sectionId, "avpubliseres");
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { activeVersionId: null },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.unpublished,
    actorId,
    metadata: { sectionId },
  });
  return updated;
}

// Arkiver: G2-vakt + auto-avpubliser (I3). Gjenopprett lander i Utkast.
export async function archiveSection(sectionId: string, actorId?: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, archivedAt: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (section.archivedAt) {
    throw new ValidationError("Seksjonen er allerede arkivert.");
  }
  await assertSectionNotInAnyCourse(sectionId, "arkiveres");
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { archivedAt: new Date(), activeVersionId: null },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.archived,
    actorId,
    metadata: { sectionId },
  });
  return updated;
}

// Gjenopprett: nullstill archivedAt (lander i Utkast — forfatteren re-publiserer bevisst).
export async function restoreSection(sectionId: string, actorId?: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, archivedAt: true },
  });
  if (!section) {
    throw new NotFoundError("CourseSection", "section_not_found", "Course section not found.");
  }
  if (!section.archivedAt) {
    throw new ValidationError("Seksjonen er ikke arkivert.");
  }
  const updated = await prisma.courseSection.update({
    where: { id: sectionId },
    data: { archivedAt: null },
    include: { activeVersion: true },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.courseSection,
    entityId: sectionId,
    action: auditActions.section.restored,
    actorId,
    metadata: { sectionId },
  });
  return updated;
}

export async function deleteSection(sectionId: string) {
  await assertSectionExists(sectionId);
  // G2: navngir kursene (konsistent med modul-sletting).
  await assertSectionNotInAnyCourse(sectionId, "slettes");
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
