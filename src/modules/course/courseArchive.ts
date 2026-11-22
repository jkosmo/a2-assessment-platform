// #1150 skive 2a-2 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, etappe 2): arkivering av et kurs tar med seg innholdet som
// ikke brukes andre steder, og gjenoppretting av kurset setter det tilbake slik det var.
//
// Begge skjer i ÉN transaksjon under innholdslåsen (`runContentWrite`), og alt som avgjør hva som skjer, regnes på nytt etter
// låsen. Forhåndsvisningene (`analyzeCourseArchive`, `analyzeCourseRestore` i courseArchivePreview.ts) er forslag; her kalles de
// samme funksjonene med transaksjonen.
//
// Arkiveringen, i denne rekkefølgen:
//   1. Analysen på nytt. Uten `expected` arkiveres bare et kurs uten deltakere midt i og uten noe som følger med (en gammel fane
//      eller et direkte kall får aldri arkivert innhold uten at lista er bekreftet). Med `expected` som ikke stemmer: 409.
//   2. Manglende kursbevis utstedes (`issueMissingCompletionsBeforeArchive`). Først, fordi deltakerlåsene må tas før noe skrives
//      i revisjonssporet (låserekkefølgen i db/contentLock.ts).
//   3. Kursets eget utkast forkastes (`discardCourseDraftOnArchive`, courseDraft.ts).
//   4. Kurset arkiveres (`archivedAt`, `publishedAt: null`, I3).
//   5. Hvert element i `follows` arkiveres med merket (`archiveModuleWithCourse`, `archiveSectionWithCourse`).
//   6. Revisjonshendelse for kurset med hva som fulgte med.
import { runContentWrite } from "../../db/contentLock.js";
import { ConflictError, DomainRuleError, NotFoundError } from "../../errors/AppError.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { archiveModuleWithCourse, restoreModuleWithCourse } from "../adminContent/adminContentCommands.js";
import { courseHasActiveParticipantsError } from "./contentLifecycle.js";
import { analyzeCourseArchiveForWrite, analyzeCourseRestore, type CourseArchivePreview, type CourseRestoreReturn, type CourseRestoreStay } from "./courseArchivePreview.js";
import { issueMissingCompletionsBeforeArchive } from "./courseCompletionService.js";
import { discardCourseDraftOnArchive } from "./courseDraft.js";
import { archiveSectionWithCourse, restoreSectionWithCourse } from "./sectionCommands.js";
import type { ContentWriteTx } from "../../db/contentLock.js";

/** Det forfatteren så i forhåndsvisningen og bekreftet. Rekkefølgen i listene spiller ingen rolle. */
export type CourseArchiveExpectation = { follows: { moduleIds: string[]; sectionIds: string[] }; inProgressCount: number };

/** Arkiveringen kan ta litt tid: utstedelse og ett element om gangen. Det er sjelden, og alle andre innholdsendringer venter. */
const ARCHIVE_TX_TIMEOUT_MS = 20_000;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function followIds(preview: CourseArchivePreview) {
  return {
    moduleIds: preview.follows.filter((item) => item.type === "MODULE").map((item) => item.id),
    sectionIds: preview.follows.filter((item) => item.type === "SECTION").map((item) => item.id),
  };
}

/**
 * G3 som bekreftelse (produkteier 13.11.2026), og lista som bekreftelse (planen, «Forløpet for forfatteren»). Kaster før noe er
 * skrevet.
 */
function assertArchiveConfirmed(preview: CourseArchivePreview, expected: CourseArchiveExpectation | undefined) {
  const follows = followIds(preview);
  if (!expected) {
    // Samme svar som før #1150 når noen er midt i (400, tallet i `details`).
    if (preview.inProgressCount > 0) throw courseHasActiveParticipantsError(preview.inProgressCount);
    if (preview.follows.length > 0) {
      throw new ConflictError(
        "course_archive_needs_confirmation",
        "Modules or sections would be archived together with this course. Reload the page to see which, and confirm; nothing was archived.",
        { moduleCount: follows.moduleIds.length, sectionCount: follows.sectionIds.length },
      );
    }
    return;
  }
  // Forfatteren bekreftet at N deltakere er midt i. Færre nå (én fullførte mens dialogen sto åpen) er innenfor det som ble
  // bekreftet; bare FLERE krever ny bekreftelse (QA-porten 2a-2). Listene må stemme nøyaktig.
  if (
    preview.inProgressCount > expected.inProgressCount ||
    !sameIds(expected.follows.moduleIds, follows.moduleIds) ||
    !sameIds(expected.follows.sectionIds, follows.sectionIds)
  ) {
    throw new ConflictError(
      "course_archive_preview_changed",
      "What archiving this course would do changed after the preview was shown. Open it again; nothing was archived.",
      { inProgressCount: preview.inProgressCount, follows },
    );
  }
}

