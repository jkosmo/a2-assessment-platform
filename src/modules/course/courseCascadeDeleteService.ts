import { prisma } from "../../db/prisma.js";
import { runContentWrite } from "../../db/contentLock.js";
import { ConflictError, DomainRuleError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import { createAdminContentRepository } from "../adminContent/adminContentRepository.js";
import { createCourseRepository } from "./courseRepository.js";
import { describeIssuedCertificateBlock, findAllCoursesContainingModule, findAllCoursesContainingSection, type LifecycleReader } from "./contentLifecycle.js";
import { collectSectionAssetBlobPaths, reclaimAssetBlobs } from "./assetCommands.js";
import { clearArchiveMarksForCourse } from "./courseArchive.js";
import { deleteRequiresArchivedError } from "../content/archivedGuard.js";

// #762 — ADMINISTRATOR-only destructive cleanup: delete a course together with the modules and
// sections that ONLY that course owns, while never destroying real assessment/achievement records.
//
// Safety model (load-bearing — the FK order and the guards below mirror the proven bulk-purge path):
//   - A module/section is EXCLUSIVE to course C when C is the only course that references it (via
//     CourseItem). Shared items are SPARED — merely unlinked from C, never deleted.
//     ⚠️ #1149: «andre kurs» er ALLE kurs her, også arkiverte (`findAllCoursesContaining…`). Dette er en
//     SLETTING. Telte bare aktive kurs, ville et element som også ligger i et arkivert kurs se eksklusivt ut
//     og bli forsøkt slettet under det arkiverte kurset (og stoppet av `CourseItem` → `onDelete: Restrict`,
//     så hele kaskaden rullet tilbake). Regelen «arkiverte kurs teller ikke som bruk» gjelder visning,
//     avpublisering og arkivering — ikke sletting. Sletting av innhold i arkiverte kurs hører til #1152.
//   - PRESERVED records must never be destroyed: an exclusive module with submissions > 0 OR
//     certificationStatuses > 0, or a course with completions > 0, become BLOCKERS.
//   - The delete is ALL-OR-NOTHING: if any blocker exists the operation throws and deletes nothing.
//
// The FK constraints (see prisma/schema.prisma) that make the ordering load-bearing:
//   - CourseItem → Module/Section is Restrict, so C's CourseItem rows are removed first to unlink.
//   - ModuleVersion → Module is Restrict, and ModuleVersion → Rubric/Prompt/MCQSet version is Restrict,
//     so ModuleVersion rows are deleted BEFORE the rubric/prompt/mcq-set versions they reference.
//   - MCQQuestion → MCQSetVersion/Module is Restrict, so questions go before the MCQ set versions.
//   - CourseSectionVersion → CourseSection is Restrict; CourseSectionRead/SectionAsset → section is
//     Cascade (they disappear with the section). CourseCompletion → Course is Restrict (guarded above).

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
  reason: string;
};

export type CourseCascadeDeletePreview = {
  courseId: string;
  courseTitle: string;
  // Exclusive to this course and free of preserved records — will be deleted.
  deletableModules: CascadeDeleteEntry[];
  deletableSections: CascadeDeleteEntry[];
  // Shared with other courses — will only be unlinked from this course, never deleted.
  sparedModules: CascadeDeleteEntry[];
  sparedSections: CascadeDeleteEntry[];
  // Reasons the whole operation is blocked (course completions, or an exclusive module with
  // submissions/certifications). When non-empty the delete refuses and nothing is removed.
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

// Shared analysis used by both preview and delete so the two can never diverge.
// #934 skive 4a: slettingen kjører analysen på NYTT med transaksjonen som holder innholdslåsen. Forhåndsvisningen
// administratoren så, er bare et forslag: en seksjon som var delt (og skulle spares), kan ha blitt tatt ut av det
// andre kurset i mellomtiden — og ville da blitt slettet (Codex runde 2 nr. 4).
async function analyzeCourseCascade(courseId: string, reader: LifecycleReader = prisma): Promise<CascadeAnalysis> {
  const courseRepository = createCourseRepository(reader);
  const adminContentRepository = createAdminContentRepository(reader);
  const course = await reader.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, archivedAt: true },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  // #1151 (G4): bare et arkivert kurs kan slettes, også med innhold. Her, så forhåndsvisningen og slettingen svarer likt.
  // Elementene som bare brukes i kurset, fulgte det vanligvis inn i arkivet (#1150). Ikke alltid: et kurs arkivert før 2.159.0,
  // eller et element gjenopprettet for hånd mens kurset var arkivert. Da sletter kaskaden aktive elementer, som før (QA-porten
  // #1151); forhåndsvisningen lister dem.
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

  // Course-level blocker: issued completions (certificates) are achievement records we never destroy.
  const completionCount = await reader.courseCompletion.count({ where: { courseId } });
  if (completionCount > 0) {
    blockers.push({
      id: courseId,
      title: courseTitle,
      reason:
        `Kurset har ${completionCount} fullføring${completionCount === 1 ? "" : "er"} (utstedte bevis). ` +
        `Det blir stående arkivert, med fullføringene.`,
    });
  }

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
      });
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

    deletableModules.push({ id: moduleId, title, reason: "Kun brukt i dette kurset – slettes." });
  }

  for (const sectionId of sectionIds) {
    const section = await reader.courseSection.findUnique({
      where: { id: sectionId },
      select: { id: true, title: true },
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
      });
    } else {
      // #938: kaskaden slettet eksklusive seksjoner DIREKTE, uten vakta `deleteSection` har. En
      // seksjon som sto i et utstedt kursbevis, ble fjernet fra sitt opprinnelige kurs og lagt
      // eksklusivt i et annet, forsvant når DET kurset ble kaskadeslettet — og beviset mistet
      // grunnlaget sitt.
      //
      // ⚠️ Vakta ligger i ANALYSEN, ikke i slettingen. Da ser forfatteren blokkeringen i
      // forhåndsvisningen i stedet for å møte et unntak halvveis i en transaksjon.
      const certificateBlock = await describeIssuedCertificateBlock(sectionId, reader);
      if (certificateBlock) {
        blockers.push({ id: sectionId, title, reason: certificateBlock });
      } else {
        deletableSections.push({ id: sectionId, title, reason: "Kun brukt i dette kurset – slettes." });
      }
    }
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

