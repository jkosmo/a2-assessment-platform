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

export function deriveCourseListRows(courses, { localizeTitle, formatDate }) {
  return (courses ?? []).map((course) => ({
    courseId: course.id,
    title: localizeTitle(course.title) || course.id,
    certificationLevel: course.certificationLevel ?? "",
    moduleCount: course.moduleCount ?? 0,
    updatedLabel: formatDate(course.updatedAt ?? course.publishedAt ?? null),
  }));
}
