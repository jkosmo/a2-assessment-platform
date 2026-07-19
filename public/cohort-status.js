import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { resolveInitialLocale } from "/static/i18n-locale.js";
import { escapeHtml } from "/static/html-escape.js";
import { localeLabels, supportedLocales, translations } from "/static/i18n/cohort-status-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";

// #498: teacher/SMO cohort-status dashboard. Pick a course → see enrollment-status counts (assigned /
// in progress / overdue / completed) over its effective audience (individual + class-assigned), with a
// per-class breakdown. Backed by GET /api/cohort-status/*.

const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const output = document.getElementById("output");
const outputStatus = document.getElementById("outputStatus");
const debugOutputSection = document.getElementById("debugOutputSection");
const courseSelect = document.getElementById("courseSelect");
const cohortMeta = document.getElementById("cohortMeta");
const cohortEmpty = document.getElementById("cohortEmpty");
const statusCards = document.getElementById("statusCards");
const byClassSection = document.getElementById("byClassSection");
const byClassEmpty = document.getElementById("byClassEmpty");
const byClassBody = document.getElementById("byClassBody");

let currentLocale = resolveInitialLocale(supportedLocales);
let participantRuntimeConfig = { authMode: "mock", navigation: { items: [] }, identityDefaults: {} };
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);

function t(key) {
  return translations[currentLocale]?.[key] ?? translations["en-GB"]?.[key] ?? key;
}

function headers() {
  return buildConsoleHeaders({
    userId: document.getElementById("userId")?.value,
    email: document.getElementById("email")?.value,
    name: document.getElementById("name")?.value,
    department: document.getElementById("department")?.value,
    roles: rolesInput?.value,
    locale: currentLocale,
  });
}

function log(data) {
  if (!output) return;
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function setMessage(text, type = "info") {
  if (!outputStatus) return;
  outputStatus.textContent = text;
  outputStatus.className = `small field-${type}`;
}

function applyTranslations() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
  renderWorkspaceNavigation();
}

function populateLocaleSelect() {
  if (!localeSelect) return;
  localeSelect.innerHTML = "";
  for (const locale of supportedLocales) {
    const option = document.createElement("option");
    option.value = locale;
    option.textContent = localeLabels[locale] ?? locale;
    if (locale === currentLocale) option.selected = true;
    localeSelect.appendChild(option);
  }
}

function renderRolePresetControl() {
  if (!mockRolePresetContainer) return;
  if (!roleSwitchState.enabled) {
    mockRolePresetContainer.hidden = true;
    return;
  }
  mockRolePresetContainer.hidden = false;
  mockRolePresetSelect.innerHTML = "";
  const manual = document.createElement("option");
  manual.value = "";
  manual.textContent = t("identity.rolePresetManual");
  mockRolePresetSelect.appendChild(manual);
  for (const preset of roleSwitchState.presets) {
    const option = document.createElement("option");
    option.value = preset;
    option.textContent = preset;
    mockRolePresetSelect.appendChild(option);
  }
  mockRolePresetSelect.value = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetHint.textContent = t("identity.rolePresetHint");
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    rolesInput?.value ?? "",
    window.location.pathname,
  );
  renderWorkspaceNavigationWithProfile({
    workspaceNav,
    localePicker: document.querySelector(".locale-picker"),
    items,
    buildLabel: (item) => t(item.labelKey),
  });
}

function applyIdentityDefaults() {
  const defaults =
    participantRuntimeConfig?.identityDefaults?.contentAdmin ??
    participantRuntimeConfig?.identityDefaults?.reportReader ??
    participantRuntimeConfig?.identityDefaults ??
    null;
  if (!defaults || typeof defaults !== "object" || !defaults.userId) return;
  const set = (id, value) => { const el = document.getElementById(id); if (el && value != null) el.value = value; };
  set("userId", defaults.userId);
  set("email", defaults.email);
  set("name", defaults.name);
  set("department", defaults.department);
  if (rolesInput && Array.isArray(defaults.roles)) rolesInput.value = defaults.roles.join(",");
}

function setLocale(locale) {
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  try { localStorage.setItem("participant.locale", currentLocale); } catch { /* ignore */ }
  document.documentElement.lang = currentLocale;
  applyTranslations();
}

// --- Cohort dashboard logic -------------------------------------------------

function statusCard(cls, value, label) {
  return `<div class="status-card status-card--${cls}"><div class="status-value">${value}</div><div class="status-label">${escapeHtml(label)}</div></div>`;
}

