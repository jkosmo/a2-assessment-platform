import {
  localeLabels,
  supportedLocales,
  translations as adminContentTranslations,
} from "/static/i18n/admin-content-translations.js";
import { translations as calibrationTranslations } from "/static/i18n/calibration-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, fetchQueueCounts, applyNavReviewBadge } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { showToast } from "/static/toast.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { findLinkedVersion, deriveModuleStatusChains } from "/static/module-status-logic.js";
import { writeHandoff, readAndClearHandoff } from "/static/admin-content-handoff.js";
import { localizeValueForLocale, buildPreviewHtml } from "/static/admin-content-preview.js";
import {
  buildAdminContentConversationUrl,
  resolveConversationModuleId,
} from "/static/admin-content-handoff-routes.js";

const translations = Object.fromEntries(
  supportedLocales.map((locale) => [
    locale,
    {
      ...(calibrationTranslations[locale] ?? calibrationTranslations["en-GB"] ?? {}),
      ...(adminContentTranslations[locale] ?? adminContentTranslations["en-GB"] ?? {}),
    },
  ]),
);

const output = document.getElementById("output");
const outputDetails = document.getElementById("outputDetails");
const outputStatus = document.getElementById("outputStatus");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const tabModuler = document.getElementById("tabModuler");
const tabKurs = document.getElementById("tabKurs");
const tabKalibrering = document.getElementById("tabKalibrering");
const modulesTab = document.getElementById("modulesTab");
const coursesTab = document.getElementById("coursesTab");
const calibrationTab = document.getElementById("calibrationTab");
const moduleStartModeTabs = document.getElementById("moduleStartModeTabs");
const startModeImportTab = document.getElementById("startModeImportTab");
const startModeManualTab = document.getElementById("startModeManualTab");
const startModeExistingTab = document.getElementById("startModeExistingTab");
const startModeImportPanel = document.getElementById("startModeImportPanel");
const startModeManualPanel = document.getElementById("startModeManualPanel");
const startModeExistingPanel = document.getElementById("startModeExistingPanel");


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
const duplicateModuleButton = document.getElementById("duplicateModule");
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
const stateRail = document.getElementById("stateRail");
const srModuleName = document.getElementById("srModuleName");
const srEditing = document.getElementById("srEditing");
const srLive = document.getElementById("srLive");
const srChanges = document.getElementById("srChanges");
const srPreview = document.getElementById("srPreview");
const srLang = document.getElementById("srLang");
const unpublishModuleBtn = document.getElementById("unpublishModuleBtn");
const archiveModuleBtn = document.getElementById("archiveModuleBtn");

const importDraftFileInput = document.getElementById("importDraftFile");
const importDraftJsonInput = document.getElementById("importDraftJson");
const applyImportDraftButton = document.getElementById("applyImportDraft");
const copyAuthoringPromptButton = document.getElementById("copyAuthoringPrompt");
const authoringPromptDialog = document.getElementById("authoringPromptDialog");
const promptCertificationLevelSelect = document.getElementById("promptCertificationLevel");
const promptMcqCountInput = document.getElementById("promptMcqCount");
const promptFieldResponse = document.getElementById("promptFieldResponse");
const promptFieldReflection = document.getElementById("promptFieldReflection");
const promptFieldPromptExcerpt = document.getElementById("promptFieldPromptExcerpt");
const promptCustomFieldsInput = document.getElementById("promptCustomFields");
const promptDialogCancel = document.getElementById("promptDialogCancel");

const rubricCriteriaJsonInput = document.getElementById("rubricCriteriaJson");
const rubricScalingRuleJsonInput = document.getElementById("rubricScalingRuleJson");
const rubricPassRuleJsonInput = document.getElementById("rubricPassRuleJson");

const promptSystemPromptInput = document.getElementById("promptSystemPrompt");
const promptUserPromptTemplateInput = document.getElementById("promptUserPromptTemplate");
const promptExamplesJsonInput = document.getElementById("promptExamplesJson");

const mcqSetTitleInput = document.getElementById("mcqSetTitle");
const mcqQuestionsJsonInput = document.getElementById("mcqQuestionsJson");

const moduleVersionTaskTextInput = document.getElementById("moduleVersionTaskText");
const moduleVersionCandidateTaskConstraintsInput = document.getElementById("moduleVersionCandidateTaskConstraints");
const moduleVersionGuidanceTextInput = document.getElementById("moduleVersionGuidanceText");
const moduleVersionSubmissionSchemaInput = document.getElementById("moduleVersionSubmissionSchema");
const moduleVersionAssessmentPolicyInput = document.getElementById("moduleVersionAssessmentPolicy");
const moduleVersionRubricVersionIdInput = document.getElementById("moduleVersionRubricVersionId");
const moduleVersionPromptTemplateVersionIdInput = document.getElementById("moduleVersionPromptTemplateVersionId");
const moduleVersionMcqSetVersionIdInput = document.getElementById("moduleVersionMcqSetVersionId");
const saveContentBundleButton = document.getElementById("saveContentBundle");
const previewCurrentDraftButton = document.getElementById("previewCurrentDraft");

const publishModuleVersionIdInput = document.getElementById("publishModuleVersionId");
const publishModuleVersionButton = document.getElementById("publishModuleVersion");
const calibrationModuleIdSelect = document.getElementById("calibrationModuleId");
const calibrationModuleVersionIdInput = document.getElementById("calibrationModuleVersionId");
const calibrationStatuses = document.getElementById("calibrationStatuses");
const calibrationLimitInput = document.getElementById("calibrationLimit");
const calibrationDateFromInput = document.getElementById("calibrationDateFrom");
const calibrationDateToInput = document.getElementById("calibrationDateTo");
const loadCalibrationButton = document.getElementById("loadCalibration");
const calibrationMeta = document.getElementById("calibrationMeta");
const calibrationSignals = document.getElementById("calibrationSignals");
const calibrationOutcomesBody = document.getElementById("calibrationOutcomesBody");
const calibrationAnchorsBody = document.getElementById("calibrationAnchorsBody");
const thresholdEditorSection = document.getElementById("thresholdEditorSection");
const thresholdTotalMinInput = document.getElementById("thresholdTotalMin");
const publishThresholdsButton = document.getElementById("publishThresholds");
const thresholdPublishResult = document.getElementById("thresholdPublishResult");

const PARTICIPANT_PREVIEW_STORAGE_KEY = "adminContent.participantPreview.v1";
const allSubmissionStatuses = ["SUBMITTED", "PROCESSING", "SCORED", "UNDER_REVIEW", "COMPLETED", "REJECTED"];
function buildAuthoringPrompt(mcqCount, fields, certificationLevel = null) {
  const questionStub = `{
        "stem": {"en-GB": "", "nb": "", "nn": ""},
        "options": [
          {"en-GB": "", "nb": "", "nn": ""},
          {"en-GB": "", "nb": "", "nn": ""}
        ],
        "correctAnswer": {"en-GB": "", "nb": "", "nn": ""},
        "rationale": {"en-GB": "", "nb": "", "nn": ""}
      }`;
  const questionsJson = Array.from({ length: mcqCount }, () => questionStub).join(",\n      ");
  const fieldIds = fields.map((f) => `"${f.id}"`).join(", ");
  const schemaNote = fields.length > 0
    ? `\n- moduleVersion.submissionSchemaJson defines the participant submission form. The array MUST contain EXACTLY ${fields.length} field${fields.length !== 1 ? "s" : ""} with id${fields.length !== 1 ? "s" : ""} [${fieldIds}]. Do NOT add, remove, or rename any field. Fill in label (locale object), type, required, placeholder (locale object with en-GB, nb, nn — short guidance text shown to participants inside the input field, e.g. what to write or what a good answer includes), and defaultValue (locale object with en-GB, nb, nn — a short, realistic, module-specific placeholder answer for each locale).`
    : "";
  const fieldsWithPlaceholder = fields.map((f) => ({ ...f, placeholder: { "en-GB": "", nb: "", nn: "" } }));
  const schemaShape = fields.length > 0
    ? `,\n    "submissionSchemaJson": ${JSON.stringify({ fields: fieldsWithPlaceholder }, null, 4).split("\n").join("\n    ")}`
    : "";
  const levelNote = certificationLevel
    ? `\n- module.certificationLevel is fixed to "${certificationLevel}". Use this verbatim for all locales unless a locale-specific translation is clearly appropriate. Calibrate task complexity, MCQ distractor difficulty, and guidanceText depth to match a ${certificationLevel} certification level.`
    : "";
  const certificationLevelValue = certificationLevel
    ? `{"en-GB": "${certificationLevel}", "nb": "${certificationLevel}", "nn": "${certificationLevel}"}`
    : `{"en-GB": "", "nb": "", "nn": ""}`;
  return `You are producing a module draft JSON for an assessment platform.

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
  - module.certificationLevel
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
- All 4 options in each question must be comparable in length and level of detail. A candidate must not be able to identify the correct answer by noticing that one option is longer, more specific, or more qualified than the others. If the correct answer contains a qualifier or clause, all distractors must too. Never pad distractors with vague filler — write substantively comparable but wrong alternatives.
- rubric.criteria, rubric.scalingRule, and rubric.passRule must be valid JSON objects.
- moduleVersion.taskText must ask the participant to explain, compare, or interpret specific concepts. All concepts, definitions, terminology, and context the participant needs must be embedded directly in taskText — the participant has no access to the source material or any external document. Do not require application to a fictional or external example unless the source explicitly supports that framing.
- moduleVersion.guidanceText must describe what a strong response contains. Write as if the participant has only seen taskText — never reference the source material in guidanceText.
- validFrom and validTo should be empty strings unless a date range is explicitly provided.
- Generate exactly ${mcqCount} MCQ question${mcqCount !== 1 ? "s" : ""} in mcqSet.questions.${schemaNote}${levelNote}

First, identify the core concepts explicitly supported by the source material.
Then build the module using only those concepts.
Exclude any term, framing device, or task pattern not grounded in the source.

Grounding constraints (for you as author — the source material is never shared with participants):
- Use the source material as the sole content authority for what concepts to test.
- Use only concepts, distinctions, and claims that are explicitly present in or directly inferable from the source material.
- Do not import external theory, pedagogical formats, or generic assessment patterns unless explicitly supported by the source.
- Do not introduce scenario-based, case-based, or role-based tasks unless the source itself supports that framing.
- Do not introduce nouns such as "scenario", "case", "situation", or "applied example" unless they appear in the source.
- Every substantive concept in taskText, guidanceText, promptTemplate, and MCQ rationales must be traceable to the source material.
- If a useful assessment device is not source-grounded, leave it out rather than inventing supporting context.

Self-containment rule (applies to all participant-facing output fields — taskText, guidanceText, MCQ stems, options, rationales):
- The participant has no access to the source material. Every field must stand alone.
- Never use phrases such as "as described in the text", "according to the source", "from the reading", "as outlined above", "based on the material", "as stated in", "the text argues", "the author claims", or any wording that implies the participant can consult an unseen document.
- If a term or concept needs context for the participant, define or explain it inline within the relevant field.
- MCQ rationales are internal author notes — they may reference the source material for traceability, but stems and options must not.

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
    "certificationLevel": ${certificationLevelValue},
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
    "questions": [
      ${questionsJson}
    ]
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
    }${schemaShape}
  }
}

Source material follows:
[PASTE SOURCE MATERIAL HERE]`;
}

