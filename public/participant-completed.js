import { localeLabels, supportedLocales, translations } from "/static/i18n/participant-completed-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
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
const loadCompletedButton = document.getElementById("loadCompleted");
const completedMeta = document.getElementById("completedMeta");
const completedBody = document.getElementById("completedBody");
const completedLimit = document.getElementById("completedLimit");
const completedAppealSection = document.getElementById("completedAppealSection");
const appealModuleTitle = document.getElementById("appealModuleTitle");
const completedAppealReason = document.getElementById("completedAppealReason");
const completedSubmitAppeal = document.getElementById("completedSubmitAppeal");
const completedCancelAppeal = document.getElementById("completedCancelAppeal");
const completedAppealFeedback = document.getElementById("completedAppealFeedback");

let pendingAppealSubmissionId = null;

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
  {
    id: "admin-platform",
    path: "/admin-platform",
    labelKey: "nav.adminPlatform",
    requiredRoles: ["ADMINISTRATOR"],
  },
  {
    id: "profile",
    path: "/profile",
    labelKey: "nav.profile",
    requiredRoles: [],
  },
];

let currentLocale = resolveInitialLocale();
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: {
    items: defaultWorkspaceNavigationItems,
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

  applyOutputVisibility();
  if (!output.dataset.hasContent) {
    output.textContent = t("defaults.ready");
  }
  if (!outputStatus.dataset.hasContent) {
    outputStatus.textContent = t("defaults.ready");
  }

  renderRolePresetControl();
  renderWorkspaceNavigation();
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
    const preferredKeys = ["modules", "history", "status"];
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

function renderCompletedModules(body) {
  const modules = Array.isArray(body?.modules) ? body.modules : [];
  completedBody.innerHTML = "";
  completedMeta.textContent = `${t("completed.meta.loadedPrefix")}: ${modules.length}`;

  if (modules.length === 0) {
    completedBody.innerHTML = `<tr><td colspan="6">${t("completed.empty")}</td></tr>`;
    return;
  }

  for (const module of modules) {
    const row = document.createElement("tr");
    const passFailRaw = module?.latestDecision?.passFailTotal;
    const passFailValue = passFailRaw === true
      ? t("completed.value.pass")
      : passFailRaw === false
        ? t("completed.value.fail")
        : "-";
    const passFailClass = passFailRaw === true ? "outcome--pass" : passFailRaw === false ? "outcome--fail" : "";
    const canAppeal =
      module?.latestStatus === "COMPLETED" &&
      module?.latestDecision?.passFailTotal === false &&
      module?.latestSubmissionId;
    const labels = [
      t("completed.table.module"),
      t("completed.table.completedAt"),
      t("completed.table.status"),
      t("completed.table.score"),
      t("completed.table.passFail"),
      t("completed.table.appeal"),
    ];
    const values = [
      `${module.moduleTitle ?? "-"}\n(${module.moduleId ?? "-"})`,
      formatDateTime(module.latestCompletedAt),
      localizeSubmissionStatus(module.latestStatus),
      formatNumber(module?.latestDecision?.totalScore),
      passFailValue,
    ];

    for (let i = 0; i < labels.length; i++) {
      const cell = document.createElement("td");
      cell.dataset.label = labels[i];
      if (i < values.length) {
        cell.textContent = String(values[i]);
        if (i === 4 && passFailClass) cell.className = passFailClass;
      } else if (i === 5 && canAppeal) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = t("completed.appeal.button");
        btn.className = "btn-secondary";
        btn.addEventListener("click", () => openAppealForm(module.latestSubmissionId, module.moduleTitle ?? ""));
        cell.appendChild(btn);
      }
      row.appendChild(cell);
    }
    completedBody.appendChild(row);
  }
}

function openAppealForm(submissionId, moduleTitle) {
  pendingAppealSubmissionId = submissionId;
  appealModuleTitle.textContent = moduleTitle;
  completedAppealReason.value = t("defaults.appealReason");
  completedAppealFeedback.hidden = true;
  completedAppealFeedback.textContent = "";
  completedAppealFeedback.className = "small field-success";
  completedAppealSection.hidden = false;
  completedAppealSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeAppealForm() {
  pendingAppealSubmissionId = null;
  completedAppealSection.hidden = true;
  completedAppealReason.value = "";
}

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Completed Modules v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
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
  await initConsentGuard(headers, currentLocale);
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

loadCompletedButton.addEventListener("click", async () => {
  await runWithBusyButton(loadCompletedButton, async () => {
    try {
      const limit = Number(completedLimit.value);
      const query = Number.isFinite(limit) && limit > 0 ? `?limit=${encodeURIComponent(limit)}` : "";
      const body = await apiFetch(`/api/modules/completed${query}`, headers);
      renderCompletedModules(body);
      log(body);
    } catch (error) {
      log(error.message);
    }
  });
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
});

completedCancelAppeal.addEventListener("click", () => {
  closeAppealForm();
});

completedSubmitAppeal.addEventListener("click", async () => {
  await runWithBusyButton(completedSubmitAppeal, async () => {
    const submissionId = pendingAppealSubmissionId;
    const reason = completedAppealReason.value.trim();
    if (!submissionId || !reason) {
      return;
    }
    try {
      await apiFetch(`/api/submissions/${submissionId}/appeals`, headers, {
        method: "POST",
        body: JSON.stringify({ appealReason: reason }),
      });
      completedAppealFeedback.textContent = t("completed.appeal.success");
      completedAppealFeedback.className = "small field-success";
      completedAppealFeedback.hidden = false;
      completedSubmitAppeal.disabled = true;
    } catch (error) {
      completedAppealFeedback.textContent = `${t("completed.appeal.error")} ${error.message ?? ""}`.trim();
      completedAppealFeedback.className = "small field-error";
      completedAppealFeedback.hidden = false;
    }
  });
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
renderCompletedModules(null);
