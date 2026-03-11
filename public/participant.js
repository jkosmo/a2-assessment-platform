import { localeLabels, supportedLocales, translations } from "/static/i18n/participant-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { showToast } from "/static/toast.js";
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
const flowProgress = document.getElementById("flowProgress");
const flowProgressSummary = document.getElementById("flowProgressSummary");
const flowProgressSteps = document.getElementById("flowProgressSteps");
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
const selectedModuleBrief = document.getElementById("selectedModuleBrief");
const selectedModuleTaskText = document.getElementById("selectedModuleTaskText");
const selectedModuleGuidanceText = document.getElementById("selectedModuleGuidanceText");
const submissionIdLabel = document.getElementById("submissionId");
const attemptIdLabel = document.getElementById("attemptId");
const appealIdLabel = document.getElementById("appealId");
const appVersionLabel = document.getElementById("appVersion");
const resultSummary = document.getElementById("resultSummary");
const historySummary = document.getElementById("historySummary");
const draftStatus = document.getElementById("draftStatus");
const loadMeButton = document.getElementById("loadMe");
const loadModulesButton = document.getElementById("loadModules");
const createSubmissionButton = document.getElementById("createSubmission");
const submitMcqButton = document.getElementById("submitMcq");
const loadHistoryButton = document.getElementById("loadHistory");
const rawTextInput = document.getElementById("rawText");
const reflectionTextInput = document.getElementById("reflectionText");
const promptExcerptInput = document.getElementById("promptExcerpt");
const ackCheckbox = document.getElementById("ack");
const appealReasonInput = document.getElementById("appealReason");
const assessmentSection = document.getElementById("assessmentSection");
const appealSection = document.getElementById("appealSection");
const submissionSection = document.getElementById("submissionSection");
const mcqSection = document.getElementById("mcqSection");
const moduleSelectionHint = document.getElementById("moduleSelectionHint");
const submissionValidationHint = document.getElementById("submissionValidationHint");
const reflectionHint = document.getElementById("reflectionText-hint");
const promptExcerptHint = document.getElementById("promptExcerpt-hint");
const ackHint = document.getElementById("ack-hint");
const assessmentGateHint = document.getElementById("assessmentGateHint");
const checkAssessmentHint = document.getElementById("checkAssessmentHint");
const assessmentProgressStatus = document.getElementById("assessmentProgressStatus");
const assessmentProgressSeconds = document.getElementById("assessmentProgressSeconds");
const appealGateHint = document.getElementById("appealGateHint");
const appealSubmittedStatus = document.getElementById("appealSubmittedStatus");
const queueAssessmentButton = document.getElementById("queueAssessment");
const checkAssessmentButton = document.getElementById("checkAssessment");
const checkResultButton = document.getElementById("checkResult");
const createAppealButton = document.getElementById("createAppeal");
const resetSubmissionFlowButton = document.getElementById("resetSubmissionFlow");

const submissionValidationTargets = [
  { fieldElement: selectedModuleDisplay, hintElement: moduleSelectionHint },
  { fieldElement: reflectionTextInput, hintElement: reflectionHint },
  { fieldElement: promptExcerptInput, hintElement: promptExcerptHint },
  { fieldElement: ackCheckbox, hintElement: ackHint },
];
const rawDebugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";

let currentQuestions = [];
let currentLocale = resolveInitialLocale();
let latestResult = null;
let latestHistory = null;
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: {
    items: [
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
    ],
  },
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
  { id: "rawText", key: "defaults.rawText" },
  { id: "reflectionText", key: "defaults.reflection" },
  { id: "promptExcerpt", key: "defaults.promptExcerpt" },
  { id: "appealReason", key: "defaults.appealReason" },
];

const moduleDraftFieldIds = ["rawText", "reflectionText", "promptExcerpt"];
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

function tForLocale(locale, key) {
  return translations[locale]?.[key] ?? translations["en-GB"][key] ?? key;
}

