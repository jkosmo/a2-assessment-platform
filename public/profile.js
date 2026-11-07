import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { applyPageTitle } from "/static/page-title.js";
import { applyIdentityDefaults as delApplyIdentityDefaults } from "/static/identity-defaults.js";
import { renderRolePresetControl as delRenderRolePresetControl } from "/static/role-preset-control.js";
import { runWithBusyButton } from "/static/busy-button.js";
import { showToast } from "/static/toast.js";
// ⚠️ #1046: denne fila kalte `window.showToast?.(…)` seks steder. Globalen ble ALDRI satt — heller
// ikke i committen som innførte mønsteret (332283db, 22. mars). Med valgfri kjeding forsvant hvert
// eneste kall stille, så profilsiden har vært stum ved feil i fem måneder mens koden så ut som den
// snakket.
//
// Det er lag-i-tid i sin reneste form: mønsteret ble skrevet for en global noen antok fantes.
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { lagLokalisertRessurs } from "/static/localized-resource.js";
import { describeApiError } from "/static/api-error.js";
import { resolveInitialLocale } from "/static/i18n-locale.js";
import { createNumberFormatter, createDateTimeFormatter } from "/static/format-display.js";
const formatDateTime = createDateTimeFormatter(() => currentLocale, "—");
import { localeLabels, supportedLocales, translations } from "/static/i18n/profile-translations.js";
import { localizeCertLevel } from "/static/cert-level.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, fetchQueueCounts, applyNavReviewBadge, signOut } from "/static/api-client.js";
import { escapeHtml } from "/static/html-escape.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { setHidden } from "/static/dom-visibility.js";
import { renderStats } from "/static/profile-stats.js";
// #1138: «Beståtte moduler» kommer fra /api/me/stats, der serveren alt har avgjort hva som er bestått
// (`passedAt` i activityReport.ts: avgjort, og siste vedtak bestått). Flaten utleder ingenting selv, og
// importerer derfor ikke lenger /static/outcome.js.

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
const coursesBody = document.getElementById("coursesBody");
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
const agentTokensSection = document.getElementById("agentTokensSection");
const agentTokenLabelInput = document.getElementById("agentTokenLabel");
const agentTokenTtlSelect = document.getElementById("agentTokenTtl");
const issueAgentTokenBtn = document.getElementById("issueAgentTokenBtn");
const agentTokenReveal = document.getElementById("agentTokenReveal");
const agentTokenSecret = document.getElementById("agentTokenSecret");
const copyAgentTokenBtn = document.getElementById("copyAgentTokenBtn");
const agentTokenCopied = document.getElementById("agentTokenCopied");
const agentTokensBody = document.getElementById("agentTokensBody");
const profileTabs = document.getElementById("profileTabs");
const statsBody = document.getElementById("statsBody");
const tabButtons = Array.from(document.querySelectorAll("[data-profile-tab]"));
const tabPanels = Array.from(document.querySelectorAll("[data-profile-panel]"));

// ── State ─────────────────────────────────────────────────────────────────────

let currentLocale = resolveInitialLocale(supportedLocales);
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
// #736: the completed-modules/courses tables are built dynamically via t(); a locale switch only
// re-runs applyTranslations() on static [data-i18n] labels, so cache the last data and re-render
// these on locale change — otherwise headers switch language while the values stay behind.
let cachedStatsData = null;
let cachedStatsFailed = false;
let cachedCoursesData = null;
let selectedTab = "stats";

// ── Locale ────────────────────────────────────────────────────────────────────


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
  profileTabs?.setAttribute("aria-label", t("profile.tabs.label"));
  renderTabCounts();
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
  // #1046: fire identiske kopier, to ulike oppforsler. Se `/static/role-preset-control.js`.
  delRenderRolePresetControl({
    select: mockRolePresetSelect,
    hint: mockRolePresetHint,
    container: mockRolePresetContainer,
    roleSwitchState,
    currentRoles: rolesInput.value,
    t,
  });
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) {
    return;
  }
  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    rolesInput.value,
    window.location.pathname,
  );
  renderWorkspaceNavigationWithProfile({
    workspaceNav,
    localePicker: null,
    items,
    buildLabel: (item) => t(item.labelKey),
  });
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


function formatDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(currentLocale, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

const formatNumber = createNumberFormatter(() => currentLocale, "—");

// #1027: den fjerde klientparseren i denne saken er fjernet herfra.
//
// ⚠️ Den var verre enn de andre, for den var STILLE. Serveren sender nå `courseTitle` og
// `certificationLevel` ferdig lokalisert (courses.ts), så parseren fikk aldri et lagringsformat å
// tolke og gjorde ingenting. Nivåkolonnen fulgte språkbyttet før, og sluttet å gjøre det — uten at
// noe ble rødt, fordi #736 sin re-rendering fra cache fortsatt kjørte og «virket».
//
// En parser som ikke lenger har noe å parse, ser ut som om den gjør jobben sin.
function showValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : "—";
}


// ── Profile rendering ─────────────────────────────────────────────────────────

function renderProfile(meData) {
  const user = meData?.user ?? {};
  const consent = meData?.consent ?? {};

  profileName.textContent = user.name || "—";
  profileEmail.textContent = user.email || "—";
  profileDepartment.textContent = user.department || "—";
  // Rollenavnet på brukerens språk, ikke nøkkelen («PARTICIPANT»). En rolle uten oversettelse står som nøkkelen.
  profileRoles.textContent = Array.isArray(user.roles) && user.roles.length > 0
    ? user.roles.map((role) => {
        const key = `profile.role.${role}`;
        const label = t(key);
        return label && label !== key ? label : role;
      }).join(", ")
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

// En celle med kolonnenavnet i `data-label`: under 600 px blir hver rad et kort (shared.css), og da står
// navnet ved verdien.
function cell(labelKey, text, className) {
  const td = document.createElement("td");
  td.dataset.label = t(labelKey);
  if (text !== undefined) td.textContent = text;
  if (className) td.className = className;
  return td;
}

// #1138: «Beståtte moduler» viser bare beståtte (produkteier 2026-11-07). Lista kommer fra
// /api/me/stats (`passedModules`), som teller etter samme regel som «Moduler bestått» i statistikken —
// så fanen og tallet kan ikke være uenige. Et stryk eller en sak hos sensor står ikke her; en modul som
// er bestått før, står selv om et senere forsøk strøk.
function renderModules(stats) {
  modulesBody.innerHTML = "";
  if (cachedStatsFailed && !stats) {
    showEmpty(modulesBody, t("profile.stats.error"), { columns: 3 });
    return;
  }
  const modules = Array.isArray(stats?.passedModules) ? stats.passedModules : [];

  if (modules.length === 0) {
    // #1046: den delte tomtilstanden.
    showEmpty(modulesBody, t("profile.modules.empty"), { columns: 3 });
    return;
  }

  for (const mod of modules) {
    const row = document.createElement("tr");
    row.appendChild(cell("profile.modules.table.module", showValue(mod.moduleTitle ?? mod.moduleId)));
    row.appendChild(cell("profile.modules.table.passedAt", formatDate(mod.passedAt), "profile-nowrap"));
    row.appendChild(cell("profile.modules.table.score", formatNumber(mod.totalScore)));
    modulesBody.appendChild(row);
  }
}

function renderStatsPanel() {
  if (cachedStatsData) {
    renderStats(statsBody, cachedStatsData, { t, locale: currentLocale });
  } else if (cachedStatsFailed) {
    statsBody.innerHTML = "";
    const p = document.createElement("p");
    p.className = "stats-error";
    p.setAttribute("role", "alert");
    p.textContent = t("profile.stats.error");
    statsBody.appendChild(p);
  }
}

// Antallet står i fanen når lista er hentet og ikke tom: «Beståtte kurs (3)».
// På smal skjerm vises det korte navnet («Kurs (3)»), så fanelinja får plass på én linje med antallet
// (produkteier 2026-11-07: antallet skal vises, og linja brakk på mobil). CSS velger hvilket span som vises;
// det skjulte er display:none og leses ikke av skjermleser.
function renderTabCounts() {
  const counts = {
    courses: Array.isArray(cachedCoursesData?.completions) ? cachedCoursesData.completions.length : 0,
    modules: Array.isArray(cachedStatsData?.passedModules) ? cachedStatsData.passedModules.length : 0,
  };
  const withCount = (label, n) => (n > 0 ? t("profile.tabs.count").replace("{label}", label).replace("{n}", formatNumber(n)) : label);
  for (const button of tabButtons) {
    const id = button.dataset.profileTab;
    const n = counts[id] ?? 0;
    const long = document.createElement("span");
    long.className = "profile-tab-long";
    long.textContent = withCount(t(`profile.tabs.${id}`), n);
    const short = document.createElement("span");
    short.className = "profile-tab-short";
    short.textContent = withCount(t(`profile.tabs.${id}.short`), n);
    button.replaceChildren(long, short);
    // Det fulle navnet for skjermleser på alle skjermbredder, også når det korte vises.
    button.setAttribute("aria-label", long.textContent);
  }
}

// ── Fanene (#1138) ────────────────────────────────────────────────────────────
// Samme mønster som skjemasidene (form-page.js): én tabstopp for fanelinja, piltaster, Home og End
// flytter. Panelene skjules med setHidden — `hidden` alene taper mot en display-regel (#975).

function selectTab(id, { focus = false } = {}) {
  if (!tabButtons.some((b) => b.dataset.profileTab === id)) return;
  selectedTab = id;
  for (const button of tabButtons) {
    const on = button.dataset.profileTab === id;
    button.classList.toggle("active", on);
    button.setAttribute("aria-selected", String(on));
    button.tabIndex = on ? 0 : -1;
    if (on && focus) button.focus();
  }
  for (const panel of tabPanels) setHidden(panel, panel.dataset.profilePanel !== id);
}

profileTabs?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-profile-tab]");
  if (button) selectTab(button.dataset.profileTab);
});

