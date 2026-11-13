// #1150 skive 2a-1 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Forløpet for forfatteren»): hva en arkivering av kurset
// ville gjort. Bare lesing.
//
// `GET /api/admin/content/courses/:courseId/archive-preview` kaller denne på den globale klienten: det er et forslag. Skive 2a-2
// kaller den samme funksjonen med transaksjonen som holder innholdslåsen, og sammenligner med det forfatteren så (`409
// course_archive_preview_changed`). Derfor tar den `reader`, og regner alt selv: ingen del av svaret skal kunne komme fra et
// annet sted enn det arkiveringen skal regne på nytt.
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
  /** Deltakere midt i kurset (`findCourseInProgressParticipants`), samme tall som G3 i `archiveCourse` sperrer på. */
  inProgressCount: number;
  /** Besvarelser fra dem som ikke er ferdig vurdert, eller har en åpen anke (`countCoursePendingReviews`). */
  pendingReviewCount: number;
  /** Kurset har et lagret utkast (#1140). Skive 2a-2 forkaster det ved arkiveringen. */
  hasDraft: boolean;
  /** Elementene som arkiveres sammen med kurset (2a-2): ikke arkivert, og ikke brukt andre steder. */
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
  const course = await reader.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, archivedAt: true } });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  const courseTitle = localizeContentText(locale, course.title) ?? course.title;
  const hasDraft = (await findCourseIdsWithDraft(reader, [courseId])).has(courseId);
  if (course.archivedAt !== null) {
    return { courseId, courseTitle, archived: true, inProgressCount: 0, pendingReviewCount: 0, hasDraft, follows: [], stays: [], alreadyArchived: [] };
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
    courseId,
    courseTitle,
    archived: false,
    inProgressCount: inProgress.userIds.length,
    pendingReviewCount,
    hasDraft,
    follows,
    stays,
    alreadyArchived: items.filter((item) => item.archived).map(({ type, id, title }) => ({ type, id, title })),
  };
}

function manageable(contentType: ContentOwnerType, contentIds: string[], actor: { userId: string; roles: string[] }, reader: LifecycleReader) {
  return listManageableContentIds({ contentType, contentIds, actorUserId: actor.userId, roles: actor.roles, reader });
}