export type CourseArchiveResult = {
  course: Awaited<ReturnType<ContentWriteTx["course"]["update"]>>;
  followed: { moduleIds: string[]; sectionIds: string[] };
  certificatesIssued: number;
  draftDiscarded: boolean;
};

/**
 * Arkiverer kurset, og innholdet som følger med. `expected` er det forfatteren bekreftet (se `assertArchiveConfirmed`).
 * `actor.roles` avgjør bare `owned` i analysen; tilgangen er sjekket av ruta (`requireContentOwnership`).
 */
export async function archiveCourse(
  courseId: string,
  actor: { userId: string; roles: string[] },
  options: { expected?: CourseArchiveExpectation; locale?: SupportedLocale } = {},
): Promise<CourseArchiveResult> {
  return runContentWrite(async (tx) => {
    const existing = await tx.course.findUnique({ where: { id: courseId }, select: { id: true, archivedAt: true } });
    if (!existing) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    if (existing.archivedAt) throw new DomainRuleError("course_already_archived", "The course is already archived.");

    // 1. Analysen på nytt, etter låsen, på transaksjonen.
    const { preview, completedWithoutCertificateUserIds } = await analyzeCourseArchiveForWrite(courseId, actor, options.locale ?? "nb", tx);
    assertArchiveConfirmed(preview, options.expected);
    const followed = followIds(preview);

    // 2. Manglende kursbevis, før noe er skrevet i revisjonssporet.
    const issued = await issueMissingCompletionsBeforeArchive(tx, courseId, completedWithoutCertificateUserIds);

    // 3. Kursets eget utkast.
    const discarded = await discardCourseDraftOnArchive(tx, courseId, actor.userId);

    // 4. Kurset. I3: arkivering avpubliserer, så «arkivert men publisert» aldri oppstår.
    const now = new Date();
    const updated = await tx.course.update({
      where: { id: courseId },
      data: { archivedAt: now, publishedAt: null },
    });

    // 5. Innholdet som følger med, med merket. Også elementer forfatteren ikke eier (produkteier 13.11.2026).
    for (const moduleId of followed.moduleIds) await archiveModuleWithCourse(tx, moduleId, courseId, actor.userId, now);
    for (const sectionId of followed.sectionIds) await archiveSectionWithCourse(tx, sectionId, courseId, actor.userId, now);

    // 6. Hva som skjedde.
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.archived,
        actorId: actor.userId,
        metadata: {
          courseId,
          followedModuleIds: followed.moduleIds,
          followedSectionIds: followed.sectionIds,
          inProgressCount: preview.inProgressCount,
          certificatesIssued: issued.length,
          draftDiscarded: discarded !== null,
          confirmed: options.expected !== undefined,
        },
      },
      tx,
    );
    return { course: updated, followed, certificatesIssued: issued.length, draftDiscarded: discarded !== null };
  }, { timeout: ARCHIVE_TX_TIMEOUT_MS });
}

export type CourseRestoreResult = {
  course: Awaited<ReturnType<ContentWriteTx["course"]["update"]>>;
  returns: CourseRestoreReturn[];
  staysArchived: CourseRestoreStay[];
};

/**
 * Gjenoppretter kurset som utkast (I3, som før), og setter tilbake elementene som fulgte det inn i arkivet: publisert med samme
 * versjon (produkteier 13.11.2026). Elementer arkivert for hånd, av importen eller med et annet kurs, blir arkivert; kurset kan
 * da ikke publiseres før de er gjenopprettet eller tatt ut (`item_archived`, finnes).
 *
 * Merket nullstilles også på elementer som peker på kurset uten å bli gjenopprettet her: de som er tatt ut av kurset mens det var
 * arkivert (blir arkivert), og de som gammel kode gjenopprettet uten å nullstille (er alt aktive).
 */
