import { localeLabels, supportedLocales, translations } from "/static/i18n/admin-content-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
const outputDetails = document.getElementById("outputDetails");
const outputStatus = document.getElementById("outputStatus");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const adminContentMessage = document.getElementById("adminContentMessage");

const moduleTitleInput = document.getElementById("moduleTitle");
const moduleDescriptionInput = document.getElementById("moduleDescription");
const moduleCertificationLevelInput = document.getElementById("moduleCertificationLevel");
const moduleValidFromInput = document.getElementById("moduleValidFrom");
const moduleValidToInput = document.getElementById("moduleValidTo");
const createModuleButton = document.getElementById("createModule");
const selectedModuleIdInput = document.getElementById("selectedModuleId");
const loadModulesButton = document.getElementById("loadModules");
const loadModuleContentButton = document.getElementById("loadModuleContent");
const exportModuleButton = document.getElementById("exportModule");
const deleteModuleButton = document.getElementById("deleteModule");
const moduleDropdown = document.getElementById("moduleDropdown");
const selectedModuleMeta = document.getElementById("selectedModuleMeta");
const moduleStatusTitle = document.getElementById("moduleStatusTitle");
const moduleStatusSummary = document.getElementById("moduleStatusSummary");
const moduleStatusBadge = document.getElementById("moduleStatusBadge");
const moduleStatusDescription = document.getElementById("moduleStatusDescription");
const moduleStatusLive = document.getElementById("moduleStatusLive");
const moduleStatusDraft = document.getElementById("moduleStatusDraft");
const moduleStatusPublishedAt = document.getElementById("moduleStatusPublishedAt");
const moduleStatusCounts = document.getElementById("moduleStatusCounts");
const moduleStatusDetails = document.getElementById("moduleStatusDetails");

const importDraftFileInput = document.getElementById("importDraftFile");
const importDraftJsonInput = document.getElementById("importDraftJson");
const applyImportDraftButton = document.getElementById("applyImportDraft");
const copyAuthoringPromptButton = document.getElementById("copyAuthoringPrompt");

const rubricCriteriaJsonInput = document.getElementById("rubricCriteriaJson");
const rubricScalingRuleJsonInput = document.getElementById("rubricScalingRuleJson");
const rubricPassRuleJsonInput = document.getElementById("rubricPassRuleJson");

const promptSystemPromptInput = document.getElementById("promptSystemPrompt");
const promptUserPromptTemplateInput = document.getElementById("promptUserPromptTemplate");
const promptExamplesJsonInput = document.getElementById("promptExamplesJson");

const mcqSetTitleInput = document.getElementById("mcqSetTitle");
const mcqQuestionsJsonInput = document.getElementById("mcqQuestionsJson");

const moduleVersionTaskTextInput = document.getElementById("moduleVersionTaskText");
const moduleVersionGuidanceTextInput = document.getElementById("moduleVersionGuidanceText");
const moduleVersionSubmissionSchemaInput = document.getElementById("moduleVersionSubmissionSchema");
const moduleVersionRubricVersionIdInput = document.getElementById("moduleVersionRubricVersionId");
const moduleVersionPromptTemplateVersionIdInput = document.getElementById("moduleVersionPromptTemplateVersionId");
const moduleVersionMcqSetVersionIdInput = document.getElementById("moduleVersionMcqSetVersionId");
const saveContentBundleButton = document.getElementById("saveContentBundle");
const previewCurrentDraftButton = document.getElementById("previewCurrentDraft");

const publishModuleVersionIdInput = document.getElementById("publishModuleVersionId");
const publishModuleVersionButton = document.getElementById("publishModuleVersion");

const PARTICIPANT_PREVIEW_STORAGE_KEY = "adminContent.participantPreview.v1";
const MODULE_AUTHORING_PROMPT_TEMPLATE = `You are producing a module draft JSON for an assessment platform.

Return one JSON object only.
Preferred output is a downloadable \`.json\` file.
If your interface cannot return a file, return the JSON as the only content in one code cell / code block.
Do not include commentary.
Do not include comments.

Requirements:
- The root object must contain exactly these sections:
  - module
  - rubric
  - promptTemplate
  - mcqSet
  - moduleVersion
- Localized participant-facing text should use the locales:
  - en-GB
  - nb
  - nn
- If multilingual content is required, use locale objects for:
  - module.title
  - module.description
  - promptTemplate.systemPrompt
  - promptTemplate.userPromptTemplate
  - mcqSet.title
  - moduleVersion.taskText
  - moduleVersion.guidanceText
- MCQ question fields may also use locale objects when participant-facing text must be translated.
- Keep systemPrompt and userPromptTemplate concise and production-oriented.
- MCQ questions must include:
  - stem
  - options
  - correctAnswer
  - rationale
- correctAnswer must match one of the options exactly.
- rubric.criteria, rubric.scalingRule, and rubric.passRule must be valid JSON objects.
- moduleVersion.taskText must describe the participant assignment clearly.
- moduleVersion.guidanceText must describe what a good submission should include.
- validFrom and validTo should be empty strings unless a date range is explicitly provided.

Return JSON in this exact shape:
{
  "module": {
    "title": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "description": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "certificationLevel": "",
    "validFrom": "",
    "validTo": ""
  },
  "rubric": {
    "criteria": {},
    "scalingRule": {},
    "passRule": {}
  },
  "promptTemplate": {
    "systemPrompt": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "userPromptTemplate": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "examples": []
  },
  "mcqSet": {
    "title": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "questions": []
  },
  "moduleVersion": {
    "taskText": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "guidanceText": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    }
  }
}

Source material follows:
[PASTE SOURCE MATERIAL HERE]`;

const defaultWorkspaceNavigationItems = [
  {
    id: "participant",
    path: "/participant",
    labelKey: "nav.participant",
    requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"],
  },
  {
    id: "participant-completed",
    path: "/participant/completed",
    labelKey: "nav.completedModules",
    requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"],
  },
  {
    id: "manual-review",
    path: "/manual-review",
    labelKey: "nav.manualReview",
    requiredRoles: ["REVIEWER", "ADMINISTRATOR"],
  },
  {
    id: "appeal-handler",
    path: "/appeal-handler",
    labelKey: "nav.appealHandler",
    requiredRoles: ["APPEAL_HANDLER", "ADMINISTRATOR"],
  },
  {
    id: "calibration",
    path: "/calibration",
    labelKey: "nav.calibration",
    requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
  },
  {
    id: "admin-content",
    path: "/admin-content",
    labelKey: "nav.adminContent",
    requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
  },
];