// Legacy static template retained for reference only — replaced by buildAuthoringPrompt above.
const _LEGACY_MODULE_AUTHORING_PROMPT_TEMPLATE = `You are producing a module draft JSON for an assessment platform.

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
  - module.certificationLevel
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
    "certificationLevel": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
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
    "questions": [
      {
        "stem": {"en-GB": "", "nb": "", "nn": ""},
        "options": [
          {"en-GB": "", "nb": "", "nn": ""},
          {"en-GB": "", "nb": "", "nn": ""}
        ],
        "correctAnswer": {"en-GB": "", "nb": "", "nn": ""},
        "rationale": {"en-GB": "", "nb": "", "nn": ""}
      }
    ]
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

let currentLocale = resolveInitialLocale();
let modules = [];
let selectedModuleId = "";
let activeContentTab = "modules";
let activeModuleStartMode = "existing";
let selectedModuleStatus = null;
let editorBaselineSnapshot = null;
let latestCalibrationWorkspaceBody = null;
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: { items: [] },
  calibrationWorkspace: {
    accessRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
    defaults: {
      statuses: ["COMPLETED", "UNDER_REVIEW"],
      lookbackDays: 90,
      maxRows: 120,
    },
    signalThresholds: {
      passRateMinimum: 0.6,
      manualReviewRateMaximum: 0.35,
      benchmarkCoverageMinimum: 0.5,
    },
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
let dirtyCards = new Set();
let _dialogTriggerRef = null;

// Advanced preview panel state
let advPreviewLocale = null; // set to currentLocale on first open
let advPreviewOpen = false;

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

function tf(key, vars = {}) {
  let str = t(key);
  for (const [name, value] of Object.entries(vars)) {
    str = str.replace(`{${name}}`, String(value));
  }
  return str;
}

function setMessage(text, type = "info") {
  if (!text) return;
  showToast(text, type === "error" ? "error" : type === "success" ? "success" : "info");
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
  renderCalibrationTabVisibility();
  renderModuleMeta();
  renderModuleStatus();
  renderCalibrationModuleOptions();
  populateCalibrationStatusOptions();
  renderCalibrationWorkspace(latestCalibrationWorkspaceBody);
  renderContentCards();
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

// ── Dialog helpers (tier-based confirmation model) ──────────────────────────

/** Tier 1: simple confirm — single OK / Cancel choice. Returns Promise<boolean>. */
function showSimpleConfirm(titleText, messageText, okLabel) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dialogSimpleConfirm");
    const titleEl = document.getElementById("dlgSimpleConfirmTitle");
    const msgEl = document.getElementById("dlgSimpleConfirmMsg");
    const okBtn = document.getElementById("dlgSimpleConfirmOk");
    const cancelBtn = document.getElementById("dlgSimpleConfirmCancel");

    titleEl.textContent = titleText;
    msgEl.textContent = messageText;
    okBtn.textContent = okLabel || t("adminContent.confirm.simple.confirmBtn");

    const onOk = () => { cleanup(); dialog.close(); resolve(true); };
    const onCancel = () => { cleanup(); dialog.close(); resolve(false); };
    const onClose = () => { cleanup(); resolve(false); };

    function cleanup() {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
  });
}

/** Tier 2: hard two-step — user must type the module name to enable delete. Returns Promise<boolean>. */
function showDeleteConfirm(moduleLabel) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dialogDeleteConfirm");
    const msgEl = document.getElementById("dlgDeleteConfirmMsg");
    const typeLabelEl = document.getElementById("dlgDeleteTypeLabel");
    const typeInput = document.getElementById("dlgDeleteTypeConfirm");
    const okBtn = document.getElementById("dlgDeleteConfirmOk");
    const cancelBtn = document.getElementById("dlgDeleteConfirmCancel");

    msgEl.textContent = t("adminContent.confirm.deleteModule").replace("{module}", moduleLabel);
    typeLabelEl.textContent = t("adminContent.confirm.delete.typeLabel").replace("{module}", moduleLabel);
    typeInput.value = "";
    okBtn.disabled = true;

    const onInput = () => { okBtn.disabled = typeInput.value.trim() !== moduleLabel; };
    const onOk = () => { cleanup(); dialog.close(); resolve(true); };
    const onCancel = () => { cleanup(); dialog.close(); resolve(false); };
    const onClose = () => { cleanup(); resolve(false); };

    function cleanup() {
      typeInput.removeEventListener("input", onInput);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
    }

    typeInput.addEventListener("input", onInput);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
    typeInput.focus();
  });
}

/** Navigation guard: unsaved changes in advanced editor. Returns Promise<'save'|'discard'|'cancel'>. */
function showUnsavedHandoffDialog() {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dialogUnsavedHandoff");
    const saveBtn = document.getElementById("dlgUnsavedSave");
    const discardBtn = document.getElementById("dlgUnsavedDiscard");
    const cancelBtn = document.getElementById("dlgUnsavedCancel");

    const onSave = () => { cleanup(); dialog.close(); resolve("save"); };
    const onDiscard = () => { cleanup(); dialog.close(); resolve("discard"); };
    const onCancel = () => { cleanup(); dialog.close(); resolve("cancel"); };
    const onClose = () => { cleanup(); resolve("cancel"); };

    function cleanup() {
      saveBtn.removeEventListener("click", onSave);
      discardBtn.removeEventListener("click", onDiscard);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
    }

    saveBtn.addEventListener("click", onSave);
    discardBtn.addEventListener("click", onDiscard);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
  });
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

function normalizeLocalizedTitlePatchValue(value, fieldLabelKey) {
  const parsed = parseLocalizedTextField(value, fieldLabelKey, { required: false });
  if (!parsed) {
    return null;
  }
  if (typeof parsed === "string") {
    return {
      "en-GB": parsed,
      nb: parsed,
      nn: parsed,
    };
  }
  return parsed;
}

function isLocalizedContentObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localizeContentValue(value) {
  if (typeof value === "string") {
    if (value.startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          value = parsed;
        } else {
          return value;
        }
      } catch {
        return value;
      }
    } else {
      return value;
    }
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
    moduleVersionCandidateTaskConstraints: normalizeSnapshotValue(moduleVersionCandidateTaskConstraintsInput?.value ?? ""),
    moduleVersionGuidanceText: normalizeSnapshotValue(moduleVersionGuidanceTextInput.value),
    moduleVersionSubmissionSchema: normalizeSnapshotValue(moduleVersionSubmissionSchemaInput.value),
    moduleVersionAssessmentPolicy: normalizeSnapshotValue(moduleVersionAssessmentPolicyInput.value),
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
    moduleVersionCandidateTaskConstraints: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.candidateTaskConstraints, "")),
    moduleVersionGuidanceText: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.guidanceText, "")),
    moduleVersionSubmissionSchema: normalizeSnapshotValue(
      JSON.stringify(normalizeSubmissionSchemaToSingleField(draft?.moduleVersion?.submissionSchema), null, 2),
    ),
    moduleVersionAssessmentPolicy: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.assessmentPolicy, "")),
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

function deriveModuleStatusView(moduleExport) {
  const chains = deriveModuleStatusChains(moduleExport);
  if (!chains) return null;

  const module = moduleExport.module;
  return {
    title: localizeContentValue(module.title),
    description: localizeContentValue(module.description),
    certificationLevel: localizeContentValue(module.certificationLevel),
    validFrom: module.validFrom,
    validTo: module.validTo,
    ...chains,
  };
}

// ---------------------------------------------------------------------------
// State rail
// ---------------------------------------------------------------------------

function makeSrBadge(modifier, text) {
  return `<span class="sr-badge sr-badge--${modifier}">${escapeHtml(text)}</span>`;
}

function updateStateRail() {
  if (!stateRail) return;
  const hasModule = !!selectedModuleId && !!selectedModuleStatus;
  stateRail.hidden = !hasModule;
  if (!hasModule) return;

  const view = deriveModuleStatusView(selectedModuleStatus);
  if (!view) return;

  const hasUnsaved = dirtyCards.size > 0;

  if (srModuleName) {
    srModuleName.textContent = view.title || selectedModuleId;
  }

  if (srEditing) {
    if (hasUnsaved) {
      srEditing.innerHTML = makeSrBadge("unsaved", t("stateRail.editing.workingDraft"));
    } else if (view.latestDraftChain.length > 0) {
      srEditing.innerHTML = makeSrBadge(
        "saved-draft",
        tf("stateRail.editing.savedDraft", { versionNo: view.latestDraftChain[0].versionNo }),
      );
    } else if (view.liveChain.length > 0) {
      srEditing.innerHTML = makeSrBadge(
        "published",
        tf("stateRail.editing.published", { versionNo: view.liveChain[0].versionNo }),
      );
    } else {
      srEditing.innerHTML = `<span class="state-rail-value">—</span>`;
    }
  }

  if (srLive) {
    if (view.liveChain.length > 0) {
      srLive.innerHTML = makeSrBadge(
        "published",
        tf("stateRail.live.published", { versionNo: view.liveChain[0].versionNo }),
      );
    } else {
      srLive.innerHTML = `<span class="state-rail-value" style="color:var(--color-meta)">${escapeHtml(t("stateRail.live.none"))}</span>`;
    }
  }

  if (srChanges) {
    if (hasUnsaved) {
      srChanges.innerHTML = makeSrBadge("unsaved", t("stateRail.changes.unsaved"));
    } else {
      srChanges.innerHTML = `<span class="state-rail-value" style="color:var(--color-success)">${escapeHtml(t("stateRail.changes.saved"))}</span>`;
    }
  }

  if (srPreview) {
    srPreview.innerHTML = hasUnsaved
      ? makeSrBadge("unsaved", t("stateRail.preview.workingDraft"))
      : `<span class="state-rail-value">${escapeHtml(t("stateRail.preview.published"))}</span>`;
  }

  if (srLang) {
    srLang.textContent = localeLabels[advPreviewLocale ?? currentLocale] ?? (advPreviewLocale ?? currentLocale);
  }
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
  if (moduleVersionCandidateTaskConstraintsInput) moduleVersionCandidateTaskConstraintsInput.value = formatEditorValue(draft?.moduleVersion?.candidateTaskConstraints, "");
  moduleVersionGuidanceTextInput.value = formatEditorValue(draft?.moduleVersion?.guidanceText, "");
  moduleVersionSubmissionSchemaInput.value = JSON.stringify(
    normalizeSubmissionSchemaToSingleField(draft?.moduleVersion?.submissionSchemaJson ?? draft?.moduleVersion?.submissionSchema),
    null,
    2,
  );
  moduleVersionAssessmentPolicyInput.value = formatEditorValue(draft?.moduleVersion?.assessmentPolicy, "");
  if (!moduleVersionAssessmentPolicyInput.value.trim()) fillDefaultAssessmentPolicy();

  moduleVersionRubricVersionIdInput.value = "";
  moduleVersionPromptTemplateVersionIdInput.value = "";
  moduleVersionMcqSetVersionIdInput.value = "";
  publishModuleVersionIdInput.value = "";
  dirtyCards.clear();
  syncAllTextareaHeights();
  renderContentCards();
}

function populateFormFromModuleExport(moduleExport) {
  const selectedConfiguration = moduleExport?.selectedConfiguration ?? {};
  const moduleVersion = selectedConfiguration.moduleVersion ?? null;
  const rubricVersion = selectedConfiguration.rubricVersion ?? null;
  const promptTemplateVersion = selectedConfiguration.promptTemplateVersion ?? null;
  const mcqSetVersion = selectedConfiguration.mcqSetVersion ?? null;
  const module = moduleExport?.module ?? null;

  moduleTitleInput.value = formatEditorValue(module?.title, "");
  moduleDescriptionInput.value = formatEditorValue(module?.description, "");
  moduleCertificationLevelInput.value = formatEditorValue(module?.certificationLevel, "");
  moduleValidFromInput.value = typeof module?.validFrom === "string" ? module.validFrom : "";
  moduleValidToInput.value = typeof module?.validTo === "string" ? module.validTo : "";

  rubricCriteriaJsonInput.value = formatEditorValue(rubricVersion?.criteria, "");
  rubricScalingRuleJsonInput.value = formatEditorValue(rubricVersion?.scalingRule, "");
  rubricPassRuleJsonInput.value = formatEditorValue(rubricVersion?.passRule, "");

  promptSystemPromptInput.value = formatEditorValue(promptTemplateVersion?.systemPrompt, "");
  promptUserPromptTemplateInput.value = formatEditorValue(promptTemplateVersion?.userPromptTemplate, "");
  promptExamplesJsonInput.value = formatEditorValue(promptTemplateVersion?.examples, "[]");

  mcqSetTitleInput.value = formatEditorValue(mcqSetVersion?.title, "");
  mcqQuestionsJsonInput.value = formatEditorValue(mcqSetVersion?.questions, "[]");

  moduleVersionTaskTextInput.value = formatEditorValue(moduleVersion?.taskText, "");
  if (moduleVersionCandidateTaskConstraintsInput) moduleVersionCandidateTaskConstraintsInput.value = formatEditorValue(moduleVersion?.candidateTaskConstraints, "");
  moduleVersionGuidanceTextInput.value = formatEditorValue(moduleVersion?.guidanceText, "");
  moduleVersionSubmissionSchemaInput.value = JSON.stringify(
    normalizeSubmissionSchemaToSingleField(moduleVersion?.submissionSchema),
    null,
    2,
  );
  moduleVersionAssessmentPolicyInput.value = formatEditorValue(moduleVersion?.assessmentPolicy, "");
  if (!moduleVersionAssessmentPolicyInput.value.trim()) fillDefaultAssessmentPolicy();
  moduleVersionRubricVersionIdInput.value = rubricVersion?.id ?? "";
  moduleVersionPromptTemplateVersionIdInput.value = promptTemplateVersion?.id ?? "";
  moduleVersionMcqSetVersionIdInput.value = mcqSetVersion?.id ?? "";
  publishModuleVersionIdInput.value = moduleVersion?.id ?? "";

  selectedModuleStatus = moduleExport;
  dirtyCards.clear();
  renderModuleStatus();
  syncAllTextareaHeights();
  renderContentCards();
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
      candidateTaskConstraints: parseLocalizedPreviewField(
        moduleVersionCandidateTaskConstraintsInput?.value ?? "",
        "adminContent.moduleVersion.candidateTaskConstraints",
      ),
      guidanceText: parseLocalizedPreviewField(
        moduleVersionGuidanceTextInput.value,
        "adminContent.moduleVersion.guidanceText",
      ),
      submissionSchema: normalizeSubmissionSchemaToSingleField(moduleVersionSubmissionSchemaInput.value.trim()),
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
  );
  renderWorkspaceNavigationWithProfile({
    workspaceNav,
    localePicker,
    items,
    buildLabel: (item) => t(item.labelKey),
  });
}

function getCurrentRoles() {
  return rolesInput.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function canAccessCalibrationTab() {
  const requiredRoles = participantRuntimeConfig?.calibrationWorkspace?.accessRoles ?? [];
  const currentRoles = new Set(getCurrentRoles());
  return requiredRoles.length === 0 || requiredRoles.some((role) => currentRoles.has(role));
}

function renderCalibrationTabVisibility() {
  if (!tabKalibrering) {
    return;
  }

  const visible = canAccessCalibrationTab();
  tabKalibrering.hidden = !visible;
  if (calibrationTab) {
    calibrationTab.hidden = !visible || activeContentTab !== "calibration";
  }

  if (!visible && activeContentTab === "calibration") {
    activateContentTab("modules");
  }
}

function activateModuleStartMode(mode) {
  if (!moduleStartModeTabs || !startModeImportTab || !startModeManualTab || !startModeExistingTab) {
    return;
  }

  const toolsSection = document.getElementById("advancedToolsSection");
  if (toolsSection) toolsSection.open = true;

  const normalizedMode = mode === "import" || mode === "manual" || mode === "existing" ? mode : "existing";
  activeModuleStartMode = normalizedMode;

  const tabConfig = [
    { id: "import", button: startModeImportTab, panel: startModeImportPanel },
    { id: "manual", button: startModeManualTab, panel: startModeManualPanel },
    { id: "existing", button: startModeExistingTab, panel: startModeExistingPanel },
  ];

  for (const tab of tabConfig) {
    const active = tab.id === activeModuleStartMode;
    tab.button?.classList.toggle("active", active);
    tab.button?.setAttribute("aria-selected", active ? "true" : "false");
    if (tab.button) {
      tab.button.tabIndex = active ? 0 : -1;
    }
    if (tab.panel) {
      tab.panel.hidden = !active;
    }
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
  if (moduleVersionCandidateTaskConstraintsInput) moduleVersionCandidateTaskConstraintsInput.value = "";
  moduleVersionGuidanceTextInput.value = t("adminContent.defaults.guidanceText");
  moduleVersionSubmissionSchemaInput.value = JSON.stringify(normalizeSubmissionSchemaToSingleField(), null, 2);
  moduleVersionAssessmentPolicyInput.value = "";
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
    unpublishModuleBtn.hidden = true;
    archiveModuleBtn.hidden = true;
    if (module?.activeVersionNo) {
      renderStatusChain(moduleStatusCounts, [{ label: "Module", versionNo: module.activeVersionNo }]);
    } else {
      moduleStatusCounts.textContent = "-";
    }
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

  unpublishModuleBtn.hidden = view.liveChain.length === 0;
  // Archive: only available when module is unpublished (no active version)
  archiveModuleBtn.hidden = view.liveChain.length !== 0;

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
  if (view.versionsCountsChain.length > 0) {
    renderStatusChain(moduleStatusCounts, view.versionsCountsChain);
  } else {
    moduleStatusCounts.textContent = "-";
  }
  moduleStatusDetails.textContent = JSON.stringify(view.technicalDetails, null, 2);
  updateStateRail();
  renderAdvancedPreview();
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
  if (moduleVersionCandidateTaskConstraintsInput) moduleVersionCandidateTaskConstraintsInput.value = "";
  moduleVersionGuidanceTextInput.value = "";
  moduleVersionSubmissionSchemaInput.value = JSON.stringify(normalizeSubmissionSchemaToSingleField(), null, 2);
  moduleVersionAssessmentPolicyInput.value = "";
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
  updateBackToChatLink();
  if (syncInput) {
    selectedModuleIdInput.value = selectedModuleId;
  }
  selectedModuleStatus = null;
  if (moduleChanged) {
    clearVersionFields();
  }
  renderModuleDropdown();
  renderCalibrationModuleOptions();
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
      calibrationWorkspace: {
        ...participantRuntimeConfig.calibrationWorkspace,
        ...(body?.calibrationWorkspace ?? {}),
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
  if (calibrationLimitInput) {
    calibrationLimitInput.value = String(participantRuntimeConfig?.calibrationWorkspace?.defaults?.maxRows ?? 120);
  }
  renderRolePresetControl();

  if (roleSwitchState.authMode === "entra") {
    try {
      const me = await apiFetch("/api/me", headers);
      if (Array.isArray(me?.user?.roles) && me.user.roles.length > 0) {
        rolesInput.value = me.user.roles.join(",");
      }
    } catch {
      // nav renders with empty roles if /api/me fails
    }
  }

  renderWorkspaceNavigation();
  renderCalibrationTabVisibility();
  await initConsentGuard(headers, currentLocale);
  fetchQueueCounts(headers).then((counts) => applyNavReviewBadge(workspaceNav, counts));
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

  renderCalibrationModuleOptions();

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

  // Capture version fields before loadModules triggers clearVersionFields on module change.
  // A newly created module has no database versions yet, so we preserve the imported draft
  // content so the user can immediately save it as the first version.
  const savedVersionFields = {
    rubricCriteriaJson: rubricCriteriaJsonInput.value,
    rubricScalingRuleJson: rubricScalingRuleJsonInput.value,
    rubricPassRuleJson: rubricPassRuleJsonInput.value,
    promptSystemPrompt: promptSystemPromptInput.value,
    promptUserPromptTemplate: promptUserPromptTemplateInput.value,
    promptExamplesJson: promptExamplesJsonInput.value,
    mcqSetTitle: mcqSetTitleInput.value,
    mcqQuestionsJson: mcqQuestionsJsonInput.value,
    moduleVersionTaskText: moduleVersionTaskTextInput.value,
    moduleVersionCandidateTaskConstraints: moduleVersionCandidateTaskConstraintsInput?.value ?? "",
    moduleVersionGuidanceText: moduleVersionGuidanceTextInput.value,
    moduleVersionSubmissionSchema: moduleVersionSubmissionSchemaInput.value,
    moduleVersionAssessmentPolicy: moduleVersionAssessmentPolicyInput.value,
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

  // Restore version field content cleared by clearVersionFields during loadModules.
  rubricCriteriaJsonInput.value = savedVersionFields.rubricCriteriaJson;
  rubricScalingRuleJsonInput.value = savedVersionFields.rubricScalingRuleJson;
  rubricPassRuleJsonInput.value = savedVersionFields.rubricPassRuleJson;
  promptSystemPromptInput.value = savedVersionFields.promptSystemPrompt;
  promptUserPromptTemplateInput.value = savedVersionFields.promptUserPromptTemplate;
  promptExamplesJsonInput.value = savedVersionFields.promptExamplesJson;
  mcqSetTitleInput.value = savedVersionFields.mcqSetTitle;
  mcqQuestionsJsonInput.value = savedVersionFields.mcqQuestionsJson;
  moduleVersionTaskTextInput.value = savedVersionFields.moduleVersionTaskText;
  if (moduleVersionCandidateTaskConstraintsInput) moduleVersionCandidateTaskConstraintsInput.value = savedVersionFields.moduleVersionCandidateTaskConstraints ?? "";
  moduleVersionGuidanceTextInput.value = savedVersionFields.moduleVersionGuidanceText;
  moduleVersionSubmissionSchemaInput.value = JSON.stringify(
    normalizeSubmissionSchemaToSingleField(savedVersionFields.moduleVersionSubmissionSchema),
    null,
    2,
  );
  moduleVersionAssessmentPolicyInput.value = savedVersionFields.moduleVersionAssessmentPolicy;
  syncAllTextareaHeights();
  // Mark restored content as dirty (not yet saved as a version) and refresh cards.
  for (const key of ["rubric", "prompt", "mcq", "versionDetails", "assessmentPolicy", "submissionSchema"]) {
    dirtyCards.add(key);
  }
  renderContentCards();

  if (!options.silent) {
    setMessage(t("adminContent.message.moduleCreated"));
    log(body);
  }
  await refreshSelectedModuleStatus();
  document.getElementById("moduleStatusCard")?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return body;
}

async function handleDeleteSelectedModule() {
  if (!selectedModuleId) {
    throw new Error(t("adminContent.errors.moduleIdRequired"));
  }

  const module = modules.find((item) => item.id === selectedModuleId) ?? null;
  const moduleLabel = module?.title ?? selectedModuleId;
  const confirmed = await showDeleteConfirm(moduleLabel);
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

async function handleDuplicateSelectedModule() {
  const moduleExport = await refreshSelectedModuleStatus();
  if (!moduleExport) {
    throw new Error("Module export payload was empty.");
  }

  const sourceModuleId = moduleExport.module?.id ?? selectedModuleId;
  const sourceModuleLabel =
    modules.find((item) => item.id === sourceModuleId)?.title ??
    sourceModuleId ??
    t("adminContent.meta.noneSelected");
  const draft = normalizeImportDraftPayload(moduleExport);

  setSelectedModule("", false);
  applyImportDraftToForm(draft);
  importDraftJsonInput.value = JSON.stringify(moduleExport, null, 2);
  dirtyCards.clear();
  renderContentCards();
  activateModuleStartMode("existing");

  const body = await handleCreateModule({ silent: true });
  setMessage(t("adminContent.message.moduleDuplicated").replace("{module}", sourceModuleLabel), "success");
  log({
    duplicatedFromModuleId: sourceModuleId,
    duplicatedToModuleId: body?.module?.id ?? null,
  });
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
    submissionSchema = normalizeSubmissionSchemaToSingleField(
      parseJsonField(rawSubmissionSchema, "adminContent.moduleVersion.submissionSchemaJson"),
    );
  }
  const rawAssessmentPolicy = moduleVersionAssessmentPolicyInput.value.trim();
  const assessmentPolicy = rawAssessmentPolicy
    ? parseJsonField(rawAssessmentPolicy, "adminContent.moduleVersion.assessmentPolicyJson")
    : undefined;
  const payload = {
    taskText: parseLocalizedTextField(moduleVersionTaskTextInput.value, "adminContent.moduleVersion.taskText"),
    candidateTaskConstraints: parseLocalizedTextField(
      moduleVersionCandidateTaskConstraintsInput?.value ?? "",
      "adminContent.moduleVersion.candidateTaskConstraints",
      { required: false },
    ),
    guidanceText: parseLocalizedTextField(
      moduleVersionGuidanceTextInput.value,
      "adminContent.moduleVersion.guidanceText",
      { required: false },
    ),
    rubricVersionId: moduleVersionRubricVersionIdInput.value.trim(),
    promptTemplateVersionId: moduleVersionPromptTemplateVersionIdInput.value.trim(),
    mcqSetVersionId: moduleVersionMcqSetVersionIdInput.value.trim(),
    ...(submissionSchema !== undefined && { submissionSchema }),
    ...(assessmentPolicy !== undefined && { assessmentPolicy }),
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

function isSelectedModuleContentUninitialized() {
  return Boolean(selectedModuleId)
    && dirtyCards.size === 0
    && !moduleTitleInput.value.trim()
    && !rubricCriteriaJsonInput.value.trim()
    && !promptSystemPromptInput.value.trim()
    && !mcqQuestionsJsonInput.value.trim()
    && !moduleVersionTaskTextInput.value.trim();
}

async function handleSaveContentBundle() {
  if (isSelectedModuleContentUninitialized()) {
    await handleLoadSelectedModuleContent();
  }

  const moduleId = resolveModuleIdOrThrow();
  const titlePatch = normalizeLocalizedTitlePatchValue(moduleTitleInput.value, "adminContent.module.name");
  let titleBody = null;
  if (titlePatch) {
    titleBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/title`, headers, {
      method: "PATCH",
      body: JSON.stringify({ title: titlePatch }),
    });
    const savedTitle = titleBody?.module?.title ?? titlePatch;
    const selectedModule = modules.find((item) => item.id === moduleId);
    if (selectedModule) {
      selectedModule.title = localizeContentValue(savedTitle) || selectedModule.title;
    }
    renderModuleDropdown();
    renderModuleMeta();
  }

  const rubricBody = await handleCreateRubricVersion({ silent: true });
  const promptBody = await handleCreatePromptTemplateVersion({ silent: true });
  const mcqBody = await handleCreateMcqSetVersion({ silent: true });
  const moduleVersionBody = await handleCreateModuleVersion({ silent: true });

  setMessage(t("adminContent.message.bundleSaved"), "success");
  log({
    module: titleBody.module,
    rubricVersion: rubricBody.rubricVersion,
    promptTemplateVersion: promptBody.promptTemplateVersion,
    mcqSetVersion: mcqBody.mcqSetVersion,
    moduleVersion: moduleVersionBody.moduleVersion,
  });
  await refreshSelectedModuleStatus();
  for (const key of ["moduleDetails", "rubric", "prompt", "mcq", "versionDetails", "assessmentPolicy", "submissionSchema"]) {
    dirtyCards.delete(key);
  }
  renderContentCards();
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
  setMessage(t("adminContent.message.moduleVersionPublished"), "success");
  log(body);
  await refreshSelectedModuleStatus();
}

