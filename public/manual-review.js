import { localeLabels, supportedLocales, translations } from "/static/i18n/manual-review-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
const outputStatus = document.getElementById("outputStatus");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const statusFilter = document.getElementById("manualReviewStatusFilter");
const queueSearchInput = document.getElementById("queueSearch");
const queueLimitInput = document.getElementById("queueLimit");
const queueCountLabel = document.getElementById("queueCount");
const manualReviewQueueBody = document.getElementById("manualReviewQueueBody");
const manualReviewMessage = document.getElementById("manualReviewMessage");
const selectedReviewIdInput = document.getElementById("selectedReviewId");
const manualReviewDetails = document.getElementById("manualReviewDetails");
const claimReviewButton = document.getElementById("claimReview");
const overrideReviewButton = document.getElementById("overrideReview");
const reviewDecisionReasonInput = document.getElementById("reviewDecisionReason");
const reviewOverrideReasonInput = document.getElementById("reviewOverrideReason");
const reviewPassFailTotalInput = document.getElementById("reviewPassFailTotal");
const overrideValidationMessage = document.getElementById("overrideValidationMessage");

const reviewStatusOptions = ["OPEN", "IN_REVIEW", "RESOLVED"];
const defaultOverridePassFailValue = "true";
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
let latestReviewQueue = [];
let selectedReviewId = "";
let selectedReviewDetails = null;
let activeReviewQueueLoad = null;
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: {
    items: defaultWorkspaceNavigationItems,
  },
  manualReviewWorkspace: {
    availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: ["OPEN", "IN_REVIEW"],
    queuePageSize: 50,
  },
  identityDefaults: {
    reviewer: {
      userId: "reviewer-user-1",
      email: "reviewer1@company.com",
      name: "Platform Reviewer",
      department: "Quality",
      roles: ["REVIEWER"],
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

  populateStatusFilters();
  renderRolePresetControl();
  renderWorkspaceNavigation();
  renderReviewQueue();
  renderManualReviewDetails(selectedReviewDetails);
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

function isDebugModeEnabled() {
  return participantRuntimeConfig?.debugMode !== false;
}

function applyOutputVisibility() {
  output.hidden = !isDebugModeEnabled();
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
    const preferredKeys = ["review", "reviews", "status", "submission"];
    const matchedKey = preferredKeys.find((key) => key in data);
    if (matchedKey) {
      return `Updated: ${matchedKey}`;
    }
  }
  return "Request completed.";
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
    return t("manualReview.pass");
  }
  if (value === false) {
    return t("manualReview.fail");
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
    return [t("manualReview.details.noCriteria")];
  }

  const entries = Object.entries(criteria);
  if (entries.length === 0) {
    return [t("manualReview.details.noCriteria")];
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

function getWorkspaceSettings() {
  const configured = participantRuntimeConfig?.manualReviewWorkspace ?? {};
  const availableStatuses = Array.isArray(configured.availableStatuses)
    ? configured.availableStatuses.filter((status) => reviewStatusOptions.includes(status))
    : ["OPEN", "IN_REVIEW", "RESOLVED"];
  const defaultStatuses = Array.isArray(configured.defaultStatuses)
    ? configured.defaultStatuses.filter((status) => availableStatuses.includes(status))
    : ["OPEN", "IN_REVIEW"];
  const queuePageSize = Math.max(1, Math.min(200, Number(configured.queuePageSize) || 50));

  return {
    availableStatuses: availableStatuses.length > 0 ? availableStatuses : ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: defaultStatuses.length > 0 ? defaultStatuses : ["OPEN", "IN_REVIEW"],
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

function populateStatusFilters() {
  const settings = getWorkspaceSettings();
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
    optionInput.setAttribute("aria-label", localizeReviewStatus(status));

    const optionText = document.createElement("span");
    optionText.textContent = localizeReviewStatus(status);

    optionLabel.appendChild(optionInput);
    optionLabel.appendChild(optionText);
    statusFilter.appendChild(optionLabel);
  }
}

function localizeReviewStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`manualReview.statusValue.${normalized || "UNKNOWN"}`);
}

function getSelectedReviewStatuses() {
  const selected = getCheckedPillValues(statusFilter);
  if (selected.length > 0) {
    return selected;
  }

  return getWorkspaceSettings().defaultStatuses;
}

function filterReviewsBySearch(reviews) {
  const needle = queueSearchInput.value.trim().toLowerCase();
  if (!needle) {
    return reviews;
  }

  return reviews.filter((review) => {
    const haystack = [
      review.id,
      review.reviewStatus,
      review.reviewer?.name,
      review.reviewer?.email,
      review.submission?.user?.name,
      review.submission?.user?.email,
      review.submission?.module?.title,
      review.submission?.module?.id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(needle);
  });
}

function renderReviewQueue() {
  manualReviewQueueBody.innerHTML = "";

  if (!Array.isArray(latestReviewQueue) || latestReviewQueue.length === 0) {
    queueCountLabel.textContent = "0";
    setSelectedReview("", true);
    selectedReviewDetails = null;
    renderManualReviewDetails(null);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = t("manualReview.noQueue");
    row.appendChild(cell);
    manualReviewQueueBody.appendChild(row);
    return;
  }

  const filtered = filterReviewsBySearch(latestReviewQueue);
  queueCountLabel.textContent = `${filtered.length} / ${latestReviewQueue.length}`;

  if (filtered.length === 0) {
    setSelectedReview("", true);
    selectedReviewDetails = null;
    renderManualReviewDetails(null);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = t("manualReview.noRows");
    row.appendChild(cell);
    manualReviewQueueBody.appendChild(row);
    return;
  }

  if (!selectedReviewId || !filtered.some((review) => review.id === selectedReviewId)) {
    setSelectedReview(filtered[0].id, true);
  }
  selectedReviewIdInput.value = selectedReviewId;

  for (const review of filtered) {
    const row = document.createElement("tr");
    row.className = review.id === selectedReviewId ? "selected" : "";
    row.style.cursor = "pointer";
    row.addEventListener("click", async () => {
      setSelectedReview(review.id, true);
      renderReviewQueue();
      await loadReviewDetails(review.id);
    });

    const participantName = review.submission?.user?.name ?? "-";
    const participantEmail = review.submission?.user?.email ?? "-";
    const reviewerName = review.reviewer?.name ?? "-";
    const reviewerEmail = review.reviewer?.email ?? "-";

    const values = [
      review.id,
      localizeReviewStatus(review.reviewStatus),
      `${participantName}\n${participantEmail}`,
      `${review.submission?.module?.title ?? "-"}\n${review.submission?.module?.id ?? "-"}`,
      formatDateTime(review.submission?.submittedAt),
      formatDateTime(review.createdAt),
      `${reviewerName}\n${reviewerEmail}`,
      formatDateTime(review.reviewedAt),
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.appendChild(cell);
    }

    manualReviewQueueBody.appendChild(row);
  }
}

function resetOverrideInputs() {
  reviewDecisionReasonInput.value = "";
  reviewOverrideReasonInput.value = "";
  reviewPassFailTotalInput.value = defaultOverridePassFailValue;
  resetOverrideValidationFeedback();
}

function resetOverrideValidationFeedback() {
  reviewDecisionReasonInput.classList.remove("is-invalid");
  reviewOverrideReasonInput.classList.remove("is-invalid");
  overrideValidationMessage.classList.remove("field-error");
  overrideValidationMessage.removeAttribute("role");
  overrideValidationMessage.textContent = "";
}

function setOverrideValidationError(message, field = null) {
  resetOverrideValidationFeedback();
  if (field) {
    field.classList.add("is-invalid");
  }
  overrideValidationMessage.classList.add("field-error");
  overrideValidationMessage.setAttribute("role", "alert");
  overrideValidationMessage.textContent = message;
}

function validateOverrideInput() {
  const decisionReason = reviewDecisionReasonInput.value.trim();
  const overrideReason = reviewOverrideReasonInput.value.trim();

  if (decisionReason.length < 5) {
    return {
      valid: false,
      message: t("manualReview.validation.decisionReasonMin"),
      field: reviewDecisionReasonInput,
    };
  }

  if (overrideReason.length < 5) {
    return {
      valid: false,
      message: t("manualReview.validation.overrideReasonMin"),
      field: reviewOverrideReasonInput,
    };
  }

  return { valid: true, decisionReason, overrideReason };
}

function setSelectedReview(reviewId, resetInputs = false) {
  const nextId = typeof reviewId === "string" ? reviewId : "";
  const changed = selectedReviewId !== nextId;
  selectedReviewId = nextId;
  selectedReviewIdInput.value = selectedReviewId || "-";

  if (changed && resetInputs) {
    resetOverrideInputs();
  }
}

function renderManualReviewDetails(details) {
  if (!details) {
    manualReviewDetails.textContent = t("manualReview.noDetails");
    return;
  }

  const review = details.review ?? details;
  const submission = review.submission ?? {};
  const latestDecision = submission.decisions?.[0] ?? null;
  const latestLlmEvaluation = Array.isArray(submission.llmEvaluations) ? submission.llmEvaluations[0] ?? null : null;
  const latestAppeal = Array.isArray(submission.appeals) ? submission.appeals[0] ?? null : null;
  const completedMcqAttempts = Array.isArray(submission.mcqAttempts)
    ? submission.mcqAttempts.filter((attempt) => attempt?.completedAt)
    : [];
  const latestMcqAttempt = completedMcqAttempts[0] ?? null;
  const llmStructured = parseLlmStructuredResponse(latestLlmEvaluation?.responseJson);
  const improvementAdvice = Array.isArray(llmStructured?.improvement_advice) ? llmStructured.improvement_advice : [];
  const criterionRationales = buildCriterionRationaleLines(llmStructured?.criterion_rationales);

  const lines = [
    `=== ${t("manualReview.details.section.review")} ===`,
    `${t("manualReview.details.reviewId")}: ${review.id ?? "-"}`,
    `${t("manualReview.details.reviewStatus")}: ${localizeReviewStatus(review.reviewStatus)}`,
    `${t("manualReview.details.triggerReason")}: ${normalizeMultilineText(review.triggerReason)}`,
    `${t("manualReview.details.reviewer")}: ${review.reviewer?.name ?? "-"} (${review.reviewer?.email ?? "-"})`,
    `${t("manualReview.details.createdAt")}: ${formatDateTime(review.createdAt)}`,
    `${t("manualReview.details.reviewedAt")}: ${formatDateTime(review.reviewedAt)}`,
    "",
    `=== ${t("manualReview.details.section.submission")} ===`,
    `${t("manualReview.details.submissionParticipant")}: ${submission.user?.name ?? "-"} (${submission.user?.email ?? "-"})`,
    `${t("manualReview.details.module")}: ${submission.module?.title ?? "-"} (${submission.module?.id ?? "-"})`,
    `${t("manualReview.details.submissionId")}: ${submission.id ?? "-"}`,
    `${t("manualReview.details.submittedAt")}: ${formatDateTime(submission.submittedAt)}`,
    `${t("manualReview.details.deliveryType")}: ${submission.deliveryType ?? "-"}`,
    `${t("manualReview.details.rawText")}:`,
    normalizeMultilineText(submission.rawText),
    "",
    `${t("manualReview.details.reflection")}:`,
    normalizeMultilineText(submission.reflectionText),
    "",
    `${t("manualReview.details.promptExcerpt")}:`,
    normalizeMultilineText(submission.promptExcerpt),
    "",
    `=== ${t("manualReview.details.section.mcq")} ===`,
    `${t("manualReview.details.mcqAttemptId")}: ${latestMcqAttempt?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.mcqPercentScore")}: ${formatNumber(latestMcqAttempt?.percentScore)}`,
    `${t("manualReview.details.mcqScaledScore")}: ${formatNumber(latestMcqAttempt?.scaledScore)}`,
    `${t("manualReview.details.mcqPassFail")}: ${formatPassFail(latestMcqAttempt?.passFailMcq)}`,
    `${t("manualReview.details.mcqCompletedAt")}: ${formatDateTime(latestMcqAttempt?.completedAt)}`,
    "",
    `=== ${t("manualReview.details.section.evaluation")} ===`,
    `${t("manualReview.details.decisionId")}: ${latestDecision?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.decisionType")}: ${latestDecision?.decisionType ?? "-"}`,
    `${t("manualReview.details.totalScore")}: ${formatNumber(latestDecision?.totalScore)}`,
    `${t("manualReview.details.passFailTotal")}: ${formatPassFail(latestDecision?.passFailTotal)}`,
    `${t("manualReview.details.decisionReason")}: ${normalizeMultilineText(latestDecision?.decisionReason)}`,
    `${t("manualReview.details.finalisedAt")}: ${formatDateTime(latestDecision?.finalisedAt)}`,
    `${t("manualReview.details.llmEvaluationId")}: ${latestLlmEvaluation?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.llmPracticalScore")}: ${formatNumber(latestLlmEvaluation?.practicalScoreScaled)}`,
    `${t("manualReview.details.llmPassFail")}: ${formatPassFail(latestLlmEvaluation?.passFailPractical)}`,
    `${t("manualReview.details.llmManualReviewRecommended")}: ${String(latestLlmEvaluation?.manualReviewRecommended ?? "-")}`,
    `${t("manualReview.details.llmConfidenceNote")}: ${normalizeMultilineText(latestLlmEvaluation?.confidenceNote)}`,
    `${t("manualReview.details.llmCreatedAt")}: ${formatDateTime(latestLlmEvaluation?.createdAt)}`,
    `${t("manualReview.details.improvementAdvice")}:`,
    ...(improvementAdvice.length > 0
      ? improvementAdvice.map((advice) => `- ${String(advice)}`)
      : [t("manualReview.details.none")]),
    `${t("manualReview.details.criterionRationales")}:`,
    ...criterionRationales,
    "",
    `=== ${t("manualReview.details.section.appeals")} ===`,
    `${t("manualReview.details.latestAppealId")}: ${latestAppeal?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.latestAppealStatus")}: ${latestAppeal?.appealStatus ?? "-"}`,
    `${t("manualReview.details.latestAppealCreatedAt")}: ${formatDateTime(latestAppeal?.createdAt)}`,
  ];

  manualReviewDetails.textContent = lines.join("\n");
}

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Manual Review Workspace v${version}`;
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
      manualReviewWorkspace: {
        ...participantRuntimeConfig.manualReviewWorkspace,
        ...(body?.manualReviewWorkspace ?? {}),
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
  populateStatusFilters();
  await loadReviewQueue();
}

function applyIdentityDefaults() {
  const identityDefaults = participantRuntimeConfig?.identityDefaults?.reviewer;
  if (!identityDefaults) {
    return;
  }

  document.getElementById("userId").value = identityDefaults.userId ?? "";
  document.getElementById("email").value = identityDefaults.email ?? "";
  document.getElementById("name").value = identityDefaults.name ?? "";
  document.getElementById("department").value = identityDefaults.department ?? "";
  rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
}

async function loadReviewDetails(reviewId) {
  if (!reviewId) {
    selectedReviewDetails = null;
    renderManualReviewDetails(null);
    return;
  }

  try {
    const body = await apiFetch(`/api/reviews/${reviewId}`, headers);
    selectedReviewDetails = body;
    renderManualReviewDetails(body);
    log(body);
  } catch (error) {
    manualReviewMessage.textContent = toActionableErrorMessage(error);
    selectedReviewDetails = null;
    renderManualReviewDetails(null);
    log(error.message);
  }
}

async function loadReviewQueue() {
  if (activeReviewQueueLoad) {
    return activeReviewQueueLoad;
  }

  activeReviewQueueLoad = (async () => {
    try {
      const statuses = getSelectedReviewStatuses();
      const limit = getWorkspaceSettings().queuePageSize;
      const body = await apiFetch(
        `/api/reviews?status=${encodeURIComponent(statuses.join(","))}&limit=${encodeURIComponent(limit)}`,
        headers,
      );
      latestReviewQueue = Array.isArray(body.reviews) ? body.reviews : [];
      renderReviewQueue();
      manualReviewMessage.textContent = `${t("manualReview.loadedPrefix")}: ${latestReviewQueue.length}`;

      if (selectedReviewId && latestReviewQueue.some((review) => review.id === selectedReviewId)) {
        await loadReviewDetails(selectedReviewId);
      } else {
        setSelectedReview("", false);
        selectedReviewDetails = null;
        renderManualReviewDetails(null);
      }
      log(body);
    } catch (error) {
      manualReviewMessage.textContent = toActionableErrorMessage(error);
      log(error.message);
    } finally {
      activeReviewQueueLoad = null;
    }
  })();

  return activeReviewQueueLoad;
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
  await loadReviewQueue();
});

queueSearchInput.addEventListener("input", () => {
  renderReviewQueue();
});

claimReviewButton.addEventListener("click", async () => {
  if (!selectedReviewId) {
    manualReviewMessage.textContent = t("manualReview.noSelection");
    return;
  }

  await runWithBusyButton(claimReviewButton, async () => {
    try {
      resetOverrideValidationFeedback();
      const body = await apiFetch(`/api/reviews/${selectedReviewId}/claim`, headers, {
        method: "POST",
        body: JSON.stringify({}),
      });
      manualReviewMessage.textContent = t("manualReview.claimed");
      setSelectedReview(selectedReviewId, true);
      log(body);
      await loadReviewQueue();
      await loadReviewDetails(selectedReviewId);
    } catch (error) {
      manualReviewMessage.textContent = toActionableErrorMessage(error);
      log(error.message);
    }
  });
});

overrideReviewButton.addEventListener("click", async () => {
  if (!selectedReviewId) {
    manualReviewMessage.textContent = t("manualReview.noSelection");
    return;
  }

  await runWithBusyButton(overrideReviewButton, async () => {
    try {
      const validation = validateOverrideInput();
      if (!validation.valid) {
        setOverrideValidationError(validation.message, validation.field);
        return;
      }

      resetOverrideValidationFeedback();
      const body = await apiFetch(`/api/reviews/${selectedReviewId}/override`, headers, {
        method: "POST",
        body: JSON.stringify({
          passFailTotal: reviewPassFailTotalInput.value === "true",
          decisionReason: validation.decisionReason,
          overrideReason: validation.overrideReason,
        }),
      });
      manualReviewMessage.textContent = t("manualReview.resolved");
      const resolvedReviewId = body?.review?.id ?? selectedReviewId;
      const resolvedReviewStatus = body?.review?.reviewStatus ?? "RESOLVED";
      const selectedStatuses = getSelectedReviewStatuses();
      if (!selectedStatuses.includes(resolvedReviewStatus)) {
        latestReviewQueue = latestReviewQueue.filter((review) => review.id !== resolvedReviewId);
        if (selectedReviewId === resolvedReviewId) {
          setSelectedReview("", true);
          selectedReviewDetails = null;
        }
      } else {
        setSelectedReview(resolvedReviewId, true);
      }
      renderReviewQueue();
      log(body);
      await loadReviewQueue();
      if (selectedReviewId) {
        await loadReviewDetails(selectedReviewId);
      }
    } catch (error) {
      const validationMessage = toValidationErrorMessage(error);
      if (validationMessage) {
        setOverrideValidationError(validationMessage);
      } else {
        manualReviewMessage.textContent = toActionableErrorMessage(error);
      }
      log(error.message);
    }
  });
});

reviewDecisionReasonInput.addEventListener("input", () => {
  if (overrideValidationMessage.textContent) {
    resetOverrideValidationFeedback();
  }
});

reviewOverrideReasonInput.addEventListener("input", () => {
  if (overrideValidationMessage.textContent) {
    resetOverrideValidationFeedback();
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
renderReviewQueue();
renderManualReviewDetails(null);
resetOverrideInputs();