let currentLocale = resolveInitialLocale();
let modules = [];
let selectedModuleId = "";
let selectedModuleStatus = null;
let editorBaselineSnapshot = null;
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: {
    items: defaultWorkspaceNavigationItems,
  },
  identityDefaults: {
    contentAdmin: {
      userId: "content-owner-1",
      email: "content.owner@company.com",
      name: "Platform Content Owner",
      department: "Learning",
      roles: ["SUBJECT_MATTER_OWNER"],
    },
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);

function resolveInitialLocale() {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) {
    return stored;
  }

  const browser = navigator.language;
  if (!browser) {
    return "en-GB";
  }
  const normalized = browser.toLowerCase();
  if (normalized.startsWith("nb")) {
    return "nb";
  }
  if (normalized.startsWith("nn")) {
    return "nn";
  }
  if (normalized.startsWith("en")) {
    return "en-GB";
  }
  return "en-GB";
}

function t(key) {
  return translations[currentLocale][key] ?? translations["en-GB"][key] ?? key;
}

function setMessage(text) {
  adminContentMessage.textContent = text ?? "";
}

function setLocale(locale) {
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  document.documentElement.lang = currentLocale;
  applyTranslations();
}

function applyTranslations() {
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const key = element.getAttribute("data-i18n");
    if (!key) {
      continue;
    }
    element.textContent = t(key);
  }

  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = element.getAttribute("data-i18n-placeholder");
    if (!key) {
      continue;
    }
    element.placeholder = t(key);
  }

  applyOutputVisibility();
  if (!output.dataset.hasContent) {
    output.textContent = t("defaults.ready");
  }
  if (!outputStatus.dataset.hasContent) {
    outputStatus.textContent = t("defaults.ready");
  }

  renderRolePresetControl();
  renderWorkspaceNavigation();
  renderModuleMeta();
  renderModuleStatus();
}

function isDebugModeEnabled() {
  return participantRuntimeConfig?.debugMode !== false;
}

function applyOutputVisibility() {
  output.hidden = !isDebugModeEnabled();
  outputDetails.hidden = !isDebugModeEnabled();
}

function formatOutputStatus(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim().length > 0) {
      return data.message;
    }
    const preferredKeys = ["moduleVersion", "module", "modules", "promptTemplateVersion", "rubricVersion", "mcqSetVersion"];
    const matchedKey = preferredKeys.find((key) => key in data);
    if (matchedKey) {
      return `Updated: ${matchedKey}`;
    }
  }
  return "Request completed.";
}

function populateLocaleSelect() {
  localeSelect.innerHTML = "";
  for (const locale of supportedLocales) {
    const option = document.createElement("option");
    option.value = locale;
    option.textContent = localeLabels[locale] ?? locale;
    option.selected = locale === currentLocale;
    localeSelect.appendChild(option);
  }
}

function log(data) {
  output.dataset.hasContent = "true";
  outputStatus.dataset.hasContent = "true";
  outputStatus.textContent = formatOutputStatus(data);

  if (!isDebugModeEnabled()) {
    output.textContent = "";
    return;
  }

  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function headers() {
  const roles = rolesInput.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");

  return buildConsoleHeaders({
    userId: document.getElementById("userId").value,
    email: document.getElementById("email").value,
    name: document.getElementById("name").value,
    department: document.getElementById("department").value,
    roles,
    locale: currentLocale,
  });
}

async function runWithBusyButton(button, action) {
  if (!button || button.dataset.busy === "true") {
    return;
  }

  const wasDisabled = button.disabled;
  button.dataset.busy = "true";
  button.disabled = true;
  button.classList.add("button-busy");
  button.setAttribute("aria-busy", "true");

  try {
    await action();
  } finally {
    button.dataset.busy = "";
    button.classList.remove("button-busy");
    button.removeAttribute("aria-busy");
    button.disabled = wasDisabled;
  }
}

function parseActionableErrorMessage(error) {
  if (!(error instanceof Error)) {
    return "Unexpected error.";
  }

  const raw = error.message ?? "";
  const splitIndex = raw.indexOf(":");
  if (splitIndex === -1) {
    return raw;
  }

  const payloadText = raw.slice(splitIndex + 1).trim();
  try {
    const payload = JSON.parse(payloadText);
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
    if (Array.isArray(payload.issues) && payload.issues.length > 0) {
      return payload.issues.map((issue) => issue.message).join("; ");
    }
  } catch {
    return raw;
  }

  return raw;
}

function parseJsonField(value, fieldLabelKey) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid_json";
    throw new Error(`${t("adminContent.errors.invalidJsonPrefix")} ${t(fieldLabelKey)}: ${detail}`);
  }
}

function parseLocalizedTextField(value, fieldLabelKey, options = { required: true }) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    if (options.required) {
      throw new Error(`${t("adminContent.errors.valueRequiredPrefix")} ${t(fieldLabelKey)}`);
    }
    return undefined;
  }

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return trimmed;
  }

  const parsed = parseJsonField(trimmed, fieldLabelKey);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return trimmed;
  }

  const localeKeys = ["en-GB", "nb", "nn"];
  const isLocaleObject = localeKeys.every((key) => typeof parsed[key] === "string" && parsed[key].trim().length > 0);
  return isLocaleObject ? parsed : trimmed;
}

function parseLocalizedPreviewField(value, fieldLabelKey, options = { required: false }) {
  const parsed = parseLocalizedTextField(value, fieldLabelKey, options);
  return parsed ?? "";
}

function isLocalizedContentObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localizeContentValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (!isLocalizedContentObject(value)) {
    return "";
  }

  const localized =
    value[currentLocale] ??
    value["en-GB"] ??
    Object.values(value).find((entry) => typeof entry === "string" && entry.trim().length > 0);

  return typeof localized === "string" ? localized : "";
}

