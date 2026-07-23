import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { showToast } from "/static/toast.js";
import { supportedLocales, localeLabels, translations as adminContentTranslations } from "/static/i18n/admin-content-translations.js";
import { renderOwnerPanel } from "/static/owner-panel.js";

// #645/CL-3: admin UI for classes (cohorts) — list, create, manage members, assign courses.

const pageContent = document.getElementById("pageContent");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const localeSelect = document.getElementById("localeSelect");
const appVersionLabel = document.getElementById("appVersion");

// #705-UX(D): klasser-siden manglet i18n-oppslag, så topp-navet viste råe nøkler (nav.participant …).
let currentLocale = (() => {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) return stored;
  const b = navigator.language?.toLowerCase() ?? "";
  if (b.startsWith("nb")) return "nb";
  if (b.startsWith("nn")) return "nn";
  return "en-GB";
})();
function tNav(key) {
  return adminContentTranslations[currentLocale]?.[key] ?? adminContentTranslations["en-GB"]?.[key] ?? key;
}

let _headerValues = {};
let participantRuntimeConfig = {};
let isAdministrator = false;
let activeUserRoles = [];
function getHeaders() { return _headerValues; }

// Workspace nav items are filtered by the signed-in user's roles. Prefer the live /api/me roles;
// fall back to mock identityDefaults; finally to SUBJECT_MATTER_OWNER so the nav is never empty.
function resolveActiveWorkspaceRoles() {
  if (Array.isArray(activeUserRoles) && activeUserRoles.length > 0) return activeUserRoles;
  const defaults = participantRuntimeConfig?.identityDefaults?.contentAdmin ?? participantRuntimeConfig?.identityDefaults ?? {};
  return Array.isArray(defaults.roles) && defaults.roles.length > 0 ? defaults.roles : ["SUBJECT_MATTER_OWNER"];
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Course titles are stored as localized JSON; pick nb → en-GB → first.
function courseTitle(raw) {
  if (!raw) return "(uten tittel)";
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (obj && typeof obj === "object") return obj.nb || obj["en-GB"] || obj.nn || Object.values(obj)[0] || "(uten tittel)";
    return String(raw);
  } catch {
    return String(raw);
  }
}

// #497: a class-assigned due date (dueAt) is stored as UTC midnight of the picked date; format from the
// date part so the displayed day never shifts by timezone. Returns "DD.MM.YYYY" or null.
function formatDueDate(iso) {
  if (!iso) return null;
  const datePart = String(iso).slice(0, 10); // YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

// #705-family: classes now render Aktive/Arkiverte consistently with the other lifecycle lists.
// Classes are 2-state (aktiv/arkivert) — no draft/publish — so the filter has Aktive/Arkiverte/Alle
// (no "Publiserte"), and status is shown as an "Arkivert"-badge rather than the full 3-state badge.
let classesFilter = "active";
let classesCache = [];

function classTypeLabel(c) {
  if (c.isSystem) return "System";
  if (c.kind === "ENTRA") return "Entra";
  return "Manuell";
}

function filteredClasses() {
  if (classesFilter === "archived") return classesCache.filter((c) => c.archivedAt);
  if (classesFilter === "all") return classesCache;
  return classesCache.filter((c) => !c.archivedAt);
}

function classFilterBar() {
  const pills = [["active", "Aktive"], ["archived", "Arkiverte"], ["all", "Alle"]];
  return `<div class="list-filters" role="group" aria-label="Filtrer klasser">${pills
    .map(([key, label]) => `<button type="button" class="list-filter-btn${classesFilter === key ? " active" : ""}" data-filter="${key}">${escapeHtml(label)}</button>`)
    .join("")}</div>`;
}

function renderClassesTable() {
  const rows = filteredClasses().map((c) => {
    const archived = !!c.archivedAt;
    const systemBadge = c.isSystem ? `<span class="system-badge">System</span>` : "";
    const statusBadge = archived ? ` <span class="status-badge status-badge--archived">Arkivert</span>` : "";
    // #787 slice 5: eier/admin styrer om Administrer/Arkiver-handlingene vises (speiler eierskaps-vakta).
    // Systemklasser er ueide → bare admin forvalter dem, som før.
    const canManage = c.canManage !== false;
    let action = "";
    if (!c.isSystem) {
      action = archived
        ? `<button class="row-action-btn" data-action="restore" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">Gjenopprett</button>`
        : `<button class="row-action-btn destructive" data-action="archive" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">Arkiver</button>`;
    }
    return `
    <tr>
      <td>${escapeHtml(c.name)}${systemBadge}${statusBadge}</td>
      <td>${escapeHtml(classTypeLabel(c))}</td>
      <td>${c._count?.members ?? 0}</td>
      <td>${c._count?.courseAssignments ?? 0}</td>
      <td class="col-actions">
        <div class="row-actions">
          ${canManage
            ? `<button class="row-action-btn" data-action="open" data-id="${escapeHtml(c.id)}">Administrer</button>${action}`
            : `<span class="row-readonly-note" title="Bare en eier eller administrator kan endre denne klassen.">Skrivebeskyttet</span>`}
        </div>
      </td>
    </tr>`;
  }).join("");
  const body = document.getElementById("classesTableBody");
  if (body) body.innerHTML = rows || `<tr><td colspan="5" style="color:var(--color-meta)">Ingen klasser i denne visningen.</td></tr>`;
  document.querySelectorAll(".list-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === classesFilter);
  });
}

