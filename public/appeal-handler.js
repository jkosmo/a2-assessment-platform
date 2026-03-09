import { localeLabels, supportedLocales, translations } from "/static/i18n/appeal-handler-translations.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  sanitizeAppealStatuses,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
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

  renderRolePresetControl();
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
  statusFilter.innerHTML = "";
  queueLimitInput.value = String(settings.queuePageSize);

  for (const status of settings.availableStatuses) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = settings.defaultStatuses.includes(status);
    statusFilter.appendChild(option);
  }
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
    handlerSelectedAppealIdInput.value = "-";
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
    handlerSelectedAppealIdInput.value = "-";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = t("appealHandler.noRows");
    row.appendChild(cell);
    appealQueueBody.appendChild(row);
    return;
  }

  if (!selectedAppealId || !filtered.some((appeal) => appeal.id === selectedAppealId)) {
    selectedAppealId = filtered[0].id;
  }
  handlerSelectedAppealIdInput.value = selectedAppealId;

  for (const appeal of filtered) {
    const row = document.createElement("tr");
    row.className = appeal.id === selectedAppealId ? "selected" : "";
    row.style.cursor = "pointer";
    row.addEventListener("click", async () => {
      selectedAppealId = appeal.id;
      handlerSelectedAppealIdInput.value = appeal.id;
      renderAppealQueue();
      await loadAppealDetails(appeal.id);
    });

    const participantName = appeal.appealedBy?.name ?? appeal.submission?.user?.name ?? "-";
    const participantEmail = appeal.appealedBy?.email ?? appeal.submission?.user?.email ?? "-";

    const values = [
      appeal.id,
      appeal.appealStatus,
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

function renderAppealHandlerDetails(details) {
  if (!details) {
    appealHandlerDetails.textContent = t("appealHandler.noDetails");
    return;
  }

  const appeal = details.appeal ?? details;
  const sla = details.sla ?? appeal.sla ?? null;
  const lines = [
    `appealId: ${appeal.id}`,
    `status: ${appeal.appealStatus}`,
    `participant: ${appeal.appealedBy?.name ?? "-"} (${appeal.appealedBy?.email ?? "-"})`,
    `submissionParticipant: ${appeal.submission?.user?.name ?? "-"} (${appeal.submission?.user?.email ?? "-"})`,
    `module: ${appeal.submission?.module?.title ?? "-"} (${appeal.submission?.module?.id ?? "-"})`,
    `submissionId: ${appeal.submission?.id ?? "-"}`,
    `submittedAt: ${formatDateTime(appeal.submission?.submittedAt)}`,
    `createdAt: ${formatDateTime(appeal.createdAt)}`,
    `claimedAt: ${formatDateTime(appeal.claimedAt)}`,
    `resolvedAt: ${formatDateTime(appeal.resolvedAt)}`,
    `handlerId: ${appeal.resolvedById ?? appeal.resolvedBy?.id ?? "-"}`,
    `resolutionNote: ${appeal.resolutionNote ?? "-"}`,
  ];

  if (sla) {
    lines.push(`slaStatus: ${sla.status ?? "-"}`);
    lines.push(`firstResponseHours: ${sla.firstResponseDurationHours ?? "-"}`);
    lines.push(`resolutionHours: ${sla.resolutionDurationHours ?? "-"}`);
  }

  const latestDecision = appeal.submission?.decisions?.[0] ?? appeal.submission?.latestDecision ?? null;
  if (latestDecision) {
    lines.push(`latestDecisionId: ${latestDecision.id}`);
    lines.push(`latestDecisionType: ${latestDecision.decisionType ?? "-"}`);
    lines.push(`latestDecisionTotalScore: ${latestDecision.totalScore ?? "-"}`);
    lines.push(`latestDecisionFinalisedAt: ${formatDateTime(latestDecision.finalisedAt)}`);
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
  populateAppealStatusFilters();
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

    if (selectedAppealId) {
      await loadAppealDetails(selectedAppealId);
    } else {
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
      log(body);
      await loadAppealQueue();
      await loadAppealDetails(selectedAppealId);
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
});

rolesInput.addEventListener("input", () => {
  const matchingPreset = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matchingPreset;
});

populateLocaleSelect();
setLocale(currentLocale);
loadVersion();
loadParticipantConsoleConfig();
renderAppealQueue();
renderAppealHandlerDetails(null);