function formatJsonDefault(key) {
  const raw = t(key);
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatEditorValue(value, fallback = "") {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatDateInputValue(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function formatDateTimeValue(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(currentLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function syncTextareaHeight(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  if (textarea.id === "importDraftJson") {
    textarea.style.height = "";
    return;
  }

  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function syncAllTextareaHeights() {
  for (const textarea of document.querySelectorAll("textarea")) {
    syncTextareaHeight(textarea);
  }
}

function normalizeSnapshotValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getEditorSnapshot() {
  return {
    moduleTitle: normalizeSnapshotValue(moduleTitleInput.value),
    moduleDescription: normalizeSnapshotValue(moduleDescriptionInput.value),
    moduleCertificationLevel: normalizeSnapshotValue(moduleCertificationLevelInput.value),
    moduleValidFrom: normalizeSnapshotValue(moduleValidFromInput.value),
    moduleValidTo: normalizeSnapshotValue(moduleValidToInput.value),
    rubricCriteriaJson: normalizeSnapshotValue(rubricCriteriaJsonInput.value),
    rubricScalingRuleJson: normalizeSnapshotValue(rubricScalingRuleJsonInput.value),
    rubricPassRuleJson: normalizeSnapshotValue(rubricPassRuleJsonInput.value),
    promptSystemPrompt: normalizeSnapshotValue(promptSystemPromptInput.value),
    promptUserPromptTemplate: normalizeSnapshotValue(promptUserPromptTemplateInput.value),
    promptExamplesJson: normalizeSnapshotValue(promptExamplesJsonInput.value),
    mcqSetTitle: normalizeSnapshotValue(mcqSetTitleInput.value),
    mcqQuestionsJson: normalizeSnapshotValue(mcqQuestionsJsonInput.value),
    moduleVersionTaskText: normalizeSnapshotValue(moduleVersionTaskTextInput.value),
    moduleVersionGuidanceText: normalizeSnapshotValue(moduleVersionGuidanceTextInput.value),
    moduleVersionSubmissionSchema: normalizeSnapshotValue(moduleVersionSubmissionSchemaInput.value),
    moduleVersionRubricVersionId: normalizeSnapshotValue(moduleVersionRubricVersionIdInput.value),
    moduleVersionPromptTemplateVersionId: normalizeSnapshotValue(moduleVersionPromptTemplateVersionIdInput.value),
    moduleVersionMcqSetVersionId: normalizeSnapshotValue(moduleVersionMcqSetVersionIdInput.value),
    publishModuleVersionId: normalizeSnapshotValue(publishModuleVersionIdInput.value),
  };
}

function buildEditorSnapshotFromDraft(draft) {
  return {
    moduleTitle: normalizeSnapshotValue(formatEditorValue(draft?.module?.title, "")),
    moduleDescription: normalizeSnapshotValue(formatEditorValue(draft?.module?.description, "")),
    moduleCertificationLevel: normalizeSnapshotValue(formatEditorValue(draft?.module?.certificationLevel, "")),
    moduleValidFrom: normalizeSnapshotValue(typeof draft?.module?.validFrom === "string" ? draft.module.validFrom : ""),
    moduleValidTo: normalizeSnapshotValue(typeof draft?.module?.validTo === "string" ? draft.module.validTo : ""),
    rubricCriteriaJson: normalizeSnapshotValue(formatEditorValue(draft?.rubric?.criteria, "")),
    rubricScalingRuleJson: normalizeSnapshotValue(formatEditorValue(draft?.rubric?.scalingRule, "")),
    rubricPassRuleJson: normalizeSnapshotValue(formatEditorValue(draft?.rubric?.passRule, "")),
    promptSystemPrompt: normalizeSnapshotValue(formatEditorValue(draft?.promptTemplate?.systemPrompt, "")),
    promptUserPromptTemplate: normalizeSnapshotValue(
      formatEditorValue(draft?.promptTemplate?.userPromptTemplate, ""),
    ),
    promptExamplesJson: normalizeSnapshotValue(formatEditorValue(draft?.promptTemplate?.examples, "")),
    mcqSetTitle: normalizeSnapshotValue(formatEditorValue(draft?.mcqSet?.title, "")),
    mcqQuestionsJson: normalizeSnapshotValue(formatEditorValue(draft?.mcqSet?.questions, "")),
    moduleVersionTaskText: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.taskText, "")),
    moduleVersionGuidanceText: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.guidanceText, "")),
    moduleVersionSubmissionSchema: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.submissionSchema, "")),
    moduleVersionRubricVersionId: "",
    moduleVersionPromptTemplateVersionId: "",
    moduleVersionMcqSetVersionId: "",
    publishModuleVersionId: "",
  };
}

function snapshotsEqual(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  for (const key of keys) {
    if ((left?.[key] ?? "") !== (right?.[key] ?? "")) {
      return false;
    }
  }
  return true;
}

function shouldConfirmImportOverwrite(draft) {
  const currentSnapshot = getEditorSnapshot();
  const importedSnapshot = buildEditorSnapshotFromDraft(draft);
  const baselineSnapshot = editorBaselineSnapshot ?? {};

  if (snapshotsEqual(currentSnapshot, importedSnapshot)) {
    return false;
  }

  return !snapshotsEqual(currentSnapshot, baselineSnapshot);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clearNode(node) {
  if (node) {
    node.textContent = "";
  }
}

function renderStatusChain(element, versions) {
  clearNode(element);
  if (!element) {
    return;
  }

  if (!Array.isArray(versions) || versions.length === 0) {
    element.textContent = "-";
    return;
  }

  element.classList.add("status-chain");

  versions.forEach((version, index) => {
    const badge = document.createElement("span");
    badge.className = "version-badge";
    badge.textContent = `${version.label} v${version.versionNo}`;
    element.appendChild(badge);

    if (index < versions.length - 1) {
      const separator = document.createElement("span");
      separator.className = "status-separator";
      separator.textContent = ">";
      element.appendChild(separator);
    }
  });
}

function findLinkedVersion(versions, id) {
  if (!Array.isArray(versions) || !id) {
    return null;
  }

  return versions.find((version) => version.id === id) ?? null;
}

function deriveModuleStatusView(moduleExport) {
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

  const technicalDetails = {
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
  };

  return {
    title: localizeContentValue(module.title),
    description: localizeContentValue(module.description),
    certificationLevel: localizeContentValue(module.certificationLevel),
    validFrom: module.validFrom,
    validTo: module.validTo,
    badgeKey,
    badgeClass,
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
        latestDraftPromptTemplateVersion ? { label: "Prompt", versionNo: latestDraftPromptTemplateVersion.versionNo } : null,
        latestDraftMcqSetVersion ? { label: "MCQ", versionNo: latestDraftMcqSetVersion.versionNo } : null,
      ].filter(Boolean)
      : [],
    publishedAt: liveModuleVersion?.publishedAt ?? null,
    countsText: `Module ${moduleVersions.length}, Rubric ${rubricVersions.length}, Prompt ${promptTemplateVersions.length}, MCQ ${mcqSetVersions.length}`,
    technicalDetails,
  };
}

