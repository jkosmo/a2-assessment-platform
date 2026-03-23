import { localeLabels, supportedLocales, translations } from "/static/i18n/profile-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";
import { initConsentGuard } from "/static/consent-guard.js";

// ── DOM refs ─────────────────────────────────────────────────────────────────

const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const profileContent = document.getElementById("profileContent");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileDepartment = document.getElementById("profileDepartment");
const profileRoles = document.getElementById("profileRoles");
const profileConsent = document.getElementById("profileConsent");
const modulesBody = document.getElementById("modulesBody");
const viewDataBtn = document.getElementById("viewDataBtn");
const downloadDataBtn = document.getElementById("downloadDataBtn");
const requestDeletionBtn = document.getElementById("requestDeletionBtn");
const dataViewSection = document.getElementById("dataViewSection");
const backToProfileBtn = document.getElementById("backToProfileBtn");
const downloadFullBtn = document.getElementById("downloadFullBtn");
const dataViewBody = document.getElementById("dataViewBody");
const deletionDialog = document.getElementById("deletionDialog");
const deletionDialogBody = document.getElementById("deletionDialogBody");
const deletionGraceBtn = document.getElementById("deletionGraceBtn");
const deletionImmediateBtn = document.getElementById("deletionImmediateBtn");
const deletionCancelBtn = document.getElementById("deletionCancelBtn");
const deletionFeedback = document.getElementById("deletionFeedback");

// ── State ─────────────────────────────────────────────────────────────────────

let currentLocale = resolveInitialLocale();
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: { items: [] },
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
let cachedMeData = null;
let cachedDataExport = null;

// ── Locale ────────────────────────────────────────────────────────────────────

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
  renderRolePresetControl();
  renderWorkspaceNavigation();
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

// ── Navigation ────────────────────────────────────────────────────────────────

function renderRolePresetControl() {
  mockRolePresetSelect.innerHTML = "";
  const manual = document.createElement("option");
  manual.value = "";
  manual.textContent = t("identity.rolePresetManual") ?? "— manual —";
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
      ? (t("identity.rolePresetDisabledEntra") ?? "")
      : (t("identity.rolePresetHint") ?? "");
  }
  if (mockRolePresetContainer) {
    mockRolePresetContainer.hidden = roleSwitchState.presets.length === 0;
  }
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    rolesInput.value,
    window.location.pathname,
  ).filter((item) => item.visible && item.id !== "profile");

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

// ── Headers ───────────────────────────────────────────────────────────────────

