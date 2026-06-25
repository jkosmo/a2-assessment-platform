// #496/EN-1: enrollment status is DERIVED, never stored - single source of truth against
// CourseCompletion + progress + dueAt, so it can never drift from the actual completion state
// (the same lesson as the certificate backfill bug, #627).

export type EnrollmentStatus = "ASSIGNED" | "IN_PROGRESS" | "OVERDUE" | "COMPLETED";

/**
 * Derives the status of a course enrollment. Precedence: COMPLETED -> OVERDUE -> IN_PROGRESS ->
 * ASSIGNED. A past-due enrollment that is not yet completed is OVERDUE regardless of progress.
 */
export function deriveEnrollmentStatus(input: {
  isCompleted: boolean;
  hasStarted: boolean;
  dueAt: Date | null;
  now: Date;
}): EnrollmentStatus {
  if (input.isCompleted) return "COMPLETED";
  if (input.dueAt && input.dueAt.getTime() < input.now.getTime()) return "OVERDUE";
  if (input.hasStarted) return "IN_PROGRESS";
  return "ASSIGNED";
}
