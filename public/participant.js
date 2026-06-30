import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { resolveInitialLocale } from "/static/i18n-locale.js";
import { createNumberFormatter, createDateTimeFormatter } from "/static/format-display.js";
const formatDateTime = createDateTimeFormatter(() => currentLocale);
const formatNumber = createNumberFormatter(() => currentLocale);
import { escapeHtml as escapeHtmlP } from "/static/html-escape.js";
import { mountDiscussionPanel } from "/static/discussion-panel.js";
import { localeLabels, supportedLocales, translations } from "/static/i18n/participant-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, fetchQueueCounts, applyNavReviewBadge, hydrateContentAssetImages } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { showToast } from "/static/toast.js";
import { setHidden } from "/static/dom-visibility.js";
import {
  buildModuleCardViewModels,
  deriveParticipantFlowGateState,
  findMatchingPreset,
  parseDraftEnvelope,
  pruneExpiredModuleDrafts,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
  resolveSelectedModule,
  upsertModuleDraft,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
const outputStatus = document.getElementById("outputStatus");
const debugOutputSection = document.getElementById("debugOutputSection");
const previewModeBanner = document.getElementById("previewModeBanner");
const previewModeMessage = document.getElementById("previewModeMessage");
const moduleList = document.getElementById("moduleList");
const mcqQuestions = document.getElementById("mcqQuestions");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");

const selectedModuleIdInput = document.getElementById("selectedModuleId");
const selectedModuleDisplay = document.getElementById("selectedModuleDisplay");
const selectedModuleTitle = document.getElementById("selectedModuleTitle");
const selectedModuleDescription = document.getElementById("selectedModuleDescription");
const selectedModuleStatus = document.getElementById("selectedModuleStatus");
const selectedModuleBrief = document.getElementById("selectedModuleBrief");
const selectedModuleTaskText = document.getElementById("selectedModuleTaskText");
const selectedModuleCandidateConstraintsSection = document.getElementById("selectedModuleCandidateConstraintsSection");
const selectedModuleCandidateTaskConstraints = document.getElementById("selectedModuleCandidateTaskConstraints");
const submissionIdLabel = document.getElementById("submissionId");
const attemptIdLabel = document.getElementById("attemptId");
const appealIdLabel = document.getElementById("appealId");
const appVersionLabel = document.getElementById("appVersion");
const resultSummary = document.getElementById("resultSummary");
const historySummary = document.getElementById("historySummary");
const draftStatus = document.getElementById("draftStatus");
const draftBrowserNote = document.getElementById("draftBrowserNote");
const loadMeButton = document.getElementById("loadMe");
const loadModulesButton = document.getElementById("loadModules");
const createSubmissionButton = document.getElementById("createSubmission");
const submitMcqButton = document.getElementById("submitMcq");
const loadHistoryButton = document.getElementById("loadHistory");
const submissionFieldsContainer = document.getElementById("submissionFields");
const ackCheckbox = document.getElementById("ack");
const appealReasonInput = document.getElementById("appealReason");
const assessmentSection = document.getElementById("assessmentSection");
const appealSection = document.getElementById("appealSection");
const submissionSection = document.getElementById("submissionSection");
const mcqSection = document.getElementById("mcqSection");
const moduleSelectionHint = document.getElementById("moduleSelectionHint");
const submissionValidationHint = document.getElementById("submissionValidationHint");
const assessmentGateHint = document.getElementById("assessmentGateHint");
const checkAssessmentHint = document.getElementById("checkAssessmentHint");
const assessmentProgressStatus = document.getElementById("assessmentProgressStatus");
const assessmentProgressSeconds = document.getElementById("assessmentProgressSeconds");
const appealGateHint = document.getElementById("appealGateHint");
const appealSubmittedStatus = document.getElementById("appealSubmittedStatus");
const appealNextSteps = document.getElementById("appealNextSteps");
const queueAssessmentButton = document.getElementById("queueAssessment");
const checkAssessmentButton = document.getElementById("checkAssessment");
const checkResultButton = document.getElementById("checkResult");
const createAppealButton = document.getElementById("createAppeal");
const resetSubmissionFlowButton = document.getElementById("resetSubmissionFlow");
const historySection = document.getElementById("historySection");
const submissionAckLabel = ackCheckbox?.closest("label") ?? null;
const submissionIdRow = submissionIdLabel?.parentElement ?? null;

const submissionValidationTargets = [
  { fieldElement: selectedModuleDisplay, hintElement: moduleSelectionHint },
  { fieldElement: ackCheckbox },
];
const rawDebugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";
const previewModeEnabled = new URLSearchParams(window.location.search).get("preview") === "1";
const PARTICIPANT_PREVIEW_STORAGE_KEY = "adminContent.participantPreview.v1";
const COMPLETED_MODULE_STATUSES = new Set(["COMPLETED"]);

let currentQuestions = [];
let currentLocale = resolveInitialLocale(supportedLocales);
let latestResult = null;
// #549: ensures the pass celebration (confetti + banner) fires once per submission, not on every
// result poll. Reset when the module context changes / a new submission starts.
let celebrationShown = false;
let latestHistory = null;
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: { items: [] },
  drafts: {
    storageKey: "participant.moduleDrafts.v1",
    ttlMinutes: 240,
    maxModules: 30,
  },
  appealWorkspace: {
    availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: ["OPEN", "IN_REVIEW"],
  },
  flow: {
    autoStartAfterMcq: true,
    pollIntervalSeconds: 2,
    maxWaitSeconds: 90,
  },
  identityDefaults: {
    participant: {
      userId: "participant-1",
      email: "participant@company.com",
      name: "Platform Participant",
      department: "Consulting",
      roles: ["PARTICIPANT"],
    },
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
let loadedModules = [];
let hasLoadedModules = false;
let selectedModuleId = "";
let autosaveTimer = null;
let flowState = {
  hasSubmission: false,
  hasMcqSubmission: false,
  assessmentQueued: false,
  resultStatus: null,
  resultPassFail: null,
};
let latestAppeal = null;
let assessmentProgressKey = "assessment.progress.idle";
let assessmentProgressDetailKey = "";
let assessmentProgressDetailCountdown = null;
let autoAssessmentTicker = null;
let autoAssessmentSubmissionId = "";
let autoAssessmentElapsedSeconds = 0;
let autoAssessmentNextPollInSeconds = 0;
let autoAssessmentRequestInFlight = false;

const defaultFieldBindings = [
  { id: "appealReason", key: "defaults.appealReason" },
];

const DEFAULT_SUBMISSION_FIELDS = [
  { id: "response", label: "Your answer", labelKey: "submission.rawText", type: "textarea", rows: 24, required: true },
];

let currentSubmissionFields = DEFAULT_SUBMISSION_FIELDS;


function t(key) {
  return translations[currentLocale][key] ?? translations["en-GB"][key] ?? key;
}

function tForLocale(locale, key) {
  return translations[locale]?.[key] ?? translations["en-GB"][key] ?? key;
}

function isLocaleObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localizePreviewText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (!isLocaleObject(value)) {
    return "";
  }

  const localized =
    value[currentLocale] ??
    value["en-GB"] ??
    Object.values(value).find((entry) => typeof entry === "string" && entry.trim().length > 0);

  return typeof localized === "string" ? localized : "";
}

function shouldShowModuleDebugMeta() {
  return isRawDebugEnabled();
}

function normalizePreviewQuestions(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions
    .map((question, index) => {
      if (!question || typeof question !== "object") {
        return null;
      }

      const stem = localizePreviewText(question.stem).trim();
      const options = Array.isArray(question.options)
        ? question.options
          .map((option) => localizePreviewText(option).trim())
          .filter(Boolean)
        : [];

      if (!stem || options.length === 0) {
        return null;
      }

      return {
        id: typeof question.id === "string" && question.id.trim().length > 0 ? question.id : `preview-q-${index + 1}`,
        stem,
        options,
      };
    })
    .filter(Boolean);
}

function readParticipantPreviewPayload() {
  if (!previewModeEnabled) {
    return null;
  }

  const rawValue = localStorage.getItem(PARTICIPANT_PREVIEW_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildPreviewModuleFromPayload(payload) {
  const previewModule = payload?.module;
  if (!previewModule || typeof previewModule !== "object") {
    return null;
  }

  const title = localizePreviewText(previewModule.title).trim();
  if (!title) {
    return null;
  }

  return {
    id:
      typeof previewModule.id === "string" && previewModule.id.trim().length > 0
        ? previewModule.id.trim()
        : "draft-preview",
    title,
    description: localizePreviewText(previewModule.description).trim(),
    taskText: localizePreviewText(previewModule.taskText).trim(),
    assessorExpectedContent: localizePreviewText(previewModule.assessorExpectedContent).trim(),
    candidateTaskConstraints: localizePreviewText(previewModule.candidateTaskConstraints).trim(),
    previewQuestions: normalizePreviewQuestions(previewModule.questions),
    submissionSchema:
      previewModule.submissionSchema && typeof previewModule.submissionSchema === "object" && !Array.isArray(previewModule.submissionSchema)
        ? previewModule.submissionSchema
        : null,
  };
}

function setLocale(locale) {
  const previousLocale = currentLocale;
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  document.documentElement.lang = currentLocale;
  applyTranslations();
  if (previewModeEnabled) {
    loadPreviewModules({ notify: false });
  } else if (hasLoadedModules) {
    // Re-fetch modules so server-resolved titles and descriptions reflect the new locale.
    // Intentionally fire-and-forget — locale switch must not block or disrupt flow state.
    apiFetch("/api/modules?includeCompleted=true", headers)
      .then((body) => {
        loadedModules = Array.isArray(body.modules) ? body.modules : [];
        renderModules();
        renderSelectedModuleSummary();
      })
      .catch(() => {/* silent — stale titles are preferable to an error on locale switch */});
  }
  setDefaultFieldValues(previousLocale, currentLocale);
  renderSubmissionFields(getSubmissionFields(resolveSelectedModule(loadedModules, selectedModuleId)));
  renderResultSummary(latestResult);
  renderHistorySummary(latestHistory);
}

function applyTranslations() {
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const key = element.getAttribute("data-i18n");
    if (!key) {
      continue;
    }
    element.textContent = t(key);
  }

  applyOutputVisibility();
  if (!output.dataset.hasContent) {
    output.textContent = t("defaults.ready");
  }
  if (outputStatus && !outputStatus.dataset.hasContent) {
    outputStatus.textContent = t("defaults.ready");
  }
  if (!resultSummary.dataset.hasResult) {
    resultSummary.textContent = t("defaults.noResult");
  }
  if (!historySummary.dataset.hasHistory) {
    historySummary.textContent = t("defaults.noHistory");
  }

  renderModules();
  renderSelectedModuleSummary();
  renderRolePresetControl();
  renderWorkspaceNavigation();
  const selectedTitle = resolveSelectedModule(loadedModules, selectedModuleId)?.title ?? "";
  setDraftStatus(draftStatus.dataset.state ?? "none", selectedTitle);
  renderAssessmentProgress();
  renderAppealState();
  updateCreateSubmissionAvailability();
  renderFlowGating();
  applyPreviewModeUi();
}

function applyPreviewModeUi() {
  if (!previewModeBanner || !previewModeMessage) {
    return;
  }

  previewModeBanner.classList.toggle("hidden", !previewModeEnabled);
  if (!previewModeEnabled) {
    return;
  }

  previewModeMessage.textContent = t("preview.description");
  loadModulesButton.textContent = t("preview.reload");
  if (historySection) {
    historySection.classList.add("hidden");
  }
}

function isDebugModeEnabled() {
  return participantRuntimeConfig?.debugMode !== false;
}

function isRawDebugEnabled() {
  return rawDebugEnabled;
}

function applyOutputVisibility() {
  if (debugOutputSection) {
    debugOutputSection.hidden = !isRawDebugEnabled();
  }
  output.hidden = !isRawDebugEnabled();
}

function formatOutputStatus(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim().length > 0) {
      return data.message;
    }
    if (typeof data.status === "string" && data.status.trim().length > 0) {
      return `Status: ${data.status}`;
    }
    const preferredKeys = ["submission", "appeal", "history", "modules", "module", "assessment", "decision"];
    const matchedKey = preferredKeys.find((key) => key in data);
    if (matchedKey) {
      return `Updated: ${matchedKey}`;
    }
  }
  return "Request completed.";
}

