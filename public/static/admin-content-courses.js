import {
  supportedLocales,
  localeLabels,
  translations as adminContentTranslations,
} from "/static/i18n/admin-content-translations.js";
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
import { showToast } from "/static/toast.js";
import {
  detectCoursesRoute,
  buildCourseDeleteDialogText,
  deriveCourseListRows,
} from "/static/admin-content-courses-state.js";
import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";

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
  return adminContentTranslations[currentLocale]?.[key] ?? adminContentTranslations["en-GB"]?.[key] ?? key;
}

// ---------------------------------------------------------------------------
// Runtime config / auth
// ---------------------------------------------------------------------------

let participantRuntimeConfig = {
  identityDefaults: { roles: ["SUBJECT_MATTER_OWNER"] },
  navigation: { items: [] },
  calibrationWorkspace: { accessRoles: [] },
};
let activeUserRoles = [];

let _headerValues = {};
function getHeaders() { return _headerValues; }

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const pageContent = document.getElementById("pageContent");
const navKalibrering = document.getElementById("navKalibrering");
const deleteDialog = document.getElementById("deleteDialog");
const deleteDialogText = document.getElementById("deleteDialogText");
const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
const deleteCancelBtn = document.getElementById("deleteCancelBtn");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(
    currentLocale === "en-GB" ? "en-GB" : currentLocale,
    { day: "numeric", month: "short", year: "numeric" },
  );
}

function localizedText(value) {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed[currentLocale] ?? parsed["en-GB"] ?? Object.values(parsed).find(Boolean) ?? value;
        }
      } catch { /* plain string */ }
    }
    return value;
  }
  return value[currentLocale] ?? value["en-GB"] ?? Object.values(value).find(Boolean) ?? "";
}

function parseLocalizedFieldValues(value) {
  const empty = { "en-GB": "", nb: "", nn: "" };
  if (value == null) {
    return empty;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return {
            "en-GB": typeof parsed["en-GB"] === "string" ? parsed["en-GB"] : "",
            nb: typeof parsed.nb === "string" ? parsed.nb : "",
            nn: typeof parsed.nn === "string" ? parsed.nn : "",
          };
        }
      } catch {
        // Fall through and treat it as a plain string.
      }
    }
    return { "en-GB": value, nb: "", nn: "" };
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      "en-GB": typeof value["en-GB"] === "string" ? value["en-GB"] : "",
      nb: typeof value.nb === "string" ? value.nb : "",
      nn: typeof value.nn === "string" ? value.nn : "",
    };
  }

  return empty;
}

function cloneLocalizedFieldValues(valueMap) {
  const clone = {};
  for (const locale of supportedLocales) {
    clone[locale] = typeof valueMap?.[locale] === "string" ? valueMap[locale] : "";
  }
  return clone;
}

function cloneCourseLocaleValues(values) {
  return {
    title: cloneLocalizedFieldValues(values?.title),
    description: cloneLocalizedFieldValues(values?.description),
  };
}

function hasAnyLocalizedValue(valueMap) {
  return supportedLocales.some((locale) => typeof valueMap?.[locale] === "string" && valueMap[locale].trim().length > 0);
}

function firstNonEmptyLocale(valueMap, preferredLocales = supportedLocales) {
  const orderedLocales = [...new Set([...preferredLocales, ...supportedLocales])];
  for (const locale of orderedLocales) {
    const value = valueMap?.[locale];
    if (typeof value === "string" && value.trim().length > 0) {
      return locale;
    }
  }
  return null;
}

function getChangedCourseLocales(currentValues, initialValues) {
  const changed = new Set();
  for (const locale of supportedLocales) {
    const currentTitle = currentValues?.title?.[locale] ?? "";
    const initialTitle = initialValues?.title?.[locale] ?? "";
    const currentDescription = currentValues?.description?.[locale] ?? "";
    const initialDescription = initialValues?.description?.[locale] ?? "";
    if (currentTitle !== initialTitle || currentDescription !== initialDescription) {
      changed.add(locale);
    }
  }
  return changed;
}

function applyCourseLocaleValuesToForm(values) {
  for (const locale of supportedLocales) {
    const titleInput = document.getElementById(`title-${locale}`);
    const descriptionInput = document.getElementById(`desc-${locale}`);
    if (titleInput) {
      titleInput.value = values?.title?.[locale] ?? "";
    }
    if (descriptionInput) {
      descriptionInput.value = values?.description?.[locale] ?? "";
    }
  }

  const pageTitle = document.getElementById("detailPageTitle");
  if (pageTitle) {
    const titleForLocale =
      values?.title?.[currentLocale] ??
      values?.title?.["en-GB"] ??
      values?.title?.nb ??
      values?.title?.nn ??
      "";
    if (titleForLocale) {
      pageTitle.textContent = titleForLocale;
    }
  }
}

function resolveCourseLocalizationSourceLocale(currentValues, initialValues) {
  const changedLocales = getChangedCourseLocales(currentValues, initialValues);
  if (changedLocales.size === 1) {
    return [...changedLocales][0];
  }
  if (changedLocales.size === 0) {
    return firstNonEmptyLocale(currentValues?.title, [activeDetailLocale, currentLocale, "en-GB"]) ??
      firstNonEmptyLocale(currentValues?.description, [activeDetailLocale, currentLocale, "en-GB"]);
  }
  return null;
}

