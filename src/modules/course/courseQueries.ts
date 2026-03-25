import type { CourseStatus } from "./courseReadModels.js";

export function computeCourseStatus(passedCount: number, total: number): CourseStatus {
  if (total === 0 || passedCount === 0) return "NOT_STARTED";
  if (passedCount >= total) return "COMPLETED";
  return "IN_PROGRESS";
}
