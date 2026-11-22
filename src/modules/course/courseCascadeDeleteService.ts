import { prisma } from "../../db/prisma.js";
import { runContentWrite } from "../../db/contentLock.js";
import { ConflictError, DomainRuleError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import { createAdminContentRepository } from "../adminContent/adminContentRepository.js";
import { deleteModuleInTx } from "../adminContent/adminContentCommands.js";
import { createCourseRepository } from "./courseRepository.js";
import {
  describeIssuedCertificateBlock,
  findAllCoursesContainingModule,
  findAllCoursesContainingSection,
  findCourseDraftUsesForDelete,
  type LifecycleReader,
} from "./contentLifecycle.js";
import { reclaimAssetBlobs } from "./assetCommands.js";
import { deleteRequiresArchivedError } from "../content/archivedGuard.js";
import { deleteCourseInTx } from "./courseCommands.js";
import { lockCourseDeleteLearners, measureCourseDeleteBlocks } from "./courseDeleteGuard.js";
import { deleteSectionInTx } from "./sectionCommands.js";

// #762 — ADMINISTRATOR-only destructive cleanup: delete a course together with the modules and
// sections that ONLY that course owns, while never destroying real assessment/achievement records.
//
// Safety model (load-bearing):
//   - A module/section is EXCLUSIVE to course C when C is the only course that references it (via
//     CourseItem). Shared items are SPARED — merely unlinked from C, never deleted.
//     ⚠️ #1149: «andre kurs» er ALLE kurs her, også arkiverte (`findAllCoursesContaining…`). Dette er en
//     SLETTING. Telte bare aktive kurs, ville et element som også ligger i et arkivert kurs se eksklusivt ut
//     og bli forsøkt slettet under det arkiverte kurset (og stoppet av `CourseItem` → `onDelete: Restrict`,
//     så hele kaskaden rullet tilbake). Regelen «arkiverte kurs teller ikke som bruk» gjelder visning,
//     avpublisering og arkivering — ikke sletting.
//   - #1152 skive 4a-2: SAMME REGLER SOM «SLETT». Kurset vurderes med kursvakta (courseDeleteGuard.ts: kursbevis, fullført uten
//     kursbevis, besvarelser som venter) FØR noe fjernes. Et eksklusivt element slettes bare når det er ARKIVERT (G4); et aktivt
//     element som bare lå i kurset (kurs arkivert før 2.159.0, eller gjenopprettet for hånd), blir stående og kobles fra
//     (`stays: "not_archived"`). Et arkivert eksklusivt element med innleveringer, sertifiseringer, et utstedt kursbevis eller et
//     lagret utkast som nevner det, er en BLOKKERING.
//   - Selve slettingen går gjennom de samme indre funksjonene som knappen (`deleteCourseInTx`, `deleteModuleInTx`,
//     `deleteSectionInTx`), i én transaksjon: kurset først (koblingene går med det), så elementene. Hver av dem vurderer på nytt
//     under låsen; svarer den annerledes enn analysen, rulles alt tilbake. Eierrader og én revisjonshendelse per slettet modul og
//     seksjon kommer derfra.
//   - The delete is ALL-OR-NOTHING: if any blocker exists the operation throws and deletes nothing.

const MSG_LOCALE = "nb" as const;

function displayTitle(rawTitle: string): string {
  return localizeContentText(MSG_LOCALE, rawTitle) ?? rawTitle;
}

function quoteCourseNames(courses: Array<{ title: string }>): string {
  return courses.map((c) => `«${c.title}»`).join(", ");
}

export type CascadeDeleteEntry = {
  id: string;
  title: string;
  /** Norsk tekst, for API-konsumenter og som reserve i klienten (#995). */
  reason: string;
  /** #1152: feilkoden (`errors.api.<code>` i klienten) når grunnen har en, med tallene i `details`. */
  code?: string;
  details?: Record<string, unknown>;
  /** #1152, bare på `spared…`: delt med et annet kurs, eller ikke arkivert (blir stående som det er). */
  stays?: "shared" | "not_archived";
};

export type CourseCascadeDeletePreview = {
  courseId: string;
  courseTitle: string;
  // Exclusive to this course, archived and free of preserved records — will be deleted.
  deletableModules: CascadeDeleteEntry[];
  deletableSections: CascadeDeleteEntry[];
  // Shared with other courses, or (#1152) not archived — will only be unlinked from this course, never deleted.
  sparedModules: CascadeDeleteEntry[];
  sparedSections: CascadeDeleteEntry[];
  // Reasons the whole operation is blocked. When non-empty the delete refuses and nothing is removed.
  blockers: CascadeDeleteEntry[];
  // Convenience flag for the UI: true when there are no blockers.
  deletable: boolean;
};

export type CascadeDeleteSummary = {
  deletedCourseId: string;
  deletedModuleIds: string[];
  deletedSectionIds: string[];
  sparedModuleIds: string[];
  sparedSectionIds: string[];
};

type CascadeAnalysis = CourseCascadeDeletePreview;

const NOT_ARCHIVED_REASON = "Ikke arkivert. Blir stående, og kobles bare fra dette kurset.";

function draftBlocker(id: string, title: string, subject: "Modulen" | "Seksjonen", drafts: Array<{ title: string }>): CascadeDeleteEntry {
  return {
    id,
    title,
    reason: `${subject} «${title}» står i et lagret utkast til ${drafts.length} kurs: ${quoteCourseNames(drafts)}. Ta den ut av utkastet, eller forkast utkastet, først.`,
    code: "delete_blocked_by_course_draft",
    details: { count: drafts.length, draftCourseTitles: drafts.map((d) => d.title) },
  };
}

// Shared analysis used by both preview and delete so the two can never diverge.
// #934 skive 4a: slettingen kjører analysen på NYTT med transaksjonen som holder innholdslåsen. Forhåndsvisningen
// administratoren så, er bare et forslag: en seksjon som var delt (og skulle spares), kan ha blitt tatt ut av det
// andre kurset i mellomtiden — og ville da blitt slettet (Codex runde 2 nr. 4).
// #1152: rekkefølgen per element er den samme som i de indre slettefunksjonene (arkivert → historikk → utkast), så analysen og
// slettingen sier det samme.
async function analyzeCourseCascade(courseId: string, reader: LifecycleReader = prisma): Promise<CascadeAnalysis> {
  const courseRepository = createCourseRepository(reader);
  const adminContentRepository = createAdminContentRepository(reader);
  const course = await reader.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, archivedAt: true },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  // #1151 (G4): bare et arkivert kurs kan slettes, også med innhold. Her, så forhåndsvisningen og slettingen svarer likt.
  if (!course.archivedAt) throw deleteRequiresArchivedError({ type: "COURSE", id: courseId });
  const courseTitle = displayTitle(course.title);

  // #958: sletting må se ALT. Ville den arkiverte seksjonen ikke kommet med, ville den blitt stående
  // igjen som en foreldreløs rad etter at kurset var borte.
  const items = await courseRepository.findAllCourseItems(courseId);
  const moduleIds = Array.from(
    new Set(items.filter((i) => i.itemType === "MODULE" && i.moduleId).map((i) => i.moduleId as string)),
  );
  const sectionIds = Array.from(
    new Set(items.filter((i) => i.itemType === "SECTION" && i.sectionId).map((i) => i.sectionId as string)),
  );

  const deletableModules: CascadeDeleteEntry[] = [];
  const deletableSections: CascadeDeleteEntry[] = [];
  const sparedModules: CascadeDeleteEntry[] = [];
  const sparedSections: CascadeDeleteEntry[] = [];
  const blockers: CascadeDeleteEntry[] = [];

  // #1152: kursvakta, den samme som «Slett» (`deleteCourseInTx`), målt før noe fjernes. Alle grunnene vises.
  // `details` er de samme som feilen «Slett» kaster, ikke bare tallet: #1185 sender også datoen (`untilDate`), og uten den faller
  // klienten tilbake på tjenerens norske tekst.
  for (const block of await measureCourseDeleteBlocks(courseId, reader)) {
    const details = block.error.details && typeof block.error.details === "object" ? (block.error.details as Record<string, unknown>) : { count: block.count };
    blockers.push({ id: courseId, title: courseTitle, reason: block.reason, code: block.code, details });
  }

  const drafts = await findCourseDraftUsesForDelete({ moduleIds, sectionIds }, reader);

  for (const moduleId of moduleIds) {
    const summary = await adminContentRepository.findModuleDeleteSummary(moduleId);
    if (!summary) continue; // Referential integrity should make this impossible; skip defensively.
    const title = displayTitle(summary.title);
    // Alle kurs, også arkiverte: se «Safety model» øverst (#1149).
    const otherCourses = (await findAllCoursesContainingModule(moduleId, reader)).filter((c) => c.id !== courseId);

    if (otherCourses.length > 0) {
      sparedModules.push({
        id: moduleId,
        title,
        reason: `Delt med ${otherCourses.length} annet kurs: ${quoteCourseNames(otherCourses)}. Kobles kun fra dette kurset.`,
        stays: "shared",
      });
      continue;
    }
    if (!summary.archivedAt) {
      sparedModules.push({ id: moduleId, title, reason: NOT_ARCHIVED_REASON, stays: "not_archived" });
      continue;
    }

    const submissions = summary._count.submissions;
    const certifications = summary._count.certificationStatuses;
    if (submissions > 0 || certifications > 0) {
      const parts: string[] = [];
      if (submissions > 0) parts.push(`${submissions} innlevering${submissions === 1 ? "" : "er"}`);
      if (certifications > 0) parts.push(`${certifications} sertifisering${certifications === 1 ? "" : "er"}`);
      blockers.push({
        id: moduleId,
        title,
        reason: `Modulen «${title}» har ${parts.join(" og ")} og kan ikke slettes.`,
      });
      continue;
    }
    const inDrafts = drafts.modules.get(moduleId) ?? [];
    if (inDrafts.length > 0) {
      blockers.push(draftBlocker(moduleId, title, "Modulen", inDrafts));
      continue;
    }

    deletableModules.push({ id: moduleId, title, reason: "Kun brukt i dette kurset – slettes." });
  }

  for (const sectionId of sectionIds) {
    const section = await reader.courseSection.findUnique({
      where: { id: sectionId },
      select: { id: true, title: true, archivedAt: true },
    });
    if (!section) continue;
    const title = displayTitle(section.title);
    // Alle kurs, også arkiverte: se «Safety model» øverst (#1149).
    const otherCourses = (await findAllCoursesContainingSection(sectionId, reader)).filter((c) => c.id !== courseId);

    if (otherCourses.length > 0) {
      sparedSections.push({
        id: sectionId,
        title,
        reason: `Delt med ${otherCourses.length} annet kurs: ${quoteCourseNames(otherCourses)}. Kobles kun fra dette kurset.`,
        stays: "shared",
      });
      continue;
    }
    if (!section.archivedAt) {
      sparedSections.push({ id: sectionId, title, reason: NOT_ARCHIVED_REASON, stays: "not_archived" });
      continue;
    }
    // #938: kaskaden slettet eksklusive seksjoner DIREKTE, uten vakta `deleteSection` har. En
    // seksjon som sto i et utstedt kursbevis, ble fjernet fra sitt opprinnelige kurs og lagt
    // eksklusivt i et annet, forsvant når DET kurset ble kaskadeslettet — og beviset mistet
    // grunnlaget sitt.
    //
    // ⚠️ Vakta ligger i ANALYSEN (og i `deleteSectionInTx`). Da ser forfatteren blokkeringen i
    // forhåndsvisningen i stedet for å møte et unntak halvveis i en transaksjon.
    const certificateBlock = await describeIssuedCertificateBlock(sectionId, reader);
    if (certificateBlock) {
      blockers.push({ id: sectionId, title, reason: certificateBlock });
      continue;
    }
    const inDrafts = drafts.sections.get(sectionId) ?? [];
    if (inDrafts.length > 0) {
      blockers.push(draftBlocker(sectionId, title, "Seksjonen", inDrafts));
      continue;
    }
    deletableSections.push({ id: sectionId, title, reason: "Kun brukt i dette kurset – slettes." });
  }

  return {
    courseId,
    courseTitle,
    deletableModules,
    deletableSections,
    sparedModules,
    sparedSections,
    blockers,
    deletable: blockers.length === 0,
  };
}