async function renderListView() {
  pageContent.innerHTML = `<div class="page-loading">Laster…</div>`;
  try {
    classesCache = (await apiFetch("/api/admin/content/classes", getHeaders)).classes ?? [];
  } catch (err) {
    pageContent.innerHTML = `<p>Kunne ikke laste klasser: ${escapeHtml(err?.message ?? "")}</p>`;
    return;
  }
  pageContent.innerHTML = `
    <div class="page-header"><h1>Klasser</h1><div style="display:flex;gap:8px">${isAdministrator ? `<button id="importUsersBtn" class="btn btn-secondary" style="width:auto" title="Importer brukere fra en JSON-fil eksportert fra Entra (delta-synk)">Importer brukere fra fil</button><input type="file" id="importUsersFile" accept="application/json,.json" style="display:none"><button id="syncEntraBtn" class="btn btn-secondary" style="width:auto" title="Importer brukere fra «Alle i A-2 Norge» i Entra (krever Graph-tilgang)">Synk brukere fra Entra</button>` : ""}<button id="newClassBtn" class="btn btn-primary" style="width:auto">+ Ny klasse</button></div></div>
    <p style="color:var(--color-meta);font-size:13px">En klasse er en gruppe deltakere du kan tildele kurs til samlet. «Alle deltakere» er en systemklasse (alle med deltakerrolle).</p>
    ${classFilterBar()}
    <table class="classes-table">
      <thead><tr><th>Navn</th><th>Type</th><th>Medlemmer</th><th>Tildelte kurs</th><th></th></tr></thead>
      <tbody id="classesTableBody"></tbody>
    </table>`;
  renderClassesTable();
  document.getElementById("newClassBtn").addEventListener("click", createClassFlow);
  document.getElementById("syncEntraBtn")?.addEventListener("click", syncEntraUsers);
  const importBtn = document.getElementById("importUsersBtn");
  const importFile = document.getElementById("importUsersFile");
  importBtn?.addEventListener("click", () => importFile?.click());
  importFile?.addEventListener("change", () => importUsersFromFile(importFile));
  pageContent.querySelector(".list-filters")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    classesFilter = btn.dataset.filter;
    renderClassesTable();
  });
  document.getElementById("classesTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "open") openClass(btn.dataset.id);
    if (btn.dataset.action === "archive") archiveClass(btn.dataset.id, btn.dataset.name);
    if (btn.dataset.action === "restore") restoreClassInAdmin(btn.dataset.id, btn.dataset.name);
  });
}

