import { localeLabels, supportedLocales, translations } from "/static/i18n/appeal-handler-translations.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
  sanitizeAppealStatuses,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
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
const loadAppealQueueButton = document.getElementById("loadAppealQueue");
const queueCountLabel = document.getElementById("queueCount");
const appealQueueBody = document.getElementById("appealQueueBody");
const appealHandlerMessage = document.getElementById("appealHandlerMessage");
const handlerSelectedAppealIdInput = document.getElementById("handlerSelectedAppealId");
const appealHandlerDetails = document.getElementById("appealHandlerDetails");
const claimAppealButton = document.getElementById("claimAppeal");
const resolveAppealButton = document.getElementById("resolveAppeal");
const handlerDecisionReasonInput = document.getElementById("handlerDecisionReason");
const handlerResolutionNoteInput = document.getElementById("handlerResolutionNote");
const handlerPassFailTotalInput = document.getElementById("handlerPassFailTotal");

let currentLocale = resolveInitialLocale();
let latestAppealQueue = [];
let selectedAppealId = "";
let selectedAppealDetails = null;
let participantRuntimeConfig = {
  authMode: "mock",
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

  if (!output.dataset.hasContent) {
    output.textContent = t("defaults.ready");
  }

  populateAppealStatusFilters();
  renderRolePresetControl();
  renderWorkspaceNavigation();
  renderAppealQueue();
  renderAppealHandlerDetails(selectedAppealDetails);
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

function log(data) {
  output.dataset.hasContent = "true";
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function headers() {
  const roles = rolesInput.value
    .split(",")
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

function populateAppealStatusFilters() {
  const settings = getAppealWorkspaceSettings();
  const selectedBeforeRefresh = new Set(Array.from(statusFilter.selectedOptions).map((option) => option.value));
  statusFilter.innerHTML = "";
  queueLimitInput.value = String(settings.queuePageSize);

  for (const status of settings.availableStatuses) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = localizeAppealStatus(status);
    option.selected =
      selectedBeforeRefresh.size > 0
        ? selectedBeforeRefresh.has(status)
        : settings.defaultStatuses.includes(status);
    statusFilter.appendChild(option);
  }
}

function localizeAppealStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`appeal.statusValue.${normalized || "UNKNOWN"}`);
}

function getSelectedAppealStatuses() {
  const selected = Array.from(statusFilter.selectedOptions).map((option) => option.value);
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
  appealQueueBody.innerHTML = "";

  if (!Array.isArray(latestAppealQueue) || latestAppealQueue.length === 0) {
    queueCountLabel.textContent = "0";
    setSelectedAppeal("", true);
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = t("defaults.noQueue");
    row.appendChild(cell);
    appealQueueBody.appendChild(row);
    return;
  }

  const filtered = filterAppealsBySearch(latestAppealQueue);
  queueCountLabel.textContent = `${filtered.length} / ${latestAppealQueue.length}`;

  if (filtered.length === 0) {
    setSelectedAppeal("", true);
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = t("appealHandler.noRows");
    row.appendChild(cell);
    appealQueueBody.appendChild(row);
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

    const values = [
      appeal.id,
      localizeAppealStatus(appeal.appealStatus),
      `${participantName}\n${participantEmail}`,
      `${appeal.submission?.module?.title ?? "-"}\n${appeal.submission?.module?.id ?? "-"}`,
      formatDateTime(appeal.submission?.submittedAt),
      formatDateTime(appeal.createdAt),
      formatDateTime(appeal.claimedAt),
      formatDateTime(appeal.resolvedAt),
      appeal.sla?.status ?? "-",
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.appendChild(cell);
    }

    appealQueueBody.appendChild(row);
  }
}

