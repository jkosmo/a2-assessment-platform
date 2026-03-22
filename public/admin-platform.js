import { localeLabels, supportedLocales, translations } from "/static/i18n/admin-platform-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { showToast } from "/static/toast.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────

const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const settingsContent = document.getElementById("settingsContent");
const platformNameInput = document.getElementById("platformName");
const dpoNameInput = document.getElementById("dpoName");
const dpoEmailInput = document.getElementById("dpoEmail");
const consentBodyNb = document.getElementById("consentBodyNb");
const consentBodyNn = document.getElementById("consentBodyNn");
const consentBodyEnGb = document.getElementById("consentBodyEnGb");
const saveBtn = document.getElementById("saveBtn");
const saveFeedback = document.getElementById("saveFeedback");
const bumpVersionCheckbox = document.getElementById("bumpVersion");
const consentVersionBadge = document.getElementById("consentVersion");

// ── State ─────────────────────────────────────────────────────────────────────

const defaultWorkspaceNavigationItems = [
  { id: "participant", path: "/participant", labelKey: "nav.participant", requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"] },
  { id: "review", path: "/review", labelKey: "nav.review", requiredRoles: ["REVIEWER", "APPEAL_HANDLER", "ADMINISTRATOR"] },
  { id: "calibration", path: "/calibration", labelKey: "nav.calibration", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"] },
  { id: "admin-content", path: "/admin-content", labelKey: "nav.adminContent", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"] },
  { id: "admin-platform", path: "/admin-platform", labelKey: "nav.adminPlatform", requiredRoles: ["ADMINISTRATOR"] },
  { id: "results", path: "/results", labelKey: "nav.results", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR", "REPORT_READER"] },
  { id: "profile", path: "/profile", labelKey: "nav.profile", requiredRoles: [] },
];

let currentLocale = resolveInitialLocale();
let participantRuntimeConfig = {
  authMode: "mock",
  mockRolePresets: [],
  navigation: { items: defaultWorkspaceNavigationItems },
  identityDefaults: {
    administrator: {
      userId: "admin-1",
      email: "admin@company.com",
      name: "Platform Administrator",
      department: "IT",
      roles: ["ADMINISTRATOR"],
    },
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);

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

// ── Headers ───────────────────────────────────────────────────────────────────

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

// ── Tab switching ─────────────────────────────────────────────────────────────

function initTabs() {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
      for (const p of document.querySelectorAll(".tab-panel")) p.classList.remove("active");
      btn.classList.add("active");
      document.getElementById(`tab-${tab}`)?.classList.add("active");
    });
  }
}

// ── Load / save ───────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const data = await apiFetch("/api/admin/platform", headers);
    platformNameInput.value = data.platformName ?? "";
    dpoNameInput.value = data.dpoName ?? "";
    dpoEmailInput.value = data.dpoEmail ?? "";
    consentBodyNb.value = data.consentBody?.nb ?? "";
    consentBodyNn.value = data.consentBody?.nn ?? "";
    consentBodyEnGb.value = data.consentBody?.["en-GB"] ?? "";
    if (data.consentVersion) consentVersionBadge.textContent = data.consentVersion;
    settingsContent.style.display = "";
  } catch (err) {
    if (settingsContent) {
      settingsContent.style.display = "";
      settingsContent.innerHTML = `<p style="color:var(--color-error,red);padding:16px">${String(err)}</p>`;
    }
  }
}

async function saveSettings() {
  saveBtn.disabled = true;
  saveFeedback.style.display = "none";
  saveBtn.textContent = t("adminPlatform.saving");
  const bumpVersion = bumpVersionCheckbox.checked;

  try {
    await apiFetch("/api/admin/platform", headers, {
      method: "PUT",
      body: JSON.stringify({
        platformName: platformNameInput.value.trim(),
        dpoName: dpoNameInput.value.trim(),
        dpoEmail: dpoEmailInput.value.trim(),
        consentBody: {
          nb: consentBodyNb.value,
          nn: consentBodyNn.value,
          "en-GB": consentBodyEnGb.value,
        },
        bumpVersion,
      }),
      headers: { "Content-Type": "application/json" },
    });
    bumpVersionCheckbox.checked = false;
    await loadSettings();
    saveFeedback.textContent = t("adminPlatform.saved");
    saveFeedback.style.cssText = "color:var(--color-success);display:inline";
    showToast(t("adminPlatform.saved"), "success");
  } catch {
    saveFeedback.textContent = t("adminPlatform.error");
    saveFeedback.style.cssText = "color:var(--color-error,red);display:inline";
    showToast(t("adminPlatform.error"), "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = t("adminPlatform.save");
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

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

  const identityDefaults = participantRuntimeConfig?.identityDefaults?.administrator;
  if (identityDefaults) {
    document.getElementById("userId").value = identityDefaults.userId ?? "";
    document.getElementById("email").value = identityDefaults.email ?? "";
    document.getElementById("name").value = identityDefaults.name ?? "";
    document.getElementById("department").value = identityDefaults.department ?? "";
    rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
  }

  renderRolePresetControl();
  renderWorkspaceNavigation();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

localeSelect.addEventListener("change", () => setLocale(localeSelect.value));
rolesInput.addEventListener("input", () => {
  const matching = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matching;
  renderWorkspaceNavigation();
});
mockRolePresetSelect.addEventListener("change", () => {
  if (mockRolePresetSelect.value) rolesInput.value = mockRolePresetSelect.value;
  renderWorkspaceNavigation();
});
loadMeButton.addEventListener("click", async () => {
  await loadSettings();
});
saveBtn.addEventListener("click", saveSettings);

populateLocaleSelect();
setLocale(currentLocale);
initTabs();

(async () => {
  await loadConsoleConfig();
  await initConsentGuard(headers, currentLocale);
  try {
    const versionData = await apiFetch("/version", { headers: {} });
    const appVersionEl = document.getElementById("appVersion");
    if (appVersionEl) appVersionEl.textContent = `v${versionData.version ?? "unknown"}`;
  } catch {
    // non-critical
  }
  await loadSettings();
})();