function headers() {
  const roles = rolesInput.value
    .split(",")
    .map((v) => v.trim())
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(currentLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(currentLocale, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatNumber(value, maxFractionDigits = 2) {
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat(currentLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
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

// ── Profile rendering ─────────────────────────────────────────────────────────

function renderProfile(meData) {
  const user = meData?.user ?? {};
  const consent = meData?.consent ?? {};

  profileName.textContent = user.name || "—";
  profileEmail.textContent = user.email || "—";
  profileDepartment.textContent = user.department || "—";
  profileRoles.textContent = Array.isArray(user.roles) && user.roles.length > 0
    ? user.roles.join(", ")
    : "—";

  if (consent.accepted && consent.acceptedAt) {
    const version = consent.currentVersion ?? "";
    const date = formatDate(consent.acceptedAt);
    profileConsent.textContent = version ? `${date} (${t("profile.field.consentVersion")} ${version})` : date;
  } else {
    profileConsent.textContent = t("profile.field.notAccepted");
  }

  profileContent.style.display = "";
}

// ── Modules rendering ─────────────────────────────────────────────────────────

function renderModules(body) {
  const modules = Array.isArray(body?.modules) ? body.modules : [];
  modulesBody.innerHTML = "";

  if (modules.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = t("profile.modules.empty");
    row.appendChild(cell);
    modulesBody.appendChild(row);
    return;
  }

  for (const mod of modules) {
    const row = document.createElement("tr");
    const passFailRaw = mod?.latestDecision?.passFailTotal;
    const passFailText = passFailRaw === true
      ? t("profile.modules.value.pass")
      : passFailRaw === false
        ? t("profile.modules.value.fail")
        : "—";
    const passFailClass = passFailRaw === true ? "outcome--pass" : passFailRaw === false ? "outcome--fail" : "";

    const cells = [
      { text: mod.moduleTitle ?? mod.moduleId ?? "—" },
      { text: formatDateTime(mod.latestCompletedAt) },
      { text: formatNumber(mod?.latestDecision?.totalScore) },
      { text: passFailText, className: passFailClass },
    ];

    for (const { text, className } of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      row.appendChild(td);
    }
    modulesBody.appendChild(row);
  }
}

// ── Data view rendering ───────────────────────────────────────────────────────

function renderSection(titleKey, data) {
  const section = document.createElement("div");
  section.style.cssText = "margin-top: var(--space-2)";

  const heading = document.createElement("h3");
  heading.className = "profile-section-title";
  heading.textContent = t(titleKey);
  section.appendChild(heading);

  if (!data || (Array.isArray(data) && data.length === 0)) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.style.color = "var(--color-meta)";
    empty.textContent = t("dataview.empty");
    section.appendChild(empty);
    return section;
  }

  const pre = document.createElement("pre");
  pre.style.cssText =
    "font-size:12px;background:var(--color-surface);color:var(--color-text);" +
    "border:1px solid var(--color-border-soft);" +
    "border-radius:var(--radius-card);padding:var(--space-1);overflow-x:auto;white-space:pre-wrap;word-break:break-all";
  pre.textContent = JSON.stringify(data, null, 2);
  section.appendChild(pre);
  return section;
}

function renderDataView(exportData) {
  dataViewBody.innerHTML = "";
  dataViewBody.appendChild(renderSection("dataview.section.profile", exportData?.profile));
  dataViewBody.appendChild(renderSection("dataview.section.submissions", exportData?.submissions));
  dataViewBody.appendChild(renderSection("dataview.section.appeals", exportData?.appeals));
  dataViewBody.appendChild(renderSection("dataview.section.consent", exportData?.consentHistory));
  dataViewBody.appendChild(renderSection("dataview.section.accesslog", exportData?.accessLog));
  dataViewBody.appendChild(renderSection("dataview.section.deletionHistory", exportData?.deletionHistory));
}

// ── Deletion dialog ───────────────────────────────────────────────────────────

function openDeletionDialog() {
  deletionDialogBody.textContent = t("deletion.body");
  deletionFeedback.style.display = "none";
  deletionFeedback.textContent = "";
  deletionGraceBtn.disabled = false;
  deletionImmediateBtn.disabled = false;
  deletionDialog.classList.add("open");
  deletionCancelBtn.focus();
}

function closeDeletionDialog() {
  deletionDialog.classList.remove("open");
}

async function submitDeletion(immediate) {
  const btn = immediate ? deletionImmediateBtn : deletionGraceBtn;
  await runWithBusyButton(btn, async () => {
    try {
      await apiFetch("/api/me/deletion", headers, {
        method: "POST",
        body: JSON.stringify({ immediate }),
        headers: { "Content-Type": "application/json" },
      });

      const successKey = immediate ? "deletion.success.immediate" : "deletion.success.grace";
      deletionFeedback.textContent = t(successKey);
      deletionFeedback.style.display = "";
      deletionGraceBtn.disabled = true;
      deletionImmediateBtn.disabled = true;

      if (immediate) {
        // User is now pseudonymised — redirect to logout / home after short delay
        setTimeout(() => { window.location.href = "/"; }, 2500);
      } else {
        // Reload to show the deletion banner
        setTimeout(() => { window.location.reload(); }, 1500);
      }
    } catch (error) {
      deletionFeedback.textContent = error.message ?? "Error";
      deletionFeedback.style.cssText = "color:var(--color-error);display:block";
    }
  });
}

// ── Load flow ─────────────────────────────────────────────────────────────────

async function loadConsoleConfig() {
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

  const identityDefaults = participantRuntimeConfig?.identityDefaults?.participant;
  if (identityDefaults) {
    document.getElementById("userId").value = identityDefaults.userId ?? "";
    document.getElementById("email").value = identityDefaults.email ?? "";
    document.getElementById("name").value = identityDefaults.name ?? "";
    document.getElementById("department").value = identityDefaults.department ?? "";
    rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
  }

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
}

async function loadProfileData() {
  // initConsentGuard calls /api/me and shows the consent modal if needed.
  // It returns the /api/me response body.
  cachedMeData = await initConsentGuard(headers, currentLocale);

  renderProfile(cachedMeData);

  // Sync locale from user preference if the server returned one and it's supported
  const serverLocale = cachedMeData?.user?.locale;
  if (serverLocale && supportedLocales.includes(serverLocale) && serverLocale !== currentLocale) {
    setLocale(serverLocale);
    localeSelect.value = serverLocale;
  }

  // Load completed modules (non-blocking — render empty state first, fill in on success)
  try {
    const body = await apiFetch("/api/modules/completed", headers);
    renderModules(body);
  } catch {
    renderModules(null);
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, loadProfileData);
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
});

rolesInput.addEventListener("input", () => {
  const matching = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matching;
  renderWorkspaceNavigation();
});

mockRolePresetSelect.addEventListener("change", () => {
  if (!mockRolePresetSelect.value || !roleSwitchState.enabled) return;
  rolesInput.value = mockRolePresetSelect.value;
  renderWorkspaceNavigation();
});

viewDataBtn.addEventListener("click", async () => {
  await runWithBusyButton(viewDataBtn, async () => {
    try {
      cachedDataExport = await apiFetch("/api/me/data", headers);
      renderDataView(cachedDataExport);
      profileContent.style.display = "none";
      dataViewSection.style.display = "";
      dataViewSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      window.showToast?.(error.message ?? "Error loading data", "error");
    }
  });
});

downloadDataBtn.addEventListener("click", async () => {
  await runWithBusyButton(downloadDataBtn, async () => {
    try {
      const exportData = cachedDataExport ?? (await apiFetch("/api/me/data", headers));
      cachedDataExport = exportData;
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.showToast?.(error.message ?? "Error downloading data", "error");
    }
  });
});

requestDeletionBtn.addEventListener("click", () => {
  openDeletionDialog();
});

deletionCancelBtn.addEventListener("click", () => {
  closeDeletionDialog();
});

deletionDialog.addEventListener("click", (event) => {
  if (event.target === deletionDialog) closeDeletionDialog();
});

deletionGraceBtn.addEventListener("click", () => submitDeletion(false));
deletionImmediateBtn.addEventListener("click", () => submitDeletion(true));

backToProfileBtn.addEventListener("click", () => {
  dataViewSection.style.display = "none";
  profileContent.style.display = "";
});

downloadFullBtn.addEventListener("click", async () => {
  await runWithBusyButton(downloadFullBtn, async () => {
    try {
      const exportData = cachedDataExport ?? (await apiFetch("/api/me/data", headers));
      cachedDataExport = exportData;
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.showToast?.(error.message ?? "Error downloading data", "error");
    }
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

populateLocaleSelect();
setLocale(currentLocale);

(async () => {
  await loadConsoleConfig();
  try {
    const versionData = await apiFetch("/version", { headers: {} });
    const appVersionEl = document.getElementById("appVersion");
    if (appVersionEl) appVersionEl.textContent = `v${versionData.version ?? "unknown"}`;
  } catch {
    const appVersionEl = document.getElementById("appVersion");
    if (appVersionEl) appVersionEl.textContent = "unknown";
  }
  try {
    await loadProfileData();
  } catch (err) {
    if (profileContent) {
      profileContent.style.display = "";
      profileContent.innerHTML = `<p style="color:var(--color-error,red);padding:16px">${String(err)}</p>`;
    }
  }
})();