function setLocale(locale) {
  const previousLocale = currentLocale;
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  document.documentElement.lang = currentLocale;
  applyTranslations();
  setDefaultFieldValues(previousLocale, currentLocale);
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
  renderFlowProgress();

  const selectedTitle = resolveSelectedModule(loadedModules, selectedModuleId)?.title ?? "";
  setDraftStatus(draftStatus.dataset.state ?? "none", selectedTitle);
  renderAssessmentProgress();
  renderAppealState();
  updateCreateSubmissionAvailability();
  renderFlowGating();
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

function renderSelectedModuleSummary() {
  const selectedModule = resolveSelectedModule(loadedModules, selectedModuleId);
  selectedModuleIdInput.value = selectedModule?.id ?? "";
  selectedModuleDisplay.textContent = selectedModule?.title ?? t("submission.selectedModuleNone");
  selectedModuleTaskText.textContent = selectedModule?.taskText ?? "";
  selectedModuleGuidanceText.textContent = selectedModule?.guidanceText ?? "";
  selectedModuleBrief.classList.toggle(
    "hidden",
    !(selectedModule && (selectedModule.taskText || selectedModule.guidanceText)),
  );
  updateModuleSelectionVisibility(Boolean(selectedModule));
}

function getActiveFlowStep() {
  if (flowState.hasMcqSubmission || flowState.assessmentQueued || Boolean(flowState.resultStatus)) {
    return 5;
  }
  if (flowState.hasSubmission) {
    return 4;
  }
  if (resolveSelectedModule(loadedModules, selectedModuleId)) {
    return 3;
  }
  return 2;
}

function renderFlowProgress() {
  if (!flowProgress || !flowProgressSummary || !flowProgressSteps) {
    return;
  }

  const activeStep = getActiveFlowStep();
  const totalSteps = 5;
  const summary = `${t("progress.stepPrefix")} ${activeStep} ${t("progress.of")} ${totalSteps}`;

  flowProgressSummary.textContent = summary;
  flowProgress.setAttribute("aria-label", `${t("progress.ariaLabel")}: ${summary}`);

  for (const stepElement of flowProgressSteps.querySelectorAll("[data-step]")) {
    const stepNumber = Number(stepElement.getAttribute("data-step"));
    const isCompleted = stepNumber < activeStep;
    const isActive = stepNumber === activeStep;

    stepElement.classList.toggle("is-completed", isCompleted);
    stepElement.classList.toggle("is-active", isActive);
    stepElement.classList.toggle("is-pending", !isCompleted && !isActive);

    if (isActive) {
      stepElement.setAttribute("aria-current", "step");
    } else {
      stepElement.removeAttribute("aria-current");
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
  const hasReflection = reflectionTextInput.value.trim().length >= 10;
  const hasPromptExcerpt = promptExcerptInput.value.trim().length >= 5;
  const hasAcknowledgement = ackCheckbox.checked === true;

  if (!hasModule) {
    return {
      valid: false,
      hintKey: "submission.validation.selectModule",
      invalidFieldElement: selectedModuleDisplay,
      invalidHintElement: moduleSelectionHint,
    };
  }
  if (!hasReflection) {
    return {
      valid: false,
      hintKey: "submission.validation.reflectionMin",
      invalidFieldElement: reflectionTextInput,
      invalidHintElement: reflectionHint,
    };
  }
  if (!hasPromptExcerpt) {
    return {
      valid: false,
      hintKey: "submission.validation.promptMin",
      invalidFieldElement: promptExcerptInput,
      invalidHintElement: promptExcerptHint,
    };
  }
  if (!hasAcknowledgement) {
    return {
      valid: false,
      hintKey: "submission.validation.ackRequired",
      invalidFieldElement: ackCheckbox,
      invalidHintElement: ackHint,
    };
  }

  return { valid: true, hintKey: "submission.validation.ready" };
}

function resetSubmissionValidationVisuals() {
  for (const target of submissionValidationTargets) {
    target.fieldElement?.classList.remove("is-invalid");
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
}

function renderModules() {
  hideLoading(moduleList);
  moduleList.innerHTML = "";

  const modules = buildModuleCardViewModels(loadedModules, selectedModuleId);
  if (modules.length === 0) {
    showEmpty(moduleList, hasLoadedModules ? t("modules.empty") : t("modules.emptyInitial"));
    return;
  }

  for (const module of modules) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = module.selected ? "btn-secondary module-card selected" : "btn-secondary module-card";
    button.setAttribute("aria-pressed", module.selected ? "true" : "false");
    button.addEventListener("click", () => {
      persistCurrentModuleDraft(false);
      selectedModuleId = module.id;
      resetFlowStateForModuleContext();
      renderModules();
      renderSelectedModuleSummary();
      restoreDraftForSelectedModule(true);
      log({ selectedModule: { id: module.id, title: module.title } }, { notify: false });
    });

    const title = document.createElement("div");
    title.className = "module-title";
    title.textContent = module.title;
    button.appendChild(title);

    const moduleMeta = document.createElement("div");
    moduleMeta.className = "module-meta";
    moduleMeta.textContent = `ID: ${module.id}`;
    button.appendChild(moduleMeta);

    if (module.selected) {
      const selectedBadge = document.createElement("div");
      selectedBadge.className = "selected-badge";
      selectedBadge.textContent = t("modules.selectedBadge");
      button.appendChild(selectedBadge);
    }

    moduleList.appendChild(button);
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
  const gate = deriveParticipantFlowGateState(flowState);
  const hasAssessmentContext =
    flowState.hasMcqSubmission || flowState.assessmentQueued || Boolean(flowState.resultStatus);
  const autoAssessmentEnabled = getFlowSettings().autoStartAfterMcq;
  const hasSelectedModule = Boolean(resolveSelectedModule(loadedModules, selectedModuleId));

  assessmentSection.classList.toggle("hidden", !hasAssessmentContext);
  mcqSection.classList.toggle("hidden", !hasSelectedModule || !flowState.hasSubmission);
  assessmentSection.classList.toggle("section-locked", !gate.assessmentUnlocked);
  appealSection.classList.toggle("section-locked", !gate.appealUnlocked);
  queueAssessmentButton.classList.toggle("hidden", autoAssessmentEnabled);
  createSubmissionButton.classList.toggle("hidden", flowState.hasSubmission);
  submitMcqButton.classList.toggle("hidden", !flowState.hasSubmission || flowState.hasMcqSubmission);

  const hasResultStatus = isAssessmentResultReady(flowState.resultStatus);
  resetSubmissionFlowButton.classList.toggle("hidden", !hasResultStatus);

  const createSubmissionBusy = createSubmissionButton.dataset.busy === "true";
  const submitMcqBusy = submitMcqButton.dataset.busy === "true";
  const queueBusy = queueAssessmentButton.dataset.busy === "true";
  const checkAssessmentBusy = checkAssessmentButton.dataset.busy === "true";
  const checkResultBusy = checkResultButton.dataset.busy === "true";
  const createAppealBusy = createAppealButton.dataset.busy === "true";
  const resetFlowBusy = resetSubmissionFlowButton.dataset.busy === "true";

  createSubmissionButton.disabled =
    createSubmissionBusy ||
    flowState.hasSubmission ||
    !validateSubmissionInputState().valid;
  submitMcqButton.disabled =
    submitMcqBusy ||
    !flowState.hasSubmission ||
    flowState.hasMcqSubmission ||
    currentQuestions.length === 0;
  queueAssessmentButton.disabled = autoAssessmentEnabled || queueBusy || !gate.assessmentUnlocked;
  checkResultButton.disabled = autoAssessmentEnabled || checkResultBusy || !gate.assessmentUnlocked;
  checkAssessmentButton.disabled = autoAssessmentEnabled || checkAssessmentBusy || !gate.checkAssessmentUnlocked;
  createAppealButton.disabled = createAppealBusy || !gate.appealUnlocked;
  resetSubmissionFlowButton.disabled = resetFlowBusy || !hasResultStatus;

  assessmentGateHint.textContent = t(gate.assessmentHintKey);
  checkAssessmentHint.textContent = t(gate.checkAssessmentHintKey);
  appealGateHint.textContent = t(gate.appealHintKey);
  renderFlowProgress();
  renderAppealState();
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
  for (const fieldId of moduleDraftFieldIds) {
    const binding = defaultFieldBindings.find((item) => item.id === fieldId);
    const element = document.getElementById(fieldId);
    if (!binding || !element) {
      continue;
    }
    element.value = t(binding.key);
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
    return;
  }

  const data = {};
  for (const fieldId of moduleDraftFieldIds) {
    const element = document.getElementById(fieldId);
    data[fieldId] = element?.value ?? "";
  }
  data.mcq = collectCurrentMcqDraft();

  const settings = getDraftSettings();
  const existing = readModuleDraftMap();
  const updated = upsertModuleDraft(existing, selectedModule.id, data, Date.now(), settings.maxModules);
  writeModuleDraftMap(updated);

  if (showStatus) {
    setDraftStatus("saved", selectedModule.title);
  }
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

  for (const fieldId of moduleDraftFieldIds) {
    const element = document.getElementById(fieldId);
    element.value = typeof draft[fieldId] === "string" ? draft[fieldId] : "";
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

  applyOutputVisibility();
  applyIdentityDefaults();
  renderRolePresetControl();
  renderWorkspaceNavigation();
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

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat(currentLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
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

function localizeAppealStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`appeal.statusValue.${normalized || "UNKNOWN"}`);
}

function localizeDecisionType(value, submissionStatus) {
  const normalizedStatus = typeof submissionStatus === "string" ? submissionStatus.toUpperCase() : "";
  if (normalizedStatus === "UNDER_REVIEW") {
    return t("result.decisionValue.MANUAL_REVIEW_PENDING");
  }

  const normalized = typeof value === "string" ? value.toUpperCase() : "";
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
  return localized === translationKey ? key : localized;
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
  if (!Array.isArray(values) || values.length === 0) {
    return "-";
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

  return values.map((value) => localizeKnownContent(value, mapping)).join("; ");
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
  const hasAppeal = latestAppeal && typeof latestAppeal.id === "string";
  const isNegativeResult = latestResult?.decision?.passFailTotal === false;
  const shouldShowAppealSection = hasAppeal || isNegativeResult;

  appealSection.classList.toggle("hidden", !shouldShowAppealSection);

  if (!shouldShowAppealSection) {
    createAppealButton.classList.add("hidden");
    appealSubmittedStatus.textContent = "";
    appealIdLabel.textContent = "-";
    return;
  }

  if (hasAppeal) {
    createAppealButton.classList.add("hidden");
    createAppealButton.disabled = true;
    appealSubmittedStatus.textContent =
      `${t("appeal.submittedPrefix")}: ${latestAppeal.id} (${localizeAppealStatus(latestAppeal.appealStatus)})`;
    appealIdLabel.textContent = latestAppeal.id;
    return;
  }

  createAppealButton.classList.remove("hidden");
  appealIdLabel.textContent = "-";
  appealSubmittedStatus.textContent = t("appeal.readyForSubmission");
}

function renderResultSummary(body) {
  latestResult = body;
  latestAppeal = body?.latestAppeal ?? latestAppeal;

  if (!body) {
    resultSummary.dataset.hasResult = "";
    resultSummary.textContent = t("result.none");
    renderAppealState();
    return;
  }

  assessmentProgressKey = deriveAssessmentProgressKeyFromSubmissionStatus(
    body.status,
    body?.assessment?.latestJob?.status,
  );
  renderAssessmentProgress();

  const lines = [
    `${t("result.status")}: ${localizeSubmissionStatus(body.status)}`,
    `${t("result.statusExplanation")}: ${localizeStatusExplanation(body.status)}`,
    `${t("result.totalScore")}: ${formatNumber(body.scoreComponents?.totalScore)}`,
    `${t("result.mcqScore")}: ${formatNumber(body.scoreComponents?.mcqScaledScore)}`,
    `${t("result.practicalScore")}: ${formatNumber(body.scoreComponents?.practicalScaledScore)}`,
    `${t("result.decision")}: ${localizeDecisionType(body.decision?.decisionType, body.status)}`,
    `${t("result.decisionReason")}: ${localizeDecisionReason(body.participantGuidance?.decisionReason)}`,
    `${t("result.confidence")}: ${localizeConfidence(body.participantGuidance?.confidenceNote)}`,
    `${t("result.improvementAdvice")}: ${localizeImprovementAdvice(body.participantGuidance?.improvementAdvice)}`,
    `${t("result.rationales")}:`,
  ];

  const rationales = body.participantGuidance?.criterionRationales ?? {};
  for (const [criterion, rationale] of Object.entries(rationales)) {
    lines.push(`- ${localizeCriterionName(criterion)}: ${localizeCriterionRationale(String(rationale))}`);
  }

  resultSummary.dataset.hasResult = "true";
  resultSummary.textContent = lines.join("\n");
  renderAppealState();
}

function renderHistorySummary(body) {
  hideLoading(historySummary);
  latestHistory = body;
  const history = body?.history ?? [];

  if (!Array.isArray(history) || history.length === 0) {
    historySummary.dataset.hasHistory = "";
    showEmpty(historySummary, t("history.empty"));
    return;
  }

  const lines = [];
  for (const item of history) {
    lines.push(`${t("history.entry")}: ${item.submissionId}`);
    lines.push(`${t("history.module")}: ${item.module?.title ?? "-"} (${item.module?.id ?? "-"})`);
    lines.push(`${t("history.submittedAt")}: ${formatDateTime(item.submittedAt)}`);
    lines.push(`${t("history.latestStatus")}: ${localizeSubmissionStatus(item.status)}`);
    lines.push(`${t("history.latestDecision")}: ${localizeDecisionType(item.latestDecision?.decisionType, item.status)}`);
    lines.push(`${t("history.latestScore")}: ${formatNumber(item.latestDecision?.totalScore)}`);
    lines.push("");
  }

  historySummary.dataset.hasHistory = "true";
  historySummary.textContent = lines.join("\n").trim();
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
  await runWithBusyButton(loadModulesButton, async () => {
    try {
      showLoading(moduleList, { rows: 3, variant: "cards" });
      const body = await apiFetch("/api/modules", headers);
      loadedModules = Array.isArray(body.modules) ? body.modules : [];
      hasLoadedModules = true;
      if (selectedModuleId && !resolveSelectedModule(loadedModules, selectedModuleId)) {
        selectedModuleId = "";
        resetFlowStateForModuleContext();
      }
      renderModules();
      renderSelectedModuleSummary();
      if (selectedModuleId) {
        restoreDraftForSelectedModule(false);
      }
      updateCreateSubmissionAvailability();
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
        throw new Error(t(validation.hintKey));
      }

      const moduleId = selectedModuleId;
      const body = await apiFetch("/api/submissions", headers, {
        method: "POST",
        body: JSON.stringify({
          moduleId,
          deliveryType: "text",
          rawText: rawTextInput.value,
          reflectionText: reflectionTextInput.value,
          promptExcerpt: promptExcerptInput.value,
          responsibilityAcknowledged: ackCheckbox.checked,
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
      const mcqStartBody = await startMcqForSubmission(moduleId, body.submission.id);
      log({
        submission: body.submission,
        mcqStarted: {
          attemptId: mcqStartBody.attemptId,
          questionCount: Array.isArray(mcqStartBody.questions) ? mcqStartBody.questions.length : 0,
        },
      });
    } catch (error) {
      log(error.message);
    }
  }, updateCreateSubmissionAvailability);
});

submitMcqButton.addEventListener("click", async () => {
  await runWithBusyButton(submitMcqButton, async () => {
    try {
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
      flowState = {
        ...flowState,
        hasMcqSubmission: true,
        assessmentQueued: getFlowSettings().autoStartAfterMcq,
        resultStatus: null,
      };
      assessmentProgressKey = "assessment.progress.idle";
      setAssessmentProgressDetail();
      renderAssessmentProgress();
      renderFlowGating();
      persistCurrentModuleDraft(true);
      if (getFlowSettings().autoStartAfterMcq) {
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

for (const fieldId of moduleDraftFieldIds) {
  const element = document.getElementById(fieldId);
  element.addEventListener("input", () => {
    scheduleDraftAutosave();
    updateCreateSubmissionAvailability();
  });
}

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
