import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { runWithBusyButton } from "/static/busy-button.js";
import { showToast } from "/static/toast.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { lagLokalisertRessurs } from "/static/localized-resource.js";
import { describeApiError } from "/static/api-error.js";
import { resolveInitialLocale } from "/static/i18n-locale.js";
import { createNumberFormatter, createDateTimeFormatter } from "/static/format-display.js";
const formatDateTime = createDateTimeFormatter(() => currentLocale);
const formatNumber = createNumberFormatter(() => currentLocale);
import { escapeHtml as escapeHtmlC } from "/static/html-escape.js";
import { localeLabels, supportedLocales, translations } from "/static/i18n/participant-completed-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, fetchQueueCounts, applyNavReviewBadge } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import {
  OUTCOME_FAILED,
  OUTCOME_PASSED,
  deriveOutcome,
  isAppealableFail,
  outcomeClass,
} from "/static/outcome.js";
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
  );
  renderWorkspaceNavigationWithProfile({
    workspaceNav,
    localePicker: document.querySelector(".locale-picker"),
    items,
    buildLabel: (item) => t(item.labelKey),
  });
}

function renderCompletedModules(body) {
  const modules = Array.isArray(body?.modules) ? body.modules : [];
  completedBody.innerHTML = "";
  completedMeta.textContent = `${t("completed.meta.loadedPrefix")}: ${modules.length}`;

  if (modules.length === 0) {
    // #1046: den delte tomtilstanden, med `.empty-state`-stilen de andre flatene bruker.
    showEmpty(completedBody, t("completed.empty"), { columns: 6 });
    return;
  }

  for (const module of modules) {
    const row = document.createElement("tr");
    // #978: denne fila hadde sin EGEN tri-state-mapping som ignorerte statusen, så en innlevering
    // under vurdering ble vist rød «Ikke bestått» her mens resultatbanneret holdt den nøytral.
    const outcome = deriveOutcome({
      passFailTotal: module?.latestDecision?.passFailTotal,
      submissionStatus: module?.latestStatus,
    });
    const passFailValue = outcome === OUTCOME_PASSED
      ? t("completed.value.pass")
      : outcome === OUTCOME_FAILED
        ? t("completed.value.fail")
        : "-";
    const passFailClass = outcomeClass(outcome);
    // ⚠️ Denne krevde `COMPLETED` fram til 2026-08-24. Kravet er fjernet: en anke er et STERKERE
    // virkemiddel enn manuell vurdering, ikke et neste steg etter den, og serveren har alltid
    // tillatt begge. Se begrunnelsen i /static/outcome.js.
    const canAppeal =
      isAppealableFail({
        passFailTotal: module?.latestDecision?.passFailTotal,
        submissionStatus: module?.latestStatus,
      }) && module?.latestSubmissionId;
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
  // A consent-guard failure must not abort the rest of init (it previously rejected the whole
  // config promise, so anything chained after it — e.g. auto-loading course certificates — never ran).
  try {
    await initConsentGuard(headers, currentLocale);
  } catch {
    /* non-fatal — continue initialising the page */
  }
  fetchQueueCounts(headers).then((counts) => applyNavReviewBadge(workspaceNav, counts));
}

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, async () => {
    try {
      const body = await apiFetch("/api/me", headers);
      log(body);
    } catch (error) {
      log(describeApiError(error, t).headline);
    }
  });
});

// #1042: serveren avgjør hvilket språk innhold vises på når data HENTES (#1027). Ressursen eier
// ny henting ved språkbytte, kappløpsvakt og enkeltflyt per språk — flaten skal ikke ha sin egen.
const fullførteModuler = lagLokalisertRessurs({
  hentSpråk: () => currentLocale,
  hent: () => {
    const limit = Number(completedLimit.value);
    const query = Number.isFinite(limit) && limit > 0 ? `?limit=${encodeURIComponent(limit)}` : "";
    showLoading(completedBody, { rows: 3, columns: 6 });
    return apiFetch(`/api/modules/completed${query}`, headers).finally(() => hideLoading(completedBody));
  },
  tegn: (body) => {
    renderCompletedModules(body);
    log(body);
  },
  påFeil: (error) => log(describeApiError(error, t).headline),
});

