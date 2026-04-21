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
import {
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";
import { hideLoading, showEmpty, showLoading } from "/static/loading.js";
import { showToast } from "/static/toast.js";

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

// ---------------------------------------------------------------------------
// Runtime config / auth
// ---------------------------------------------------------------------------

let participantRuntimeConfig = {
  identityDefaults: { roles: ["SUBJECT_MATTER_OWNER"] },
  navigation: { items: [] },
  calibrationWorkspace: { accessRoles: [], defaults: { maxRows: 120, statuses: ["COMPLETED", "UNDER_REVIEW"] } },
};

let getHeaders = {};
let activeUserRoles = [];

// ---------------------------------------------------------------------------
// DOM refs (top-level, always present)
// ---------------------------------------------------------------------------

const workspaceNav = document.getElementById("workspaceNav");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const pageContent = document.getElementById("pageContent");
const navKalibrering = document.getElementById("navKalibrering");

// ---------------------------------------------------------------------------
// Calibration DOM refs (populated after template instantiation)
// ---------------------------------------------------------------------------

let calibrationModuleIdSelect;
let calibrationModuleVersionIdInput;
let calibrationStatuses;
let calibrationLimitInput;
let calibrationDateFromInput;
let calibrationDateToInput;
let loadCalibrationButton;
let calibrationMeta;
let calibrationSignals;
let thresholdEditorSection;
let thresholdTotalMinInput;
let publishThresholdsButton;
let thresholdPublishResult;
let calibrationOutcomesBody;
let calibrationAnchorsBody;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allModules = [];
let latestCalibrationWorkspaceBody = null;

const allSubmissionStatuses = ["SUBMITTED", "PROCESSING", "SCORED", "UNDER_REVIEW", "COMPLETED", "REJECTED"];

// ---------------------------------------------------------------------------
// Role gate
// ---------------------------------------------------------------------------

function hasCalibrationAccess() {
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  const userRoles = new Set(activeUserRoles);
  return [...calibrationRoles].some(r => userRoles.has(r));
}

// ---------------------------------------------------------------------------
// Access denied state
// ---------------------------------------------------------------------------

function renderAccessDenied() {
  pageContent.innerHTML = `
    <div class="access-denied">
      <p class="access-denied-title">Ingen tilgang</p>
      <p class="access-denied-text">Du mangler rollen som kreves for å bruke kalibrering.</p>
      <a href="/admin-content" class="btn btn-secondary">Tilbake til Moduler</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatNumber(value, maxFractionDigits = 2) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat(currentLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function formatDateTimeValue(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(currentLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function localizeSubmissionStatus(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return t(`result.statusValue.${normalized || "UNKNOWN"}`);
}

// ---------------------------------------------------------------------------
// Pill helpers
// ---------------------------------------------------------------------------

function getCheckedPillValues(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
}

function enablePillArrowNavigation(container) {
  if (!container) return;
  container.addEventListener("keydown", event => {
    const isPrevious = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const isNext = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!isPrevious && !isNext) return;

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    if (checkboxes.length === 0) return;

    const focusedIndex = checkboxes.findIndex(cb => cb === document.activeElement);
    const nextIndex = isPrevious
      ? (focusedIndex <= 0 ? checkboxes.length - 1 : focusedIndex - 1)
      : (focusedIndex >= checkboxes.length - 1 ? 0 : focusedIndex + 1);
    checkboxes[nextIndex]?.focus();
    event.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Module select
// ---------------------------------------------------------------------------

function renderCalibrationModuleOptions(preferredId) {
  if (!calibrationModuleIdSelect) return;

  const previousValue = preferredId ?? calibrationModuleIdSelect.value;
  calibrationModuleIdSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("calibration.filters.moduleSelectPlaceholder");
  calibrationModuleIdSelect.appendChild(placeholder);

  for (const mod of allModules) {
    const option = document.createElement("option");
    option.value = mod.id;
    option.textContent = `${mod.title ?? mod.id} (${mod.id})`;
    calibrationModuleIdSelect.appendChild(option);
  }

  if (previousValue && allModules.some(m => m.id === previousValue)) {
    calibrationModuleIdSelect.value = previousValue;
  }
}

// ---------------------------------------------------------------------------
// Calibration status pills
// ---------------------------------------------------------------------------

function getSelectedCalibrationStatuses() {
  const selected = getCheckedPillValues(calibrationStatuses);
  if (selected.length > 0) return selected;
  return participantRuntimeConfig?.calibrationWorkspace?.defaults?.statuses ?? ["COMPLETED", "UNDER_REVIEW"];
}

function populateCalibrationStatusOptions() {
  if (!calibrationStatuses) return;
  const selected = new Set(getSelectedCalibrationStatuses());
  calibrationStatuses.innerHTML = "";

  for (const status of allSubmissionStatuses) {
    const optionLabel = document.createElement("label");
    optionLabel.className = "pill-option";

    const optionInput = document.createElement("input");
    optionInput.type = "checkbox";
    optionInput.value = status;
    optionInput.checked = selected.has(status);
    optionInput.setAttribute("aria-label", localizeSubmissionStatus(status));

    const optionText = document.createElement("span");
    optionText.textContent = localizeSubmissionStatus(status);

    optionLabel.appendChild(optionInput);
    optionLabel.appendChild(optionText);
    calibrationStatuses.appendChild(optionLabel);
  }
}

// ---------------------------------------------------------------------------
// Threshold editor
// ---------------------------------------------------------------------------

function getThresholdInputValues() {
  return { totalMin: Number(thresholdTotalMinInput?.value ?? 0) };
}

function renderThresholds(effectiveThresholds) {
  if (!thresholdEditorSection || !thresholdTotalMinInput || !thresholdPublishResult) return;
  thresholdTotalMinInput.value = String(effectiveThresholds.totalMin);
  thresholdPublishResult.textContent = t(
    effectiveThresholds.source === "module_policy"
      ? "calibration.thresholds.source.module"
      : "calibration.thresholds.source.global",
  );
  thresholdEditorSection.style.display = "";
  if (publishThresholdsButton) publishThresholdsButton.disabled = false;
}

// ---------------------------------------------------------------------------
// Render calibration results
// ---------------------------------------------------------------------------

function renderCalibrationWorkspace(body) {
  if (!calibrationSignals || !calibrationOutcomesBody || !calibrationAnchorsBody || !thresholdEditorSection) return;

  hideLoading(calibrationSignals);
  hideLoading(calibrationOutcomesBody);
  hideLoading(calibrationAnchorsBody);
  latestCalibrationWorkspaceBody = body;

  if (!body) {
    showEmpty(calibrationSignals, t("calibration.signals.none"));
    if (calibrationMeta) calibrationMeta.textContent = "";
    showEmpty(calibrationOutcomesBody, t("calibration.outcomes.empty"), { columns: 7 });
    showEmpty(calibrationAnchorsBody, t("calibration.anchors.empty"), { columns: 5 });
    thresholdEditorSection.style.display = "none";
    if (thresholdPublishResult) thresholdPublishResult.textContent = "";
    return;
  }

  const signals = body.signals ?? {};
  const flags = Array.isArray(signals.flags) ? signals.flags : [];
  const flagLines = flags.length > 0
    ? flags.map(flag => `- ${flag.code}: ${flag.message} (${formatNumber(flag.actual)} / ${formatNumber(flag.threshold)})`)
    : [t("calibration.flags.none")];

  calibrationSignals.textContent = [
    `${t("calibration.outcomes.title")}: ${signals.outcomeCount ?? 0}`,
    `${t("calibration.signals.passRate")}: ${formatNumber(signals.passRate)}`,
    `${t("calibration.signals.manualReviewRate")}: ${formatNumber(signals.manualReviewRate)}`,
    `${t("calibration.signals.averageTotalScore")}: ${formatNumber(signals.averageTotalScore)}`,
    `${t("calibration.signals.benchmarkPromptTemplates")}: ${signals.benchmarkPromptTemplateCount ?? 0}`,
    `${t("calibration.signals.coveredPromptTemplates")}: ${signals.coveredPromptTemplateCount ?? 0}`,
    `${t("calibration.signals.benchmarkCoverageRate")}: ${formatNumber(signals.benchmarkCoverageRate)}`,
    `${t("calibration.signals.flags")}:`,
    ...flagLines,
  ].join("\n");

  if (calibrationMeta) {
    calibrationMeta.textContent = `${t("calibration.meta.loadedPrefix")}: ${body.module?.title ?? "-"} (${body.module?.id ?? "-"})`;
  }

  // Outcomes
  const outcomes = Array.isArray(body.outcomes) ? body.outcomes : [];
  calibrationOutcomesBody.innerHTML = "";
  if (outcomes.length === 0) {
    showEmpty(calibrationOutcomesBody, t("calibration.outcomes.empty"), { columns: 7 });
  } else {
    for (const outcome of outcomes) {
      const row = document.createElement("tr");
      const values = [
        outcome.submissionId ?? "-",
        formatDateTimeValue(outcome.submittedAt),
        localizeSubmissionStatus(outcome.submissionStatus),
        `${outcome.moduleVersionNo ?? "-"} (${outcome.moduleVersionId ?? "-"})`,
        formatNumber(outcome?.decision?.totalScore),
        outcome?.decision?.passFailTotal === true ? t("calibration.value.pass")
          : outcome?.decision?.passFailTotal === false ? t("calibration.value.fail")
          : "-",
        outcome?.llm?.manualReviewRecommended === true ? t("calibration.value.yes") : t("calibration.value.no"),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      calibrationOutcomesBody.appendChild(row);
    }
  }

  // Anchors
  const anchors = Array.isArray(body.benchmarkAnchors) ? body.benchmarkAnchors : [];
  calibrationAnchorsBody.innerHTML = "";
  if (anchors.length === 0) {
    showEmpty(calibrationAnchorsBody, t("calibration.anchors.empty"), { columns: 5 });
  } else {
    for (const anchor of anchors) {
      const row = document.createElement("tr");
      const values = [
        `${anchor.promptTemplateVersionNo ?? "-"} (${anchor.promptTemplateVersionId ?? "-"})`,
        String(anchor.benchmarkExampleCount ?? "-"),
        anchor.sourcePromptTemplateVersionId ?? "-",
        anchor.sourceModuleVersionId ?? "-",
        formatDateTimeValue(anchor.createdAt),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      calibrationAnchorsBody.appendChild(row);
    }
  }

  if (body.effectiveThresholds) {
    renderThresholds(body.effectiveThresholds);
  }
}

// ---------------------------------------------------------------------------
// Load calibration workspace
// ---------------------------------------------------------------------------

async function loadCalibrationWorkspace() {
  if (!loadCalibrationButton || !calibrationModuleIdSelect) return;

  loadCalibrationButton.disabled = true;
  const origText = loadCalibrationButton.textContent;
  loadCalibrationButton.textContent = "…";

  try {
    if (calibrationMeta) calibrationMeta.textContent = "";
    showLoading(calibrationSignals, { rows: 6 });
    showLoading(calibrationOutcomesBody, { rows: 4, columns: 7 });
    showLoading(calibrationAnchorsBody, { rows: 3, columns: 5 });

    const moduleId = calibrationModuleIdSelect.value;
    if (!moduleId) {
      throw new Error(t("calibration.errors.moduleRequired"));
    }

    const params = new URLSearchParams();
    params.set("moduleId", moduleId);

    const moduleVersionId = calibrationModuleVersionIdInput?.value.trim();
    if (moduleVersionId) params.set("moduleVersionId", moduleVersionId);

    const statuses = getSelectedCalibrationStatuses();
    if (statuses.length > 0) params.set("status", statuses.join(","));

    const limit = Number(calibrationLimitInput?.value);
    if (Number.isFinite(limit) && limit > 0) params.set("limit", String(limit));

    if (calibrationDateFromInput?.value) params.set("dateFrom", calibrationDateFromInput.value);
    if (calibrationDateToInput?.value) params.set("dateTo", calibrationDateToInput.value);

    const body = await apiFetch(`/api/calibration/workspace?${params.toString()}`, getHeaders);
    renderCalibrationWorkspace(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (calibrationMeta) calibrationMeta.textContent = "";
    showEmpty(calibrationSignals, message);
    showEmpty(calibrationOutcomesBody, message, { columns: 7 });
    showEmpty(calibrationAnchorsBody, message, { columns: 5 });
  } finally {
    loadCalibrationButton.disabled = false;
    loadCalibrationButton.textContent = origText;
  }
}

// ---------------------------------------------------------------------------
// Publish thresholds
// ---------------------------------------------------------------------------

async function publishThresholds() {
  if (!publishThresholdsButton || !calibrationModuleIdSelect) return;

  const moduleId = calibrationModuleIdSelect.value;
  if (!moduleId) {
    showToast(t("calibration.errors.moduleRequired"), "error");
    return;
  }

  const values = getThresholdInputValues();

  publishThresholdsButton.disabled = true;
  const origText = publishThresholdsButton.textContent;
  publishThresholdsButton.textContent = "…";

  try {
    await apiFetch("/api/calibration/workspace/publish-thresholds", getHeaders, {
      method: "POST",
      body: JSON.stringify({ moduleId, totalMin: values.totalMin }),
    });
    showToast(t("calibration.thresholds.published") ?? "Terskler publisert.", "success");
    if (thresholdPublishResult) thresholdPublishResult.textContent = t("calibration.thresholds.publishedAt") ?? "Published.";
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke publisere terskler.", "error");
  } finally {
    publishThresholdsButton.disabled = false;
    publishThresholdsButton.textContent = origText;
  }
}

// ---------------------------------------------------------------------------
// Mount calibration workspace template
// ---------------------------------------------------------------------------

function mountCalibrationWorkspace(preferredModuleId) {
  const template = document.getElementById("calibrationWorkspaceTemplate");
  if (!template) return;

  const clone = template.content.cloneNode(true);
  pageContent.innerHTML = "";
  pageContent.appendChild(clone);

  // Wire up DOM refs
  calibrationModuleIdSelect = document.getElementById("calibrationModuleId");
  calibrationModuleVersionIdInput = document.getElementById("calibrationModuleVersionId");
  calibrationStatuses = document.getElementById("calibrationStatuses");
  calibrationLimitInput = document.getElementById("calibrationLimit");
  calibrationDateFromInput = document.getElementById("calibrationDateFrom");
  calibrationDateToInput = document.getElementById("calibrationDateTo");
  loadCalibrationButton = document.getElementById("loadCalibration");
  calibrationMeta = document.getElementById("calibrationMeta");
  calibrationSignals = document.getElementById("calibrationSignals");
  thresholdEditorSection = document.getElementById("thresholdEditorSection");
  thresholdTotalMinInput = document.getElementById("thresholdTotalMin");
  publishThresholdsButton = document.getElementById("publishThresholds");
  thresholdPublishResult = document.getElementById("thresholdPublishResult");
  calibrationOutcomesBody = document.getElementById("calibrationOutcomesBody");
  calibrationAnchorsBody = document.getElementById("calibrationAnchorsBody");

  // Show module label badge when deep-linked
  if (preferredModuleId) {
    const mod = allModules.find(m => m.id === preferredModuleId);
    const label = document.getElementById("calibrationModuleLabel");
    if (label) {
      label.textContent = `Modul: ${mod?.title ?? preferredModuleId}`;
      label.hidden = false;
    }
  }

  // Set default limit
  if (calibrationLimitInput) {
    calibrationLimitInput.value = String(participantRuntimeConfig?.calibrationWorkspace?.defaults?.maxRows ?? 120);
  }

  // Apply i18n to data-i18n attributes
  pageContent.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);
    if (text && text !== key) el.textContent = text;
  });
  pageContent.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    const text = t(key);
    if (text && text !== key) el.placeholder = text;
  });

  // Populate filters
  renderCalibrationModuleOptions(preferredModuleId);
  populateCalibrationStatusOptions();
  renderCalibrationWorkspace(null);
  enablePillArrowNavigation(calibrationStatuses);

  // Event listeners
  loadCalibrationButton?.addEventListener("click", loadCalibrationWorkspace);
  publishThresholdsButton?.addEventListener("click", publishThresholds);

}

// ---------------------------------------------------------------------------
// Workspace navigation
// ---------------------------------------------------------------------------

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const roles = activeUserRoles.join(",") || "SUBJECT_MATTER_OWNER";
  const allItems = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    roles,
    window.location.pathname,
  ).filter(item => item.visible);

  const profileItem = allItems.find(item => item.id === "profile");
  const items = allItems.filter(item => item.id !== "profile");

  workspaceNav.innerHTML = "";
  workspaceNav.hidden = items.length === 0;
  for (const item of items) {
    const a = document.createElement("a");
    a.href = item.path;
    a.className = item.active ? "workspace-nav-link active" : "workspace-nav-link";
    a.textContent = t(item.labelKey) || item.id;
    workspaceNav.appendChild(a);
  }

  if (profileItem) {
    const localePicker = document.querySelector(".locale-picker");
    if (localePicker) {
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
  }
}

function renderContentAreaNav() {
  // Kalibrering nav is always shown as active on this page (visible because the user navigated here)
  // but hide it for users without role (role gate is enforced by renderAccessDenied)
  const hasAccess = hasCalibrationAccess();
  if (navKalibrering) navKalibrering.hidden = !hasAccess;
}

// ---------------------------------------------------------------------------
// Locale selector
// ---------------------------------------------------------------------------

function buildLocaleSelector() {
  if (!localeSelect) return;
  localeSelect.innerHTML = supportedLocales
    .map(l => `<option value="${l}"${l === currentLocale ? " selected" : ""}>${localeLabels[l] ?? l}</option>`)
    .join("");
  localeSelect.addEventListener("change", () => {
    currentLocale = localeSelect.value;
    localStorage.setItem("participant.locale", currentLocale);
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    const cfg = await getConsoleConfig();
    participantRuntimeConfig = cfg;
    getHeaders = buildConsoleHeaders(cfg);
  } catch {
    getHeaders = {};
  }

  try {
    const me = await apiFetch("/api/me", getHeaders);
    activeUserRoles = me?.user?.roles ?? [];
  } catch {
    activeUserRoles = [];
  }

  buildLocaleSelector();
  renderWorkspaceNavigation();
  renderContentAreaNav();

  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `Kalibrering – A2 v${version}`;
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  if (workspaceNav) {
    fetchQueueCounts(getHeaders).then(counts => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});
  }

  // Role gate check
  if (!hasCalibrationAccess()) {
    renderAccessDenied();
    return;
  }

  // Load modules for the filter dropdown
  try {
    const libData = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
    allModules = (libData.modules ?? []).filter(m => m.status !== "archived");
  } catch {
    allModules = [];
  }

  // Deep-link: prefill moduleId from query string
  const preferredModuleId = new URLSearchParams(window.location.search).get("moduleId") ?? null;

  mountCalibrationWorkspace(preferredModuleId);
}

init();