profileTabs?.addEventListener("keydown", (event) => {
  const i = tabButtons.findIndex((b) => b.dataset.profileTab === selectedTab);
  let next = null;
  if (event.key === "ArrowRight") next = tabButtons[(i + 1) % tabButtons.length];
  else if (event.key === "ArrowLeft") next = tabButtons[(i - 1 + tabButtons.length) % tabButtons.length];
  else if (event.key === "Home") next = tabButtons[0];
  else if (event.key === "End") next = tabButtons[tabButtons.length - 1];
  if (!next) return;
  event.preventDefault();
  selectTab(next.dataset.profileTab, { focus: true });
});

function renderCourses(body) {
  const courses = Array.isArray(body?.completions) ? body.completions : [];
  coursesBody.innerHTML = "";

  if (courses.length === 0) {
    // #1046: den delte tomtilstanden. Den håndlagde varianten her gjorde det samme, men uten
    // `.empty-state`-stilen — så tomme tabeller så ulike ut fra flate til flate.
    showEmpty(coursesBody, t("profile.courses.empty"), { columns: 4 });
    return;
  }

  for (const course of courses) {
    const row = document.createElement("tr");

    const titleTd = cell("profile.courses.table.course");
    titleTd.textContent = showValue(course.courseTitle ?? course.courseId);
    // #934: et kursbevis gjelder sin hovedversjon. Fra versjon 2 står versjonen ved navnet, så to bevis for
    // samme kurs ikke ser like ut (versjon 1 er alle bevis fra før kurs fikk versjoner).
    if (Number.isInteger(course.versionMajor) && course.versionMajor > 1) {
      titleTd.textContent += t("profile.courses.versionSuffix").replace("{n}", String(course.versionMajor));
    }
    row.appendChild(titleTd);

    row.appendChild(cell("profile.courses.table.completedAt", formatDate(course.completedAt), "profile-nowrap"));

    // #1045: nivået er en NØKKEL («basic»), ikke tekst. Profilen viste den rå. Delt hjelper,
    // så alle flatene sier det samme ordet for samme nivå.
    row.appendChild(cell("profile.courses.table.level", localizeCertLevel(course.certificationLevel, t)));

    // #550: lenke til kursbeviset som kan skrives ut. #1138: ID-en er fjernet (produkteier 2026-11-07);
    // den står på selve kursbeviset.
    const certTd = cell("profile.courses.table.certificate", undefined, "profile-nowrap");
    if (course.certificateId) {
      const link = document.createElement("a");
      link.href = `/certificate?id=${encodeURIComponent(course.certificateId)}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = t("profile.courses.view");
      certTd.appendChild(link);
    } else {
      certTd.textContent = "—";
    }
    row.appendChild(certTd);

    coursesBody.appendChild(row);
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

// ── Agent access (AA-3, #731) ─────────────────────────────────────────────────
// Short-lived agent authoring tokens: issue (secret shown ONCE), list, revoke.
// The section is only shown for SUBJECT_MATTER_OWNER / ADMINISTRATOR — roles
// come from /api/me (via initConsentGuard), never from the mock inputs alone.

const AGENT_TOKEN_ROLES = ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"];

function canUseAgentTokens(meData) {
  const roles = Array.isArray(meData?.user?.roles) ? meData.user.roles : [];
  return roles.some((role) => AGENT_TOKEN_ROLES.includes(role));
}

function renderAgentTokens(tokens) {
  agentTokensBody.innerHTML = "";
  if (!Array.isArray(tokens) || tokens.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = t("agentTokens.empty");
    row.appendChild(cell);
    agentTokensBody.appendChild(row);
    return;
  }
  const now = Date.now();
  for (const token of tokens) {
    const row = document.createElement("tr");
    const status = token.revokedAt
      ? "revoked"
      : new Date(token.expiresAt).getTime() <= now
        ? "expired"
        : "active";

    for (const text of [
      token.label || "—",
      formatDateTime(token.createdAt),
      formatDateTime(token.expiresAt),
      token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "—",
      t(`agentTokens.status.${status}`),
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      row.appendChild(td);
    }

    const actionTd = document.createElement("td");
    if (status === "active") {
      const revokeBtn = document.createElement("button");
      revokeBtn.className = "btn btn-danger";
      revokeBtn.dataset.tokenId = token.id;
      revokeBtn.textContent = t("agentTokens.revoke");
      revokeBtn.addEventListener("click", async () => {
        await runWithBusyButton(revokeBtn, async () => {
          try {
            await apiFetch(`/api/admin/content/agent-authoring/tokens/${encodeURIComponent(token.id)}/revoke`, headers, {
              method: "POST",
            });
            showToast(t("agentTokens.revoked.toast"), "success");
            await loadAgentTokens();
          } catch (error) {
            // #983: «Error» var hardkodet engelsk, og hovedveien viste serverens setning.
            showToast(describeApiError(error, t).headline, "error");
          }
        });
      });
      actionTd.appendChild(revokeBtn);
    } else {
      actionTd.textContent = "—";
    }
    row.appendChild(actionTd);
    agentTokensBody.appendChild(row);
  }
}

async function loadAgentTokens() {
  try {
    const body = await apiFetch("/api/admin/content/agent-authoring/tokens", headers);
    renderAgentTokens(body?.tokens ?? []);
  } catch {
    agentTokensBody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = t("agentTokens.error");
    row.appendChild(cell);
    agentTokensBody.appendChild(row);
  }
}

async function refreshAgentTokensSection(meData) {
  const visible = canUseAgentTokens(meData);
  setHidden(agentTokensSection, !visible);
  if (visible) {
    await loadAgentTokens();
  }
}

async function copyAgentTokenToClipboard(secret) {
  try {
    await navigator.clipboard.writeText(secret);
    return true;
  } catch {
    // Fallback for contexts without clipboard permission: select the text so
    // the user can copy manually.
    const range = document.createRange();
    range.selectNodeContents(agentTokenSecret);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return false;
  }
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
      deletionFeedback.textContent = describeApiError(error, t).headline;
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

  // #1046: se `/static/identity-defaults.js`.
  delApplyIdentityDefaults(participantRuntimeConfig?.identityDefaults?.participant, rolesInput);

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
  fetchQueueCounts(headers).then((counts) => applyNavReviewBadge(workspaceNav, counts));

  renderProfile(cachedMeData);

  // Sync locale from user preference if the server returned one and it's supported
  const serverLocale = cachedMeData?.user?.locale;
  if (serverLocale && supportedLocales.includes(serverLocale) && serverLocale !== currentLocale) {
    setLocale(serverLocale);
    localeSelect.value = serverLocale;
    // Språket byttes her uten en change-hendelse, så tittelen får beskjed direkte.
    applyPageTitle(serverLocale);
  }

  // ⚠️ #1042: FØRSTEHENTINGEN går gjennom den samme ressursen som språkbyttet. Første forsøk lot
  // den ligge igjen som en egen `Promise.allSettled` her — da visste ressursen ikke at noe var
  // hentet, og `oppdaterVedSpråkbytte` gjorde ingenting. Sertifiseringsnivået sluttet å følge
  // språket på nytt, av nøyaktig samme grunn som i #1027.
  //
  // To lastere for samme data er selve feilen modulen finnes for å fjerne.
  await profillister.last();

  // Agent access (AA-3, #731) — gated on the /api/me roles.
  await refreshAgentTokensSection(cachedMeData);
}

// ── Event wiring ──────────────────────────────────────────────────────────────

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, loadProfileData);
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
  // #736: re-render the dynamically built content so table values follow the new locale, not just
  // the static [data-i18n] labels that applyTranslations() handles.
  //
  // ⚠️ #1027 gjorde halve premissen for #736 usann. Den bygde på at listene bar LAGRINGSFORMATET,
  // slik at en ny rendering kunne velge språk på nytt fra data siden allerede hadde. Nå baker
  // serveren inn språket ved HENTING, og en ny rendering av de samme radene gir nøyaktig samme
  // tekst. Sertifiseringsnivået fulgte språkbyttet før 2.49.0 og sluttet å gjøre det.
  //
  // Renderingen beholdes — den gjør fortsatt jobben for det som formes på klienten (datoer, tall,
  // etiketter). Men det som kommer ferdig fra serveren må HENTES på nytt.
  if (cachedMeData) renderProfile(cachedMeData);
  renderStatsPanel();
  renderModules(cachedStatsData);
  renderCourses(cachedCoursesData);
  profillister.oppdaterVedSpråkbytte();
});

// #1042: listene hentes gjennom den delte ressursen. Den eier kappløpsvakta OG enkeltflyten —
// profilsiden manglet enkeltflyt selv etter #1027, nok et tilfelle av at én fiks i settet ble
// tatt for settet.
const profillister = lagLokalisertRessurs({
  hentSpråk: () => currentLocale,
  hent: () => {
    // #1046: flaten viste ingenting mens den lastet. De tre flatene som HAR lastetilstand fikk
    // den i mars; denne ble aldri rørt.
    // #1138: «Beståtte moduler» kommer med statistikken. Lista ble hentet fra /api/modules/completed
    // (siste forsøk per modul) og filtrert på klienten; nå avgjør serveren hva som er bestått.
    if (!cachedStatsData) showLoading(statsBody, { rows: 4 });
    showLoading(modulesBody, { rows: 3, columns: 3 });
    showLoading(coursesBody, { rows: 2, columns: 4 });
    return Promise.allSettled([
      apiFetch("/api/me/stats", headers),
      apiFetch("/api/courses/completions", headers),
    ]).finally(() => {
      hideLoading(statsBody);
      hideLoading(modulesBody);
      hideLoading(coursesBody);
    });
  },
  tegn: ([statsResult, coursesResult]) => {
    if (statsResult.status === "fulfilled") {
      cachedStatsData = statsResult.value;
      cachedStatsFailed = false;
    } else if (!cachedStatsData) {
      cachedStatsFailed = true;
    }
    renderStatsPanel();
    renderModules(cachedStatsData);
    if (coursesResult.status === "fulfilled") {
      cachedCoursesData = coursesResult.value;
      renderCourses(cachedCoursesData);
    }
    renderTabCounts();
  },
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
      showToast(describeApiError(error, t).headline, "error");
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
      showToast(describeApiError(error, t).headline, "error");
    }
  });
});

requestDeletionBtn.addEventListener("click", () => {
  openDeletionDialog();
});

issueAgentTokenBtn.addEventListener("click", async () => {
  await runWithBusyButton(issueAgentTokenBtn, async () => {
    try {
      const label = agentTokenLabelInput.value.trim();
      const body = await apiFetch("/api/admin/content/agent-authoring/tokens", headers, {
        method: "POST",
        body: JSON.stringify({
          ...(label ? { label } : {}),
          ttlMinutes: Number(agentTokenTtlSelect.value),
        }),
        headers: { "Content-Type": "application/json" },
      });
      agentTokenSecret.textContent = body.token;
      setHidden(agentTokenCopied, true);
      setHidden(agentTokenReveal, false);
      agentTokenLabelInput.value = "";
      await loadAgentTokens();
    } catch (error) {
      // #1046: siste to rå bruk på denne flaten. Reserven «Error» var dessuten hardkodet engelsk.
      showToast(describeApiError(error, t).headline, "error");
    }
  });
});

copyAgentTokenBtn.addEventListener("click", async () => {
  const secret = agentTokenSecret.textContent ?? "";
  if (!secret) return;
  const copied = await copyAgentTokenToClipboard(secret);
  if (copied) {
    setHidden(agentTokenCopied, false);
  }
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
      showToast(describeApiError(error, t).headline, "error");
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
      profileContent.innerHTML = `<p style="color:var(--color-error,red);padding:16px">${escapeHtml(String(err))}</p>`;
    }
  }
})();

// 2.104.0: logger ut av plattformen og Microsoft-kontoen; neste innlogging spør hvilken konto.
document.getElementById("signOutBtn")?.addEventListener("click", () => { void signOut(); });
