import { localeLabels, supportedLocales, translations } from "/static/i18n/review-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { showToast } from "/static/toast.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
  sanitizeAppealStatuses,
} from "/static/participant-console-state.js";

// ── DOM refs (shared) ──────────────────────────────────────────────────────────

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

// ── DOM refs (manual review) ───────────────────────────────────────────────────

const manualReviewSection = document.getElementById("manualReviewSection");
const manualReviewDetailsSection = document.getElementById("manualReviewDetailsSection");
const mrStatusFilter = document.getElementById("manualReviewStatusFilter");
const mrQueueSearchInput = document.getElementById("mrQueueSearch");
const mrQueueLimitInput = document.getElementById("mrQueueLimit");
const mrQueueCountLabel = document.getElementById("mrQueueCount");
const manualReviewQueueBody = document.getElementById("manualReviewQueueBody");
const selectedReviewIdInput = document.getElementById("selectedReviewId");
const manualReviewDetails = document.getElementById("manualReviewDetails");
const claimReviewButton = document.getElementById("claimReview");
const overrideReviewButton = document.getElementById("overrideReview");
const reviewDecisionReasonInput = document.getElementById("reviewDecisionReason");
const reviewOverrideReasonInput = document.getElementById("reviewOverrideReason");
const reviewPassFailTotalInput = document.getElementById("reviewPassFailTotal");
const reviewActionSequenceHint = document.getElementById("reviewActionSequenceHint");
const overrideValidationMessage = document.getElementById("overrideValidationMessage");

// ── DOM refs (appeal) ──────────────────────────────────────────────────────────

const appealSection = document.getElementById("appealSection");
const appealDetailsSection = document.getElementById("appealDetailsSection");
const appealStatusFilter = document.getElementById("appealHandlerStatusFilter");
const appealQueueSearchInput = document.getElementById("appealQueueSearch");
const appealQueueLimitInput = document.getElementById("appealQueueLimit");
const appealQueueCountLabel = document.getElementById("appealQueueCount");
const appealQueueBody = document.getElementById("appealQueueBody");
const handlerSelectedAppealIdInput = document.getElementById("handlerSelectedAppealId");
const appealHandlerDetails = document.getElementById("appealHandlerDetails");
const claimAppealButton = document.getElementById("claimAppeal");
const resolveAppealButton = document.getElementById("resolveAppeal");
const handlerDecisionReasonInput = document.getElementById("handlerDecisionReason");
const handlerResolutionNoteInput = document.getElementById("handlerResolutionNote");
const handlerPassFailTotalInput = document.getElementById("handlerPassFailTotal");
const resolveValidationMessage = document.getElementById("resolveValidationMessage");

// ── State ──────────────────────────────────────────────────────────────────────

const rawDebugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";
const defaultOverridePassFailValue = "true";
const defaultResolutionPassFailValue = "true";
const reviewStatusOptions = ["OPEN", "IN_REVIEW", "RESOLVED"];

let currentLocale = resolveInitialLocale();

// MR state
let latestReviewQueue = [];
let selectedReviewId = "";
let selectedReviewDetails = null;
let activeReviewQueueLoad = null;

// Appeal state
let latestAppealQueue = [];
let selectedAppealId = "";
let selectedAppealDetails = null;
let activeAppealQueueLoad = null;

