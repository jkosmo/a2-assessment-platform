/**
 * module-status-logic.js
 *
 * Pure, DOM-free functions for deriving module publication status chains.
 * Importable in both browser (admin-content.js) and Node.js (Vitest tests).
 *
 * Exported:
 *   findLinkedVersion(versions, id)  → version object | null
 *   deriveModuleStatusChains(moduleExport) → chains object | null
 */

export function findLinkedVersion(versions, id) {
  if (!Array.isArray(versions) || !id) {
    return null;
  }
  return versions.find((version) => version.id === id) ?? null;
}

/**
 * Derives publication chains and status metadata from a raw module export.
 *
 * Does NOT call localizeContentValue — callers add locale-dependent fields
 * (title, description) on top of the returned object.
 *
 * @param {object|null} moduleExport  Full module export payload
 * @returns {{
 *   hasLiveVersion: boolean,
 *   hasDraftVersion: boolean,
 *   hasAnySavedVersions: boolean,
 *   badgeClass: string,
 *   badgeKey: string,
 *   summaryKey: string,
 *   liveChain: Array<{label:string, versionNo:number}>,
 *   latestDraftChain: Array<{label:string, versionNo:number}>,
 *   versionsCountsChain: Array<{label:string, versionNo:number}>,
 *   publishedAt: string|null,
 *   technicalDetails: object,
 * } | null}
 */
export function deriveModuleStatusChains(moduleExport) {
  if (!moduleExport?.module) {
    return null;
  }

  const module = moduleExport.module;
  const moduleVersions = moduleExport?.versions?.moduleVersions ?? [];
  const rubricVersions = moduleExport?.versions?.rubricVersions ?? [];
  const promptTemplateVersions = moduleExport?.versions?.promptTemplateVersions ?? [];
  const mcqSetVersions = moduleExport?.versions?.mcqSetVersions ?? [];

  const liveModuleVersion = module.activeVersionId
    ? findLinkedVersion(moduleVersions, module.activeVersionId)
    : null;
  const latestModuleVersion = moduleVersions[0] ?? null;
  const latestRubricVersion = rubricVersions[0] ?? null;
  const latestPromptTemplateVersion = promptTemplateVersions[0] ?? null;
  const latestMcqSetVersion = mcqSetVersions[0] ?? null;

  const liveRubricVersion = liveModuleVersion
    ? findLinkedVersion(rubricVersions, liveModuleVersion.rubricVersionId)
    : null;
  const livePromptTemplateVersion = liveModuleVersion
    ? findLinkedVersion(promptTemplateVersions, liveModuleVersion.promptTemplateVersionId)
    : null;
  const liveMcqSetVersion = liveModuleVersion
    ? findLinkedVersion(mcqSetVersions, liveModuleVersion.mcqSetVersionId)
    : null;

  const latestDraftModuleVersion = liveModuleVersion
    ? latestModuleVersion && latestModuleVersion.id !== liveModuleVersion.id
      ? latestModuleVersion
      : null
    : latestModuleVersion;
  const latestDraftRubricVersion = latestDraftModuleVersion
    ? findLinkedVersion(rubricVersions, latestDraftModuleVersion.rubricVersionId)
    : null;
  const latestDraftPromptTemplateVersion = latestDraftModuleVersion
    ? findLinkedVersion(promptTemplateVersions, latestDraftModuleVersion.promptTemplateVersionId)
    : null;
  const latestDraftMcqSetVersion = latestDraftModuleVersion
    ? findLinkedVersion(mcqSetVersions, latestDraftModuleVersion.mcqSetVersionId)
    : null;

  const hasLiveVersion = Boolean(liveModuleVersion);
  const hasDraftVersion = Boolean(latestDraftModuleVersion);
  const hasAnySavedVersions = Boolean(
    latestModuleVersion || latestRubricVersion || latestPromptTemplateVersion || latestMcqSetVersion,
  );

  let badgeKey = "adminContent.status.badge.none";
  let badgeClass = "shell";
  let summaryKey = "adminContent.status.noneSummary";

  if (hasLiveVersion && hasDraftVersion) {
    badgeKey = "adminContent.status.badge.draft";
    badgeClass = "draft";
    summaryKey = "adminContent.status.summary.liveWithDraft";
  } else if (hasLiveVersion) {
    badgeKey = "adminContent.status.badge.live";
    badgeClass = "live";
    summaryKey = "adminContent.status.summary.liveOnly";
  } else if (hasAnySavedVersions) {
    badgeKey = "adminContent.status.badge.draftOnly";
    badgeClass = "draft";
    summaryKey = "adminContent.status.summary.draftOnly";
  } else {
    badgeKey = "adminContent.status.badge.shellOnly";
    badgeClass = "shell";
    summaryKey = "adminContent.status.summary.shellOnly";
  }

  return {
    hasLiveVersion,
    hasDraftVersion,
    hasAnySavedVersions,
    badgeClass,
    badgeKey,
    summaryKey,
    liveChain: liveModuleVersion
      ? [
          { label: "Module", versionNo: liveModuleVersion.versionNo },
          liveRubricVersion ? { label: "Rubric", versionNo: liveRubricVersion.versionNo } : null,
          livePromptTemplateVersion ? { label: "Prompt", versionNo: livePromptTemplateVersion.versionNo } : null,
          liveMcqSetVersion ? { label: "MCQ", versionNo: liveMcqSetVersion.versionNo } : null,
        ].filter(Boolean)
      : [],
    latestDraftChain: latestDraftModuleVersion
      ? [
          { label: "Module", versionNo: latestDraftModuleVersion.versionNo },
          latestDraftRubricVersion ? { label: "Rubric", versionNo: latestDraftRubricVersion.versionNo } : null,
          latestDraftPromptTemplateVersion
            ? { label: "Prompt", versionNo: latestDraftPromptTemplateVersion.versionNo }
            : null,
          latestDraftMcqSetVersion ? { label: "MCQ", versionNo: latestDraftMcqSetVersion.versionNo } : null,
        ].filter(Boolean)
      : [],
    versionsCountsChain: [
      moduleVersions.length > 0 ? { label: "Module", versionNo: moduleVersions.length } : null,
      rubricVersions.length > 0 ? { label: "Rubric", versionNo: rubricVersions.length } : null,
      promptTemplateVersions.length > 0 ? { label: "Prompt", versionNo: promptTemplateVersions.length } : null,
      mcqSetVersions.length > 0 ? { label: "MCQ", versionNo: mcqSetVersions.length } : null,
    ].filter(Boolean),
    publishedAt: liveModuleVersion?.publishedAt ?? null,
    technicalDetails: {
      moduleId: module.id,
      activeVersionId: module.activeVersionId ?? null,
      liveModuleVersionId: liveModuleVersion?.id ?? null,
      latestModuleVersionId: latestModuleVersion?.id ?? null,
      latestDraftModuleVersionId: latestDraftModuleVersion?.id ?? null,
      liveRubricVersionId: liveRubricVersion?.id ?? null,
      livePromptTemplateVersionId: livePromptTemplateVersion?.id ?? null,
      liveMcqSetVersionId: liveMcqSetVersion?.id ?? null,
      latestRubricVersionId: latestRubricVersion?.id ?? null,
      latestPromptTemplateVersionId: latestPromptTemplateVersion?.id ?? null,
      latestMcqSetVersionId: latestMcqSetVersion?.id ?? null,
      exportSource: moduleExport?.selectedConfiguration?.source ?? null,
    },
  };
}
