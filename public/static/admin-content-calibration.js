import { createNumberFormatter, createDateTimeFormatter } from "./format-display.js";
const formatDateTimeValue = createDateTimeFormatter(() => currentLocale);
const formatNumber = createNumberFormatter(() => currentLocale);
import {
  supportedLocales,
  localeLabels,
  translations as adminContentTranslations,
} from "/static/i18n/admin-content-translations.js";
import { translations as calibrationTranslations } from "/static/i18n/calibration-translations.js";
import {
  apiFetch,
  buildConsoleHeaders,
  getConsoleConfig,
  fetchQueueCounts,
  applyNavReviewBadge,
} from "/static/api-client.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { showToast } from "/static/toast.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";

// #836: "Vurderingskvalitet" (tidl. Kalibrering) — les hvordan en modul scorer (signaler + fordeling)
// og juster bestått-grensa med en klient-side konsekvens-preview. Erstatter de tre gamle
// kalibrerings-kopiene. Eier-/kurs-filter holder modul-lista kort (#787 #5).

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

let currentLocale = (() => {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) return stored;
  const b = navigator.language?.toLowerCase() ?? "";
  if (b.startsWith("nb")) return "nb";
  if (b.startsWith("nn")) return "nn";
  return "en-GB";
})();

function t(key) {
  const cal = calibrationTranslations[currentLocale]?.[key] ?? calibrationTranslations["en-GB"]?.[key];
  if (cal !== undefined) return cal;
  return adminContentTranslations[currentLocale]?.[key] ?? adminContentTranslations["en-GB"]?.[key] ?? key;
}
// Interpolating variant: t("key", { count: 3 }) replaces {count}.
function tf(key, vars = {}) {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// ---------------------------------------------------------------------------
// Runtime config / auth
// ---------------------------------------------------------------------------

let participantRuntimeConfig = {
  identityDefaults: { roles: ["SUBJECT_MATTER_OWNER"] },
  navigation: { items: [] },
  calibrationWorkspace: {
    accessRoles: [],
    defaults: { maxRows: 120, statuses: ["COMPLETED", "UNDER_REVIEW"] },
    signalThresholds: { passRateMinimum: 0.6, manualReviewRateMaximum: 0.35, benchmarkCoverageMinimum: 0.5 },
  },
};

// apiFetch treats a non-function 2nd arg as the options object and ignores the 3rd — so getHeaders MUST
// be a function for POST bodies to be sent. (The old page passed an object here, dropping the body.)
let headerValues = {};
function getHeaders() {
  return headerValues;
}
let activeUserRoles = [];

// ---------------------------------------------------------------------------
// DOM refs (top-level, always present)
// ---------------------------------------------------------------------------

const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const pageContent = document.getElementById("pageContent");
const navKalibrering = document.getElementById("navKalibrering");

// Workspace refs (populated on mount)
let el = {};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allModules = []; // { id, title, ownedByMe, courses: [{id,title}], ... }
let ownerFilter = "mine"; // "mine" | "all"
let courseFilter = ""; // courseId or ""
let snapshotBody = null;
let effective = null; // effectiveThresholds from the last snapshot
// QA r5 #4: the pass rule depends on the module's assessment mode. For MCQ_ONLY modules pass/fail is
// decided by the MCQ percentage (mcqMinPercent, default 70) — totalScore is the MCQ score scaled into
// its weighting band, so the 0–100 total-histogram/threshold view is misleading and must be replaced.
let currentAssessmentMode = null;

function resolveContentAdminDefaults() {
  const defaults = participantRuntimeConfig?.identityDefaults?.contentAdmin;
  if (defaults && typeof defaults === "object") return defaults;
  return participantRuntimeConfig?.identityDefaults ?? {
    userId: "content-owner-1", email: "content.owner@company.com", name: "Platform Content Owner",
    department: "Learning", roles: ["SUBJECT_MATTER_OWNER"],
  };
}

function hasCalibrationAccess() {
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  const userRoles = new Set(activeUserRoles);
  return [...calibrationRoles].some((r) => userRoles.has(r));
}

function renderAccessDenied() {
  pageContent.innerHTML = `
    <div class="access-denied">
      <p class="access-denied-title">${t("quality.access.title")}</p>
      <p class="access-denied-text">${t("quality.access.text")}</p>
      <a href="/admin-content" class="btn btn-secondary">${t("quality.access.back")}</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// Filters + module/version selection
// ---------------------------------------------------------------------------

function ownerFilteredModules() {
  return ownerFilter === "mine" ? allModules.filter((m) => m.ownedByMe) : allModules;
}

function visibleModules() {
  return ownerFilteredModules().filter((m) => !courseFilter || (m.courses ?? []).some((c) => c.id === courseFilter));
}

function renderCourseFilterOptions() {
  const seen = new Map();
  for (const m of ownerFilteredModules()) {
    for (const c of m.courses ?? []) if (!seen.has(c.id)) seen.set(c.id, c.title);
  }
  const prev = courseFilter;
  el.qCourseFilter.innerHTML =
    `<option value="">${t("quality.filter.course.all")}</option>` +
    [...seen.entries()].map(([id, title]) => `<option value="${escapeAttr(id)}">${escapeHtml(title)}</option>`).join("");
  if (prev && seen.has(prev)) el.qCourseFilter.value = prev;
  else courseFilter = "";
}

function renderModuleOptions() {
  const mods = visibleModules();
  const prev = el.qModuleSelect.value;
  el.qModuleSelect.innerHTML =
    `<option value="">${t("quality.filter.module.placeholder")}</option>` +
    mods.map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.title ?? m.id)}</option>`).join("");
  if (prev && mods.some((m) => m.id === prev)) el.qModuleSelect.value = prev;
  el.qModuleCount.innerHTML = tf("quality.filter.count", { count: `<b>${mods.length}</b>` });
  onModuleChange();
}

