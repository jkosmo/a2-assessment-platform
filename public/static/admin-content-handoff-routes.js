export function buildAdminContentAdvancedUrl(moduleId) {
  return moduleId
    ? `/admin-content/module/${encodeURIComponent(moduleId)}/advanced`
    : "/admin-content/advanced";
}

export function buildAdminContentConversationUrl(moduleId, { resumeEditing = true } = {}) {
  if (!moduleId) return "/admin-content";
  const query = resumeEditing ? "?resumeEditing=1" : "";
  return `/admin-content/module/${encodeURIComponent(moduleId)}/conversation${query}`;
}

export function resolveConversationModuleId({ selectedModuleId, search = "" }) {
  return selectedModuleId || new URLSearchParams(search).get("moduleId") || "";
}