function coerceModuleExportToImportDraft(payload) {
  const selectedConfiguration = payload?.selectedConfiguration ?? {};

  return {
    module: {
      title: payload?.module?.title,
      description: payload?.module?.description,
      certificationLevel: payload?.module?.certificationLevel,
      validFrom: formatDateInputValue(payload?.module?.validFrom),
      validTo: formatDateInputValue(payload?.module?.validTo),
    },
    rubric: {
      criteria: selectedConfiguration?.rubricVersion?.criteria ?? {},
      scalingRule: selectedConfiguration?.rubricVersion?.scalingRule ?? {},
      passRule: selectedConfiguration?.rubricVersion?.passRule ?? {},
    },
    promptTemplate: {
      systemPrompt: selectedConfiguration?.promptTemplateVersion?.systemPrompt ?? "",
      userPromptTemplate: selectedConfiguration?.promptTemplateVersion?.userPromptTemplate ?? "",
      examples: selectedConfiguration?.promptTemplateVersion?.examples ?? [],
    },
    mcqSet: {
      title: selectedConfiguration?.mcqSetVersion?.title ?? "",
      questions: selectedConfiguration?.mcqSetVersion?.questions ?? [],
    },
    moduleVersion: {
      taskText: selectedConfiguration?.moduleVersion?.taskText ?? "",
      guidanceText: selectedConfiguration?.moduleVersion?.guidanceText ?? "",
    },
  };
}

function normalizeImportDraftPayload(payload) {
  const unwrappedPayload = isPlainObject(payload?.moduleExport) ? payload.moduleExport : payload;

  if (!isPlainObject(unwrappedPayload)) {
    throw new Error(t("adminContent.errors.importRootObject"));
  }

  const draft =
    isPlainObject(unwrappedPayload.module) &&
    isPlainObject(unwrappedPayload.rubric) &&
    isPlainObject(unwrappedPayload.promptTemplate) &&
    isPlainObject(unwrappedPayload.mcqSet) &&
    isPlainObject(unwrappedPayload.moduleVersion)
      ? unwrappedPayload
      : isPlainObject(unwrappedPayload.module) &&
          isPlainObject(unwrappedPayload.selectedConfiguration) &&
          isPlainObject(unwrappedPayload.versions)
        ? coerceModuleExportToImportDraft(unwrappedPayload)
        : null;

  if (!draft) {
    throw new Error(t("adminContent.errors.importShape"));
  }

  if (!draft.module.title) {
    throw new Error(t("adminContent.errors.importMissingModuleTitle"));
  }
  if (!isPlainObject(draft.rubric.criteria)) {
    throw new Error(t("adminContent.errors.importMissingRubric"));
  }
  if (!draft.promptTemplate.systemPrompt || !draft.promptTemplate.userPromptTemplate) {
    throw new Error(t("adminContent.errors.importMissingPrompt"));
  }
  if (!draft.mcqSet.title || !Array.isArray(draft.mcqSet.questions) || draft.mcqSet.questions.length === 0) {
    throw new Error(t("adminContent.errors.importMissingMcq"));
  }
  if (!draft.moduleVersion.taskText) {
    throw new Error(t("adminContent.errors.importMissingTaskText"));
  }

  return draft;
}

function applyImportDraftToForm(draft) {
  moduleTitleInput.value = formatEditorValue(draft?.module?.title, "");
  moduleDescriptionInput.value = formatEditorValue(draft?.module?.description, "");
  moduleCertificationLevelInput.value = formatEditorValue(draft?.module?.certificationLevel, "");
  moduleValidFromInput.value = typeof draft?.module?.validFrom === "string" ? draft.module.validFrom : "";
  moduleValidToInput.value = typeof draft?.module?.validTo === "string" ? draft.module.validTo : "";

  rubricCriteriaJsonInput.value = formatEditorValue(draft?.rubric?.criteria, "");
  rubricScalingRuleJsonInput.value = formatEditorValue(draft?.rubric?.scalingRule, "");
  rubricPassRuleJsonInput.value = formatEditorValue(draft?.rubric?.passRule, "");

  promptSystemPromptInput.value = formatEditorValue(draft?.promptTemplate?.systemPrompt, "");
  promptUserPromptTemplateInput.value = formatEditorValue(draft?.promptTemplate?.userPromptTemplate, "");
  promptExamplesJsonInput.value = formatEditorValue(draft?.promptTemplate?.examples, "[]");

  mcqSetTitleInput.value = formatEditorValue(draft?.mcqSet?.title, "");
  mcqQuestionsJsonInput.value = formatEditorValue(draft?.mcqSet?.questions, "[]");

  moduleVersionTaskTextInput.value = formatEditorValue(draft?.moduleVersion?.taskText, "");
  moduleVersionGuidanceTextInput.value = formatEditorValue(draft?.moduleVersion?.guidanceText, "");
  moduleVersionSubmissionSchemaInput.value = formatEditorValue(draft?.moduleVersion?.submissionSchema, "");

  moduleVersionRubricVersionIdInput.value = "";
  moduleVersionPromptTemplateVersionIdInput.value = "";
  moduleVersionMcqSetVersionIdInput.value = "";
  publishModuleVersionIdInput.value = "";
  syncAllTextareaHeights();
}

function populateFormFromModuleExport(moduleExport) {
  const selectedConfiguration = moduleExport?.selectedConfiguration ?? {};
  const moduleVersion = selectedConfiguration.moduleVersion ?? null;
  const rubricVersion = selectedConfiguration.rubricVersion ?? null;
  const promptTemplateVersion = selectedConfiguration.promptTemplateVersion ?? null;
  const mcqSetVersion = selectedConfiguration.mcqSetVersion ?? null;

  rubricCriteriaJsonInput.value = formatEditorValue(rubricVersion?.criteria, "");
  rubricScalingRuleJsonInput.value = formatEditorValue(rubricVersion?.scalingRule, "");
  rubricPassRuleJsonInput.value = formatEditorValue(rubricVersion?.passRule, "");

  promptSystemPromptInput.value = formatEditorValue(promptTemplateVersion?.systemPrompt, "");
  promptUserPromptTemplateInput.value = formatEditorValue(promptTemplateVersion?.userPromptTemplate, "");
  promptExamplesJsonInput.value = formatEditorValue(promptTemplateVersion?.examples, "[]");

  mcqSetTitleInput.value = formatEditorValue(mcqSetVersion?.title, "");
  mcqQuestionsJsonInput.value = formatEditorValue(mcqSetVersion?.questions, "[]");

  moduleVersionTaskTextInput.value = formatEditorValue(moduleVersion?.taskText, "");
  moduleVersionGuidanceTextInput.value = formatEditorValue(moduleVersion?.guidanceText, "");
  moduleVersionSubmissionSchemaInput.value = formatEditorValue(moduleVersion?.submissionSchema, "");
  moduleVersionRubricVersionIdInput.value = rubricVersion?.id ?? "";
  moduleVersionPromptTemplateVersionIdInput.value = promptTemplateVersion?.id ?? "";
  moduleVersionMcqSetVersionIdInput.value = mcqSetVersion?.id ?? "";
  publishModuleVersionIdInput.value = moduleVersion?.id ?? "";

  selectedModuleStatus = moduleExport;
  renderModuleStatus();
  syncAllTextareaHeights();
}

