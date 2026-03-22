import { localeLabels, supportedLocales, translations } from "/static/i18n/results-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, getAccessToken } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { hideLoading, showLoading } from "/static/loading.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";

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
const filterModuleId = document.getElementById("filterModuleId");
const filterDateFrom = document.getElementById("filterDateFrom");
const filterDateTo = document.getElementById("filterDateTo");
const loadResultsButton = document.getElementById("loadResults");
const resultsMeta = document.getElementById("resultsMeta");
const passRateGrid = document.getElementById("passRateGrid");
const completionBody = document.getElementById("completionBody");
const exportCompletionButton = document.getElementById("exportCompletion");
const exportPassRatesButton = document.getElementById("exportPassRates");
const exportRecertificationButton = document.getElementById("exportRecertification");
const participantBody = document.getElementById("participantBody");

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
    reportReader: {
      userId: "content-owner-1",
      email: "smo@company.com",
      name: "Platform Subject Matter Owner",
      department: "Learning",
      roles: ["REPORT_READER"],
    },
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);

function resolveInitialLocale() {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) return stored;
  const browser = navigator.language;
  return supportedLocales.find((l) => browser.startsWith(l)) ?? "en-GB";
}

function t(key) {
  return translations[currentLocale]?.[key] ?? translations["en-GB"]?.[key] ?? key;
}

function setMessage(text, type = "info") {
  outputStatus.textContent = text;
  outputStatus.className = `small field-${type}`;
  outputStatus.dataset.hasContent = text ? "1" : "";
}

function log(data) {
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  output.dataset.hasContent = "1";
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

function buildFilterParams() {
  const params = new URLSearchParams();
  const moduleId = filterModuleId.value.trim();
  const dateFrom = filterDateFrom.value;
  const dateTo = filterDateTo.value;
  if (moduleId) params.set("moduleId", moduleId);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  return params;
}

function pct(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)} %`;
}

function localizeTitle(value) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    return parsed[currentLocale] ?? parsed["en-GB"] ?? value;
  } catch {
    return value;
  }
}

function renderPassRates(rows) {
  passRateGrid.innerHTML = "";
  if (!rows || rows.length === 0) {
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = t("results.passRates.empty");
    passRateGrid.appendChild(p);
    return;
  }
  for (const row of rows) {
    const card = document.createElement("div");
    card.className = "pass-rate-card";

    const title = document.createElement("div");
    title.className = "module-title";
    title.textContent = localizeTitle(row.moduleTitle) || row.moduleId;

    const rateValue = document.createElement("div");
    rateValue.className = "rate-value";
    rateValue.textContent = row.passRate !== null ? pct(row.passRate) : "—";

    const rateLabel = document.createElement("div");
    rateLabel.className = "rate-label";
    rateLabel.textContent = t("results.passRates.passRate");

    const rateDetail = document.createElement("div");
    rateDetail.className = "rate-detail";
    if (row.decisionCount > 0) {
      rateDetail.textContent = `${row.passCount} ${t("results.passRates.passCount")} ${t("results.passRates.of")} ${row.decisionCount} ${t("results.passRates.decisions")}`;
    } else {
      rateDetail.textContent = t("results.passRates.noData");
    }

    card.append(title, rateValue, rateLabel, rateDetail);
    passRateGrid.appendChild(card);
  }
}

function renderCompletion(passRatesRows, completionRows) {
  completionBody.innerHTML = "";

  const passRateByModule = new Map(passRatesRows.map((r) => [r.moduleId, r]));
  const rows = completionRows ?? [];

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = t("results.completion.empty");
    tr.appendChild(td);
    completionBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const pr = passRateByModule.get(row.moduleId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${localizeTitle(row.moduleTitle) || row.moduleId}</td>
      <td>${row.totalSubmissions}</td>
      <td>${row.completedSubmissions}</td>
      <td>${row.underReviewSubmissions}</td>
      <td>${pct(row.completionRate)}</td>
      <td>${pr ? pr.passCount : "—"}</td>
      <td>${pr ? pr.failCount : "—"}</td>
      <td>${pr ? pct(pr.passRate) : "—"}</td>
    `;
    completionBody.appendChild(tr);
  }
}

