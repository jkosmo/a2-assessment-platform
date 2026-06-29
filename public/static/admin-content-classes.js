import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { showToast } from "/static/toast.js";
import { supportedLocales, localeLabels, translations as adminContentTranslations } from "/static/i18n/admin-content-translations.js";

// #645/CL-3: admin UI for classes (cohorts) — list, create, manage members, assign courses.

const pageContent = document.getElementById("pageContent");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const localeSelect = document.getElementById("localeSelect");
const navKalibrering = document.getElementById("navKalibrering");
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

async function renderListView() {
  pageContent.innerHTML = `<div class="page-loading">Laster…</div>`;
  let classes = [];
  try {
    classes = (await apiFetch("/api/admin/content/classes", getHeaders)).classes ?? [];
  } catch (err) {
    pageContent.innerHTML = `<p>Kunne ikke laste klasser: ${escapeHtml(err?.message ?? "")}</p>`;
    return;
  }
  const rows = classes.map((c) => `
    <tr>
      <td>${escapeHtml(c.name)}${c.isSystem ? `<span class="system-badge">System</span>` : ""}</td>
      <td>${c._count?.members ?? 0}</td>
      <td>${c._count?.courseAssignments ?? 0}</td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="row-action-btn" data-action="open" data-id="${escapeHtml(c.id)}">Administrer</button>
          ${c.isSystem ? "" : `<button class="row-action-btn destructive" data-action="archive" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">Arkiver</button>`}
        </div>
      </td>
    </tr>`).join("");
  pageContent.innerHTML = `
    <div class="page-header"><h1>Klasser</h1><div style="display:flex;gap:8px">${isAdministrator ? `<button id="importUsersBtn" class="btn btn-secondary" style="width:auto" title="Importer brukere fra en JSON-fil eksportert fra Entra (delta-synk)">Importer brukere fra fil</button><input type="file" id="importUsersFile" accept="application/json,.json" style="display:none"><button id="syncEntraBtn" class="btn btn-secondary" style="width:auto" title="Importer brukere fra «Alle i A-2 Norge» i Entra (krever Graph-tilgang)">Synk brukere fra Entra</button>` : ""}<button id="newClassBtn" class="btn btn-primary" style="width:auto">+ Ny klasse</button></div></div>
    <p style="color:var(--color-meta);font-size:13px">En klasse er en gruppe deltakere du kan tildele kurs til samlet. «Alle deltakere» er en systemklasse (alle med deltakerrolle).</p>
    <table class="classes-table">
      <thead><tr><th>Navn</th><th>Medlemmer</th><th>Tildelte kurs</th><th></th></tr></thead>
      <tbody id="classesTableBody">${rows || `<tr><td colspan="4" style="color:var(--color-meta)">Ingen klasser ennå.</td></tr>`}</tbody>
    </table>`;
  document.getElementById("newClassBtn").addEventListener("click", createClassFlow);
  document.getElementById("syncEntraBtn")?.addEventListener("click", syncEntraUsers);
  const importBtn = document.getElementById("importUsersBtn");
  const importFile = document.getElementById("importUsersFile");
  importBtn?.addEventListener("click", () => importFile?.click());
  importFile?.addEventListener("change", () => importUsersFromFile(importFile));
  document.getElementById("classesTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "open") openClass(btn.dataset.id);
    if (btn.dataset.action === "archive") archiveClass(btn.dataset.id, btn.dataset.name);
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
  const memberChips = members.map((m) => `<span class="chip">${escapeHtml(m.name)} <button data-remove-member="${escapeHtml(m.userId)}" aria-label="Fjern ${escapeHtml(m.name)}">×</button></span>`).join("");
  const courseChips = courses.map((c) => `<span class="chip">${escapeHtml(courseTitle(c.title))} <button data-remove-course="${escapeHtml(c.courseId)}" aria-label="Fjern kurs">×</button></span>`).join("");
  const assignedIds = new Set(courses.map((c) => c.courseId));
  // #688: don't offer archived courses for assignment — they are retired and shouldn't be assigned.
  const courseOptions = allCourses.filter((c) => !assignedIds.has(c.id) && !c.archivedAt).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(courseTitle(c.title))}</option>`).join("");
  pageContent.innerHTML = `
    <a class="back-link" id="backToClasses">← Tilbake til klasser</a>
    <div class="page-header"><h1>Klasse</h1></div>
    <div class="detail-section">
      <h2>Studenter (${members.length})</h2>
      <div class="chip-row" id="memberChips">${memberChips || `<span style="color:var(--color-meta);font-size:13px">Ingen studenter ennå.</span>`}</div>
      <div class="inline-form">
        <input type="text" id="studentSearch" placeholder="Søk navn eller e-post (min. 2 tegn)" autocomplete="off" style="min-width:280px" />
      </div>
      <ul class="search-results" id="searchResults"></ul>
    </div>
    <div class="detail-section">
      <h2>Tildelte kurs (${courses.length})</h2>
      <div class="chip-row" id="courseChips">${courseChips || `<span style="color:var(--color-meta);font-size:13px">Ingen kurs tildelt ennå.</span>`}</div>
      <div class="inline-form">
        <select id="courseSelect"><option value="">Velg kurs…</option>${courseOptions}</select>
        <input type="date" id="dueAtInput" title="Frist (valgfri)" />
        <button id="assignCourseBtn" class="btn btn-secondary" style="width:auto">Tildel kurs</button>
      </div>
    </div>`;
  document.getElementById("backToClasses").addEventListener("click", renderListView);

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

// #705-UX(H): vis Kalibrering-fanen for brukere med kalibreringstilgang (likt kurs/modul-sidene).
function renderContentAreaNav() {
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  const userRoles = new Set(resolveActiveWorkspaceRoles());
  const hasCalibrationRole = [...calibrationRoles].some((r) => userRoles.has(r));
  if (navKalibrering) navKalibrering.hidden = !hasCalibrationRole;
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
  renderContentAreaNav();
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