// #690: import users from the configured Entra group ("Alle i A-2 Norge") so they are searchable
// for class membership before their first login. ADMINISTRATOR only.
async function syncEntraUsers() {
  const btn = document.getElementById("syncEntraBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Synker…"; }
  try {
    const res = await apiFetch("/api/admin/sync/org/entra", getHeaders, { method: "POST" });
    const imported = res?.importedUsers ?? res?.run?.createdCount ?? 0;
    showToast(`Synk fullført — ${imported} brukere importert/oppdatert.`, "success");
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke synke brukere fra Entra.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Synk brukere fra Entra"; }
  }
}

// #690 fallback: when the managed identity lacks Graph permission (admin consent pending), an
// ADMINISTRATOR can still seed users with their own delegated access — export the group members
// (e.g. `az ad group member list`) to a JSON file shaped `{ source, users: [{externalId,email,name}] }`
// and import it here. Routes through the same admin-only delta endpoint as the automatic sync.
async function importUsersFromFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const btn = document.getElementById("importUsersBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Importerer…"; }
  try {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Fila er ikke gyldig JSON.");
    }
    const users = Array.isArray(payload) ? payload : payload?.users;
    if (!Array.isArray(users) || users.length === 0) {
      throw new Error('Fila må inneholde et "users"-array med minst én bruker.');
    }
    const body = { source: typeof payload?.source === "string" && payload.source.trim() ? payload.source.trim() : "manual_file_import", users };
    const res = await apiFetch("/api/admin/sync/org/delta", getHeaders, { method: "POST", body: JSON.stringify(body) });
    const run = res?.run ?? {};
    const created = run.createdCount ?? 0;
    const updated = run.updatedCount ?? 0;
    const failed = run.failedCount ?? 0;
    showToast(`Import fullført — ${created} opprettet, ${updated} oppdatert${failed ? `, ${failed} feilet` : ""}.`, failed ? "error" : "success");
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke importere brukere.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Importer brukere fra fil"; }
    input.value = ""; // allow re-selecting the same file
  }
}

async function createClassFlow() {
  const name = window.prompt("Navn på klassen:");
  if (!name || !name.trim()) return;
  try {
    await apiFetch("/api/admin/content/classes", getHeaders, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    showToast("Klasse opprettet.", "success");
    await renderListView();
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke opprette klasse.", "error");
  }
}

async function archiveClass(id, name) {
  if (!window.confirm(`Arkivere klassen «${name}»?`)) return;
  try {
    await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}`, getHeaders, { method: "DELETE" });
    showToast("Klasse arkivert.", "success");
    await renderListView();
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke arkivere.", "error");
  }
}

// #705-family: reverse of archiveClass — restore an archived class so it is active again.
async function restoreClassInAdmin(id, name) {
  if (!window.confirm(`Gjenopprette klassen «${name}»?`)) return;
  try {
    await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/restore`, getHeaders, { method: "POST" });
    showToast("Klasse gjenopprettet.", "success");
    await renderListView();
  } catch (err) {
    showToast(err?.message ?? "Kunne ikke gjenopprette.", "error");
  }
}

