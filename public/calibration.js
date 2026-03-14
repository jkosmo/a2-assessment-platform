import { localeLabels, supportedLocales, translations } from "/static/i18n/calibration-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
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
const moduleIdInput = document.getElementById("calibrationModuleId");
const moduleVersionIdInput = document.getElementById("calibrationModuleVersionId");
const statusesSelect = document.getElementById("calibrationStatuses");
const limitInput = document.getElementById("calibrationLimit");
const dateFromInput = document.getElementById("calibrationDateFrom");
const dateToInput = document.getElementById("calibrationDateTo");
const loadCalibrationButton = document.getElementById("loadCalibration");
const calibrationMeta = document.getElementById("calibrationMeta");
const calibrationSignals = document.getElementById("calibrationSignals");
const outcomesBody = document.getElementById("calibrationOutcomesBody");
const anchorsBody = document.getElementById("calibrationAnchorsBody");

const allSubmissionStatuses = ["SUBMITTED", "PROCESSING", "SCORED", "UNDER_REVIEW", "COMPLETED", "REJECTED"];
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
let latestWorkspaceBody = null;
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: {
    items: defaultWorkspaceNavigationItems,
  },
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
    calibrationOwner: {
      userId: "smo-1",
      email: "smo@company.com",
      name: "Platform Subject Matter Owner",
      department: "Learning",
      roles: ["SUBJECT_MATTER_OWNER"],
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

  renderRolePresetControl();
  renderWorkspaceNavigation();
  populateStatusOptions();
  renderWorkspace(latestWorkspaceBody);
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
    const preferredKeys = ["signals", "outcomes", "benchmarkAnchors", "module"];
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

function getSelectedStatuses() {
  const selected = getCheckedPillValues(statusesSelect);
  if (selected.length > 0) {
    return selected;
  }
  return participantRuntimeConfig?.calibrationWorkspace?.defaults?.statuses ?? ["COMPLETED", "UNDER_REVIEW"];
}

function populateStatusOptions() {
  const selected = new Set(getSelectedStatuses());
  statusesSelect.innerHTML = "";

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
    statusesSelect.appendChild(optionLabel);
  }
}

function renderWorkspace(body) {
  hideLoading(calibrationSignals);
  hideLoading(outcomesBody);
  hideLoading(anchorsBody);
  latestWorkspaceBody = body;

  if (!body) {
    showEmpty(calibrationSignals, t("calibration.signals.none"));
    calibrationMeta.textContent = "";
    showEmpty(outcomesBody, t("calibration.outcomes.empty"), { columns: 7 });
    showEmpty(anchorsBody, t("calibration.anchors.empty"), { columns: 5 });
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
  outcomesBody.innerHTML = "";
  if (outcomes.length === 0) {
    showEmpty(outcomesBody, t("calibration.outcomes.empty"), { columns: 7 });
  } else {
    for (const outcome of outcomes) {
      const row = document.createElement("tr");
      const passFail = outcome?.decision?.passFailTotal === true
        ? t("calibration.value.pass")
        : outcome?.decision?.passFailTotal === false
          ? t("calibration.value.fail")
          : "-";
      const manualReview = outcome?.llm?.manualReviewRecommended === true ? t("calibration.value.yes") : t("calibration.value.no");
      const values = [
        outcome.submissionId ?? "-",
        formatDateTime(outcome.submittedAt),
        localizeSubmissionStatus(outcome.submissionStatus),
        `${outcome.moduleVersionNo ?? "-"} (${outcome.moduleVersionId ?? "-"})`,
        formatNumber(outcome?.decision?.totalScore),
        passFail,
        manualReview,
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      outcomesBody.appendChild(row);
    }
  }

  const anchors = Array.isArray(body.benchmarkAnchors) ? body.benchmarkAnchors : [];
  anchorsBody.innerHTML = "";
  if (anchors.length === 0) {
    showEmpty(anchorsBody, t("calibration.anchors.empty"), { columns: 5 });
  } else {
    for (const anchor of anchors) {
      const row = document.createElement("tr");
      const values = [
        `${anchor.promptTemplateVersionNo ?? "-"} (${anchor.promptTemplateVersionId ?? "-"})`,
        String(anchor.benchmarkExampleCount ?? "-"),
        anchor.sourcePromptTemplateVersionId ?? "-",
        anchor.sourceModuleVersionId ?? "-",
        formatDateTime(anchor.createdAt),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      anchorsBody.appendChild(row);
    }
  }
}

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Calibration Workspace v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
  }
}

function applyIdentityDefaults() {
  const identityDefaults = participantRuntimeConfig?.identityDefaults?.calibrationOwner;
  if (!identityDefaults) {
    return;
  }

  document.getElementById("userId").value = identityDefaults.userId ?? "";
  document.getElementById("email").value = identityDefaults.email ?? "";
  document.getElementById("name").value = identityDefaults.name ?? "";
  document.getElementById("department").value = identityDefaults.department ?? "";
  rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
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
    };
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  }

  document.body.classList.toggle("auth-entra", roleSwitchState.authMode === "entra");
  applyOutputVisibility();
  applyIdentityDefaults();
  const maxRows = participantRuntimeConfig?.calibrationWorkspace?.defaults?.maxRows ?? 120;
  limitInput.value = String(maxRows);
  renderRolePresetControl();
  renderWorkspaceNavigation();
  populateStatusOptions();
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

loadCalibrationButton.addEventListener("click", async () => {
  await runWithBusyButton(loadCalibrationButton, async () => {
    try {
      calibrationMeta.textContent = "";
      showLoading(calibrationSignals, { rows: 6 });
      showLoading(outcomesBody, { rows: 4, columns: 7 });
      showLoading(anchorsBody, { rows: 3, columns: 5 });
      const moduleId = moduleIdInput.value.trim();
      if (!moduleId) {
        throw new Error(t("calibration.errors.moduleRequired"));
      }

      const params = new URLSearchParams();
      params.set("moduleId", moduleId);

      const moduleVersionId = moduleVersionIdInput.value.trim();
      if (moduleVersionId) {
        params.set("moduleVersionId", moduleVersionId);
      }

      const statuses = getSelectedStatuses();
      if (statuses.length > 0) {
        params.set("status", statuses.join(","));
      }

      const limit = Number(limitInput.value);
      if (Number.isFinite(limit) && limit > 0) {
        params.set("limit", String(limit));
      }

      if (dateFromInput.value) {
        params.set("dateFrom", dateFromInput.value);
      }
      if (dateToInput.value) {
        params.set("dateTo", dateToInput.value);
      }

      const body = await apiFetch(`/api/calibration/workspace?${params.toString()}`, headers);
      renderWorkspace(body);
      log(body);
    } catch (error) {
      calibrationMeta.textContent = "";
      showEmpty(calibrationSignals, error.message);
      showEmpty(outcomesBody, error.message, { columns: 7 });
      showEmpty(anchorsBody, error.message, { columns: 5 });
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
enablePillArrowNavigation(statusesSelect);
loadVersion();
loadParticipantConsoleConfig();
renderWorkspace(null);