async function localizeCourseCopyAcrossLocales({ titleValues, descriptionValues, sourceLocale, preserveExisting = false }) {
  const localized = {
    title: cloneLocalizedFieldValues(titleValues),
    description: cloneLocalizedFieldValues(descriptionValues),
  };

  const sourceTitle = localized.title[sourceLocale]?.trim() ?? "";
  const sourceDescription = localized.description[sourceLocale]?.trim() ?? "";
  const hasSourceTitle = sourceTitle.length > 0;
  const hasSourceDescription = sourceDescription.length > 0;

  if (!hasSourceTitle && !hasSourceDescription) {
    return localized;
  }

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;

    try {
      const result = await apiFetch("/api/admin/content/courses/localize-copy", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          ...(hasSourceTitle ? { title: sourceTitle } : {}),
          ...(hasSourceDescription ? { description: sourceDescription } : {}),
          sourceLocale,
          targetLocale,
        }),
      });

      if (hasSourceTitle) {
        localized.title[targetLocale] = result?.title?.trim?.() || (preserveExisting ? localized.title[targetLocale] : "") || sourceTitle;
      }
      if (hasSourceDescription) {
        localized.description[targetLocale] =
          result?.description?.trim?.() || (preserveExisting ? localized.description[targetLocale] : "") || sourceDescription;
      }
    } catch {
      if (hasSourceTitle && !localized.title[targetLocale]) {
        localized.title[targetLocale] = sourceTitle;
      }
      if (hasSourceDescription && !localized.description[targetLocale]) {
        localized.description[targetLocale] = sourceDescription;
      }
    }
  }

  return localized;
}

const CERT_LABELS = { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced" };

function certBadgeLegacy(level) {
  if (!level) return `<span class="cert-badge">—</span>`;
  return `<span class="cert-badge">${CERT_LABELS[level] ?? level}</span>`;
}

// ---------------------------------------------------------------------------
// Route detection
// ---------------------------------------------------------------------------

function certLabel(level) {
  if (!level) return "";
  const key =
    level === "basic"
      ? "adminContent.promptDialog.certificationLevelBasic"
      : level === "intermediate"
        ? "adminContent.promptDialog.certificationLevelIntermediate"
        : level === "advanced"
          ? "adminContent.promptDialog.certificationLevelAdvanced"
          : null;
  return key ? t(key) : localizedText(level) || level;
}

function certBadgeLocalizedTemp(level) {
  if (!level) return `<span class="cert-badge">â€”</span>`;
  return `<span class="cert-badge">${escapeHtml(certLabel(level))}</span>`;
}

function detectRoute() {
  return detectCoursesRoute(window.location.pathname);
}

function certBadge(level) {
  if (!level) return `<span class="cert-badge">-</span>`;
  return `<span class="cert-badge">${escapeHtml(certLabel(level))}</span>`;
}

function canPublishCourse(course) {
  const moduleCount = Number(course?.moduleCount ?? course?.modules?.length ?? 0);
  return !course?.publishedAt && !course?.archivedAt && moduleCount > 0;
}

async function publishCourseInAdmin(courseId, triggerButton = null) {
  if (!courseId) return;
  if (triggerButton) triggerButton.disabled = true;

  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/publish`, getHeaders, {
      method: "POST",
    });
    showToast(t("adminContent.courses.message.published") || "Kurs publisert.", "success");

    const route = detectRoute();
    if (route.view === "list") {
      await renderListView();
    } else {
      await renderDetailView(courseId);
    }
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke publisere kurs.", "error");
    if (triggerButton) triggerButton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// ── LIST VIEW ─────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

async function renderListView() {
  pageContent.innerHTML = `<div class="page-loading">Laster kurs…</div>`;

  let courses;
  try {
    const data = await apiFetch("/api/admin/content/courses", getHeaders);
    courses = data.courses ?? [];
  } catch (err) {
    pageContent.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">Kunne ikke laste kurs.</p>
        <p class="empty-state-text">${escapeHtml(err?.message ?? "")}</p>
      </div>`;
    return;
  }

  if (courses.length === 0) {
    pageContent.innerHTML = `
      <div class="page-header">
        <h1>Kurs</h1>
        <a href="/admin-content/courses/new" class="btn btn-primary">Opprett nytt kurs</a>
      </div>
      <div class="empty-state">
        <p class="empty-state-title">Ingen kurs ennå</p>
        <p class="empty-state-text">Opprett et kurs for å samle moduler i en kursstruktur.</p>
        <a href="/admin-content/courses/new" class="btn btn-primary">Opprett kurs</a>
      </div>`;
    return;
  }

  const rows = deriveCourseListRows(courses, {
    localizeTitle: localizedText,
    formatDate,
  }).map((course) => `<tr>
      <td class="col-title">${escapeHtml(course.title)}</td>
      <td class="col-level">${certBadge(course.certificationLevel)}</td>
      <td class="col-module-count">${course.moduleCount}</td>
      <td class="col-updated">${escapeHtml(course.updatedLabel)}</td>
      <td class="col-actions">
        <div class="row-actions">
          <a href="/admin-content/courses/${encodeURIComponent(course.courseId)}" class="row-action-btn">Rediger</a>
          ${canPublishCourse(course)
            ? `<button class="row-action-btn" data-action="publish" data-course-id="${escapeHtml(course.courseId)}">Publiser</button>`
            : ""}
          <button class="row-action-btn destructive" data-action="delete" data-course-id="${escapeHtml(course.courseId)}" data-course-title="${escapeHtml(course.title)}">Slett</button>
        </div>
      </td>
    </tr>`).join("");

  pageContent.innerHTML = `
    <div class="page-header">
      <h1>Kurs</h1>
      <a href="/admin-content/courses/new" class="btn btn-primary">Opprett nytt kurs</a>
    </div>
    <div class="courses-table-wrap">
      <table class="courses-table" aria-label="Kursliste">
        <thead>
          <tr>
            <th scope="col">Tittel</th>
            <th scope="col">Sertifiseringsnivå</th>
            <th scope="col">Antall moduler</th>
            <th scope="col">Sist endret</th>
            <th scope="col">Handlinger</th>
          </tr>
        </thead>
        <tbody id="coursesTableBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById("coursesTableBody")?.addEventListener("click", handleListTableClick);
}

function handleListTableClick(event) {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "publish") {
    publishCourseInAdmin(btn.dataset.courseId, btn);
    return;
  }
  if (btn.dataset.action === "delete") {
    openDeleteDialog(btn.dataset.courseId, btn.dataset.courseTitle);
  }
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

let pendingDeleteId = null;

function openDeleteDialog(courseId, courseTitle) {
  pendingDeleteId = courseId;
  deleteDialogText.textContent = buildCourseDeleteDialogText(courseTitle);
  deleteDialog.showModal();
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  deleteConfirmBtn.disabled = true;
  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(pendingDeleteId)}`, getHeaders, { method: "DELETE" });
    deleteDialog.close();
    showToast("Kurset ble slettet.", "success");
    await renderListView();
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke slette kurs.", "error");
    deleteConfirmBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// ── DETAIL VIEW ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// ── NEW COURSE — CONVERSATIONAL FLOW ──────────────────────────────────────
