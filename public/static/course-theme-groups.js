// 2.102.0: «Mine kurs» etter tema.
//
// Produkteier 2026-10-25: kurslista vises kategorisert på tema, og kan skifte til alfabetisk. Fullførte
// kurs står under kurslista — når den er etter tema, under hvert tema. Reglene, ett sted:
//   - temaene i den rekkefølgen tjeneren gir dem (alfabetisk på deltakerens språk);
//   - et kurs med flere tema står under hvert av dem;
//   - kurs uten tema samles sist, i gruppen «Andre kurs»;
//   - et tema uten kurs for denne deltakeren vises ikke;
//   - INNAD i en gruppe beholdes tjenerens rekkefølge (#1093: satt plassering først, så alfabetisk),
//     og gruppen deles i pågående og fullførte, som lista uten tema (#936).
//
// Ren funksjon uten DOM, så regelen kan testes for seg.

/** Gruppen for kurs uten tema. */
export const OTHER_COURSES_GROUP = "__other__";

/**
 * @param {Array<{ id: string, themes?: Array<{ id: string }> }>} courses  i tjenerens rekkefølge
 * @param {Array<{ id: string, name: string }>} themes  i tjenerens rekkefølge
 * @param {(course: any) => boolean} isCompleted
 * @returns {Array<{ id: string, name: string | null, ongoing: any[], done: any[] }>}
 */
export function groupCoursesByTheme(courses, themes, isCompleted) {
  const groups = new Map();
  for (const theme of themes ?? []) groups.set(theme.id, { id: theme.id, name: theme.name, ongoing: [], done: [] });
  const other = { id: OTHER_COURSES_GROUP, name: null, ongoing: [], done: [] };
  for (const course of courses ?? []) {
    const own = (course.themes ?? []).map((theme) => groups.get(theme.id)).filter(Boolean);
    const targets = own.length > 0 ? own : [other];
    for (const group of targets) (isCompleted(course) ? group.done : group.ongoing).push(course);
  }
  return [...groups.values(), other].filter((group) => group.ongoing.length + group.done.length > 0);
}

/** Om grupperingen sier noe: minst ett kurs har et tema. Ellers er lista bare «Andre kurs». */
export function hasAnyTheme(courses) {
  return (courses ?? []).some((course) => (course.themes ?? []).length > 0);
}
