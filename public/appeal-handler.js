import { localeLabels, supportedLocales, translations } from "/static/i18n/appeal-handler-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { showToast } from "/static/toast.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
  sanitizeAppealStatuses,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
const outputStatus = document.getElementById("outputStatus");
const debugOutputSection = document.getElementById("debugOutputSection");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const statusFilter = document.getElementById("appealHandlerStatusFilter");
const queueSearchInput = document.getElementById("queueSearch");
const queueLimitInput = document.getElementById("queueLimit");
const queueCountLabel = document.getElementById("queueCount");
const appealQueueBody = document.getElementById("appealQueueBody");

const handlerSelectedAppealIdInput = document.getElementById("handlerSelectedAppealId");
const appealHandlerDetails = document.getElementById("appealHandlerDetails");
const claimAppealButton = document.getElementById("claimAppeal");
const resolveAppealButton = document.getElementById("resolveAppeal");
const handlerDecisionReasonInput = document.getElementById("handlerDecisionReason");
const handlerResolutionNoteInput = document.getElementById("handlerResolutionNote");
const handlerPassFailTotalInput = document.getElementById("handlerPassFailTotal");
const resolveValidationMessage = document.getElementById("resolveValidationMessage");
const rawDebugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";

let currentLocale = resolveInitialLocale();
let latestAppealQueue = [];
let selectedAppealId = "";
let selectedAppealDetails = null;
let activeAppealQueueLoad = null;
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
  appealWorkspace: {
    availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: ["OPEN", "IN_REVIEW"],
    queuePageSize: 50,
  },
  identityDefaults: {
    appealHandler: {
      userId: "handler-1",
      email: "appeal.handler@company.com",
      name: "Platform Appeal Handler",
      department: "Quality",
      roles: ["APPEAL_HANDLER"],
    },
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
const defaultResolutionPassFailValue = "true";
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

  populateAppealStatusFilters();
  renderRolePresetControl();
  renderWorkspaceNavigation();
  renderAppealQueue();
  renderAppealHandlerDetails(selectedAppealDetails);
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
    const preferredKeys = ["appeal", "appeals", "review", "status", "submission"];
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

function summarizeAppealHandlerResponse(data) {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data?.appeals)) {
    return `${t("appealHandler.loadedPrefix")}: ${data.appeals.length}`;
  }

  if (data?.appeal?.id) {
    const normalizedStatus = typeof data.appeal.appealStatus === "string" ? data.appeal.appealStatus.toUpperCase() : "";
    if (normalizedStatus === "RESOLVED") {
      return t("appealHandler.resolved");
    }
    if (data.appeal.claimedAt || data.appeal.resolvedById || data.appeal.resolvedBy?.id) {
      return t("appealHandler.claimed");
    }
    return `${t("appealHandler.selectedAppeal")}: ${data.appeal.id}`;
  }

  return formatOutputStatus(data);
}

function inferAppealHandlerToastType(data) {
  if (typeof data === "string") {
    return "error";
  }
  if (Array.isArray(data?.appeals)) {
    return "info";
  }
  return "success";
}