// ---------------------------------------------------------------------------

// Conversational state for new-course creation
let convTitle = "";
let convCertLevel = "";
let convModules = []; // { moduleId, title }

async function renderNewCourseConversational() {
  convTitle = "";
  convCertLevel = "";
  convModules = [];

  // Load library modules for the optional module-add step
  try {
    const libData = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
    allLibraryModules = (libData.modules ?? []).filter(m => m.status !== "archived");
  } catch {
    allLibraryModules = [];
  }

  pageContent.innerHTML = `
    <div class="page-header-back">
      <a href="/admin-content/courses" class="back-link">← Tilbake til kursliste</a>
    </div>
    <div class="page-header">
      <h1>Opprett nytt kurs</h1>
    </div>
    <div class="conv-flow" id="convFlow">
      <div class="conv-bot-msg">
        <p>Hva skal kurset hete? Skriv tittelen slik du vil at deltakerne skal se den.</p>
      </div>
      <div class="conv-input-area" id="convTitleArea">
        <input id="convTitleInput" type="text" placeholder="Kurstittel…" autocomplete="off" maxlength="200" />
        <button id="convTitleNext" class="btn btn-primary">Neste</button>
      </div>
      <div class="conv-step" id="convAfterTitle"></div>
    </div>`;

  const titleInput = document.getElementById("convTitleInput");
  const titleNext = document.getElementById("convTitleNext");

  function submitTitle() {
    const val = titleInput?.value.trim() ?? "";
    if (!val) { titleInput?.focus(); return; }
    convTitle = val;
    if (titleInput) titleInput.disabled = true;
    if (titleNext) titleNext.disabled = true;
    appendConvUserBubble(escapeHtml(convTitle));
    showConvCertStep();
  }

  titleNext?.addEventListener("click", submitTitle);
  titleInput?.addEventListener("keydown", e => { if (e.key === "Enter") submitTitle(); });
  titleInput?.focus();
}

function appendConvUserBubble(html) {
  const flow = document.getElementById("convFlow");
  if (!flow) return;
  const bubble = document.createElement("div");
  bubble.className = "conv-user-bubble";
  bubble.innerHTML = html;
  flow.insertBefore(bubble, document.getElementById("convAfterTitle"));
}

function showConvCertStep() {
  const after = document.getElementById("convAfterTitle");
  if (!after) return;

  after.innerHTML = `
    <div class="conv-bot-msg">
      <p>Hvilket sertifiseringsnivå passer for dette kurset?</p>
    </div>
    <div class="conv-choices" id="convCertChoices">
      <button class="conv-choice-btn" data-cert="basic">${escapeHtml(certLabel("basic"))}</button>
      <button class="conv-choice-btn" data-cert="intermediate">${escapeHtml(certLabel("intermediate"))}</button>
      <button class="conv-choice-btn" data-cert="advanced">${escapeHtml(certLabel("advanced"))}</button>
    </div>
    <div class="conv-step" id="convAfterCert"></div>`;

  document.getElementById("convCertChoices")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-cert]");
    if (!btn) return;
    convCertLevel = btn.dataset.cert;
    document.querySelectorAll(".conv-choice-btn").forEach(b => b.disabled = true);
    appendConvCertBubble(btn.textContent.trim());
    showConvModuleSearch();
  });
}

function appendConvCertBubble(label) {
  const certChoices = document.getElementById("convCertChoices");
  if (!certChoices) return;
  const bubble = document.createElement("div");
  bubble.className = "conv-user-bubble";
  bubble.textContent = label;
  certChoices.parentNode.insertBefore(bubble, document.getElementById("convAfterCert"));
}

