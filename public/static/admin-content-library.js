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
  resolveRoleSwitchState,
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

const translations = { ...adminContentTranslations[currentLocale], ...adminContentTranslations["en-GB"] };

function t(key) {
  return adminContentTranslations[currentLocale]?.[key] ?? adminContentTranslations["en-GB"]?.[key] ?? key;
}

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
  calibrationWorkspace: { accessRoles: [] },
};

let getHeaders = {};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const workspaceNav = document.getElementById("workspaceNav");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const libraryContent = document.getElementById("libraryContent");
const librarySearch = document.getElementById("librarySearch");
const createModuleBtn = document.getElementById("createModuleBtn");
const createModuleDialog = document.getElementById("createModuleDialog");
const createModuleForm = document.getElementById("createModuleForm");
const newModuleTitle = document.getElementById("newModuleTitle");
const newModuleLevel = document.getElementById("newModuleLevel");
const createModuleError = document.getElementById("createModuleError");
const createOpenConversation = document.getElementById("createOpenConversation");
const createOpenAdvanced = document.getElementById("createOpenAdvanced");
const createCancel = document.getElementById("createCancel");
const coursesPopover = document.getElementById("coursesPopover");
const coursesPopoverList = document.getElementById("coursesPopoverList");
const navKalibrering = document.getElementById("navKalibrering");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allModules = [];
let activeFilter = "all";
let searchQuery = "";
let sortColumn = "title"; // "title" | "updatedAt"
let sortDirection = "asc"; // "asc" | "desc"
let pendingCreateTarget = null; // "conversation" | "advanced"

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  archived: "Arkivert",
  unpublished_draft: "Upublisert utkast",
  published: "Publisert",
  ready: "Klargjort",
};

const CERT_LABELS = {
  basic: "Basic",
  foundation: "Foundation",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

function statusBadge(status) {
  return `<span class="status-badge ${status}">${STATUS_LABELS[status] ?? status}</span>`;
}

function certBadge(level) {
  if (!level) return `<span class="cert-badge">—</span>`;
  const normalized = typeof level === "string" ? level.toLowerCase() : level;
  const label = CERT_LABELS[normalized] ?? CERT_LABELS[level] ?? level;
  return `<span class="cert-badge">${label}</span>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(currentLocale === "en-GB" ? "en-GB" : currentLocale, { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Filter logic
// ---------------------------------------------------------------------------

function applyFilter(modules) {
  let result = modules;
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter(m =>
      (m.title ?? "").toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  }
  if (activeFilter === "active") result = result.filter(m => m.status !== "archived");
  else if (activeFilter === "archived") result = result.filter(m => m.status === "archived");
  else if (activeFilter === "unpublished_draft") result = result.filter(m => m.status === "unpublished_draft");
  else if (activeFilter === "published") result = result.filter(m => m.status === "published");

  result = [...result].sort((a, b) => {
    let cmp = 0;
    if (sortColumn === "title") {
      cmp = (a.title ?? "").localeCompare(b.title ?? "", currentLocale);
    } else if (sortColumn === "updatedAt") {
      cmp = (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
    }
    return sortDirection === "asc" ? cmp : -cmp;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderLibrary() {
  const visible = applyFilter(allModules);

  if (allModules.length === 0) {
    libraryContent.innerHTML = `
      <div class="library-empty">
        <p class="library-empty-title">Ingen moduler ennå</p>
        <p class="library-empty-text">Opprett den første modulen for å komme i gang.</p>
        <button class="btn btn-primary" id="emptyCreateBtn">Opprett ny modul</button>
      </div>`;
    document.getElementById("emptyCreateBtn")?.addEventListener("click", openCreateDialog);
    return;
  }

  if (visible.length === 0) {
    libraryContent.innerHTML = `<div class="library-empty"><p class="library-empty-title">Ingen moduler matcher søket.</p></div>`;
    return;
  }

  const rows = visible.map(m => {
    const openConvUrl = `/admin-content/module/${encodeURIComponent(m.id)}/conversation`;
    const openAdvUrl = `/admin-content/module/${encodeURIComponent(m.id)}/advanced`;
    const isArchived = m.status === "archived";

    const courseCountCell = m.courseCount > 0
      ? `<button class="course-count-btn" data-module-id="${escapeHtml(m.id)}" aria-label="${m.courseCount} kurs">${m.courseCount}</button>`
      : `<span class="course-count-zero">0</span>`;

    const archiveAction = isArchived
      ? `<button class="row-action-btn" data-action="restore" data-module-id="${escapeHtml(m.id)}">Gjenopprett</button>`
      : `<button class="row-action-btn" data-action="archive" data-module-id="${escapeHtml(m.id)}">Arkiver</button>`;

    return `<tr>
      <td class="col-name">${escapeHtml(m.title ?? m.id)}</td>
      <td class="col-level">${certBadge(m.certificationLevel)}</td>
      <td class="col-status">${statusBadge(m.status)}</td>
      <td class="col-courses">${courseCountCell}</td>
      <td class="col-updated">${formatDate(m.updatedAt)}</td>
      <td class="col-actions">
        <div class="row-actions">
          <a href="${openConvUrl}" class="row-action-btn">Åpne i Samtale</a>
          <a href="${openAdvUrl}" class="row-action-btn">Åpne i Avansert</a>
          <button class="row-action-btn" data-action="duplicate" data-module-id="${escapeHtml(m.id)}">Dupliser</button>
          ${archiveAction}
        </div>
      </td>
    </tr>`;
  }).join("");

  const titleDir = sortColumn === "title" ? sortDirection : "none";
  const dateDir = sortColumn === "updatedAt" ? sortDirection : "none";
  const titleIcon = titleDir === "asc" ? "↑" : titleDir === "desc" ? "↓" : "↕";
  const dateIcon = dateDir === "asc" ? "↑" : dateDir === "desc" ? "↓" : "↕";

  libraryContent.innerHTML = `
    <div class="library-table-wrap">
      <table class="library-table" aria-label="Modulbibliotek">
        <thead>
          <tr>
            <th scope="col" class="sortable${titleDir !== "none" ? ` sort-${titleDir}` : ""}" data-sort="title" aria-sort="${titleDir !== "none" ? titleDir + "ending" : "none"}">Modulnavn <i class="sort-indicator" aria-hidden="true">${titleIcon}</i></th>
            <th scope="col">Sertifiseringsnivå</th>
            <th scope="col">Status</th>
            <th scope="col">Brukt i kurs</th>
            <th scope="col" class="sortable${dateDir !== "none" ? ` sort-${dateDir}` : ""}" data-sort="updatedAt" aria-sort="${dateDir !== "none" ? dateDir + "ending" : "none"}">Sist endret <i class="sort-indicator" aria-hidden="true">${dateIcon}</i></th>
            <th scope="col">Handlinger</th>
          </tr>
        </thead>
        <tbody id="libraryTableBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById("libraryTableBody")?.addEventListener("click", handleTableClick);
  document.querySelectorAll(".library-table th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (sortColumn === col) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = col;
        sortDirection = "asc";
      }
      renderLibrary();
    });
  });
}