function renderParticipants(rows) {
  participantBody.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = t("results.participants.empty");
    tr.appendChild(td);
    participantBody.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.participantEmail}</td>
      <td>${row.participantDepartment ?? "—"}</td>
      <td>${localizeTitle(row.moduleTitle) || row.moduleId}</td>
      <td>${row.status}</td>
      <td>${row.passedAt ? new Date(row.passedAt).toLocaleDateString(currentLocale) : "—"}</td>
    `;
    participantBody.appendChild(tr);
  }
}

async function loadResults() {
  const params = buildFilterParams();
  showLoading(loadResultsButton);
  setMessage("");
  try {
    const [passRatesData, completionData, participantData] = await Promise.all([
      apiFetch(`/api/reports/pass-rates?${params}`, headers),
      apiFetch(`/api/reports/completion?${params}`, headers),
      apiFetch(`/api/reports/recertification?${params}`, headers),
    ]);

    renderPassRates(passRatesData.rows);
    renderCompletion(passRatesData.rows, completionData.rows);
    renderParticipants(participantData.rows);
    resultsMeta.textContent = t("results.filters.loaded");
    log({ passRates: passRatesData, completion: completionData });
  } catch (error) {
    setMessage(error.message ?? "Error loading results.", "warning");
    log(error);
  } finally {
    hideLoading(loadResultsButton);
  }
}

async function exportCsv(type) {
  const params = buildFilterParams();
  params.set("type", type);
  params.set("format", "csv");
  const url = `/api/reports/export?${params}`;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const token = await getAccessToken();
    const reqHeaders = headers();
    if (token) reqHeaders["Authorization"] = `Bearer ${token}`;
    const response = await fetch(url, { headers: reqHeaders });
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    const blob = await response.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `results-${type}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (error) {
    setMessage(error.message ?? "Export failed.", "warning");
  }
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
  renderWorkspaceNavigation();
}

function populateLocaleSelect() {
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
  if (!roleSwitchState.enabled) {
    mockRolePresetContainer.hidden = true;
    return;
  }
  mockRolePresetContainer.hidden = false;
  mockRolePresetSelect.innerHTML = "";
  for (const preset of roleSwitchState.presets) {
    const option = document.createElement("option");
    option.value = preset.roles.join(",");
    option.textContent = preset.label;
    mockRolePresetSelect.appendChild(option);
  }
  const matching = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  if (matching) mockRolePresetSelect.value = matching;
  const hint = roleSwitchState.presets.find((p) => p.roles.join(",") === mockRolePresetSelect.value)?.hint ?? "";
  mockRolePresetHint.textContent = hint;
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

function applyIdentityDefaults() {
  const preset = roleSwitchState.identityDefaultPreset;
  if (!preset) return;
  const defaults = participantRuntimeConfig?.identityDefaults?.[preset];
  if (!defaults) return;
  const userId = document.getElementById("userId");
  const email = document.getElementById("email");
  const name = document.getElementById("name");
  const department = document.getElementById("department");
  if (userId) userId.value = defaults.userId ?? "";
  if (email) email.value = defaults.email ?? "";
  if (name) name.value = defaults.name ?? "";
  if (department) department.value = defaults.department ?? "";
  rolesInput.value = Array.isArray(defaults.roles) ? defaults.roles.join(",") : "";
}

async function loadVersion() {
  try {
    const data = await apiFetch("/version", headers);
    if (appVersionLabel && data.version) appVersionLabel.textContent = `v${data.version}`;
  } catch {
    // ignore
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
    };
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  }

  document.body.classList.toggle("auth-entra", roleSwitchState.authMode === "entra");
  applyIdentityDefaults();
  renderRolePresetControl();

  if (roleSwitchState.authMode === "entra") {
    try {
      const me = await apiFetch("/api/me", headers);
      if (Array.isArray(me?.user?.roles) && me.user.roles.length > 0) {
        rolesInput.value = me.user.roles.join(",");
      }
    } catch {
      // nav renders with identity defaults
    }
  }

  renderWorkspaceNavigation();
  await initConsentGuard(headers, currentLocale);
}

// Event listeners
localeSelect.addEventListener("change", () => setLocale(localeSelect.value));

mockRolePresetSelect.addEventListener("change", () => {
  if (!mockRolePresetSelect.value || !roleSwitchState.enabled) return;
  rolesInput.value = mockRolePresetSelect.value;
  renderWorkspaceNavigation();
});

rolesInput.addEventListener("input", () => {
  const matching = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matching ?? "";
  renderWorkspaceNavigation();
});

loadResultsButton.addEventListener("click", () => loadResults());
exportCompletionButton.addEventListener("click", () => exportCsv("completion"));
exportPassRatesButton.addEventListener("click", () => exportCsv("pass-rates"));
exportRecertificationButton.addEventListener("click", () => exportCsv("recertification"));

loadMeButton?.addEventListener("click", async () => {
  try {
    const body = await apiFetch("/api/me", headers);
    log(body);
  } catch (error) {
    log(error);
  }
});

// Init
if (debugOutputSection) debugOutputSection.hidden = new URLSearchParams(location.search).get("debug") !== "1";
populateLocaleSelect();
setLocale(currentLocale);
loadVersion();
loadParticipantConsoleConfig();