async function handleUnpublishModule() {
  const moduleId = resolveModuleIdOrThrow();
  const module = modules.find((item) => item.id === moduleId) ?? null;
  const moduleLabel = module?.title ?? moduleId;
  const confirmed = await showSimpleConfirm(
    t("adminContent.confirm.unpublish.title"),
    t("adminContent.confirm.unpublishModule").replace("{module}", moduleLabel),
  );
  if (!confirmed) {
    return;
  }

  const body = await apiFetch(
    `/api/admin/content/modules/${encodeURIComponent(moduleId)}/unpublish`,
    headers,
    { method: "POST", body: JSON.stringify({}) },
  );
  setMessage(t("adminContent.message.moduleUnpublished"), "success");
  log(body);
  await refreshSelectedModuleStatus();
}

async function handleArchiveModule() {
  const moduleId = resolveModuleIdOrThrow();
  const module = modules.find((item) => item.id === moduleId) ?? null;
  const moduleLabel = module?.title ?? moduleId;
  const confirmed = await showSimpleConfirm(
    t("adminContent.confirm.archive.title"),
    t("adminContent.confirm.archiveModule").replace("{module}", moduleLabel),
  );
  if (!confirmed) {
    return;
  }

  await apiFetch(
    `/api/admin/content/modules/${encodeURIComponent(moduleId)}/archive`,
    headers,
    { method: "POST", body: JSON.stringify({}) },
  );
  setMessage(t("adminContent.message.moduleArchived"), "success");
  await loadModules();
  setSelectedModule("", false);
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
    const confirmed = await showSimpleConfirm(
      t("adminContent.confirm.importOverwrite.title"),
      t("adminContent.confirm.importOverwrite"),
    );
    if (!confirmed) {
      setMessage(t("adminContent.message.importCancelled"));
      return;
    }
  }
  applyImportDraftToForm(draft);
  importDraftJsonInput.value = JSON.stringify(parsed, null, 2);
  dirtyCards.clear();
  renderContentCards();
  if (!selectedModuleId) {
    // No module selected — auto-create from the draft's module details so the user
    // can go straight to "Lagre alle endringer" without a separate "Opprett modul" step.
    await handleCreateModule({ silent: true });
    setMessage(t("adminContent.message.importAppliedWithModule"));
  } else {
    await loadModules({
      preferredModuleId: selectedModuleId,
      preserveMessage: true,
      logResponse: false,
    });
    setMessage(t("adminContent.message.importApplied"));
  }
  log({ importedDraft: draft });
}

function resolvePromptFields() {
  return [buildDefaultSubmissionField()];
}

function buildDefaultSubmissionField(overrides = {}) {
  return {
    id: "response",
    label: {
      "en-GB": "Your response",
      nb: "Ditt svar",
      nn: "Ditt svar",
      ...(typeof overrides.label === "object" && overrides.label !== null ? overrides.label : {}),
    },
    type: "textarea",
    required: true,
    ...(typeof overrides.placeholder === "object" && overrides.placeholder !== null
      ? { placeholder: overrides.placeholder }
      : {}),
    ...(typeof overrides.defaultValue === "object" && overrides.defaultValue !== null
      ? { defaultValue: overrides.defaultValue }
      : {}),
  };
}

function normalizeSubmissionSchemaToSingleField(input) {
  const parsed = (() => {
    if (!input) return {};
    if (typeof input === "string") {
      try {
        return JSON.parse(input);
      } catch {
        return {};
      }
    }
    return input;
  })();

  const fields = Array.isArray(parsed?.fields) ? parsed.fields : Array.isArray(parsed) ? parsed : [];
  const firstField = fields[0] && typeof fields[0] === "object" ? fields[0] : {};
  return { fields: [buildDefaultSubmissionField(firstField)] };
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

// ── Content cards ─────────────────────────────────────────────────────────────

function truncateText(text, maxLen = 120) {
  if (!text || typeof text !== "string") return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "…" : cleaned;
}

function parseLocalizedSafe(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || !trimmed.startsWith("{")) return trimmed;
  try { return JSON.parse(trimmed); } catch { return trimmed; }
}

function getJsonSummary(rawValue) {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return `${parsed.length} item${parsed.length !== 1 ? "s" : ""}`;
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed);
      if (keys.length === 0) return "{}";
      return keys.slice(0, 4).join(", ") + (keys.length > 4 ? ", …" : "");
    }
    return trimmed;
  } catch {
    return truncateText(trimmed, 100);
  }
}

function getSubmissionSchemaSummary(rawValue) {
  const schema = normalizeSubmissionSchemaToSingleField(rawValue);
  const field = schema.fields?.[0] ?? buildDefaultSubmissionField();
  const label = localizeContentValue(field.label);
  return label ? `${t("adminContent.dialog.submissionSchema.singleFieldSummary")} — ${label}` : t("adminContent.dialog.submissionSchema.singleFieldSummary");
}

function setCardSummary(elementId, text) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const empty = !text || (typeof text === "string" && !text.trim());
  if (empty) {
    el.textContent = t("adminContent.cards.empty");
    el.classList.add("empty");
  } else {
    el.textContent = truncateText(typeof text === "string" ? text : JSON.stringify(text));
    el.classList.remove("empty");
  }
}

function setCardUnsaved(elementId, isDirty) {
  const el = document.getElementById(elementId);
  if (el) el.hidden = !isDirty;
}

function renderContentCards() {
  // Moduldetaljer
  const titleVal = localizeContentValue(parseLocalizedSafe(moduleTitleInput.value));
  const descVal = localizeContentValue(parseLocalizedSafe(moduleDescriptionInput.value));
  const moduleDetailsSummary = [titleVal, descVal].filter(Boolean).join(" — ");
  setCardSummary("contentCard_moduleDetails_summary", moduleDetailsSummary);
  setCardUnsaved("contentCard_moduleDetails_unsaved", dirtyCards.has("moduleDetails"));

  // Versjonsdetaljer
  const taskVal = localizeContentValue(parseLocalizedSafe(moduleVersionTaskTextInput.value));
  setCardSummary("contentCard_versionDetails_summary", taskVal);
  setCardUnsaved("contentCard_versionDetails_unsaved", dirtyCards.has("versionDetails"));

  // Rubrikk
  setCardSummary("contentCard_rubric_summary", getJsonSummary(rubricCriteriaJsonInput.value));
  setCardUnsaved("contentCard_rubric_unsaved", dirtyCards.has("rubric"));

  // Vurderingspolicy
  setCardSummary("contentCard_assessmentPolicy_summary", getJsonSummary(moduleVersionAssessmentPolicyInput.value));
  setCardUnsaved("contentCard_assessmentPolicy_unsaved", dirtyCards.has("assessmentPolicy"));

  // LLM-prompt
  const promptVal = localizeContentValue(parseLocalizedSafe(promptSystemPromptInput.value));
  setCardSummary("contentCard_prompt_summary", promptVal);
  setCardUnsaved("contentCard_prompt_unsaved", dirtyCards.has("prompt"));

  // Flervalgstest
  setCardSummary("contentCard_mcq_summary", getJsonSummary(mcqQuestionsJsonInput.value));
  setCardUnsaved("contentCard_mcq_unsaved", dirtyCards.has("mcq"));

  // Innleveringsskjema
  setCardSummary("contentCard_submissionSchema_summary", getSubmissionSchemaSummary(moduleVersionSubmissionSchemaInput.value));
  setCardUnsaved("contentCard_submissionSchema_unsaved", dirtyCards.has("submissionSchema"));

  // Show/hide save button row
  const actionsEl = document.getElementById("contentCardsActions");
  if (actionsEl) actionsEl.style.display = selectedModuleId ? "" : "none";

  // Show publish button only when a saved module version ID is available
  const publishFromCardsBtn = document.getElementById("publishFromCards");
  if (publishFromCardsBtn) {
    publishFromCardsBtn.hidden = !publishModuleVersionIdInput.value.trim();
  }

  updateStateRail();
  renderAdvancedPreview();
}

// ── Assessment policy helper ───────────────────────────────────────────────────