function setLocale(locale) {
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  document.documentElement.lang = currentLocale;
  applyTranslations();
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

function log(data, options = {}) {
  const { notify = true, detail = "" } = options;
  const statusText = summarizeAppealHandlerResponse(data);

  output.dataset.hasContent = "true";
  outputStatus.dataset.hasContent = "true";
  outputStatus.textContent = statusText;

  if (notify) {
    showToast(statusText, inferAppealHandlerToastType(data), detail);
  }

  if (!isRawDebugEnabled()) {
    output.textContent = "";
    return;
  }

  output.textContent = formatOutputDetail(data);
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

function formatPassFail(value) {
  if (value === true) {
    return t("appealHandler.pass");
  }
  if (value === false) {
    return t("appealHandler.fail");
  }
  return "-";
}

function normalizeMultilineText(value) {
  if (typeof value !== "string") {
    return "-";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "-";
}

function parseLlmStructuredResponse(rawJson) {
  if (typeof rawJson !== "string" || rawJson.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(rawJson);
  } catch {
    return null;
  }
}

function buildCriterionRationaleLines(criteria) {
  if (!criteria || typeof criteria !== "object") {
    return [t("appealHandler.details.noCriteria")];
  }

  const entries = Object.entries(criteria);
  if (entries.length === 0) {
    return [t("appealHandler.details.noCriteria")];
  }

  return entries.map(([criterion, rationale]) => `- ${criterion}: ${String(rationale)}`);
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
    return raw;
  } catch {
    return raw;
  }
}

function toValidationErrorMessage(error) {
  if (!(error instanceof Error)) {
    return null;
  }

  const raw = error.message ?? "";
  const splitIndex = raw.indexOf(":");
  if (splitIndex === -1) {
    return null;
  }

  const payloadText = raw.slice(splitIndex + 1).trim();
  try {
    const payload = JSON.parse(payloadText);
    if (payload?.error !== "validation_error" || !Array.isArray(payload.issues) || payload.issues.length === 0) {
      return null;
    }

    return payload.issues
      .map((issue) => (typeof issue?.message === "string" ? issue.message : "Validation error."))
      .join(" ");
  } catch {
    return null;
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
  const queuePageSize = Math.max(1, Math.min(200, Number(configured.queuePageSize) || 50));

  return {
    availableStatuses,
    defaultStatuses: defaultStatuses.length > 0 ? defaultStatuses : availableStatuses.slice(0, 1),
    queuePageSize,
  };
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

function populateAppealStatusFilters() {
  const settings = getAppealWorkspaceSettings();
  const selectedBeforeRefresh = new Set(getCheckedPillValues(statusFilter));
  statusFilter.innerHTML = "";
  queueLimitInput.value = String(settings.queuePageSize);

  for (const status of settings.availableStatuses) {
    const optionLabel = document.createElement("label");
    optionLabel.className = "pill-option";

    const optionInput = document.createElement("input");
    optionInput.type = "checkbox";
    optionInput.value = status;
    optionInput.checked =
      selectedBeforeRefresh.size > 0
        ? selectedBeforeRefresh.has(status)
        : settings.defaultStatuses.includes(status);
    optionInput.setAttribute("aria-label", localizeAppealStatus(status));

    const optionText = document.createElement("span");
    optionText.textContent = localizeAppealStatus(status);

    optionLabel.appendChild(optionInput);
    optionLabel.appendChild(optionText);
    statusFilter.appendChild(optionLabel);
  }
}

function localizeAppealStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`appeal.statusValue.${normalized || "UNKNOWN"}`);
}

function localizeManualReviewStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`manualReview.statusValue.${normalized || "UNKNOWN"}`);
}

function resolveModuleTitle(title) {
  if (!title) return "-";
  if (typeof title === "object") {
    return title[currentLocale] ?? title["en-GB"] ?? Object.values(title)[0] ?? "-";
  }
  try {
    const parsed = JSON.parse(title);
    if (parsed && typeof parsed === "object") {
      return parsed[currentLocale] ?? parsed["en-GB"] ?? Object.values(parsed)[0] ?? title;
    }
  } catch {
    // not JSON
  }
  return title;
}