const defaultWorkspaceNavigationItems = [
  { id: "participant", path: "/participant", labelKey: "nav.participant", requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"] },
  { id: "review", path: "/review", labelKey: "nav.review", requiredRoles: ["REVIEWER", "APPEAL_HANDLER", "ADMINISTRATOR"] },
  { id: "calibration", path: "/calibration", labelKey: "nav.calibration", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"] },
  { id: "admin-content", path: "/admin-content", labelKey: "nav.adminContent", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"] },
  { id: "admin-platform", path: "/admin-platform", labelKey: "nav.adminPlatform", requiredRoles: ["ADMINISTRATOR"] },
  { id: "results", path: "/results", labelKey: "nav.results", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR", "REPORT_READER"] },
  { id: "profile", path: "/profile", labelKey: "nav.profile", requiredRoles: [] },
];

let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: rawDebugEnabled,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: { items: defaultWorkspaceNavigationItems },
  manualReviewWorkspace: {
    availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: ["OPEN", "IN_REVIEW"],
    queuePageSize: 50,
  },
  appealWorkspace: {
    availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: ["OPEN", "IN_REVIEW"],
    queuePageSize: 50,
  },
  identityDefaults: {
    reviewWorkspace: {
      userId: "reviewer-user-1",
      email: "reviewer1@company.com",
      name: "Platform Reviewer",
      department: "Quality",
      roles: ["REVIEWER", "APPEAL_HANDLER"],
    },
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);

// ── Locale ─────────────────────────────────────────────────────────────────────

function resolveInitialLocale() {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) return stored;
  const browser = navigator.language ?? "";
  const normalized = browser.toLowerCase();
  if (normalized.startsWith("nb")) return "nb";
  if (normalized.startsWith("nn")) return "nn";
  if (normalized.startsWith("en")) return "en-GB";
  return "en-GB";
}

function t(key) {
  return translations[currentLocale]?.[key] ?? translations["en-GB"]?.[key] ?? key;
}

function setLocale(locale) {
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  document.documentElement.lang = currentLocale;
  applyTranslations();
}

function applyTranslations() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.placeholder = t(key);
  }

  applyOutputVisibility();

  if (!output.dataset.hasContent) output.textContent = t("defaults.ready");
  if (!outputStatus.dataset.hasContent) outputStatus.textContent = t("defaults.ready");

  populateMrStatusFilters();
  populateAppealStatusFilters();
  renderRolePresetControl();
  renderWorkspaceNavigation();
  renderReviewQueue();
  renderManualReviewDetails(selectedReviewDetails);
  renderReviewActionState();
  renderAppealQueue();
  renderAppealHandlerDetails(selectedAppealDetails);
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

// ── Output / debug ──────────────────────────────────────────────────────────────

function applyOutputVisibility() {
  if (debugOutputSection) debugOutputSection.hidden = !rawDebugEnabled;
  if (output) output.hidden = !rawDebugEnabled;
}

function logDebug(data) {
  output.dataset.hasContent = "true";
  outputStatus.dataset.hasContent = "true";
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  outputStatus.textContent = typeof data === "string" ? data : (data?.message ?? "Request completed.");
  if (rawDebugEnabled) output.textContent = text;
}

// ── Shared utilities ────────────────────────────────────────────────────────────

function headers() {
  const roles = rolesInput.value.split(",").map((v) => v.trim()).filter(Boolean).join(",");
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
  if (!button || button.dataset.busy === "true") return;
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
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(currentLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatNumber(value, maxFractionDigits = 2) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat(currentLocale, { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits }).format(value);
}

function normalizeMultilineText(value) {
  if (typeof value !== "string") return "-";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "-";
}

function parseLlmStructuredResponse(rawJson) {
  if (typeof rawJson !== "string" || rawJson.trim().length === 0) return null;
  try { return JSON.parse(rawJson); } catch { return null; }
}

function toActionableErrorMessage(error) {
  if (!(error instanceof Error)) return "Unexpected error.";
  const raw = error.message ?? "";
  const splitIndex = raw.indexOf(":");
  if (splitIndex === -1) return raw;
  const payloadText = raw.slice(splitIndex + 1).trim();
  try {
    const payload = JSON.parse(payloadText);
    if (typeof payload.message === "string" && payload.message.trim().length > 0) return payload.message;
    return raw;
  } catch { return raw; }
}

function toValidationErrorMessage(error) {
  if (!(error instanceof Error)) return null;
  const raw = error.message ?? "";
  const splitIndex = raw.indexOf(":");
  if (splitIndex === -1) return null;
  const payloadText = raw.slice(splitIndex + 1).trim();
  try {
    const payload = JSON.parse(payloadText);
    if (payload?.error !== "validation_error" || !Array.isArray(payload.issues) || payload.issues.length === 0) return null;
    return payload.issues.map((issue) => (typeof issue?.message === "string" ? issue.message : "Validation error.")).join(" ");
  } catch { return null; }
}

function getCheckedPillValues(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function enablePillArrowNavigation(container) {
  if (!container) return;
  container.addEventListener("keydown", (event) => {
    const isPrevious = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const isNext = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!isPrevious && !isNext) return;
    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    if (checkboxes.length === 0) return;
    const currentIndex = checkboxes.indexOf(document.activeElement);
    if (currentIndex === -1) return;
    event.preventDefault();
    const direction = isPrevious ? -1 : 1;
    const nextIndex = (currentIndex + direction + checkboxes.length) % checkboxes.length;
    checkboxes[nextIndex].focus();
  });
}

// ── Role-based section visibility ──────────────────────────────────────────────

function getUserRoles() {
  return rolesInput.value.split(",").map((v) => v.trim()).filter(Boolean);
}

function canReview(roles = getUserRoles()) {
  return roles.some((r) => r === "REVIEWER" || r === "ADMINISTRATOR");
}

function canHandleAppeals(roles = getUserRoles()) {
  return roles.some((r) => r === "APPEAL_HANDLER" || r === "ADMINISTRATOR");
}

function applyRoleBasedVisibility() {
  const roles = getUserRoles();
  const showMr = canReview(roles);
  const showAppeal = canHandleAppeals(roles);
  manualReviewSection.hidden = !showMr;
  manualReviewDetailsSection.hidden = !showMr;
  appealSection.hidden = !showAppeal;
  appealDetailsSection.hidden = !showAppeal;
}

// ── Navigation ─────────────────────────────────────────────────────────────────

function renderRolePresetControl() {
  mockRolePresetSelect.innerHTML = "";
  const manual = document.createElement("option");
  manual.value = "";
  manual.textContent = t("identity.rolePresetManual");
  mockRolePresetSelect.appendChild(manual);

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
  if (mockRolePresetHint) {
    mockRolePresetHint.textContent = disabled
      ? t("identity.rolePresetDisabledEntra")
      : t("identity.rolePresetHint");
  }
  if (mockRolePresetContainer) {
    mockRolePresetContainer.hidden = roleSwitchState.presets.length === 0;
  }
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;

  const allItems = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    rolesInput.value,
    window.location.pathname,
    defaultWorkspaceNavigationItems,
  ).filter((item) => item.visible);

  const profileItem = allItems.find((item) => item.id === "profile");
  const items = allItems.filter((item) => item.id !== "profile");

  const localePicker = document.querySelector(".locale-picker");
  if (localePicker && profileItem) {
    localePicker.style.display = "flex";
    localePicker.style.alignItems = "center";
    localePicker.style.gap = "8px";
    let profileLink = document.getElementById("profileNavLink");
    if (!profileLink) {
      profileLink = document.createElement("a");
      profileLink.id = "profileNavLink";
      localePicker.appendChild(profileLink);
    }
    profileLink.href = profileItem.path;
    profileLink.textContent = t(profileItem.labelKey);
    profileLink.className = profileItem.active ? "workspace-nav-link active" : "workspace-nav-link";
  }

  workspaceNav.innerHTML = "";
  workspaceNav.hidden = items.length === 0;
  for (const item of items) {
    const link = document.createElement("a");
    link.href = item.path;
    link.className = item.active ? "workspace-nav-link active" : "workspace-nav-link";
    link.textContent = t(item.labelKey);
    if (item.active) link.setAttribute("aria-current", "page");
    workspaceNav.appendChild(link);
  }
}

// ── Manual Review: workspace settings ─────────────────────────────────────────

function getMrWorkspaceSettings() {
  const configured = participantRuntimeConfig?.manualReviewWorkspace ?? {};
  const availableStatuses = Array.isArray(configured.availableStatuses)
    ? configured.availableStatuses.filter((s) => reviewStatusOptions.includes(s))
    : ["OPEN", "IN_REVIEW", "RESOLVED"];
  const defaultStatuses = Array.isArray(configured.defaultStatuses)
    ? configured.defaultStatuses.filter((s) => availableStatuses.includes(s))
    : ["OPEN", "IN_REVIEW"];
  const queuePageSize = Math.max(1, Math.min(200, Number(configured.queuePageSize) || 50));
  return {
    availableStatuses: availableStatuses.length > 0 ? availableStatuses : ["OPEN", "IN_REVIEW", "RESOLVED"],
    defaultStatuses: defaultStatuses.length > 0 ? defaultStatuses : ["OPEN", "IN_REVIEW"],
    queuePageSize,
  };
}

function localizeReviewStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`manualReview.statusValue.${normalized || "UNKNOWN"}`);
}