async function onModuleChange() {
  const moduleId = el.qModuleSelect.value;
  el.qVersionSelect.innerHTML = `<option value="">${t("quality.filter.version.all")}</option>`;
  el.qOwnPill.hidden = true;
  if (!moduleId) return;

  const mod = allModules.find((m) => m.id === moduleId);
  if (mod) {
    el.qOwnPill.hidden = false;
    el.qOwnPill.textContent = mod.ownedByMe ? t("quality.pill.owned") : t("quality.pill.notOwned");
    el.qOwnPill.classList.toggle("notmine", !mod.ownedByMe);
  }
  // Populate the version dropdown from the module export (versions carry versionNo + id), and capture
  // the module's assessment mode (active version's, else newest) for the mode-aware threshold card.
  currentAssessmentMode = null;
  try {
    const data = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    const versions = data?.moduleExport?.versions ?? [];
    const activeVersionId = data?.moduleExport?.module?.activeVersionId ?? null;
    const modeVersion = versions.find((v) => v.id === activeVersionId) ?? versions[0];
    currentAssessmentMode = modeVersion?.assessmentMode ?? null;
    for (const v of versions) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = tf("quality.filter.version.item", { no: v.versionNo, state: v.publishedAt ? t("quality.version.published") : t("quality.version.draft") });
      el.qVersionSelect.appendChild(opt);
    }
  } catch { /* version list optional */ }
}

// ---------------------------------------------------------------------------
// Load snapshot
// ---------------------------------------------------------------------------

