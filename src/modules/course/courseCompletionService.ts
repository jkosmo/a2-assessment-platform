import { prisma } from "../../db/prisma.js";
import { createCourseRepository } from "./courseRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import type { DbTransactionClient } from "../../db/transaction.js";

type CompletionTxClient = Pick<
  DbTransactionClient,
  "course" | "courseModule" | "courseItem" | "courseCompletion" | "courseSectionRead" | "certificationStatus" | "auditEvent" | "submission"
>;

type CourseRepo = ReturnType<typeof createCourseRepository>;

/**
 * Evaluates and (if newly satisfied) issues a course completion for one course.
 * Certification requires BOTH: all modules passed AND all learning sections read (#525/#476).
 */
async function evaluateCourseCompletion(
  repo: CourseRepo,
  userId: string,
  course: { id: string; modules: { moduleId: string }[] },
  tx?: CompletionTxClient,
): Promise<void> {
  const moduleIds = course.modules.map((m) => m.moduleId);

  // A course can be pure-reading (no assessment modules) — the LMS Tier 2 markdown-first
  // courses (#476). For those, reading every learning section is the only certification gate,
  // so we must NOT bail on `moduleIds.length === 0`. Gates are computed over BOTH modules and
  // sections, exactly matching the "completed" definition the progress view uses
  // (passed === all modules AND read === all sections). The old `if (total === 0) return` only
  // counted modules, so reading-only courses showed "Fullført" in the list yet never issued a
  // certificate (#580 follow-up).
  const courseItems = await repo.findCourseItems(course.id);
  const requiredSectionIds = courseItems
    .filter((item) => item.itemType === "SECTION" && item.section != null && item.section.archivedAt == null)
    .map((item) => item.section!.id);

  // Truly empty course (no modules AND no sections) is never completable.
  if (moduleIds.length === 0 && requiredSectionIds.length === 0) return;

  if (moduleIds.length > 0) {
    const passedCount = await repo.countPassedModulesForUser(userId, moduleIds);
    if (passedCount < moduleIds.length) return;
  }

  if (requiredSectionIds.length > 0) {
    const readSectionIds = new Set(await repo.findReadSectionIds(userId, course.id));
    const allSectionsRead = requiredSectionIds.every((id) => readSectionIds.has(id));
    if (!allSectionsRead) return;
  }

  const existing = await repo.findCourseCompletion(userId, course.id);
  if (existing) return;

  const completion = await repo.createCourseCompletion(userId, course.id, JSON.stringify(moduleIds));

  await recordAuditEvent(
    {
      entityType: auditEntityTypes.course,
      entityId: course.id,
      action: auditActions.course.completionIssued,
      actorId: userId,
      metadata: { userId, courseId: course.id, certificateId: completion.certificateId },
    },
    tx,
  );
}

/** Re-check completion for every published course containing the module that was just passed. */
export async function checkAndIssueCourseCompletions(
  input: { userId: string; moduleId: string },
  tx?: CompletionTxClient,
) {
  const client = (tx ?? prisma) as Parameters<typeof createCourseRepository>[0];
  const repo = createCourseRepository(client);

  const courses = await repo.findPublishedCoursesContainingModule(input.moduleId);
  if (courses.length === 0) return;

  for (const course of courses) {
    await evaluateCourseCompletion(repo, input.userId, course, tx);
  }
}

/**
 * Re-check completion for a single course — called after a section is marked read (#476), since
 * reading the final section can be the last gate even when all modules are already passed.
 */
export async function checkCourseCompletionForCourse(
  input: { userId: string; courseId: string },
  tx?: CompletionTxClient,
) {
  const client = (tx ?? prisma) as Parameters<typeof createCourseRepository>[0];
  const repo = createCourseRepository(client);

  const course = await repo.findCourseById(input.courseId);
  if (!course || !course.publishedAt || course.archivedAt) return;

  await evaluateCourseCompletion(repo, input.userId, course, tx);
}

/**
 * Idempotent reconciliation across ALL published courses for a user. Completion + certificate
 * issuance is event-driven (fired when the last module passes or the last section is read); if that
 * event was ever missed — data created before the logic existed, a dropped fire-and-forget, or a
 * completion path that didn't trigger it — a course can show "completed" in the progress view yet
 * have no certificate. This sweep, run when the user opens their certificates page, backfills any
 * completion whose gates (all modules passed + all sections read) are now satisfied.
 */
export async function reconcileCourseCompletionsForUser(userId: string, tx?: CompletionTxClient) {
  const client = (tx ?? prisma) as Parameters<typeof createCourseRepository>[0];
  const repo = createCourseRepository(client);

  const courses = await repo.findPublishedCourses();
  for (const course of courses) {
    // Per-course isolation: a single malformed course must never blank the user's entire
    // certificate list (or 500 the page that triggers this sweep). Backfill is best-effort.
    try {
      await evaluateCourseCompletion(repo, userId, course, tx);
    } catch (error) {
      console.warn(
        `[course-completion] reconcile skipped course ${course.id} for user ${userId}:`,
        error,
      );
    }
  }
}
