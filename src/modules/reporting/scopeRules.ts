// #1058: den rene regelen — ingen database — så kursrapportens enhetstester kan laste den uten prisma.
import type { ReportFilters } from "./types.js";

/** Kursene rapporten kan se etter at valgt kurs og tillatte kurs er lagt sammen. undefined = alle. */
export function effectiveCourseIds(filters: Pick<ReportFilters, "courseId" | "allowedCourseIds">): string[] | undefined {
  const allowed = filters.allowedCourseIds;
  if (filters.courseId) {
    if (allowed && !allowed.includes(filters.courseId)) return [];
    return [filters.courseId];
  }
  return allowed ?? undefined;
}