function populateMrStatusFilters() {
  if (!mrStatusFilter) return;
  const settings = getMrWorkspaceSettings();
  const selectedBefore = new Set(getCheckedPillValues(mrStatusFilter));
  mrStatusFilter.innerHTML = "";
  mrQueueLimitInput.value = String(settings.queuePageSize);

  for (const status of settings.availableStatuses) {
    const label = document.createElement("label");
    label.className = "pill-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = status;
    input.checked = selectedBefore.size > 0 ? selectedBefore.has(status) : settings.defaultStatuses.includes(status);
    input.setAttribute("aria-label", localizeReviewStatus(status));
    const span = document.createElement("span");
    span.textContent = localizeReviewStatus(status);
    label.appendChild(input);
    label.appendChild(span);
    mrStatusFilter.appendChild(label);
  }
}

function getSelectedReviewStatuses() {
  const selected = getCheckedPillValues(mrStatusFilter);
  return selected.length > 0 ? selected : getMrWorkspaceSettings().defaultStatuses;
}

function filterReviewsBySearch(reviews) {
  const needle = mrQueueSearchInput.value.trim().toLowerCase();
  if (!needle) return reviews;
  return reviews.filter((review) => {
    const haystack = [
      review.id, review.reviewStatus,
      review.reviewer?.name, review.reviewer?.email,
      review.submission?.user?.name, review.submission?.user?.email,
      review.submission?.module?.title, review.submission?.module?.id,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

// ── Manual Review: queue rendering ────────────────────────────────────────────

function renderReviewQueue() {
  manualReviewQueueBody.innerHTML = "";
  if (!Array.isArray(latestReviewQueue) || latestReviewQueue.length === 0) {
    mrQueueCountLabel.textContent = "0";
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
  mrQueueCountLabel.textContent = `${filtered.length} / ${latestReviewQueue.length}`;

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

  if (!selectedReviewId || !filtered.some((r) => r.id === selectedReviewId)) {
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

    const labels = [
      t("manualReview.table.reviewId"), t("manualReview.table.status"),
      t("manualReview.table.participant"), t("manualReview.table.module"),
      t("manualReview.table.submittedAt"), t("manualReview.table.createdAt"),
      t("manualReview.table.reviewer"), t("manualReview.table.reviewedAt"),
    ];
    const values = [
      review.id,
      localizeReviewStatus(review.reviewStatus),
      `${review.submission?.user?.name ?? "-"}\n${review.submission?.user?.email ?? "-"}`,
      `${review.submission?.module?.title ?? "-"}\n${review.submission?.module?.id ?? "-"}`,
      formatDateTime(review.submission?.submittedAt),
      formatDateTime(review.createdAt),
      `${review.reviewer?.name ?? "-"}\n${review.reviewer?.email ?? "-"}`,
      formatDateTime(review.reviewedAt),
    ];
    for (let i = 0; i < values.length; i++) {
      const cell = document.createElement("td");
      cell.dataset.label = labels[i];
      cell.textContent = String(values[i]);
      row.appendChild(cell);
    }
    manualReviewQueueBody.appendChild(row);
  }
}

// ── Manual Review: detail panel ────────────────────────────────────────────────

function buildMrCriterionRationaleLines(criteria) {
  if (!criteria || typeof criteria !== "object") return [t("manualReview.details.noCriteria")];
  const entries = Object.entries(criteria);
  if (entries.length === 0) return [t("manualReview.details.noCriteria")];
  return entries.map(([, rationale], i) => `${i + 1}. ${String(rationale)}`);
}

function formatMrPassFail(value) {
  if (value === true) return t("manualReview.pass");
  if (value === false) return t("manualReview.fail");
  return "-";
}

function renderManualReviewDetails(details) {
  if (!details) {
    manualReviewDetails.textContent = t("manualReview.noDetails");
    renderReviewActionState();
    return;
  }

  const review = details.review ?? details;
  const submission = review.submission ?? {};
  const latestDecision = submission.decisions?.[0] ?? null;
  const latestLlmEvaluation = Array.isArray(submission.llmEvaluations) ? submission.llmEvaluations[0] ?? null : null;
  const latestAppeal = Array.isArray(submission.appeals) ? submission.appeals[0] ?? null : null;
  const completedMcqAttempts = Array.isArray(submission.mcqAttempts)
    ? submission.mcqAttempts.filter((a) => a?.completedAt) : [];
  const latestMcqAttempt = completedMcqAttempts[0] ?? null;
  const llmStructured = parseLlmStructuredResponse(latestLlmEvaluation?.responseJson);
  const improvementAdvice = Array.isArray(llmStructured?.improvement_advice) ? llmStructured.improvement_advice : [];
  const criterionRationales = buildMrCriterionRationaleLines(llmStructured?.criterion_rationales);

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
    ...(submission.promptExcerpt
      ? [`${t("manualReview.details.promptExcerpt")}:`, normalizeMultilineText(submission.promptExcerpt), ""]
      : []),
    `=== ${t("manualReview.details.section.mcq")} ===`,
    `${t("manualReview.details.mcqAttemptId")}: ${latestMcqAttempt?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.mcqPercentScore")}: ${formatNumber(latestMcqAttempt?.percentScore)}`,
    `${t("manualReview.details.mcqScaledScore")}: ${formatNumber(latestMcqAttempt?.scaledScore)}`,
    `${t("manualReview.details.mcqPassFail")}: ${formatMrPassFail(latestMcqAttempt?.passFailMcq)}`,
    `${t("manualReview.details.mcqCompletedAt")}: ${formatDateTime(latestMcqAttempt?.completedAt)}`,
    "",
    `=== ${t("manualReview.details.section.evaluation")} ===`,
    `${t("manualReview.details.decisionId")}: ${latestDecision?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.decisionType")}: ${latestDecision?.decisionType ?? "-"}`,
    `${t("manualReview.details.totalScore")}: ${formatNumber(latestDecision?.totalScore)}`,
    `${t("manualReview.details.passFailTotal")}: ${formatMrPassFail(latestDecision?.passFailTotal)}`,
    `${t("manualReview.details.decisionReason")}: ${normalizeMultilineText(latestDecision?.decisionReason)}`,
    `${t("manualReview.details.finalisedAt")}: ${formatDateTime(latestDecision?.finalisedAt)}`,
    `${t("manualReview.details.llmEvaluationId")}: ${latestLlmEvaluation?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.llmPracticalScore")}: ${formatNumber(latestLlmEvaluation?.practicalScoreScaled)}`,
    `${t("manualReview.details.llmPassFail")}: ${formatMrPassFail(latestLlmEvaluation?.passFailPractical)}`,
    `${t("manualReview.details.llmManualReviewRecommended")}: ${String(latestLlmEvaluation?.manualReviewRecommended ?? "-")}`,
    `${t("manualReview.details.llmConfidenceNote")}: ${normalizeMultilineText(latestLlmEvaluation?.confidenceNote)}`,
    `${t("manualReview.details.llmCreatedAt")}: ${formatDateTime(latestLlmEvaluation?.createdAt)}`,
    ...(rawDebugEnabled
      ? [
          `${t("manualReview.details.improvementAdvice")}:`,
          ...(improvementAdvice.length > 0 ? improvementAdvice.map((a) => `- ${String(a)}`) : [t("manualReview.details.none")]),
          `${t("manualReview.details.criterionRationales")}:`,
          ...criterionRationales,
          "",
        ]
      : [""]),
    `=== ${t("manualReview.details.section.appeals")} ===`,
    `${t("manualReview.details.latestAppealId")}: ${latestAppeal?.id ?? t("manualReview.details.none")}`,
    `${t("manualReview.details.latestAppealStatus")}: ${latestAppeal?.appealStatus ?? "-"}`,
    `${t("manualReview.details.latestAppealCreatedAt")}: ${formatDateTime(latestAppeal?.createdAt)}`,
  ];

  manualReviewDetails.textContent = lines.join("\n");
  renderReviewActionState();
}

// ── Manual Review: action state ────────────────────────────────────────────────

function getCurrentReviewerId() { return document.getElementById("userId").value.trim(); }
function getCurrentReviewerEmail() { return document.getElementById("email").value.trim().toLowerCase(); }

function getSelectedReviewSummary() {
  if (selectedReviewDetails?.review) return selectedReviewDetails.review;
  if (selectedReviewDetails) return selectedReviewDetails;
  return latestReviewQueue.find((r) => r.id === selectedReviewId) ?? null;
}

function isSelectedReviewClaimedByCurrentUser() {
  const review = getSelectedReviewSummary();
  const reviewerId = review?.reviewer?.id ?? review?.reviewerId ?? "";
  const reviewerEmail = review?.reviewer?.email?.trim().toLowerCase() ?? "";
  return Boolean(
    selectedReviewId &&
    review?.reviewStatus === "IN_REVIEW" &&
    ((reviewerId && reviewerId === getCurrentReviewerId()) ||
      (reviewerEmail && reviewerEmail === getCurrentReviewerEmail())),
  );
}

function renderReviewActionState() {
  const review = getSelectedReviewSummary();
  const hasSelection = Boolean(selectedReviewId);
  const claimedByCurrentUser = isSelectedReviewClaimedByCurrentUser();
  const resolved = review?.reviewStatus === "RESOLVED";
  const claimedByOther = Boolean(
    review && review.reviewStatus === "IN_REVIEW" &&
    (review?.reviewer?.id ?? review?.reviewerId) && !claimedByCurrentUser,
  );

  claimReviewButton.disabled =
    claimReviewButton.dataset.busy === "true" || !hasSelection || resolved || claimedByCurrentUser || claimedByOther;
  overrideReviewButton.disabled =
    overrideReviewButton.dataset.busy === "true" || !claimedByCurrentUser || resolved;

  if (!hasSelection) {
    reviewActionSequenceHint.textContent = t("manualReview.actionSequence");
    claimReviewButton.removeAttribute("title");
    overrideReviewButton.title = t("manualReview.overrideNeedsClaimFirst");
    return;
  }
  if (resolved) {
    reviewActionSequenceHint.textContent = t("manualReview.reviewResolved");
    claimReviewButton.title = t("manualReview.reviewResolved");
    overrideReviewButton.title = t("manualReview.reviewResolved");
    return;
  }
  if (claimedByCurrentUser) {
    reviewActionSequenceHint.textContent = t("manualReview.overrideReady");
    claimReviewButton.title = t("manualReview.overrideReady");
    overrideReviewButton.removeAttribute("title");
    return;
  }
  if (claimedByOther) {
    reviewActionSequenceHint.textContent = t("manualReview.claimedByAnotherReviewer");
    claimReviewButton.title = t("manualReview.claimedByAnotherReviewer");
    overrideReviewButton.title = t("manualReview.overrideNeedsClaimFirst");
    return;
  }
  reviewActionSequenceHint.textContent = t("manualReview.actionSequence");
  claimReviewButton.removeAttribute("title");
  overrideReviewButton.title = t("manualReview.overrideNeedsClaimFirst");
}

function setSelectedReview(reviewId, resetInputs = false) {
  const nextId = typeof reviewId === "string" ? reviewId : "";
  const changed = selectedReviewId !== nextId;
  selectedReviewId = nextId;
  selectedReviewIdInput.value = selectedReviewId || "-";
  if (changed && resetInputs) resetOverrideInputs();
  renderReviewActionState();
}

function resetOverrideInputs() {
  reviewDecisionReasonInput.value = "";
  reviewOverrideReasonInput.value = "";
  reviewPassFailTotalInput.value = defaultOverridePassFailValue;
  resetOverrideValidationFeedback();
}

function resetOverrideValidationFeedback() {
  reviewDecisionReasonInput.classList.remove("is-invalid");
  reviewDecisionReasonInput.setAttribute("aria-invalid", "false");
  reviewOverrideReasonInput.classList.remove("is-invalid");
  reviewOverrideReasonInput.setAttribute("aria-invalid", "false");
  overrideValidationMessage.classList.remove("field-error");
  overrideValidationMessage.removeAttribute("role");
  overrideValidationMessage.textContent = "";
}

function setOverrideValidationError(message, field = null) {
  resetOverrideValidationFeedback();
  if (field) { field.classList.add("is-invalid"); field.setAttribute("aria-invalid", "true"); }
  overrideValidationMessage.classList.add("field-error");
  overrideValidationMessage.setAttribute("role", "alert");
  overrideValidationMessage.textContent = message;
}

function validateOverrideInput() {
  const decisionReason = reviewDecisionReasonInput.value.trim();
  const overrideReason = reviewOverrideReasonInput.value.trim();
  if (decisionReason.length < 5) return { valid: false, message: t("manualReview.validation.decisionReasonMin"), field: reviewDecisionReasonInput };
  if (overrideReason.length < 5) return { valid: false, message: t("manualReview.validation.overrideReasonMin"), field: reviewOverrideReasonInput };
  return { valid: true, decisionReason, overrideReason };
}

// ── Manual Review: API ─────────────────────────────────────────────────────────

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
    logDebug(body);
  } catch (error) {
    showToast(toActionableErrorMessage(error), "error");
    selectedReviewDetails = null;
    renderManualReviewDetails(null);
    logDebug(error.message);
  }
}

async function loadReviewQueue() {
  if (activeReviewQueueLoad) return activeReviewQueueLoad;
  activeReviewQueueLoad = (async () => {
    try {
      const statuses = getSelectedReviewStatuses();
      const limit = getMrWorkspaceSettings().queuePageSize;
      const body = await apiFetch(
        `/api/reviews?status=${encodeURIComponent(statuses.join(","))}&limit=${encodeURIComponent(limit)}`,
        headers,
      );
      latestReviewQueue = Array.isArray(body.reviews) ? body.reviews : [];
      renderReviewQueue();
      showToast(`${t("manualReview.loadedPrefix")}: ${latestReviewQueue.length}`, "info");
      if (selectedReviewId && latestReviewQueue.some((r) => r.id === selectedReviewId)) {
        await loadReviewDetails(selectedReviewId);
      } else {
        setSelectedReview("", false);
        selectedReviewDetails = null;
        renderManualReviewDetails(null);
      }
      logDebug(body);
    } catch (error) {
      showToast(toActionableErrorMessage(error), "error");
      logDebug(error.message);
    } finally {
      activeReviewQueueLoad = null;
    }
  })();
  return activeReviewQueueLoad;
}

// ── Appeal: workspace settings ─────────────────────────────────────────────────

function getAppealWorkspaceSettings() {
  const configured = participantRuntimeConfig?.appealWorkspace ?? {};
  const availableStatuses = sanitizeAppealStatuses(configured.availableStatuses, ["OPEN", "IN_REVIEW", "RESOLVED"]);
  const defaultStatuses = sanitizeAppealStatuses(configured.defaultStatuses, ["OPEN", "IN_REVIEW"])
    .filter((s) => availableStatuses.includes(s));
  const queuePageSize = Math.max(1, Math.min(200, Number(configured.queuePageSize) || 50));
  return {
    availableStatuses,
    defaultStatuses: defaultStatuses.length > 0 ? defaultStatuses : availableStatuses.slice(0, 1),
    queuePageSize,
  };
}

function localizeAppealStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`appeal.statusValue.${normalized || "UNKNOWN"}`);
}

function localizeManualReviewStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`manualReview.statusValue.${normalized || "UNKNOWN"}`);
}

function populateAppealStatusFilters() {
  if (!appealStatusFilter) return;
  const settings = getAppealWorkspaceSettings();
  const selectedBefore = new Set(getCheckedPillValues(appealStatusFilter));
  appealStatusFilter.innerHTML = "";
  appealQueueLimitInput.value = String(settings.queuePageSize);

  for (const status of settings.availableStatuses) {
    const label = document.createElement("label");
    label.className = "pill-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = status;
    input.checked = selectedBefore.size > 0 ? selectedBefore.has(status) : settings.defaultStatuses.includes(status);
    input.setAttribute("aria-label", localizeAppealStatus(status));
    const span = document.createElement("span");
    span.textContent = localizeAppealStatus(status);
    label.appendChild(input);
    label.appendChild(span);
    appealStatusFilter.appendChild(label);
  }
}

function getSelectedAppealStatuses() {
  const selected = getCheckedPillValues(appealStatusFilter);
  return selected.length > 0 ? selected : getAppealWorkspaceSettings().defaultStatuses;
}

function filterAppealsBySearch(appeals) {
  const needle = appealQueueSearchInput.value.trim().toLowerCase();
  if (!needle) return appeals;
  return appeals.filter((appeal) => {
    const haystack = [
      appeal.id, appeal.appealStatus,
      appeal.appealedBy?.name, appeal.appealedBy?.email,
      appeal.submission?.user?.name, appeal.submission?.user?.email,
      appeal.submission?.module?.title, appeal.submission?.module?.id,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

// ── Appeal: queue rendering ────────────────────────────────────────────────────

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
  } catch { /* not JSON */ }
  return title;
}

function renderAppealQueue() {
  hideLoading(appealQueueBody);
  appealQueueBody.innerHTML = "";

  if (!Array.isArray(latestAppealQueue) || latestAppealQueue.length === 0) {
    appealQueueCountLabel.textContent = "0";
    setSelectedAppeal("", true);
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    showEmpty(appealQueueBody, t("appealHandler.noQueue"), { columns: 9 });
    return;
  }

  const filtered = filterAppealsBySearch(latestAppealQueue);
  appealQueueCountLabel.textContent = `${filtered.length} / ${latestAppealQueue.length}`;

  if (filtered.length === 0) {
    setSelectedAppeal("", true);
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    showEmpty(appealQueueBody, t("appealHandler.noRows"), { columns: 9 });
    return;
  }

  if (!selectedAppealId || !filtered.some((a) => a.id === selectedAppealId)) {
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
      t("appealHandler.table.appealId"), t("appealHandler.table.status"),
      t("appealHandler.table.participant"), t("appealHandler.table.module"),
      t("appealHandler.table.submittedAt"), t("appealHandler.table.createdAt"),
      t("appealHandler.table.claimedAt"), t("appealHandler.table.resolvedAt"),
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

// ── Appeal: detail panel ───────────────────────────────────────────────────────

function buildAppealCriterionRationaleLines(criteria) {
  if (!criteria || typeof criteria !== "object") return [t("appealHandler.details.noCriteria")];
  const entries = Object.entries(criteria);
  if (entries.length === 0) return [t("appealHandler.details.noCriteria")];
  return entries.map(([criterion, rationale]) => `- ${criterion}: ${String(rationale)}`);
}

function formatAppealPassFail(value) {
  if (value === true) return t("appealHandler.pass");
  if (value === false) return t("appealHandler.fail");
  return "-";
}

function parseResponseJsonFields(submission) {
  if (!submission) return {};
  const raw = submission.responseJson;
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch { return {}; }
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
    ? submission.mcqAttempts.filter((a) => a?.completedAt) : [];
  const latestMcqAttempt = completedMcqAttempts[0] ?? null;
  const llmStructured = parseLlmStructuredResponse(latestLlmEvaluation?.responseJson);
  const improvementAdvice = Array.isArray(llmStructured?.improvement_advice) ? llmStructured.improvement_advice : [];
  const criterionRationales = buildAppealCriterionRationaleLines(llmStructured?.criterion_rationales);

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
    `${t("appealHandler.details.mcqPassFail")}: ${formatAppealPassFail(latestMcqAttempt?.passFailMcq)}`,
    `${t("appealHandler.details.mcqCompletedAt")}: ${formatDateTime(latestMcqAttempt?.completedAt)}`,
    "",
    `=== ${t("appealHandler.details.section.evaluation")} ===`,
    `${t("appealHandler.details.decisionId")}: ${latestDecision?.id ?? t("appealHandler.details.none")}`,
    `${t("appealHandler.details.decisionType")}: ${latestDecision?.decisionType ?? "-"}`,
    `${t("appealHandler.details.totalScore")}: ${formatNumber(latestDecision?.totalScore)}`,
    `${t("appealHandler.details.passFailTotal")}: ${formatAppealPassFail(latestDecision?.passFailTotal)}`,
    `${t("appealHandler.details.decisionReason")}: ${normalizeMultilineText(latestDecision?.decisionReason)}`,
    `${t("appealHandler.details.finalisedAt")}: ${formatDateTime(latestDecision?.finalisedAt)}`,
    `${t("appealHandler.details.llmEvaluationId")}: ${latestLlmEvaluation?.id ?? t("appealHandler.details.none")}`,
    `${t("appealHandler.details.llmPracticalScore")}: ${formatNumber(latestLlmEvaluation?.practicalScoreScaled)}`,
    `${t("appealHandler.details.llmPassFail")}: ${formatAppealPassFail(latestLlmEvaluation?.passFailPractical)}`,
    `${t("appealHandler.details.llmManualReviewRecommended")}: ${String(latestLlmEvaluation?.manualReviewRecommended ?? "-")}`,
    `${t("appealHandler.details.llmConfidenceNote")}: ${normalizeMultilineText(latestLlmEvaluation?.confidenceNote)}`,
    `${t("appealHandler.details.llmCreatedAt")}: ${formatDateTime(latestLlmEvaluation?.createdAt)}`,
    `${t("appealHandler.details.improvementAdvice")}:`,
    ...(improvementAdvice.length > 0 ? improvementAdvice.map((a) => `- ${String(a)}`) : [t("appealHandler.details.none")]),
    `${t("appealHandler.details.criterionRationales")}:`,
    ...criterionRationales,
    "",
    `=== ${t("appealHandler.details.section.manualReview")} ===`,
  ];

  if (latestManualReview) {
    lines.push(`${t("appealHandler.details.manualReviewId")}: ${latestManualReview.id ?? t("appealHandler.details.none")}`);
    lines.push(`${t("appealHandler.details.manualReviewStatus")}: ${localizeManualReviewStatus(latestManualReview.reviewStatus)}`);
    lines.push(`${t("appealHandler.details.manualReviewTriggerReason")}: ${normalizeMultilineText(latestManualReview.triggerReason)}`);
    lines.push(`${t("appealHandler.details.manualReviewReviewerId")}: ${latestManualReview.reviewerId ?? "-"}`);
    lines.push(`${t("appealHandler.details.manualReviewCreatedAt")}: ${formatDateTime(latestManualReview.createdAt)}`);
    lines.push(`${t("appealHandler.details.manualReviewReviewedAt")}: ${formatDateTime(latestManualReview.reviewedAt)}`);
    lines.push(`${t("appealHandler.details.manualReviewOverrideDecision")}: ${latestManualReview.overrideDecision ?? "-"}`);
    lines.push(`${t("appealHandler.details.manualReviewOverrideReason")}: ${normalizeMultilineText(latestManualReview.overrideReason)}`);
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

// ── Appeal: action state ───────────────────────────────────────────────────────

function setSelectedAppeal(appealId, resetInputs = false) {
  const nextId = typeof appealId === "string" ? appealId : "";
  const changed = selectedAppealId !== nextId;
  selectedAppealId = nextId;
  handlerSelectedAppealIdInput.value = selectedAppealId || "-";
  if (changed && resetInputs) resetResolutionInputs();
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
  if (field) { field.classList.add("is-invalid"); field.setAttribute("aria-invalid", "true"); }
  resolveValidationMessage.classList.add("field-error");
  resolveValidationMessage.setAttribute("role", "alert");
  resolveValidationMessage.textContent = message;
}

function validateResolveAppealInput() {
  const decisionReason = handlerDecisionReasonInput.value.trim();
  const resolutionNote = handlerResolutionNoteInput.value.trim();
  if (decisionReason.length < 5) return { valid: false, message: t("appealHandler.validation.decisionReasonMin"), field: handlerDecisionReasonInput };
  if (resolutionNote.length < 5) return { valid: false, message: t("appealHandler.validation.resolutionNoteMin"), field: handlerResolutionNoteInput };
  return { valid: true, decisionReason, resolutionNote };
}

// ── Appeal: API ────────────────────────────────────────────────────────────────

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
    logDebug(body);
  } catch (error) {
    showToast(toActionableErrorMessage(error), "error");
    logDebug(error.message);
  }
}

async function loadAppealQueue(options = {}) {
  if (activeAppealQueueLoad) return activeAppealQueueLoad;
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
      if (selectedAppealId && latestAppealQueue.some((a) => a.id === selectedAppealId)) {
        await loadAppealDetails(selectedAppealId, { notify: false });
      } else {
        setSelectedAppeal("", false);
        selectedAppealDetails = null;
        renderAppealHandlerDetails(null);
      }
      logDebug(body);
    } catch (error) {
      appealQueueCountLabel.textContent = "0";
      selectedAppealDetails = null;
      renderAppealHandlerDetails(null);
      showEmpty(appealQueueBody, toActionableErrorMessage(error), { columns: 9 });
      showToast(toActionableErrorMessage(error), "error");
      logDebug(error.message);
    } finally {
      activeAppealQueueLoad = null;
    }
  })();
  return activeAppealQueueLoad;
}