async function loadQuality() {
  const moduleId = el.qModuleSelect.value;
  if (!moduleId) {
    showToast(t("quality.errors.moduleRequired"), "error");
    return;
  }
  el.qLoad.disabled = true;
  const orig = el.qLoad.textContent;
  el.qLoad.textContent = "…";
  el.qMeta.textContent = t("quality.loading");
  try {
    const params = new URLSearchParams({ moduleId });
    if (el.qVersionSelect.value) params.set("moduleVersionId", el.qVersionSelect.value);
    const statuses = participantRuntimeConfig?.calibrationWorkspace?.defaults?.statuses ?? ["COMPLETED", "UNDER_REVIEW"];
    params.set("status", statuses.join(","));
    const limit = participantRuntimeConfig?.calibrationWorkspace?.defaults?.maxRows ?? 120;
    params.set("limit", String(limit));

    snapshotBody = await apiFetch(`/api/calibration/workspace?${params.toString()}`, getHeaders);
    renderWorkspace();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    el.qMeta.textContent = message;
    hideResults();
  } finally {
    el.qLoad.disabled = false;
    el.qLoad.textContent = orig;
  }
}

function hideResults() {
  for (const id of ["qSignalsCard", "qThresholdCard", "qAnchorCard", "qOutcomesCard"]) el[id].hidden = true;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderWorkspace() {
  const body = snapshotBody;
  if (!body) return hideResults();
  el.qMeta.textContent = tf("quality.meta.loaded", { title: body.module?.title ?? "-", count: (body.outcomes ?? []).length });
  effective = body.effectiveThresholds ?? { totalMin: 60, mcqMinPercent: null, practicalMinPercent: null };
  renderSignals(body.signals ?? {});
  renderThresholdCard(body);
  renderAnchors(body);
  renderOutcomes(body.outcomes ?? []);
}

function sigClass(ok, warn) {
  return ok ? "good" : warn ? "warn" : "crit";
}

function renderSignals(signals) {
  const th = participantRuntimeConfig?.calibrationWorkspace?.signalThresholds ?? {};
  const passMin = th.passRateMinimum ?? 0.6;
  const mrMax = th.manualReviewRateMaximum ?? 0.35;
  const covMin = th.benchmarkCoverageMinimum ?? 0.5;
  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);

  const passRate = signals.passRate ?? null;
  const mrRate = signals.manualReviewRate ?? null;
  const cov = signals.benchmarkCoverageRate ?? null;

  const cards = [
    {
      cls: passRate == null ? "neutral" : sigClass(passRate >= passMin, passRate >= passMin * 0.8),
      k: t("quality.signal.passRate"), v: pct(passRate),
      note: passRate == null ? t("quality.signal.noData") : passRate >= passMin ? t("quality.signal.passRate.ok") : t("quality.signal.passRate.low"),
    },
    {
      cls: mrRate == null ? "neutral" : sigClass(mrRate <= mrMax, mrRate <= mrMax * 1.2),
      k: t("quality.signal.manualReview"), v: pct(mrRate),
      note: mrRate == null ? t("quality.signal.noData") : mrRate <= mrMax ? t("quality.signal.manualReview.ok") : t("quality.signal.manualReview.high"),
    },
    {
      cls: cov == null ? "neutral" : sigClass(cov >= covMin, cov >= covMin * 0.8),
      k: t("quality.signal.coverage"), v: pct(cov),
      note: cov == null ? t("quality.signal.noData") : cov >= covMin ? t("quality.signal.coverage.ok") : t("quality.signal.coverage.low"),
    },
  ];
  el.qSignals.innerHTML = cards
    .map((c) => `<div class="q-sig ${c.cls}"><div class="k">${escapeHtml(c.k)}</div><div class="v">${escapeHtml(c.v)}</div><div class="note">${escapeHtml(c.note)}</div></div>`)
    .join("");
  el.qSignalsCard.hidden = false;
}

// Scores that are numeric, for histogram + preview.
function outcomeScores() {
  return (snapshotBody?.outcomes ?? [])
    .map((o) => o?.decision?.totalScore)
    .filter((s) => typeof s === "number" && Number.isFinite(s));
}

function isMcqOnly() {
  return currentAssessmentMode === "MCQ_ONLY";
}

