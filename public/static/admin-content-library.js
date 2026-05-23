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
const libraryContent = document.getElementById("libraryContent");
const librarySearch = document.getElementById("librarySearch");
const createModuleBtn = document.getElementById("createModuleBtn");
const createModuleDialog = document.getElementById("createModuleDialog");
const createModuleForm = document.getElementById("createModuleForm");
const newModuleTitle = document.getElementById("newModuleTitle");
const newModuleLevel = document.getElementById("newModuleLevel");
const createModuleError = document.getElementById("createModuleError");
const createOpenConversation = document.getElementById("createOpenConversation");
// v1.2.12 (#348): createOpenAdvanced fjernet fra dialogen — én create-path.
const createCancel = document.getElementById("createCancel");
const coursesPopover = document.getElementById("coursesPopover");
const coursesPopoverList = document.getElementById("coursesPopoverList");
const navKalibrering = document.getElementById("navKalibrering");
// v1.2.11: Rydd uplubliserte (kun ADMINISTRATOR).
const purgeUnpublishedBtn = document.getElementById("purgeUnpublishedBtn");
const purgeUnpublishedDialog = document.getElementById("purgeUnpublishedDialog");
const purgePreviewLoading = document.getElementById("purgePreviewLoading");
const purgePreviewBody = document.getElementById("purgePreviewBody");
const purgeDeleteCount = document.getElementById("purgeDeleteCount");
const purgeDeleteList = document.getElementById("purgeDeleteList");
const purgeSkipCount = document.getElementById("purgeSkipCount");
const purgeSkipList = document.getElementById("purgeSkipList");
const purgeSkipDetails = document.getElementById("purgeSkipDetails");
const purgeConfirmInput = document.getElementById("purgeConfirmInput");
const purgeConfirmBtn = document.getElementById("purgeConfirmBtn");
const purgeCancelBtn = document.getElementById("purgeCancelBtn");
const purgeError = document.getElementById("purgeError");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allModules = [];
// Default filter is "active" so authors land on a curated list of currently relevant
// modules. Arkiverte/older versions er fortsatt tilgjengelig via filter-knappene.
let activeFilter = "active";
let searchQuery = "";
let sortColumn = "title"; // "title" | "updatedAt"
let sortDirection = "asc"; // "asc" | "desc"
// v1.2.12 (#348): pendingCreateTarget fjernet — én create-path, alltid Samtale.

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
  return `<span class="status-badge ${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>`;
}

function certBadge(level) {
  if (!level) return `<span class="cert-badge">—</span>`;
  const normalized = typeof level === "string" ? level.toLowerCase() : level;
  const label = CERT_LABELS[normalized] ?? CERT_LABELS[level] ?? level;
  return `<span class="cert-badge">${escapeHtml(label)}</span>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(currentLocale === "en-GB" ? "en-GB" : currentLocale, { day: "numeric", month: "short", year: "numeric" });
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
          <button class="row-action-btn" data-action="export" data-module-id="${escapeHtml(m.id)}" data-module-title="${escapeHtml(m.title ?? m.id)}">Eksporter</button>
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
  else if (action === "export") exportModulePackage(moduleId, btn.dataset.moduleTitle ?? moduleId, btn);
}

// #433 — per-row module export. Calls the versioned /export-package endpoint
// and downloads the envelope as JSON. Mirrors the course-list "Eksporter"
// behavior so authors have a consistent surface for both module + course
// portability without having to enter the advanced editor.
async function exportModulePackage(moduleId, moduleTitle, btn) {
  btn.disabled = true;
  try {
    const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export-package`, getHeaders);
    const envelope = body?.envelope ?? null;
    if (!envelope) throw new Error("Eksport returnerte tom envelope.");
    const safeTitle = String(moduleTitle ?? "module").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "module";
    const filename = `module-${safeTitle}-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Modul «${moduleTitle}» er eksportert.`);
  } catch (err) {
    const msg = err?.message ?? "Kunne ikke eksportere modul.";
    showToast(`Modul-eksport feilet: ${msg}`, "error");
  } finally {
    btn.disabled = false;
  }
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