function showConvModuleSearch() {
  const after = document.getElementById("convAfterCert");
  if (!after) return;

  convModules = [];
  comboboxQuery = "";
  comboboxSelectedId = null;
  comboboxOpen = false;

  after.innerHTML = `
    <div class="conv-bot-msg">
      <p>Søk etter moduler og legg dem til i kurset. Du kan også opprette kurset direkte hvis du vil legge til moduler senere.</p>
    </div>
    <div id="convModuleListContainer"></div>
    <div class="combobox-row" style="margin-bottom:var(--space-2)">
      <div class="combobox-wrap" id="convComboboxWrap">
        <input id="convComboboxInput" type="text" class="combobox-input"
          placeholder="Søk på modulnavn eller modul-ID…"
          autocomplete="off" role="combobox" aria-expanded="false"
          aria-autocomplete="list" aria-controls="convComboboxDropdown" />
        <div id="convComboboxDropdown" class="combobox-dropdown" role="listbox" hidden></div>
      </div>
      <button id="convAddModuleItemBtn" class="btn btn-secondary" disabled>Legg til</button>
    </div>
    <div class="form-actions">
      <button id="convCreateBtn" class="btn btn-primary">Opprett kurs</button>
    </div>
    <div class="conv-step" id="convAfterModules"></div>`;

  renderConvModuleList();
  initConvCombobox();

  document.getElementById("convCreateBtn")?.addEventListener("click", convCreateCourse);
}