async function openClass(id) {
  pageContent.innerHTML = `<div class="page-loading">Laster…</div>`;
  let members = [], courses = [], allCourses = [];
  try {
    [members, courses, allCourses] = await Promise.all([
      apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/members`, getHeaders).then((r) => r.members ?? []),
      apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/courses`, getHeaders).then((r) => r.courses ?? []),
      apiFetch("/api/admin/content/courses", getHeaders).then((r) => r.courses ?? []),
    ]);
  } catch (err) {
    pageContent.innerHTML = `<p>Kunne ikke laste klassen: ${escapeHtml(err?.message ?? "")}</p>`;
    return;
  }
  // QA r6 #3: rows instead of grey chips — same visual language as the owner rows (name + meta,
  // separator line, slim «Fjern» on the right).
  const memberRows = members.map((m) => `<li class="assign-row">
      <span class="assign-name">${escapeHtml(m.name)}</span>
      ${m.email ? `<span class="assign-meta">${escapeHtml(m.email)}</span>` : ""}
      <button type="button" class="assign-remove btn-secondary" data-remove-member="${escapeHtml(m.userId)}" aria-label="Fjern ${escapeHtml(m.name)}">Fjern</button>
    </li>`).join("");
  const courseRows = courses.map((c) => {
    const due = formatDueDate(c.dueAt);
    return `<li class="assign-row">
      <span class="assign-name">${escapeHtml(courseTitle(c.title))}</span>
      <span class="assign-meta">${due ? `Frist: ${escapeHtml(due)}` : "Ingen frist"}</span>
      <button type="button" class="assign-remove btn-secondary" data-remove-course="${escapeHtml(c.courseId)}" aria-label="Fjern kurs">Fjern</button>
    </li>`;
  }).join("");
  const assignedIds = new Set(courses.map((c) => c.courseId));
  // #688: don't offer archived courses for assignment — they are retired and shouldn't be assigned.
  const courseOptions = allCourses.filter((c) => !assignedIds.has(c.id) && !c.archivedAt).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(courseTitle(c.title))}</option>`).join("");
  pageContent.innerHTML = `
    <a class="back-link" id="backToClasses">← Tilbake til klasser</a>
    <div class="page-header"><h1>Klasse</h1></div>
    <div class="detail-section" id="classOwnerPanelHost"></div>
    <div class="detail-section">
      <h2>Studenter (${members.length})</h2>
      <ul class="assign-list" id="memberChips">${memberRows || `<li class="assign-empty">Ingen studenter ennå.</li>`}</ul>
      <div class="inline-form">
        <input type="text" id="studentSearch" placeholder="Søk navn eller e-post (min. 2 tegn)" autocomplete="off" style="min-width:280px" />
      </div>
      <ul class="search-results" id="searchResults"></ul>
    </div>
    <div class="detail-section">
      <h2>Tildelte kurs (${courses.length})</h2>
      <ul class="assign-list" id="courseChips">${courseRows || `<li class="assign-empty">Ingen kurs tildelt ennå.</li>`}</ul>
      <div class="inline-form">
        <select id="courseSelect"><option value="">Velg kurs…</option>${courseOptions}</select>
        <label for="dueAtInput" style="font-size:13px;color:var(--color-meta);display:inline-flex;align-items:center;gap:6px">
          Frist (valgfri)
          <input type="date" id="dueAtInput" title="Frist for å fullføre kurset (valgfri)" />
        </label>
        <button id="assignCourseBtn" class="btn btn-secondary" style="width:auto">Tildel kurs</button>
      </div>
      <p style="font-size:12px;color:var(--color-meta);margin:6px 0 0">Fristen brukes til automatiske påminnelser til deltakerne (frist nærmer seg / forfalt).</p>
    </div>`;
  document.getElementById("backToClasses").addEventListener("click", renderListView);

  // #787: content-owner management for the class.
  const ownerHost = document.getElementById("classOwnerPanelHost");
  if (ownerHost) renderOwnerPanel({ container: ownerHost, contentType: "CLASS", contentId: id, getHeaders }).catch(() => {});

  // Member add via search.
  const searchInput = document.getElementById("studentSearch");
  const resultsEl = document.getElementById("searchResults");
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ""; return; }
    searchTimer = setTimeout(async () => {
      try {
        const users = (await apiFetch(`/api/admin/content/users/search?q=${encodeURIComponent(q)}`, getHeaders)).users ?? [];
        resultsEl.innerHTML = users.map((u) => `<li data-add-user="${escapeHtml(u.id)}">${escapeHtml(u.name)} <span style="color:var(--color-meta)">${escapeHtml(u.email)}</span></li>`).join("");
      } catch { /* ignore */ }
    }, 250);
  });
  resultsEl.addEventListener("click", async (e) => {
    const li = e.target.closest("[data-add-user]");
    if (!li) return;
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/members`, getHeaders, { method: "POST", body: JSON.stringify({ userId: li.dataset.addUser }) });
      showToast("Student lagt til.", "success");
      openClass(id);
    } catch (err) { showToast(err?.message ?? "Kunne ikke legge til.", "error"); }
  });
  document.getElementById("memberChips").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove-member]");
    if (!btn) return;
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/members/${encodeURIComponent(btn.dataset.removeMember)}`, getHeaders, { method: "DELETE" });
      openClass(id);
    } catch (err) { showToast(err?.message ?? "Feil", "error"); }
  });

  // Course assignment.
  document.getElementById("assignCourseBtn").addEventListener("click", async () => {
    const courseId = document.getElementById("courseSelect").value;
    if (!courseId) return;
    const due = document.getElementById("dueAtInput").value;
    const body = { courseId };
    if (due) body.dueAt = new Date(due + "T00:00:00.000Z").toISOString();
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/courses`, getHeaders, { method: "POST", body: JSON.stringify(body) });
      showToast("Kurs tildelt.", "success");
      openClass(id);
    } catch (err) { showToast(err?.message ?? "Kunne ikke tildele.", "error"); }
  });
  document.getElementById("courseChips").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove-course]");
    if (!btn) return;
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/courses/${encodeURIComponent(btn.dataset.removeCourse)}`, getHeaders, { method: "DELETE" });
      openClass(id);
    } catch (err) { showToast(err?.message ?? "Feil", "error"); }
  });
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  // resolveWorkspaceNavigationItems(navItems, rolesCsv, currentPath) — previously the whole config
  // object was passed as navItems, so it sanitized to [] and the top nav never rendered.
  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    resolveActiveWorkspaceRoles().join(","),
    window.location.pathname,
  );
  // #705-UX(D): resolver via tNav slik at etikettene oversettes i stedet for å vise råe nøkler.
  renderWorkspaceNavigationWithProfile({ workspaceNav, localePicker, items, buildLabel: (item) => tNav(item.labelKey) || item.id });
}

function buildLocaleSelector() {
  if (!localeSelect) return;
  localeSelect.innerHTML = supportedLocales.map((l) => `<option value="${l}"${l === currentLocale ? " selected" : ""}>${localeLabels[l] ?? l}</option>`).join("");
  localeSelect.addEventListener("change", () => {
    currentLocale = localeSelect.value;
    localStorage.setItem("participant.locale", currentLocale);
    renderWorkspaceNavigation();
    renderListView();
  });
}

async function init() {
  try {
    const cfg = await getConsoleConfig();
    participantRuntimeConfig = cfg;
    const defaults = cfg?.identityDefaults?.contentAdmin ?? cfg?.identityDefaults ?? {};
    _headerValues = buildConsoleHeaders({
      userId: defaults.userId,
      email: defaults.email,
      name: defaults.name,
      roles: Array.isArray(defaults.roles) ? defaults.roles.join(",") : defaults.roles,
    });
    // Admin gating must use the *live* signed-in user's roles. identityDefaults is only populated
    // in mock-role mode (undefined in prod/Entra — see participantConsole.ts), so reading roles
    // from it hides admin controls for real admins in prod. /api/me returns the token's roles.
    try {
      const me = await apiFetch("/api/me", getHeaders);
      activeUserRoles = Array.isArray(me?.user?.roles) ? me.user.roles : [];
      isAdministrator = activeUserRoles.includes("ADMINISTRATOR") ||
        (Array.isArray(defaults.roles) && defaults.roles.includes("ADMINISTRATOR"));
    } catch {
      isAdministrator = Array.isArray(defaults.roles) && defaults.roles.includes("ADMINISTRATOR");
    }
  } catch {
    _headerValues = {};
  }
  buildLocaleSelector();
  renderWorkspaceNavigation();
  // #765: the sub-navigation bar (Klasser | Manuell behandling | Resultater) is rendered/gated by
  // deltakere-subnav.js; the old admin-content content-area nav no longer lives on this page.
  await initConsentGuard(getHeaders, currentLocale);
  try {
    const body = await apiFetch("/version", { headers: {} });
    if (appVersionLabel) appVersionLabel.textContent = `v${body.version ?? "unknown"}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }
  await renderListView();
}

init();