// ---------------------------------------------------------------------------
// Table click handler
// ---------------------------------------------------------------------------

function handleTableClick(event) {
  const btn = event.target.closest("[data-action], [data-module-id].course-count-btn");
  if (!btn) return;

  const moduleId = btn.dataset.moduleId;
  const action = btn.dataset.action;

  if (btn.classList.contains("course-count-btn")) {
    showCoursesPopover(btn, moduleId);
    return;
  }

  if (action === "archive") archiveModule(moduleId, btn);
  else if (action === "restore") restoreModule(moduleId, btn);
  else if (action === "duplicate") duplicateModule(moduleId, btn);
}

// ---------------------------------------------------------------------------
// Archive / Restore
// ---------------------------------------------------------------------------

async function archiveModule(moduleId, btn) {
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/archive`, getHeaders, { method: "POST" });
    showToast("Modul arkivert.", "success");
    await loadModules();
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke arkivere modul.", "error");
    btn.disabled = false;
  }
}

async function restoreModule(moduleId, btn) {
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/restore`, getHeaders, { method: "POST" });
    showToast("Modul gjenopprettet.", "success");
    await loadModules();
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke gjenopprette modul.", "error");
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

async function duplicateModule(moduleId, btn) {
  btn.disabled = true;
  const original = allModules.find(m => m.id === moduleId);
  const sourceTitle = original?.title ?? "Modul";

  try {
    // Fetch full bundle
    const { moduleExport } = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    const bundle = moduleExport;
    const src = bundle.module;
    const cfg = bundle.selectedConfiguration;

    // Create new module shell
    const titleObj = typeof src.title === "object"
      ? Object.fromEntries(Object.entries(src.title).map(([l, v]) => [l, `${v} (kopi)`]))
      : { "en-GB": `${src.title} (kopi)` };

    const createBody = await apiFetch("/api/admin/content/modules", getHeaders, {
      method: "POST",
      body: JSON.stringify({ title: titleObj, certificationLevel: src.certificationLevel }),
    });
    const newId = createBody.module?.id ?? createBody.id;
    if (!newId) throw new Error("Fikk ikke ID for kopi.");

    // Copy rubric version
    if (cfg?.rubricVersion) {
      await apiFetch(`/api/admin/content/modules/${encodeURIComponent(newId)}/rubric-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({ criteria: cfg.rubricVersion.criteria, scalingRule: cfg.rubricVersion.scalingRule, passRule: cfg.rubricVersion.passRule, active: true }),
      });
    }

    // Copy prompt template version
    if (cfg?.promptTemplateVersion) {
      await apiFetch(`/api/admin/content/modules/${encodeURIComponent(newId)}/prompt-template-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({ systemPrompt: cfg.promptTemplateVersion.systemPrompt, userPromptTemplate: cfg.promptTemplateVersion.userPromptTemplate, examples: cfg.promptTemplateVersion.examples, active: true }),
      });
    }

    showToast(`Kopi av «${sourceTitle}» opprettet.`, "success");
    await loadModules();
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke duplisere modul.", "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Courses popover
// ---------------------------------------------------------------------------

function showCoursesPopover(anchor, moduleId) {
  const module = allModules.find(m => m.id === moduleId);
  if (!module) return;

  coursesPopoverList.innerHTML = (module.courses ?? [])
    .map(c => `<li>${escapeHtml(c.title ?? c.id)}</li>`)
    .join("") || "<li><em>Ingen kurs funnet.</em></li>";

  const rect = anchor.getBoundingClientRect();
  coursesPopover.style.top = `${rect.bottom + window.scrollY + 6}px`;
  coursesPopover.style.left = `${rect.left + window.scrollX}px`;
  coursesPopover.hidden = false;

  const close = (e) => {
    if (!coursesPopover.contains(e.target) && e.target !== anchor) {
      coursesPopover.hidden = true;
      document.removeEventListener("click", close, true);
    }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

// ---------------------------------------------------------------------------
// Create module dialog
// ---------------------------------------------------------------------------

function validateCreateForm() {
  const ok = newModuleTitle.value.trim().length > 0 && newModuleLevel.value !== "";
  createOpenConversation.disabled = !ok;
  createOpenAdvanced.disabled = !ok;
}

function openCreateDialog() {
  newModuleTitle.value = "";
  newModuleLevel.value = "";
  createModuleError.hidden = true;
  createOpenConversation.disabled = true;
  createOpenAdvanced.disabled = true;
  createModuleDialog.showModal();
  newModuleTitle.focus();
}

async function createAndNavigate(target) {
  const title = newModuleTitle.value.trim();
  const level = newModuleLevel.value;
  if (!title || !level) return;

  createOpenConversation.disabled = true;
  createOpenAdvanced.disabled = true;
  createModuleError.hidden = true;

  try {
    const body = await apiFetch("/api/admin/content/modules", getHeaders, {
      method: "POST",
      body: JSON.stringify({ title: { "en-GB": title }, certificationLevel: level }),
    });
    const newId = body.module?.id ?? body.id;
    if (!newId) throw new Error("Fikk ikke modul-ID.");

    createModuleDialog.close();
    if (target === "conversation") {
      window.location.href = `/admin-content/module/${encodeURIComponent(newId)}/conversation`;
    } else {
      window.location.href = `/admin-content/module/${encodeURIComponent(newId)}/advanced`;
    }
  } catch (err) {
    createModuleError.textContent = err?.message ?? "Kunne ikke opprette modul.";
    createModuleError.hidden = false;
    createOpenConversation.disabled = false;
    createOpenAdvanced.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Load modules
// ---------------------------------------------------------------------------

async function loadModules() {
  try {
    const data = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
    allModules = data.modules ?? [];
    renderLibrary();
  } catch (err) {
    libraryContent.innerHTML = `<div class="library-empty"><p class="library-empty-title">Kunne ikke laste moduler.</p><p class="library-empty-text">${escapeHtml(err?.message ?? "")}</p></div>`;
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
// Locale
// ---------------------------------------------------------------------------

function buildLocaleSelector() {
  if (!localeSelect) return;
  localeSelect.innerHTML = supportedLocales
    .map(l => `<option value="${l}"${l === currentLocale ? " selected" : ""}>${localeLabels[l] ?? l}</option>`)
    .join("");
  localeSelect.addEventListener("change", () => {
    currentLocale = localeSelect.value;
    localStorage.setItem("participant.locale", currentLocale);
    loadModules();
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
    document.title = `Moduler – A2 v${version}`;
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  if (workspaceNav) {
    fetchQueueCounts(getHeaders).then(counts => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});
  }

  // Search
  librarySearch?.addEventListener("input", () => {
    searchQuery = librarySearch.value;
    renderLibrary();
  });

  // Filter buttons
  document.querySelectorAll(".library-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll(".library-filter-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderLibrary();
    });
  });

  // Create module
  createModuleBtn?.addEventListener("click", openCreateDialog);
  newModuleTitle?.addEventListener("input", validateCreateForm);
  newModuleLevel?.addEventListener("change", validateCreateForm);
  createOpenConversation?.addEventListener("click", () => createAndNavigate("conversation"));
  createOpenAdvanced?.addEventListener("click", () => createAndNavigate("advanced"));
  createCancel?.addEventListener("click", () => createModuleDialog.close());

  // Close popover on Escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !coursesPopover.hidden) coursesPopover.hidden = true;
  });

  await loadModules();
}

init();