function parseResponseJsonFields(submission) {
  if (!submission) return {};
  const raw = submission.responseJson;
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getSelectedAppealStatuses() {
  const selected = getCheckedPillValues(statusFilter);
  if (selected.length > 0) {
    return selected;
  }

  return getAppealWorkspaceSettings().defaultStatuses;
}

function filterAppealsBySearch(appeals) {
  const needle = queueSearchInput.value.trim().toLowerCase();
  if (!needle) {
    return appeals;
  }

  return appeals.filter((appeal) => {
    const haystack = [
      appeal.id,
      appeal.appealStatus,
      appeal.appealedBy?.name,
      appeal.appealedBy?.email,
      appeal.submission?.user?.name,
      appeal.submission?.user?.email,
      appeal.submission?.module?.title,
      appeal.submission?.module?.id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(needle);
  });
}

function renderAppealQueue() {
  hideLoading(appealQueueBody);
  appealQueueBody.innerHTML = "";

  if (!Array.isArray(latestAppealQueue) || latestAppealQueue.length === 0) {
    queueCountLabel.textContent = "0";
    setSelectedAppeal("", true);
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    showEmpty(appealQueueBody, t("appealHandler.noQueue"), { columns: 9 });
    return;
  }

  const filtered = filterAppealsBySearch(latestAppealQueue);
  queueCountLabel.textContent = `${filtered.length} / ${latestAppealQueue.length}`;

  if (filtered.length === 0) {
    setSelectedAppeal("", true);
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    showEmpty(appealQueueBody, t("appealHandler.noRows"), { columns: 9 });
    return;
  }

  if (!selectedAppealId || !filtered.some((appeal) => appeal.id === selectedAppealId)) {
    setSelectedAppeal(filtered[0].id, true);
  }
  handlerSelectedAppealIdInput.value = selectedAppealId;

  for (const appeal of filtered) {
    const row = document.createElement("tr");
    row.className = appeal.id === selectedAppealId ? "selected" : "";
    row.style.cursor = "pointer";
    row.addEventListener("click", async () => {
      setSelectedAppeal(appeal.id, true);
      renderAppealQueue();
      await loadAppealDetails(appeal.id);
    });

    const participantName = appeal.appealedBy?.name ?? appeal.submission?.user?.name ?? "-";
    const participantEmail = appeal.appealedBy?.email ?? appeal.submission?.user?.email ?? "-";
    const labels = [
      t("appealHandler.table.appealId"),
      t("appealHandler.table.status"),
      t("appealHandler.table.participant"),
      t("appealHandler.table.module"),
      t("appealHandler.table.submittedAt"),
      t("appealHandler.table.createdAt"),
      t("appealHandler.table.claimedAt"),
      t("appealHandler.table.resolvedAt"),
      t("appealHandler.table.sla"),
    ];
    const values = [
      appeal.id,
      localizeAppealStatus(appeal.appealStatus),
      `${participantName}\n${participantEmail}`,
      `${resolveModuleTitle(appeal.submission?.module?.title)}\n${appeal.submission?.module?.id ?? "-"}`,
      formatDateTime(appeal.submission?.submittedAt),
      formatDateTime(appeal.createdAt),
      formatDateTime(appeal.claimedAt),
      formatDateTime(appeal.resolvedAt),
      appeal.sla?.status ?? "-",
    ];

    for (let i = 0; i < values.length; i++) {
      const cell = document.createElement("td");
      cell.dataset.label = labels[i];
      cell.textContent = String(values[i]);
      row.appendChild(cell);
    }

    appealQueueBody.appendChild(row);
  }
}

function resetResolutionInputs() {
  handlerDecisionReasonInput.value = "";
  handlerResolutionNoteInput.value = "";
  handlerPassFailTotalInput.value = defaultResolutionPassFailValue;
  resetResolveValidationFeedback();
}

function resetResolveValidationFeedback() {
  handlerDecisionReasonInput.classList.remove("is-invalid");
  handlerDecisionReasonInput.setAttribute("aria-invalid", "false");
  handlerResolutionNoteInput.classList.remove("is-invalid");
  handlerResolutionNoteInput.setAttribute("aria-invalid", "false");
  resolveValidationMessage.classList.remove("field-error");
  resolveValidationMessage.removeAttribute("role");
  resolveValidationMessage.textContent = "";
}

function setResolveValidationError(message, field = null) {
  resetResolveValidationFeedback();
  if (field) {
    field.classList.add("is-invalid");
    field.setAttribute("aria-invalid", "true");
  }
  resolveValidationMessage.classList.add("field-error");
  resolveValidationMessage.setAttribute("role", "alert");
  resolveValidationMessage.textContent = message;
}

function validateResolveAppealInput() {
  const decisionReason = handlerDecisionReasonInput.value.trim();
  const resolutionNote = handlerResolutionNoteInput.value.trim();

  if (decisionReason.length < 5) {
    return {
      valid: false,
      message: t("appealHandler.validation.decisionReasonMin"),
      field: handlerDecisionReasonInput,
    };
  }

  if (resolutionNote.length < 5) {
    return {
      valid: false,
      message: t("appealHandler.validation.resolutionNoteMin"),
      field: handlerResolutionNoteInput,
    };
  }

  return { valid: true, decisionReason, resolutionNote };
}

function setSelectedAppeal(appealId, resetInputs = false) {
  const nextId = typeof appealId === "string" ? appealId : "";
  const changed = selectedAppealId !== nextId;
  selectedAppealId = nextId;
  handlerSelectedAppealIdInput.value = selectedAppealId || "-";

  if (changed && resetInputs) {
    resetResolutionInputs();
  }
}

function renderAppealHandlerDetails(details) {
  if (!details) {
    appealHandlerDetails.textContent = t("appealHandler.noDetails");
    return;
  }

  const appeal = details.appeal ?? details;
  const sla = details.sla ?? appeal.sla ?? null;
  const submission = appeal.submission ?? {};
  const responseFields = parseResponseJsonFields(submission);
  const latestDecision = submission.decisions?.[0] ?? submission.latestDecision ?? null;
  const latestLlmEvaluation = Array.isArray(submission.llmEvaluations) ? submission.llmEvaluations[0] ?? null : null;
  const latestManualReview = Array.isArray(submission.manualReviews) ? submission.manualReviews[0] ?? null : null;
  const completedMcqAttempts = Array.isArray(submission.mcqAttempts)
    ? submission.mcqAttempts.filter((attempt) => attempt?.completedAt)
    : [];
  const latestMcqAttempt = completedMcqAttempts[0] ?? null;
  const llmStructured = parseLlmStructuredResponse(latestLlmEvaluation?.responseJson);
  const improvementAdvice = Array.isArray(llmStructured?.improvement_advice) ? llmStructured.improvement_advice : [];
  const criterionRationales = buildCriterionRationaleLines(llmStructured?.criterion_rationales);

  const lines = [
    `=== ${t("appealHandler.details.section.appeal")} ===`,
    `${t("appealHandler.details.appealId")}: ${appeal.id}`,
    `${t("appealHandler.details.appealStatus")}: ${localizeAppealStatus(appeal.appealStatus)}`,
    `${t("appealHandler.details.appealReason")}: ${normalizeMultilineText(appeal.appealReason)}`,
    `${t("appealHandler.details.participant")}: ${appeal.appealedBy?.name ?? "-"} (${appeal.appealedBy?.email ?? "-"})`,
    `${t("appealHandler.details.submissionParticipant")}: ${submission.user?.name ?? "-"} (${submission.user?.email ?? "-"})`,
    `${t("appealHandler.details.module")}: ${resolveModuleTitle(submission.module?.title)} (${submission.module?.id ?? "-"})`,
    `${t("appealHandler.details.submissionId")}: ${submission.id ?? "-"}`,
    `${t("appealHandler.details.submittedAt")}: ${formatDateTime(submission.submittedAt)}`,
    `${t("appealHandler.details.createdAt")}: ${formatDateTime(appeal.createdAt)}`,
    `${t("appealHandler.details.claimedAt")}: ${formatDateTime(appeal.claimedAt)}`,
    `${t("appealHandler.details.resolvedAt")}: ${formatDateTime(appeal.resolvedAt)}`,
    `${t("appealHandler.details.handlerId")}: ${appeal.resolvedById ?? appeal.resolvedBy?.id ?? "-"}`,
    `${t("appealHandler.details.resolutionNote")}: ${normalizeMultilineText(appeal.resolutionNote)}`,
    "",
    `=== ${t("appealHandler.details.section.submission")} ===`,
    `${t("appealHandler.details.deliveryType")}: ${submission.deliveryType ?? "-"}`,
    `${t("appealHandler.details.rawText")}:`,
    normalizeMultilineText(responseFields.response ?? submission.rawText),
    "",
    `${t("appealHandler.details.reflection")}:`,
    normalizeMultilineText(responseFields.reflection ?? submission.reflectionText),
    "",
    `${t("appealHandler.details.promptExcerpt")}:`,
    normalizeMultilineText(responseFields.promptExcerpt ?? submission.promptExcerpt),
    "",
    `=== ${t("appealHandler.details.section.mcq")} ===`,
    `${t("appealHandler.details.mcqAttemptId")}: ${latestMcqAttempt?.id ?? t("appealHandler.details.none")}`,
    `${t("appealHandler.details.mcqPercentScore")}: ${formatNumber(latestMcqAttempt?.percentScore)}`,
    `${t("appealHandler.details.mcqScaledScore")}: ${formatNumber(latestMcqAttempt?.scaledScore)}`,
    `${t("appealHandler.details.mcqPassFail")}: ${formatPassFail(latestMcqAttempt?.passFailMcq)}`,
    `${t("appealHandler.details.mcqCompletedAt")}: ${formatDateTime(latestMcqAttempt?.completedAt)}`,
    "",
    `=== ${t("appealHandler.details.section.evaluation")} ===`,
    `${t("appealHandler.details.decisionId")}: ${latestDecision?.id ?? t("appealHandler.details.none")}`,
    `${t("appealHandler.details.decisionType")}: ${latestDecision?.decisionType ?? "-"}`,
    `${t("appealHandler.details.totalScore")}: ${formatNumber(latestDecision?.totalScore)}`,
    `${t("appealHandler.details.passFailTotal")}: ${formatPassFail(latestDecision?.passFailTotal)}`,
    `${t("appealHandler.details.decisionReason")}: ${normalizeMultilineText(latestDecision?.decisionReason)}`,
    `${t("appealHandler.details.finalisedAt")}: ${formatDateTime(latestDecision?.finalisedAt)}`,
    `${t("appealHandler.details.llmEvaluationId")}: ${latestLlmEvaluation?.id ?? t("appealHandler.details.none")}`,
    `${t("appealHandler.details.llmPracticalScore")}: ${formatNumber(latestLlmEvaluation?.practicalScoreScaled)}`,
    `${t("appealHandler.details.llmPassFail")}: ${formatPassFail(latestLlmEvaluation?.passFailPractical)}`,
    `${t("appealHandler.details.llmManualReviewRecommended")}: ${String(latestLlmEvaluation?.manualReviewRecommended ?? "-")}`,
    `${t("appealHandler.details.llmConfidenceNote")}: ${normalizeMultilineText(latestLlmEvaluation?.confidenceNote)}`,
    `${t("appealHandler.details.llmCreatedAt")}: ${formatDateTime(latestLlmEvaluation?.createdAt)}`,
    `${t("appealHandler.details.improvementAdvice")}:`,
    ...(improvementAdvice.length > 0
      ? improvementAdvice.map((advice) => `- ${String(advice)}`)
      : [t("appealHandler.details.none")]),
    `${t("appealHandler.details.criterionRationales")}:`,
    ...criterionRationales,
  ];

  lines.push("");
  lines.push(`=== ${t("appealHandler.details.section.manualReview")} ===`);
  if (latestManualReview) {
    lines.push(`${t("appealHandler.details.manualReviewId")}: ${latestManualReview.id ?? t("appealHandler.details.none")}`);
    lines.push(`${t("appealHandler.details.manualReviewStatus")}: ${localizeManualReviewStatus(latestManualReview.reviewStatus)}`);
    lines.push(
      `${t("appealHandler.details.manualReviewTriggerReason")}: ${normalizeMultilineText(latestManualReview.triggerReason)}`,
    );
    lines.push(`${t("appealHandler.details.manualReviewReviewerId")}: ${latestManualReview.reviewerId ?? "-"}`);
    lines.push(`${t("appealHandler.details.manualReviewCreatedAt")}: ${formatDateTime(latestManualReview.createdAt)}`);
    lines.push(`${t("appealHandler.details.manualReviewReviewedAt")}: ${formatDateTime(latestManualReview.reviewedAt)}`);
    lines.push(`${t("appealHandler.details.manualReviewOverrideDecision")}: ${latestManualReview.overrideDecision ?? "-"}`);
    lines.push(
      `${t("appealHandler.details.manualReviewOverrideReason")}: ${normalizeMultilineText(latestManualReview.overrideReason)}`,
    );
  } else {
    lines.push(t("appealHandler.details.noManualReviewHistory"));
  }

  if (sla) {
    lines.push("");
    lines.push(`=== ${t("appealHandler.details.section.sla")} ===`);
    lines.push(`${t("appealHandler.details.slaStatus")}: ${sla.status ?? "-"}`);
    lines.push(`${t("appealHandler.details.firstResponseHours")}: ${sla.firstResponseDurationHours ?? "-"}`);
    lines.push(`${t("appealHandler.details.resolutionHours")}: ${sla.resolutionDurationHours ?? "-"}`);
  }

  appealHandlerDetails.textContent = lines.join("\n");
}

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Appeal Handler Workspace v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
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
      appealWorkspace: {
        ...participantRuntimeConfig.appealWorkspace,
        ...(body?.appealWorkspace ?? {}),
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
  populateAppealStatusFilters();
  await loadAppealQueue();
}

function applyIdentityDefaults() {
  const identityDefaults = participantRuntimeConfig?.identityDefaults?.appealHandler;
  if (!identityDefaults) {
    return;
  }

  document.getElementById("userId").value = identityDefaults.userId ?? "";
  document.getElementById("email").value = identityDefaults.email ?? "";
  document.getElementById("name").value = identityDefaults.name ?? "";
  document.getElementById("department").value = identityDefaults.department ?? "";
  rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
}

async function loadAppealDetails(appealId, options = {}) {
  if (!appealId) {
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    return;
  }

  try {
    const body = await apiFetch(`/api/appeals/${appealId}`, headers);
    selectedAppealDetails = body;
    renderAppealHandlerDetails(body);
    log(body, { notify: options.notify === true });
  } catch (error) {
    showToast(toActionableErrorMessage(error), "error");
    log(error.message);
  }
}

async function loadAppealQueue(options = {}) {
  if (activeAppealQueueLoad) {
    return activeAppealQueueLoad;
  }

  activeAppealQueueLoad = (async () => {
    try {
      showLoading(appealQueueBody, { rows: 5, columns: 9 });
      const statuses = getSelectedAppealStatuses();
      const limit = getAppealWorkspaceSettings().queuePageSize;
      const body = await apiFetch(
        `/api/appeals?status=${encodeURIComponent(statuses.join(","))}&limit=${encodeURIComponent(limit)}`,
        headers,
      );
      latestAppealQueue = Array.isArray(body.appeals) ? body.appeals : [];
      renderAppealQueue();
      showToast(`${t("appealHandler.loadedPrefix")}: ${latestAppealQueue.length}`, "info");

      if (selectedAppealId && latestAppealQueue.some((appeal) => appeal.id === selectedAppealId)) {
        await loadAppealDetails(selectedAppealId, { notify: false });
      } else {
        setSelectedAppeal("", false);
        selectedAppealDetails = null;
        renderAppealHandlerDetails(null);
      }
      log(body, { notify: options.notify === true });
    } catch (error) {
      queueCountLabel.textContent = "0";
      selectedAppealDetails = null;
      renderAppealHandlerDetails(null);
      showEmpty(appealQueueBody, toActionableErrorMessage(error), { columns: 9 });
      showToast(toActionableErrorMessage(error), "error");
      log(error.message);
    } finally {
      activeAppealQueueLoad = null;
    }
  })();

  return activeAppealQueueLoad;
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

statusFilter.addEventListener("change", async () => {
  await loadAppealQueue({ notify: true });
});

queueSearchInput.addEventListener("input", () => {
  renderAppealQueue();
});

claimAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) {
    showToast(t("appealHandler.noSelection"), "info");
    return;
  }

  await runWithBusyButton(claimAppealButton, async () => {
    try {
      resetResolveValidationFeedback();
      const body = await apiFetch(`/api/appeals/${selectedAppealId}/claim`, headers, {
        method: "POST",
        body: JSON.stringify({}),
      });
      showToast(t("appealHandler.claimed"), "success");
      setSelectedAppeal(selectedAppealId, true);
      log(body);
      await loadAppealQueue({ notify: false });
      await loadAppealDetails(selectedAppealId, { notify: false });
    } catch (error) {
      showToast(toActionableErrorMessage(error), "error");
      log(error.message);
    }
  });
});

resolveAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) {
    showToast(t("appealHandler.noSelection"), "info");
    return;
  }

  await runWithBusyButton(resolveAppealButton, async () => {
    try {
      const validation = validateResolveAppealInput();
      if (!validation.valid) {
        setResolveValidationError(validation.message, validation.field);
        return;
      }

      resetResolveValidationFeedback();
      const body = await apiFetch(`/api/appeals/${selectedAppealId}/resolve`, headers, {
        method: "POST",
        body: JSON.stringify({
          passFailTotal: handlerPassFailTotalInput.value === "true",
          decisionReason: validation.decisionReason,
          resolutionNote: validation.resolutionNote,
        }),
      });
      showToast(t("appealHandler.resolved"), "success");
      const resolvedAppealId = body?.appeal?.id ?? selectedAppealId;
      const resolvedAppealStatus = body?.appeal?.appealStatus ?? "RESOLVED";
      const selectedStatuses = getSelectedAppealStatuses();
      if (!selectedStatuses.includes(resolvedAppealStatus)) {
        latestAppealQueue = latestAppealQueue.filter((appeal) => appeal.id !== resolvedAppealId);
        if (selectedAppealId === resolvedAppealId) {
          setSelectedAppeal("", true);
          selectedAppealDetails = null;
        }
      } else {
        setSelectedAppeal(resolvedAppealId, true);
      }
      renderAppealQueue();
      log(body);
      await loadAppealQueue({ notify: false });
      if (selectedAppealId) {
        await loadAppealDetails(selectedAppealId, { notify: false });
      }
    } catch (error) {
      const validationMessage = toValidationErrorMessage(error);
      if (validationMessage) {
        setResolveValidationError(validationMessage);
      } else {
        showToast(toActionableErrorMessage(error), "error");
      }
      log(error.message);
    }
  });
});

handlerDecisionReasonInput.addEventListener("input", () => {
  if (resolveValidationMessage.textContent) {
    resetResolveValidationFeedback();
  }
});

handlerResolutionNoteInput.addEventListener("input", () => {
  if (resolveValidationMessage.textContent) {
    resetResolveValidationFeedback();
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

populateLocaleSelect();
setLocale(currentLocale);
enablePillArrowNavigation(statusFilter);
loadVersion();
loadParticipantConsoleConfig();
renderAppealQueue();
renderAppealHandlerDetails(null);
resetResolutionInputs();