function renderThresholdCard(body) {
  el.qTotalMin.value = String(effective.totalMin ?? 60);
  const mcqOnly = isMcqOnly();

  if (mcqOnly) {
    // MCQ-only: pass/fail is decided by the MCQ percentage. Hide the misleading total-score
    // histogram/threshold/preview and expose the one rule that actually applies.
    el.qDistBlock.hidden = true;
    el.qPreview.hidden = true;
    el.qTotalMin.closest(".q-thr-field").hidden = true;
    el.qMcqField.hidden = false;
    el.qMcqMin.value = String(effective.mcqMinPercent ?? 70);
    el.qPracticalField.hidden = true;
    el.qModeNote.hidden = false;
    el.qModeNote.textContent = t("quality.threshold.mcqOnlyNote");
  } else {
    el.qDistBlock.hidden = false;
    el.qPreview.hidden = false;
    el.qTotalMin.closest(".q-thr-field").hidden = false;
    el.qModeNote.hidden = true;
    // Contextual sub-gates: only show when the module's policy actually uses them.
    const showMcq = effective.mcqMinPercent != null;
    const showPractical = effective.practicalMinPercent != null;
    el.qMcqField.hidden = !showMcq;
    el.qPracticalField.hidden = !showPractical;
    if (showMcq) el.qMcqMin.value = String(effective.mcqMinPercent);
    if (showPractical) el.qPracticalMin.value = String(effective.practicalMinPercent);
    renderHistogram();
    updatePreview();
  }

  el.qThresholdSource.textContent =
    effective.source === "module_policy" ? t("quality.threshold.source.module") : t("quality.threshold.source.global");

  el.qPublish.disabled = false;
  el.qThresholdCard.hidden = false;
}

function renderHistogram() {
  const scores = outcomeScores();
  const bins = 20; // 0-100 in steps of 5
  const counts = new Array(bins).fill(0);
  for (const s of scores) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(s / (100 / bins))));
    counts[idx] += 1;
  }
  const max = Math.max(1, ...counts);
  const totalMin = Number(el.qTotalMin.value) || 0;
  const bars = counts
    .map((c, i) => {
      const binLow = i * (100 / bins);
      const pass = binLow + 100 / bins / 2 >= totalMin;
      return `<div class="bar ${pass ? "pass" : ""}" style="height:${Math.round((c / max) * 100)}%" title="${Math.round(binLow)}–${Math.round(binLow + 100 / bins)}: ${c}"></div>`;
    })
    .join("");
  const thr = `<div class="q-hist-thr" data-label="${t("quality.threshold.marker")} ${totalMin}" style="left:${Math.min(100, Math.max(0, totalMin))}%"></div>`;
  el.qHistogram.innerHTML = bars + thr;
}

function passCountAt(min) {
  return outcomeScores().filter((s) => s >= min).length;
}

function updatePreview() {
  const scores = outcomeScores();
  const total = scores.length;
  const newMin = Number(el.qTotalMin.value) || 0;
  if (total === 0) {
    el.qPreview.innerHTML = t("quality.preview.noData");
    return;
  }
  const passNew = passCountAt(newMin);
  const passEff = passCountAt(effective.totalMin ?? newMin);
  const pct = Math.round((passNew / total) * 100);
  const delta = passNew - passEff;
  const deltaText =
    delta === 0
      ? ""
      : ` <span class="delta">${tf(delta > 0 ? "quality.preview.deltaUp" : "quality.preview.deltaDown", { n: Math.abs(delta) })}</span>`;
  el.qPreview.innerHTML = tf("quality.preview.body", {
    min: `<b>${newMin}</b>`,
    pass: `<b>${passNew}</b>`,
    total: `<b>${total}</b>`,
    pct,
  }) + deltaText;
}

