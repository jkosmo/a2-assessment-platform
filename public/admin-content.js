import { localeLabels, supportedLocales, translations } from "/static/i18n/admin-content-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { showToast } from "/static/toast.js";
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
const authoringPromptDialog = document.getElementById("authoringPromptDialog");
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

const PARTICIPANT_PREVIEW_STORAGE_KEY = "adminContent.participantPreview.v1";
function buildAuthoringPrompt(mcqCount, fields) {
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
- rubric.criteria, rubric.scalingRule, and rubric.passRule must be valid JSON objects.
- moduleVersion.taskText must ask the participant to explain, compare, or interpret concepts from the source text itself. Do not require application to a fictional or external example unless the source explicitly supports that framing.
- moduleVersion.guidanceText must describe what a good submission should include, based only on what the source actually covers.
- validFrom and validTo should be empty strings unless a date range is explicitly provided.
- Generate exactly ${mcqCount} MCQ question${mcqCount !== 1 ? "s" : ""} in mcqSet.questions.${schemaNote}

First, identify the core concepts explicitly supported by the source material.
Then build the module using only those concepts.
Exclude any term, framing device, or task pattern not grounded in the source.

Grounding constraints:
- Use the source material as the sole content authority.
- Use only concepts, distinctions, and claims that are explicitly present in or directly inferable from the source material.
- Do not import external theory, pedagogical formats, or generic assessment patterns unless explicitly supported by the source.
- Do not introduce scenario-based, case-based, or role-based tasks unless the source itself supports that framing.
- Do not introduce nouns such as "scenario", "case", "situation", or "applied example" unless they appear in the source.
- Every substantive concept in taskText, guidanceText, promptTemplate, and MCQ rationales must be traceable to the source material.
- If a useful assessment device is not source-grounded, leave it out rather than inventing supporting context.

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
let dirtyCards = new Set();
let _dialogTriggerRef = null;

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
  renderModuleMeta();
  renderModuleStatus();
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
    moduleVersionGuidanceText: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.guidanceText, "")),
    moduleVersionSubmissionSchema: normalizeSnapshotValue(formatEditorValue(draft?.moduleVersion?.submissionSchema, "")),
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
    versionsCountsChain: [
      moduleVersions.length > 0 ? { label: "Module", versionNo: moduleVersions.length } : null,
      rubricVersions.length > 0 ? { label: "Rubric", versionNo: rubricVersions.length } : null,
      promptTemplateVersions.length > 0 ? { label: "Prompt", versionNo: promptTemplateVersions.length } : null,
      mcqSetVersions.length > 0 ? { label: "MCQ", versionNo: mcqSetVersions.length } : null,
    ].filter(Boolean),
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
  moduleVersionSubmissionSchemaInput.value = formatEditorValue(draft?.moduleVersion?.submissionSchemaJson ?? draft?.moduleVersion?.submissionSchema, "");
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
  moduleVersionGuidanceTextInput.value = savedVersionFields.moduleVersionGuidanceText;
  moduleVersionSubmissionSchemaInput.value = savedVersionFields.moduleVersionSubmissionSchema;
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
  const rawAssessmentPolicy = moduleVersionAssessmentPolicyInput.value.trim();
  const assessmentPolicy = rawAssessmentPolicy
    ? parseJsonField(rawAssessmentPolicy, "adminContent.moduleVersion.assessmentPolicyJson")
    : undefined;
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

async function handleSaveContentBundle() {
  const rubricBody = await handleCreateRubricVersion({ silent: true });
  const promptBody = await handleCreatePromptTemplateVersion({ silent: true });
  const mcqBody = await handleCreateMcqSetVersion({ silent: true });
  const moduleVersionBody = await handleCreateModuleVersion({ silent: true });

  setMessage(t("adminContent.message.bundleSaved"), "success");
  log({
    rubricVersion: rubricBody.rubricVersion,
    promptTemplateVersion: promptBody.promptTemplateVersion,
    mcqSetVersion: mcqBody.mcqSetVersion,
    moduleVersion: moduleVersionBody.moduleVersion,
  });
  await refreshSelectedModuleStatus();
  for (const key of ["rubric", "prompt", "mcq", "versionDetails", "assessmentPolicy", "submissionSchema"]) {
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
  const customJson = promptCustomFieldsInput.value.trim();
  if (customJson) {
    const parsed = JSON.parse(customJson);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.fields) ? parsed.fields : [];
  }
  const fields = [];
  if (promptFieldResponse.checked) {
    fields.push({ id: "response", label: { "en-GB": "Your response", "nb": "Ditt svar", "nn": "Ditt svar" }, type: "textarea", required: true, defaultValue: { "en-GB": "", "nb": "", "nn": "" } });
  }
  if (promptFieldReflection.checked) {
    fields.push({ id: "reflection", label: { "en-GB": "Reflection", "nb": "Refleksjon", "nn": "Refleksjon" }, type: "textarea", required: true, defaultValue: { "en-GB": "", "nb": "", "nn": "" } });
  }
  if (promptFieldPromptExcerpt.checked) {
    fields.push({ id: "promptExcerpt", label: { "en-GB": "Supporting material", "nb": "Støttemateriale", "nn": "Støttemateriell" }, type: "text", required: false, defaultValue: { "en-GB": "", "nb": "", "nn": "" } });
  }
  return fields;
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
  setCardSummary("contentCard_submissionSchema_summary", getJsonSummary(moduleVersionSubmissionSchemaInput.value));
  setCardUnsaved("contentCard_submissionSchema_unsaved", dirtyCards.has("submissionSchema"));

  // Show/hide save button row
  const actionsEl = document.getElementById("contentCardsActions");
  if (actionsEl) actionsEl.style.display = selectedModuleId ? "" : "none";

  // Show publish button only when a saved module version ID is available
  const publishFromCardsBtn = document.getElementById("publishFromCards");
  if (publishFromCardsBtn) {
    publishFromCardsBtn.hidden = !publishModuleVersionIdInput.value.trim();
  }
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
  const parsedGuidance = parseLocalizedSafe(moduleVersionGuidanceTextInput.value);

  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    const getString = (parsed) => {
      if (typeof parsed === "object" && parsed !== null) return parsed[locale] ?? "";
      return locale === "en-GB" ? (typeof parsed === "string" ? parsed : "") : "";
    };
    const taskEl = document.getElementById(`dlgVD_task_${sfx}`);
    const guidanceEl = document.getElementById(`dlgVD_guidance_${sfx}`);
    if (taskEl) taskEl.value = getString(parsedTask);
    if (guidanceEl) guidanceEl.value = getString(parsedGuidance);
  }

  setActiveDialogLocaleTab(dialog, "en-GB");
  dialog.showModal();
  const firstTextarea = dialog.querySelector("textarea");
  if (firstTextarea) firstTextarea.focus();
}

