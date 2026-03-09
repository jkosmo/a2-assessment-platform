import { localeLabels, supportedLocales, translations } from "/static/i18n/participant-translations.js";
import {
  buildModuleCardViewModels,
  deriveParticipantFlowGateState,
  findMatchingPreset,
  parseDraftEnvelope,
  pruneExpiredModuleDrafts,
  resolveRoleSwitchState,
  resolveSelectedModule,
  sanitizeAppealStatuses,
  upsertModuleDraft,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
const moduleList = document.getElementById("moduleList");
const mcqQuestions = document.getElementById("mcqQuestions");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");

const selectedModuleIdInput = document.getElementById("selectedModuleId");
const selectedModuleDisplay = document.getElementById("selectedModuleDisplay");
const submissionIdLabel = document.getElementById("submissionId");
const attemptIdLabel = document.getElementById("attemptId");
const appealIdLabel = document.getElementById("appealId");
const appVersionLabel = document.getElementById("appVersion");
const resultSummary = document.getElementById("resultSummary");
const historySummary = document.getElementById("historySummary");
const draftStatus = document.getElementById("draftStatus");
const clearDraftButton = document.getElementById("clearDraft");
const assessmentSection = document.getElementById("assessmentSection");
const appealSection = document.getElementById("appealSection");
const assessmentGateHint = document.getElementById("assessmentGateHint");
const checkAssessmentHint = document.getElementById("checkAssessmentHint");
const appealGateHint = document.getElementById("appealGateHint");
const queueAssessmentButton = document.getElementById("queueAssessment");
const checkAssessmentButton = document.getElementById("checkAssessment");
const checkResultButton = document.getElementById("checkResult");
const createAppealButton = document.getElementById("createAppeal");
const appealHandlerStatusFilter = document.getElementById("appealHandlerStatusFilter");
const handlerSelectedAppealIdInput = document.getElementById("handlerSelectedAppealId");
const loadAppealQueueButton = document.getElementById("loadAppealQueue");
const appealQueueList = document.getElementById("appealQueueList");
const appealHandlerDetails = document.getElementById("appealHandlerDetails");
const claimAppealButton = document.getElementById("claimAppeal");
const resolveAppealButton = document.getElementById("resolveAppeal");
const handlerDecisionReasonInput = document.getElementById("handlerDecisionReason");
const handlerResolutionNoteInput = document.getElementById("handlerResolutionNote");
const handlerPassFailTotalInput = document.getElementById("handlerPassFailTotal");
const appealHandlerMessage = document.getElementById("appealHandlerMessage");

let currentQuestions = [];
let currentLocale = resolveInitialLocale();
let latestResult = null;
let latestHistory = null;
let participantRuntimeConfig = {
  authMode: "mock",
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  drafts: {
    storageKey: "participant.moduleDrafts.v1",
    ttlMinutes: 240,
    maxModules: 30,
  },
  appealWorkspace: {
    availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: ["OPEN", "IN_REVIEW"],
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
let loadedModules = [];
let selectedModuleId = "";
let autosaveTimer = null;
let flowState = {
  hasSubmission: false,
  hasMcqSubmission: false,
  assessmentQueued: false,
  resultStatus: null,
};
let latestAppealQueue = [];
let selectedAppealId = "";

const defaultFieldBindings = [
  { id: "rawText", key: "defaults.rawText" },
  { id: "reflectionText", key: "defaults.reflection" },
  { id: "promptExcerpt", key: "defaults.promptExcerpt" },
  { id: "appealReason", key: "defaults.appealReason" },
];

const moduleDraftFieldIds = ["rawText", "reflectionText", "promptExcerpt"];

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

  output.textContent = t("defaults.ready");
  if (!resultSummary.dataset.hasResult) {
    resultSummary.textContent = t("defaults.noResult");
  }
  if (!historySummary.dataset.hasHistory) {
    historySummary.textContent = t("defaults.noHistory");
  }

  renderModules();
  renderSelectedModuleSummary();
  renderRolePresetControl();

  const selectedTitle = resolveSelectedModule(loadedModules, selectedModuleId)?.title ?? "";
  setDraftStatus(draftStatus.dataset.state ?? "none", selectedTitle);
  if (!selectedAppealId) {
    renderAppealHandlerDetails(null);
  }
  renderFlowGating();
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
}

function renderModules() {
  moduleList.innerHTML = "";

  const modules = buildModuleCardViewModels(loadedModules, selectedModuleId);
  for (const module of modules) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = module.selected ? "module-card selected" : "module-card";
    button.setAttribute("aria-pressed", module.selected ? "true" : "false");
    button.addEventListener("click", () => {
      persistCurrentModuleDraft(false);
      selectedModuleId = module.id;
      resetFlowStateForModuleContext();
      renderModules();
      renderSelectedModuleSummary();
      restoreDraftForSelectedModule(true);
      log({ selectedModule: { id: module.id, title: module.title } });
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
  flowState = {
    hasSubmission: false,
    hasMcqSubmission: false,
    assessmentQueued: false,
    resultStatus: null,
  };
  submissionIdLabel.textContent = "-";
  attemptIdLabel.textContent = "-";
  appealIdLabel.textContent = "-";
  renderResultSummary(null);
  renderFlowGating();
}

function renderFlowGating() {
  const gate = deriveParticipantFlowGateState(flowState);

  assessmentSection.classList.toggle("section-locked", !gate.assessmentUnlocked);
  appealSection.classList.toggle("section-locked", !gate.appealUnlocked);

  queueAssessmentButton.disabled = !gate.assessmentUnlocked;
  checkResultButton.disabled = !gate.assessmentUnlocked;
  checkAssessmentButton.disabled = !gate.checkAssessmentUnlocked;
  createAppealButton.disabled = !gate.appealUnlocked;

  assessmentGateHint.textContent = t(gate.assessmentHintKey);
  checkAssessmentHint.textContent = t(gate.checkAssessmentHintKey);
  appealGateHint.textContent = t(gate.appealHintKey);
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

async function loadParticipantConsoleConfig() {
  try {
    const response = await fetch("/participant/config");
    if (!response.ok) {
      throw new Error("participant_config_unavailable");
    }

    const body = await response.json();
    participantRuntimeConfig = {
      ...participantRuntimeConfig,
      ...body,
      drafts: {
        ...participantRuntimeConfig.drafts,
        ...(body?.drafts ?? {}),
      },
    };
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  }

  renderRolePresetControl();
  populateAppealStatusFilters();
}

function headers() {
  const roles = rolesInput
    .value.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");

  return {
    "Content-Type": "application/json",
    "x-user-id": document.getElementById("userId").value,
    "x-user-email": document.getElementById("email").value,
    "x-user-name": document.getElementById("name").value,
    "x-user-department": document.getElementById("department").value,
    "x-user-roles": roles,
    "x-locale": currentLocale,
  };
}

function log(data) {
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers ?? {}) },
  });

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function loadVersion() {
  try {
    const body = await api("/version", { headers: {} });
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

function renderResultSummary(body) {
  latestResult = body;

  if (!body) {
    resultSummary.dataset.hasResult = "";
    resultSummary.textContent = t("result.none");
    return;
  }

  const lines = [
    `${t("result.status")}: ${body.status ?? "-"}`,
    `${t("result.statusExplanation")}: ${body.statusExplanation ?? "-"}`,
    `${t("result.totalScore")}: ${formatNumber(body.scoreComponents?.totalScore)}`,
    `${t("result.mcqScore")}: ${formatNumber(body.scoreComponents?.mcqScaledScore)}`,
    `${t("result.practicalScore")}: ${formatNumber(body.scoreComponents?.practicalScaledScore)}`,
    `${t("result.decision")}: ${body.decision?.decisionType ?? "-"}`,
    `${t("result.decisionReason")}: ${body.participantGuidance?.decisionReason ?? "-"}`,
    `${t("result.confidence")}: ${body.participantGuidance?.confidenceNote ?? "-"}`,
    `${t("result.improvementAdvice")}: ${body.participantGuidance?.improvementAdvice ?? "-"}`,
    `${t("result.rationales")}:`,
  ];

  const rationales = body.participantGuidance?.criterionRationales ?? {};
  for (const [criterion, rationale] of Object.entries(rationales)) {
    lines.push(`- ${criterion}: ${String(rationale)}`);
  }

  resultSummary.dataset.hasResult = "true";
  resultSummary.textContent = lines.join("\n");
}

function renderHistorySummary(body) {
  latestHistory = body;
  const history = body?.history ?? [];

  if (!Array.isArray(history) || history.length === 0) {
    historySummary.dataset.hasHistory = "";
    historySummary.textContent = t("history.empty");
    return;
  }

  const lines = [];
  for (const item of history) {
    lines.push(`${t("history.entry")}: ${item.submissionId}`);
    lines.push(`${t("history.module")}: ${item.module?.title ?? "-"} (${item.module?.id ?? "-"})`);
    lines.push(`${t("history.submittedAt")}: ${formatDateTime(item.submittedAt)}`);
    lines.push(`${t("history.latestStatus")}: ${item.status ?? "-"}`);
    lines.push(`${t("history.latestDecision")}: ${item.latestDecision?.decisionType ?? "-"}`);
    lines.push(`${t("history.latestScore")}: ${formatNumber(item.latestDecision?.totalScore)}`);
    lines.push("");
  }

  historySummary.dataset.hasHistory = "true";
  historySummary.textContent = lines.join("\n").trim();
}

function toActionableErrorMessage(error) {
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
    if (payload.error === "validation_error" && Array.isArray(payload.issues)) {
      return payload.issues
        .map((issue) => {
          const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
          return `${path || "field"}: ${issue.message ?? "invalid value"}`;
        })
        .join("; ");
    }
    return raw;
  } catch {
    return raw;
  }
}

function getAppealWorkspaceSettings() {
  const configured = participantRuntimeConfig?.appealWorkspace ?? {};
  const availableStatuses = sanitizeAppealStatuses(configured.availableStatuses, [
    "OPEN",
    "IN_REVIEW",
    "RESOLVED",
  ]);
  const defaultStatuses = sanitizeAppealStatuses(configured.defaultStatuses, ["OPEN", "IN_REVIEW"])
    .filter((status) => availableStatuses.includes(status));

  return {
    availableStatuses,
    defaultStatuses: defaultStatuses.length > 0 ? defaultStatuses : availableStatuses.slice(0, 1),
  };
}

function populateAppealStatusFilters() {
  const settings = getAppealWorkspaceSettings();
  appealHandlerStatusFilter.innerHTML = "";

  for (const status of settings.availableStatuses) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = settings.defaultStatuses.includes(status);
    appealHandlerStatusFilter.appendChild(option);
  }
}

function getSelectedAppealStatuses() {
  const selected = Array.from(appealHandlerStatusFilter.selectedOptions).map((option) => option.value);
  if (selected.length > 0) {
    return selected;
  }

  return getAppealWorkspaceSettings().defaultStatuses;
}

function renderAppealHandlerDetails(appeal) {
  if (!appeal) {
    appealHandlerDetails.textContent = t("appealHandler.noSelection");
    return;
  }

  const lines = [
    `appealId: ${appeal.id}`,
    `status: ${appeal.appealStatus}`,
    `submissionId: ${appeal.submission?.id ?? "-"}`,
    `createdAt: ${formatDateTime(appeal.createdAt)}`,
    `claimedAt: ${formatDateTime(appeal.claimedAt)}`,
    `resolvedAt: ${formatDateTime(appeal.resolvedAt)}`,
    `handlerId: ${appeal.handlerId ?? "-"}`,
    `resolutionNote: ${appeal.resolutionNote ?? "-"}`,
  ];
  appealHandlerDetails.textContent = lines.join("\n");
}

function renderAppealQueueList() {
  appealQueueList.innerHTML = "";
  if (!Array.isArray(latestAppealQueue) || latestAppealQueue.length === 0) {
    handlerSelectedAppealIdInput.value = "-";
    selectedAppealId = "";
    renderAppealHandlerDetails(null);
    appealHandlerMessage.textContent = t("appealHandler.queueEmpty");
    return;
  }

  for (const appeal of latestAppealQueue) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = appeal.id === selectedAppealId ? "appeal-row selected" : "appeal-row";
    button.addEventListener("click", () => {
      selectedAppealId = appeal.id;
      handlerSelectedAppealIdInput.value = appeal.id;
      renderAppealQueueList();
      renderAppealHandlerDetails(appeal);
    });

    button.textContent =
      `${appeal.id} | ${appeal.appealStatus} | ` +
      `created ${formatDateTime(appeal.createdAt)} | ` +
      `claimed ${formatDateTime(appeal.claimedAt)} | ` +
      `resolved ${formatDateTime(appeal.resolvedAt)}`;

    appealQueueList.appendChild(button);
  }

  if (!selectedAppealId || !latestAppealQueue.some((item) => item.id === selectedAppealId)) {
    selectedAppealId = latestAppealQueue[0].id;
  }

  const selectedAppeal = latestAppealQueue.find((item) => item.id === selectedAppealId);
  handlerSelectedAppealIdInput.value = selectedAppeal?.id ?? "-";
  renderAppealHandlerDetails(selectedAppeal ?? null);
}

async function loadAppealQueue() {
  try {
    const statuses = getSelectedAppealStatuses();
    const body = await api(`/api/appeals?status=${encodeURIComponent(statuses.join(","))}`);
    latestAppealQueue = Array.isArray(body.appeals) ? body.appeals : [];
    renderAppealQueueList();
    if (latestAppealQueue.length > 0) {
      appealHandlerMessage.textContent = `${latestAppealQueue.length} appeal(s) loaded.`;
    }
    log(body);
  } catch (error) {
    appealHandlerMessage.textContent = toActionableErrorMessage(error);
    log(error.message);
  }
}

document.getElementById("loadMe").addEventListener("click", async () => {
  try {
    const body = await api("/api/me");
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("loadModules").addEventListener("click", async () => {
  try {
    const body = await api("/api/modules");
    loadedModules = Array.isArray(body.modules) ? body.modules : [];
    if (selectedModuleId && !resolveSelectedModule(loadedModules, selectedModuleId)) {
      selectedModuleId = "";
      resetFlowStateForModuleContext();
    }
    renderModules();
    renderSelectedModuleSummary();
    if (selectedModuleId) {
      restoreDraftForSelectedModule(false);
    }
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("createSubmission").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleId;
    if (!moduleId) {
      throw new Error(t("errors.selectModuleFirst"));
    }
    const body = await api("/api/submissions", {
      method: "POST",
      body: JSON.stringify({
        moduleId,
        deliveryType: "text",
        rawText: document.getElementById("rawText").value,
        reflectionText: document.getElementById("reflectionText").value,
        promptExcerpt: document.getElementById("promptExcerpt").value,
        responsibilityAcknowledged: document.getElementById("ack").checked,
      }),
    });
    submissionIdLabel.textContent = body.submission.id;
    flowState = {
      hasSubmission: true,
      hasMcqSubmission: false,
      assessmentQueued: false,
      resultStatus: null,
    };
    renderFlowGating();
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("startMcq").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleId;
    const submissionId = submissionIdLabel.textContent;
    if (!moduleId || !submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(
      `/api/modules/${moduleId}/mcq/start?submissionId=${encodeURIComponent(submissionId)}`,
    );
    attemptIdLabel.textContent = body.attemptId;
    currentQuestions = body.questions;
    renderQuestions();
    scheduleDraftAutosave();
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("submitMcq").addEventListener("click", async () => {
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

    const body = await api(`/api/modules/${moduleId}/mcq/submit`, {
      method: "POST",
      body: JSON.stringify({
        submissionId,
        attemptId,
        responses,
      }),
    });
    currentQuestions = [];
    attemptIdLabel.textContent = "-";
    renderQuestions();
    flowState = {
      ...flowState,
      hasMcqSubmission: true,
      assessmentQueued: false,
      resultStatus: null,
    };
    renderFlowGating();
    persistCurrentModuleDraft(true);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("queueAssessment").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(`/api/assessments/${submissionId}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    flowState = {
      ...flowState,
      assessmentQueued: true,
    };
    renderFlowGating();
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("checkAssessment").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(`/api/assessments/${submissionId}`);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("checkResult").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(`/api/submissions/${submissionId}/result`);
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
});

document.getElementById("createAppeal").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const appealReason = document.getElementById("appealReason").value;
    const body = await api(`/api/submissions/${submissionId}/appeals`, {
      method: "POST",
      body: JSON.stringify({ appealReason }),
    });
    appealIdLabel.textContent = body.appeal.id;
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("loadHistory").addEventListener("click", async () => {
  try {
    const body = await api("/api/submissions/history?limit=20");
    renderHistorySummary(body);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

clearDraftButton.addEventListener("click", () => {
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
});

loadAppealQueueButton.addEventListener("click", async () => {
  await loadAppealQueue();
});

appealHandlerStatusFilter.addEventListener("change", async () => {
  await loadAppealQueue();
});

claimAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) {
    appealHandlerMessage.textContent = t("appealHandler.noSelection");
    return;
  }

  try {
    const body = await api(`/api/appeals/${selectedAppealId}/claim`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    appealHandlerMessage.textContent = t("appealHandler.claimed");
    await loadAppealQueue();
    renderAppealHandlerDetails(body.appeal);
    log(body);
  } catch (error) {
    appealHandlerMessage.textContent = toActionableErrorMessage(error);
    log(error.message);
  }
});

resolveAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) {
    appealHandlerMessage.textContent = t("appealHandler.noSelection");
    return;
  }

  try {
    const body = await api(`/api/appeals/${selectedAppealId}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        passFailTotal: handlerPassFailTotalInput.value === "true",
        decisionReason: handlerDecisionReasonInput.value,
        resolutionNote: handlerResolutionNoteInput.value,
      }),
    });
    appealHandlerMessage.textContent = t("appealHandler.resolved");
    await loadAppealQueue();
    if (body.appeal) {
      renderAppealHandlerDetails(body.appeal);
    }
    log(body);
  } catch (error) {
    appealHandlerMessage.textContent = toActionableErrorMessage(error);
    log(error.message);
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
});

rolesInput.addEventListener("input", () => {
  const matchingPreset = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matchingPreset;
});

for (const fieldId of moduleDraftFieldIds) {
  const element = document.getElementById(fieldId);
  element.addEventListener("input", () => {
    scheduleDraftAutosave();
  });
}

window.addEventListener("beforeunload", () => {
  persistCurrentModuleDraft(false);
});

function renderQuestions(selectedResponses = {}) {
  mcqQuestions.innerHTML = "";
  for (const question of currentQuestions) {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "12px";
    const title = document.createElement("div");
    title.textContent = question.stem;
    wrapper.appendChild(title);

    for (const option of question.options) {
      const label = document.createElement("label");
      label.style.display = "block";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q_${question.id}`;
      input.value = option;
      input.checked = selectedResponses[question.id] === option;
      input.addEventListener("change", () => {
        scheduleDraftAutosave();
      });
      label.appendChild(input);
      label.append(` ${option}`);
      wrapper.appendChild(label);
    }

    mcqQuestions.appendChild(wrapper);
  }
}

populateLocaleSelect();
setLocale(currentLocale);
loadVersion();
loadParticipantConsoleConfig();