// ── Boot / config ──────────────────────────────────────────────────────────────

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Manual Review v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
  }
}

function applyIdentityDefaults() {
  const defaults =
    participantRuntimeConfig?.identityDefaults?.reviewWorkspace ??
    participantRuntimeConfig?.identityDefaults?.reviewer;
  if (!defaults) return;
  document.getElementById("userId").value = defaults.userId ?? "";
  document.getElementById("email").value = defaults.email ?? "";
  document.getElementById("name").value = defaults.name ?? "";
  document.getElementById("department").value = defaults.department ?? "";
  rolesInput.value = Array.isArray(defaults.roles) ? defaults.roles.join(",") : "";
}

async function loadParticipantConsoleConfig() {
  try {
    const body = await getConsoleConfig();
    participantRuntimeConfig = {
      ...participantRuntimeConfig,
      ...body,
      navigation: { ...participantRuntimeConfig.navigation, ...(body?.navigation ?? {}) },
      manualReviewWorkspace: { ...participantRuntimeConfig.manualReviewWorkspace, ...(body?.manualReviewWorkspace ?? {}) },
      appealWorkspace: { ...participantRuntimeConfig.appealWorkspace, ...(body?.appealWorkspace ?? {}) },
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
      if (me?.user) {
        if (me.user.externalId) document.getElementById("userId").value = me.user.externalId;
        if (me.user.email) document.getElementById("email").value = me.user.email;
        if (me.user.name) document.getElementById("name").value = me.user.name;
        if (Array.isArray(me.user.roles) && me.user.roles.length > 0) {
          rolesInput.value = me.user.roles.join(",");
        }
      }
    } catch { /* nav renders with empty roles if /api/me fails */ }
  }

  applyRoleBasedVisibility();
  renderWorkspaceNavigation();
  await initConsentGuard(headers, currentLocale);
  populateMrStatusFilters();
  populateAppealStatusFilters();

  const roles = getUserRoles();
  const promises = [];
  if (canReview(roles)) promises.push(loadReviewQueue());
  if (canHandleAppeals(roles)) promises.push(loadAppealQueue());
  await Promise.all(promises);
}