function renderConvModuleList() {
  const container = document.getElementById("convModuleListContainer");
  if (!container) return;
  if (convModules.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="module-list" id="convModuleList">
    ${convModules.map((m, i) => `
      <div class="module-list-item" data-module-id="${escapeHtml(m.moduleId)}">
        <span class="module-list-item-order">${i + 1}.</span>
        <span class="module-list-item-title">${escapeHtml(m.title)}</span>
        <div class="module-list-item-actions">
          <button class="module-move-btn" data-move="up" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="Flytt opp">↑</button>
          <button class="module-move-btn" data-move="down" data-index="${i}" ${i === convModules.length - 1 ? "disabled" : ""} aria-label="Flytt ned">↓</button>
          <button class="module-remove-btn" data-remove="${i}" aria-label="Fjern modul">Fjern</button>
        </div>
      </div>`).join("")}
  </div>`;
  document.getElementById("convModuleList")?.addEventListener("click", handleConvModuleListClick);
}

function handleConvModuleListClick(e) {
  const moveBtn = e.target.closest("[data-move]");
  if (moveBtn) {
    const idx = parseInt(moveBtn.dataset.index, 10);
    const swap = moveBtn.dataset.move === "up" ? idx - 1 : idx + 1;
    if (swap >= 0 && swap < convModules.length) {
      [convModules[idx], convModules[swap]] = [convModules[swap], convModules[idx]];
      renderConvModuleList();
    }
    return;
  }
  const removeBtn = e.target.closest("[data-remove]");
  if (removeBtn) {
    convModules.splice(parseInt(removeBtn.dataset.remove, 10), 1);
    renderConvModuleList();
    updateConvComboboxDropdown();
  }
}

function initConvCombobox() {
  const input = document.getElementById("convComboboxInput");
  const addBtn = document.getElementById("convAddModuleItemBtn");

  input?.addEventListener("input", () => {
    comboboxQuery = input.value;
    comboboxSelectedId = null;
    comboboxOpen = comboboxQuery.trim().length > 0;
    if (addBtn) addBtn.disabled = true;
    updateConvComboboxDropdown();
  });
  input?.addEventListener("focus", () => {
    if (comboboxQuery.trim()) { comboboxOpen = true; updateConvComboboxDropdown(); }
  });
  input?.addEventListener("blur", () => {
    setTimeout(() => { comboboxOpen = false; updateConvComboboxDropdown(); }, 150);
  });
  addBtn?.addEventListener("click", addConvSelectedModule);
}

function updateConvComboboxDropdown() {
  const input = document.getElementById("convComboboxInput");
  const dropdown = document.getElementById("convComboboxDropdown");
  const addBtn = document.getElementById("convAddModuleItemBtn");
  if (!input || !dropdown) return;

  const addedIds = new Set(convModules.map(m => m.moduleId));
  const q = comboboxQuery.trim().toLowerCase();
  const options = allLibraryModules.filter(m => {
    if (addedIds.has(m.id)) return false;
    if (!q) return true;
    return (m.title ?? "").toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });

  if (!comboboxOpen || comboboxQuery.trim() === "") {
    dropdown.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  dropdown.hidden = false;
  input.setAttribute("aria-expanded", "true");

  if (options.length === 0) {
    dropdown.innerHTML = `<div class="combobox-empty">Ingen moduler matcher søket.</div>`;
    comboboxSelectedId = null;
    if (addBtn) addBtn.disabled = true;
    return;
  }

  dropdown.innerHTML = options.map(m => `
    <div class="combobox-option${m.id === comboboxSelectedId ? " selected" : ""}"
      role="option" aria-selected="${m.id === comboboxSelectedId}"
      data-module-id="${escapeHtml(m.id)}" data-module-title="${escapeHtml(localizedText(m.title) || m.id)}">
      ${escapeHtml(localizedText(m.title) || m.id)}
      <span class="combobox-option-id">${escapeHtml(m.id)}</span>
    </div>`).join("");

  dropdown.querySelectorAll(".combobox-option").forEach(opt => {
    opt.addEventListener("mousedown", e => {
      e.preventDefault();
      comboboxSelectedId = opt.dataset.moduleId;
      const title = opt.dataset.moduleTitle;
      if (input) input.value = title.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"');
      comboboxOpen = false;
      updateConvComboboxDropdown();
      if (addBtn) addBtn.disabled = false;
    });
  });

  if (addBtn) addBtn.disabled = !comboboxSelectedId;
}

function addConvSelectedModule() {
  if (!comboboxSelectedId) return;
  const mod = allLibraryModules.find(m => m.id === comboboxSelectedId);
  if (!mod) return;
  convModules.push({ moduleId: mod.id, title: localizedText(mod.title) || mod.id });
  comboboxSelectedId = null;
  comboboxQuery = "";
  comboboxOpen = false;
  const input = document.getElementById("convComboboxInput");
  if (input) input.value = "";
  updateConvComboboxDropdown();
  renderConvModuleList();
}

async function convCreateCourse() {
  const createBtn = document.getElementById("convCreateBtn");
  if (createBtn) createBtn.disabled = true;

  const after = document.getElementById("convAfterModules") ?? document.getElementById("convAfterCert");
  if (after) {
    after.innerHTML = `<div class="conv-saving-indicator">Oppretter kurs…</div>`;
  }

  try {
    const sourceLocale = supportedLocales.includes(currentLocale) ? currentLocale : "en-GB";
    const localizedValues = await localizeCourseCopyAcrossLocales({
      titleValues: { [sourceLocale]: convTitle },
      descriptionValues: {},
      sourceLocale,
    });
    const normalizedTitle = normalizeLocalizedRequestValue(localizedValues.title) ?? convTitle;

    const body = await apiFetch("/api/admin/content/courses", getHeaders, {
      method: "POST",
      body: JSON.stringify({
        title: normalizedTitle,
        certificationLevel: convCertLevel,
      }),
    });
    const savedCourseId = body.course?.id;
    if (!savedCourseId) throw new Error("Fikk ikke kurs-ID fra serveren.");

    if (convModules.length > 0) {
      await apiFetch(`/api/admin/content/courses/${encodeURIComponent(savedCourseId)}/modules`, getHeaders, {
        method: "PUT",
        body: JSON.stringify({ modules: convModules.map((m, i) => ({ moduleId: m.moduleId, sortOrder: i })) }),
      });
    }

    showToast("Kurs opprettet.", "success");
    window.location.href = "/admin-content/courses";
  } catch (err) {
    if (after) {
      after.innerHTML = `<div class="error-banner">${escapeHtml(err?.message ?? "Kunne ikke opprette kurs.")}</div>`;
    }
    if (createBtn) createBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------

// Active locale tab for the detail form
let activeDetailLocale = supportedLocales.includes(currentLocale) ? currentLocale : "en-GB";
let initialDetailLocaleValues = cloneCourseLocaleValues();

// Course modules being edited (array of { moduleId, title })
let courseModules = [];

// All available library modules (for the combobox)
let allLibraryModules = [];

// Combobox state
let comboboxQuery = "";
let comboboxSelectedId = null;
let comboboxOpen = false;

async function renderDetailView(courseId) {
  if (!courseId) {
    await renderNewCourseConversational();
    return;
  }

  pageContent.innerHTML = `<div class="page-loading">Laster…</div>`;

  activeDetailLocale = supportedLocales.includes(currentLocale) ? currentLocale : "en-GB";

  let course = null;
  if (courseId) {
    try {
      const data = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}`, getHeaders);
      course = data.course;
    } catch (err) {
      pageContent.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Kunne ikke laste kurs.</p>
          <p class="empty-state-text">${escapeHtml(err?.message ?? "")}</p>
          <a href="/admin-content/courses" class="btn btn-secondary">Tilbake til kursliste</a>
        </div>`;
      return;
    }
  }

  // Load library modules for combobox
  try {
    const libData = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
    allLibraryModules = (libData.modules ?? []).filter(m => m.status !== "archived");
  } catch {
    allLibraryModules = [];
  }

  // Init course modules list
  if (course) {
    courseModules = (course.modules ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(cm => ({ moduleId: cm.moduleId, title: localizedText(cm.moduleTitle) || cm.moduleId }));
  } else {
    courseModules = [];
  }

  // Init locale values from existing course or empty
  const titleValues = parseLocalizedFieldValues(course?.title);
  const descriptionValues = parseLocalizedFieldValues(course?.description);
  const localeValues = {};
  for (const loc of ["en-GB", "nb", "nn"]) {
    localeValues[loc] = {
      title: titleValues[loc] ?? "",
      description: descriptionValues[loc] ?? "",
    };
  }
  initialDetailLocaleValues = cloneCourseLocaleValues({
    title: titleValues,
    description: descriptionValues,
  });

  const certLevel = course?.certificationLevel ?? "";
  const pageTitle = course ? (localizedText(course.title) || "Rediger kurs") : "Opprett nytt kurs";
  const showPublishButton = canPublishCourse({
    ...course,
    moduleCount: courseModules.length,
  });

  pageContent.innerHTML = `
    <div class="page-header-back">
      <a href="/admin-content/courses" class="back-link">← Tilbake til kursliste</a>
    </div>
    <div class="page-header">
      <h1 id="detailPageTitle">${escapeHtml(pageTitle)}</h1>
    </div>
    <div class="detail-layout">

      <div class="detail-section">
        <h2 class="detail-section-title">Kursdetaljer</h2>

        <div class="locale-tabs" role="tablist" aria-label="Rediger per språk" id="localeTabs">
          ${["en-GB", "nb", "nn"].map(loc => `
            <button class="locale-tab-btn${loc === activeDetailLocale ? " active" : ""}"
              role="tab" aria-selected="${loc === activeDetailLocale}"
              data-locale="${loc}" id="tab-${loc}" aria-controls="pane-${loc}">
              ${localeLabels[loc] ?? loc}${loc === "en-GB" ? " *" : ""}
            </button>`).join("")}
        </div>

        ${["en-GB", "nb", "nn"].map(loc => `
          <div class="locale-tab-pane${loc === activeDetailLocale ? " active" : ""}"
            id="pane-${loc}" role="tabpanel" aria-labelledby="tab-${loc}">
            <div class="form-field">
              <label for="title-${loc}">
                Tittel${loc === "en-GB" ? `<span class="required-note">(påkrevd)</span>` : ""}
              </label>
              <input id="title-${loc}" type="text" data-field="title" data-locale="${loc}"
                value="${escapeHtml(localeValues[loc].title)}"
                placeholder="${loc === "en-GB" ? "" : "Bruker en-GB som fallback hvis tomt"}"
                autocomplete="off" />
            </div>
            <div class="form-field">
              <label for="desc-${loc}">Beskrivelse</label>
              <textarea id="desc-${loc}" data-field="description" data-locale="${loc}"
                placeholder="${loc === "en-GB" ? "" : "Bruker en-GB som fallback hvis tomt"}">${escapeHtml(localeValues[loc].description)}</textarea>
            </div>
          </div>`).join("")}

        <div class="form-field" style="margin-top: var(--space-2)">
          <label for="certLevel">Sertifiseringsnivå <span class="required-note">(påkrevd)</span></label>
          <select id="certLevel">
            <option value="">– Velg nivå –</option>
            <option value="basic"${certLevel === "basic" ? " selected" : ""}>${escapeHtml(certLabel("basic"))}</option>
            <option value="intermediate"${certLevel === "intermediate" ? " selected" : ""}>${escapeHtml(certLabel("intermediate"))}</option>
            <option value="advanced"${certLevel === "advanced" ? " selected" : ""}>${escapeHtml(certLabel("advanced"))}</option>
          </select>
        </div>
      </div>

      <div class="detail-section">
        <h2 class="detail-section-title">Moduler i kurset</h2>
        <div id="moduleListContainer"></div>
        <div class="combobox-row" style="margin-top: var(--space-2)">
          <div class="combobox-wrap" id="comboboxWrap">
            <input id="comboboxInput" type="text" class="combobox-input"
              placeholder="Søk på modulnavn eller modul-ID…"
              autocomplete="off" role="combobox" aria-expanded="false"
              aria-autocomplete="list" aria-controls="comboboxDropdown" />
            <div id="comboboxDropdown" class="combobox-dropdown" role="listbox" hidden></div>
          </div>
          <button id="addModuleBtn" class="btn btn-secondary" disabled>Legg til</button>
        </div>
      </div>

      <div id="formErrorBanner" hidden></div>

      <div class="form-actions">
        <button id="saveCourseBtn" class="btn btn-primary">Lagre kurs</button>
        ${showPublishButton ? `<button id="publishCourseBtn" class="btn btn-secondary">Publiser kurs</button>` : ""}
        <a href="/admin-content/courses" class="btn btn-secondary">Avbryt</a>
      </div>

    </div>`;

  renderModuleList();
  initDetailEventListeners(courseId);
}

// ---------------------------------------------------------------------------
// Module list rendering (detail view)
// ---------------------------------------------------------------------------

function renderModuleList() {
  const container = document.getElementById("moduleListContainer");
  if (!container) return;

  if (courseModules.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: var(--space-3) var(--space-2)">
        <p class="empty-state-title" style="font-size: 15px;">Ingen moduler i kurset ennå</p>
        <p class="empty-state-text">Legg til første modul for å bygge kurset.</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="module-list" id="moduleList">
    ${courseModules.map((m, i) => `
      <div class="module-list-item" data-module-id="${escapeHtml(m.moduleId)}">
        <span class="module-list-item-order">${i + 1}.</span>
        <span class="module-list-item-title">${escapeHtml(m.title)}</span>
        <div class="module-list-item-actions">
          <button class="module-move-btn" data-move="up" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="Flytt opp">↑</button>
          <button class="module-move-btn" data-move="down" data-index="${i}" ${i === courseModules.length - 1 ? "disabled" : ""} aria-label="Flytt ned">↓</button>
          <button class="module-remove-btn" data-remove="${i}" aria-label="Fjern modul">Fjern</button>
        </div>
      </div>`).join("")}
  </div>`;

  document.getElementById("moduleList")?.addEventListener("click", handleModuleListClick);
}