function formatOutputDetail(data) {
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function summarizeParticipantResponse(data) {
  if (typeof data === "string") {
    return data;
  }

  if (data?.selectedModule?.title) {
    return `${t("submission.selectedModule")}: ${data.selectedModule.title}`;
  }

  if (Array.isArray(data?.modules)) {
    return `${t("modules.title")}: ${data.modules.length}`;
  }

  if (data?.submission?.id && data?.mcqStarted?.attemptId) {
    return `${t("submission.create")}: ${data.submission.id}`;
  }

  if (data?.assessment?.latestJob || typeof data?.submissionStatus === "string") {
    return t("assessment.checkAssessment");
  }

  if (Array.isArray(data?.history)) {
    return `${t("history.title")}: ${data.history.length}`;
  }

  if (data?.appeal?.id) {
    return `${t("appeal.submittedPrefix")}: ${data.appeal.id}`;
  }

  if (data?.scoreComponents || data?.decision || typeof data?.status === "string") {
    return t("assessment.checkResult");
  }

  return formatOutputStatus(data);
}

function inferParticipantToastType(data) {
  if (typeof data === "string") {
    return "error";
  }

  if (data?.selectedModule) {
    return "info";
  }

  return "success";
}

function setDefaultFieldValues(previousLocale, nextLocale) {
  for (const field of defaultFieldBindings) {
    const element = document.getElementById(field.id);
    const previousDefault = tForLocale(previousLocale, field.key);
    const nextDefault = tForLocale(nextLocale, field.key);
    const englishDefault = tForLocale("en-GB", field.key);
    const currentValue = element.value;

    const shouldUpdate =
      !currentValue ||
      currentValue === previousDefault ||
      currentValue === englishDefault;

    if (shouldUpdate) {
      element.value = nextDefault;
    }
  }

  for (const field of currentSubmissionFields) {
    if (!field.defaultValueKey) continue;
    const element = submissionFieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
    if (!element) continue;
    const previousDefault = tForLocale(previousLocale, field.defaultValueKey);
    const nextDefault = tForLocale(nextLocale, field.defaultValueKey);
    const englishDefault = tForLocale("en-GB", field.defaultValueKey);
    const currentValue = element.value;
    if (!currentValue || currentValue === previousDefault || currentValue === englishDefault) {
      element.value = nextDefault;
    }
  }

  updateCreateSubmissionAvailability();
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

// #525: a module taken by the participant is MCQ-only when its active version has no free-text
// assessment. Such modules skip the submission/free-text step entirely (module → MCQ → result).
function moduleIsMcqOnly(module) {
  return module?.assessmentMode === "MCQ_ONLY";
}

function selectedModuleIsMcqOnly() {
  return moduleIsMcqOnly(resolveSelectedModule(loadedModules, selectedModuleId));
}

// #578: FREETEXT_ONLY — free-text + LLM assessment, no MCQ. The participant fills in the free-text
// answer (like FREETEXT_PLUS_MCQ) but there is no MCQ section, and the assessment can run as soon
// as the submission exists (no MCQ gate).
function moduleIsFreetextOnly(module) {
  return module?.assessmentMode === "FREETEXT_ONLY";
}

function selectedModuleIsFreetextOnly() {
  return moduleIsFreetextOnly(resolveSelectedModule(loadedModules, selectedModuleId));
}

function getSubmissionFields(selectedModule) {
  // MCQ-only modules have no free-text deliverable — no submission fields to fill (#525).
  if (moduleIsMcqOnly(selectedModule)) {
    return [];
  }
  const schemaFields = selectedModule?.submissionSchema?.fields;
  if (Array.isArray(schemaFields) && schemaFields.length > 0) {
    return schemaFields.map((f) => ({
      id: f.id,
      label: f.label ?? f.id,
      type: f.type ?? "textarea",
      rows: f.type === "text" ? 1 : 9,
      required: f.required ?? false,
      ...(f.defaultValue !== undefined && f.defaultValue !== "" && { defaultValue: f.defaultValue }),
      ...(f.placeholder !== undefined && f.placeholder !== "" && { placeholder: f.placeholder }),
    }));
  }
  return DEFAULT_SUBMISSION_FIELDS;
}

function applySubmissionReadMode() {
  const readOnly = flowState.hasSubmission;
  for (const el of submissionFieldsContainer.querySelectorAll("[data-field-id]")) {
    el.readOnly = readOnly;
    el.classList.toggle("submission-field-readonly", readOnly);
    if (readOnly) {
      if (!el.dataset.editRows) {
        el.dataset.editRows = String(el.rows || 1);
      }
      el.rows = 1;
      el.setAttribute("aria-readonly", "true");
      syncSubmissionFieldReadHeight(el);
    } else {
      if (el.dataset.editRows) {
        el.rows = Number(el.dataset.editRows) || 1;
      }
      el.removeAttribute("aria-readonly");
      el.style.height = "";
      el.style.overflowY = "";
    }
  }

  // MCQ-only modules have no free-text deliverable, so the acknowledgement + draft + validation
  // affordances stay hidden regardless of read mode (#525).
  const mcqOnly = selectedModuleIsMcqOnly();
  const hideAck = readOnly || mcqOnly;
  if (ackCheckbox) {
    ackCheckbox.disabled = readOnly;
    ackCheckbox.hidden = hideAck;
  }
  if (draftStatus) draftStatus.hidden = hideAck;
  if (draftBrowserNote) draftBrowserNote.hidden = hideAck;
  if (submissionValidationHint) submissionValidationHint.hidden = hideAck;
  // The ack <input> carries the `.inline` class whose CSS display overrides the [hidden]
  // attribute, so hide the wrapping <label> via style.display (beats the class rule) — #525.
  if (submissionAckLabel) submissionAckLabel.style.display = hideAck ? "none" : "";
  if (submissionIdRow) submissionIdRow.hidden = readOnly;
}

function syncSubmissionFieldReadHeight(textarea) {
  if (!textarea || textarea.tagName !== "TEXTAREA") {
    return;
  }
  textarea.style.height = "auto";
  textarea.style.overflowY = "hidden";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 48)}px`;
}

function renderSubmissionFields(fields) {
  // Preserve any values already typed or restored from draft before wiping the container.
  const preserved = {};
  for (const el of submissionFieldsContainer.querySelectorAll("[data-field-id]")) {
    preserved[el.dataset.fieldId] = el.value;
  }

  submissionFieldsContainer.innerHTML = "";
  currentSubmissionFields = fields;

  // MCQ-only modules (#525): no free-text fields — show a short note and the participant proceeds
  // straight to the multiple-choice questions. Acknowledgement/validation affordances are hidden
  // centrally in applySubmissionReadMode().
  if (selectedModuleIsMcqOnly()) {
    const note = document.createElement("p");
    note.className = "small";
    note.textContent = t("submission.mcqOnlyNote");
    submissionFieldsContainer.appendChild(note);
    return;
  }

  for (const field of fields) {
    const wrapper = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = field.labelKey ? t(field.labelKey) : localizePreviewText(field.label);
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-field-id", field.id);
    textarea.rows = field.rows ?? 3;
    textarea.className = "submission-field-input";
    if (field.placeholder) {
      textarea.placeholder = localizePreviewText(field.placeholder);
    }
    if (preserved[field.id] !== undefined) {
      textarea.value = preserved[field.id];
    }
    textarea.addEventListener("input", () => {
      if (textarea.readOnly) {
        syncSubmissionFieldReadHeight(textarea);
      }
    });
    wrapper.appendChild(label);
    wrapper.appendChild(textarea);
    if (field.required) {
      const charHint = document.createElement("div");
      charHint.className = "small";
      charHint.setAttribute("aria-live", "polite");
      const updateCharHint = () => {
        const len = textarea.value.trim().length;
        const warn = len > 0 && len < 10;
        charHint.textContent = warn ? t("submission.validation.rawTextMin") : "";
        charHint.classList.toggle("field-warning", warn);
      };
      textarea.addEventListener("input", () => {
        updateCharHint();
        scheduleDraftAutosave();
        updateCreateSubmissionAvailability();
      });
      updateCharHint();
      wrapper.appendChild(charHint);
    } else {
      textarea.addEventListener("input", () => {
        scheduleDraftAutosave();
        updateCreateSubmissionAvailability();
      });
    }
    submissionFieldsContainer.appendChild(wrapper);
  }
  applySubmissionReadMode();
}

function renderSelectedModuleSummary() {
  const selectedModule = resolveSelectedModule(loadedModules, selectedModuleId);
  selectedModuleIdInput.value = selectedModule?.id ?? "";
  selectedModuleTitle.textContent = selectedModule?.title ?? t("submission.selectedModuleNone");
  selectedModuleDescription.textContent = selectedModule?.description ?? "";
  selectedModuleDescription.classList.toggle("hidden", !(selectedModule?.description ?? "").trim());
  const statusSummary = formatModuleStatusSummary(selectedModule);
  selectedModuleStatus.textContent = statusSummary;
  selectedModuleStatus.classList.toggle("hidden", statusSummary.length === 0);
  selectedModuleTaskText.textContent = selectedModule?.taskText ?? "";
  const constraints = selectedModule?.candidateTaskConstraints ?? "";
  if (selectedModuleCandidateTaskConstraints) selectedModuleCandidateTaskConstraints.textContent = constraints;
  // .module-brief / .module-brief-section set `display: grid`, which overrides the `.hidden`
  // class (defined earlier in the cascade, no !important). Gate via inline style.display so an
  // MCQ-only module (taskText == null) doesn't show an empty OPPGAVE/VEILEDNING brief (#525 follow-up).
  if (selectedModuleCandidateConstraintsSection) {
    setHidden(selectedModuleCandidateConstraintsSection, !constraints);
  }
  setHidden(selectedModuleBrief, !(selectedModule && selectedModule.taskText));
  renderSubmissionFields(getSubmissionFields(selectedModule));
  updateModuleSelectionVisibility(Boolean(selectedModule));
}

function setSectionLocked(section, locked) {
  section.classList.toggle("section-locked", locked);
  for (const el of section.querySelectorAll("button, input, textarea, select, a[href]")) {
    if (locked) {
      el.dataset.preLockTabindex = el.getAttribute("tabindex") ?? "";
      el.setAttribute("tabindex", "-1");
    } else {
      const pre = el.dataset.preLockTabindex;
      if (pre === "") {
        el.removeAttribute("tabindex");
      } else if (pre != null) {
        el.setAttribute("tabindex", pre);
      }
      delete el.dataset.preLockTabindex;
    }
  }
}

function updateModuleSelectionVisibility(hasSelectedModule) {
  submissionSection.classList.toggle("hidden", !hasSelectedModule);
  moduleSelectionHint.hidden = hasSelectedModule;
  updateCreateSubmissionAvailability();
  renderFlowGating();
}

function validateSubmissionInputState() {
  const selectedModule = resolveSelectedModule(loadedModules, selectedModuleId);
  const hasModule = Boolean(selectedModule);
  const hasAcknowledgement = ackCheckbox.checked === true;

  if (!hasModule) {
    return {
      valid: false,
      hintKey: "submission.validation.selectModule",
      invalidFieldElement: selectedModuleDisplay,
      invalidHintElement: moduleSelectionHint,
    };
  }

  // MCQ-only modules have no free-text deliverable and no acknowledgement step (#525) — ready to
  // start the MCQ as soon as a module is selected.
  if (moduleIsMcqOnly(selectedModule)) {
    return { valid: true, hintKey: "submission.validation.ready" };
  }

  for (const field of currentSubmissionFields) {
    if (!field.required) continue;
    const element = submissionFieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
    if (!element || element.value.trim().length < 10) {
      return {
        valid: false,
        hintKey: "submission.validation.rawTextMin",
        invalidFieldElement: element,
      };
    }
  }

  if (!hasAcknowledgement) {
    return {
      valid: false,
      hintKey: "submission.validation.ackRequired",
      invalidFieldElement: ackCheckbox,
    };
  }

  return { valid: true, hintKey: "submission.validation.ready" };
}

function resetSubmissionValidationVisuals() {
  for (const el of submissionFieldsContainer.querySelectorAll(".is-invalid")) {
    el.classList.remove("is-invalid");
    el.setAttribute("aria-invalid", "false");
  }
  for (const target of submissionValidationTargets) {
    target.fieldElement?.classList.remove("is-invalid");
    target.fieldElement?.setAttribute("aria-invalid", "false");
    if (!target.hintElement) {
      continue;
    }

    target.hintElement.classList.remove("field-error", "field-success");
    target.hintElement.classList.add("hint");
    target.hintElement.removeAttribute("role");

    const hintKey = target.hintElement.dataset.hintKey;
    if (hintKey) {
      target.hintElement.textContent = t(hintKey);
    }
  }
}

function applySubmissionValidationFeedback(validation) {
  resetSubmissionValidationVisuals();

  submissionValidationHint.classList.remove("field-error", "field-success");
  submissionValidationHint.classList.add("hint");
  submissionValidationHint.removeAttribute("role");

  if (validation.valid) {
    submissionValidationHint.classList.remove("hint");
    submissionValidationHint.classList.add("field-success");
    submissionValidationHint.textContent = t("submission.validation.ready");
    return;
  }

  validation.invalidFieldElement?.classList.add("is-invalid");
  validation.invalidFieldElement?.setAttribute("aria-invalid", "true");

  if (validation.invalidHintElement) {
    validation.invalidHintElement.classList.remove("hint", "field-success");
    validation.invalidHintElement.classList.add("field-error");
    validation.invalidHintElement.setAttribute("role", "alert");
    validation.invalidHintElement.textContent = t(validation.hintKey);
  }

  submissionValidationHint.classList.remove("hint", "field-success");
  submissionValidationHint.classList.add("field-error");
  submissionValidationHint.setAttribute("role", "alert");
  submissionValidationHint.textContent = t(validation.hintKey);
}

function updateCreateSubmissionAvailability() {
  const validation = validateSubmissionInputState();
  const isBusy = createSubmissionButton.dataset.busy === "true";
  createSubmissionButton.disabled = isBusy || flowState.hasSubmission || !validation.valid;
  applySubmissionValidationFeedback(validation);
  applySubmissionReadMode();
}

function hasMeaningfulStoredDraft(draft) {
  if (!draft || typeof draft !== "object") {
    return false;
  }

  for (const field of currentSubmissionFields) {
    const value = typeof draft[field.id] === "string" ? draft[field.id].trim() : "";
    const defaultValue = localizePreviewText(field.defaultValue).trim();
    if (value.length > 0 && value !== defaultValue) {
      return true;
    }
  }

  const responses = draft.mcq?.responses;
  return Boolean(
    responses &&
    typeof responses === "object" &&
    Object.values(responses).some((value) => typeof value === "string" && value.trim().length > 0),
  );
}

function renderModules() {
  hideLoading(moduleList);
  moduleList.innerHTML = "";
  const moduleDrafts = readModuleDraftMap();

  const modules = buildModuleCardViewModels(loadedModules, selectedModuleId);
  if (modules.length === 0) {
    const emptyKey = previewModeEnabled
      ? "preview.empty"
      : hasLoadedModules
        ? "modules.empty"
        : "modules.emptyInitial";
    showEmpty(moduleList, t(emptyKey));
    return;
  }

  const compact = modules.length >= 6;
  moduleList.classList.toggle("compact", compact);

  for (const module of modules) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = module.selected ? "btn-secondary module-card selected" : "btn-secondary module-card";
    button.classList.toggle("completed", module.completed === true);
    // If the latest decision was a fail, mark the card so the green-success styling
    // doesn't visually mislead students who haven't passed yet.
    const latestFailed = module.completed === true
      && module.participantStatus?.latestDecision?.passFailTotal === false;
    button.classList.toggle("failed", latestFailed);
    button.setAttribute("aria-pressed", module.selected ? "true" : "false");
    button.addEventListener("click", () => {
      activateParticipantModule(module.id);
    });

    const title = document.createElement("div");
    title.className = "module-title";
    title.textContent = module.title;
    // v1.2.20 (#461): vis modul-versjon diskret etter tittelen så support kan reprodusere
    // hvilken versjon en deltaker har fått servert. Publiseringsdato vises i tooltip.
    const versionNo = module.activeVersion?.versionNo;
    if (versionNo != null) {
      const versionTag = document.createElement("span");
      versionTag.className = "module-version-tag";
      versionTag.textContent = ` · v${versionNo}`;
      if (module.activeVersion?.publishedAt) {
        try {
          const d = new Date(module.activeVersion.publishedAt);
          versionTag.title = `Publisert ${d.toLocaleDateString()}`;
        } catch { /* fall through — no tooltip */ }
      }
      title.appendChild(versionTag);
    }
    button.appendChild(title);

    if (!compact && typeof module.description === "string" && module.description.trim().length > 0) {
      const description = document.createElement("div");
      description.className = "module-meta";
      description.textContent = module.description;
      button.appendChild(description);
    }

    const badges = document.createElement("div");
    badges.className = "module-badges";
    let hasBadges = false;

    // Show certification level so students can tell modules at different levels apart.
    // module.certificationLevel may be a plain string ("basic"/"intermediate"/"advanced")
    // or a localized object — normalise to a key we can label. See #372 follow-up.
    let levelKey = null;
    const rawLevel = module.certificationLevel;
    if (typeof rawLevel === "string") {
      levelKey = rawLevel.toLowerCase();
    } else if (rawLevel && typeof rawLevel === "object") {
      const firstValue = Object.values(rawLevel).find((v) => typeof v === "string" && v.length > 0);
      if (typeof firstValue === "string") levelKey = firstValue.toLowerCase();
    }
    if (levelKey === "basic" || levelKey === "intermediate" || levelKey === "advanced") {
      const levelBadge = document.createElement("div");
      levelBadge.className = `module-status-badge level level-${levelKey}`;
      levelBadge.textContent = t(`modules.levelBadge.${levelKey}`);
      badges.appendChild(levelBadge);
      hasBadges = true;
    }

    if (module.completed) {
      const completedBadge = document.createElement("div");
      completedBadge.className = "module-status-badge completed";
      completedBadge.textContent = t("modules.completedBadge");
      badges.appendChild(completedBadge);
      hasBadges = true;

      if (!compact) {
        const retakeBadge = document.createElement("div");
        retakeBadge.className = "module-status-badge retake";
        retakeBadge.textContent = t("modules.retakeBadge");
        badges.appendChild(retakeBadge);
        hasBadges = true;
      }
    }

    if (hasMeaningfulStoredDraft(moduleDrafts[module.id])) {
      const draftBadge = document.createElement("div");
      draftBadge.className = "draft-badge";
      draftBadge.textContent = t("modules.draftBadge");
      badges.appendChild(draftBadge);
      hasBadges = true;
    }

    if (hasBadges) {
      button.appendChild(badges);
    }

    if (!compact) {
      const statusSummary = formatModuleStatusSummary(module);
      if (statusSummary.length > 0) {
        const statusMeta = document.createElement("div");
        statusMeta.className = "module-meta";
        statusMeta.textContent = statusSummary;
        button.appendChild(statusMeta);
      }
    }

    if (shouldShowModuleDebugMeta()) {
      const moduleMeta = document.createElement("div");
      moduleMeta.className = "module-meta";
      moduleMeta.textContent = `${t("modules.debugId")}: ${module.id}`;
      button.appendChild(moduleMeta);
    }

    if (!compact && module.selected) {
      const selectedBadge = document.createElement("div");
      selectedBadge.className = "selected-badge";
      selectedBadge.textContent = t("modules.selectedBadge");
      button.appendChild(selectedBadge);
    }

    moduleList.appendChild(button);
  }
}

function syncParticipantModuleWorkspace(options = {}) {
  const { restoreDraft = false } = options;

  if (selectedModuleId && !resolveSelectedModule(loadedModules, selectedModuleId)) {
    selectedModuleId = "";
    resetFlowStateForModuleContext();
  }

  renderModules();
  renderSelectedModuleSummary();

  if (restoreDraft && selectedModuleId) {
    restoreDraftForSelectedModule(false);
  }

  updateCreateSubmissionAvailability();
}

function activateParticipantModule(moduleId, options = {}) {
  const { scrollIntoView = false, logSelection = true } = options;
  const nextModule = loadedModules.find((module) => module?.id === moduleId) ?? null;
  if (!nextModule) {
    return false;
  }

  const previousModuleId = selectedModuleId;
  const savedDraft = persistCurrentModuleDraft(false);
  selectedModuleId = moduleId;
  resetFlowStateForModuleContext();
  renderModules();
  renderSelectedModuleSummary();
  restoreDraftForSelectedModule(true);
  updateCreateSubmissionAvailability();

  // #546 feedback: MCQ-only modules have no free-text step — go straight to the questions by
  // creating the (empty) submission + starting the MCQ immediately, so the participant never sees
  // a "create submission" step. Covers both entry points (module card + course → openCourseModule).
  // #2 fix: don't auto-start for an already-passed module (avoids a needless retake / 409).
  const alreadyPassed = nextModule.participantStatus?.latestDecision?.passFailTotal === true;
  if (moduleIsMcqOnly(nextModule) && !alreadyPassed && !previewModeEnabled && !flowState.hasSubmission && !createSubmissionButton.disabled) {
    createSubmissionButton.click();
  }

  // v1.2.22 (#465): kollaps modullisten så modul-innholdet får mer plass. Bruker kan
  // ekspandere igjen ved å klikke «Last moduler»-knappen.
  document.getElementById("moduleListSection")?.classList.add("module-list-collapsed");

  if (savedDraft.saved && savedDraft.meaningful && previousModuleId && previousModuleId !== moduleId) {
    showToast(t("draft.savedSwitchToast").replace("{module}", savedDraft.title), "info");
  }

  if (scrollIntoView) {
    selectedModuleDisplay?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (logSelection) {
    log({ selectedModule: { id: nextModule.id, title: nextModule.title } }, { notify: false });
  }

  return true;
}

async function ensureParticipantModuleAvailable(moduleId) {
  if (loadedModules.some((module) => module?.id === moduleId)) {
    return true;
  }

  if (previewModeEnabled) {
    loadPreviewModules({ notify: false });
    return loadedModules.some((module) => module?.id === moduleId);
  }

  const body = await apiFetch("/api/modules?includeCompleted=true", headers);
  loadedModules = Array.isArray(body.modules) ? body.modules : [];
  hasLoadedModules = true;
  syncParticipantModuleWorkspace();

  return loadedModules.some((module) => module?.id === moduleId);
}

async function openCourseModule(courseId, moduleId) {
  const available = await ensureParticipantModuleAvailable(moduleId);
  if (!available) {
    throw new Error(t("courses.module.unavailable"));
  }

  activateParticipantModule(moduleId, { scrollIntoView: true });

  if (courseDetailCache[courseId]) {
    renderCourseDetailModules(courseId, courseDetailCache[courseId]);
  }
}

function resetFlowStateForModuleContext() {
  stopAutoAssessmentLoop(true);
  flowState = {
    hasSubmission: false,
    hasMcqSubmission: false,
    assessmentQueued: false,
    resultStatus: null,
  };
  celebrationShown = false;
  latestAppeal = null;
  assessmentProgressKey = "assessment.progress.idle";
  setAssessmentProgressDetail();
  submissionIdLabel.textContent = "-";
  attemptIdLabel.textContent = "-";
  appealIdLabel.textContent = "-";
  renderResultSummary(null);
  renderAssessmentProgress();
  renderAppealState();
  renderFlowGating();
}

function renderFlowGating() {
  // #578: FREETEXT_ONLY has no MCQ — the assessment unlocks on the free-text submission alone.
  const freetextOnly = selectedModuleIsFreetextOnly();
  const gate = deriveParticipantFlowGateState(flowState, { requiresMcq: !freetextOnly });
  const hasAssessmentContext =
    flowState.hasMcqSubmission || flowState.assessmentQueued || Boolean(flowState.resultStatus)
    || (freetextOnly && flowState.hasSubmission);
  const autoAssessmentEnabled = getFlowSettings().autoStartAfterMcq;
  const hasSelectedModule = Boolean(resolveSelectedModule(loadedModules, selectedModuleId));
  const hasPreviewQuestions = currentQuestions.length > 0;

  assessmentSection.classList.toggle("hidden", !hasAssessmentContext);
  // FREETEXT_ONLY has no MCQ section.
  mcqSection.classList.toggle("hidden", !hasSelectedModule || !flowState.hasSubmission || freetextOnly);
  setSectionLocked(assessmentSection, !gate.assessmentUnlocked);
  setSectionLocked(appealSection, !gate.appealUnlocked);
  queueAssessmentButton.classList.toggle("hidden", autoAssessmentEnabled);
  createSubmissionButton.classList.toggle("hidden", flowState.hasSubmission);
  submitMcqButton.classList.toggle("hidden", !flowState.hasSubmission || flowState.hasMcqSubmission || freetextOnly);

  const hasResultStatus = isAssessmentResultReady(flowState.resultStatus);
  resetSubmissionFlowButton.classList.toggle("hidden", !hasResultStatus);
  // Feedback (#549): once the participant has passed, retry/«delete & start over» should be a
  // discreet secondary action — not compete with the pass celebration. A failed result keeps it
  // at normal prominence so a retake is easy.
  resetSubmissionFlowButton.classList.toggle("reset-flow-discreet", hasResultStatus && flowState.resultPassFail === true);

  const createSubmissionBusy = createSubmissionButton.dataset.busy === "true";
  const submitMcqBusy = submitMcqButton.dataset.busy === "true";
  const queueBusy = queueAssessmentButton.dataset.busy === "true";
  const checkAssessmentBusy = checkAssessmentButton.dataset.busy === "true";
  const checkResultBusy = checkResultButton.dataset.busy === "true";
  const createAppealBusy = createAppealButton.dataset.busy === "true";
  const resetFlowBusy = resetSubmissionFlowButton.dataset.busy === "true";

  if (previewModeEnabled) {
    assessmentSection.classList.toggle("hidden", !flowState.hasMcqSubmission);
    mcqSection.classList.toggle("hidden", !hasSelectedModule || !flowState.hasSubmission || (!hasPreviewQuestions && flowState.hasMcqSubmission));
    setSectionLocked(assessmentSection, false);
    appealSection.classList.add("hidden");
    if (historySection) {
      historySection.classList.add("hidden");
    }
    queueAssessmentButton.classList.add("hidden");
    checkAssessmentButton.classList.add("hidden");
    checkResultButton.classList.add("hidden");
    createAppealButton.classList.add("hidden");
    createSubmissionButton.classList.toggle("hidden", flowState.hasSubmission);
    submitMcqButton.classList.toggle("hidden", !flowState.hasSubmission || flowState.hasMcqSubmission || !hasPreviewQuestions);
    createSubmissionButton.disabled =
      createSubmissionBusy ||
      flowState.hasSubmission ||
      !validateSubmissionInputState().valid;
    submitMcqButton.disabled =
      submitMcqBusy ||
      !flowState.hasSubmission ||
      flowState.hasMcqSubmission ||
      !hasPreviewQuestions;
    resetSubmissionFlowButton.classList.toggle("hidden", !(flowState.hasSubmission || flowState.hasMcqSubmission));
    resetSubmissionFlowButton.disabled = resetFlowBusy || !(flowState.hasSubmission || flowState.hasMcqSubmission);
    assessmentGateHint.textContent = flowState.hasMcqSubmission
      ? t("preview.assessmentUnavailable")
      : t("preview.completeMcqFirst");
    checkAssessmentHint.textContent = "";
    appealGateHint.textContent = "";
    return;
  }

  createSubmissionButton.disabled =
    createSubmissionBusy ||
    flowState.hasSubmission ||
    !validateSubmissionInputState().valid;
  submitMcqButton.disabled =
    submitMcqBusy ||
    !flowState.hasSubmission ||
    flowState.hasMcqSubmission ||
    currentQuestions.length === 0;
  const isAutoLoopActive = autoAssessmentEnabled && autoAssessmentTicker !== null;
  queueAssessmentButton.disabled = isAutoLoopActive || queueBusy || !gate.assessmentUnlocked;
  checkResultButton.disabled = isAutoLoopActive || checkResultBusy || !gate.assessmentUnlocked;
  checkAssessmentButton.disabled = isAutoLoopActive || checkAssessmentBusy || !gate.checkAssessmentUnlocked;
  createAppealButton.disabled = createAppealBusy || !gate.appealUnlocked;
  resetSubmissionFlowButton.disabled = resetFlowBusy || !hasResultStatus;

  assessmentGateHint.textContent = t(gate.assessmentHintKey);
  checkAssessmentHint.textContent = t(gate.checkAssessmentHintKey);
  appealGateHint.textContent = t(gate.appealHintKey);
  renderAppealState();
  applySubmissionReadMode();
}

function getFlowSettings() {
  const configured = participantRuntimeConfig?.flow ?? {};
  const pollIntervalSeconds = Math.max(1, Math.min(30, Number(configured.pollIntervalSeconds) || 2));
  const maxWaitSeconds = Math.max(pollIntervalSeconds, Math.min(600, Number(configured.maxWaitSeconds) || 90));
  return {
    autoStartAfterMcq: configured.autoStartAfterMcq !== false,
    pollIntervalSeconds,
    maxWaitSeconds,
  };
}

function setAssessmentProgressDetail(detailKey = "", countdown = null) {
  assessmentProgressDetailKey = detailKey;
  assessmentProgressDetailCountdown = typeof countdown === "number" ? Math.max(0, Math.floor(countdown)) : null;
}

function stopAutoAssessmentLoop(clearDetail = true) {
  if (autoAssessmentTicker) {
    clearInterval(autoAssessmentTicker);
    autoAssessmentTicker = null;
  }
  autoAssessmentSubmissionId = "";
  autoAssessmentElapsedSeconds = 0;
  autoAssessmentNextPollInSeconds = 0;
  autoAssessmentRequestInFlight = false;

  if (clearDetail) {
    setAssessmentProgressDetail();
    renderAssessmentProgress();
  }
}

function isAssessmentResultReady(status) {
  const normalized = typeof status === "string" ? status.toUpperCase() : "";
  return normalized === "COMPLETED" || normalized === "UNDER_REVIEW" || normalized === "SCORED";
}

async function startAutomaticAssessmentFlow(submissionId) {
  const settings = getFlowSettings();
  if (!settings.autoStartAfterMcq || !submissionId || submissionId === "-") {
    return;
  }

  stopAutoAssessmentLoop(true);
  autoAssessmentSubmissionId = submissionId;
  autoAssessmentElapsedSeconds = 0;
  autoAssessmentNextPollInSeconds = settings.pollIntervalSeconds;

  assessmentProgressKey = "assessment.progress.waiting";
  setAssessmentProgressDetail("assessment.auto.starting");
  renderAssessmentProgress();

  try {
    await apiFetch(`/api/assessments/${submissionId}/run`, headers, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    setAssessmentProgressDetail("assessment.auto.failedStart");
    renderAssessmentProgress();
    throw error;
  }

  flowState = {
    ...flowState,
    assessmentQueued: true,
  };
  setAssessmentProgressDetail("assessment.auto.started");
  renderAssessmentProgress();
  renderFlowGating();

  autoAssessmentTicker = setInterval(async () => {
    if (autoAssessmentRequestInFlight || autoAssessmentSubmissionId !== submissionId) {
      return;
    }

    autoAssessmentElapsedSeconds += 1;
    const remainingWaitSeconds = settings.maxWaitSeconds - autoAssessmentElapsedSeconds;
    if (remainingWaitSeconds <= 0) {
      stopAutoAssessmentLoop(false);
      setAssessmentProgressDetail("assessment.auto.timeout");
      renderAssessmentProgress();
      renderFlowGating();
      return;
    }

    autoAssessmentNextPollInSeconds = Math.max(0, autoAssessmentNextPollInSeconds - 1);
    renderAssessmentProgress();

    if (autoAssessmentNextPollInSeconds > 0) {
      return;
    }

    autoAssessmentNextPollInSeconds = settings.pollIntervalSeconds;
    autoAssessmentRequestInFlight = true;

    try {
      const assessmentBody = await apiFetch(`/api/assessments/${submissionId}`, headers);
      assessmentProgressKey = deriveAssessmentProgressKeyFromSubmissionStatus(
        assessmentBody.submissionStatus,
        assessmentBody.latestJob?.status,
      );
      renderAssessmentProgress();

      if (!isAssessmentResultReady(assessmentBody.submissionStatus)) {
        return;
      }

      const resultBody = await apiFetch(`/api/submissions/${submissionId}/result`, headers);
      renderResultSummary(resultBody);
      flowState = {
        ...flowState,
        resultStatus: typeof resultBody.status === "string" ? resultBody.status : null,
      };
      setAssessmentProgressDetail("assessment.auto.resultLoaded");
      renderAssessmentProgress();
      renderFlowGating();
      stopAutoAssessmentLoop(false);
    } catch (error) {
      log(error.message);
    } finally {
      autoAssessmentRequestInFlight = false;
    }
  }, 1000);
}

function getDraftSettings() {
  const configured = participantRuntimeConfig?.drafts ?? {};
  return {
    storageKey: configured.storageKey || "participant.moduleDrafts.v1",
    ttlMinutes: Number(configured.ttlMinutes) > 0 ? Number(configured.ttlMinutes) : 240,
    maxModules: Number(configured.maxModules) > 0 ? Number(configured.maxModules) : 30,
  };
}

function readModuleDraftMap() {
  const settings = getDraftSettings();
  const envelope = parseDraftEnvelope(localStorage.getItem(settings.storageKey));
  const pruned = pruneExpiredModuleDrafts(envelope.modules, settings.ttlMinutes);
  if (Object.keys(pruned).length !== Object.keys(envelope.modules).length) {
    localStorage.setItem(settings.storageKey, JSON.stringify({ modules: pruned }));
  }
  return pruned;
}

function writeModuleDraftMap(moduleDrafts) {
  const settings = getDraftSettings();
  localStorage.setItem(settings.storageKey, JSON.stringify({ modules: moduleDrafts }));
}

function setDraftStatus(kind, moduleTitle) {
  const safeTitle = moduleTitle || t("submission.selectedModuleNone");

  if (kind === "saved") {
    draftStatus.textContent = `${t("draft.savedPrefix")}: ${safeTitle}`;
    draftStatus.dataset.state = "saved";
    return;
  }

  if (kind === "restored") {
    draftStatus.textContent = `${t("draft.restoredPrefix")}: ${safeTitle}`;
    draftStatus.dataset.state = "restored";
    return;
  }

  if (kind === "cleared") {
    draftStatus.textContent = `${t("draft.clearedPrefix")}: ${safeTitle}`;
    draftStatus.dataset.state = "cleared";
    return;
  }

  draftStatus.textContent = t("draft.none");
  draftStatus.dataset.state = "none";
}

function resetModuleDraftInputsToDefaultLocaleValues() {
  for (const field of currentSubmissionFields) {
    const element = submissionFieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
    if (element) {
      element.value = localizePreviewText(field.defaultValue);
    }
  }
}

function collectCurrentMcqDraft() {
  if (!Array.isArray(currentQuestions) || currentQuestions.length === 0) {
    return null;
  }

  const responses = {};
  for (const question of currentQuestions) {
    const selected = document.querySelector(`input[name='q_${question.id}']:checked`);
    if (selected) {
      responses[question.id] = selected.value;
    }
  }

  const attemptId = attemptIdLabel.textContent;
  if (attemptId && attemptId !== "-") {
    return {
      attemptId,
      questions: currentQuestions,
      responses,
    };
  }

  if (Object.keys(responses).length > 0) {
    return {
      attemptId: null,
      questions: currentQuestions,
      responses,
    };
  }

  return null;
}

function persistCurrentModuleDraft(showStatus = false) {
  const selectedModule = resolveSelectedModule(loadedModules, selectedModuleId);
  if (!selectedModule) {
    return { saved: false, meaningful: false, title: "" };
  }

  const data = {};
  for (const field of currentSubmissionFields) {
    const element = submissionFieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
    data[field.id] = element?.value ?? "";
  }
  data.mcq = collectCurrentMcqDraft();

  const settings = getDraftSettings();
  const existing = readModuleDraftMap();
  const updated = upsertModuleDraft(existing, selectedModule.id, data, Date.now(), settings.maxModules);
  writeModuleDraftMap(updated);

  if (showStatus) {
    setDraftStatus("saved", selectedModule.title);
  }

  return {
    saved: true,
    meaningful: hasMeaningfulStoredDraft(updated[selectedModule.id]),
    title: selectedModule.title,
  };
}

function scheduleDraftAutosave() {
  if (!selectedModuleId) {
    return;
  }

  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  autosaveTimer = setTimeout(() => {
    persistCurrentModuleDraft(true);
  }, 250);
}

function restoreDraftForSelectedModule(showStatus = true) {
  const selectedModule = resolveSelectedModule(loadedModules, selectedModuleId);
  if (!selectedModule) {
    setDraftStatus("none", "");
    return;
  }

  const moduleDrafts = readModuleDraftMap();
  const draft = moduleDrafts[selectedModule.id];

  if (!draft) {
    resetModuleDraftInputsToDefaultLocaleValues();
    currentQuestions = [];
    attemptIdLabel.textContent = "-";
    renderQuestions();
    updateCreateSubmissionAvailability();
    if (showStatus) {
      setDraftStatus("none", selectedModule.title);
    }
    return;
  }

  for (const field of currentSubmissionFields) {
    const element = submissionFieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
    if (element) {
      element.value = typeof draft[field.id] === "string" ? draft[field.id] : "";
    }
  }

  const mcqDraft = draft.mcq;
  if (mcqDraft && Array.isArray(mcqDraft.questions)) {
    currentQuestions = mcqDraft.questions;
    attemptIdLabel.textContent = mcqDraft.attemptId || "-";
    renderQuestions(mcqDraft.responses ?? {});
  } else {
    currentQuestions = [];
    attemptIdLabel.textContent = "-";
    renderQuestions();
  }

  if (showStatus) {
    setDraftStatus("restored", selectedModule.title);
  }
  updateCreateSubmissionAvailability();
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
    localePicker: document.querySelector(".locale-picker"),
    items,
    buildLabel: (item) => t(item.labelKey),
  });
}

async function loadParticipantConsoleConfig() {
  // #541: identity-dependent actions must wait until the console config has populated the
  // identity form. Otherwise an early click sends an empty x-user-id, the backend falls back
  // to the roleless MOCK_DEFAULT_USER_ID, and the request 403s with a confusing role error.
  const loadCoursesBtn = document.getElementById("loadCoursesBtn");
  if (loadCoursesBtn) loadCoursesBtn.disabled = true;
  try {
    const body = await getConsoleConfig();
    participantRuntimeConfig = {
      ...participantRuntimeConfig,
      ...body,
      navigation: {
        ...participantRuntimeConfig.navigation,
        ...(body?.navigation ?? {}),
      },
      drafts: {
        ...participantRuntimeConfig.drafts,
        ...(body?.drafts ?? {}),
      },
      flow: {
        ...participantRuntimeConfig.flow,
        ...(body?.flow ?? {}),
      },
    };
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  }

  document.body.classList.toggle("auth-entra", roleSwitchState.authMode === "entra");
  // Auth-modus er nå kjent → fjern «resolving»-tilstanden (dev-kortet vises kun i ekte mock-modus,
  // aldri som et blink i prod/stage). Se shared.css `body.auth-resolving .mock-identity-card`.
  document.body.classList.remove("auth-resolving");
  applyOutputVisibility();
  applyIdentityDefaults();
  applyCourseOnlyMode();
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
  await initConsentGuard(headers, currentLocale);
  fetchQueueCounts(headers).then((counts) => applyNavReviewBadge(workspaceNav, counts));

  // Identity form is now populated — safe to allow course loading (#541).
  if (loadCoursesBtn) loadCoursesBtn.disabled = false;
}

// #495-follow-up: når PARTICIPANT_COURSE_ONLY er på, når deltakere moduler kun via kurs — skjul den
// frittstående modul-seksjonen. Modul åpnet via course player bruker submission-/MCQ-seksjonene
// (ikke denne lista), så den flyten er upåvirket.
function applyCourseOnlyMode() {
  if (participantRuntimeConfig?.courseOnly) {
    setHidden(document.getElementById("moduleListSection"), true);
  }
}

function applyIdentityDefaults() {
  const identityDefaults = participantRuntimeConfig?.identityDefaults?.participant;
  if (!identityDefaults) {
    return;
  }

  document.getElementById("userId").value = identityDefaults.userId ?? "";
  document.getElementById("email").value = identityDefaults.email ?? "";
  document.getElementById("name").value = identityDefaults.name ?? "";
  document.getElementById("department").value = identityDefaults.department ?? "";
  rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
}

function headers() {
  const roles = rolesInput
    .value.split(",")
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

function log(data, options = {}) {
  const { notify = true, detail = "" } = options;
  const statusText = summarizeParticipantResponse(data);

  output.dataset.hasContent = "true";
  outputStatus.dataset.hasContent = "true";
  outputStatus.textContent = statusText;

  if (notify) {
    showToast(statusText, inferParticipantToastType(data), detail);
  }

  if (!isRawDebugEnabled()) {
    output.textContent = "";
    return;
  }

  output.textContent = formatOutputDetail(data);
}

async function runWithBusyButton(button, action, after = () => {}) {
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
    after();
  }
}

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Participant Test Console v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
  }
}


function isCompletedModuleStatus(value) {
  return COMPLETED_MODULE_STATUSES.has(typeof value === "string" ? value.toUpperCase() : "");
}

function formatModuleStatusSummary(module) {
  const latestStatus = module?.participantStatus?.latestStatus;
  if (!isCompletedModuleStatus(latestStatus)) {
    return "";
  }

  const parts = [t("modules.completedBadge")];
  if (module?.participantStatus?.latestDecision && typeof module.participantStatus.latestDecision.totalScore === "number") {
    parts.push(
      `${t("modules.latestScoreLabel")}: ${formatNumber(module.participantStatus.latestDecision.totalScore)}`,
    );
  }
  if (module?.participantStatus?.latestSubmittedAt) {
    parts.push(
      `${t("modules.completedAtLabel")}: ${formatDateTime(module.participantStatus.latestSubmittedAt)}`,
    );
  }
  return parts.join(" · ");
}


function localizeSubmissionStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`result.statusValue.${normalized || "UNKNOWN"}`);
}

function localizeAppealStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`appeal.statusValue.${normalized || "UNKNOWN"}`);
}

function outcomeClass(passFailTotal, submissionStatus) {
  const status = typeof submissionStatus === "string" ? submissionStatus.toUpperCase() : "";
  if (status === "UNDER_REVIEW") return "outcome--review";
  if (passFailTotal === true) return "outcome--pass";
  if (passFailTotal === false) return "outcome--fail";
  return "";
}

function localizeDecisionType(value, submissionStatus, passFailTotal) {
  const normalizedStatus = typeof submissionStatus === "string" ? submissionStatus.toUpperCase() : "";
  if (normalizedStatus === "UNDER_REVIEW") {
    return t("result.decisionValue.MANUAL_REVIEW_PENDING");
  }

  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  if (normalized === "AUTOMATIC") {
    return passFailTotal === true
      ? t("result.decisionValue.AUTOMATIC_PASS")
      : passFailTotal === false
        ? t("result.decisionValue.AUTOMATIC_FAIL")
        : t("result.decisionValue.AUTOMATIC");
  }
  return t(`result.decisionValue.${normalized || "UNKNOWN"}`);
}

function localizeStatusExplanation(status) {
  const normalized = typeof status === "string" ? status.toUpperCase() : "";
  if (normalized === "UNDER_REVIEW") {
    return t("result.statusExplanation.underReview");
  }
  if (normalized === "COMPLETED") {
    return t("result.statusExplanation.completed");
  }
  return t("result.statusExplanation.processing");
}

function localizeCriterionName(criterion) {
  const key = typeof criterion === "string" ? criterion : "";
  const translationKey = `result.criterion.${key}`;
  const localized = t(translationKey);
  if (localized !== translationKey) return localized;
  // Try snake_case normalization: "Technical Accuracy" / "technicalAccuracy" → "technical_accuracy"
  const snakeKey = key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (snakeKey && snakeKey !== key) {
    const snakeTranslationKey = `result.criterion.${snakeKey}`;
    const snakeLocalized = t(snakeTranslationKey);
    if (snakeLocalized !== snakeTranslationKey) return snakeLocalized;
  }
  // Format raw key: snake_case and camelCase → readable words
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function localizeKnownContent(value, map) {
  if (typeof value !== "string") {
    return value ?? "-";
  }

  const trimmed = value.trim();
  const directKey = map[trimmed];
  if (directKey) {
    return t(directKey);
  }

  const normalize = (text) =>
    text
      .trim()
      .replace(/[.;!]+$/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

  const normalized = normalize(trimmed);
  for (const [candidate, translationKey] of Object.entries(map)) {
    if (normalize(candidate) === normalized) {
      return t(translationKey);
    }
  }

  return value;
}

function localizeDecisionReason(value) {
  return localizeKnownContent(value, {
    "Automatically routed to manual review due to red flag / confidence / borderline rule.":
      "result.decisionReasonValue.autoManualReview",
    "Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.":
      "result.decisionReasonValue.autoManualReview",
    "Automatic pass by threshold rules.": "result.decisionReasonValue.autoPass",
    "Automatic fail by threshold rules.": "result.decisionReasonValue.autoFail",
    "Automatic fail due to insufficient submission evidence.":
      "result.decisionReasonValue.autoFailInsufficientEvidence",
  });
}

function localizeConfidence(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (
      normalized.includes("low confidence") &&
      (normalized.includes("sparse") ||
        normalized.includes("limited cues") ||
        normalized.includes("partial evidence"))
    ) {
      return t("result.confidenceValue.low");
    }
  }

  return localizeKnownContent(value, {
    "Low confidence due to sparse content; assessment based on partial evidence; more details would improve accuracy.":
      "result.confidenceValue.low",
    "Low confidence in alignment due to sparse content; assessment based on limited cues.":
      "result.confidenceValue.low",
    "Medium confidence due to potential responsible-use ambiguity.":
      "result.confidenceValue.medium",
    "High confidence: structured and sufficiently detailed submission.":
      "result.confidenceValue.high",
  });
}

function localizeImprovementAdvice(values) {
  return localizeImprovementAdviceItems(values).join("; ");
}

function localizeImprovementAdviceItems(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const mapping = {
    "Provide clearer before/after examples.": "result.improvementAdviceValue.beforeAfter",
    "Describe concrete validation checks you performed.":
      "result.improvementAdviceValue.validationChecks",
    "Reference responsible-use constraints explicitly.":
      "result.improvementAdviceValue.responsibleUse",
    "Specify concrete risk scenarios, owners, and mitigations tied to the module.":
      "result.improvementAdviceValue.riskScenarios",
    "Add a data handling and privacy section, including logging and retention.":
      "result.improvementAdviceValue.dataHandling",
    "Define a human-in-the-loop process and approval steps.":
      "result.improvementAdviceValue.humanInLoop",
    "Include measurable QA metrics and acceptance criteria.":
      "result.improvementAdviceValue.qaMetrics",
    "Provide a concrete improvement loop with iterations and feedback capture.":
      "result.improvementAdviceValue.improvementLoop",
    "Clarify responsible-use guidelines and safeguards against prompt leakage.":
      "result.improvementAdviceValue.promptLeakage",
    "Define governance scope, risk owners, and monitoring cadence.":
      "result.improvementAdviceValue.governanceScope",
    "Map content to risk categories (STRIDE, CIA triad, or equivalent).":
      "result.improvementAdviceValue.riskCategories",
    "Incorporate a concrete QA process with checklists and independent review.":
      "result.improvementAdviceValue.qaChecklist",
    "Specify data handling, privacy, retention, and security controls.":
      "result.improvementAdviceValue.dataControls",
    "Articulate acceptance criteria and thresholds for quality and risk.":
      "result.improvementAdviceValue.qualityThresholds",
    "Outline an iteration plan with feedback loops and versioning.":
      "result.improvementAdviceValue.iterationVersioning",
    "Clarify escalation procedures and decision rights.":
      "result.improvementAdviceValue.escalationDecisionRights",
    "Include artefacts like risk register, control mapping, and audit trails.":
      "result.improvementAdviceValue.artifactsEvidence",
    "Align prompts with responsible AI principles and misuse safeguards.":
      "result.improvementAdviceValue.responsibleAiMisuse",
    "Provide example outputs and mitigations for common failure modes.":
      "result.improvementAdviceValue.examplesFailureModes",
  };

  return values.map((value) => localizeKnownContent(value, mapping));
}

function localizeCriterionRationale(value) {
  return localizeKnownContent(value, {
    "Stub: submission appears relevant to the module task.":
      "result.rationaleValue.relevance_for_case",
    "Stub: output shows practical utility.": "result.rationaleValue.quality_and_utility",
    "Stub: at least one improvement iteration is visible.":
      "result.rationaleValue.iteration_and_improvement",
    "Stub: includes human QA/reflection markers.":
      "result.rationaleValue.human_quality_assurance",
    "Stub: responsible-use checks inferred from provided content.":
      "result.rationaleValue.responsible_use",
  });
}

function deriveAssessmentProgressKeyFromSubmissionStatus(status, latestJobStatus) {
  const normalizedStatus = typeof status === "string" ? status.toUpperCase() : "";
  const normalizedJobStatus = typeof latestJobStatus === "string" ? latestJobStatus.toUpperCase() : "";

  if (normalizedJobStatus === "FAILED") {
    return "assessment.progress.failed";
  }
  if (normalizedStatus === "COMPLETED") {
    return "assessment.progress.completed";
  }
  if (normalizedStatus === "UNDER_REVIEW") {
    return "assessment.progress.underReview";
  }
  if (normalizedStatus === "SCORED") {
    return "assessment.progress.completed";
  }
  if (normalizedStatus === "PROCESSING" || normalizedJobStatus === "RUNNING" || normalizedJobStatus === "PENDING") {
    return "assessment.progress.waiting";
  }
  if (normalizedStatus === "SUBMITTED") {
    return "assessment.progress.waiting";
  }
  return "assessment.progress.idle";
}

function renderAssessmentProgress() {
  hideLoading(assessmentProgressStatus);
  const base = t(assessmentProgressKey);
  let statusText = base;

  if (!assessmentProgressDetailKey) {
    statusText = base;
  } else {
    const detail = t(assessmentProgressDetailKey);
    if (typeof assessmentProgressDetailCountdown === "number") {
      statusText = `${base} ${detail} ${assessmentProgressDetailCountdown}s`;
    } else {
      statusText = `${base} ${detail}`;
    }
  }
  assessmentProgressStatus.textContent = statusText;

  const hasAutoTimer =
    autoAssessmentTicker !== null &&
    typeof autoAssessmentElapsedSeconds === "number" &&
    autoAssessmentElapsedSeconds >= 0;

  if (!hasAutoTimer) {
    assessmentProgressSeconds.textContent = "";
    assessmentProgressSeconds.classList.add("hidden");
    return;
  }

  assessmentProgressSeconds.textContent = `${t("assessment.auto.elapsedLabel")} ${autoAssessmentElapsedSeconds}s`;
  assessmentProgressSeconds.classList.remove("hidden");
}

function renderAppealState() {
  if (previewModeEnabled) {
    appealSection.classList.add("hidden");
    createAppealButton.classList.add("hidden");
    appealSubmittedStatus.textContent = "";
    appealNextSteps.textContent = "";
    appealIdLabel.textContent = "-";
    return;
  }

  const hasAppeal = latestAppeal && typeof latestAppeal.id === "string";
  const isNegativeResult = latestResult?.decision?.passFailTotal === false;
  const shouldShowAppealSection = hasAppeal || isNegativeResult;

  appealSection.classList.toggle("hidden", !shouldShowAppealSection);

  if (!shouldShowAppealSection) {
    createAppealButton.classList.add("hidden");
    appealSubmittedStatus.textContent = "";
    appealNextSteps.textContent = "";
    appealIdLabel.textContent = "-";
    return;
  }

  if (hasAppeal) {
    createAppealButton.classList.add("hidden");
    createAppealButton.disabled = true;
    appealSubmittedStatus.textContent =
      `${t("appeal.submittedPrefix")}: ${latestAppeal.id} (${localizeAppealStatus(latestAppeal.appealStatus)})`;
    appealNextSteps.textContent = t("appeal.nextSteps");
    appealIdLabel.textContent = latestAppeal.id;
    return;
  }

  createAppealButton.classList.remove("hidden");
  appealIdLabel.textContent = "-";
  appealSubmittedStatus.textContent = t("appeal.readyForSubmission");
  appealNextSteps.textContent = "";
}

function clearSummaryContainer(element) {
  if (!element) {
    return;
  }

  element.innerHTML = "";
}

function createSummaryCard(title) {
  const card = document.createElement("section");
  card.className = "summary-card";

  if (title) {
    const heading = document.createElement("div");
    heading.className = "summary-card-title";
    heading.textContent = title;
    card.appendChild(heading);
  }

  return card;
}

function appendSummaryRow(container, label, value, valueClass) {
  const row = document.createElement("div");
  row.className = "summary-row";

  const labelNode = document.createElement("div");
  labelNode.className = "summary-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("div");
  valueNode.className = valueClass ? `summary-value ${valueClass}` : "summary-value";
  valueNode.textContent = value;

  row.append(labelNode, valueNode);
  container.appendChild(row);
}

function appendSummaryList(container, title, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }

  const card = createSummaryCard(title);
  const list = document.createElement("ul");
  list.className = "summary-list";

  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.appendChild(item);
  }

  card.appendChild(list);
  container.appendChild(card);
}

function formatHistoryModuleValue(module) {
  const moduleTitle = module?.title ?? "-";
  if (!shouldShowModuleDebugMeta()) {
    return moduleTitle;
  }

  const moduleId = module?.id ?? "-";
  return `${moduleTitle} (${t("modules.debugId")}: ${moduleId})`;
}

// #549/#550: lightweight, dependency-free confetti for celebrating a pass / course completion.
// Decorative only — wrapped so it can never throw into the calling flow.
function launchConfetti() {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9998";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const colors = ["#2563eb", "#16a34a", "#f59e0b", "#db2777", "#7c3aed"];
    const pieces = Array.from({ length: 140 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.3,
      r: 4 + Math.random() * 6,
      c: colors[Math.floor(Math.random() * colors.length)],
      vy: 2 + Math.random() * 3.5,
      vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: -0.12 + Math.random() * 0.24,
    }));
    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r);
        ctx.restore();
      }
      if (elapsed < 2600) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  } catch {
    /* confetti is decorative; never block the result flow on it */
  }
}

function renderResultSummary(body) {
  latestResult = body;
  latestAppeal = body?.latestAppeal ?? latestAppeal;

  if (!body) {
    resultSummary.dataset.hasResult = "";
    clearSummaryContainer(resultSummary);
    resultSummary.textContent = t("result.none");
    renderAppealState();
    return;
  }

  assessmentProgressKey = deriveAssessmentProgressKeyFromSubmissionStatus(
    body.status,
    body?.assessment?.latestJob?.status,
  );
  renderAssessmentProgress();

  // Track the outcome so renderFlowGating can de-emphasise the retry button once passed.
  flowState.resultPassFail = body?.decision?.passFailTotal ?? null;

  clearSummaryContainer(resultSummary);
  const summaryCard = createSummaryCard("");
  const summaryGrid = document.createElement("div");
  summaryGrid.className = "summary-grid";
  appendSummaryRow(summaryGrid, t("result.status"), localizeSubmissionStatus(body.status));
  appendSummaryRow(summaryGrid, t("result.statusExplanation"), localizeStatusExplanation(body.status));
  appendSummaryRow(summaryGrid, t("result.totalScore"), formatNumber(body.scoreComponents?.totalScore));
  // #591: only show the score components that actually count for the module type — a 0 from a
  // component the module doesn't have (MCQ for free-text-only, practical for MCQ-only) just confuses
  // the participant. Principle: don't show information the user doesn't need.
  if (!selectedModuleIsFreetextOnly()) {
    appendSummaryRow(summaryGrid, t("result.mcqScore"), formatNumber(body.scoreComponents?.mcqScaledScore));
  }
  if (!selectedModuleIsMcqOnly()) {
    appendSummaryRow(summaryGrid, t("result.practicalScore"), formatNumber(body.scoreComponents?.practicalScaledScore));
  }
  appendSummaryRow(summaryGrid, t("result.decision"), localizeDecisionType(body.decision?.decisionType, body.status, body.decision?.passFailTotal), outcomeClass(body.decision?.passFailTotal, body.status));
  appendSummaryRow(
    summaryGrid,
    t("result.decisionReason"),
    localizeDecisionReason(body.participantGuidance?.decisionReason),
  );
  appendSummaryRow(
    summaryGrid,
    t("result.confidence"),
    localizeConfidence(body.participantGuidance?.confidenceNote),
  );
  summaryCard.appendChild(summaryGrid);
  resultSummary.appendChild(summaryCard);

  appendSummaryList(
    resultSummary,
    t("result.improvementAdvice"),
    localizeImprovementAdviceItems(body.participantGuidance?.improvementAdvice),
  );

  const rationales = body.participantGuidance?.criterionRationales ?? {};
  const rationaleEntries = Object.entries(rationales);
  if (rationaleEntries.length > 0) {
    const rationaleCard = createSummaryCard(t("result.rationales"));
    const rationaleList = document.createElement("ul");
    rationaleList.className = "summary-list";

    for (const [criterion, rationale] of rationaleEntries) {
      const item = document.createElement("li");
      item.textContent = `${localizeCriterionName(criterion)}: ${localizeCriterionRationale(String(rationale))}`;
      rationaleList.appendChild(item);
    }

    rationaleCard.appendChild(rationaleList);
    resultSummary.appendChild(rationaleCard);
  }

  // #549: celebrate an automatic/confirmed pass — confetti + a clear "passed" banner, shown once
  // per result (the result view re-renders on each poll). De-emphasising retry is handled in
  // renderFlowGating.
  if (body.decision?.passFailTotal === true && !celebrationShown) {
    celebrationShown = true;
    const banner = document.createElement("div");
    banner.className = "celebrate-banner";
    banner.textContent = t("result.celebratePass");
    resultSummary.prepend(banner);
    launchConfetti();
    // #550 feedback: passing a module can complete a course — refresh the (possibly off-screen)
    // course list so its status updates and the course-completion confetti can fire.
    if (participantCourses.length > 0) {
      loadParticipantCourses().catch(() => {});
    }
  }

  resultSummary.dataset.hasResult = "true";
  renderAppealState();
}

function renderHistorySummary(body) {
  hideLoading(historySummary);
  latestHistory = body;
  const history = body?.history ?? [];

  if (!Array.isArray(history) || history.length === 0) {
    historySummary.dataset.hasHistory = "";
    clearSummaryContainer(historySummary);
    showEmpty(historySummary, t("history.empty"));
    return;
  }

  clearSummaryContainer(historySummary);
  for (const item of history) {
    const card = createSummaryCard(`${t("history.submittedAt")}: ${formatDateTime(item.submittedAt)}`);
    const grid = document.createElement("div");
    grid.className = "summary-grid";
    if (shouldShowModuleDebugMeta()) {
      appendSummaryRow(grid, t("modules.debugId"), item.submissionId);
    }
    appendSummaryRow(grid, t("history.module"), formatHistoryModuleValue(item.module));
    appendSummaryRow(grid, t("history.latestStatus"), localizeSubmissionStatus(item.status));
    appendSummaryRow(
      grid,
      t("history.latestDecision"),
      localizeDecisionType(item.latestDecision?.decisionType, item.status, item.latestDecision?.passFailTotal),
      outcomeClass(item.latestDecision?.passFailTotal, item.status),
    );
    appendSummaryRow(grid, t("history.latestScore"), formatNumber(item.latestDecision?.totalScore));
    card.appendChild(grid);
    historySummary.appendChild(card);
  }

  historySummary.dataset.hasHistory = "true";
}

async function startMcqForSubmission(moduleId, submissionId) {
  if (!moduleId || !submissionId || submissionId === "-") {
    throw new Error(t("errors.createSubmissionFirst"));
  }

  const body = await apiFetch(
    `/api/modules/${moduleId}/mcq/start?submissionId=${encodeURIComponent(submissionId)}`,
    headers,
  );
  attemptIdLabel.textContent = body.attemptId;
  currentQuestions = body.questions;
  renderQuestions();
  scheduleDraftAutosave();
  return body;
}

function clearCurrentModuleDraft() {
  const selectedModule = resolveSelectedModule(loadedModules, selectedModuleId);
  if (!selectedModule) {
    setDraftStatus("none", "");
    return;
  }

  const moduleDrafts = readModuleDraftMap();
  delete moduleDrafts[selectedModule.id];
  writeModuleDraftMap(moduleDrafts);

  resetModuleDraftInputsToDefaultLocaleValues();
  currentQuestions = [];
  attemptIdLabel.textContent = "-";
  renderQuestions();
  resetFlowStateForModuleContext();
  setDraftStatus("cleared", selectedModule.title);
}

function renderPreviewResultSummary(answeredCount, totalCount, hasMcq) {
  resultSummary.dataset.hasResult = "true";
  clearSummaryContainer(resultSummary);
  const card = createSummaryCard("");

  if (!hasMcq) {
    const message = document.createElement("div");
    message.className = "summary-value";
    message.textContent = t("preview.resultNoMcq");
    card.appendChild(message);
    resultSummary.appendChild(card);
    return;
  }

  const message = document.createElement("div");
  message.className = "summary-value";
  message.textContent = `${t("preview.resultPrefix")}: ${answeredCount}/${totalCount}. ${t("preview.resultSuffix")}`;
  card.appendChild(message);
  resultSummary.appendChild(card);
}

function loadPreviewModules(options = {}) {
  const { notify = true } = options;
  const previewPayload = readParticipantPreviewPayload();
  const previewModule = buildPreviewModuleFromPayload(previewPayload);

  hasLoadedModules = true;

  if (!previewModule) {
    loadedModules = [];
    selectedModuleId = "";
    resetFlowStateForModuleContext();
    renderModules();
    renderSelectedModuleSummary();
    updateCreateSubmissionAvailability();
    if (notify) {
      log(t("preview.empty"));
    }
    return null;
  }

  loadedModules = [previewModule];
  if (selectedModuleId !== previewModule.id) {
    selectedModuleId = previewModule.id;
    resetFlowStateForModuleContext();
  }

  renderModules();
  renderSelectedModuleSummary();
  restoreDraftForSelectedModule(false);
  updateCreateSubmissionAvailability();

  if (notify) {
    log({
      previewModule: {
        id: previewModule.id,
        title: previewModule.title,
        questionCount: previewModule.previewQuestions.length,
      },
    });
  }

  return previewModule;
}

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, async () => {
    try {
      const body = await apiFetch("/api/me", headers);
      log(body);
    } catch (error) {
      log(error.message);
    }
  });
});

loadModulesButton.addEventListener("click", async () => {
  // v1.2.22 (#465): klikk på "Last moduler" ekspanderer modullisten igjen om den var
  // kollapset etter modul-aktivering.
  document.getElementById("moduleListSection")?.classList.remove("module-list-collapsed");
  await runWithBusyButton(loadModulesButton, async () => {
    try {
      showLoading(moduleList, { rows: 3, variant: "cards" });
      if (previewModeEnabled) {
        loadPreviewModules();
        return;
      }
      const body = await apiFetch("/api/modules?includeCompleted=true", headers);
      loadedModules = Array.isArray(body.modules) ? body.modules : [];
      hasLoadedModules = true;
      syncParticipantModuleWorkspace({ restoreDraft: true });
      log(body);
    } catch (error) {
      showEmpty(moduleList, error.message);
      log(error.message);
    }
  });
});

createSubmissionButton.addEventListener("click", async () => {
  await runWithBusyButton(createSubmissionButton, async () => {
    try {
      const validation = validateSubmissionInputState();
      if (!validation.valid) {
        applySubmissionValidationFeedback(validation);
        validation.invalidFieldElement?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        throw new Error(t(validation.hintKey));
      }

      if (previewModeEnabled) {
        const selectedModule = resolveSelectedModule(loadedModules, selectedModuleId);
        if (!selectedModule) {
          throw new Error(t("errors.selectModuleFirst"));
        }

        submissionIdLabel.textContent = `preview-${selectedModule.id}`;
        attemptIdLabel.textContent = selectedModule.previewQuestions.length > 0 ? `preview-${selectedModule.id}-mcq` : "-";
        currentQuestions = selectedModule.previewQuestions;
        stopAutoAssessmentLoop(true);
        latestAppeal = null;
        assessmentProgressKey = selectedModule.previewQuestions.length > 0
          ? "assessment.progress.idle"
          : "assessment.progress.preview";
        setAssessmentProgressDetail();
        flowState = {
          hasSubmission: true,
          hasMcqSubmission: selectedModule.previewQuestions.length === 0,
          assessmentQueued: false,
          resultStatus: selectedModule.previewQuestions.length === 0 ? "PREVIEW" : null,
        };
        renderQuestions();
        if (selectedModule.previewQuestions.length === 0) {
          renderPreviewResultSummary(0, 0, false);
        } else {
          renderResultSummary(null);
        }
        renderAssessmentProgress();
        renderAppealState();
        renderFlowGating();
        log({
          previewSubmission: {
            moduleId: selectedModule.id,
            questionCount: selectedModule.previewQuestions.length,
          },
        });
        return;
      }

      const moduleId = selectedModuleId;
      const responseJson = {};
      for (const field of currentSubmissionFields) {
        const element = submissionFieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
        responseJson[field.id] = element?.value ?? "";
      }
      // MCQ-only modules send an empty submission (no free-text); acknowledgement is implicit
      // since there is no deliverable to take responsibility for (#525).
      const body = await apiFetch("/api/submissions", headers, {
        method: "POST",
        body: JSON.stringify({
          moduleId,
          deliveryType: "text",
          responseJson,
          responsibilityAcknowledged: selectedModuleIsMcqOnly() ? true : ackCheckbox.checked,
        }),
      });
      submissionIdLabel.textContent = body.submission.id;
      stopAutoAssessmentLoop(true);
      latestAppeal = null;
      assessmentProgressKey = "assessment.progress.idle";
      setAssessmentProgressDetail();
      renderResultSummary(null);
      flowState = {
        hasSubmission: true,
        hasMcqSubmission: false,
        assessmentQueued: false,
        resultStatus: null,
      };
      renderAssessmentProgress();
      renderAppealState();
      renderFlowGating();
      // #578: FREETEXT_ONLY has no MCQ — don't start an MCQ attempt (the server would 400). The
      // assessment runs directly on the free-text submission (auto if enabled, otherwise via the
      // now-unlocked "Start assessment" button).
      if (selectedModuleIsFreetextOnly()) {
        await startAutomaticAssessmentFlow(body.submission.id);
        log({ submission: body.submission });
      } else {
        const mcqStartBody = await startMcqForSubmission(moduleId, body.submission.id);
        log({
          submission: body.submission,
          mcqStarted: {
            attemptId: mcqStartBody.attemptId,
            questionCount: Array.isArray(mcqStartBody.questions) ? mcqStartBody.questions.length : 0,
          },
        });
      }
    } catch (error) {
      log(error.message);
    }
  }, updateCreateSubmissionAvailability);
});

submitMcqButton.addEventListener("click", async () => {
  await runWithBusyButton(submitMcqButton, async () => {
    try {
      if (previewModeEnabled) {
        if (!flowState.hasSubmission) {
          throw new Error(t("errors.startMcqFirst"));
        }

        const unanswered = currentQuestions.some(
          (question) => !document.querySelector(`input[name='q_${question.id}']:checked`),
        );
        if (unanswered) {
          throw new Error(t("preview.mcqCompleteAll"));
        }

        flowState = {
          ...flowState,
          hasMcqSubmission: true,
          assessmentQueued: false,
          resultStatus: "PREVIEW",
        };
        assessmentProgressKey = "assessment.progress.preview";
        setAssessmentProgressDetail();
        renderPreviewResultSummary(currentQuestions.length, currentQuestions.length, true);
        renderAssessmentProgress();
        renderFlowGating();
        persistCurrentModuleDraft(true);
        log({
          previewMcq: {
            questionCount: currentQuestions.length,
          },
        });
        return;
      }

      const moduleId = selectedModuleId;
      const submissionId = submissionIdLabel.textContent;
      const attemptId = attemptIdLabel.textContent;
      if (!moduleId || !submissionId || !attemptId || attemptId === "-") {
        throw new Error(t("errors.startMcqFirst"));
      }

      const responses = currentQuestions.map((q) => {
        const selected = document.querySelector(`input[name='q_${q.id}']:checked`);
        return {
          questionId: q.id,
          selectedAnswer: selected ? selected.value : "",
        };
      });

      const body = await apiFetch(`/api/modules/${moduleId}/mcq/submit`, headers, {
        method: "POST",
        body: JSON.stringify({
          submissionId,
          attemptId,
          responses,
        }),
      });
      currentQuestions = [];
      renderQuestions();
      // #2 fix: MCQ-only submissions are finalised synchronously (assessmentComplete) — the
      // assessment is already done, so we must NOT auto-run it (that 409s against the recert
      // re-run guard). Just fetch + show the ready result.
      const alreadyAssessed = body.assessmentComplete === true;
      flowState = {
        ...flowState,
        hasMcqSubmission: true,
        assessmentQueued: !alreadyAssessed && getFlowSettings().autoStartAfterMcq,
        resultStatus: null,
      };
      assessmentProgressKey = "assessment.progress.idle";
      setAssessmentProgressDetail();
      renderAssessmentProgress();
      renderFlowGating();
      persistCurrentModuleDraft(true);
      if (alreadyAssessed) {
        const resultBody = await apiFetch(`/api/submissions/${submissionId}/result`, headers);
        // Sync resultStatus from the fetched result so the flow knows the assessment is ready —
        // otherwise hasResultStatus stays false and the retry button never appears (also on fail).
        flowState = {
          ...flowState,
          resultStatus: typeof resultBody.status === "string" ? resultBody.status : "COMPLETED",
        };
        renderResultSummary(resultBody);
        renderFlowGating();
      } else if (getFlowSettings().autoStartAfterMcq) {
        await startAutomaticAssessmentFlow(submissionId);
      }
      log(body);
    } catch (error) {
      log(error.message);
    }
  });
});

queueAssessmentButton.addEventListener("click", async () => {
  await runWithBusyButton(queueAssessmentButton, async () => {
    try {
      stopAutoAssessmentLoop(true);
      const submissionId = submissionIdLabel.textContent;
      if (!submissionId || submissionId === "-") {
        throw new Error(t("errors.createSubmissionFirst"));
      }
      const body = await apiFetch(`/api/assessments/${submissionId}/run`, headers, {
        method: "POST",
        body: JSON.stringify({}),
      });
      flowState = {
        ...flowState,
        assessmentQueued: true,
      };
      assessmentProgressKey = "assessment.progress.waiting";
      setAssessmentProgressDetail();
      renderAssessmentProgress();
      renderFlowGating();
      log(body);
    } catch (error) {
      log(error.message);
    }
  }, renderFlowGating);
});

checkAssessmentButton.addEventListener("click", async () => {
  await runWithBusyButton(checkAssessmentButton, async () => {
    try {
      showLoading(assessmentProgressStatus, { rows: 1 });
      assessmentProgressSeconds.textContent = "";
      assessmentProgressSeconds.classList.add("hidden");
      const submissionId = submissionIdLabel.textContent;
      if (!submissionId || submissionId === "-") {
        throw new Error(t("errors.createSubmissionFirst"));
      }
      const body = await apiFetch(`/api/assessments/${submissionId}`, headers);
      assessmentProgressKey = deriveAssessmentProgressKeyFromSubmissionStatus(
        body.submissionStatus,
        body.latestJob?.status,
      );
      setAssessmentProgressDetail();
      renderAssessmentProgress();
      log(body);
    } catch (error) {
      showEmpty(assessmentProgressStatus, error.message);
      assessmentProgressSeconds.textContent = "";
      assessmentProgressSeconds.classList.add("hidden");
      log(error.message);
    }
  }, renderFlowGating);
});

checkResultButton.addEventListener("click", async () => {
  await runWithBusyButton(checkResultButton, async () => {
    try {
      stopAutoAssessmentLoop(true);
      const submissionId = submissionIdLabel.textContent;
      if (!submissionId || submissionId === "-") {
        throw new Error(t("errors.createSubmissionFirst"));
      }
      const body = await apiFetch(`/api/submissions/${submissionId}/result`, headers);
      renderResultSummary(body);
      flowState = {
        ...flowState,
        resultStatus: typeof body.status === "string" ? body.status : null,
      };
      renderFlowGating();
      log(body);
    } catch (error) {
      log(error.message);
    }
  }, renderFlowGating);
});

createAppealButton.addEventListener("click", async () => {
  await runWithBusyButton(createAppealButton, async () => {
    try {
      const submissionId = submissionIdLabel.textContent;
      if (!submissionId || submissionId === "-") {
        throw new Error(t("errors.createSubmissionFirst"));
      }
      const appealReason = appealReasonInput.value;
      const body = await apiFetch(`/api/submissions/${submissionId}/appeals`, headers, {
        method: "POST",
        body: JSON.stringify({ appealReason }),
      });
      latestAppeal = body.appeal;
      appealIdLabel.textContent = body.appeal.id;
      renderAppealState();
      log(body);
    } catch (error) {
      log(error.message);
    }
  }, renderFlowGating);
});

loadHistoryButton.addEventListener("click", async () => {
  await runWithBusyButton(loadHistoryButton, async () => {
    try {
      showLoading(historySummary, { rows: 4 });
      const body = await apiFetch("/api/submissions/history?limit=20", headers);
      renderHistorySummary(body);
      log(body);
    } catch (error) {
      showEmpty(historySummary, error.message);
      log(error.message);
    }
  });
});

resetSubmissionFlowButton.addEventListener("click", async () => {
  await runWithBusyButton(resetSubmissionFlowButton, async () => {
    clearCurrentModuleDraft();
    updateCreateSubmissionAvailability();
  });
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


ackCheckbox.addEventListener("change", () => {
  updateCreateSubmissionAvailability();
});

window.addEventListener("beforeunload", () => {
  stopAutoAssessmentLoop(false);
  persistCurrentModuleDraft(false);
});

function renderQuestions(selectedResponses = {}) {
  mcqQuestions.innerHTML = "";
  for (const [index, question] of currentQuestions.entries()) {
    const wrapper = document.createElement("fieldset");
    wrapper.className = "mcq-question-card";

    const titleRow = document.createElement("div");
    titleRow.className = "mcq-question-header";

    const numberBadge = document.createElement("span");
    numberBadge.className = "mcq-question-index";
    numberBadge.textContent = String(index + 1);
    titleRow.appendChild(numberBadge);

    const title = document.createElement("legend");
    title.className = "mcq-question-title";
    title.textContent = question.stem;
    titleRow.appendChild(title);
    wrapper.appendChild(titleRow);

    const optionList = document.createElement("div");
    optionList.className = "mcq-option-list";

    for (const option of question.options) {
      const label = document.createElement("label");
      label.className = "mcq-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q_${question.id}`;
      input.value = option;
      input.checked = selectedResponses[question.id] === option;
      input.addEventListener("change", () => {
        scheduleDraftAutosave();
      });
      input.className = "mcq-option-input";
      const text = document.createElement("span");
      text.className = "mcq-option-label";
      text.textContent = option;
      label.appendChild(input);
      label.appendChild(text);
      optionList.appendChild(label);
    }

    wrapper.appendChild(optionList);
    mcqQuestions.appendChild(wrapper);
  }

  // Re-evaluate button state after MCQ questions are loaded/cleared.
  renderFlowGating();
}