// ── Event wiring ───────────────────────────────────────────────────────────────

localeSelect.addEventListener("change", () => setLocale(localeSelect.value));

rolesInput.addEventListener("input", () => {
  const matching = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matching;
  applyRoleBasedVisibility();
  renderWorkspaceNavigation();
});

mockRolePresetSelect.addEventListener("change", () => {
  if (!mockRolePresetSelect.value || !roleSwitchState.enabled) return;
  rolesInput.value = mockRolePresetSelect.value;
  applyRoleBasedVisibility();
  renderWorkspaceNavigation();
});

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, async () => {
    try {
      const body = await apiFetch("/api/me", headers);
      logDebug(body);
    } catch (error) {
      logDebug(error.message);
    }
  });
});

// MR events
mrStatusFilter.addEventListener("change", async () => { await loadReviewQueue(); });
mrQueueSearchInput.addEventListener("input", () => { renderReviewQueue(); });

claimReviewButton.addEventListener("click", async () => {
  if (!selectedReviewId) { setOverrideValidationError(t("manualReview.noSelection")); return; }
  await runWithBusyButton(claimReviewButton, async () => {
    try {
      resetOverrideValidationFeedback();
      const body = await apiFetch(`/api/reviews/${selectedReviewId}/claim`, headers, {
        method: "POST", body: JSON.stringify({}),
      });
      showToast(t("manualReview.claimed"), "success");
      setSelectedReview(selectedReviewId, true);
      logDebug(body);
      await loadReviewQueue();
      await loadReviewDetails(selectedReviewId);
    } catch (error) {
      setOverrideValidationError(toActionableErrorMessage(error));
      logDebug(error.message);
    }
  });
  renderReviewActionState();
});