function resetResolutionInputs() {
  handlerDecisionReasonInput.value = "";
  handlerResolutionNoteInput.value = "";
  handlerPassFailTotalInput.value = defaultResolutionPassFailValue;
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
  const latestDecision = submission.decisions?.[0] ?? submission.latestDecision ?? null;
  const latestLlmEvaluation = Array.isArray(submission.llmEvaluations) ? submission.llmEvaluations[0] ?? null : null;
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
    `${t("appealHandler.details.module")}: ${submission.module?.title ?? "-"} (${submission.module?.id ?? "-"})`,
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
    normalizeMultilineText(submission.rawText),
    "",
    `${t("appealHandler.details.reflection")}:`,
    normalizeMultilineText(submission.reflectionText),
    "",
    `${t("appealHandler.details.promptExcerpt")}:`,
    normalizeMultilineText(submission.promptExcerpt),
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
    const body = await api("/version", { headers: {} });
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
    const response = await fetch("/participant/config");
    if (!response.ok) {
      throw new Error("participant_config_unavailable");
    }

    const body = await response.json();
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

  applyIdentityDefaults();
  renderRolePresetControl();
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

async function loadAppealDetails(appealId) {
  if (!appealId) {
    selectedAppealDetails = null;
    renderAppealHandlerDetails(null);
    return;
  }

  try {
    const body = await api(`/api/appeals/${appealId}`);
    selectedAppealDetails = body;
    renderAppealHandlerDetails(body);
  } catch (error) {
    appealHandlerMessage.textContent = toActionableErrorMessage(error);
    log(error.message);
  }
}

async function loadAppealQueue() {
  try {
    const statuses = getSelectedAppealStatuses();
    const limit = getAppealWorkspaceSettings().queuePageSize;
    const body = await api(
      `/api/appeals?status=${encodeURIComponent(statuses.join(","))}&limit=${encodeURIComponent(limit)}`,
    );
    latestAppealQueue = Array.isArray(body.appeals) ? body.appeals : [];
    renderAppealQueue();
    appealHandlerMessage.textContent = `${t("appealHandler.loadedPrefix")}: ${latestAppealQueue.length}`;

    if (selectedAppealId && latestAppealQueue.some((appeal) => appeal.id === selectedAppealId)) {
      await loadAppealDetails(selectedAppealId);
    } else {
      setSelectedAppeal("", false);
      selectedAppealDetails = null;
      renderAppealHandlerDetails(null);
    }
    log(body);
  } catch (error) {
    appealHandlerMessage.textContent = toActionableErrorMessage(error);
    log(error.message);
  }
}

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, async () => {
    try {
      const body = await api("/api/me");
      log(body);
    } catch (error) {
      log(error.message);
    }
  });
});

loadAppealQueueButton.addEventListener("click", async () => {
  await runWithBusyButton(loadAppealQueueButton, async () => {
    await loadAppealQueue();
  });
});

statusFilter.addEventListener("change", async () => {
  await runWithBusyButton(loadAppealQueueButton, async () => {
    await loadAppealQueue();
  });
});

queueSearchInput.addEventListener("input", () => {
  renderAppealQueue();
});

claimAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) {
    appealHandlerMessage.textContent = t("appealHandler.noSelection");
    return;
  }

  await runWithBusyButton(claimAppealButton, async () => {
    try {
      const body = await api(`/api/appeals/${selectedAppealId}/claim`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      appealHandlerMessage.textContent = t("appealHandler.claimed");
      setSelectedAppeal(selectedAppealId, true);
      log(body);
      await loadAppealQueue();
      await loadAppealDetails(selectedAppealId);
    } catch (error) {
      appealHandlerMessage.textContent = toActionableErrorMessage(error);
      log(error.message);
    }
  });
});

resolveAppealButton.addEventListener("click", async () => {
  if (!selectedAppealId) {
    appealHandlerMessage.textContent = t("appealHandler.noSelection");
    return;
  }

  await runWithBusyButton(resolveAppealButton, async () => {
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
      await loadAppealQueue();
      if (selectedAppealId) {
        await loadAppealDetails(selectedAppealId);
      }
    } catch (error) {
      appealHandlerMessage.textContent = toActionableErrorMessage(error);
      log(error.message);
    }
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

populateLocaleSelect();
setLocale(currentLocale);
loadVersion();
loadParticipantConsoleConfig();
renderAppealQueue();
renderAppealHandlerDetails(null);
resetResolutionInputs();