// Delete the course and its exclusively-owned modules/sections in one transaction. All-or-nothing:
// if any blocker exists we throw a ValidationError naming them and delete NOTHING.
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

export async function cascadeDeleteCourse(
  courseId: string,
  actorId?: string,
  expected?: CascadeDeleteExpectation,
): Promise<CascadeDeleteSummary> {
  const result = await runContentWrite(async (tx) => {
    // #934 skive 4a: hva slettingen tar med seg, avgjøres ETTER innholdslåsen, i samme transaksjon som slettingen.
    const analysis = await analyzeCourseCascade(courseId, tx);

    if (analysis.blockers.length > 0) {
      // ⚠️ #999: DEN SISTE NORSKE PROSAEN I SETTET. Den ble vist ordrett i et engelsk grensesnitt.
      //
      // Blokkeringene lå allerede som data i `details` — det var bare selve setningen som var norsk,
      // og som klienten ikke kunne oversette fordi kastet manglet en kode.
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

    // #758: capture the exclusive sections' asset blob paths before the transaction deletes them —
    // SectionAsset cascades away with each section, so this is the last chance to learn the paths.
    const sectionBlobPaths = await collectSectionAssetBlobPaths(deletedSectionIds, tx);

    // 1. Unlink modules/sections from this course so the CourseItem Restrict FK no longer blocks
    //    deleting them.
    await tx.courseItem.deleteMany({ where: { courseId } });

    // 2. Delete each exclusive module + its version rows. The blocker check guarantees no submissions
    //    exist, so no MCQAttempt/AssessmentDecision/CertificationStatus references the version rows.
    //    Order mirrors the proven bulk purge: null the active pointer, then delete ModuleVersion (it
    //    Restrict-references rubric/prompt/mcq versions), then MCQQuestion, then the referenced
    //    rubric/prompt/mcq-set versions, then the module itself.
    for (const moduleId of deletedModuleIds) {
      await tx.module.update({ where: { id: moduleId }, data: { activeVersionId: null } });
      await tx.moduleVersion.deleteMany({ where: { moduleId } });
      await tx.mCQQuestion.deleteMany({ where: { moduleId } });
      await tx.mCQSetVersion.deleteMany({ where: { moduleId } });
      await tx.rubricVersion.deleteMany({ where: { moduleId } });
      await tx.promptTemplateVersion.deleteMany({ where: { moduleId } });
      await tx.module.delete({ where: { id: moduleId } });
    }

    // 3. Delete each exclusive section. Detach activeVersion first (self-reference), delete versions,
    //    then the section — CourseSectionRead + SectionAsset cascade away with it.
    for (const sectionId of deletedSectionIds) {
      await tx.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
      await tx.courseSectionVersion.deleteMany({ where: { sectionId } });
      await tx.courseSection.delete({ where: { id: sectionId } });
    }

    // 4. Delete the course. Remaining Cascade relations (enrollments, section reads, group
    //    assignments, discussion threads) are removed by the DB; CourseCompletion is Restrict but
    //    guaranteed empty by the blocker check above.
    // #1150 skive 2a-2: elementer som overlever, og som fulgte kurset inn i arkivet, skal ikke peke på et kurs som ikke finnes.
    await clearArchiveMarksForCourse(tx, courseId);
    await tx.course.delete({ where: { id: courseId } });

    // #803: the cascade-delete audit (one summary event for the course + a per-module deleted event,
    // consistent with the bulk purge) commits atomically with the deletes. Audit rows have no FK to the
    // deleted entities, so referencing removed ids is safe.
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
    for (const moduleId of deletedModuleIds) {
      await recordAuditEvent(
        {
          entityType: auditEntityTypes.module,
          entityId: moduleId,
          action: auditActions.adminContent.moduleDeleted,
          actorId,
          metadata: { moduleId, source: "course_cascade_delete" },
        },
        tx,
      );
    }
    return { sectionBlobPaths, summary: { deletedCourseId: courseId, deletedModuleIds, deletedSectionIds, sparedModuleIds, sparedSectionIds } };
  }, { timeout: CASCADE_DELETE_TX_TIMEOUT_MS });

  // #758: after commit, reclaim the deleted sections' asset blobs (best-effort — a failed blob
  // delete never fails the cascade; the section rows are already gone).
  await reclaimAssetBlobs(result.sectionBlobPaths);

  return result.summary;
}

// Analysen gjøres nå inne i transaksjonen, med ett oppslag per element. Et stort kurs skal ikke rulles tilbake av
// Prismas standard på 5 sekunder.
const CASCADE_DELETE_TX_TIMEOUT_MS = 30_000;