overrideReviewButton.addEventListener("click", async () => {
  if (!selectedReviewId) { setOverrideValidationError(t("manualReview.noSelection")); return; }
  await runWithBusyButton(overrideReviewButton, async () => {
    try {
      if (!isSelectedReviewClaimedByCurrentUser()) {
        setOverrideValidationError(t("manualReview.overrideNeedsClaimFirst"));
        return;
      }
      const validation = validateOverrideInput();
      if (!validation.valid) { setOverrideValidationError(validation.message, validation.field); return; }
      resetOverrideValidationFeedback();
      const body = await apiFetch(`/api/reviews/${selectedReviewId}/override`, headers, {
        method: "POST",
        body: JSON.stringify({
          passFailTotal: reviewPassFailTotalInput.value === "true",
          decisionReason: validation.decisionReason,
          overrideReason: validation.overrideReason,
        }),
      });
      showToast(t("manualReview.resolved"), "success");
      const resolvedId = body?.review?.id ?? selectedReviewId;
      const resolvedStatus = body?.review?.reviewStatus ?? "RESOLVED";
      if (!getSelectedReviewStatuses().includes(resolvedStatus)) {
        latestReviewQueue = latestReviewQueue.filter((r) => r.id !== resolvedId);
        if (selectedReviewId === resolvedId) { setSelectedReview("", true); selectedReviewDetails = null; }
      } else {
        setSelectedReview(resolvedId, true);
      }
      renderReviewQueue();
      logDebug(body);
      await loadReviewQueue();
      if (selectedReviewId) await loadReviewDetails(selectedReviewId);
    } catch (error) {
      const validationMsg = toValidationErrorMessage(error);
      setOverrideValidationError(validationMsg ?? toActionableErrorMessage(error));
      logDebug(error.message);
    }
  });
  renderReviewActionState();
});

