import { prisma } from "../../db/prisma.js";
import { createCourseRepository } from "./courseRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import type { DbTransactionClient } from "../../db/transaction.js";

type CompletionTxClient = Pick<
  DbTransactionClient,
  "course" | "courseModule" | "courseCompletion" | "certificationStatus" | "auditEvent" | "submission"
>;

export async function checkAndIssueCourseCompletions(
  input: { userId: string; moduleId: string },
  tx?: CompletionTxClient,
) {
  const client = (tx ?? prisma) as Parameters<typeof createCourseRepository>[0];
  const repo = createCourseRepository(client);

  const courses = await repo.findPublishedCoursesContainingModule(input.moduleId);
  if (courses.length === 0) return;

  for (const course of courses) {
    const moduleIds = course.modules.map((m) => m.moduleId);
    const total = moduleIds.length;
    if (total === 0) continue;

    const passedCount = await repo.countPassedModulesForUser(input.userId, moduleIds);
    if (passedCount < total) continue;

    const existing = await repo.findCourseCompletion(input.userId, course.id);
    if (existing) continue;

    const completion = await repo.createCourseCompletion(
      input.userId,
      course.id,
      JSON.stringify(moduleIds),
    );

    await recordAuditEvent(
      {
        entityType: auditEntityTypes.course,
        entityId: course.id,
        action: auditActions.course.completionIssued,
        actorId: input.userId,
        metadata: {
          userId: input.userId,
          courseId: course.id,
          certificateId: completion.certificateId,
        },
      },
      tx,
    );
  }
}
