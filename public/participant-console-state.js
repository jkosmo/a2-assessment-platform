const allowedMockRoles = new Set([
  "PARTICIPANT",
  "APPEAL_HANDLER",
  "ADMINISTRATOR",
  "REVIEWER",
  "REPORT_READER",
  "SUBJECT_MATTER_OWNER",
]);

const allowedAppealStatuses = new Set(["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"]);

export function sanitizeMockRolePresets(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim().toUpperCase();
    if (!allowedMockRoles.has(normalized)) {
      continue;
    }
    unique.add(normalized);
  }
  return Array.from(unique);
}

export function resolveRoleSwitchState(config) {
  const authMode = config?.authMode === "entra" ? "entra" : "mock";
  const presets = sanitizeMockRolePresets(config?.mockRolePresets);
  const requested = config?.mockRoleSwitchEnabled !== false;
  const enabled = authMode === "mock" && requested && presets.length > 0;

  return {
    authMode,
    presets,
    enabled,
  };
}

export function findMatchingPreset(rolesValue, presets) {
  if (typeof rolesValue !== "string" || !Array.isArray(presets)) {
    return "";
  }

  const parts = rolesValue
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (parts.length !== 1) {
    return "";
  }

  return presets.includes(parts[0]) ? parts[0] : "";
}

export function buildModuleCardViewModels(modules, selectedModuleId) {
  if (!Array.isArray(modules)) {
    return [];
  }

  return modules
    .filter(
      (module) =>
        module &&
        typeof module.id === "string" &&
        module.id.trim().length > 0 &&
        typeof module.title === "string" &&
        module.title.trim().length > 0,
    )
    .map((module) => ({
      id: module.id,
      title: module.title,
      selected: module.id === selectedModuleId,
    }));
}

export function resolveSelectedModule(modules, selectedModuleId) {
  const models = buildModuleCardViewModels(modules, selectedModuleId);
  return models.find((module) => module.selected) ?? null;
}

export function parseDraftEnvelope(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return { modules: {} };
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || !parsed.modules || typeof parsed.modules !== "object") {
      return { modules: {} };
    }
    return { modules: parsed.modules };
  } catch {
    return { modules: {} };
  }
}

export function pruneExpiredModuleDrafts(moduleDrafts, ttlMinutes, nowMs = Date.now()) {
  if (!moduleDrafts || typeof moduleDrafts !== "object") {
    return {};
  }

  const ttlMs = Math.max(1, Number(ttlMinutes) || 0) * 60 * 1000;
  const result = {};

  for (const [moduleId, draft] of Object.entries(moduleDrafts)) {
    if (!draft || typeof draft !== "object") {
      continue;
    }
    const updatedAtMs = Date.parse(draft.updatedAt ?? "");
    if (Number.isNaN(updatedAtMs)) {
      continue;
    }
    if (nowMs - updatedAtMs > ttlMs) {
      continue;
    }
    result[moduleId] = draft;
  }

  return result;
}

export function upsertModuleDraft(moduleDrafts, moduleId, draftData, nowMs = Date.now(), maxModules = 30) {
  if (!moduleId) {
    return moduleDrafts ?? {};
  }

  const base = { ...(moduleDrafts ?? {}) };
  base[moduleId] = {
    ...draftData,
    updatedAt: new Date(nowMs).toISOString(),
  };

  const ordered = Object.entries(base)
    .sort((left, right) => {
      const leftTime = Date.parse(left[1]?.updatedAt ?? "");
      const rightTime = Date.parse(right[1]?.updatedAt ?? "");
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })
    .slice(0, Math.max(1, Number(maxModules) || 30));

  return Object.fromEntries(ordered);
}

export function deriveParticipantFlowGateState(flowState) {
  const hasSubmission = flowState?.hasSubmission === true;
  const hasMcqSubmission = flowState?.hasMcqSubmission === true;
  const assessmentQueued = flowState?.assessmentQueued === true;
  const resultStatus = typeof flowState?.resultStatus === "string" ? flowState.resultStatus : null;

  const assessmentUnlocked = hasSubmission && hasMcqSubmission;
  const checkAssessmentUnlocked = assessmentUnlocked && assessmentQueued;
  const appealUnlocked = resultStatus === "COMPLETED";

  let assessmentHintKey = "flow.assessmentReady";
  if (!hasSubmission) {
    assessmentHintKey = "flow.assessmentLockedNeedsSubmission";
  } else if (!hasMcqSubmission) {
    assessmentHintKey = "flow.assessmentLockedNeedsMcq";
  }

  const checkAssessmentHintKey = checkAssessmentUnlocked
    ? "flow.checkAssessmentReady"
    : "flow.checkAssessmentLockedNeedsQueue";

  const appealHintKey = appealUnlocked ? "flow.appealReady" : "flow.appealLockedNeedsCompleted";

  return {
    assessmentUnlocked,
    checkAssessmentUnlocked,
    appealUnlocked,
    assessmentHintKey,
    checkAssessmentHintKey,
    appealHintKey,
  };
}

export function sanitizeAppealStatuses(value, fallback = ["OPEN", "IN_REVIEW"]) {
  if (!Array.isArray(value)) {
    return Array.from(new Set(fallback.filter((status) => allowedAppealStatuses.has(status))));
  }

  const statuses = value
    .map((status) => (typeof status === "string" ? status.trim().toUpperCase() : ""))
    .filter((status) => allowedAppealStatuses.has(status));

  if (statuses.length === 0) {
    return Array.from(new Set(fallback.filter((status) => allowedAppealStatuses.has(status))));
  }

  return Array.from(new Set(statuses));
}