reviewDecisionReasonInput.addEventListener("input", () => {
  if (overrideValidationMessage.textContent) resetOverrideValidationFeedback();
});
reviewOverrideReasonInput.addEventListener("input", () => {
  if (overrideValidationMessage.textContent) resetOverrideValidationFeedback();
});

// Appeal events
appealStatusFilter.addEventListener("change", async () => { await loadAppealQueue(); });
appealQueueSearchInput.addEventListener("input", () => { renderAppealQueue(); });

claimAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) { showToast(t("appealHandler.noSelection"), "info"); return; }
  await runWithBusyButton(claimAppealButton, async () => {
    try {
      resetResolveValidationFeedback();
      const body = await apiFetch(`/api/appeals/${selectedAppealId}/claim`, headers, {
        method: "POST", body: JSON.stringify({}),
      });
      showToast(t("appealHandler.claimed"), "success");
      setSelectedAppeal(selectedAppealId, true);
      logDebug(body);
      await loadAppealQueue();
      await loadAppealDetails(selectedAppealId);
    } catch (error) {
      showToast(toActionableErrorMessage(error), "error");
      logDebug(error.message);
    }
  });
});

resolveAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) { showToast(t("appealHandler.noSelection"), "info"); return; }
  await runWithBusyButton(resolveAppealButton, async () => {
    try {
      const validation = validateResolveAppealInput();
      if (!validation.valid) { setResolveValidationError(validation.message, validation.field); return; }
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
      const resolvedId = body?.appeal?.id ?? selectedAppealId;
      const resolvedStatus = body?.appeal?.appealStatus ?? "RESOLVED";
      if (!getSelectedAppealStatuses().includes(resolvedStatus)) {
        latestAppealQueue = latestAppealQueue.filter((a) => a.id !== resolvedId);
        if (selectedAppealId === resolvedId) { setSelectedAppeal("", true); selectedAppealDetails = null; }
      } else {
        setSelectedAppeal(resolvedId, true);
      }
      renderAppealQueue();
      logDebug(body);
      await loadAppealQueue();
      if (selectedAppealId) await loadAppealDetails(selectedAppealId);
    } catch (error) {
      const validationMsg = toValidationErrorMessage(error);
      if (validationMsg) setResolveValidationError(validationMsg);
      else showToast(toActionableErrorMessage(error), "error");
      logDebug(error.message);
    }
  });
});

handlerDecisionReasonInput.addEventListener("input", () => {
  if (resolveValidationMessage.textContent) resetResolveValidationFeedback();
});
handlerResolutionNoteInput.addEventListener("input", () => {
  if (resolveValidationMessage.textContent) resetResolveValidationFeedback();
});

// ── Boot ───────────────────────────────────────────────────────────────────────

populateLocaleSelect();
setLocale(currentLocale);
enablePillArrowNavigation(mrStatusFilter);
enablePillArrowNavigation(appealStatusFilter);
applyRoleBasedVisibility();
renderReviewQueue();
renderManualReviewDetails(null);
resetOverrideInputs();
renderAppealQueue();
renderAppealHandlerDetails(null);
resetResolutionInputs();
loadVersion();
loadParticipantConsoleConfig();