function fillDefaultAssessmentPolicy() {
  let hasMcq = false;
  try {
    const parsed = JSON.parse(mcqQuestionsJsonInput.value.trim() || "[]");
    hasMcq = Array.isArray(parsed) && parsed.length > 0;
  } catch {
    hasMcq = false;
  }
  const defaultPolicy = hasMcq
    ? { scoring: { practicalWeight: 60, mcqWeight: 40 }, passRules: { totalMin: 65 } }
    : { scoring: { practicalWeight: 100, mcqWeight: 0 }, passRules: { totalMin: 50 } };
  moduleVersionAssessmentPolicyInput.value = JSON.stringify(defaultPolicy, null, 2);
  syncTextareaHeight(moduleVersionAssessmentPolicyInput);
}

// ── Module details dialog ──────────────────────────────────────────────────────

const _localeToSuffix = { "en-GB": "enGB", nb: "nb", nn: "nn" };

function openModuleDetailsDialog(triggerBtn) {
  const dialog = document.getElementById("dialogModuleDetails");
  if (!dialog) return;
  _dialogTriggerRef = triggerBtn ?? null;

  const parsedTitle = parseLocalizedSafe(moduleTitleInput.value);
  const parsedDesc = parseLocalizedSafe(moduleDescriptionInput.value);
  const parsedCert = parseLocalizedSafe(moduleCertificationLevelInput.value);

  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    const getString = (parsed) => {
      if (typeof parsed === "object" && parsed !== null) return parsed[locale] ?? "";
      return locale === "en-GB" ? (typeof parsed === "string" ? parsed : "") : "";
    };
    const titleEl = document.getElementById(`dlgMD_title_${sfx}`);
    const descEl = document.getElementById(`dlgMD_desc_${sfx}`);
    const certEl = document.getElementById(`dlgMD_cert_${sfx}`);
    if (titleEl) titleEl.value = getString(parsedTitle);
    if (descEl) descEl.value = getString(parsedDesc);
    if (certEl) certEl.value = getString(parsedCert);
  }

  const validFromEl = document.getElementById("dlgMD_validFrom");
  const validToEl = document.getElementById("dlgMD_validTo");
  if (validFromEl) validFromEl.value = moduleValidFromInput.value || "";
  if (validToEl) validToEl.value = moduleValidToInput.value || "";

  setActiveDialogLocaleTab(dialog, "en-GB");
  dialog.showModal();
  const firstInput = dialog.querySelector("input");
  if (firstInput) firstInput.focus();
}

function applyModuleDetailsDialog() {
  const dialog = document.getElementById("dialogModuleDetails");

  const titles = {}, descs = {}, certs = {};
  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    titles[locale] = document.getElementById(`dlgMD_title_${sfx}`)?.value?.trim() ?? "";
    descs[locale] = document.getElementById(`dlgMD_desc_${sfx}`)?.value?.trim() ?? "";
    certs[locale] = document.getElementById(`dlgMD_cert_${sfx}`)?.value?.trim() ?? "";
  }

  const isMultiLocale = (obj) => Object.values(obj).some(v => v !== obj["en-GB"]);
  const asValue = (obj) => isMultiLocale(obj) ? JSON.stringify(obj, null, 2) : (obj["en-GB"] ?? "");

  moduleTitleInput.value = asValue(titles);
  moduleDescriptionInput.value = asValue(descs);
  moduleCertificationLevelInput.value = asValue(certs);
  moduleValidFromInput.value = document.getElementById("dlgMD_validFrom")?.value ?? "";
  moduleValidToInput.value = document.getElementById("dlgMD_validTo")?.value ?? "";

  dirtyCards.add("moduleDetails");
  syncAllTextareaHeights();
  renderContentCards();
  closeFieldDialog(dialog);
}

function setActiveDialogLocaleTab(dialog, locale) {
  for (const tab of dialog.querySelectorAll(".dialog-locale-tab")) {
    const active = tab.dataset.localeTab === locale;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const pane of dialog.querySelectorAll(".dialog-locale-pane")) {
    pane.classList.toggle("active", pane.dataset.localePane === locale);
  }
}

function closeFieldDialog(dialog) {
  dialog.close();
  const trigger = _dialogTriggerRef;
  _dialogTriggerRef = null;
  if (trigger) trigger.focus();
}

// ── Version details dialog ────────────────────────────────────────────────────

function openVersionDetailsDialog(triggerBtn) {
  const dialog = document.getElementById("dialogVersionDetails");
  if (!dialog) return;
  _dialogTriggerRef = triggerBtn ?? null;

  const parsedTask = parseLocalizedSafe(moduleVersionTaskTextInput.value);
  const parsedConstraints = parseLocalizedSafe(moduleVersionCandidateTaskConstraintsInput?.value ?? "");
  const parsedGuidance = parseLocalizedSafe(moduleVersionGuidanceTextInput.value);

  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    const getString = (parsed) => {
      if (typeof parsed === "object" && parsed !== null) return parsed[locale] ?? "";
      return locale === "en-GB" ? (typeof parsed === "string" ? parsed : "") : "";
    };
    const taskEl = document.getElementById(`dlgVD_task_${sfx}`);
    const constraintsEl = document.getElementById(`dlgVD_constraints_${sfx}`);
    const guidanceEl = document.getElementById(`dlgVD_guidance_${sfx}`);
    if (taskEl) taskEl.value = getString(parsedTask);
    if (constraintsEl) constraintsEl.value = getString(parsedConstraints);
    if (guidanceEl) guidanceEl.value = getString(parsedGuidance);
  }

  setActiveDialogLocaleTab(dialog, "en-GB");
  dialog.showModal();
  const firstTextarea = dialog.querySelector("textarea");
  if (firstTextarea) firstTextarea.focus();
}

function applyVersionDetailsDialog() {
  const dialog = document.getElementById("dialogVersionDetails");

  const tasks = {}, constraints = {}, guidances = {};
  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    tasks[locale] = document.getElementById(`dlgVD_task_${sfx}`)?.value ?? "";
    constraints[locale] = document.getElementById(`dlgVD_constraints_${sfx}`)?.value ?? "";
    guidances[locale] = document.getElementById(`dlgVD_guidance_${sfx}`)?.value ?? "";
  }

  moduleVersionTaskTextInput.value = formatEditorValue(tasks);
  if (moduleVersionCandidateTaskConstraintsInput) moduleVersionCandidateTaskConstraintsInput.value = formatEditorValue(constraints);
  moduleVersionGuidanceTextInput.value = formatEditorValue(guidances);

  dirtyCards.add("versionDetails");
  syncAllTextareaHeights();
  renderContentCards();
  closeFieldDialog(dialog);
}

// ── Assessment policy dialog ──────────────────────────────────────────────────

function openAssessmentPolicyDialog(triggerBtn) {
  const dialog = document.getElementById("dialogAssessmentPolicy");
  if (!dialog) return;
  _dialogTriggerRef = triggerBtn ?? null;

  let policy = {};
  try { policy = JSON.parse(moduleVersionAssessmentPolicyInput.value.trim() || "{}"); } catch { policy = {}; }

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  set("dlgAP_practicalWeight", policy.scoring?.practicalWeight);
  set("dlgAP_mcqWeight", policy.scoring?.mcqWeight);
  set("dlgAP_totalMin", policy.passRules?.totalMin);
  set("dlgAP_practicalMin", policy.passRules?.practicalMinPercent);
  set("dlgAP_mcqMin", policy.passRules?.mcqMinPercent);
  set("dlgAP_borderlineMin", policy.passRules?.borderlineWindow?.min);
  set("dlgAP_borderlineMax", policy.passRules?.borderlineWindow?.max);

  dialog.showModal();
  document.getElementById("dlgAP_practicalWeight")?.focus();
}

function applyAssessmentPolicyDialog() {
  const dialog = document.getElementById("dialogAssessmentPolicy");

  const num = (id) => { const v = parseFloat(document.getElementById(id)?.value ?? ""); return isNaN(v) ? undefined : v; };
  const practicalWeight = num("dlgAP_practicalWeight");
  const mcqWeight = num("dlgAP_mcqWeight");
  const totalMin = num("dlgAP_totalMin");
  const practicalMin = num("dlgAP_practicalMin");
  const mcqMin = num("dlgAP_mcqMin");
  const borderlineMin = num("dlgAP_borderlineMin");
  const borderlineMax = num("dlgAP_borderlineMax");

  if (totalMin === undefined) {
    setMessage(t("adminContent.dialog.assessmentPolicy.errorTotalMinRequired"), "error");
    return;
  }
  if (totalMin < 0 || totalMin > 100) {
    setMessage(t("adminContent.dialog.assessmentPolicy.errorOutOfRange"), "error");
    return;
  }

  const policy = {
    ...(practicalWeight !== undefined || mcqWeight !== undefined ? {
      scoring: {
        ...(practicalWeight !== undefined && { practicalWeight }),
        ...(mcqWeight !== undefined && { mcqWeight }),
      },
    } : {}),
    passRules: {
      totalMin,
      ...(practicalMin !== undefined && { practicalMinPercent: practicalMin }),
      ...(mcqMin !== undefined && { mcqMinPercent: mcqMin }),
      ...(borderlineMin !== undefined && borderlineMax !== undefined ? {
        borderlineWindow: { min: borderlineMin, max: borderlineMax },
      } : {}),
    },
  };

  moduleVersionAssessmentPolicyInput.value = JSON.stringify(policy, null, 2);
  dirtyCards.add("assessmentPolicy");
  syncAllTextareaHeights();
  renderContentCards();
  closeFieldDialog(dialog);
}

// ── Rubric dialog ─────────────────────────────────────────────────────────────

function openRubricDialog(triggerBtn) {
  const dialog = document.getElementById("dialogRubric");
  if (!dialog) return;
  _dialogTriggerRef = triggerBtn ?? null;

  let criteria = {};
  try { criteria = JSON.parse(rubricCriteriaJsonInput.value.trim() || "{}"); } catch { criteria = {}; }
  let scalingRule = {};
  try { scalingRule = JSON.parse(rubricScalingRuleJsonInput.value.trim() || "{}"); } catch { scalingRule = {}; }
  let passRule = {};
  try { passRule = JSON.parse(rubricPassRuleJsonInput.value.trim() || "{}"); } catch { passRule = {}; }

  const list = document.getElementById("dlgRubric_criteriaList");
  list.innerHTML = "";
  const entries = Object.entries(criteria);
  if (entries.length === 0) {
    addRubricCriterionRow("", "", 0.25, "");
  } else {
    for (const [key, val] of entries) {
      addRubricCriterionRow(key, val.title ?? "", val.weight ?? 0.25, val.description ?? "");
    }
  }

  const minScoreEl = document.getElementById("dlgRubric_minScore");
  const criteriaMinEl = document.getElementById("dlgRubric_criteriaMin");
  if (minScoreEl) minScoreEl.value = passRule.minimumScore ?? "";
  if (criteriaMinEl) criteriaMinEl.value = passRule.requireAllCriteriaAbove ?? "";

  const scalingTypeEl = document.getElementById("dlgRubric_scalingType");
  const maxScoreEl = document.getElementById("dlgRubric_maxScore");
  if (scalingTypeEl) scalingTypeEl.value = scalingRule.type ?? "weightedSum";
  if (maxScoreEl) maxScoreEl.value = scalingRule.maxScore ?? 100;

  dialog.showModal();
}

function addRubricCriterionRow(key = "", title = "", weight = 0.25, description = "") {
  const list = document.getElementById("dlgRubric_criteriaList");
  const row = document.createElement("div");
  row.className = "rubric-criterion-row";
  row.dataset.description = description;

  const mkCell = (labelKey, labelDefault) => {
    const cell = document.createElement("div");
    const lbl = document.createElement("label");
    lbl.setAttribute("data-i18n", labelKey);
    lbl.textContent = t(labelKey) || labelDefault;
    cell.appendChild(lbl);
    return cell;
  };

  const keyCell = mkCell("adminContent.dialog.rubric.criterionKey", "ID");
  const keyInput = document.createElement("input");
  keyInput.className = "dlgRubric_key";
  keyInput.value = key;
  keyInput.autocomplete = "off";
  keyInput.placeholder = "myKey";
  keyCell.appendChild(keyInput);

  const titleCell = mkCell("adminContent.dialog.rubric.criterionTitle", "Title");
  const titleInput = document.createElement("input");
  titleInput.className = "dlgRubric_title";
  titleInput.value = title;
  titleInput.autocomplete = "off";
  titleCell.appendChild(titleInput);

  const weightCell = mkCell("adminContent.dialog.rubric.criterionWeight", "Weight");
  const weightInput = document.createElement("input");
  weightInput.className = "dlgRubric_weight";
  weightInput.type = "number";
  weightInput.min = "0";
  weightInput.max = "1";
  weightInput.step = "0.05";
  weightInput.value = weight;
  weightInput.autocomplete = "off";
  weightCell.appendChild(weightInput);

  const removeCell = document.createElement("div");
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "field-dialog-close dlgRubric_remove";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => row.remove());
  removeCell.appendChild(removeBtn);

  row.appendChild(keyCell);
  row.appendChild(titleCell);
  row.appendChild(weightCell);
  row.appendChild(removeCell);
  list.appendChild(row);
}

function applyRubricDialog() {
  const dialog = document.getElementById("dialogRubric");
  const list = document.getElementById("dlgRubric_criteriaList");

  const criteria = {};
  for (const row of list.children) {
    const key = row.querySelector(".dlgRubric_key")?.value.trim() ?? "";
    const title = row.querySelector(".dlgRubric_title")?.value.trim() ?? "";
    const weight = parseFloat(row.querySelector(".dlgRubric_weight")?.value ?? "0");
    const description = row.dataset.description ?? "";

    if (!key || !title) {
      setMessage(t("adminContent.dialog.rubric.errorMissingFields"), "error");
      return;
    }
    if (isNaN(weight) || weight <= 0) {
      setMessage(t("adminContent.dialog.rubric.errorInvalidWeight"), "error");
      return;
    }
    criteria[key] = { title, weight, ...(description ? { description } : {}) };
  }

  if (Object.keys(criteria).length === 0) {
    setMessage(t("adminContent.dialog.rubric.errorNoCriteria"), "error");
    return;
  }

  let existingLevels = [];
  try {
    const existing = JSON.parse(rubricScalingRuleJsonInput.value.trim() || "{}");
    existingLevels = Array.isArray(existing.levels) ? existing.levels : [];
  } catch { /* preserve nothing */ }

  const scalingRule = {
    type: document.getElementById("dlgRubric_scalingType")?.value.trim() || "weightedSum",
    maxScore: parseInt(document.getElementById("dlgRubric_maxScore")?.value ?? "100", 10) || 100,
    ...(existingLevels.length > 0 ? { levels: existingLevels } : {}),
  };

  const minScore = parseInt(document.getElementById("dlgRubric_minScore")?.value ?? "", 10);
  const criteriaMin = parseInt(document.getElementById("dlgRubric_criteriaMin")?.value ?? "", 10);
  const passRule = {
    type: "minimumScore",
    ...(isNaN(minScore) ? {} : { minimumScore: minScore }),
    ...(isNaN(criteriaMin) ? {} : { requireAllCriteriaAbove: criteriaMin }),
  };

  rubricCriteriaJsonInput.value = JSON.stringify(criteria, null, 2);
  rubricScalingRuleJsonInput.value = JSON.stringify(scalingRule, null, 2);
  rubricPassRuleJsonInput.value = JSON.stringify(passRule, null, 2);

  dirtyCards.add("rubric");
  syncAllTextareaHeights();
  renderContentCards();
  closeFieldDialog(dialog);
}

// ── Prompt dialog (#153) ───────────────────────────────────────────────────────