function handleModuleListClick(e) {
  const moveBtn = e.target.closest("[data-move]");
  if (moveBtn) {
    const idx = parseInt(moveBtn.dataset.index, 10);
    const dir = moveBtn.dataset.move;
    moveModule(idx, dir);
    return;
  }
  const removeBtn = e.target.closest("[data-remove]");
  if (removeBtn) {
    const idx = parseInt(removeBtn.dataset.remove, 10);
    courseModules.splice(idx, 1);
    renderModuleList();
    updateComboboxDropdown();
  }
}

function moveModule(idx, dir) {
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= courseModules.length) return;
  [courseModules[idx], courseModules[swap]] = [courseModules[swap], courseModules[idx]];
  renderModuleList();
}

// ---------------------------------------------------------------------------
// Searchable combobox
// ---------------------------------------------------------------------------

function getComboboxOptions() {
  const addedIds = new Set(courseModules.map(m => m.moduleId));
  const q = comboboxQuery.trim().toLowerCase();
  return allLibraryModules.filter(m => {
    if (addedIds.has(m.id)) return false;
    if (!q) return true;
    return (m.title ?? "").toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });
}

function updateComboboxDropdown() {
  const input = document.getElementById("comboboxInput");
  const dropdown = document.getElementById("comboboxDropdown");
  const addBtn = document.getElementById("addModuleBtn");
  if (!input || !dropdown) return;

  const options = getComboboxOptions();

  if (!comboboxOpen || comboboxQuery.trim() === "") {
    dropdown.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }

  dropdown.hidden = false;
  input.setAttribute("aria-expanded", "true");

  if (options.length === 0) {
    dropdown.innerHTML = `<div class="combobox-empty">Ingen moduler matcher søket.</div>`;
    comboboxSelectedId = null;
    if (addBtn) addBtn.disabled = true;
    return;
  }

  dropdown.innerHTML = options.map(m => `
    <div class="combobox-option${m.id === comboboxSelectedId ? " selected" : ""}"
      role="option" aria-selected="${m.id === comboboxSelectedId}"
      data-module-id="${escapeHtml(m.id)}" data-module-title="${escapeHtml(localizedText(m.title) || m.id)}">
      ${escapeHtml(localizedText(m.title) || m.id)}
      <span class="combobox-option-id">${escapeHtml(m.id)}</span>
    </div>`).join("");

  dropdown.querySelectorAll(".combobox-option").forEach(opt => {
    opt.addEventListener("mousedown", e => {
      e.preventDefault();
      comboboxSelectedId = opt.dataset.moduleId;
      const title = opt.dataset.moduleTitle;
      const input2 = document.getElementById("comboboxInput");
      if (input2) input2.value = escapeHtml(title).replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"');
      comboboxOpen = false;
      updateComboboxDropdown();
      if (addBtn) addBtn.disabled = false;
    });
  });

  if (addBtn) addBtn.disabled = !comboboxSelectedId;
}