populateLocaleSelect();
setLocale(currentLocale);
loadVersion();
loadParticipantConsoleConfig();
if (previewModeEnabled) {
  loadPreviewModules({ notify: false });
}

// ============================================================
// Participant courses
// ============================================================

let participantCourses = [];
let participantCompletions = {};   // courseId -> completion
// #550: celebrate a course completion only when it happens during the session (e.g. the
// participant just passed the last module / read the last section), not for already-completed
// courses on first load.
const celebratedCompletedCourses = new Set();
let courseAccordionInitialized = false;
let courseDetailCache = {};        // courseId -> CourseDetail


document.getElementById("loadCoursesBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("loadCoursesBtn");
  await runWithBusyButton(btn, async () => {
    try {
      await loadParticipantCourses();
    } catch (error) {
      log(error instanceof Error ? error.message : t("courses.loadError"));
    }
  });
});

async function loadParticipantCourses() {
  const [coursesBody, completionsBody] = await Promise.all([
    apiFetch("/api/courses", headers),
    apiFetch("/api/courses/completions", headers),
  ]);
  participantCourses = Array.isArray(coursesBody.courses) ? coursesBody.courses : [];
  participantCompletions = {};
  if (Array.isArray(completionsBody.completions)) {
    for (const c of completionsBody.completions) {
      participantCompletions[c.courseId] = c;
    }
  }
  // Reloading the course list rebuilds the accordion with fresh "loading…" detail containers;
  // invalidate the per-course detail cache so expanding re-fetches into the new container instead
  // of skipping the fetch and leaving the placeholder stuck (#550 follow-up).
  courseDetailCache = {};
  renderParticipantCourseAccordion();
}