function renderAnchors(body) {
  const cov = body.signals?.benchmarkCoverageRate;
  const benchmark = body.signals?.benchmarkPromptTemplateCount ?? 0;
  const covered = body.signals?.coveredPromptTemplateCount ?? 0;
  el.qAnchorSummary.textContent = tf("quality.anchors.summary", {
    covered, benchmark, pct: cov == null ? "—" : `${Math.round(cov * 100)}%`,
  });
  // Deep-link into the module editor where prompt-template anchors are versioned.
  const moduleId = el.qModuleSelect.value;
  el.qAnchorLink.href = `/admin-content/module/${encodeURIComponent(moduleId)}/advanced`;
  el.qAnchorCard.hidden = false;
}

function renderOutcomes(outcomes) {
  if (!outcomes.length) {
    el.qOutcomesCard.hidden = true;
    return;
  }
  el.qOutcomesBody.innerHTML = outcomes
    .map((o) => {
      const pf = o?.decision?.passFailTotal === true ? t("quality.value.pass") : o?.decision?.passFailTotal === false ? t("quality.value.fail") : "-";
      const mr = o?.llm?.manualReviewRecommended === true ? t("quality.value.yes") : t("quality.value.no");
      return `<tr>
        <td>${escapeHtml(formatDateTimeValue(o.submittedAt))}</td>
        <td>${escapeHtml(localizeStatus(o.submissionStatus))}</td>
        <td>${escapeHtml(String(o.moduleVersionNo ?? "-"))}</td>
        <td>${escapeHtml(formatNumber(o?.decision?.totalScore))}</td>
        <td>${escapeHtml(pf)}</td>
        <td>${escapeHtml(mr)}</td>
      </tr>`;
    })
    .join("");
  el.qOutcomesCard.hidden = false;
}

function localizeStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "UNKNOWN";
  return t(`result.statusValue.${normalized}`);
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

async function publish() {
  const moduleId = el.qModuleSelect.value;
  if (!moduleId) {
    showToast(t("quality.errors.moduleRequired"), "error");
    return;
  }
  // MCQ-only modules keep their (unused) totalMin unchanged — the edited rule is mcqMinPercent.
  const totalMin = isMcqOnly() ? Number(effective?.totalMin ?? 60) : Number(el.qTotalMin.value);
  if (!Number.isFinite(totalMin) || totalMin < 0 || totalMin > 100) {
    showToast(t("quality.errors.totalMinRange"), "error");
    return;
  }
  // Consequence is shown inline; confirm the version-cutting side effect before publishing.
  if (!window.confirm(t("quality.threshold.confirm"))) return;

  const payload = { moduleId, totalMin };
  if (!el.qMcqField.hidden && el.qMcqMin.value !== "") payload.mcqMinPercent = Number(el.qMcqMin.value);
  if (!el.qPracticalField.hidden && el.qPracticalMin.value !== "") payload.practicalMinPercent = Number(el.qPracticalMin.value);

  el.qPublish.disabled = true;
  const orig = el.qPublish.textContent;
  el.qPublish.textContent = "…";
  try {
    await apiFetch("/api/calibration/workspace/publish-thresholds", getHeaders, { method: "POST", body: JSON.stringify(payload) });
    showToast(t("quality.publish.success"), "success");
    await loadQuality(); // reload so the new effective threshold + version show
  } catch (err) {
    showToast(err?.message ?? t("quality.publish.error"), "error");
  } finally {
    el.qPublish.disabled = false;
    el.qPublish.textContent = orig;
  }
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mountWorkspace() {
  const template = document.getElementById("qualityWorkspaceTemplate");
  if (!template) return;
  pageContent.innerHTML = "";
  pageContent.appendChild(template.content.cloneNode(true));

  el = {};
  for (const id of [
    "qOwnerSeg", "qCourseFilter", "qModuleSelect", "qVersionSelect", "qModuleCount", "qLoad", "qOwnPill", "qMeta",
    "qSignalsCard", "qSignals", "qThresholdCard", "qDistBlock", "qModeNote", "qHistogram", "qTotalMin", "qMcqField", "qMcqMin",
    "qPracticalField", "qPracticalMin", "qPreview", "qThresholdSource", "qPublish",
    "qAnchorCard", "qAnchorSummary", "qAnchorLink", "qOutcomesCard", "qOutcomesBody",
  ]) el[id] = document.getElementById(id);

  // i18n static text
  pageContent.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    const text = t(key);
    if (text && text !== key) node.textContent = text;
  });

  // Owner segmented control
  el.qOwnerSeg.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-owner]");
    if (!btn) return;
    ownerFilter = btn.dataset.owner;
    for (const b of el.qOwnerSeg.querySelectorAll("button")) b.classList.toggle("on", b === btn);
    renderCourseFilterOptions();
    renderModuleOptions();
  });
  el.qCourseFilter.addEventListener("change", () => { courseFilter = el.qCourseFilter.value; renderModuleOptions(); });
  el.qModuleSelect.addEventListener("change", onModuleChange);
  el.qLoad.addEventListener("click", loadQuality);
  el.qPublish.addEventListener("click", publish);
  el.qTotalMin.addEventListener("input", () => { renderHistogram(); updatePreview(); });

  renderCourseFilterOptions();
  renderModuleOptions();
}

