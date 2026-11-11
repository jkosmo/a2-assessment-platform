// #1139 skive 0 (doc/design/PLAN_1139.md, punkt 5 og 10): framdriften i «Mine kurs» i ÉN funksjon. Lå inne i ruta
// `GET /api/courses`; flyttet hit uendret, så den ukentlige e-posten (skive 1) og «Mine kurs» aldri kan si forskjellige ting om hva
// som er påbegynt. Ruta sorterer og svarer; alt annet skjer her.
//
// Tar `roles` og `groupIds` som parametre: ruta sender dem fra innloggingen, workeren (skive 3) rollene lagret i databasen og ingen
// grupper (kjent mangel, planen 12.2).
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { queryLatestSubmissionsForModules } from "../submission/submissionRepository.js";
import { courseRepository } from "./courseRepository.js";
import { computeCourseStatus } from "./courseQueries.js";
import { filterVisibleCourseIds } from "./enrollmentService.js";
import { getClassAssignedCourseDueDates, getUserClassIds } from "./classService.js";
import { findLocalizedThemesForCourses } from "./courseThemeService.js";
import type { CourseListItem } from "./courseReadModels.js";

export type MyCoursesProgressInput = {
  userId: string;
  roles: string[];
  groupIds?: string[];
  locale: SupportedLocale;
};

export type MyCoursesProgress = {
  /** Kursene personen ser i «Mine kurs», med framdrift, i rekkefølgen fra databasen (ruta sorterer). */
  items: CourseListItem[];
  /** Klassefristen per kurs fra personens klasser (tidligste), som `getClassAssignedCourseDueDates` gir den. */
  classCourseDue: Map<string, Date | null>;
};

export async function getMyCoursesProgress({ userId, roles, groupIds, locale }: MyCoursesProgressInput): Promise<MyCoursesProgress> {
  const allCourses = await courseRepository.findPublishedCourses();
  // #496/EN-2 + #645/CL-2: RESTRICTED courses are visible to users with an individual enrolment OR
  // a class assignment (member of a class the course is assigned to); OPEN courses to everyone.
  const classIds = await getUserClassIds({ userId, roles, groupIds });
  const classCourseDue = await getClassAssignedCourseDueDates(classIds, userId);
  const visibleIds = await filterVisibleCourseIds(userId, allCourses, new Set(classCourseDue.keys()));
  const courses = allCourses.filter((course) => visibleIds.has(course.id));

  // #799: batch every per-course read across ALL visible courses (a fixed number of queries) instead of
  // ~4 queries per course, then derive each course's progress in memory. Behaviour-preserving — the same
  // counts as the previous per-course version, just fetched together.
  const courseIds = courses.map((course) => course.id);
  const allModuleIds = courses.flatMap((course) => course.modules.map((m) => m.moduleId));

  const [sectionRows, moduleProgress, readRows, latestSubmissions] = await Promise.all([
    courseRepository.findCourseItemSectionIdsForCourses(courseIds),
    // #934 skive 5a-3: beståtte per kurs. Samme modul kan telle i ett kurs og ikke i et annet.
    courseRepository.findModuleProgress({
      userIds: [userId],
      courses: courses.map((course) => ({ courseId: course.id, moduleIds: course.modules.map((m) => m.moduleId) })),
    }),
    courseRepository.findReadSectionIdsForCourses(userId, courseIds),
    allModuleIds.length > 0 ? queryLatestSubmissionsForModules(userId, allModuleIds) : Promise.resolve([]),
  ]);

  const sectionIdsByCourse = new Map<string, string[]>();
  for (const row of sectionRows) {
    const list = sectionIdsByCourse.get(row.courseId);
    if (list) list.push(row.sectionId);
    else sectionIdsByCourse.set(row.courseId, [row.sectionId]);
  }
  const readSectionsByCourse = new Map<string, Set<string>>();
  for (const row of readRows) {
    const set = readSectionsByCourse.get(row.courseId);
    if (set) set.add(row.sectionId);
    else readSectionsByCourse.set(row.courseId, new Set([row.sectionId]));
  }
  const startedModuleIds = new Set(latestSubmissions.map((s) => s.moduleId));
  // 2.102.0: temaene i «Mine kurs». Ett kall for alle kursene.
  const themesByCourse = await findLocalizedThemesForCourses(courseIds, locale);

  const items: CourseListItem[] = courses.map((course) => {
    // #938/#945: samme filter som kursdetaljen og bevisporten — den tredje telleren.
    const moduleIds = course.modules.filter((m) => m.module?.archivedAt == null).map((m) => m.moduleId);
    const sectionIds = sectionIdsByCourse.get(course.id) ?? [];
    const passedInCourse = moduleProgress.passedModuleIds(userId, course.id);
    const passed = moduleIds.filter((id) => passedInCourse.has(id)).length;
    const readSet = readSectionsByCourse.get(course.id);
    const readCount = readSet ? sectionIds.filter((id) => readSet.has(id)).length : 0;
    const total = moduleIds.length + sectionIds.length;
    const completed = passed + readCount;
    const hasStarted = moduleIds.some((id) => startedModuleIds.has(id)) || readCount > 0;

    return {
      id: course.id,
      title: localizeContentText(locale, course.title) ?? course.title,
      description: localizeContentText(locale, course.description) ?? course.description,
      sortOrder: course.sortOrder ?? null,
      slug: course.slug ?? null,
      themes: themesByCourse.get(course.id) ?? [],
      moduleCount: moduleIds.length,
      progress: {
        completed,
        total,
        courseStatus: computeCourseStatus(completed, total, hasStarted),
        moduleCompleted: passed,
        moduleTotal: moduleIds.length,
        sectionCompleted: readCount,
        sectionTotal: sectionIds.length,
      },
    };
  });

  return { items, classCourseDue };
}