function buildParticipantPreviewPayload() {
  const moduleTitle = parseLocalizedPreviewField(moduleTitleInput.value, "adminContent.module.name");
  const taskText = parseLocalizedPreviewField(moduleVersionTaskTextInput.value, "adminContent.moduleVersion.taskText");
  const questions = parseJsonField(mcqQuestionsJsonInput.value || "[]", "adminContent.mcq.questionsJson");

  if (!moduleTitle) {
    throw new Error(`${t("adminContent.errors.valueRequiredPrefix")} ${t("adminContent.module.name")}`);
  }

  if (!taskText) {
    throw new Error(`${t("adminContent.errors.valueRequiredPrefix")} ${t("adminContent.moduleVersion.taskText")}`);
  }

  if (!Array.isArray(questions)) {
    throw new Error(t("adminContent.errors.previewQuestionArray"));
  }

  return {
    createdAt: new Date().toISOString(),
    source: "admin-content-draft",
    module: {
      id: selectedModuleIdInput.value.trim() || `draft-preview-${Date.now()}`,
      title: moduleTitle,
      description: parseLocalizedPreviewField(moduleDescriptionInput.value, "adminContent.module.description"),
      taskText,
      guidanceText: parseLocalizedPreviewField(
        moduleVersionGuidanceTextInput.value,
        "adminContent.moduleVersion.guidanceText",
      ),
      submissionSchema: moduleVersionSubmissionSchemaInput.value.trim()
        ? parseJsonField(moduleVersionSubmissionSchemaInput.value.trim(), "adminContent.moduleVersion.submissionSchemaJson")
        : null,
      questions,
    },
  };
}

async function fetchModuleExport() {
  const moduleId = resolveModuleIdOrThrow();
  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, headers);
  return body?.moduleExport ?? null;
}

async function refreshSelectedModuleStatus() {
  if (!selectedModuleId) {
    selectedModuleStatus = null;
    renderModuleStatus();
    return null;
  }

  const moduleExport = await fetchModuleExport();
  selectedModuleStatus = moduleExport;
  renderModuleStatus();
  return moduleExport;
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "true");
  fallback.style.position = "absolute";
  fallback.style.left = "-9999px";
  document.body.appendChild(fallback);
  fallback.select();
  document.execCommand("copy");
  document.body.removeChild(fallback);
}

async function readImportFileContents() {
  const file = importDraftFileInput.files?.[0];
  if (!file) {
    throw new Error(t("adminContent.errors.importFileRequired"));
  }

  return file.text();
}

function renderRolePresetControl() {
  mockRolePresetSelect.innerHTML = "";

  const manualOption = document.createElement("option");
  manualOption.value = "";
  manualOption.textContent = t("identity.rolePresetManual");
  mockRolePresetSelect.appendChild(manualOption);

  for (const role of roleSwitchState.presets) {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    mockRolePresetSelect.appendChild(option);
  }

  const matchingPreset = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matchingPreset;

  const disabled = !roleSwitchState.enabled;
  mockRolePresetSelect.disabled = disabled;
  mockRolePresetHint.textContent = disabled
    ? t("identity.rolePresetDisabledEntra")
    : t("identity.rolePresetHint");
  mockRolePresetContainer.hidden = roleSwitchState.presets.length === 0;
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) {
    return;
  }

  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    rolesInput.value,
    window.location.pathname,
    defaultWorkspaceNavigationItems,
  ).filter((item) => item.visible);

  workspaceNav.innerHTML = "";
  workspaceNav.hidden = items.length === 0;
  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    const link = document.createElement("a");
    link.href = item.path;
    link.className = item.active ? "workspace-nav-link active" : "workspace-nav-link";
    link.textContent = t(item.labelKey);
    if (item.active) {
      link.setAttribute("aria-current", "page");
    }
    workspaceNav.appendChild(link);
  }
}

function applyIdentityDefaults() {
  const identityDefaults = participantRuntimeConfig?.identityDefaults?.contentAdmin;
  if (!identityDefaults) {
    return;
  }

  document.getElementById("userId").value = identityDefaults.userId ?? "";
  document.getElementById("email").value = identityDefaults.email ?? "";
  document.getElementById("name").value = identityDefaults.name ?? "";
  document.getElementById("department").value = identityDefaults.department ?? "";
  rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
}

function setDefaultFormValues() {
  rubricCriteriaJsonInput.value = formatJsonDefault("adminContent.defaults.criteriaJson");
  rubricScalingRuleJsonInput.value = formatJsonDefault("adminContent.defaults.scalingRuleJson");
  rubricPassRuleJsonInput.value = formatJsonDefault("adminContent.defaults.passRuleJson");
  promptSystemPromptInput.value = t("adminContent.defaults.systemPrompt");
  promptUserPromptTemplateInput.value = t("adminContent.defaults.userPromptTemplate");
  promptExamplesJsonInput.value = formatJsonDefault("adminContent.defaults.examplesJson");
  mcqQuestionsJsonInput.value = formatJsonDefault("adminContent.defaults.questionsJson");
  moduleVersionTaskTextInput.value = t("adminContent.defaults.taskText");
  moduleVersionGuidanceTextInput.value = t("adminContent.defaults.guidanceText");
  moduleVersionSubmissionSchemaInput.value = "";
  syncAllTextareaHeights();
  editorBaselineSnapshot = getEditorSnapshot();
}

function normalizeModuleSummary(module) {
  if (!module || typeof module !== "object") {
    return null;
  }
  if (typeof module.id !== "string") {
    return null;
  }

  const title = localizeContentValue(module.title);
  if (!title) {
    return null;
  }

  return {
    id: module.id,
    title,
    description: localizeContentValue(module.description),
    taskText: typeof module.taskText === "string" ? module.taskText : "",
    guidanceText: typeof module.guidanceText === "string" ? module.guidanceText : "",
    activeVersionId: typeof module.activeVersion?.id === "string" ? module.activeVersion.id : "",
    activeVersionNo: Number.isFinite(module.activeVersion?.versionNo) ? module.activeVersion.versionNo : null,
  };
}