function addSelectedModule() {
  if (!comboboxSelectedId) return;
  const mod = allLibraryModules.find(m => m.id === comboboxSelectedId);
  if (!mod) return;
  courseModules.push({ moduleId: mod.id, title: localizedText(mod.title) || mod.id });
  comboboxSelectedId = null;
  comboboxQuery = "";
  comboboxOpen = false;
  const input = document.getElementById("comboboxInput");
  if (input) input.value = "";
  updateComboboxDropdown();
  renderModuleList();
}

// ---------------------------------------------------------------------------
// Detail event listeners
// ---------------------------------------------------------------------------

function initDetailEventListeners(courseId) {
  // Locale tabs
  document.getElementById("localeTabs")?.addEventListener("click", e => {
    const btn = e.target.closest(".locale-tab-btn");
    if (!btn) return;
    activeDetailLocale = btn.dataset.locale;
    document.querySelectorAll(".locale-tab-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", String(b === btn));
    });
    document.querySelectorAll(".locale-tab-pane").forEach(p => {
      p.classList.toggle("active", p.id === `pane-${activeDetailLocale}`);
    });
  });

  // Combobox
  const comboboxInput = document.getElementById("comboboxInput");
  comboboxInput?.addEventListener("input", () => {
    comboboxQuery = comboboxInput.value;
    comboboxSelectedId = null;
    comboboxOpen = comboboxQuery.trim().length > 0;
    const addBtn = document.getElementById("addModuleBtn");
    if (addBtn) addBtn.disabled = true;
    updateComboboxDropdown();
  });
  comboboxInput?.addEventListener("focus", () => {
    if (comboboxQuery.trim()) {
      comboboxOpen = true;
      updateComboboxDropdown();
    }
  });
  comboboxInput?.addEventListener("blur", () => {
    setTimeout(() => {
      comboboxOpen = false;
      updateComboboxDropdown();
    }, 150);
  });

  document.getElementById("addModuleBtn")?.addEventListener("click", addSelectedModule);

  // Save
  document.getElementById("saveCourseBtn")?.addEventListener("click", () => saveCourse(courseId));
  document.getElementById("publishCourseBtn")?.addEventListener("click", () => publishCourseInAdmin(courseId));
}

// ---------------------------------------------------------------------------
// Save course
// ---------------------------------------------------------------------------

function collectLocaleValues() {
  const title = {};
  const description = {};
  for (const loc of ["en-GB", "nb", "nn"]) {
    const titleEl = document.getElementById(`title-${loc}`);
    const descEl = document.getElementById(`desc-${loc}`);
    const tv = titleEl?.value.trim() ?? "";
    const dv = descEl?.value.trim() ?? "";
    if (tv) title[loc] = tv;
    if (dv) description[loc] = dv;
  }
  return { title, description };
}

function normalizeLocalizedRequestValue(valueMap) {
  const entries = Object.entries(valueMap).filter(([, value]) => typeof value === "string" && value.trim());
  if (entries.length === 0) return undefined;
  if (entries.length === 1 && entries[0][0] === "en-GB") return entries[0][1];
  return Object.fromEntries(entries);
}

function resolveContentAdminDefaults() {
  const defaults = participantRuntimeConfig?.identityDefaults?.contentAdmin;
  if (defaults && typeof defaults === "object") {
    return defaults;
  }
  return participantRuntimeConfig?.identityDefaults ?? {
    userId: "content-owner-1",
    email: "content.owner@company.com",
    name: "Platform Content Owner",
    department: "Learning",
    roles: ["SUBJECT_MATTER_OWNER"],
  };
}