function openPromptDialog(triggerBtn) {
  const dialog = document.getElementById("dialogPrompt");
  if (!dialog) return;
  _dialogTriggerRef = triggerBtn ?? null;

  const parsedSys = parseLocalizedSafe(promptSystemPromptInput.value);
  const parsedUser = parseLocalizedSafe(promptUserPromptTemplateInput.value);

  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    const getString = (parsed) => {
      if (typeof parsed === "object" && parsed !== null) return parsed[locale] ?? "";
      return locale === "en-GB" ? (typeof parsed === "string" ? parsed : "") : "";
    };
    const sysEl = document.getElementById(`dlgPR_sys_${sfx}`);
    const userEl = document.getElementById(`dlgPR_user_${sfx}`);
    if (sysEl) sysEl.value = getString(parsedSys);
    if (userEl) userEl.value = getString(parsedUser);
  }

  const exList = document.getElementById("dlgPR_examplesList");
  exList.innerHTML = "";
  let examples = [];
  try { examples = JSON.parse(promptExamplesJsonInput.value.trim() || "[]"); } catch { examples = []; }
  if (!Array.isArray(examples)) examples = [];
  for (const ex of examples) addPromptExampleRow(ex.input ?? "", ex.output ?? "");

  setActiveDialogLocaleTab(dialog, "en-GB");
  dialog.showModal();
}

function addPromptExampleRow(inputVal = "", outputVal = "") {
  const list = document.getElementById("dlgPR_examplesList");
  const row = document.createElement("div");
  row.className = "prompt-example-row";

  const header = document.createElement("div");
  header.className = "prompt-example-header";
  const numSpan = document.createElement("span");
  numSpan.textContent = `${t("adminContent.dialog.prompt.exampleLabel") || "Example"} ${list.children.length + 1}`;
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "prompt-ex-remove";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => row.remove());
  header.append(numSpan, removeBtn);
  row.appendChild(header);

  const mkTa = (labelKey, labelDefault, value) => {
    const wrap = document.createElement("div");
    const lbl = document.createElement("label");
    lbl.textContent = t(labelKey) || labelDefault;
    const ta = document.createElement("textarea");
    ta.rows = 2;
    ta.value = value;
    wrap.append(lbl, ta);
    return wrap;
  };
  row.appendChild(mkTa("adminContent.dialog.prompt.exampleInput", "Input", inputVal));
  row.appendChild(mkTa("adminContent.dialog.prompt.exampleOutput", "Output", outputVal));
  list.appendChild(row);
}

function applyPromptDialog() {
  const dialog = document.getElementById("dialogPrompt");
  const syss = {}, users = {};
  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    syss[locale] = document.getElementById(`dlgPR_sys_${sfx}`)?.value ?? "";
    users[locale] = document.getElementById(`dlgPR_user_${sfx}`)?.value ?? "";
  }
  promptSystemPromptInput.value = formatEditorValue(syss);
  promptUserPromptTemplateInput.value = formatEditorValue(users);

  const exRows = document.querySelectorAll("#dlgPR_examplesList .prompt-example-row");
  const examples = [];
  for (const row of exRows) {
    const tas = row.querySelectorAll("textarea");
    const inputVal = tas[0]?.value ?? "";
    const outputVal = tas[1]?.value ?? "";
    if (inputVal || outputVal) examples.push({ input: inputVal, output: outputVal });
  }
  promptExamplesJsonInput.value = examples.length > 0 ? JSON.stringify(examples, null, 2) : "";

  dirtyCards.add("prompt");
  syncAllTextareaHeights();
  renderContentCards();
  closeFieldDialog(dialog);
}

// ── MCQ dialog (#148) ──────────────────────────────────────────────────────────

let _mcqQCounter = 0;

function setActiveMcqLocale(locale) {
  const list = document.getElementById("dlgMCQ_questionsList");
  if (!list) return;
  for (const el of list.querySelectorAll("[data-locale]")) {
    el.hidden = el.dataset.locale !== locale;
  }
}

function addMcqOptionRow(qId, container, optLocaleObj, isCorrect) {
  const row = document.createElement("div");
  row.className = "mcq-option-row";

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = `${qId}_correct`;
  if (isCorrect) radio.checked = true;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "mcq-opt-remove";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(radio);
  for (const locale of ["en-GB", "nb", "nn"]) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "mcq-opt-text";
    inp.dataset.locale = locale;
    inp.autocomplete = "off";
    if (locale !== "en-GB") inp.hidden = true;
    const locVal = typeof optLocaleObj === "object" && optLocaleObj !== null
      ? (optLocaleObj[locale] ?? "")
      : (locale === "en-GB" ? (typeof optLocaleObj === "string" ? optLocaleObj : "") : "");
    inp.value = locVal;
    row.appendChild(inp);
  }
  row.appendChild(removeBtn);
  container.appendChild(row);
  return row;
}

function renumberMcqQuestions() {
  const items = document.querySelectorAll("#dlgMCQ_questionsList .mcq-question-item");
  items.forEach((item, i) => {
    const numEl = item.querySelector(".mcq-q-num");
    if (numEl) numEl.textContent = `Q${i + 1}`;
  });
}

function createMcqQuestionEl(question, idx) {
  const qId = `mcqQ_${_mcqQCounter++}`;
  const locales = ["en-GB", "nb", "nn"];

  const item = document.createElement("div");
  item.className = "mcq-question-item";
  item.dataset.qId = qId;

  const header = document.createElement("div");
  header.className = "mcq-q-header";
  const numSpan = document.createElement("span");
  numSpan.className = "mcq-q-num";
  numSpan.textContent = `Q${idx + 1}`;
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "mcq-q-remove";
  removeBtn.setAttribute("aria-label", "Remove question");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => { item.remove(); renumberMcqQuestions(); });
  header.append(numSpan, removeBtn);
  item.appendChild(header);

  const mkSectionLabel = (i18nKey, fallback) => {
    const el = document.createElement("div");
    el.className = "dialog-section-label";
    el.textContent = t(i18nKey) || fallback;
    return el;
  };

  // Stem per locale
  item.appendChild(mkSectionLabel("adminContent.dialog.mcq.stem", "Stem"));
  for (const locale of locales) {
    const wrap = document.createElement("div");
    wrap.dataset.locale = locale;
    if (locale !== "en-GB") wrap.hidden = true;
    const ta = document.createElement("textarea");
    ta.className = "mcq-stem";
    ta.rows = 2;
    ta.value = typeof question?.stem === "object" && question.stem !== null
      ? (question.stem[locale] ?? "")
      : (locale === "en-GB" ? (typeof question?.stem === "string" ? question.stem : "") : "");
    wrap.appendChild(ta);
    item.appendChild(wrap);
  }

  // Options
  item.appendChild(mkSectionLabel("adminContent.dialog.mcq.options", "Options"));
  const optContainer = document.createElement("div");
  optContainer.className = "mcq-options-container";
  item.appendChild(optContainer);

  const addOptBtn = document.createElement("button");
  addOptBtn.type = "button";
  addOptBtn.className = "btn-secondary";
  addOptBtn.style.cssText = "width:auto;font-size:12px;margin-bottom:6px";
  addOptBtn.textContent = `+ ${t("adminContent.dialog.mcq.addOption") || "Add option"}`;
  addOptBtn.addEventListener("click", () => addMcqOptionRow(qId, optContainer, null, false));
  item.appendChild(addOptBtn);

  const options = Array.isArray(question?.options) ? question.options : [];
  const correctAnswer = question?.correctAnswer;
  for (let i = 0; i < options.length; i++) {
    const optLocale = options[i];
    let isCorrect = false;
    if (correctAnswer && typeof correctAnswer === "object") {
      const caEnGB = correctAnswer["en-GB"] ?? "";
      const optEnGB = typeof optLocale === "object" ? (optLocale["en-GB"] ?? "") : (typeof optLocale === "string" ? optLocale : "");
      isCorrect = caEnGB !== "" && caEnGB === optEnGB;
    } else if (typeof correctAnswer === "string" && typeof optLocale === "string") {
      isCorrect = optLocale === correctAnswer;
    }
    addMcqOptionRow(qId, optContainer, optLocale, isCorrect);
  }

  // Rationale per locale
  item.appendChild(mkSectionLabel("adminContent.dialog.mcq.rationale", "Rationale"));
  for (const locale of locales) {
    const wrap = document.createElement("div");
    wrap.dataset.locale = locale;
    if (locale !== "en-GB") wrap.hidden = true;
    const ta = document.createElement("textarea");
    ta.className = "mcq-rationale";
    ta.rows = 2;
    ta.value = typeof question?.rationale === "object" && question.rationale !== null
      ? (question.rationale[locale] ?? "")
      : (locale === "en-GB" ? (typeof question?.rationale === "string" ? question.rationale : "") : "");
    wrap.appendChild(ta);
    item.appendChild(wrap);
  }

  return item;
}

function openMcqDialog(triggerBtn) {
  const dialog = document.getElementById("dialogMcq");
  if (!dialog) return;
  _dialogTriggerRef = triggerBtn ?? null;
  _mcqQCounter = 0;

  const titleEl = document.getElementById("dlgMCQ_setTitle");
  if (titleEl) {
    const rawTitle = mcqSetTitleInput.value ?? "";
    let displayTitle = rawTitle;
    try {
      const parsed = JSON.parse(rawTitle);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        displayTitle = parsed["en-GB"] ?? Object.values(parsed).find((v) => typeof v === "string" && v.trim()) ?? "";
      }
    } catch { /* not JSON, use as-is */ }
    titleEl.value = displayTitle;
  }

  const list = document.getElementById("dlgMCQ_questionsList");
  list.innerHTML = "";
  let questions = [];
  try { questions = JSON.parse(mcqQuestionsJsonInput.value.trim() || "[]"); } catch { questions = []; }
  if (!Array.isArray(questions)) questions = [];
  if (questions.length === 0) {
    list.appendChild(createMcqQuestionEl(null, 0));
  } else {
    questions.forEach((q, i) => list.appendChild(createMcqQuestionEl(q, i)));
  }

  setActiveDialogLocaleTab(dialog, "en-GB");
  setActiveMcqLocale("en-GB");
  dialog.showModal();
}

function applyMcqDialog() {
  const dialog = document.getElementById("dialogMcq");
  const titleEl = document.getElementById("dlgMCQ_setTitle");
  if (titleEl) mcqSetTitleInput.value = titleEl.value;

  const locales = ["en-GB", "nb", "nn"];
  const questions = [];
  for (const qItem of document.querySelectorAll("#dlgMCQ_questionsList .mcq-question-item")) {
    const stem = {}, rationale = {};
    for (const locale of locales) {
      stem[locale] = qItem.querySelector(`[data-locale="${locale}"] .mcq-stem`)?.value ?? "";
      rationale[locale] = qItem.querySelector(`[data-locale="${locale}"] .mcq-rationale`)?.value ?? "";
    }
    const options = [];
    const correctAnswer = {};
    let foundCorrect = false;
    for (const row of qItem.querySelectorAll(".mcq-option-row")) {
      const opt = {};
      for (const locale of locales) {
        opt[locale] = row.querySelector(`.mcq-opt-text[data-locale="${locale}"]`)?.value ?? "";
      }
      options.push(opt);
      if (row.querySelector("input[type='radio']")?.checked && !foundCorrect) {
        for (const locale of locales) correctAnswer[locale] = opt[locale];
        foundCorrect = true;
      }
    }
    if (!foundCorrect && options.length > 0) {
      for (const locale of locales) correctAnswer[locale] = options[0][locale];
    }
    questions.push({ stem, options, correctAnswer, rationale });
  }

  mcqQuestionsJsonInput.value = questions.length > 0 ? JSON.stringify(questions, null, 2) : "";
  dirtyCards.add("mcq");
  syncAllTextareaHeights();
  renderContentCards();
  closeFieldDialog(dialog);
}

// ── Submission schema dialog (#151) ────────────────────────────────────────────

let _ssFieldCounter = 0;

function setActiveSsLocale(locale) {
  const list = document.getElementById("dlgSS_fieldsList");
  if (!list) return;
  for (const el of list.querySelectorAll("[data-locale]")) {
    el.hidden = el.dataset.locale !== locale;
  }
}

function createSubmissionFieldRow(field, idx) {
  const fId = `ssF_${_ssFieldCounter++}`;
  const locales = ["en-GB", "nb", "nn"];
  const singleFieldMode = true;

  const row = document.createElement("div");
  row.className = "ss-field-row";

  const header = document.createElement("div");
  header.className = "ss-field-header";
  const titleSpan = document.createElement("span");
  titleSpan.style.cssText = "font-size:12px;font-weight:700;color:var(--color-meta)";
  titleSpan.textContent = singleFieldMode
    ? (t("adminContent.dialog.submissionSchema.singleFieldTitle") || "Response field")
    : `${t("adminContent.dialog.submissionSchema.fieldLabel") || "Field"} ${idx + 1}`;
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ss-field-remove";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => row.remove());
  removeBtn.hidden = singleFieldMode;
  header.append(titleSpan, removeBtn);
  row.appendChild(header);

  // ID + type row
  const idTypeRow = document.createElement("div");
  idTypeRow.className = "row";
  const idWrap = document.createElement("div");
  const idLabel = document.createElement("label");
  idLabel.textContent = t("adminContent.dialog.submissionSchema.fieldId") || "ID";
  const idInput = document.createElement("input");
  idInput.className = "ss-field-id";
  idInput.autocomplete = "off";
  idInput.value = singleFieldMode ? "response" : (field?.id ?? "");
  idInput.placeholder = "response";
  idInput.disabled = singleFieldMode;
  idWrap.append(idLabel, idInput);
  const typeWrap = document.createElement("div");
  const typeLabel = document.createElement("label");
  typeLabel.textContent = t("adminContent.dialog.submissionSchema.fieldType") || "Type";
  const typeSelect = document.createElement("select");
  typeSelect.className = "ss-field-type";
  for (const opt of singleFieldMode ? ["textarea"] : ["textarea", "text", "number"]) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (field?.type === opt) o.selected = true;
    typeSelect.appendChild(o);
  }
  typeSelect.disabled = singleFieldMode;
  typeWrap.append(typeLabel, typeSelect);
  idTypeRow.append(idWrap, typeWrap);
  row.appendChild(idTypeRow);

  // Required checkbox
  const reqWrap = document.createElement("div");
  const reqLabel = document.createElement("label");
  reqLabel.className = "checkbox-label";
  const reqCheck = document.createElement("input");
  reqCheck.type = "checkbox";
  reqCheck.className = "ss-field-required";
  reqCheck.checked = singleFieldMode ? true : field?.required !== false;
  reqCheck.disabled = singleFieldMode;
  const reqSpan = document.createElement("span");
  reqSpan.textContent = t("adminContent.dialog.submissionSchema.fieldRequired") || "Required";
  reqLabel.append(reqCheck, reqSpan);
  reqWrap.appendChild(reqLabel);
  row.appendChild(reqWrap);

  // Label per locale
  const labelSectionEl = document.createElement("div");
  labelSectionEl.className = "dialog-section-label";
  labelSectionEl.textContent = t("adminContent.dialog.submissionSchema.fieldLabelLocale") || "Label";
  row.appendChild(labelSectionEl);
  const parsedLabel = typeof field?.label === "object" && field.label !== null ? field.label : (typeof field?.label === "string" ? { "en-GB": field.label } : {});
  for (const locale of locales) {
    const wrap = document.createElement("div");
    wrap.dataset.locale = locale;
    if (locale !== "en-GB") wrap.hidden = true;
    const inp = document.createElement("input");
    inp.className = "ss-field-label";
    inp.autocomplete = "off";
    inp.value = parsedLabel[locale] ?? "";
    wrap.appendChild(inp);
    row.appendChild(wrap);
  }

  // Placeholder per locale
  const phSectionEl = document.createElement("div");
  phSectionEl.className = "dialog-section-label";
  phSectionEl.textContent = t("adminContent.dialog.submissionSchema.fieldPlaceholder") || "Placeholder / guidance text (opt.)";
  row.appendChild(phSectionEl);
  const parsedPh = typeof field?.placeholder === "object" && field.placeholder !== null ? field.placeholder : (typeof field?.placeholder === "string" ? { "en-GB": field.placeholder } : {});
  for (const locale of locales) {
    const wrap = document.createElement("div");
    wrap.dataset.locale = locale;
    if (locale !== "en-GB") wrap.hidden = true;
    const inp = document.createElement("input");
    inp.className = "ss-field-ph";
    inp.autocomplete = "off";
    inp.value = parsedPh[locale] ?? "";
    wrap.appendChild(inp);
    row.appendChild(wrap);
  }

  // Default value per locale
  const dvSectionEl = document.createElement("div");
  dvSectionEl.className = "dialog-section-label";
  dvSectionEl.textContent = t("adminContent.dialog.submissionSchema.fieldDefaultValue") || "Default value (opt.)";
  row.appendChild(dvSectionEl);
  const parsedDv = typeof field?.defaultValue === "object" && field.defaultValue !== null ? field.defaultValue : (typeof field?.defaultValue === "string" ? { "en-GB": field.defaultValue } : {});
  for (const locale of locales) {
    const wrap = document.createElement("div");
    wrap.dataset.locale = locale;
    if (locale !== "en-GB") wrap.hidden = true;
    const inp = document.createElement("input");
    inp.className = "ss-field-dv";
    inp.autocomplete = "off";
    inp.value = parsedDv[locale] ?? "";
    wrap.appendChild(inp);
    row.appendChild(wrap);
  }

  return row;
}