loadCompletedButton.addEventListener("click", async () => {
  await runWithBusyButton(loadCompletedButton, () => fullførteModuler.last());
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
  // ⚠️ Hentingen ligger HER, ikke i `setLocale`. Den kalles også ved oppstart, og en bivirkning
  // der sender kall av gårde før roller og token finnes — det var #1039.
  fullførteModuler.oppdaterVedSpråkbytte();
  kursbevis.oppdaterVedSpråkbytte();
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
      // #983: serverens engelske setning sto her ordrett, etter en norsk innledning.
      completedAppealFeedback.textContent = `${t("completed.appeal.error")} ${describeApiError(error, t).headline}`.trim();
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

// --- Course certificates ---

const courseCertList = document.getElementById("courseCertList");


function renderCourseCertificates(completions) {
  courseCertList.innerHTML = "";
  if (!Array.isArray(completions) || completions.length === 0) {
    showEmpty(courseCertList, t("courseCert.empty"));
    return;
  }
  for (const cc of completions) {
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid var(--color-border);border-radius:var(--space-1);padding:var(--space-1);margin-bottom:var(--space-1);background:var(--color-bg-subtle,var(--color-bg))";
    card.innerHTML = `
      <div style="font-weight:600;font-size:14px">${escapeHtmlC(cc.courseTitle ?? cc.courseId)}</div>
      ${cc.certificationLevel ? `<div class="small" style="margin-top:2px">${escapeHtmlC(t("courseCert.certLevel"))}: ${escapeHtmlC(cc.certificationLevel)}</div>` : ""}
      <div class="small" style="margin-top:4px">${escapeHtmlC(t("courseCert.completedAt"))}: ${formatDateTime(cc.completedAt)}</div>
      <div class="small" style="color:var(--color-text-soft)">${escapeHtmlC(t("courseCert.certificateId"))}: <code>${escapeHtmlC(cc.certificateId)}</code></div>
      <div style="margin-top:6px"><a href="/certificate?id=${encodeURIComponent(cc.certificateId)}" target="_blank" rel="noopener" class="workspace-nav-link">${escapeHtmlC(t("courseCert.view"))}</a></div>
    `;
    courseCertList.appendChild(card);
  }
}

// #1042: kursbevisene viser `courseTitle` og `certificationLevel`, som serveren lokaliserer ved
// henting. Uten ny henting ble de stående på forrige språk — engelsk side, norske titler (#1040).
const kursbevis = lagLokalisertRessurs({
  hentSpråk: () => currentLocale,
  hent: () => apiFetch("/api/courses/completions", headers),
  tegn: (body) => renderCourseCertificates(body?.completions ?? []),
  påFeil: (error) => {
    // ⚠️ #1046: her sto bare `renderCourseCertificates([])`. En feil ble altså vist som «du har
    // ingen kursbevis» — en tom liste er ikke det samme som at hentingen mislyktes.
    renderCourseCertificates([]);
    showToast(describeApiError(error, t).headline, "error");
  },
});

async function loadCourseCertificates() {
  await kursbevis.last();
}

// Refresh course certs when the completed button is clicked too.
loadCompletedButton.addEventListener("click", () => {
  loadCourseCertificates();
});

// Initial placeholder until the fetch resolves.
renderCourseCertificates([]);

populateLocaleSelect();
setLocale(currentLocale);
loadVersion();
// Auto-load course certificates on page open — they must NOT require clicking the
// "load completed modules" button (which is about modules). Chained after the console config
// so identity/headers are ready in mock-auth mode (in entra apiFetch adds the Bearer token).
loadParticipantConsoleConfig().then(loadCourseCertificates);
renderCompletedModules(null);
