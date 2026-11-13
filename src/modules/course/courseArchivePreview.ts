// #1150 skive 2a-1 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Forløpet for forfatteren»): hva en arkivering av kurset
// ville gjort. Bare lesing.
//
// `GET /api/admin/content/courses/:courseId/archive-preview` kaller denne på den globale klienten: det er et forslag. Arkiveringen
// (skive 2a-2, `archiveCourse` i courseArchive.ts) kaller den samme utregningen (`analyzeCourseArchiveForWrite`) med transaksjonen
// som holder innholdslåsen, og sammenligner med det forfatteren så (`409 course_archive_preview_changed`). Derfor tar den `reader`,
// og regner alt selv: ingen del av svaret skal kunne komme fra et annet sted enn det arkiveringen regner på nytt.
// Gjenopprettingen har sin egen analyse lenger ned (`analyzeCourseRestore`), brukt på samme måte av `restoreCourse`.
//
// Reglene bor ikke her. «Brukes andre steder» er `findActiveUsesOfItems`, «midt i kurset» er `findCourseInProgressParticipants`,
// og «venter på vurdering» er `countCoursePendingReviews` (alle i contentLifecycle.ts). Eierskapet er `listManageableContentIds`,
// samme svar som `requireContentOwnership` gir.
import type { ContentOwnerType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { NotFoundError } from "../../errors/AppError.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { listManageableContentIds } from "../content/contentOwnershipService.js";
import {
  countCoursePendingReviews,
  findActiveUsesOfItems,
  findCourseInProgressParticipants,
  type ItemUse,
  type LifecycleReader,
} from "./contentLifecycle.js";
import { findCourseIdsWithDraft } from "./courseDraft.js";
import { createCourseRepository } from "./courseRepository.js";

type ItemType = "MODULE" | "SECTION";

export type CourseArchivePreview = {
  courseId: string;
  courseTitle: string;
  archived: boolean;
  /** #1150 skive 2a-2: kurset er publisert. Bare da utsteder arkiveringen manglende kursbevis (#933). */
  published: boolean;
  /** Deltakere midt i kurset (`findCourseInProgressParticipants`). Arkiveringen krever at forfatteren har bekreftet tallet. */
  inProgressCount: number;
  /**
   * #1150 skive 2a-2: deltakere som har gjort alle stegene uten kursbevis for nåværende hovedversjon. Arkiveringen utsteder
   * bevisene først (når kurset er publisert). Ikke en del av `expected`: tallet stopper ingenting.
   */
  completedWithoutCertificateCount: number;
  /** Besvarelser fra dem som ikke er ferdig vurdert, eller har en åpen anke (`countCoursePendingReviews`). */
  pendingReviewCount: number;
  /** Kurset har et lagret utkast (#1140). Arkiveringen forkaster det. */
  hasDraft: boolean;
  /** Elementene som arkiveres sammen med kurset: ikke arkivert, og ikke brukt andre steder. */
  follows: Array<{ type: ItemType; id: string; title: string; owned: boolean }>;
  /** Elementene som blir stående, og hvem som bruker dem. */
  stays: Array<{ type: ItemType; id: string; title: string; usedBy: Array<{ courseId: string; title: string; via: ItemUse["via"] }> }>;
  /** Elementer i kurset som er arkivert fra før. */
  alreadyArchived: Array<{ type: ItemType; id: string; title: string }>;
};

/**
 * Analysen bak forhåndsvisningen. `actor` avgjør bare `owned`: elementer forfatteren ikke eier, følger likevel med så sant de
 * ikke brukes andre steder (produkteier 13.11.2026).
 *
 * Et arkivert kurs: `archived: true`, tomme lister og null i tallene. En arkivering av det gjør ingenting med innholdet.
 */
export async function analyzeCourseArchive(
  courseId: string,
  actor: { userId: string; roles: string[] },
  locale: SupportedLocale,
  reader: LifecycleReader = prisma,
): Promise<CourseArchivePreview> {
  return (await analyzeCourseArchiveForWrite(courseId, actor, locale, reader)).preview;
}

/**
 * #1150 skive 2a-2: analysen med det arkiveringen trenger i tillegg, og som ikke skal ut av tjeneren: hvem som har fullført uten
 * kursbevis. `archiveCourse` (courseArchive.ts) kaller denne med transaksjonen som holder innholdslåsen; ruta for
 * forhåndsvisningen går gjennom `analyzeCourseArchive` over. Samme utregning, så tallene kan sammenlignes.
 */
export async function analyzeCourseArchiveForWrite(
  courseId: string,
  actor: { userId: string; roles: string[] },
  locale: SupportedLocale,
  reader: LifecycleReader = prisma,
): Promise<{ preview: CourseArchivePreview; completedWithoutCertificateUserIds: string[] }> {
  const course = await reader.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, archivedAt: true, publishedAt: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  const courseTitle = localizeContentText(locale, course.title) ?? course.title;
  const hasDraft = (await findCourseIdsWithDraft(reader, [courseId])).has(courseId);
  const published = course.publishedAt !== null && course.archivedAt === null;
  if (course.archivedAt !== null) {
    return {
      preview: {
        courseId, courseTitle, archived: true, published, inProgressCount: 0, completedWithoutCertificateCount: 0, pendingReviewCount: 0, hasDraft,
        follows: [], stays: [], alreadyArchived: [],
      },
      completedWithoutCertificateUserIds: [],
    };
  }

  // Det publiserte/lagrede kurset, gjennom forfatterdøra (#958): også det arkiverte. Kursets EGET utkast er ikke med: det
  // forkastes ved arkiveringen.
  const rows = await createCourseRepository(reader).findAllCourseItems(courseId);
  const seen = new Set<string>();
  const items: Array<{ type: ItemType; id: string; title: string; archived: boolean }> = [];
  for (const row of rows) {
    const element = row.itemType === "MODULE" ? row.module : row.section;
    if (!element || seen.has(`${row.itemType}:${element.id}`)) continue;
    seen.add(`${row.itemType}:${element.id}`);
    items.push({
      type: row.itemType === "MODULE" ? "MODULE" : "SECTION",
      id: element.id,
      title: localizeContentText(locale, element.title) ?? element.title,
      archived: element.archivedAt !== null,
    });
  }
  const live = items.filter((item) => !item.archived);
  const idsOf = (type: ItemType) => live.filter((item) => item.type === type).map((item) => item.id);

  const [uses, inProgress, ownedModules, ownedSections] = await Promise.all([
    findActiveUsesOfItems({ moduleIds: idsOf("MODULE"), sectionIds: idsOf("SECTION") }, { excludeCourseId: courseId, locale }, reader),
    findCourseInProgressParticipants(courseId, reader),
    manageable("MODULE", idsOf("MODULE"), actor, reader),
    manageable("SECTION", idsOf("SECTION"), actor, reader),
  ]);
  const pendingReviewCount = await countCoursePendingReviews(inProgress, reader);

  const follows: CourseArchivePreview["follows"] = [];
  const stays: CourseArchivePreview["stays"] = [];
  for (const item of live) {
    const usedBy = (item.type === "MODULE" ? uses.modules : uses.sections).get(item.id) ?? [];
    if (usedBy.length > 0) {
      stays.push({ type: item.type, id: item.id, title: item.title, usedBy: usedBy.map((use) => ({ courseId: use.courseId, title: use.title, via: use.via })) });
    } else {
      const owned = (item.type === "MODULE" ? ownedModules : ownedSections).has(item.id);
      follows.push({ type: item.type, id: item.id, title: item.title, owned });
    }
  }

  return {
    preview: {
      courseId,
      courseTitle,
      archived: false,
      published,
      inProgressCount: inProgress.userIds.length,
      completedWithoutCertificateCount: inProgress.completedWithoutCertificateUserIds.length,
      pendingReviewCount,
      hasDraft,
      follows,
      stays,
      alreadyArchived: items.filter((item) => item.archived).map(({ type, id, title }) => ({ type, id, title })),
    },
    completedWithoutCertificateUserIds: inProgress.completedWithoutCertificateUserIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #1150 skive 2a-2 (planen, «Gjenoppretting»): hva en gjenoppretting av kurset setter tilbake.
//
// Elementene i kurset (`findAllCourseItems`, forfatterdøra, også arkiverte) som er arkivert:
//   - merket peker på DETTE kurset                → kommer tilbake, publisert med versjonen fra før (`activeVersionIdBeforeArchive`)
//   - uten merke (for hånd, importen, gammel kode) → blir arkivert: «archived_separately»
//   - merket peker på et annet kurs               → blir arkivert: «archived_with_other_course»
// Et element som kommer tilbake, men der versjonen ikke finnes lenger, ikke hører til elementet, eller (modul) tilhører en eldre
// hovedversjon enn den høyeste, lander som utkast: `asDraft: "version_missing"`. Var elementet et utkast da det fulgte kurset inn
// (ingen publisert versjon), lander det som utkast igjen: `asDraft: "was_unpublished"`.
//
// Elementer med merket som ikke lenger ligger i kurset, er ikke med i svaret: de forblir arkivert, og gjenopprettingen
// nullstiller merket. Gjenopprettingen (`restoreCourse`, courseArchive.ts) kaller denne med transaksjonen og gjør nøyaktig dette.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type CourseRestoreReturn = { type: ItemType; id: string; title: string; versionId: string | null; versionLabel?: string; asDraft?: "was_unpublished" | "version_missing" };
export type CourseRestoreStay = { type: ItemType; id: string; title: string; reason: "archived_separately" | "archived_with_other_course" };
export type CourseRestorePreview = { courseId: string; courseTitle: string; archived: boolean; returns: CourseRestoreReturn[]; staysArchived: CourseRestoreStay[] };

export async function analyzeCourseRestore(courseId: string, locale: SupportedLocale, reader: LifecycleReader = prisma): Promise<CourseRestorePreview> {
  const course = await reader.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, archivedAt: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  const courseTitle = localizeContentText(locale, course.title) ?? course.title;
  if (course.archivedAt === null) return { courseId, courseTitle, archived: false, returns: [], staysArchived: [] };

  const rows = await createCourseRepository(reader).findAllCourseItems(courseId);
  const returns: CourseRestoreReturn[] = [];
  const staysArchived: CourseRestoreStay[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const element = row.itemType === "MODULE" ? row.module : row.section;
    const type: ItemType = row.itemType === "MODULE" ? "MODULE" : "SECTION";
    if (!element || element.archivedAt === null || seen.has(`${type}:${element.id}`)) continue;
    seen.add(`${type}:${element.id}`);
    const title = localizeContentText(locale, element.title) ?? element.title;
    if (element.archivedWithCourseId === null) {
      staysArchived.push({ type, id: element.id, title, reason: "archived_separately" });
    } else if (element.archivedWithCourseId !== courseId) {
      staysArchived.push({ type, id: element.id, title, reason: "archived_with_other_course" });
    } else {
      returns.push({ type, id: element.id, title, ...(await restorableVersion(type, element.id, element.activeVersionIdBeforeArchive, reader)) });
    }
  }
  return { courseId, courseTitle, archived: true, returns, staysArchived };
}

/** Versjonen elementet får tilbake, eller hvorfor det lander som utkast. Bare lesing. */
async function restorableVersion(
  type: ItemType,
  id: string,
  versionId: string | null,
  reader: LifecycleReader,
): Promise<Pick<CourseRestoreReturn, "versionId" | "versionLabel" | "asDraft">> {
  if (versionId === null) return { versionId: null, asDraft: "was_unpublished" };
  if (type === "SECTION") {
    const version = await reader.courseSectionVersion.findUnique({ where: { id: versionId }, select: { sectionId: true, versionNo: true } });
    if (!version || version.sectionId !== id) return { versionId: null, asDraft: "version_missing" };
    return { versionId, versionLabel: String(version.versionNo) };
  }
  const version = await reader.moduleVersion.findUnique({ where: { id: versionId }, select: { moduleId: true, versionMajor: true, versionMinor: true } });
  if (!version || version.moduleId !== id) return { versionId: null, asDraft: "version_missing" };
  // Samme regel som `resolvePublishNumber`: en versjon fra en eldre hovedversjon enn den høyeste kan ikke settes live igjen.
  // Uten nummer (data fra før #934 skive 5a-2) avgjør nummereringen ved gjenopprettingen; lesingen her kan ikke nummerere.
  if (version.versionMajor !== null) {
    const highest = await reader.moduleVersion.aggregate({ where: { moduleId: id }, _max: { versionMajor: true } });
    if ((highest._max.versionMajor ?? version.versionMajor) > version.versionMajor) return { versionId: null, asDraft: "version_missing" };
  }
  return { versionId, ...(version.versionMajor !== null && version.versionMinor !== null ? { versionLabel: `${version.versionMajor}.${version.versionMinor}` } : {}) };
}

function manageable(contentType: ContentOwnerType, contentIds: string[], actor: { userId: string; roles: string[] }, reader: LifecycleReader) {
  return listManageableContentIds({ contentType, contentIds, actorUserId: actor.userId, roles: actor.roles, reader });
}