function renderParticipantCourseAccordion() {
  const container = document.getElementById("courseAccordion");
  if (!container) return;
  if (participantCourses.length === 0) {
    container.innerHTML = `<p class="small" style="color:var(--color-meta);margin-top:4px">${escapeHtmlP(t("courses.empty"))}</p>`;
    return;
  }
  container.innerHTML = "";
  for (const course of participantCourses) {
    container.appendChild(buildCourseAccordionItem(course));
  }

  // #550: confetti when a course becomes completed during this session.
  let newlyCompleted = false;
  for (const course of participantCourses) {
    const isCompleted = Boolean(participantCompletions[course.id]) || course.progress?.courseStatus === "COMPLETED";
    if (!isCompleted) continue;
    if (!celebratedCompletedCourses.has(course.id)) {
      celebratedCompletedCourses.add(course.id);
      if (courseAccordionInitialized) newlyCompleted = true;
    }
  }
  if (newlyCompleted) {
    launchConfetti();
    showToast(t("courses.celebrateComplete"), "success");
  }
  courseAccordionInitialized = true;

  // Deep link: ?courseId=xxx opens that course
  const linkedCourseId = new URLSearchParams(window.location.search).get("courseId");
  if (linkedCourseId) {
    const header = container.querySelector(`[data-course-id="${linkedCourseId}"] .course-accordion-header`);
    if (header) {
      header.click();
      setTimeout(() => header.closest(".course-accordion-item").scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }
}

// #714: vis fremdrift per type («Moduler x/y · Seksjoner x/y») i stedet for den misvisende
// «x/total moduler» (total teller med seksjoner). Faller tilbake til x/total hvis backend mangler
// per-type-feltene (eldre respons).
function formatCourseProgressLabel(progress) {
  const p = progress ?? {};
  const parts = [];
  if ((p.moduleTotal ?? 0) > 0) parts.push(`${t("courses.progress.modules")} ${p.moduleCompleted ?? 0}/${p.moduleTotal}`);
  if ((p.sectionTotal ?? 0) > 0) parts.push(`${t("courses.progress.sections")} ${p.sectionCompleted ?? 0}/${p.sectionTotal}`);
  if (parts.length === 0) return `${p.completed ?? 0}/${p.total ?? 0}`;
  return parts.join(" · ");
}

// #492: finn neste uferdige element i sekvensen (uleste seksjoner / ikke-beståtte tilgjengelige moduler).
function findNextIncompleteEntry(sequence) {
  if (!Array.isArray(sequence)) return null;
  return sequence.find((e) =>
    e.type === "SECTION" ? !e.read : e.moduleStatus !== "PASSED" && e.available !== false,
  ) ?? null;
}

function openCourseItemEntry(courseId, entry) {
  if (!entry) return;
  if (entry.type === "SECTION") {
    openSectionReader(courseId, entry.sectionId, entry.courseItemId, entry.discussionsEnabled);
  } else {
    openCourseModule(courseId, entry.moduleId);
  }
}

function buildCourseAccordionItem(course) {
  const courseStatus = course.progress?.courseStatus ?? "NOT_STARTED";
  const completed = courseStatus === "COMPLETED";
  const inProgress = courseStatus === "IN_PROGRESS";
  const passedCount = course.progress?.completed ?? 0;
  const totalCount = course.progress?.total ?? course.moduleCount ?? 0;
  const pct = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
  const completion = participantCompletions[course.id];

  const item = document.createElement("div");
  item.className = "course-accordion-item";
  item.dataset.courseId = course.id;

  const statusText = completed
    ? t("courses.status.completed")
    : inProgress
    ? t("courses.status.inProgress")
    : t("courses.status.notStarted");
  const badgeClass = completed ? "completed" : inProgress ? "retake" : "";

  item.innerHTML = `
    <button type="button" class="course-accordion-header" aria-expanded="false">
      <span>
        <span class="course-accordion-title">${escapeHtmlP(localizePreviewText(course.title))}</span>
        <span class="course-accordion-progress">${escapeHtmlP(formatCourseProgressLabel(course.progress))}</span>
      </span>
      <span class="module-status-badge ${badgeClass}" style="font-size:11px;padding:2px 8px;flex-shrink:0">${escapeHtmlP(statusText)}</span>
      <span class="course-accordion-chevron">&#9662;</span>
    </button>
    <div class="course-accordion-body">
      <div class="course-progress-bar"><div class="course-progress-fill${completed ? " completed" : ""}" style="width:${pct}%"></div></div>
      ${completion ? `<div class="course-certificate-banner">${escapeHtmlP(t("courses.certificate.earned"))} - <span style="font-family:monospace;font-size:12px">${escapeHtmlP(completion.certificateId)}</span> · <a href="/certificate?id=${encodeURIComponent(completion.certificateId)}" target="_blank" rel="noopener">${escapeHtmlP(t("courses.certificate.view"))}</a></div>` : ""}
      <div id="courseDetail_${course.id}"><p class="small" style="color:var(--color-meta)">${escapeHtmlP(t("courses.loadingModules"))}</p></div>
    </div>
  `;

  item.querySelector(".course-accordion-header").addEventListener("click", async () => {
    const isOpen = item.classList.toggle("open");
    item.querySelector(".course-accordion-header").setAttribute("aria-expanded", String(isOpen));
    if (isOpen && !courseDetailCache[course.id]) {
      await loadCourseDetail(course.id);
    }
  });

  return item;
}

async function loadCourseDetail(courseId) {
  const container = document.getElementById(`courseDetail_${courseId}`);
  try {
    const body = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}`, headers);
    courseDetailCache[courseId] = body.course;
    renderCourseDetailModules(courseId, body.course);
  } catch (error) {
    if (container) {
      container.innerHTML = `<p class="small" style="color:var(--color-error)">${escapeHtmlP(error instanceof Error ? error.message : t("courses.loadError"))}</p>`;
    }
  }
}

function renderCourseDetailModules(courseId, course) {
  const container = document.getElementById(`courseDetail_${courseId}`);
  if (!container) return;
  // Prefer the mixed module/section sequence (#491); fall back to modules-only.
  const sequence = Array.isArray(course?.items) && course.items.length > 0
    ? course.items
    : (Array.isArray(course?.modules) ? course.modules.map((m) => ({ type: "MODULE", ...m })) : null);
  if (!sequence) return;
  container.innerHTML = "";
  if (sequence.length === 0) {
    // Tomt kurs (ingen moduler/seksjoner) — vis melding, men fall gjennom så kurs-nivå
    // diskusjonsboardet fortsatt monteres (#495/T-QA-3).
    container.innerHTML = `<p class="small" style="color:var(--color-meta)">${escapeHtmlP(t("courses.noModules"))}</p>`;
  }
  // #492: «Fortsett der du slapp» / «Start kurset» — hopp rett til neste uferdige element.
  const nextEntry = findNextIncompleteEntry(sequence);
  if (sequence.length > 0 && nextEntry) {
    const anyComplete = sequence.some((e) => (e.type === "SECTION" ? e.read : e.moduleStatus === "PASSED"));
    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "btn btn-primary course-resume-btn";
    resumeBtn.textContent = anyComplete ? t("courses.resume") : t("courses.start");
    resumeBtn.addEventListener("click", () => openCourseItemEntry(courseId, nextEntry));
    container.appendChild(resumeBtn);
  }
  for (const entry of sequence) {
    if (entry.type === "SECTION") {
      const sectionRow = document.createElement("button");
      sectionRow.type = "button";
      sectionRow.className = "btn-secondary course-module-row course-module-button";
      if (entry === nextEntry) sectionRow.classList.add("course-module-row--next");
      sectionRow.addEventListener("click", () => openSectionReader(courseId, entry.sectionId, entry.courseItemId, entry.discussionsEnabled));
      const readBadge = entry.read ? t("courses.section.doneBadge") : t("courses.section.todoBadge");
      sectionRow.innerHTML = `
        <span class="course-module-row-copy">
          <span class="course-module-row-title">${escapeHtmlP(localizePreviewText(entry.title))}</span>
          <span class="course-module-row-action">${escapeHtmlP(t("courses.section.read"))}</span>
        </span>
        <span class="module-status-badge ${entry.read ? "completed" : ""}">${escapeHtmlP(readBadge)}</span>
      `;
      container.appendChild(sectionRow);
      continue;
    }
    const m = entry;
    const passed = m.moduleStatus === "PASSED";
    const inProgress = m.moduleStatus === "IN_PROGRESS";
    const selected = selectedModuleId === m.moduleId;
    // #502-followup: avpubliserte/utilgjengelige moduler vises som ikke-klikkbare (ingen blindvei).
    const available = m.available !== false;
    // #714-followup: status ligger i pillen (som admin-oversiktene) — også «ikke tilgjengelig».
    const badgeText = !available
      ? t("courses.module.unavailableShort")
      : passed ? t("courses.module.passed")
      : inProgress ? t("courses.module.inProgress")
      : t("courses.module.notStarted");
    const badgeClass = !available ? "unavailable" : passed ? "completed" : inProgress ? "retake" : "";
    // #495-follow-up UX: handlingsverb i stedet for «Velg modul» (begrepet «modul» fjernet i deltaker-UI).
    const actionText = selected ? t("courses.module.selectedShort") : t("courses.module.go");
    const row = document.createElement("button");
    row.type = "button";
    row.className = selected ? "btn-secondary course-module-row course-module-button selected" : "btn-secondary course-module-row course-module-button";
    if (entry === nextEntry) row.classList.add("course-module-row--next");
    row.setAttribute("aria-pressed", selected ? "true" : "false");
    if (!available) {
      row.disabled = true;
    } else {
      row.addEventListener("click", async () => {
        row.disabled = true;
        try {
          await openCourseModule(courseId, m.moduleId);
        } catch (error) {
          showToast(error instanceof Error ? error.message : t("courses.loadError"), "error");
        } finally {
          row.disabled = false;
        }
      });
    }
    row.innerHTML = `
      <span class="course-module-row-copy">
        <span class="course-module-row-title">${escapeHtmlP(localizePreviewText(m.title))}</span>
        <span class="course-module-row-action">${escapeHtmlP(actionText)}</span>
      </span>
      <span class="module-status-badge ${badgeClass}">${escapeHtmlP(badgeText)}</span>
    `;
    container.appendChild(row);
  }

  // #495/T-QA-3: kurs-nivå diskusjonsboard under sekvensen (kun når påskrudd for kurset).
  if (course?.discussionsEnabled) {
    const discWrap = document.createElement("div");
    discWrap.className = "card";
    discWrap.style.cssText = "margin-top:12px;padding:12px;";
    discWrap.setAttribute("data-course-discussion", courseId);
    container.appendChild(discWrap);
    mountDiscussionPanel({
      container: discWrap,
      courseId,
      courseItemId: null,
      apiFetch,
      headers,
      t,
      escapeHtml: escapeHtmlP,
      showToast,
    });
  }
}

// #491/P1 — open a learning section in a mobile-friendly reader overlay with
// server-rendered, sanitised HTML in the participant's locale.
async function openSectionReader(courseId, sectionId, courseItemId, discussionsEnabled) {
  const existing = document.getElementById("sectionReaderOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "sectionReaderOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:flex-start;overflow-y:auto;z-index:1000;padding:0;";
  overlay.innerHTML = `
    <style>
      #sectionReaderBody img { max-width: 100%; height: auto; display: block; margin: 8px 0; }
      #sectionReaderBody iframe { max-width: 100%; }
      #sectionReaderPanel.section-reader-fullscreen { max-width: 100% !important; }
    </style>
    <div id="sectionReaderPanel" style="background:var(--color-surface,#fff);width:100%;max-width:760px;min-height:100%;margin:0 auto;padding:var(--space-3,16px);box-sizing:border-box;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 var(--space-2,12px) 0;">
        <h2 id="sectionReaderTitle" style="margin:0;font-size:20px">…</h2>
        <button type="button" id="sectionReaderFullscreen" class="btn-secondary" style="width:auto;min-height:0;padding:4px 10px;font-size:14px;flex-shrink:0;" aria-pressed="false" title="${escapeHtmlP(t("courses.section.fullscreen"))}">⛶</button>
      </div>
      <div id="sectionReaderBody" class="section-reader-body">${escapeHtmlP(t("courses.section.loading"))}</div>
      <div style="margin-top:var(--space-3,16px);padding-top:var(--space-2,12px);border-top:1px solid var(--color-border-soft,#e5e7eb);display:flex;justify-content:center;gap:var(--space-2,12px);flex-wrap:wrap;">
        <button type="button" id="sectionReaderMarkRead" class="btn-primary">${escapeHtmlP(t("courses.section.markRead"))}</button>
        <button type="button" id="sectionReaderClose" class="btn-secondary">${escapeHtmlP(t("courses.section.close"))}</button>
      </div>
      <div id="sectionReaderDiscussion" style="margin-top:16px;"></div>
    </div>`;
  document.body.appendChild(overlay);

  let markedRead = false;
  const close = () => {
    overlay.remove();
    // Refresh both the course detail (read badge) AND the course list (course-level progress +
    // completion), so status updates and the #550 course-completion confetti can fire (#549/#550).
    if (markedRead) {
      loadCourseDetail(courseId);
      loadParticipantCourses().catch(() => {});
    }
  };
  overlay.querySelector("#sectionReaderClose")?.addEventListener("click", close);
  // #656: fullskjerm-veksling i seksjonsleseren.
  overlay.querySelector("#sectionReaderFullscreen")?.addEventListener("click", (e) => {
    const panel = overlay.querySelector("#sectionReaderPanel");
    const on = panel?.classList.toggle("section-reader-fullscreen");
    e.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
    e.currentTarget.textContent = on ? "🗗" : "⛶";
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
  });

  // Explicit "mark as read" (#492 feedback). #550 feedback: marking read should also close the
  // reader (the participant expected it to close) and refresh course status.
  const markReadBtn = overlay.querySelector("#sectionReaderMarkRead");
  markReadBtn?.addEventListener("click", async () => {
    markReadBtn.disabled = true;
    try {
      await apiFetch(`/api/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}/read`, headers, { method: "POST" });
      markedRead = true;
      close();
    } catch (error) {
      markReadBtn.disabled = false;
      showToast(error instanceof Error ? error.message : t("courses.loadError"), "error");
    }
  });

  try {
    const body = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}`, headers);
    const titleEl = overlay.querySelector("#sectionReaderTitle");
    const bodyEl = overlay.querySelector("#sectionReaderBody");
    if (titleEl) titleEl.textContent = body.title ?? "";
    // body.html is already sanitised server-side with the F3/X1 policy.
    if (bodyEl) {
      bodyEl.innerHTML = body.html ?? "";
      // Private asset images can't carry auth headers as a plain <img>; hydrate them.
      await hydrateContentAssetImages(bodyEl, headers);
    }
  } catch (error) {
    const bodyEl = overlay.querySelector("#sectionReaderBody");
    if (bodyEl) bodyEl.textContent = error instanceof Error ? error.message : t("courses.loadError");
  }

  // #495/T-QA-3: per-seksjon diskusjonsboard i leseren (kun når påskrudd for elementet).
  if (discussionsEnabled && courseItemId) {
    const discEl = overlay.querySelector("#sectionReaderDiscussion");
    if (discEl) {
      mountDiscussionPanel({
        container: discEl,
        courseId,
        courseItemId,
        apiFetch,
        headers,
        t,
        escapeHtml: escapeHtmlP,
        showToast,
      });
    }
  }
}