function resolveActiveWorkspaceRoles() {
  if (Array.isArray(activeUserRoles) && activeUserRoles.length > 0) {
    return activeUserRoles;
  }
  const defaults = resolveContentAdminDefaults();
  return Array.isArray(defaults?.roles) && defaults.roles.length > 0 ? defaults.roles : ["SUBJECT_MATTER_OWNER"];
}

async function saveCourse(courseId) {
  const saveBtn = document.getElementById("saveCourseBtn");
  const errorBanner = document.getElementById("formErrorBanner");

  const collectedValues = collectLocaleValues();
  const certLevel = document.getElementById("certLevel")?.value ?? "";
  const sourceLocale = resolveCourseLocalizationSourceLocale(collectedValues, initialDetailLocaleValues);
  const effectiveValues = sourceLocale
    ? await localizeCourseCopyAcrossLocales({
        titleValues: collectedValues.title,
        descriptionValues: collectedValues.description,
        sourceLocale,
        preserveExisting: true,
      })
    : cloneCourseLocaleValues(collectedValues);
  const normalizedTitle = normalizeLocalizedRequestValue(effectiveValues.title);
  const normalizedDescription = normalizeLocalizedRequestValue(effectiveValues.description);

  // Validation
  if (!hasAnyLocalizedValue(effectiveValues.title)) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">Tittel er påkrevd på minst ett språk.</div>`;
      errorBanner.hidden = false;
    }
    document.getElementById(`title-${activeDetailLocale}`)?.focus();
    return;
  }
  if (!certLevel) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">Sertifiseringsnivå er påkrevd.</div>`;
      errorBanner.hidden = false;
    }
    document.getElementById("certLevel")?.focus();
    return;
  }

  if (errorBanner) errorBanner.hidden = true;
  if (saveBtn) saveBtn.disabled = true;
  applyCourseLocaleValuesToForm(effectiveValues);

  try {
    let savedCourseId = courseId;

    if (!courseId) {
      // Create
      const body = await apiFetch("/api/admin/content/courses", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription,
          certificationLevel: certLevel || undefined,
        }),
      });
      savedCourseId = body.course?.id;
      if (!savedCourseId) throw new Error("Fikk ikke kurs-ID.");
    } else {
      // Update
      await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}`, getHeaders, {
        method: "PUT",
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription,
          certificationLevel: certLevel || undefined,
        }),
      });
    }

    // Save module order
    const modules = courseModules.map((m, i) => ({ moduleId: m.moduleId, sortOrder: i }));
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(savedCourseId)}/modules`, getHeaders, {
      method: "PUT",
      body: JSON.stringify({ modules }),
    });

    showToast("Kurs lagret.", "success");
    initialDetailLocaleValues = cloneCourseLocaleValues(effectiveValues);

    // If new, navigate to the saved course URL
    if (!courseId) {
      window.location.href = `/admin-content/courses/${encodeURIComponent(savedCourseId)}`;
    } else {
      await renderDetailView(courseId);
    }
  } catch (err) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">${escapeHtml(err?.message ?? "Kunne ikke lagre kurs.")}</div>`;
      errorBanner.hidden = false;
    }
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Workspace navigation
// ---------------------------------------------------------------------------

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const roles = resolveActiveWorkspaceRoles().join(",");
  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    roles,
    window.location.pathname,
  );
  renderWorkspaceNavigationWithProfile({
    workspaceNav,
    localePicker,
    items,
    buildLabel: (item) => t(item.labelKey) || item.id,
  });
}

function renderContentAreaNav() {
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  const userRoles = new Set(resolveActiveWorkspaceRoles());
  const hasCalibrationRole = [...calibrationRoles].some(r => userRoles.has(r));
  if (navKalibrering) navKalibrering.hidden = !hasCalibrationRole;
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
    if (_headerValues && typeof _headerValues === "object") {
      _headerValues["x-locale"] = currentLocale;
    }
    const route = detectRoute();
    if (route.view === "list") {
      renderListView();
    } else {
      renderDetailView(route.courseId);
    }
  });
}

// ---------------------------------------------------------------------------
// Delete dialog wiring
// ---------------------------------------------------------------------------

function initDeleteDialog() {
  deleteConfirmBtn?.addEventListener("click", confirmDelete);
  deleteCancelBtn?.addEventListener("click", () => {
    deleteDialog.close();
    pendingDeleteId = null;
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    const cfg = await getConsoleConfig();
    participantRuntimeConfig = cfg;
    const defaults = resolveContentAdminDefaults();
    _headerValues = buildConsoleHeaders({
      userId: defaults.userId,
      email: defaults.email,
      name: defaults.name,
      department: defaults.department,
      roles: Array.isArray(defaults.roles) ? defaults.roles.join(",") : defaults.roles,
      locale: currentLocale,
    });
  } catch {
    _headerValues = {};
  }

  try {
    const me = await apiFetch("/api/me", getHeaders);
    activeUserRoles = Array.isArray(me?.user?.roles) ? me.user.roles : [];
  } catch {
    activeUserRoles = [];
  }

  buildLocaleSelector();
  renderWorkspaceNavigation();
  renderContentAreaNav();

  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `Kurs – A2 v${version}`;
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  if (workspaceNav) {
    fetchQueueCounts(getHeaders).then(counts => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});
  }

  initDeleteDialog();

  const route = detectRoute();
  if (route.view === "list") {
    await renderListView();
  } else {
    await renderDetailView(route.courseId);
  }
}

init();
