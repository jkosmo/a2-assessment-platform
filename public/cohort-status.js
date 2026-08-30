import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { lagLokalisertRessurs } from "/static/localized-resource.js";
import { resolveInitialLocale } from "/static/i18n-locale.js";
import { escapeHtml } from "/static/html-escape.js";
import { localeLabels, supportedLocales, translations } from "/static/i18n/cohort-status-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { setHidden } from "/static/dom-visibility.js";
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
const cohortUnavailable = document.getElementById("cohortUnavailable");
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
    // #975: `.status-grid{display:grid}` står i <style>-blokka i cohort-status.html og slår
    // `hidden`-attributtet. Rutenettet ble aldri skjult — det var bare tomt, og et tomt grid har
    // høyde 0. Derfor så det riktig ut, og derfor sa `toBeHidden()` i e2e-en at alt var i orden.
    setHidden(statusCards, false);
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
  // #967: ⚠️ den viktigste linja paa skjermen naar den gjelder. Uten den viser dashbordet
  // «OVERDUE 7» uten ett ord om at kurset ikke finnes for de sju — og fagansvarlig leter etter en
  // forklaring som ikke staar noe sted.
  if (cohortUnavailable) {
    const message = summary.courseArchived === true
      ? t("cohort.unavailable.archived")
      : summary.coursePublished === false
        ? t("cohort.unavailable.unpublished")
        : "";
    cohortUnavailable.textContent = message;
    cohortUnavailable.hidden = message === "";
  }
  if (cohortMeta) {
    const when = summary.generatedAt ? new Date(summary.generatedAt).toLocaleString(currentLocale) : "";
    cohortMeta.textContent = `${t("cohort.generatedAt")}: ${when}`;
  }
}

function showCohortEmpty() {
  if (cohortUnavailable) cohortUnavailable.hidden = true;
  if (cohortEmpty) cohortEmpty.hidden = false;
  if (statusCards) setHidden(statusCards, true);
  if (byClassSection) byClassSection.hidden = true;
  if (cohortMeta) cohortMeta.textContent = "";
}

async function loadCourses() {
  await kursliste.last();
}

function tegnKurslisteFeil() {
  setMessage(t("cohort.error"), "error");
}

function tegnKursliste(data) {
  // ⚠️ Den valgte verdien må overleve at lista bygges på nytt ved språkbytte. Uten dette ville
  // et språkbytte nullstilt kursvalget, og sammendraget under blitt stående på et kurs som ikke
  // lenger er valgt.
  const valgt = courseSelect.value;
  {
    const courses = data.courses ?? [];
    if (courses.length === 0) {
      courseSelect.innerHTML = `<option value="">${escapeHtml(t("cohort.picker.empty"))}</option>`;
      courseSelect.disabled = true;
      return;
    }
    courseSelect.disabled = false;
    courseSelect.innerHTML =
      `<option value="">${escapeHtml(t("cohort.picker.placeholder"))}</option>` +
      // #967: et unaabart kurs staar i lista, men merkes — ellers ville fagansvarlig valgt det
      // uten aa vite hvorfor ingen beveger seg.
      courses.map((c) => {
        const mark = c.archived === true
          ? ` (${t("cohort.course.archived")})`
          : c.published === false
            ? ` (${t("cohort.course.unpublished")})`
            : "";
        return `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}${escapeHtml(mark)}</option>`;
      }).join("");
    if (valgt) courseSelect.value = valgt;
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

// #1042: kursvelgeren og kohortsammendraget viser kurs- og modultitler, som serveren lokaliserer
// ved HENTING (#1027). Uten ny henting ble de stående på forrige språk (#1040).
//
// ⚠️ Ressursene ligger her, etter at lasterne er definert, og hentingen kalles fra lytteren —
// ikke fra `setLocale`, som også kjører ved oppstart (#1039).
const kursliste = lagLokalisertRessurs({
  hentSpråk: () => currentLocale,
  hent: () => apiFetch("/api/cohort-status/courses", headers),
  tegn: (data) => tegnKursliste(data),
  påFeil: () => tegnKurslisteFeil(),
});

localeSelect?.addEventListener("change", () => {
  setLocale(localeSelect.value);
  kursliste.oppdaterVedSpråkbytte();
  // Sammendraget hentes bare når et kurs faktisk er valgt.
  if (courseSelect?.value) void loadCohort();
});
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
