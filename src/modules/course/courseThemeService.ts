// 2.102.0: tema i «Mine kurs».
//
// Produkteier 2026-10-25: «det blir relativt mange kurs som er vanskelig å holde styr på, selv med
// navnestandard». Et tema samler kursene i deltakerens oversikt. Reglene, ett sted:
//   - bare administrator lager, endrer og sletter tema (rutene håndhever det);
//   - et kurs kan ha flere tema, eller ingen — kurset står da under hvert av dem;
//   - lista står alltid alfabetisk på navnet i leserens språk; det finnes ingen egen rekkefølge;
//   - slettes et tema, mister kursene bare temaet. Koblingen forsvinner, ingenting annet.
import { prisma } from "../../db/prisma.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { DomainRuleError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";

export interface CourseThemeRow {
  id: string;
  /** lagret lokalisert JSON, som kurstitler */
  name: string;
  courseCount: number;
  updatedAt: string;
}

export interface LocalizedTheme {
  id: string;
  name: string;
}

const collators = new Map<string, Intl.Collator>();
function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    try {
      collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    } catch {
      collator = new Intl.Collator("nb", { numeric: true, sensitivity: "base" });
    }
    collators.set(locale, collator);
  }
  return collator;
}

/** Alfabetisk på navnet i `locale`, tallbevisst — samme sorterer som kurslista (#1093). */
export function sortThemesByName<T extends { name: string }>(themes: readonly T[], locale: string): T[] {
  const collator = collatorFor(locale);
  return [...themes].sort((a, b) => collator.compare(a.name, b.name));
}

export async function listCourseThemes(): Promise<CourseThemeRow[]> {
  const rows = await prisma.courseTheme.findMany({
    select: { id: true, name: true, updatedAt: true, _count: { select: { courses: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    courseCount: row._count.courses,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createCourseTheme(input: { name: string; actorId?: string }) {
  return runInTransaction(async (tx) => {
    const created = await tx.courseTheme.create({ data: { name: input.name } });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseTheme,
        entityId: created.id,
        action: auditActions.courseTheme.created,
        actorId: input.actorId,
        metadata: { themeId: created.id },
      },
      tx,
    );
    return created;
  });
}

export async function updateCourseTheme(themeId: string, input: { name: string; actorId?: string }) {
  return runInTransaction(async (tx) => {
    const existing = await tx.courseTheme.findUnique({ where: { id: themeId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Course theme", "course_theme_not_found", "Course theme not found.");
    const updated = await tx.courseTheme.update({ where: { id: themeId }, data: { name: input.name } });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseTheme,
        entityId: themeId,
        action: auditActions.courseTheme.updated,
        actorId: input.actorId,
        metadata: { themeId },
      },
      tx,
    );
    return updated;
  });
}

/** Sletter temaet. Kursene mister bare koblingen (onDelete: Cascade på koblingstabellen). */
export async function deleteCourseTheme(themeId: string, actorId?: string) {
  return runInTransaction(async (tx) => {
    const existing = await tx.courseTheme.findUnique({
      where: { id: themeId },
      select: { id: true, _count: { select: { courses: true } } },
    });
    if (!existing) throw new NotFoundError("Course theme", "course_theme_not_found", "Course theme not found.");
    await tx.courseTheme.delete({ where: { id: themeId } });
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.courseTheme,
        entityId: themeId,
        action: auditActions.courseTheme.deleted,
        actorId,
        metadata: { themeId, detachedCourseCount: existing._count.courses },
      },
      tx,
    );
    return { detachedCourseCount: existing._count.courses };
  });
}

/**
 * Setter kursets tema til nøyaktig `themeIds`. Kjøres i kallerens transaksjon, så kursets felter og
 * temaene lagres sammen eller ikke i det hele tatt. Et tema som ikke finnes (slettet i mellomtiden),
 * avvises — å hoppe stille over det ville lagret noe annet enn forfatteren valgte.
 */
export async function setCourseThemes(tx: DbTransactionClient, courseId: string, themeIds: readonly string[]) {
  const wanted = [...new Set(themeIds)];
  if (wanted.length > 0) {
    const found = await tx.courseTheme.count({ where: { id: { in: wanted } } });
    if (found !== wanted.length) {
      throw new DomainRuleError("course_theme_not_found", "One or more course themes do not exist.");
    }
  }
  await tx.courseThemeAssignment.deleteMany({ where: { courseId, themeId: { notIn: wanted } } });
  if (wanted.length > 0) {
    await tx.courseThemeAssignment.createMany({
      data: wanted.map((themeId) => ({ courseId, themeId })),
      skipDuplicates: true,
    });
  }
}

export async function findThemeIdsForCourse(courseId: string): Promise<string[]> {
  const rows = await prisma.courseThemeAssignment.findMany({ where: { courseId }, select: { themeId: true } });
  return rows.map((row) => row.themeId);
}

/**
 * Temaene til hvert kurs, lokalisert og alfabetisk. Brukes av «Mine kurs» og kursoversikten i
 * innholdsforvaltningen — én spørring for alle kursene.
 */
export async function findLocalizedThemesForCourses(
  courseIds: readonly string[],
  locale: SupportedLocale,
): Promise<Map<string, LocalizedTheme[]>> {
  const byCourse = new Map<string, LocalizedTheme[]>();
  if (courseIds.length === 0) return byCourse;
  const rows = await prisma.courseThemeAssignment.findMany({
    where: { courseId: { in: [...courseIds] } },
    select: { courseId: true, theme: { select: { id: true, name: true } } },
  });
  for (const row of rows) {
    const theme = { id: row.theme.id, name: localizeContentText(locale, row.theme.name) ?? row.theme.name };
    const list = byCourse.get(row.courseId);
    if (list) list.push(theme);
    else byCourse.set(row.courseId, [theme]);
  }
  for (const [courseId, themes] of byCourse) byCourse.set(courseId, sortThemesByName(themes, locale));
  return byCourse;
}
