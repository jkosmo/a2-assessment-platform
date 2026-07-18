export function detectCoursesRoute(pathname) {
  if (pathname === "/admin-content/courses/new" || pathname.endsWith("/courses/new")) {
    return { view: "detail", courseId: null };
  }

  const match = pathname.match(/\/admin-content\/courses\/([^/]+)$/);
  if (match) {
    return { view: "detail", courseId: match[1] };
  }

  return { view: "list" };
}

export function buildCourseDeleteDialogText(courseTitle) {
  return `Er du sikker på at du vil slette kurset «${courseTitle}»? Modulene forblir i biblioteket uendret.`;
}

// #524 (U3): pure reorder for the course-builder mixed module/section list. Returns a NEW array with
// the item at `index` swapped one step `dir` ("up"/"down"). Out-of-bounds moves (top item up, bottom
// item down, bad index) return the list unchanged. The builder re-renders from the result.
export function moveItem(list, index, dir) {
  const items = Array.isArray(list) ? [...list] : [];
  const swap = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || swap < 0 || swap >= items.length) return items;
  [items[index], items[swap]] = [items[swap], items[index]];
  return items;
}

// #524 (U3): the type badge on each course-builder row — sections are visually distinguished from
// modules ([SEKSJON] vs [MODUL] colour-coding, keyed off this label + the row's data-item-type).
export function courseItemTypeBadge(type) {
  return type === "SECTION" ? "SEKSJON" : "MODUL";
}

export function deriveCourseListRows(courses, { localizeTitle, formatDate }) {
  return (courses ?? []).map((course) => ({
    courseId: course.id,
    title: localizeTitle(course.title) || course.id,
    certificationLevel: course.certificationLevel ?? "",
    moduleCount: course.moduleCount ?? 0,
    updatedLabel: formatDate(course.updatedAt ?? course.publishedAt ?? null),
    publishedAt: course.publishedAt ?? null,
    archivedAt: course.archivedAt ?? null,
    inProgressCount: course.inProgressCount ?? 0,
  }));
}