function openSubmissionSchemaDialog(triggerBtn) {
  const dialog = document.getElementById("dialogSubmissionSchema");
  if (!dialog) return;
  _dialogTriggerRef = triggerBtn ?? null;
  _ssFieldCounter = 0;

  const list = document.getElementById("dlgSS_fieldsList");
  list.innerHTML = "";
  const schema = normalizeSubmissionSchemaToSingleField(moduleVersionSubmissionSchemaInput.value.trim());
  list.appendChild(createSubmissionFieldRow(schema.fields[0], 0));
  const addFieldBtn = document.getElementById("dlgSS_addField");
  if (addFieldBtn) addFieldBtn.hidden = true;

  setActiveDialogLocaleTab(dialog, "en-GB");
  setActiveSsLocale("en-GB");
  dialog.showModal();
}

function applySubmissionSchemaDialog() {
  const dialog = document.getElementById("dialogSubmissionSchema");
  const locales = ["en-GB", "nb", "nn"];
  const fields = [];

  for (const row of document.querySelectorAll("#dlgSS_fieldsList .ss-field-row")) {
    const id = "response";
    if (!id) {
      setMessage(t("adminContent.dialog.submissionSchema.errorIdRequired") || "All fields must have an ID.", "error");
      return;
    }
    const type = "textarea";
    const required = true;
    const label = {};
    for (const locale of locales) {
      label[locale] = row.querySelector(`[data-locale="${locale}"] .ss-field-label`)?.value ?? "";
    }
    const placeholder = {};
    let hasPh = false;
    for (const locale of locales) {
      const ph = row.querySelector(`[data-locale="${locale}"] .ss-field-ph`)?.value ?? "";
      placeholder[locale] = ph;
      if (ph) hasPh = true;
    }
    const defaultValue = {};
    let hasDv = false;
    for (const locale of locales) {
      const dv = row.querySelector(`[data-locale="${locale}"] .ss-field-dv`)?.value ?? "";
      defaultValue[locale] = dv;
      if (dv) hasDv = true;
    }
    const fieldObj = { id, label, type, required };
    if (hasPh) fieldObj.placeholder = placeholder;
    if (hasDv) fieldObj.defaultValue = defaultValue;
    fields.push(fieldObj);
  }

  moduleVersionSubmissionSchemaInput.value = JSON.stringify(
    normalizeSubmissionSchemaToSingleField({ fields }),
    null,
    2,
  );
  dirtyCards.add("submissionSchema");
  syncAllTextareaHeights();
  renderContentCards();
  closeFieldDialog(dialog);
}

// ── End of card / dialog helpers ───────────────────────────────────────────────

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, async () => {
    try {
      const body = await apiFetch("/api/me", headers);
      log(body);
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

createModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(createModuleButton, async () => {
    try {
      activateModuleStartMode("manual");
      await handleCreateModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

loadModulesButton.addEventListener("click", async () => {
  await runWithBusyButton(loadModulesButton, async () => {
    try {
      activateModuleStartMode("existing");
      await loadModules();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

loadModuleContentButton.addEventListener("click", async () => {
  await runWithBusyButton(loadModuleContentButton, async () => {
    try {
      activateModuleStartMode("existing");
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
      activateModuleStartMode("existing");
      await handleExportSelectedModule();
    } catch (error) {
      setMessage(parseActionableErrorMessage(error));
      throw error;
    }
  });
});

duplicateModuleButton?.addEventListener("click", async () => {
  await runWithBusyButton(duplicateModuleButton, async () => {
    try {
      activateModuleStartMode("existing");
      await handleDuplicateSelectedModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

deleteModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(deleteModuleButton, async () => {
    try {
      await handleDeleteSelectedModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
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
      setMessage(message, "error");
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
      setMessage(message, "error");
      log(message);
    }
  });
});

copyAuthoringPromptButton.addEventListener("click", () => {
  activateModuleStartMode("import");
  promptCertificationLevelSelect.value = "";
  promptMcqCountInput.value = "10";
  if (promptCustomFieldsInput) promptCustomFieldsInput.value = "";
  if (promptFieldResponse) promptFieldResponse.checked = true;
  if (promptFieldReflection) promptFieldReflection.checked = false;
  if (promptFieldPromptExcerpt) promptFieldPromptExcerpt.checked = false;
  authoringPromptDialog.showModal();
});

promptDialogCancel.addEventListener("click", () => {
  authoringPromptDialog.close();
});

authoringPromptDialog.addEventListener("submit", async (e) => {
  e.preventDefault();
  const mcqCount = Math.max(1, Math.min(50, parseInt(promptMcqCountInput.value, 10) || 10));
  let fields;
  try {
    fields = resolvePromptFields();
  } catch {
    setMessage(t("adminContent.errors.invalidJsonPrefix") + " custom fields", "error");
    return;
  }
  const certificationLevel = promptCertificationLevelSelect.value || null;
  authoringPromptDialog.close();
  try {
    const prompt = buildAuthoringPrompt(mcqCount, fields, certificationLevel);
    await copyTextToClipboard(prompt);
    setMessage(t("adminContent.message.authoringPromptCopied"));
    log({ authoringPromptCopied: true, mcqCount, fieldCount: fields.length, certificationLevel });
  } catch (error) {
    const message = parseActionableErrorMessage(error);
    setMessage(message, "error");
    log(message);
  }
});

publishModuleVersionButton.addEventListener("click", async () => {
  await runWithBusyButton(publishModuleVersionButton, async () => {
    try {
      await handlePublishModuleVersion();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

unpublishModuleBtn.addEventListener("click", async () => {
  await runWithBusyButton(unpublishModuleBtn, async () => {
    try {
      await handleUnpublishModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

archiveModuleBtn.addEventListener("click", async () => {
  await runWithBusyButton(archiveModuleBtn, async () => {
    try {
      await handleArchiveModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

selectedModuleIdInput.addEventListener("input", () => {
  activateModuleStartMode("existing");
  setSelectedModule(selectedModuleIdInput.value.trim(), false);
});

moduleDropdown.addEventListener("change", () => {
  activateModuleStartMode("existing");
  setSelectedModule(moduleDropdown.value, true);
  void refreshSelectedModuleStatus().catch(() => {
    selectedModuleStatus = null;
    renderModuleStatus();
  });
});

applyImportDraftButton.addEventListener("click", async () => {
  await runWithBusyButton(applyImportDraftButton, async () => {
    try {
      activateModuleStartMode("import");
      await handleApplyImportDraft(importDraftJsonInput.value);
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

importDraftFileInput.addEventListener("change", async () => {
  try {
    activateModuleStartMode("import");
    const rawValue = await readImportFileContents();
    importDraftJsonInput.value = rawValue;
    await handleApplyImportDraft(rawValue);
  } catch (error) {
    const message = parseActionableErrorMessage(error);
    setMessage(message, "error");
    log(message);
  }
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
});

startModeImportTab?.addEventListener("click", () => {
  activateModuleStartMode("import");
});

startModeManualTab?.addEventListener("click", () => {
  activateModuleStartMode("manual");
});

startModeExistingTab?.addEventListener("click", () => {
  activateModuleStartMode("existing");
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

// ── Content card button wiring ─────────────────────────────────────────────────

document.getElementById("editBtn_moduleDetails")?.addEventListener("click", (e) => {
  openModuleDetailsDialog(e.currentTarget);
});

document.getElementById("editBtn_versionDetails")?.addEventListener("click", (e) => {
  openVersionDetailsDialog(e.currentTarget);
});

document.getElementById("editBtn_rubric")?.addEventListener("click", (e) => {
  openRubricDialog(e.currentTarget);
});

document.getElementById("editBtn_assessmentPolicy")?.addEventListener("click", (e) => {
  openAssessmentPolicyDialog(e.currentTarget);
});

document.getElementById("editBtn_prompt")?.addEventListener("click", (e) => {
  openPromptDialog(e.currentTarget);
});

document.getElementById("editBtn_mcq")?.addEventListener("click", (e) => {
  openMcqDialog(e.currentTarget);
});

document.getElementById("editBtn_submissionSchema")?.addEventListener("click", (e) => {
  openSubmissionSchemaDialog(e.currentTarget);
});

// Scroll-to-section buttons (unimplemented cards)
for (const btn of document.querySelectorAll("[data-card-scroll]")) {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.cardScroll;
    const target = document.getElementById(targetId);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// Module details dialog controls
document.getElementById("dialogModuleDetailsClose")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogModuleDetails"));
});
document.getElementById("dialogModuleDetailsCancel")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogModuleDetails"));
});
document.getElementById("dialogModuleDetailsApply")?.addEventListener("click", () => {
  applyModuleDetailsDialog();
});

// Tab switching inside Module details dialog
document.getElementById("dialogModuleDetails")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".dialog-locale-tab");
  if (!tab) return;
  const locale = tab.dataset.localeTab;
  if (locale) setActiveDialogLocaleTab(document.getElementById("dialogModuleDetails"), locale);
});

// Keyboard: Escape closes open field dialogs (browser native on <dialog> but we return focus)
document.getElementById("dialogModuleDetails")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeFieldDialog(document.getElementById("dialogModuleDetails"));
});

// Version details dialog controls
document.getElementById("dialogVersionDetailsClose")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogVersionDetails"));
});
document.getElementById("dialogVersionDetailsCancel")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogVersionDetails"));
});
document.getElementById("dialogVersionDetailsApply")?.addEventListener("click", () => {
  applyVersionDetailsDialog();
});
document.getElementById("dialogVersionDetails")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".dialog-locale-tab");
  if (!tab) return;
  const locale = tab.dataset.localeTab;
  if (locale) setActiveDialogLocaleTab(document.getElementById("dialogVersionDetails"), locale);
});
document.getElementById("dialogVersionDetails")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeFieldDialog(document.getElementById("dialogVersionDetails"));
});

// Assessment policy dialog controls
document.getElementById("dialogAssessmentPolicyClose")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogAssessmentPolicy"));
});
document.getElementById("dialogAssessmentPolicyCancel")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogAssessmentPolicy"));
});
document.getElementById("dialogAssessmentPolicyApply")?.addEventListener("click", () => {
  applyAssessmentPolicyDialog();
});
document.getElementById("dialogAssessmentPolicy")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeFieldDialog(document.getElementById("dialogAssessmentPolicy"));
});

// Rubric dialog controls
document.getElementById("dialogRubricClose")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogRubric"));
});
document.getElementById("dialogRubricCancel")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogRubric"));
});
document.getElementById("dialogRubricApply")?.addEventListener("click", () => {
  applyRubricDialog();
});
document.getElementById("dlgRubric_addCriterion")?.addEventListener("click", () => {
  addRubricCriterionRow("", "", 0.25, "");
});
document.getElementById("dialogRubric")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeFieldDialog(document.getElementById("dialogRubric"));
});

// Prompt dialog controls
document.getElementById("dialogPromptClose")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogPrompt"));
});
document.getElementById("dialogPromptCancel")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogPrompt"));
});
document.getElementById("dialogPromptApply")?.addEventListener("click", () => {
  applyPromptDialog();
});
document.getElementById("dlgPR_addExample")?.addEventListener("click", () => {
  addPromptExampleRow("", "");
});
document.getElementById("dialogPrompt")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".dialog-locale-tab");
  if (!tab) return;
  const locale = tab.dataset.localeTab;
  if (locale) setActiveDialogLocaleTab(document.getElementById("dialogPrompt"), locale);
});
document.getElementById("dialogPrompt")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeFieldDialog(document.getElementById("dialogPrompt"));
});

// MCQ dialog controls
document.getElementById("dialogMcqClose")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogMcq"));
});
document.getElementById("dialogMcqCancel")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogMcq"));
});
document.getElementById("dialogMcqApply")?.addEventListener("click", () => {
  applyMcqDialog();
});
document.getElementById("dlgMCQ_addQuestion")?.addEventListener("click", () => {
  const list = document.getElementById("dlgMCQ_questionsList");
  const idx = list.querySelectorAll(".mcq-question-item").length;
  list.appendChild(createMcqQuestionEl(null, idx));
  const activeTab = document.querySelector("#dialogMcq .dialog-locale-tab.active");
  setActiveMcqLocale(activeTab?.dataset.localeTab ?? "en-GB");
});
document.getElementById("dialogMcq")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".dialog-locale-tab");
  if (!tab) return;
  const locale = tab.dataset.localeTab;
  if (!locale) return;
  setActiveDialogLocaleTab(document.getElementById("dialogMcq"), locale);
  setActiveMcqLocale(locale);
});
document.getElementById("dialogMcq")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeFieldDialog(document.getElementById("dialogMcq"));
});

// Submission schema dialog controls
document.getElementById("dialogSubmissionSchemaClose")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogSubmissionSchema"));
});
document.getElementById("dialogSubmissionSchemaCancel")?.addEventListener("click", () => {
  closeFieldDialog(document.getElementById("dialogSubmissionSchema"));
});
document.getElementById("dialogSubmissionSchemaApply")?.addEventListener("click", () => {
  applySubmissionSchemaDialog();
});
document.getElementById("dlgSS_addField")?.addEventListener("click", () => {
  // Advanced UI now standardises on one free-text submission field per module.
});
document.getElementById("dialogSubmissionSchema")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".dialog-locale-tab");
  if (!tab) return;
  const locale = tab.dataset.localeTab;
  if (!locale) return;
  setActiveDialogLocaleTab(document.getElementById("dialogSubmissionSchema"), locale);
  setActiveSsLocale(locale);
});
document.getElementById("dialogSubmissionSchema")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeFieldDialog(document.getElementById("dialogSubmissionSchema"));
});