function applyVersionDetailsDialog() {
  const dialog = document.getElementById("dialogVersionDetails");

  const tasks = {}, guidances = {};
  for (const locale of ["en-GB", "nb", "nn"]) {
    const sfx = _localeToSuffix[locale];
    tasks[locale] = document.getElementById(`dlgVD_task_${sfx}`)?.value ?? "";
    guidances[locale] = document.getElementById(`dlgVD_guidance_${sfx}`)?.value ?? "";
  }

  moduleVersionTaskTextInput.value = formatEditorValue(tasks);
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

  const row = document.createElement("div");
  row.className = "ss-field-row";

  const header = document.createElement("div");
  header.className = "ss-field-header";
  const titleSpan = document.createElement("span");
  titleSpan.style.cssText = "font-size:12px;font-weight:700;color:var(--color-meta)";
  titleSpan.textContent = `${t("adminContent.dialog.submissionSchema.fieldLabel") || "Field"} ${idx + 1}`;
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ss-field-remove";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => row.remove());
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
  idInput.value = field?.id ?? "";
  idInput.placeholder = "response";
  idWrap.append(idLabel, idInput);
  const typeWrap = document.createElement("div");
  const typeLabel = document.createElement("label");
  typeLabel.textContent = t("adminContent.dialog.submissionSchema.fieldType") || "Type";
  const typeSelect = document.createElement("select");
  typeSelect.className = "ss-field-type";
  for (const opt of ["textarea", "text", "number"]) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (field?.type === opt) o.selected = true;
    typeSelect.appendChild(o);
  }
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
  reqCheck.checked = field?.required !== false;
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
  let schema = {};
  try { schema = JSON.parse(moduleVersionSubmissionSchemaInput.value.trim() || "{}"); } catch { schema = {}; }
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  if (fields.length === 0) {
    list.appendChild(createSubmissionFieldRow({ id: "", type: "textarea", required: true }, 0));
  } else {
    fields.forEach((f, i) => list.appendChild(createSubmissionFieldRow(f, i)));
  }

  setActiveDialogLocaleTab(dialog, "en-GB");
  setActiveSsLocale("en-GB");
  dialog.showModal();
}

function applySubmissionSchemaDialog() {
  const dialog = document.getElementById("dialogSubmissionSchema");
  const locales = ["en-GB", "nb", "nn"];
  const fields = [];

  for (const row of document.querySelectorAll("#dlgSS_fieldsList .ss-field-row")) {
    const id = row.querySelector(".ss-field-id")?.value.trim() ?? "";
    if (!id) {
      setMessage(t("adminContent.dialog.submissionSchema.errorIdRequired") || "All fields must have an ID.", "error");
      return;
    }
    const type = row.querySelector(".ss-field-type")?.value ?? "textarea";
    const required = row.querySelector(".ss-field-required")?.checked ?? true;
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

  moduleVersionSubmissionSchemaInput.value = fields.length > 0 ? JSON.stringify({ fields }, null, 2) : "";
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
  promptMcqCountInput.value = "10";
  promptCustomFieldsInput.value = "";
  promptFieldResponse.checked = true;
  promptFieldReflection.checked = true;
  promptFieldPromptExcerpt.checked = true;
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
  authoringPromptDialog.close();
  try {
    const prompt = buildAuthoringPrompt(mcqCount, fields);
    await copyTextToClipboard(prompt);
    setMessage(t("adminContent.message.authoringPromptCopied"));
    log({ authoringPromptCopied: true, mcqCount, fieldCount: fields.length });
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
      setMessage(message, "error");
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
    setMessage(message, "error");
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
  const list = document.getElementById("dlgSS_fieldsList");
  const idx = list.querySelectorAll(".ss-field-row").length;
  list.appendChild(createSubmissionFieldRow({ id: "", type: "textarea", required: true }, idx));
  const activeTab = document.querySelector("#dialogSubmissionSchema .dialog-locale-tab.active");
  setActiveSsLocale(activeTab?.dataset.localeTab ?? "en-GB");
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
loadParticipantConsoleConfig();
renderModuleDropdown();
renderModuleMeta();
renderModuleStatus();
renderContentCards();
syncAllTextareaHeights();
