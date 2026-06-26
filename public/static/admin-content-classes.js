import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { showToast } from "/static/toast.js";

// #645/CL-3: admin UI for classes (cohorts) — list, create, manage members, assign courses.

const pageContent = document.getElementById("pageContent");
const workspaceNav = document.getElementById("workspaceNav");
const appVersionLabel = document.getElementById("appVersion");

let _headerValues = {};
let participantRuntimeConfig = {};
function getHeaders() { return _headerValues; }

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
        <button class="row-action-btn" data-action="open" data-id="${escapeHtml(c.id)}">Administrer</button>
        ${c.isSystem ? "" : `<button class="row-action-btn destructive" data-action="archive" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">Arkiver</button>`}
      </td>
    </tr>`).join("");
  pageContent.innerHTML = `
    <div class="page-header"><h1>Klasser</h1><button id="newClassBtn" class="btn btn-primary" style="width:auto">+ Ny klasse</button></div>
    <p style="color:var(--color-meta);font-size:13px">En klasse er en gruppe deltakere du kan tildele kurs til samlet. «Alle deltakere» er en systemklasse (alle med deltakerrolle).</p>
    <table class="classes-table">
      <thead><tr><th>Navn</th><th>Medlemmer</th><th>Tildelte kurs</th><th></th></tr></thead>
      <tbody id="classesTableBody">${rows || `<tr><td colspan="4" style="color:var(--color-meta)">Ingen klasser ennå.</td></tr>`}</tbody>
    </table>`;
  document.getElementById("newClassBtn").addEventListener("click", createClassFlow);
  document.getElementById("classesTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "open") openClass(btn.dataset.id);
    if (btn.dataset.action === "archive") archiveClass(btn.dataset.id, btn.dataset.name);
  });
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
  const items = resolveWorkspaceNavigationItems(participantRuntimeConfig);
  renderWorkspaceNavigationWithProfile({ workspaceNav, localePicker: null, items, buildLabel: (item) => item.labelKey || item.id });
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
  } catch {
    _headerValues = {};
  }
  renderWorkspaceNavigation();
  await initConsentGuard(getHeaders, "nb");
  try {
    const body = await apiFetch("/version", { headers: {} });
    if (appVersionLabel) appVersionLabel.textContent = `v${body.version ?? "unknown"}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }
  await renderListView();
}

init();