function renderModuleDropdown() {
  moduleDropdown.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-";
  emptyOption.selected = !selectedModuleId;
  moduleDropdown.appendChild(emptyOption);

  for (const module of modules) {
    const option = document.createElement("option");
    option.value = module.id;
    option.textContent = `${module.title} (${module.id})`;
    option.selected = module.id === selectedModuleId;
    moduleDropdown.appendChild(option);
  }
}

function renderModuleMeta() {
  const module = modules.find((item) => item.id === selectedModuleId) ?? null;
  if (module) {
    selectedModuleMeta.textContent = `${t("adminContent.meta.selectedModulePrefix")}: ${module.title} (${module.id})`;
    return;
  }

  if (selectedModuleId) {
    selectedModuleMeta.textContent = `${t("adminContent.meta.selectedModulePrefix")}: ${selectedModuleId}`;
    return;
  }

  selectedModuleMeta.textContent = `${t("adminContent.meta.selectedModulePrefix")}: ${t("adminContent.meta.noneSelected")}`;
}

function renderModuleStatus() {
  if (!selectedModuleStatus?.module) {
    const module = modules.find((item) => item.id === selectedModuleId) ?? null;

    moduleStatusTitle.textContent = module?.title ?? t("adminContent.status.noneTitle");
    moduleStatusSummary.textContent = module
      ? t("adminContent.status.loadingSummary")
      : t("adminContent.status.noneSummary");
    moduleStatusBadge.textContent = module
      ? t("adminContent.status.badge.loading")
      : t("adminContent.status.badge.none");
    moduleStatusBadge.className = "module-status-badge shell";
    moduleStatusDescription.textContent = module?.description ?? "";
    moduleStatusLive.textContent = t("adminContent.status.noPublishedVersion");
    moduleStatusDraft.textContent = t("adminContent.status.noDraftVersion");
    moduleStatusPublishedAt.textContent = "-";
    moduleStatusCounts.textContent = module?.activeVersionNo ? `Module ${module.activeVersionNo}` : "-";
    moduleStatusDetails.textContent = module
      ? JSON.stringify({ moduleId: module.id, activeVersionNo: module.activeVersionNo }, null, 2)
      : "-";
    return;
  }

  const view = deriveModuleStatusView(selectedModuleStatus);
  if (!view) {
    return;
  }

  moduleStatusTitle.textContent = view.title ?? t("adminContent.status.noneTitle");
  moduleStatusSummary.textContent = t(view.summaryKey);
  moduleStatusBadge.textContent = t(view.badgeKey);
  moduleStatusBadge.className = `module-status-badge ${view.badgeClass}`;

  const descriptionParts = [
    typeof view.description === "string" && view.description.trim().length > 0 ? view.description.trim() : null,
    typeof view.certificationLevel === "string" && view.certificationLevel.trim().length > 0
      ? `${t("adminContent.status.levelPrefix")}: ${view.certificationLevel.trim()}`
      : null,
    view.validFrom || view.validTo
      ? `${t("adminContent.status.validityPrefix")}: ${formatDateInputValue(view.validFrom) || "-"} -> ${formatDateInputValue(view.validTo) || "-"}`
      : null,
  ].filter(Boolean);
  moduleStatusDescription.textContent = descriptionParts.join(" | ");

  if (view.liveChain.length > 0) {
    renderStatusChain(moduleStatusLive, view.liveChain);
  } else {
    moduleStatusLive.textContent = t("adminContent.status.noPublishedVersion");
  }

  if (view.latestDraftChain.length > 0) {
    renderStatusChain(moduleStatusDraft, view.latestDraftChain);
  } else {
    moduleStatusDraft.textContent = t("adminContent.status.noDraftVersion");
  }

  moduleStatusPublishedAt.textContent = formatDateTimeValue(view.publishedAt);
  moduleStatusCounts.textContent = view.countsText;
  moduleStatusDetails.textContent = JSON.stringify(view.technicalDetails, null, 2);
}

function clearVersionFields() {
  rubricCriteriaJsonInput.value = "";
  rubricScalingRuleJsonInput.value = "";
  rubricPassRuleJsonInput.value = "";
  promptSystemPromptInput.value = "";
  promptUserPromptTemplateInput.value = "";
  promptExamplesJsonInput.value = "";
  mcqSetTitleInput.value = "";
  mcqQuestionsJsonInput.value = "";
  moduleVersionTaskTextInput.value = "";
  moduleVersionGuidanceTextInput.value = "";
  moduleVersionSubmissionSchemaInput.value = "";
  moduleVersionRubricVersionIdInput.value = "";
  moduleVersionPromptTemplateVersionIdInput.value = "";
  moduleVersionMcqSetVersionIdInput.value = "";
  publishModuleVersionIdInput.value = "";
  syncAllTextareaHeights();
}

function setSelectedModule(nextModuleId, syncInput = true) {
  const nextId = typeof nextModuleId === "string" ? nextModuleId.trim() : "";
  const moduleChanged = nextId !== selectedModuleId;
  selectedModuleId = nextId;
  if (syncInput) {
    selectedModuleIdInput.value = selectedModuleId;
  }
  selectedModuleStatus = null;
  if (moduleChanged) {
    clearVersionFields();
  }
  renderModuleDropdown();
  renderModuleMeta();
  renderModuleStatus();
}

function resolveModuleIdOrThrow() {
  const moduleId = selectedModuleIdInput.value.trim();
  if (!moduleId) {
    throw new Error(t("adminContent.errors.moduleIdRequired"));
  }
  selectedModuleId = moduleId;
  renderModuleDropdown();
  renderModuleMeta();
  return moduleId;
}

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Content Setup Workspace v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
  }
}

async function loadParticipantConsoleConfig() {
  try {
    const body = await getConsoleConfig();
    participantRuntimeConfig = {
      ...participantRuntimeConfig,
      ...body,
      navigation: {
        ...participantRuntimeConfig.navigation,
        ...(body?.navigation ?? {}),
      },
      identityDefaults: {
        ...participantRuntimeConfig.identityDefaults,
        ...(body?.identityDefaults ?? {}),
      },
    };
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  }

  document.body.classList.toggle("auth-entra", roleSwitchState.authMode === "entra");
  applyOutputVisibility();
  applyIdentityDefaults();
  renderRolePresetControl();
  renderWorkspaceNavigation();
}

