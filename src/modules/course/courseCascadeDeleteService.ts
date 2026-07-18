import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import { adminContentRepository } from "../adminContent/adminContentRepository.js";
import { courseRepository } from "./courseRepository.js";
import { findCoursesContainingModule, findCoursesContainingSection } from "./contentLifecycle.js";
import { collectSectionAssetBlobPaths, reclaimAssetBlobs } from "./assetCommands.js";

// #762 — ADMINISTRATOR-only destructive cleanup: delete a course together with the modules and
// sections that ONLY that course owns, while never destroying real assessment/achievement records.
//
// Safety model (load-bearing — the FK order and the guards below mirror the proven bulk-purge path):
//   - A module/section is EXCLUSIVE to course C when C is the only course that references it (via
//     CourseItem). Shared items are SPARED — merely unlinked from C, never deleted.
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
async function analyzeCourseCascade(courseId: string): Promise<CascadeAnalysis> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true },
  });
  if (!course) throw new NotFoundError("Course", "course_not_found", "Course not found.");
  const courseTitle = displayTitle(course.title);

  const items = await courseRepository.findCourseItems(courseId);
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
  const completionCount = await prisma.courseCompletion.count({ where: { courseId } });
  if (completionCount > 0) {
    blockers.push({
      id: courseId,
      title: courseTitle,
      reason:
        `Kurset har ${completionCount} fullføring${completionCount === 1 ? "" : "er"} (utstedte bevis). ` +
        `Arkiver kurset i stedet for å beholde fullføringene.`,
    });
  }

  for (const moduleId of moduleIds) {
    const summary = await adminContentRepository.findModuleDeleteSummary(moduleId);
    if (!summary) continue; // Referential integrity should make this impossible; skip defensively.
    const title = displayTitle(summary.title);
    const otherCourses = (await findCoursesContainingModule(moduleId)).filter((c) => c.id !== courseId);

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
    const section = await prisma.courseSection.findUnique({
      where: { id: sectionId },
      select: { id: true, title: true },
    });
    if (!section) continue;
    const title = displayTitle(section.title);
    const otherCourses = (await findCoursesContainingSection(sectionId)).filter((c) => c.id !== courseId);

    if (otherCourses.length > 0) {
      sparedSections.push({
        id: sectionId,
        title,
        reason: `Delt med ${otherCourses.length} annet kurs: ${quoteCourseNames(otherCourses)}. Kobles kun fra dette kurset.`,
      });
    } else {
      deletableSections.push({ id: sectionId, title, reason: "Kun brukt i dette kurset – slettes." });
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
export async function cascadeDeleteCourse(
  courseId: string,
  actorId?: string,
): Promise<CascadeDeleteSummary> {
  const analysis = await analyzeCourseCascade(courseId);

  if (analysis.blockers.length > 0) {
    throw new ValidationError(
      `Kan ikke slette kurset: ${analysis.blockers.map((b) => b.reason).join(" ")}`,
      { blockers: analysis.blockers },
    );
  }

  const deletedModuleIds = analysis.deletableModules.map((m) => m.id);
  const deletedSectionIds = analysis.deletableSections.map((s) => s.id);
  const sparedModuleIds = analysis.sparedModules.map((m) => m.id);
  const sparedSectionIds = analysis.sparedSections.map((s) => s.id);

  // #758: capture the exclusive sections' asset blob paths before the transaction deletes them —
  // SectionAsset cascades away with each section, so this is the last chance to learn the paths.
  const sectionBlobPaths = await collectSectionAssetBlobPaths(deletedSectionIds);

  await runInTransaction(async (tx) => {
    // 1. Unlink modules/sections from this course so the CourseItem Restrict FK no longer blocks
    //    deleting them. CourseModule is the deprecated join (kept during expand-contract) — remove
    //    it too so the course delete's own FKs are clear.
    await tx.courseItem.deleteMany({ where: { courseId } });
    await tx.courseModule.deleteMany({ where: { courseId } });

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
    await tx.course.delete({ where: { id: courseId } });
  });

  // #758: after commit, reclaim the deleted sections' asset blobs (best-effort — a failed blob
  // delete never fails the cascade; the section rows are already gone).
  await reclaimAssetBlobs(sectionBlobPaths);

  // Audit: one summary event for the course, plus a per-module deleted event (consistent with the
  // bulk purge). Audit rows have no FK to the deleted entities, so referencing removed ids is safe.
  await recordAuditEvent({
    entityType: auditEntityTypes.course,
    entityId: courseId,
    action: auditActions.course.cascadeDeleted,
    actorId,
    metadata: { courseId, deletedModuleIds, deletedSectionIds, sparedModuleIds, sparedSectionIds },
  });
  for (const moduleId of deletedModuleIds) {
    await recordAuditEvent({
      entityType: auditEntityTypes.module,
      entityId: moduleId,
      action: auditActions.adminContent.moduleDeleted,
      actorId,
      metadata: { moduleId, source: "course_cascade_delete" },
    });
  }

  return { deletedCourseId: courseId, deletedModuleIds, deletedSectionIds, sparedModuleIds, sparedSectionIds };
}
