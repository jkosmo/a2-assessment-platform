// Admin-UI deep links returned by agent-friendly create/import responses —
// AA-2 (#650, EPIC #647). URL patterns are the canonical routes from
// doc/route-map.md; a skill shows these to the user so a human can review and
// publish the drafts the agent created.

export function moduleAdminLinks(moduleId: string) {
  return {
    conversation: `/admin-content/module/${moduleId}/conversation`,
    advanced: `/admin-content/module/${moduleId}/advanced`,
  };
}

export function courseAdminLinks(courseId: string) {
  return {
    course: `/admin-content/courses/${courseId}`,
  };
}

export function sectionAdminLinks(sectionId: string) {
  return {
    editor: `/admin-content/sections?id=${sectionId}`,
  };
}