async function loadModules(options = {}) {
  const preferredModuleId =
    typeof options.preferredModuleId === "string" ? options.preferredModuleId.trim() : selectedModuleId;
  const preserveMessage = options.preserveMessage === true;
  const logResponse = options.logResponse !== false;
  const body = await apiFetch("/api/admin/content/modules", headers);
  modules = Array.isArray(body.modules)
    ? body.modules
      .map((module) => normalizeModuleSummary(module))
      .filter(Boolean)
    : [];

  if (preferredModuleId && modules.some((module) => module.id === preferredModuleId)) {
    setSelectedModule(preferredModuleId);
  } else if (!preferredModuleId && modules.length > 0) {
    setSelectedModule(modules[0].id);
  } else {
    setSelectedModule("");
  }

  if (!preserveMessage) {
    setMessage(`${t("adminContent.meta.loadedCountPrefix")}: ${modules.length}`);
  }
  if (selectedModuleId) {
    try {
      await refreshSelectedModuleStatus();
    } catch {
      selectedModuleStatus = null;
      renderModuleStatus();
    }
  } else {
    renderModuleStatus();
  }
  if (logResponse) {
    log(body);
  }

  return body;
}

async function handleCreateModule(options = { silent: false }) {
  const payload = {
    title: parseLocalizedTextField(moduleTitleInput.value, "adminContent.module.name"),
    description: parseLocalizedTextField(moduleDescriptionInput.value, "adminContent.module.description", {
      required: false,
    }),
    certificationLevel: parseLocalizedTextField(
      moduleCertificationLevelInput.value,
      "adminContent.module.certificationLevel",
      { required: false },
    ),
    validFrom: moduleValidFromInput.value || undefined,
    validTo: moduleValidToInput.value || undefined,
  };

  const body = await apiFetch("/api/admin/content/modules", headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const createdModuleId = typeof body?.module?.id === "string" ? body.module.id : "";
  await loadModules({
    preferredModuleId: createdModuleId,
    preserveMessage: true,
    logResponse: false,
  });

  if (!options.silent) {
    setMessage(t("adminContent.message.moduleCreated"));
    log(body);
  }
  await refreshSelectedModuleStatus();
  return body;
}

async function handleDeleteSelectedModule() {
  if (!selectedModuleId) {
    throw new Error(t("adminContent.errors.moduleIdRequired"));
  }

  const module = modules.find((item) => item.id === selectedModuleId) ?? null;
  const moduleLabel = module?.title ?? selectedModuleId;
  const confirmed = window.confirm(
    t("adminContent.confirm.deleteModule").replace("{module}", moduleLabel),
  );
  if (!confirmed) {
    return;
  }

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(selectedModuleId)}`, headers, {
    method: "DELETE",
  });

  modules = modules.filter((item) => item.id !== selectedModuleId);
  const nextModuleId = modules[0]?.id ?? "";
  setSelectedModule(nextModuleId);
  setMessage(t("adminContent.message.moduleDeleted"));
  log(body);
  if (selectedModuleId) {
    await refreshSelectedModuleStatus();
  } else {
    renderModuleStatus();
  }
}

async function handleLoadSelectedModuleContent() {
  const moduleExport = await refreshSelectedModuleStatus();
  if (!moduleExport) {
    throw new Error("Module export payload was empty.");
  }

  populateFormFromModuleExport(moduleExport);
  setMessage(
    `${t("adminContent.message.moduleContentLoaded")} (${moduleExport.selectedConfiguration?.source ?? "unknown"})`,
  );
  log({ moduleExport });
}

async function handleExportSelectedModule() {
  const moduleExport = await refreshSelectedModuleStatus();
  if (!moduleExport) {
    throw new Error("Module export payload was empty.");
  }

  const filename = `module-${selectedModuleId || moduleExport.module?.id || "export"}.json`;
  downloadJsonFile(filename, moduleExport);
  setMessage(t("adminContent.message.moduleExported"));
  log({ moduleExport });
}

async function handleCreateRubricVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const payload = {
    criteria: parseJsonField(rubricCriteriaJsonInput.value, "adminContent.rubric.criteria"),
    scalingRule: parseJsonField(rubricScalingRuleJsonInput.value, "adminContent.rubric.scalingRule"),
    passRule: parseJsonField(rubricPassRuleJsonInput.value, "adminContent.rubric.passRule"),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/rubric-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  moduleVersionRubricVersionIdInput.value = body?.rubricVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.rubricCreated"));
    log(body);
  }
  if (!options.silent) {
    await refreshSelectedModuleStatus();
  }
  return body;
}

async function handleCreatePromptTemplateVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const payload = {
    systemPrompt: parseLocalizedTextField(promptSystemPromptInput.value, "adminContent.prompt.systemPrompt"),
    userPromptTemplate: parseLocalizedTextField(
      promptUserPromptTemplateInput.value,
      "adminContent.prompt.userPromptTemplate",
    ),
    examples: parseJsonField(promptExamplesJsonInput.value, "adminContent.prompt.examplesJson"),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/prompt-template-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  moduleVersionPromptTemplateVersionIdInput.value = body?.promptTemplateVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.promptCreated"));
    log(body);
  }
  if (!options.silent) {
    await refreshSelectedModuleStatus();
  }
  return body;
}

async function handleCreateMcqSetVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const payload = {
    title: parseLocalizedTextField(mcqSetTitleInput.value, "adminContent.mcq.setTitle"),
    questions: parseJsonField(mcqQuestionsJsonInput.value, "adminContent.mcq.questionsJson"),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/mcq-set-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  moduleVersionMcqSetVersionIdInput.value = body?.mcqSetVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.mcqCreated"));
    log(body);
  }
  if (!options.silent) {
    await refreshSelectedModuleStatus();
  }
  return body;
}

async function handleCreateModuleVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const rawSubmissionSchema = moduleVersionSubmissionSchemaInput.value.trim();
  let submissionSchema;
  if (rawSubmissionSchema) {
    submissionSchema = parseJsonField(rawSubmissionSchema, "adminContent.moduleVersion.submissionSchemaJson");
  }
  const payload = {
    taskText: parseLocalizedTextField(moduleVersionTaskTextInput.value, "adminContent.moduleVersion.taskText"),
    guidanceText: parseLocalizedTextField(
      moduleVersionGuidanceTextInput.value,
      "adminContent.moduleVersion.guidanceText",
      { required: false },
    ),
    rubricVersionId: moduleVersionRubricVersionIdInput.value.trim(),
    promptTemplateVersionId: moduleVersionPromptTemplateVersionIdInput.value.trim(),
    mcqSetVersionId: moduleVersionMcqSetVersionIdInput.value.trim(),
    ...(submissionSchema !== undefined && { submissionSchema }),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  publishModuleVersionIdInput.value = body?.moduleVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.moduleVersionCreated"));
    log(body);
  }
  if (!options.silent) {
    await refreshSelectedModuleStatus();
  }
  return body;
}

async function handleSaveContentBundle() {
  const rubricBody = await handleCreateRubricVersion({ silent: true });
  const promptBody = await handleCreatePromptTemplateVersion({ silent: true });
  const mcqBody = await handleCreateMcqSetVersion({ silent: true });
  const moduleVersionBody = await handleCreateModuleVersion({ silent: true });

  setMessage(t("adminContent.message.bundleSaved"));
  log({
    rubricVersion: rubricBody.rubricVersion,
    promptTemplateVersion: promptBody.promptTemplateVersion,
    mcqSetVersion: mcqBody.mcqSetVersion,
    moduleVersion: moduleVersionBody.moduleVersion,
  });
  await refreshSelectedModuleStatus();
}

async function handlePublishModuleVersion() {
  const moduleId = resolveModuleIdOrThrow();
  const moduleVersionId = publishModuleVersionIdInput.value.trim();
  if (!moduleVersionId) {
    throw new Error(t("adminContent.errors.moduleVersionIdRequired"));
  }

  const body = await apiFetch(
    `/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions/${encodeURIComponent(moduleVersionId)}/publish`,
    headers,
    { method: "POST", body: JSON.stringify({}) },
  );
  setMessage(t("adminContent.message.moduleVersionPublished"));
  log(body);
  await refreshSelectedModuleStatus();
}

async function handleApplyImportDraft(rawValue) {
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid_json";
    throw new Error(`${t("adminContent.errors.invalidJsonPrefix")} ${t("adminContent.import.json")}: ${detail}`);
  }

  const draft = normalizeImportDraftPayload(parsed);
  if (shouldConfirmImportOverwrite(draft)) {
    const confirmed = window.confirm(t("adminContent.confirm.importOverwrite"));
    if (!confirmed) {
      setMessage(t("adminContent.message.importCancelled"));
      return;
    }
  }
  applyImportDraftToForm(draft);
  importDraftJsonInput.value = JSON.stringify(parsed, null, 2);
  await loadModules({
    preferredModuleId: selectedModuleId,
    preserveMessage: true,
    logResponse: false,
  });
  setMessage(t("adminContent.message.importApplied"));
  log({ importedDraft: draft });
}

async function handleCopyAuthoringPrompt() {
  await copyTextToClipboard(MODULE_AUTHORING_PROMPT_TEMPLATE);
  setMessage(t("adminContent.message.authoringPromptCopied"));
  log({
    authoringPromptCopied: true,
    reminder: t("adminContent.help.copyPrompt"),
  });
}

async function handleOpenParticipantPreview() {
  const payload = buildParticipantPreviewPayload();
  localStorage.setItem(PARTICIPANT_PREVIEW_STORAGE_KEY, JSON.stringify(payload));
  const previewWindow = window.open("/participant?preview=1", "_blank", "noopener");
  if (!previewWindow) {
    throw new Error(t("adminContent.errors.previewPopupBlocked"));
  }

  setMessage(t("adminContent.message.previewOpened"));
  log({
    participantPreview: {
      moduleId: payload.module.id,
      questionCount: payload.module.questions.length,
      createdAt: payload.createdAt,
    },
  });
}

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, async () => {
    try {
      const body = await apiFetch("/api/me", headers);
      log(body);
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

createModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(createModuleButton, async () => {
    try {
      await handleCreateModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

loadModulesButton.addEventListener("click", async () => {
  await runWithBusyButton(loadModulesButton, async () => {
    try {
      await loadModules();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

loadModuleContentButton.addEventListener("click", async () => {
  await runWithBusyButton(loadModuleContentButton, async () => {
    try {
      await handleLoadSelectedModuleContent();
    } catch (error) {
      setMessage(parseActionableErrorMessage(error));
      throw error;
    }
  });
});

exportModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(exportModuleButton, async () => {
    try {
      await handleExportSelectedModule();
    } catch (error) {
      setMessage(parseActionableErrorMessage(error));
      throw error;
    }
  });
});

deleteModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(deleteModuleButton, async () => {
    try {
      await handleDeleteSelectedModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

saveContentBundleButton.addEventListener("click", async () => {
  await runWithBusyButton(saveContentBundleButton, async () => {
    try {
      await handleSaveContentBundle();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

previewCurrentDraftButton.addEventListener("click", async () => {
  await runWithBusyButton(previewCurrentDraftButton, async () => {
    try {
      await handleOpenParticipantPreview();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

copyAuthoringPromptButton.addEventListener("click", async () => {
  await runWithBusyButton(copyAuthoringPromptButton, async () => {
    try {
      await handleCopyAuthoringPrompt();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

publishModuleVersionButton.addEventListener("click", async () => {
  await runWithBusyButton(publishModuleVersionButton, async () => {
    try {
      await handlePublishModuleVersion();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

selectedModuleIdInput.addEventListener("input", () => {
  setSelectedModule(selectedModuleIdInput.value.trim(), false);
});

moduleDropdown.addEventListener("change", () => {
  setSelectedModule(moduleDropdown.value, true);
  void refreshSelectedModuleStatus().catch(() => {
    selectedModuleStatus = null;
    renderModuleStatus();
  });
});

applyImportDraftButton.addEventListener("click", async () => {
  await runWithBusyButton(applyImportDraftButton, async () => {
    try {
      await handleApplyImportDraft(importDraftJsonInput.value);
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

importDraftFileInput.addEventListener("change", async () => {
  try {
    const rawValue = await readImportFileContents();
    importDraftJsonInput.value = rawValue;
    await handleApplyImportDraft(rawValue);
  } catch (error) {
    const message = parseActionableErrorMessage(error);
    setMessage(message);
    log(message);
  }
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
});

mockRolePresetSelect.addEventListener("change", () => {
  if (!mockRolePresetSelect.value || !roleSwitchState.enabled) {
    return;
  }

  rolesInput.value = mockRolePresetSelect.value;
  renderWorkspaceNavigation();
});

rolesInput.addEventListener("input", () => {
  const matchingPreset = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matchingPreset;
  renderWorkspaceNavigation();
});

for (const textarea of document.querySelectorAll("textarea")) {
  textarea.addEventListener("input", () => {
    syncTextareaHeight(textarea);
  });
}

populateLocaleSelect();
setLocale(currentLocale);
setDefaultFormValues();
loadVersion();
loadParticipantConsoleConfig();
renderModuleDropdown();
renderModuleMeta();
renderModuleStatus();
syncAllTextareaHeights();