// Read-only preview of what a cascade delete would remove, spare, or be blocked by.
export function getCourseCascadeDeletePreview(courseId: string): Promise<CourseCascadeDeletePreview> {
  return analyzeCourseCascade(courseId);
}

/**
 * #934 skive 4a: det administratoren så i forhåndsvisningen — hva som slettes. Klienten sender det med; stemmer
 * det ikke med analysen etter låsen, avvises slettingen (409), og ingenting er slettet. Utelatt (en eldre klient,
 * eller API-et): analysen etter låsen gjelder alene.
 */
export type CascadeDeleteExpectation = { deletedModuleIds?: string[]; deletedSectionIds?: string[] };

function sameIdSet(a: string[], b: string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Kaster når en indre slettefunksjon ikke fant raden analysen nettopp så, under samme lås. Skal ikke kunne skje. */
function vanished(type: string, id: string): never {
  throw new ConflictError(
    "course_cascade_changed",
    `The ${type} ${id} disappeared while the course was being deleted. Open the preview again; nothing was deleted.`,
  );
}

const CASCADE_SOURCE = "course_cascade_delete";

// Delete the course and its exclusively-owned modules/sections in one transaction. All-or-nothing:
// if any blocker exists we throw and delete NOTHING.
export async function cascadeDeleteCourse(
  courseId: string,
  actorId?: string,
  expected?: CascadeDeleteExpectation,
): Promise<CascadeDeleteSummary> {
  const result = await runContentWrite(async (tx) => {
    // #1152: deltakerlåsene først (før noe skrives i revisjonssporet), så analysen og `deleteCourseInTx` måler det samme: et
    // vedtak kan ikke komme imellom. Finnes kurset ikke, tas ingen lås, og analysen svarer 404.
    await lockCourseDeleteLearners(tx, courseId);
    // #934 skive 4a: hva slettingen tar med seg, avgjøres ETTER innholdslåsen, i samme transaksjon som slettingen.
    const analysis = await analyzeCourseCascade(courseId, tx);

    if (analysis.blockers.length > 0) {
      // ⚠️ #999: blokkeringene ligger som data i `details`; koden er det klienten oversetter.
      throw new DomainRuleError(
        "course_cascade_blocked",
        `Cannot delete the course: ${analysis.blockers.map((b) => b.reason).join(" ")}`,
        { blockers: analysis.blockers },
      );
    }

    const deletedModuleIds = analysis.deletableModules.map((m) => m.id);
    const deletedSectionIds = analysis.deletableSections.map((s) => s.id);
    const sparedModuleIds = analysis.sparedModules.map((m) => m.id);
    const sparedSectionIds = analysis.sparedSections.map((s) => s.id);

    if (
      (expected?.deletedModuleIds !== undefined && !sameIdSet(expected.deletedModuleIds, deletedModuleIds)) ||
      (expected?.deletedSectionIds !== undefined && !sameIdSet(expected.deletedSectionIds, deletedSectionIds))
    ) {
      throw new ConflictError(
        "course_cascade_changed",
        "What this delete would remove changed after the preview was shown. Open the preview again; nothing was deleted.",
        { deletedModuleIds, deletedSectionIds },
      );
    }

    // 1. Kurset, med «Slett»s egen funksjon og vakter. Koblingene (`CourseItem`), påmeldingene, lesingene og utkastet går med det
    //    (`onDelete: Cascade`); da er de eksklusive elementene fri. Kaskaden skriver sin egen hendelse for kurset (under).
    const course = await deleteCourseInTx(tx, courseId, { actorId, recordAudit: false });
    if (!course.deleted) vanished("course", courseId);

    // 2. De eksklusive, arkiverte modulene og seksjonene, med knappens funksjoner: versjonene i riktig rekkefølge, eierradene og
    //    én hendelse per element. Hver vurderer på nytt; en sperre her ruller alt tilbake.
    for (const moduleId of deletedModuleIds) {
      const deleted = await deleteModuleInTx(tx, moduleId, { actorId, source: CASCADE_SOURCE });
      if (!deleted.deleted) vanished("module", moduleId);
    }
    const sectionBlobPaths: string[] = [];
    for (const sectionId of deletedSectionIds) {
      const deleted = await deleteSectionInTx(tx, sectionId, { actorId, source: CASCADE_SOURCE });
      if (!deleted.deleted) vanished("section", sectionId);
      sectionBlobPaths.push(...deleted.blobPaths);
    }

    // #803: the cascade-delete summary event commits atomically with the deletes. Audit rows have no FK to the deleted entities.
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.cascadeDeleted,
        actorId,
        metadata: { courseId, deletedModuleIds, deletedSectionIds, sparedModuleIds, sparedSectionIds },
      },
      tx,
    );
    return { sectionBlobPaths, summary: { deletedCourseId: courseId, deletedModuleIds, deletedSectionIds, sparedModuleIds, sparedSectionIds } };
  }, { timeout: CASCADE_DELETE_TX_TIMEOUT_MS });

  // #758: after commit, reclaim the deleted sections' asset blobs (best-effort — a failed blob
  // delete never fails the cascade; the section rows are already gone).
  await reclaimAssetBlobs(result.sectionBlobPaths);

  return result.summary;
}

// Analysen gjøres inne i transaksjonen, med ett oppslag per element, og hver indre slettefunksjon vurderer på nytt. Et stort kurs
// skal ikke rulles tilbake av Prismas standard på 5 sekunder.
const CASCADE_DELETE_TX_TIMEOUT_MS = 30_000;