function renderCohort(summary) {
  if (cohortEmpty) cohortEmpty.hidden = true;
  if (statusCards) {
    statusCards.hidden = false;
    const c = summary.counts ?? {};
    statusCards.innerHTML = [
      statusCard("total", summary.total ?? 0, t("cohort.total")),
      statusCard("assigned", c.ASSIGNED ?? 0, t("cohort.status.ASSIGNED")),
      statusCard("in_progress", c.IN_PROGRESS ?? 0, t("cohort.status.IN_PROGRESS")),
      statusCard("overdue", c.OVERDUE ?? 0, t("cohort.status.OVERDUE")),
      statusCard("completed", c.COMPLETED ?? 0, t("cohort.status.COMPLETED")),
    ].join("");
  }
  if (byClassSection) {
    byClassSection.hidden = false;
    const rows = summary.byClass ?? [];
    if (byClassEmpty) byClassEmpty.hidden = rows.length > 0;
    if (byClassBody) {
      byClassBody.innerHTML = rows
        .map((b) => {
          const bc = b.counts ?? {};
          return `<tr><td>${escapeHtml(b.className ?? b.classId)}</td><td>${bc.ASSIGNED ?? 0}</td><td>${bc.IN_PROGRESS ?? 0}</td><td>${bc.OVERDUE ?? 0}</td><td>${bc.COMPLETED ?? 0}</td><td>${b.total ?? 0}</td></tr>`;
        })
        .join("");
    }
  }
  if (cohortMeta) {
    const when = summary.generatedAt ? new Date(summary.generatedAt).toLocaleString(currentLocale) : "";
    cohortMeta.textContent = `${t("cohort.generatedAt")}: ${when}`;
  }
}

function showCohortEmpty() {
  if (cohortEmpty) cohortEmpty.hidden = false;
  if (statusCards) statusCards.hidden = true;
  if (byClassSection) byClassSection.hidden = true;
  if (cohortMeta) cohortMeta.textContent = "";
}

async function loadCourses() {
  try {
    const data = await apiFetch("/api/cohort-status/courses", headers);
    const courses = data.courses ?? [];
    if (courses.length === 0) {
      courseSelect.innerHTML = `<option value="">${escapeHtml(t("cohort.picker.empty"))}</option>`;
      courseSelect.disabled = true;
      return;
    }
    courseSelect.disabled = false;
    courseSelect.innerHTML =
      `<option value="">${escapeHtml(t("cohort.picker.placeholder"))}</option>` +
      courses.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join("");
  } catch (error) {
    setMessage(error?.message ?? t("cohort.error"), "error");
  }
}

async function loadCohort(courseId) {
  if (!courseId) {
    showCohortEmpty();
    return;
  }
  try {
    const summary = await apiFetch(`/api/cohort-status/course/${encodeURIComponent(courseId)}`, headers);
    renderCohort(summary);
    log(summary);
    setMessage("", "info");
  } catch (error) {
    setMessage(error?.message ?? t("cohort.error"), "error");
    showCohortEmpty();
  }
}

// --- Bootstrap --------------------------------------------------------------

async function init() {
  try {
    participantRuntimeConfig = await getConsoleConfig();
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    participantRuntimeConfig = { authMode: "mock", navigation: { items: [] }, identityDefaults: {} };
  }
  document.body.classList.toggle("auth-entra", roleSwitchState.authMode === "entra");
  populateLocaleSelect();
  applyIdentityDefaults();
  renderRolePresetControl();

  if (roleSwitchState.authMode === "entra") {
    try {
      const me = await apiFetch("/api/me", headers);
      if (Array.isArray(me?.user?.roles) && me.user.roles.length > 0) rolesInput.value = me.user.roles.join(",");
    } catch { /* nav renders with identity defaults */ }
  }

  applyTranslations();
  await initConsentGuard(headers, currentLocale);

  try {
    const body = await apiFetch("/version", { headers: {} });
    if (appVersionLabel) appVersionLabel.textContent = `v${body.version ?? "unknown"}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  await loadCourses();
}

localeSelect?.addEventListener("change", () => setLocale(localeSelect.value));
mockRolePresetSelect?.addEventListener("change", () => {
  if (!mockRolePresetSelect.value || !roleSwitchState.enabled) return;
  rolesInput.value = mockRolePresetSelect.value;
  renderWorkspaceNavigation();
});
rolesInput?.addEventListener("input", () => {
  mockRolePresetSelect.value = findMatchingPreset(rolesInput.value, roleSwitchState.presets) ?? "";
  renderWorkspaceNavigation();
});
courseSelect?.addEventListener("change", () => loadCohort(courseSelect.value));
loadMeButton?.addEventListener("click", async () => {
  try { log(await apiFetch("/api/me", headers)); } catch (error) { log(error?.message ?? "Error"); }
});
if (debugOutputSection) debugOutputSection.hidden = new URLSearchParams(window.location.search).get("debug") !== "1";

void init();
