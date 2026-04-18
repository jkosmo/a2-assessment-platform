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

let getHeaders = {};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const workspaceNav = document.getElementById("workspaceNav");
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
  if (typeof value === "string") return value;
  return value[currentLocale] ?? value["en-GB"] ?? Object.values(value).find(Boolean) ?? "";
}

const CERT_LABELS = { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced" };

function certBadge(level) {
  if (!level) return `<span class="cert-badge">—</span>`;
  return `<span class="cert-badge">${CERT_LABELS[level] ?? level}</span>`;
}

// ---------------------------------------------------------------------------
// Route detection
// ---------------------------------------------------------------------------

function detectRoute() {
  const path = window.location.pathname;
  if (path === "/admin-content/courses/new" || path.endsWith("/courses/new")) {
    return { view: "detail", courseId: null };
  }
  const match = path.match(/\/admin-content\/courses\/([^/]+)$/);
  if (match) {
    return { view: "detail", courseId: match[1] };
  }
  return { view: "list" };
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

  const rows = courses.map(c => {
    const title = localizedText(c.title) || c.id;
    const updatedAt = c.updatedAt ?? c.publishedAt ?? null;
    return `<tr>
      <td class="col-title">${escapeHtml(title)}</td>
      <td class="col-level">${certBadge(c.certificationLevel)}</td>
      <td class="col-module-count">${c.moduleCount ?? 0}</td>
      <td class="col-updated">${formatDate(updatedAt)}</td>
      <td class="col-actions">
        <div class="row-actions">
          <a href="/admin-content/courses/${encodeURIComponent(c.id)}" class="row-action-btn">Rediger</a>
          <button class="row-action-btn destructive" data-action="delete" data-course-id="${escapeHtml(c.id)}" data-course-title="${escapeHtml(title)}">Slett</button>
        </div>
      </td>
    </tr>`;
  }).join("");

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
  const btn = event.target.closest("[data-action='delete']");
  if (!btn) return;
  openDeleteDialog(btn.dataset.courseId, btn.dataset.courseTitle);
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

let pendingDeleteId = null;

function openDeleteDialog(courseId, courseTitle) {
  pendingDeleteId = courseId;
  deleteDialogText.textContent = `Er du sikker på at du vil slette kurset «${courseTitle}»? Modulene forblir i biblioteket uendret.`;
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

// Active locale tab for the detail form
let activeDetailLocale = supportedLocales.includes(currentLocale) ? currentLocale : "en-GB";

// Course modules being edited (array of { moduleId, title })
let courseModules = [];

// All available library modules (for the combobox)
let allLibraryModules = [];

// Combobox state
let comboboxQuery = "";
let comboboxSelectedId = null;
let comboboxOpen = false;

async function renderDetailView(courseId) {
  pageContent.innerHTML = `<div class="page-loading">Laster…</div>`;

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
  const localeValues = {};
  for (const loc of ["en-GB", "nb", "nn"]) {
    localeValues[loc] = {
      title: (typeof course?.title === "object" ? course.title[loc] : loc === "en-GB" ? course?.title : "") ?? "",
      description: (typeof course?.description === "object" ? course.description[loc] : loc === "en-GB" ? course?.description : "") ?? "",
    };
  }

  const certLevel = course?.certificationLevel ?? "";
  const pageTitle = course ? (localizedText(course.title) || "Rediger kurs") : "Opprett nytt kurs";

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
            <option value="basic"${certLevel === "basic" ? " selected" : ""}>Basic</option>
            <option value="intermediate"${certLevel === "intermediate" ? " selected" : ""}>Intermediate</option>
            <option value="advanced"${certLevel === "advanced" ? " selected" : ""}>Advanced</option>
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

async function saveCourse(courseId) {
  const saveBtn = document.getElementById("saveCourseBtn");
  const errorBanner = document.getElementById("formErrorBanner");

  const { title, description } = collectLocaleValues();
  const certLevel = document.getElementById("certLevel")?.value ?? "";

  // Validation
  if (!title["en-GB"]) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">Tittel på engelsk (en-GB) er påkrevd.</div>`;
      errorBanner.hidden = false;
    }
    document.getElementById("title-en-GB")?.focus();
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

  try {
    let savedCourseId = courseId;

    if (!courseId) {
      // Create
      const body = await apiFetch("/api/admin/content/courses", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          title,
          description: Object.keys(description).length > 0 ? description : undefined,
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
          title,
          description: Object.keys(description).length > 0 ? description : undefined,
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

    // If new, navigate to the saved course URL
    if (!courseId) {
      window.location.href = `/admin-content/courses/${encodeURIComponent(savedCourseId)}`;
    } else {
      if (saveBtn) saveBtn.disabled = false;
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
  const roles = participantRuntimeConfig.identityDefaults?.roles?.join(",") ?? "SUBJECT_MATTER_OWNER";
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
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  const userRoles = new Set(participantRuntimeConfig.identityDefaults?.roles ?? []);
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
    getHeaders = buildConsoleHeaders(cfg);
  } catch {
    getHeaders = {};
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
