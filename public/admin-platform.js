import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { lagLokalisertRessurs } from "/static/localized-resource.js";
import { resolveInitialLocale } from "/static/i18n-locale.js";
import { localeLabels, supportedLocales, translations } from "/static/i18n/admin-platform-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, fetchQueueCounts, applyNavReviewBadge } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { showToast } from "/static/toast.js";
import { escapeHtml } from "/static/html-escape.js";
import { setHidden } from "/static/dom-visibility.js";
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

let currentLocale = resolveInitialLocale(supportedLocales);
let participantRuntimeConfig = {
  authMode: "mock",
  mockRolePresets: [],
  navigation: { items: [] },
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
    renderCertBackground(Boolean(data.certificateBackground));
    await loadFailedAssessments();
    settingsContent.style.display = "";
  } catch (err) {
    if (settingsContent) {
      settingsContent.style.display = "";
      settingsContent.innerHTML = `<p style="color:var(--color-error,red);padding:16px">${escapeHtml(String(err))}</p>`;
    }
  }
}

// ── #580 Certificate background ────────────────────────────────────────────────

const certBgFile = document.getElementById("certBgFile");
const certBgUpload = document.getElementById("certBgUpload");
const certBgRemove = document.getElementById("certBgRemove");
const certBgPreview = document.getElementById("certBgPreview");
const certBgPreviewWrap = document.getElementById("certBgPreviewWrap");
const certBgFeedback = document.getElementById("certBgFeedback");

function renderCertBackground(present) {
  certBgRemove.style.display = present ? "" : "none";
  certBgPreviewWrap.style.display = present ? "" : "none";
  if (present) {
    // Cache-bust so a freshly uploaded image replaces a stale preview. Served unauthenticated.
    certBgPreview.src = `/certificate-background?t=${Date.now()}`;
  } else {
    certBgPreview.removeAttribute("src");
  }
}

function showCertBgFeedback(message, isError) {
  certBgFeedback.textContent = message;
  certBgFeedback.style.color = isError ? "var(--color-error, red)" : "var(--color-meta)";
  certBgFeedback.style.display = "";
}

async function uploadCertBackground() {
  const file = certBgFile.files?.[0];
  if (!file) {
    showCertBgFeedback(t("adminPlatform.certBackground.noFile"), true);
    return;
  }
  certBgUpload.disabled = true;
  try {
    const form = new FormData();
    form.append("file", file);
    // Multipart upload: pass the auth headers but let the browser set the multipart Content-Type.
    const h = headers();
    delete h["Content-Type"];
    await apiFetch("/api/admin/platform/certificate-background", () => h, { method: "POST", body: form });
    certBgFile.value = "";
    renderCertBackground(true);
    showCertBgFeedback(t("adminPlatform.certBackground.uploaded"), false);
  } catch (err) {
    showCertBgFeedback(String(err?.message ?? err), true);
  } finally {
    certBgUpload.disabled = false;
  }
}

async function removeCertBackground() {
  certBgRemove.disabled = true;
  try {
    await apiFetch("/api/admin/platform/certificate-background", headers, { method: "DELETE" });
    renderCertBackground(false);
    showCertBgFeedback(t("adminPlatform.certBackground.removed"), false);
  } catch (err) {
    showCertBgFeedback(String(err?.message ?? err), true);
  } finally {
    certBgRemove.disabled = false;
  }
}

certBgUpload?.addEventListener("click", uploadCertBackground);
certBgRemove?.addEventListener("click", removeCertBackground);

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
  document.body.classList.remove("auth-resolving"); // auth-modus kjent → ikke vis dev-kort i prod/stage

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

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
  // ⚠️ Hentingen ligger HER, ikke i `setLocale` — den kalles også ved oppstart (#1039).
  feiledeVurderinger.oppdaterVedSpråkbytte();
});
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
  fetchQueueCounts(headers).then((counts) => applyNavReviewBadge(workspaceNav, counts));
  try {
    const versionData = await apiFetch("/version", { headers: {} });
    const appVersionEl = document.getElementById("appVersion");
    if (appVersionEl) appVersionEl.textContent = `v${versionData.version ?? "unknown"}`;
  } catch {
    // non-critical
  }
  await loadSettings();
})();


// ── #953 Vurderinger som ga opp ───────────────────────────────────────────────
//
// ⚠️ Seksjonen skjules med setHidden(), IKKE .hidden-klassen. `.card` setter display, og en
// forfatter-regel som .hidden taper mot den — elementet ville aldri blitt skjult. Det er
// .hidden-fella dokumentert i FEATURE_SURFACE_MAP.
//
// Kortet er skjult som utgangspunkt og vises KUN når lista har rader (produkteier 2026-08-26).
// Feiler oppslaget, forblir det skjult: en administrator skal ikke få et tomt kort som ser ut som
// «alt er bra» når vi faktisk ikke vet.

const failedAssessmentsCard = document.getElementById("failedAssessmentsCard");
const failedAssessmentsBody = document.getElementById("failedAssessmentsBody");