// v1.2.12 (#348): "Dupliser" gjør nå full strukturell kopi via export → import-pipelinen.
// Tidligere versjon kopierte kun rubric + promptTemplate, og lot taskText/MCQ/scenario
// være tomt — det matchet ikke det brukerne forventer av "Dupliser". Pipelinen gjør samme
// jobb som "Eksporter (.json) → Importer modul-pakke (.json)"-paret, bare bundlet i ett
// klikk uten å gå via filsystemet.
async function duplicateModule(moduleId, btn) {
  btn.disabled = true;
  const original = allModules.find(m => m.id === moduleId);
  const sourceTitle = original?.title ?? "Modul";

  try {
    const exportResult = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    const envelope = exportResult?.moduleExport ?? exportResult;
    if (!envelope || !envelope.module) {
      throw new Error("Tom eksport-konvolutt fra server.");
    }

    // Suffiks " (kopi)" på tittelen i alle locales så listen viser kopien tydelig.
    const srcTitle = envelope.module?.module?.title;
    if (srcTitle && typeof srcTitle === "object") {
      envelope.module.module.title = Object.fromEntries(
        Object.entries(srcTitle).map(([l, v]) => [l, v ? `${v} (kopi)` : v])
      );
    } else if (typeof srcTitle === "string" && srcTitle) {
      envelope.module.module.title = `${srcTitle} (kopi)`;
    }

    const importResult = await apiFetch("/api/admin/content/modules/import", getHeaders, {
      method: "POST",
      body: JSON.stringify({ payload: envelope, mode: "createNew" }),
    });
    if (!importResult?.moduleId) throw new Error("Import-respons mangler moduleId.");

    showToast(`Full kopi av «${sourceTitle}» opprettet.`, "success");
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
}

function openCreateDialog() {
  newModuleTitle.value = "";
  newModuleLevel.value = "";
  createModuleError.hidden = true;
  createOpenConversation.disabled = true;
  createModuleDialog.showModal();
  newModuleTitle.focus();
}

// v1.2.11: åpne purge-dialog, hent kandidat-preview fra backend og render lister.
async function openPurgeDialog() {
  if (!purgeUnpublishedDialog) return;
  purgePreviewLoading.hidden = false;
  purgePreviewBody.hidden = true;
  purgeError.hidden = true;
  purgeConfirmInput.value = "";
  purgeConfirmBtn.disabled = true;
  purgeUnpublishedDialog.showModal();
  try {
    const result = await apiFetch("/api/admin/content/modules/purge-unpublished/preview", getHeaders);
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    const toDelete = candidates.filter((c) => !c.reasonSkipped);
    const toSkip = candidates.filter((c) => c.reasonSkipped);

    purgeDeleteCount.textContent = String(toDelete.length);
    purgeDeleteList.innerHTML = toDelete.length === 0
      ? `<li style="color:#666">Ingen kandidater — alt er enten publisert, arkivert, i bruk, eller har submissions.</li>`
      : toDelete.map((c) => `<li>${escapeHtml(c.title || c.id)}</li>`).join("");

    purgeSkipCount.textContent = String(toSkip.length);
    purgeSkipList.innerHTML = toSkip.map((c) =>
      `<li>${escapeHtml(c.title || c.id)} — ${escapeHtml(c.reasonSkipped)}</li>`
    ).join("");
    purgeSkipDetails.hidden = toSkip.length === 0;

    purgePreviewLoading.hidden = true;
    purgePreviewBody.hidden = false;
    // Hvis ingenting å slette, ikke aktiver bekreftelses-input.
    if (toDelete.length === 0) {
      purgeConfirmInput.disabled = true;
      purgeConfirmInput.placeholder = "Ingenting å slette";
    } else {
      purgeConfirmInput.disabled = false;
      purgeConfirmInput.placeholder = "";
      purgeConfirmInput.focus();
    }
  } catch (error) {
    purgePreviewLoading.hidden = true;
    purgeError.hidden = false;
    purgeError.textContent = `Klarte ikke hente forhåndsvisning: ${error instanceof Error ? error.message : "ukjent feil"}`;
  }
}

async function runPurge() {
  purgeError.hidden = true;
  purgeConfirmBtn.disabled = true;
  const originalLabel = purgeConfirmBtn.textContent;
  purgeConfirmBtn.textContent = "Sletter…";
  try {
    const result = await apiFetch("/api/admin/content/modules/purge-unpublished", getHeaders, {
      method: "POST",
      body: JSON.stringify({ confirmation: "SLETT" }),
    });
    const deleted = Array.isArray(result?.deleted) ? result.deleted.length : 0;
    const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
    purgeUnpublishedDialog.close();
    if (failed > 0) {
      showToast(`Slettet ${deleted}, ${failed} feilet. Sjekk audit-loggen.`, "error");
    } else {
      showToast(`Slettet ${deleted} uplubliserte moduler.`);
    }
    await loadModules();
  } catch (error) {
    purgeError.hidden = false;
    purgeError.textContent = `Sletting feilet: ${error instanceof Error ? error.message : "ukjent feil"}`;
    purgeConfirmBtn.disabled = false;
  } finally {
    purgeConfirmBtn.textContent = originalLabel;
  }
}

// v1.2.12 (#348): én create-path — opprett modul og åpne i Samtale (anbefalt vei per
// pilot-funn). Bruker kan bytte til Avansert via rad-handlingen "Åpne i Avansert" etterpå.
async function createAndNavigate() {
  const title = newModuleTitle.value.trim();
  const level = newModuleLevel.value;
  if (!title || !level) return;

  createOpenConversation.disabled = true;
  createModuleError.hidden = true;

  try {
    const body = await apiFetch("/api/admin/content/modules", getHeaders, {
      method: "POST",
      body: JSON.stringify({ title, certificationLevel: level }),
    });
    const newId = body.module?.id ?? body.id;
    if (!newId) throw new Error("Fikk ikke modul-ID.");

    createModuleDialog.close();
    window.location.href = `/admin-content/module/${encodeURIComponent(newId)}/conversation`;
  } catch (err) {
    createModuleError.textContent = err?.message ?? "Kunne ikke opprette modul.";
    createModuleError.hidden = false;
    createOpenConversation.disabled = false;
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
    if (_headerValues && typeof _headerValues === "object") {
      _headerValues["x-locale"] = currentLocale;
    }
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

  // Localize cert level select options
  if (newModuleLevel) {
    const optMap = {
      basic: t("adminContent.promptDialog.certificationLevelBasic"),
      intermediate: t("adminContent.promptDialog.certificationLevelIntermediate"),
      advanced: t("adminContent.promptDialog.certificationLevelAdvanced"),
    };
    newModuleLevel.querySelectorAll("option[value]").forEach(opt => {
      if (optMap[opt.value]) opt.textContent = optMap[opt.value];
    });
  }

  // Create module
  createModuleBtn?.addEventListener("click", openCreateDialog);

  // v1.2.11: Rydd uplubliserte — kun ADMINISTRATOR ser knappen.
  if (purgeUnpublishedBtn) {
    const isAdmin = resolveActiveWorkspaceRoles().includes("ADMINISTRATOR");
    purgeUnpublishedBtn.hidden = !isAdmin;
    purgeUnpublishedBtn.addEventListener("click", openPurgeDialog);
  }
  purgeCancelBtn?.addEventListener("click", () => purgeUnpublishedDialog?.close());
  purgeConfirmInput?.addEventListener("input", () => {
    purgeConfirmBtn.disabled = purgeConfirmInput.value.trim() !== "SLETT";
  });
  purgeConfirmBtn?.addEventListener("click", runPurge);

  // Import module package (#433). The visible button triggers a hidden file
  // input; on file pick: parse JSON, POST envelope to /modules/import,
  // navigate to the freshly-created module's advanced view. Using <button>
  // (not <label>) so .btn styling applies cleanly.
  const importModulePackageBtn = document.getElementById("importModulePackageBtn");
  const importModulePackageFile = document.getElementById("importModulePackageFile");
  importModulePackageBtn?.addEventListener("click", () => {
    importModulePackageFile?.click();
  });
  importModulePackageFile?.addEventListener("change", async (event) => {
    const target = event.target;
    const file = target?.files?.[0] ?? null;
    if (!file) return;
    try {
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (parseError) {
        throw new Error(`Filen er ikke gyldig JSON: ${parseError instanceof Error ? parseError.message : "ukjent feil"}`);
      }
      const result = await apiFetch("/api/admin/content/modules/import", getHeaders, {
        method: "POST",
        body: JSON.stringify({ payload, mode: "createNew" }),
      });
      if (!result?.moduleId) throw new Error("Import-respons mangler moduleId.");
      showToast("Modul-pakken er importert.");
      window.location.href = `/admin-content/module/${encodeURIComponent(result.moduleId)}/advanced`;
    } catch (error) {
      showToast(`Modul-import feilet: ${error instanceof Error ? error.message : "ukjent feil"}`, "error");
    } finally {
      target.value = "";
    }
  });
  newModuleTitle?.addEventListener("input", validateCreateForm);
  newModuleLevel?.addEventListener("change", validateCreateForm);
  createOpenConversation?.addEventListener("click", () => createAndNavigate());
  createCancel?.addEventListener("click", () => createModuleDialog.close());

  // Close popover on Escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !coursesPopover.hidden) coursesPopover.hidden = true;
  });

  await loadModules();
}

init();