// Publish from content cards section
document.getElementById("publishFromCards")?.addEventListener("click", async () => {
  const btn = document.getElementById("publishFromCards");
  await runWithBusyButton(btn, async () => {
    try {
      await handlePublishModuleVersion();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

// Content cards save + preview
document.getElementById("saveAllCards")?.addEventListener("click", async () => {
  const btn = document.getElementById("saveAllCards");
  await runWithBusyButton(btn, async () => {
    try {
      await handleSaveContentBundle();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

document.getElementById("previewCardsBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("previewCardsBtn");
  await runWithBusyButton(btn, async () => {
    try {
      await handleOpenParticipantPreview();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message, "error");
      log(message);
    }
  });
});

populateLocaleSelect();
setLocale(currentLocale);
setDefaultFormValues();
loadVersion();
loadParticipantConsoleConfig().then(async () => {
  const pathModuleId = window.location.pathname.match(/\/admin-content\/module\/([^/]+)\//)?.[1] ?? null;
  const autoModuleId = pathModuleId ?? new URLSearchParams(location.search).get("moduleId");
  if (autoModuleId) {
    try {
      await loadModules();
      if (modules.some((m) => m.id === autoModuleId)) {
        setSelectedModule(autoModuleId);
        await handleLoadSelectedModuleContent();
        // Apply any working draft carried over from the conversational shell.
        // Must run after populateFormFromModuleExport so it can override form fields.
        applyHandoffFromShell(autoModuleId);
      }
    } catch {
      // non-fatal – editor is still usable without auto-load
    }
  }
});
initBackToChatHandoff();
initAdvancedPreview();
renderModuleDropdown();
renderModuleMeta();
renderModuleStatus();
renderContentCards();
renderCalibrationModuleOptions();
populateCalibrationStatusOptions();
renderCalibrationWorkspace(null);
enablePillArrowNavigation(calibrationStatuses);
syncAllTextareaHeights();

function renderCalibrationModuleOptions() {
  if (!calibrationModuleIdSelect) {
    return;
  }

  const previousValue = calibrationModuleIdSelect.value;
  calibrationModuleIdSelect.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = t("calibration.filters.moduleSelectPlaceholder");
  calibrationModuleIdSelect.appendChild(placeholderOption);

  for (const module of modules) {
    const option = document.createElement("option");
    option.value = module.id;
    option.textContent = `${module.title} (${module.id})`;
    calibrationModuleIdSelect.appendChild(option);
  }

  const preferredValue =
    (previousValue && modules.some((module) => module.id === previousValue) && previousValue) ||
    (selectedModuleId && modules.some((module) => module.id === selectedModuleId) && selectedModuleId) ||
    "";
  calibrationModuleIdSelect.value = preferredValue;
}

function getCheckedPillValues(container) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function enablePillArrowNavigation(container) {
  if (!container) {
    return;
  }

  container.addEventListener("keydown", (event) => {
    const isPrevious = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const isNext = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!isPrevious && !isNext) {
      return;
    }

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    if (checkboxes.length === 0) {
      return;
    }

    const currentIndex = checkboxes.indexOf(document.activeElement);
    if (currentIndex === -1) {
      return;
    }

    event.preventDefault();
    const direction = isPrevious ? -1 : 1;
    const nextIndex = (currentIndex + direction + checkboxes.length) % checkboxes.length;
    checkboxes[nextIndex].focus();
  });
}

function formatNumber(value, maxFractionDigits = 2) {
  if (typeof value !== "number") {
    return "-";
  }

  return new Intl.NumberFormat(currentLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function localizeSubmissionStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`result.statusValue.${normalized || "UNKNOWN"}`);
}

function getSelectedCalibrationStatuses() {
  const selected = getCheckedPillValues(calibrationStatuses);
  if (selected.length > 0) {
    return selected;
  }
  return participantRuntimeConfig?.calibrationWorkspace?.defaults?.statuses ?? ["COMPLETED", "UNDER_REVIEW"];
}

function populateCalibrationStatusOptions() {
  if (!calibrationStatuses) {
    return;
  }

  const selected = new Set(getSelectedCalibrationStatuses());
  calibrationStatuses.innerHTML = "";

  for (const status of allSubmissionStatuses) {
    const optionLabel = document.createElement("label");
    optionLabel.className = "pill-option";

    const optionInput = document.createElement("input");
    optionInput.type = "checkbox";
    optionInput.value = status;
    optionInput.checked = selected.has(status);
    optionInput.setAttribute("aria-label", localizeSubmissionStatus(status));

    const optionText = document.createElement("span");
    optionText.textContent = localizeSubmissionStatus(status);

    optionLabel.appendChild(optionInput);
    optionLabel.appendChild(optionText);
    calibrationStatuses.appendChild(optionLabel);
  }
}

function getConversationUrl() {
  const moduleId = resolveConversationModuleId({ selectedModuleId, search: location.search });
  return buildAdminContentConversationUrl(moduleId, { resumeEditing: true });
}

function updateBackToChatLink() {
  const link = document.getElementById("backToChatLink");
  if (!link) return;
  link.href = getConversationUrl();
}

function navigateToConversation() {
  function doWriteHandoff() {
    const moduleId = resolveConversationModuleId({ selectedModuleId, search: location.search }) || null;
    let mcqQuestions = [];
    try { mcqQuestions = JSON.parse(mcqQuestionsJsonInput?.value || "[]"); } catch { /* leave empty */ }
    writeHandoff({
      moduleId,
      source: "advanced",
      draft: {
        taskText: moduleVersionTaskTextInput?.value ?? "",
        candidateTaskConstraints: moduleVersionCandidateTaskConstraintsInput?.value ?? "",
        guidanceText: moduleVersionGuidanceTextInput?.value ?? "",
        mcqQuestions,
      },
      locale: currentLocale,
    });
  }

  const dest = getConversationUrl();

  if (dirtyCards.size === 0) {
    doWriteHandoff();
    location.href = dest;
    return;
  }

  showUnsavedHandoffDialog().then((choice) => {
    if (choice === "cancel") return;
    if (choice === "save") {
      handleSaveContentBundle().then(() => {
        doWriteHandoff();
        location.href = dest;
      }).catch((error) => {
        setMessage(parseActionableErrorMessage(error), "error");
      });
      return;
    }
    doWriteHandoff();
    location.href = dest;
  });
}

function initBackToChatHandoff() {
  const link = document.getElementById("backToChatLink");
  if (link) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToConversation();
    });
  }
  const modeSwitchConversationBtn = document.getElementById("modeSwitchConversation");
  if (modeSwitchConversationBtn) {
    modeSwitchConversationBtn.addEventListener("click", navigateToConversation);
  }
}

function applyHandoffFromShell(moduleId) {
  const handoff = readAndClearHandoff(moduleId);
  if (!handoff || handoff.source !== "shell" || !handoff.draft) return;

  const { taskText, candidateTaskConstraints, guidanceText, mcqQuestions } = handoff.draft;
  if (!taskText && !candidateTaskConstraints && !guidanceText && !(mcqQuestions?.length > 0)) return;

  if (moduleVersionTaskTextInput) {
    moduleVersionTaskTextInput.value = formatEditorValue(taskText, "");
    dirtyCards.add("versionDetails");
  }
  if (moduleVersionCandidateTaskConstraintsInput && candidateTaskConstraints) {
    moduleVersionCandidateTaskConstraintsInput.value = formatEditorValue(candidateTaskConstraints, "");
    dirtyCards.add("versionDetails");
  }
  if (moduleVersionGuidanceTextInput) {
    moduleVersionGuidanceTextInput.value = formatEditorValue(guidanceText, "");
    dirtyCards.add("versionDetails");
  }
  if (mcqQuestionsJsonInput && Array.isArray(mcqQuestions) && mcqQuestions.length > 0) {
    mcqQuestionsJsonInput.value = JSON.stringify(mcqQuestions, null, 2);
    dirtyCards.add("mcq");
  }

  renderModuleStatus();
  renderContentCards();
  syncAllTextareaHeights();
  showToast(t("handoff.draftRestored"), "info");
}

// ---------------------------------------------------------------------------
// Advanced editor — participant preview panel
// ---------------------------------------------------------------------------

function initAdvancedPreview() {
  const toggleBtn = document.getElementById("advPreviewToggleBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      advPreviewOpen = !advPreviewOpen;
      if (advPreviewOpen && !advPreviewLocale) {
        advPreviewLocale = currentLocale;
      }
      const layout = document.getElementById("advWorkspaceLayout");
      const pane = document.getElementById("advPreviewPane");
      if (layout) layout.classList.toggle("preview-open", advPreviewOpen);
      if (pane) pane.hidden = !advPreviewOpen;
      toggleBtn.classList.toggle("active", advPreviewOpen);
      toggleBtn.setAttribute("aria-pressed", String(advPreviewOpen));
      toggleBtn.textContent = advPreviewOpen
        ? t("advPreview.toggle.close")
        : t("advPreview.toggle.open");
      if (advPreviewOpen) {
        renderAdvancedPreviewLocaleBar();
        renderAdvancedPreview();
      }
    });
  }
}

function renderAdvancedPreviewLocaleBar() {
  const bar = document.getElementById("advPreviewLocaleBar");
  if (!bar || !advPreviewOpen) return;
  const hasModule = !!selectedModuleId;
  bar.classList.toggle("visible", hasModule);
  bar.innerHTML = "";
  if (!hasModule) return;

  for (const loc of supportedLocales) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preview-locale-btn" + (loc === advPreviewLocale ? " active" : "");
    btn.textContent = localeLabels[loc] ?? loc;
    btn.setAttribute("aria-pressed", String(loc === advPreviewLocale));
    btn.addEventListener("click", () => {
      advPreviewLocale = loc;
      renderAdvancedPreviewLocaleBar();
      renderAdvancedPreview();
    });
    bar.appendChild(btn);
  }
}

function renderAdvancedPreview() {
  const content = document.getElementById("advPreviewContent");
  if (!content || !advPreviewOpen) return;
  const locale = advPreviewLocale ?? currentLocale;
  const opts = { locale, t, tf };

  if (!selectedModuleId || !selectedModuleStatus) {
    content.innerHTML = buildPreviewHtml({ emptyText: t("advPreview.empty") }, opts);
    return;
  }

  const view = deriveModuleStatusView(selectedModuleStatus);
  const hasUnsaved = dirtyCards.size > 0;

  // Version chain: prefer live if editing live, else latest draft
  const chain = view
    ? (view.liveChain.length > 0 && !hasUnsaved ? view.liveChain : (view.latestDraftChain.length > 0 ? view.latestDraftChain : view.liveChain))
    : [];
  const versionChain = chain.map((e) => `${e.label} v${e.versionNo}`).join(" · ");

  // Badge
  const badgeClass = hasUnsaved ? "draft" : (view?.badgeClass ?? "shell");
  const badgeText = hasUnsaved
    ? t("shell.draft.unsavedBadge")
    : t(view?.badgeKey ?? "adminContent.status.badge.none");

  // Content from form fields (live values — what the user is currently editing)
  let mcqQuestions = [];
  try { mcqQuestions = JSON.parse(mcqQuestionsJsonInput?.value || "[]"); } catch { /* leave empty */ }

  content.innerHTML = buildPreviewHtml({
    title: moduleTitleInput?.value ?? "",
    description: moduleDescriptionInput?.value ?? "",
    taskText: moduleVersionTaskTextInput?.value ?? "",
    candidateTaskConstraints: moduleVersionCandidateTaskConstraintsInput?.value ?? "",
    guidanceText: moduleVersionGuidanceTextInput?.value ?? "",
    mcqQuestions,
    versionChain,
    badgeClass,
    badgeText,
  }, opts);
}

function getThresholdInputValues() {
  return { totalMin: Number(thresholdTotalMinInput?.value ?? 0) };
}

function renderThresholds(effectiveThresholds) {
  if (!thresholdEditorSection || !thresholdTotalMinInput || !thresholdPublishResult) return;
  thresholdTotalMinInput.value = String(effectiveThresholds.totalMin);
  thresholdPublishResult.textContent = t(
    effectiveThresholds.source === "module_policy"
      ? "calibration.thresholds.source.module"
      : "calibration.thresholds.source.global",
  );
  thresholdEditorSection.style.display = "";
  if (publishThresholdsButton) publishThresholdsButton.disabled = false;
}

function renderCalibrationWorkspace(body) {
  if (!calibrationSignals || !calibrationOutcomesBody || !calibrationAnchorsBody || !thresholdEditorSection) {
    return;
  }

  hideLoading(calibrationSignals);
  hideLoading(calibrationOutcomesBody);
  hideLoading(calibrationAnchorsBody);
  latestCalibrationWorkspaceBody = body;

  if (!body) {
    showEmpty(calibrationSignals, t("calibration.signals.none"));
    calibrationMeta.textContent = "";
    showEmpty(calibrationOutcomesBody, t("calibration.outcomes.empty"), { columns: 7 });
    showEmpty(calibrationAnchorsBody, t("calibration.anchors.empty"), { columns: 5 });
    thresholdEditorSection.style.display = "none";
    if (thresholdPublishResult) {
      thresholdPublishResult.textContent = "";
    }
    return;
  }

  const signals = body.signals ?? {};
  const flags = Array.isArray(signals.flags) ? signals.flags : [];
  const flagLines = flags.length > 0
    ? flags.map((flag) => `- ${flag.code}: ${flag.message} (${formatNumber(flag.actual)} / ${formatNumber(flag.threshold)})`)
    : [t("calibration.flags.none")];
  calibrationSignals.textContent = [
    `${t("calibration.outcomes.title")}: ${signals.outcomeCount ?? 0}`,
    `${t("calibration.signals.passRate")}: ${formatNumber(signals.passRate)}`,
    `${t("calibration.signals.manualReviewRate")}: ${formatNumber(signals.manualReviewRate)}`,
    `${t("calibration.signals.averageTotalScore")}: ${formatNumber(signals.averageTotalScore)}`,
    `${t("calibration.signals.benchmarkPromptTemplates")}: ${signals.benchmarkPromptTemplateCount ?? 0}`,
    `${t("calibration.signals.coveredPromptTemplates")}: ${signals.coveredPromptTemplateCount ?? 0}`,
    `${t("calibration.signals.benchmarkCoverageRate")}: ${formatNumber(signals.benchmarkCoverageRate)}`,
    `${t("calibration.signals.flags")}:`,
    ...flagLines,
  ].join("\n");

  calibrationMeta.textContent = `${t("calibration.meta.loadedPrefix")}: ${body.module?.title ?? "-"} (${body.module?.id ?? "-"})`;

  const outcomes = Array.isArray(body.outcomes) ? body.outcomes : [];
  calibrationOutcomesBody.innerHTML = "";
  if (outcomes.length === 0) {
    showEmpty(calibrationOutcomesBody, t("calibration.outcomes.empty"), { columns: 7 });
  } else {
    for (const outcome of outcomes) {
      const row = document.createElement("tr");
      const values = [
        outcome.submissionId ?? "-",
        formatDateTimeValue(outcome.submittedAt),
        localizeSubmissionStatus(outcome.submissionStatus),
        `${outcome.moduleVersionNo ?? "-"} (${outcome.moduleVersionId ?? "-"})`,
        formatNumber(outcome?.decision?.totalScore),
        outcome?.decision?.passFailTotal === true
          ? t("calibration.value.pass")
          : outcome?.decision?.passFailTotal === false
            ? t("calibration.value.fail")
            : "-",
        outcome?.llm?.manualReviewRecommended === true ? t("calibration.value.yes") : t("calibration.value.no"),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      calibrationOutcomesBody.appendChild(row);
    }
  }

  const anchors = Array.isArray(body.benchmarkAnchors) ? body.benchmarkAnchors : [];
  calibrationAnchorsBody.innerHTML = "";
  if (anchors.length === 0) {
    showEmpty(calibrationAnchorsBody, t("calibration.anchors.empty"), { columns: 5 });
  } else {
    for (const anchor of anchors) {
      const row = document.createElement("tr");
      const values = [
        `${anchor.promptTemplateVersionNo ?? "-"} (${anchor.promptTemplateVersionId ?? "-"})`,
        String(anchor.benchmarkExampleCount ?? "-"),
        anchor.sourcePromptTemplateVersionId ?? "-",
        anchor.sourceModuleVersionId ?? "-",
        formatDateTimeValue(anchor.createdAt),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      calibrationAnchorsBody.appendChild(row);
    }
  }

  if (body.effectiveThresholds) {
    renderThresholds(body.effectiveThresholds);
  }
}

async function loadCalibrationWorkspace() {
  if (!loadCalibrationButton || !calibrationModuleIdSelect) {
    return;
  }

  await runWithBusyButton(loadCalibrationButton, async () => {
    try {
      calibrationMeta.textContent = "";
      showLoading(calibrationSignals, { rows: 6 });
      showLoading(calibrationOutcomesBody, { rows: 4, columns: 7 });
      showLoading(calibrationAnchorsBody, { rows: 3, columns: 5 });

      const moduleId = calibrationModuleIdSelect.value || selectedModuleId;
      if (!moduleId) {
        throw new Error(t("calibration.errors.moduleRequired"));
      }

      const params = new URLSearchParams();
      params.set("moduleId", moduleId);

      const moduleVersionId = calibrationModuleVersionIdInput?.value.trim();
      if (moduleVersionId) {
        params.set("moduleVersionId", moduleVersionId);
      }

      const statuses = getSelectedCalibrationStatuses();
      if (statuses.length > 0) {
        params.set("status", statuses.join(","));
      }

      const limit = Number(calibrationLimitInput?.value);
      if (Number.isFinite(limit) && limit > 0) {
        params.set("limit", String(limit));
      }

      if (calibrationDateFromInput?.value) {
        params.set("dateFrom", calibrationDateFromInput.value);
      }
      if (calibrationDateToInput?.value) {
        params.set("dateTo", calibrationDateToInput.value);
      }

      const body = await apiFetch(`/api/calibration/workspace?${params.toString()}`, headers);
      renderCalibrationWorkspace(body);
      log(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      calibrationMeta.textContent = "";
      showEmpty(calibrationSignals, message);
      showEmpty(calibrationOutcomesBody, message, { columns: 7 });
      showEmpty(calibrationAnchorsBody, message, { columns: 5 });
      log(message);
    }
  });
}

// ============================================================
// Courses tab
// ============================================================

let courses = [];
let courseDialogModules = []; // [{ moduleId, sortOrder, title }]
let editingCourseId = null;
let coursesLoaded = false;

function activateContentTab(tab) {
  const requestedTab = tab === "courses" || tab === "calibration" ? tab : "modules";
  const nextTab = requestedTab === "calibration" && !canAccessCalibrationTab() ? "modules" : requestedTab;
  activeContentTab = nextTab;

  if (modulesTab) {
    modulesTab.hidden = nextTab !== "modules";
  }
  if (coursesTab) {
    coursesTab.hidden = nextTab !== "courses";
  }
  if (calibrationTab) {
    calibrationTab.hidden = nextTab !== "calibration";
  }

  const tabConfig = [
    { id: "modules", button: tabModuler },
    { id: "courses", button: tabKurs },
    { id: "calibration", button: tabKalibrering },
  ];
  for (const entry of tabConfig) {
    const active = entry.id === nextTab;
    entry.button?.classList.toggle("active", active);
    entry.button?.setAttribute("aria-selected", active ? "true" : "false");
  }

  if (nextTab === "courses" && !coursesLoaded) {
    loadCourses().catch((err) => setMessage(parseActionableErrorMessage(err), "error"));
  }

  if (nextTab === "calibration") {
    renderCalibrationModuleOptions();
    renderCalibrationTabVisibility();
  }
}

document.getElementById("tabModuler")?.addEventListener("click", () => activateContentTab("modules"));
document.getElementById("tabKurs")?.addEventListener("click", () => activateContentTab("courses"));
document.getElementById("tabKalibrering")?.addEventListener("click", () => activateContentTab("calibration"));

async function loadCourses() {
  const body = await apiFetch("/api/admin/content/courses", headers);
  courses = Array.isArray(body.courses) ? body.courses : [];
  coursesLoaded = true;
  renderCourseList();
}

function renderCourseList() {
  const list = document.getElementById("courseList");
  if (!list) return;
  if (courses.length === 0) {
    list.innerHTML = `<p class="small" style="color:var(--color-meta)">${escapeHtml(t("adminContent.courses.empty"))}</p>`;
    return;
  }
  list.innerHTML = "";
  for (const course of courses) {
    list.appendChild(buildCourseCard(course));
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildCourseCard(course) {
  const card = document.createElement("div");
  card.className = "course-card";
  const isArchived = Boolean(course.archivedAt);
  const isPublished = Boolean(course.publishedAt) && !isArchived;
  const badgeClass = isArchived ? "shell" : isPublished ? "live" : "draft";
  const badgeText = isArchived
    ? t("adminContent.courses.badge.archived")
    : isPublished
    ? t("adminContent.courses.badge.live")
    : t("adminContent.courses.badge.draft");
  const titleText = escapeHtml(localizeContentValue(course.title) || "—");
  const descText = escapeHtml(localizeContentValue(course.description) || "");
  const moduleCount = typeof course.moduleCount === "number" ? course.moduleCount : 0;
  const countLabel = `${moduleCount} ${t("adminContent.courses.moduleCount")}`;

  card.innerHTML = `
    <div class="course-card-header">
      <div>
        <div class="course-card-title">${titleText}</div>
        ${descText ? `<div class="course-card-meta">${descText}</div>` : ""}
        <div class="course-card-meta">${escapeHtml(countLabel)}</div>
      </div>
      <span class="module-status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
    </div>
    <div class="button-row">
      <button class="btn-secondary" style="width:auto;font-size:13px" data-action="edit-course" data-course-id="${escapeHtml(course.id)}">${escapeHtml(t("adminContent.cards.editBtn"))}</button>
      ${!isPublished && !isArchived ? `<button class="btn-primary" style="width:auto;font-size:13px" data-action="publish-course" data-course-id="${escapeHtml(course.id)}">${escapeHtml(t("adminContent.courses.publishBtn"))}</button>` : ""}
      ${isPublished ? `<button class="btn-danger" style="width:auto;font-size:13px" data-action="archive-course" data-course-id="${escapeHtml(course.id)}">${escapeHtml(t("adminContent.courses.archiveBtn"))}</button>` : ""}
    </div>
  `;
  return card;
}

document.getElementById("courseList")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const courseId = btn.dataset.courseId;
  if (action === "edit-course") {
    await openCourseDialog(courseId);
  } else if (action === "publish-course") {
    await runWithBusyButton(btn, async () => {
      try {
        await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/publish`, headers, { method: "POST" });
        setMessage(t("adminContent.courses.message.published"), "success");
        coursesLoaded = false;
        await loadCourses();
      } catch (error) {
        setMessage(parseActionableErrorMessage(error), "error");
      }
    });
  } else if (action === "archive-course") {
    const courseTitle = localizeContentValue(courses.find((c) => c.id === courseId)?.title) || courseId;
    if (!confirm(t("adminContent.courses.confirm.archive").replace("{course}", courseTitle))) return;
    await runWithBusyButton(btn, async () => {
      try {
        await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/archive`, headers, { method: "POST" });
        setMessage(t("adminContent.courses.message.archived"), "success");
        coursesLoaded = false;
        await loadCourses();
      } catch (error) {
        setMessage(parseActionableErrorMessage(error), "error");
      }
    });
  }
});

document.getElementById("createCourseBtn")?.addEventListener("click", () => openCourseDialog(null));

async function openCourseDialog(courseId) {
  editingCourseId = courseId ?? null;
  const dialog = document.getElementById("dialogCourse");
  if (!dialog) return;

  // Reset inputs
  for (const suffix of ["enGB", "nb", "nn"]) {
    const titleEl = document.getElementById(`dlgCourse_title_${suffix}`);
    const descEl = document.getElementById(`dlgCourse_desc_${suffix}`);
    if (titleEl) titleEl.value = "";
    if (descEl) descEl.value = "";
  }
  const certEl = document.getElementById("dlgCourse_certLevel");
  if (certEl) certEl.value = "";
  courseDialogModules = [];

  if (courseId) {
    try {
      const body = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}`, headers);
      const course = body.course;
      if (course) {
        fillLocaleInputs("dlgCourse_title", course.title);
        fillLocaleInputs("dlgCourse_desc", course.description);
        if (certEl && course.certificationLevel) {
          const cv = course.certificationLevel;
          certEl.value = typeof cv === "object" ? (cv["en-GB"] ?? Object.values(cv)[0] ?? "") : (cv ?? "");
        }
        courseDialogModules = Array.isArray(course.modules)
          ? course.modules
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((m) => ({
                moduleId: m.moduleId,
                sortOrder: m.sortOrder,
                title: localizeContentValue(m.moduleTitle) || m.moduleId,
              }))
          : [];
      }
    } catch (error) {
      setMessage(parseActionableErrorMessage(error), "error");
      return;
    }
  }

  const titleEl2 = document.getElementById("dialogCourseTitle");
  if (titleEl2) {
    titleEl2.textContent = courseId
      ? t("adminContent.courses.dialog.editTitle")
      : t("adminContent.courses.dialog.createTitle");
  }

  populateCourseModuleDropdown();
  renderCourseDialogModuleList();
  setActiveDialogLocaleTab(dialog, "en-GB");
  dialog.showModal();
}

function fillLocaleInputs(idPrefix, value) {
  const val = value ?? "";
  let enGB = "", nb = "", nn = "";
  if (typeof val === "object" && val !== null) {
    enGB = val["en-GB"] ?? "";
    nb = val["nb"] ?? "";
    nn = val["nn"] ?? "";
  } else {
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === "object") {
        enGB = parsed["en-GB"] ?? "";
        nb = parsed["nb"] ?? "";
        nn = parsed["nn"] ?? "";
      } else {
        enGB = val;
      }
    } catch {
      enGB = val;
    }
  }
  const elEnGB = document.getElementById(`${idPrefix}_enGB`);
  const elNb = document.getElementById(`${idPrefix}_nb`);
  const elNn = document.getElementById(`${idPrefix}_nn`);
  if (elEnGB) elEnGB.value = enGB;
  if (elNb) elNb.value = nb;
  if (elNn) elNn.value = nn;
}

function populateCourseModuleDropdown() {
  const select = document.getElementById("dlgCourse_moduleDropdown");
  if (!select) return;
  const selectedIds = new Set(courseDialogModules.map((m) => m.moduleId));
  select.innerHTML = `<option value="">— ${escapeHtml(t("adminContent.courses.dialog.selectModule"))} —</option>`;
  for (const m of modules) {
    if (!selectedIds.has(m.id)) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.title || m.id;
      select.appendChild(opt);
    }
  }
}

function renderCourseDialogModuleList() {
  const list = document.getElementById("dlgCourse_moduleList");
  if (!list) return;
  if (courseDialogModules.length === 0) {
    list.innerHTML = `<p class="small" style="color:var(--color-meta);margin-bottom:4px">${escapeHtml(t("adminContent.courses.dialog.noModules"))}</p>`;
    return;
  }
  list.innerHTML = "";
  courseDialogModules.forEach((m, idx) => {
    const row = document.createElement("div");
    row.className = "course-module-order-row";
    row.innerHTML = `
      <span class="course-module-order-label">${escapeHtml(m.title || m.moduleId)}</span>
      <div class="course-module-order-btns">
        <button type="button" class="course-module-order-btn" data-move="up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="course-module-order-btn" data-move="down" data-idx="${idx}" ${idx === courseDialogModules.length - 1 ? "disabled" : ""}>▼</button>
        <button type="button" class="course-module-order-remove" data-remove="${idx}">×</button>
      </div>
    `;
    list.appendChild(row);
  });
}

document.getElementById("dlgCourse_moduleList")?.addEventListener("click", (e) => {
  const moveBtn = e.target.closest("[data-move]");
  if (moveBtn) {
    const idx = parseInt(moveBtn.dataset.idx, 10);
    const dir = moveBtn.dataset.move;
    if (dir === "up" && idx > 0) {
      [courseDialogModules[idx - 1], courseDialogModules[idx]] = [courseDialogModules[idx], courseDialogModules[idx - 1]];
    } else if (dir === "down" && idx < courseDialogModules.length - 1) {
      [courseDialogModules[idx + 1], courseDialogModules[idx]] = [courseDialogModules[idx], courseDialogModules[idx + 1]];
    }
    renderCourseDialogModuleList();
    populateCourseModuleDropdown();
    return;
  }
  const removeBtn = e.target.closest("[data-remove]");
  if (removeBtn) {
    const idx = parseInt(removeBtn.dataset.remove, 10);
    courseDialogModules.splice(idx, 1);
    renderCourseDialogModuleList();
    populateCourseModuleDropdown();
  }
});

document.getElementById("dlgCourse_addModuleBtn")?.addEventListener("click", () => {
  const select = document.getElementById("dlgCourse_moduleDropdown");
  const moduleId = select?.value;
  if (!moduleId) return;
  const moduleObj = modules.find((m) => m.id === moduleId);
  courseDialogModules.push({
    moduleId,
    sortOrder: courseDialogModules.length + 1,
    title: moduleObj?.title || moduleId,
  });
  renderCourseDialogModuleList();
  populateCourseModuleDropdown();
});

document.getElementById("dialogCourseCancel")?.addEventListener("click", () => {
  document.getElementById("dialogCourse")?.close();
});
document.getElementById("dialogCourse")?.addEventListener("cancel", (e) => {
  e.preventDefault();
  document.getElementById("dialogCourse")?.close();
});
document.getElementById("dialogCourse")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".dialog-locale-tab");
  if (!tab) return;
  const locale = tab.dataset.localeTab;
  if (locale) setActiveDialogLocaleTab(document.getElementById("dialogCourse"), locale);
});

document.getElementById("dialogCourseSave")?.addEventListener("click", async () => {
  const btn = document.getElementById("dialogCourseSave");
  await runWithBusyButton(btn, async () => {
    try {
      await saveCourseDialog();
    } catch (error) {
      setMessage(parseActionableErrorMessage(error), "error");
    }
  });
});

async function saveCourseDialog() {
  const titleEnGB = document.getElementById("dlgCourse_title_enGB")?.value.trim() ?? "";
  const titleNb = document.getElementById("dlgCourse_title_nb")?.value.trim() ?? "";
  const titleNn = document.getElementById("dlgCourse_title_nn")?.value.trim() ?? "";
  if (!titleEnGB) {
    throw new Error(t("adminContent.courses.errors.titleRequired"));
  }
  const title = { "en-GB": titleEnGB, nb: titleNb || titleEnGB, nn: titleNn || titleEnGB };

  const descEnGB = document.getElementById("dlgCourse_desc_enGB")?.value.trim() ?? "";
  const descNb = document.getElementById("dlgCourse_desc_nb")?.value.trim() ?? "";
  const descNn = document.getElementById("dlgCourse_desc_nn")?.value.trim() ?? "";
  const description = descEnGB ? { "en-GB": descEnGB, nb: descNb || descEnGB, nn: descNn || descEnGB } : undefined;

  const certLevel = document.getElementById("dlgCourse_certLevel")?.value.trim() || undefined;
  const payload = { title, description, certificationLevel: certLevel };

  let courseId = editingCourseId;
  if (courseId) {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}`, headers, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } else {
    const body = await apiFetch("/api/admin/content/courses", headers, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    courseId = body.course?.id;
  }

  if (courseId) {
    const modulePayload = {
      modules: courseDialogModules.map((m, idx) => ({ moduleId: m.moduleId, sortOrder: idx + 1 })),
    };
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/modules`, headers, {
      method: "PUT",
      body: JSON.stringify(modulePayload),
    });
  }

  setMessage(
    editingCourseId ? t("adminContent.courses.message.updated") : t("adminContent.courses.message.created"),
    "success",
  );
  document.getElementById("dialogCourse")?.close();
  coursesLoaded = false;
  await loadCourses();
}
