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
  const total = moduleIds.length;
  if (total === 0) return;

  const passedCount = await repo.countPassedModulesForUser(userId, moduleIds);
  if (passedCount < total) return;

  // All learning sections must be read before the certificate is issued.
  const courseItems = await repo.findCourseItems(course.id);
  const requiredSectionIds = courseItems
    .filter((item) => item.itemType === "SECTION" && item.section != null && item.section.archivedAt == null)
    .map((item) => item.section!.id);

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