// ---------------------------------------------------------------------------
// Nav / locale / init (scaffolding)
// ---------------------------------------------------------------------------

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const roles = activeUserRoles.join(",") || "SUBJECT_MATTER_OWNER";
  const items = resolveWorkspaceNavigationItems(participantRuntimeConfig?.navigation?.items, roles, window.location.pathname);
  renderWorkspaceNavigationWithProfile({ workspaceNav, localePicker, items, buildLabel: (item) => t(item.labelKey) || item.id });
  if (navKalibrering) navKalibrering.hidden = !hasCalibrationAccess();
}

function buildLocaleSelector() {
  if (!localeSelect) return;
  localeSelect.innerHTML = supportedLocales
    .map((l) => `<option value="${l}"${l === currentLocale ? " selected" : ""}>${localeLabels[l] ?? l}</option>`)
    .join("");
  localeSelect.addEventListener("change", () => {
    currentLocale = localeSelect.value;
    localStorage.setItem("participant.locale", currentLocale);
    headerValues["x-locale"] = currentLocale;
    window.location.reload();
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function escapeAttr(value) {
  return escapeHtml(value);
}

async function init() {
  try {
    const cfg = await getConsoleConfig();
    participantRuntimeConfig = cfg;
    const defaults = resolveContentAdminDefaults();
    headerValues = buildConsoleHeaders({
      userId: defaults.userId, email: defaults.email, name: defaults.name, department: defaults.department,
      roles: Array.isArray(defaults.roles) ? defaults.roles.join(",") : defaults.roles, locale: currentLocale,
    });
  } catch {
    headerValues = {};
  }
  try {
    const me = await apiFetch("/api/me", getHeaders);
    activeUserRoles = me?.user?.roles ?? [];
  } catch {
    activeUserRoles = [];
  }

  buildLocaleSelector();
  renderWorkspaceNavigation();

  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `Vurderingskvalitet – A2 v${version}`;
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  if (workspaceNav) fetchQueueCounts(getHeaders).then((counts) => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});

  if (!hasCalibrationAccess()) {
    renderAccessDenied();
    return;
  }

  try {
    const libData = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
    allModules = (libData.modules ?? []).filter((m) => m.status !== "archived");
  } catch {
    allModules = [];
  }
  // Default to "Mine moduler" unless the user owns none (then show all so the page isn't empty).
  if (!allModules.some((m) => m.ownedByMe)) ownerFilter = "all";

  mountWorkspace();
  if (ownerFilter === "all") {
    const btn = el.qOwnerSeg?.querySelector('button[data-owner="all"]');
    if (btn) for (const b of el.qOwnerSeg.querySelectorAll("button")) b.classList.toggle("on", b === btn);
  }
}

init();
