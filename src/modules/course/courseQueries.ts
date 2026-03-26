import type { CourseStatus } from "./courseReadModels.js";

export function computeCourseStatus(passedCount: number, total: number, hasStarted = passedCount > 0): CourseStatus {
  if (total === 0) return "NOT_STARTED";
  if (passedCount >= total) return "COMPLETED";
  if (hasStarted) return "IN_PROGRESS";
  if (passedCount === 0) return "NOT_STARTED";
  return "IN_PROGRESS";
}