// #1042: modultitlene i lista over feilede vurderinger lokaliseres av serveren ved HENTING
// (#1022/#1027). Uten ny henting ved språkbytte ble de stående på forrige språk (#1040).
const feiledeVurderinger = lagLokalisertRessurs({
  hentSpråk: () => currentLocale,
  hent: () => apiFetch("/api/admin/platform/failed-assessments", headers),
  tegn: (data) => tegnFeiledeVurderinger(data),
  påFeil: () => { /* kortet forblir skjult, som før */ },
});

async function loadFailedAssessments() {
  await feiledeVurderinger.last();
}

function tegnFeiledeVurderinger(data) {
  if (!failedAssessmentsCard || !failedAssessmentsBody) return;
  setHidden(failedAssessmentsCard, true);

  const rows = Array.isArray(data?.failedAssessments) ? data.failedAssessments : [];
  const total = typeof data?.total === "number" ? data.total : rows.length;

  if (rows.length === 0) return;

  failedAssessmentsBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.participantName ?? "—")}<br><span class="small">${escapeHtml(row.participantEmail ?? "")}</span></td>
      <td>${escapeHtml(moduleTitleOf(row.moduleTitle))}</td>
      <td class="failed-when">${escapeHtml(formatWhen(row.failedAt))}</td>
      <td class="failed-attempts">${escapeHtml(`${row.attempts ?? "?"}/${row.maxAttempts ?? "?"}`)}</td>
      <td class="small failed-reason">${escapeHtml(row.errorMessage ?? "—")}</td>
      <td class="failed-action"></td>
    `;
    const actionCell = tr.lastElementChild;
    const button = document.createElement("button");
    button.className = "btn-secondary";
    button.textContent = t("adminPlatform.failedAssessments.retry");
    button.addEventListener("click", () => retryAssessment(row.submissionId, button));
    actionCell.appendChild(button);
    failedAssessmentsBody.appendChild(tr);
  }

  // Lista er avkortet, telleren er ikke. Si det, i stedet for å la administratoren lure på hvorfor
  // merket i menyen viser et større tall enn antall rader.
  const truncationNote = document.getElementById("failedAssessmentsTruncated");
  if (truncationNote) {
    const truncated = total > rows.length;
    setHidden(truncationNote, !truncated);
    truncationNote.textContent = truncated
      ? `${t("adminPlatform.failedAssessments.showing")} ${rows.length} / ${total}`
      : "";
  }

  setHidden(failedAssessmentsCard, false);
}

async function retryAssessment(submissionId, button) {
  button.disabled = true;
  button.textContent = t("adminPlatform.failedAssessments.retrying");
  try {
    // #953: administratorens EGEN rute. Deltakerruta `/api/assessments/:id/run` er eierskaps-
    // sjekket mot innsenderen, så en administrator fikk 404 der — knappen virket aldri.
    await apiFetch(`/api/admin/platform/failed-assessments/${encodeURIComponent(submissionId)}/retry`, headers, {
      method: "POST",
      body: JSON.stringify({}),
    });
    button.textContent = t("adminPlatform.failedAssessments.retryQueued");
    showToast(t("adminPlatform.failedAssessments.retryQueued"));
    // Merket i toppmenyen leser samme teller — oppdater det, ellers står det igjen med et tall
    // administratoren nettopp har gjort noe med.
    if (workspaceNav) {
      fetchQueueCounts(headers).then((counts) => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});
    }
    // Raden er ikke lenger «fast» — en aktiv jobb finnes. Hent lista på nytt så kortet
    // friskmelder seg selv i stedet for å vise en sak som er tatt hånd om.
    await loadFailedAssessments();
  } catch (err) {
    button.disabled = false;
    button.textContent = t("adminPlatform.failedAssessments.retryFailed");
    showToast(String(err));
  }
}

// Modultittelen er lokalisert JSON lagret som TEKST. `typeof === "string"` er sant for BEGGE
// former og måler ingenting — samme felle som stage-suiten gikk i.
/**
 * #1022: serveren lokaliserer nå tittelen, så her skal det ikke tolkes noe.
 *
 * ⚠️ Denne parset tidligere JSON-strengen selv, med en ANNEN reservekjede enn serverens: den falt
 * tilbake på `nb`, og fantes ikke nb, viste den den rå JSON-strengen. En tittel som bare er
 * oversatt til nynorsk — en helt lovlig tilstand etter #892 — traff nøyaktig det.
 *
 * To implementasjoner av «hvilket språk viser vi» er én for mye. Serveren eier spørsmålet.
 */
function moduleTitleOf(value) {
  return typeof value === "string" && value.trim() ? value : "—";
}

// Dato og klokkeslett uten sekunder. `toLocaleString()` ga «26.8.2026, 21:43:21» — sekundene
// hjelper ingen som skal avgjøre om en vurdering skal kjøres på nytt, og lengden presset kolonnen.
function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(currentLocale === "en-GB" ? "en-GB" : "nb-NO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