export async function restoreCourse(courseId: string, actorId: string, options: { locale?: SupportedLocale } = {}): Promise<CourseRestoreResult> {
  return runContentWrite(async (tx) => {
    const existing = await tx.course.findUnique({ where: { id: courseId }, select: { id: true, archivedAt: true } });
    if (!existing) throw new NotFoundError("Course", "course_not_found", "Course not found.");
    if (!existing.archivedAt) throw new DomainRuleError("course_not_archived", "The course is not archived, so it cannot be restored.");

    const plan = await analyzeCourseRestore(courseId, options.locale ?? "nb", tx);

    // I3: et gjenopprettet kurs er ALLTID et utkast. Før sto det bare på at arkiveringen hadde nullstilt `publishedAt`. Det
    // holder ikke for et kurs arkivert før arkivering avpubliserte (#705), eller publisert fra en gammel fane etter arkiveringen
    // (`publishCourse` sjekker ikke `archivedAt`). Etter #1149 kan innholdet i et arkivert kurs være arkivert eller avpublisert,
    // så et kurs som gikk rett ut til deltakerne ved gjenoppretting, ville gått forbi publiseringsporten (QA-porten 2.158.0).
    const updated = await tx.course.update({
      where: { id: courseId },
      data: { archivedAt: null, publishedAt: null },
    });

    const now = new Date();
    const returns: CourseRestoreReturn[] = [];
    for (const item of plan.returns) {
      const restored = item.type === "MODULE"
        ? await restoreModuleWithCourse(tx, item.id, courseId, actorId, now)
        : await restoreSectionWithCourse(tx, item.id, courseId, actorId);
      // Svaret sier hva som faktisk skjedde. Forhåndsvisningen kan ikke nummerere eldre modulhistorikk; gjenopprettingen kan.
      returns.push(
        restored.activeVersionId === null
          ? { type: item.type, id: item.id, title: item.title, versionId: null, asDraft: restored.asDraft ?? "version_missing" }
          : { ...item, versionId: restored.activeVersionId, asDraft: undefined },
      );
    }

    const cleared = await clearArchiveMarksForCourse(tx, courseId);

    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.restored,
        actorId,
        metadata: {
          courseId,
          returnedModuleIds: returns.filter((item) => item.type === "MODULE").map((item) => item.id),
          returnedSectionIds: returns.filter((item) => item.type === "SECTION").map((item) => item.id),
          returnedAsDraft: returns.filter((item) => item.asDraft).map((item) => item.id),
          staysArchived: plan.staysArchived.map((item) => ({ type: item.type, id: item.id, reason: item.reason })),
          marksCleared: cleared,
        },
      },
      tx,
    );
    return { course: updated, returns: returns.map(({ asDraft, ...rest }) => (asDraft ? { ...rest, asDraft } : rest)), staysArchived: plan.staysArchived };
  }, { timeout: ARCHIVE_TX_TIMEOUT_MS });
}

/**
 * Nullstiller merket på alle elementer som peker på kurset. Gjenopprettingen kaller den etter at elementene i kurset er satt
 * tilbake (da gjelder den bare de som ikke ble det), og slettingen av et kurs (`deleteCourse`, `cascadeDeleteCourse`) før kurset
 * slettes: merket er et merke, ikke et eierskap, og skal ikke peke på et kurs som ikke finnes. Elementene forblir arkivert.
 * Svarer med hvor mange som ble nullstilt.
 */
export async function clearArchiveMarksForCourse(tx: ContentWriteTx, courseId: string): Promise<number> {
  const modules = await tx.module.updateMany({
    where: { archivedWithCourseId: courseId },
    data: { archivedWithCourseId: null, activeVersionIdBeforeArchive: null },
  });
  const sections = await tx.courseSection.updateMany({
    where: { archivedWithCourseId: courseId },
    data: { archivedWithCourseId: null, activeVersionIdBeforeArchive: null },
  });
  return modules.count + sections.count;
}
