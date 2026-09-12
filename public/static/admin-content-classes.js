import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { showToast } from "/static/toast.js";
import { describeApiError } from "/static/api-error.js";
import { supportedLocales, localeLabels, translations as adminContentTranslations } from "/static/i18n/admin-content-translations.js";
import { renderOwnerPanel } from "/static/owner-panel.js";
import { createListPage } from "/static/list-page.js";
import { createFormPage } from "/static/form-page.js";
import { lifecycleOf } from "/static/content-status-badge.js";

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

// #972/#965: ni toaster og to tomtilstander viste `err.message` — som apiFetch bygger som
// `"<status>: <hele JSON-kroppen>"`. En norsk forfatter som ikke eier klassen fikk altså
// `403: {"error":"content_ownership","message":"You can only modify content you own."}` og lærte
// verken at årsaken var eierskap eller at løsningen er å be om å bli lagt til som eier.
// De norske `?? "Kunne ikke arkivere."`-fallbackene var død kode — apiFetch setter alltid `message`.
function apiErrorToast(error) {
  const { headline, detail } = describeApiError(error, tNav);
  showToast(headline, "error", detail);
}

function apiErrorText(error) {
  return describeApiError(error, tNav).headline;
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

// #1038: kurstittelen kommer ferdig valgt for leserens språk fra serveren (`title` på
// klassens tildelinger, `displayTitle` på kurslista). Parseren som sto her hadde sin egen
// reservekjede (nb → en-GB → nn → første) — en annen enn serverens, og de to var uenige om hva en
// delvis oversatt tittel skulle vise. Klienten viser strengen den får; språket sendes som `x-locale`.
function courseTitle(value) {
  return typeof value === "string" && value.trim() ? value : "(uten tittel)";
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
// #1046: lista er den felles listesida (list-page.js). Her ligger bare oppskriften for klasser.
let listPage = null;

function classTypeLabel(c) {
  if (c.isSystem) return "System";
  if (c.kind === "ENTRA") return "Entra";
  return "Manuell";
}

function getListPage() {
  if (listPage) return listPage;
  listPage = createListPage({
    host: pageContent,
    ids: { tbody: "classesTableBody", search: "classesSearch" },
    texts: {
      title: "Klasser",
      lead: "Grupper av deltakere som får kurs tildelt samlet. «Alle deltakere» er en systemklasse med alle som har deltakerrolle.",
      searchPlaceholder: "Søk på klassenavn…",
      searchLabel: "Søk i klasser",
      filterGroupLabel: "Filtrer klasser",
      empty: "Ingen klasser ennå.",
      emptyFiltered: "Ingen klasser i denne visningen.",
      loadError: "Kunne ikke laste klasser.",
    },
    headerActions: [
      { id: "importUsersBtn", label: "Importer brukere", title: "Importer brukere fra en JSON-fil eksportert fra Entra (delta-synk)", hidden: !isAdministrator },
      { id: "syncEntraBtn", label: "Synk brukere fra Entra", title: "Importer brukere fra «Alle i A-2 Norge» i Entra (krever Graph-tilgang)", hidden: !isAdministrator },
      { id: "newClassBtn", label: "Ny klasse", kind: "primary" },
    ],
    headerExtraHtml: isAdministrator ? `<input type="file" id="importUsersFile" accept="application/json,.json" style="display:none">` : "",
    // #1046 B2: samme rekkefølge som Moduler/Kurs/Seksjoner — «Alle» først, «Aktive» forhåndsvalgt.
    filters: { options: [["all", "Alle"], ["active", "Aktive"], ["archived", "Arkiverte"]], initial: "active" },
    search: { matches: (c, q) => String(c.name ?? "").toLowerCase().includes(q) || String(c.id).toLowerCase().includes(q) },
    sort: { key: "name", dir: "asc", locale: () => currentLocale },
    columns: [
      { key: "name", label: "Navn", className: "col-name", sortValue: (c) => c.name ?? "", render: (c) =>
        `${escapeHtml(c.name)}${c.isSystem ? `<span class="system-badge">System</span>` : ""}${lifecycleOf(c) === "archived" ? ` <span class="status-badge status-badge--archived">Arkivert</span>` : ""}` },
      { key: "type", label: "Type", render: (c) => escapeHtml(classTypeLabel(c)) },
      { key: "members", label: "Medlemmer", sortValue: (c) => c._count?.members ?? 0, render: (c) => String(c._count?.members ?? 0) },
      { key: "courses", label: "Tildelte kurs", sortValue: (c) => c._count?.courseAssignments ?? 0, render: (c) => String(c._count?.courseAssignments ?? 0) },
    ],
    rowId: (c) => c.id,
    actions: (c) => {
      // #787 slice 5: eier/admin styrer om handlingene vises (speiler eierskaps-vakta). Systemklasser
      // er ueide → bare admin forvalter dem, som før.
      const canManage = c.canManage !== false;
      if (!canManage) return [`<span class="row-readonly-note" title="Bare en eier eller en administrator kan åpne denne klassen.">Kun for eier</span>`];
      const archived = lifecycleOf(c) === "archived";
      const id = escapeHtml(c.id);
      const name = escapeHtml(c.name);
      // #1046 D3: Åpne · Arkiver, og på arkiverte rader Gjenopprett · Slett.
      return [
        `<button class="row-action-btn" data-action="open" data-id="${id}">Åpne</button>`,
        c.isSystem ? "" : archived
          ? `<button class="row-action-btn" data-action="restore" data-id="${id}" data-name="${name}">Gjenopprett</button>`
          : `<button class="row-action-btn" data-action="archive" data-id="${id}" data-name="${name}">Arkiver</button>`,
        !c.isSystem && archived ? `<button class="row-action-btn destructive" data-action="delete" data-id="${id}" data-name="${name}">Slett</button>` : "",
      ];
    },
    load: async () => (await apiFetch("/api/admin/content/classes", getHeaders)).classes ?? [],
    describeError: (err) => apiErrorText(err),
    onAction: (action, id, btn) => {
      if (action === "open") goToClass(id);
      if (action === "archive") archiveClass(id, btn.dataset.name);
      if (action === "restore") restoreClassInAdmin(id, btn.dataset.name);
      if (action === "delete") deleteClassInAdmin(id, btn.dataset.name);
    },
    afterRender: () => {
      document.getElementById("newClassBtn")?.addEventListener("click", createClassFlow);
      document.getElementById("syncEntraBtn")?.addEventListener("click", syncEntraUsers);
      const importBtn = document.getElementById("importUsersBtn");
      const importFile = document.getElementById("importUsersFile");
      importBtn?.addEventListener("click", () => importFile?.click());
      importFile?.addEventListener("change", () => importUsersFromFile(importFile));
    },
  });
  return listPage;
}

async function renderListView() {
  pageContent.innerHTML = `<div class="page-loading">Laster…</div>`;
  await getListPage().reload().catch(() => undefined);
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
    apiErrorToast(err);
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
    apiErrorToast(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Importer brukere"; }
    input.value = ""; // allow re-selecting the same file
  }
}

// #1046 nivå to (1b): «Ny klasse» åpner et tomt skjema; klassen lages ved første Lagre. Var en
// nettleser-prompt som ikke kunne oversettes eller stiles.
function createClassFlow() {
  return goToClass(null);
}

async function archiveClass(id, name, { stay = false } = {}) {
  if (!window.confirm(`Arkivere klassen «${name}»?`)) return;
  try {
    // #1046 D3: POST /archive, som kurs og seksjoner. DELETE sletter nå for godt.
    await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/archive`, getHeaders, { method: "POST" });
    showToast("Klasse arkivert.", "success");
    if (stay) { await openClass(id); return; }
    await renderListView();
  } catch (err) {
    apiErrorToast(err);
  }
}

// #1046 D3: sletting for godt, bare fra en arkivert rad. Produkteier ba om «er du helt sikker».
async function deleteClassInAdmin(id, name) {
  if (!window.confirm(`Er du helt sikker på at du vil slette klassen «${name}» for godt?\n\nMedlemslista og kurstildelingene forsvinner. Deltakernes egen fremdrift beholdes.`)) return;
  try {
    await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}`, getHeaders, { method: "DELETE" });
    showToast("Klasse slettet.", "success");
    history.replaceState({}, "", window.location.pathname);
    openClassState = null;
    await renderListView();
  } catch (err) {
    apiErrorToast(err);
  }
}

// #705-family: reverse of archiveClass — restore an archived class so it is active again.
async function restoreClassInAdmin(id, name, { stay = false } = {}) {
  if (!window.confirm(`Gjenopprette klassen «${name}»?`)) return;
  try {
    await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/restore`, getHeaders, { method: "POST" });
    showToast("Klasse gjenopprettet.", "success");
    if (stay) { await openClass(id); return; }
    await renderListView();
  } catch (err) {
    apiErrorToast(err);
  }
}

// ---------------------------------------------------------------------------
// Det åpnede elementet: den felles skjemasida (form-page.js). #1046 nivå to.
//
// Produkteier 12.09: lag nytt = åpne et tomt element (ingen prompt); Lagre-knapp med
// «Alt lagret / Ulagrede endringer» og spørsmål før man forlater. Klassen har fått URL
// (?id=… / ?new) som seksjoner, så tilbake-knappen i nettleseren og dyplenker virker.
// ---------------------------------------------------------------------------

let formPage = null;
let openClassState = null; // { id, klass, members, courses, allCourses } — null når lista vises

function classUrl(id) {
  // Sida bor både på /admin-content/classes og /deltakere/klasser (#765); behold den man står på.
  const base = window.location.pathname;
  return id ? `${base}?id=${encodeURIComponent(id)}` : `${base}?new`;
}

function goToClass(id, { replace = false } = {}) {
  const url = classUrl(id);
  if (replace) history.replaceState({}, "", url); else history.pushState({}, "", url);
  return openClass(id);
}

function goToList() {
  history.pushState({}, "", window.location.pathname);
  openClassState = null;
  return renderListView();
}

const FORM_TEXTS = {
  back: "← Tilbake til klasser", typeLabel: "Klasse", untitled: "Ny klasse",
  savedAll: "Alt lagret", unsaved: "Ulagrede endringer", save: "Lagre", cancel: "Avbryt",
  leaveConfirm: "Du har ulagrede endringer. Vil du forlate sida uten å lagre?",
  contentLocale: "Innholdsspråk:", required: "(påkrevd)",
};

function getFormPage() {
  if (formPage) return formPage;
  formPage = createFormPage({
    host: pageContent,
    texts: FORM_TEXTS,
    onBack: () => goToList(),
    title: () => (document.getElementById("className")?.value ?? openClassState?.klass?.name ?? "").trim(),
    item: () => openClassState?.klass ?? null,
    t: tNav,
    actions: () => {
      const k = openClassState?.klass;
      if (!k?.id || k.isSystem || k.canManage === false) return [];
      const archived = Boolean(k.archivedAt);
      return [
        archived
          ? `<button class="row-action-btn" data-action="restore">Gjenopprett</button>`
          : `<button class="row-action-btn" data-action="archive">Arkiver</button>`,
        archived ? `<button class="row-action-btn destructive" data-action="delete">Slett</button>` : "",
      ];
    },
    body: () => classFormBodyHtml(),
    save: { onSave: () => saveClassForm() },
    afterRender: () => bindClassFormHandlers(),
  });
  formPage.installGuards();
  return formPage;
}

async function openClass(id) {
  pageContent.innerHTML = `<div class="page-loading">Laster…</div>`;
  let klass = null, members = [], courses = [], allCourses = [];
  try {
    if (id) {
      [klass, members, courses, allCourses] = await Promise.all([
        apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}`, getHeaders).then((r) => r.class ?? null),
        apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/members`, getHeaders).then((r) => r.members ?? []),
        apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/courses`, getHeaders).then((r) => r.courses ?? []),
        apiFetch("/api/admin/content/courses", getHeaders).then((r) => r.courses ?? []),
      ]);
      // canManage kommer fra lista; enkeltoppslaget går gjennom eierskapsvakta, så den som kom hit kan forvalte.
      if (klass) klass.canManage = true;
    }
  } catch (err) {
    pageContent.innerHTML = `<div class="empty-state"><p class="empty-state-title">Kunne ikke laste klassen.</p><p class="empty-state-text">${escapeHtml(apiErrorText(err))}</p></div>`;
    return;
  }
  openClassState = { id: id ?? null, klass, members, courses, allCourses };
  const page = getFormPage();
  page.render();
  page.markClean();
  if (!id) document.getElementById("className")?.focus();
}

function classFormBodyHtml() {
  const st = openClassState ?? { klass: null, members: [], courses: [], allCourses: [] };
  const k = st.klass;
  const isNew = !st.id;
  const memberRows = st.members.map((m) => `<li class="assign-row">
      <span class="assign-name">${escapeHtml(m.name)}</span>
      ${m.email ? `<span class="assign-meta">${escapeHtml(m.email)}</span>` : ""}
      <button type="button" class="assign-remove row-action-btn destructive" data-remove-member="${escapeHtml(m.userId)}" aria-label="Fjern ${escapeHtml(m.name)}">Fjern</button>
    </li>`).join("");
  const courseRows = st.courses.map((c) => {
    const due = formatDueDate(c.dueAt);
    // #967: si hvorfor ingen i klassen beveger seg. Et arkivert eller upublisert kurs er usynlig
    // for deltakeren, og påminnelser sendes ikke lenger for det — men tildelingen står igjen.
    const unreachable = c.courseArchived
      ? "Arkivert – deltakerne ser det ikke"
      : c.coursePublished === false
        ? "Ikke publisert – deltakerne ser det ikke"
        : "";
    return `<li class="assign-row">
      <span class="assign-name">${escapeHtml(courseTitle(c.title))}</span>
      ${unreachable ? `<span class="assign-meta assign-meta--warn">${escapeHtml(unreachable)}</span>` : ""}
      <span class="assign-meta">${due ? `Frist: ${escapeHtml(due)}` : "Ingen frist"}</span>
      <button type="button" class="assign-remove row-action-btn destructive" data-remove-course="${escapeHtml(c.courseId)}" aria-label="Fjern kurs">Fjern</button>
    </li>`;
  }).join("");
  const assignedIds = new Set(st.courses.map((c) => c.courseId));
  // #688: don't offer archived courses for assignment — they are retired and shouldn't be assigned.
  const courseOptions = st.allCourses.filter((c) => !assignedIds.has(c.id) && !c.archivedAt).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(courseTitle(c.displayTitle))}</option>`).join("");
  const readOnly = Boolean(k?.isSystem);
  return `
    ${isNew ? "" : `<div class="detail-section" id="classOwnerPanelHost" data-form-untracked></div>`}
    <div class="detail-section">
      <h2>Klasse</h2>
      <div class="form-field">
        <label for="className">Navn <span class="required-note">(påkrevd)</span></label>
        <input type="text" id="className" data-form-title value="${escapeHtml(k?.name ?? "")}" ${readOnly ? "disabled" : ""} autocomplete="off" />
      </div>
      <div class="form-field">
        <label for="classDescription">Beskrivelse</label>
        <textarea id="classDescription" rows="3" ${readOnly ? "disabled" : ""}>${escapeHtml(k?.description ?? "")}</textarea>
      </div>
      ${readOnly ? `<p class="small">Systemklassen styres automatisk og kan ikke endres.</p>` : ""}
    </div>
    ${isNew ? `<div class="detail-section" data-form-untracked><p class="small" style="margin:0">Lagre klassen først, så kan du legge til deltakere og tildele kurs.</p></div>` : `
    <div class="detail-section" data-form-untracked>
      <h2>Deltakere (${st.members.length})</h2>
      <ul class="assign-list" id="memberChips">${memberRows || `<li class="assign-empty">Ingen deltakere ennå.</li>`}</ul>
      <div class="inline-form">
        <input type="text" id="studentSearch" placeholder="Søk navn eller e-post (min. 2 tegn)" autocomplete="off" style="min-width:280px" />
      </div>
      <ul class="search-results" id="searchResults"></ul>
    </div>
    <div class="detail-section" data-form-untracked>
      <h2>Tildelte kurs (${st.courses.length})</h2>
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
    </div>`}`;
}

async function saveClassForm() {
  const st = openClassState;
  if (!st) return false;
  const name = (document.getElementById("className")?.value ?? "").trim();
  const description = (document.getElementById("classDescription")?.value ?? "").trim();
  if (!name) {
    showToast("Navn er påkrevd.", "error");
    document.getElementById("className")?.focus();
    return false;
  }
  try {
    if (!st.id) {
      const created = await apiFetch("/api/admin/content/classes", getHeaders, { method: "POST", body: JSON.stringify({ name, description: description || undefined }) });
      showToast("Klasse opprettet.", "success");
      // Første lagring lager klassen; sida bytter til den lagrede (med deltakere og kurs).
      await goToClass(created.class.id, { replace: true });
      return true;
    }
    const saved = await apiFetch(`/api/admin/content/classes/${encodeURIComponent(st.id)}`, getHeaders, { method: "PATCH", body: JSON.stringify({ name, description: description || null }) });
    st.klass = { ...st.klass, ...(saved.class ?? {}), canManage: true };
    showToast("Lagret.", "success");
    getFormPage().refreshTitle();
    return true;
  } catch (err) {
    apiErrorToast(err);
    return false;
  }
}

function bindClassFormHandlers() {
  const st = openClassState;
  if (!st) return;
  const id = st.id;

  // Handlingsraden i hodet.
  pageContent.querySelector(".form-page-actions")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !st.klass) return;
    if (!getFormPage().confirmLeave()) return;
    const k = st.klass;
    if (btn.dataset.action === "archive") { await archiveClass(k.id, k.name, { stay: true }); return; }
    if (btn.dataset.action === "restore") { await restoreClassInAdmin(k.id, k.name, { stay: true }); return; }
    if (btn.dataset.action === "delete") { await deleteClassInAdmin(k.id, k.name); }
  });

  if (!id) return;

  // #787: content-owner management for the class.
  const ownerHost = document.getElementById("classOwnerPanelHost");
  if (ownerHost) renderOwnerPanel({ container: ownerHost, contentType: "CLASS", contentId: id, getHeaders, t: tNav }).catch(() => {});

  // Member add via search.
  const searchInput = document.getElementById("studentSearch");
  const resultsEl = document.getElementById("searchResults");
  let searchTimer = null;
  searchInput?.addEventListener("input", () => {
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
  resultsEl?.addEventListener("click", async (e) => {
    const li = e.target.closest("[data-add-user]");
    if (!li) return;
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/members`, getHeaders, { method: "POST", body: JSON.stringify({ userId: li.dataset.addUser }) });
      showToast("Deltaker lagt til.", "success");
      openClass(id);
    } catch (err) { apiErrorToast(err); }
  });
  document.getElementById("memberChips")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove-member]");
    if (!btn) return;
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/members/${encodeURIComponent(btn.dataset.removeMember)}`, getHeaders, { method: "DELETE" });
      openClass(id);
    } catch (err) { apiErrorToast(err); }
  });

  // Course assignment.
  document.getElementById("assignCourseBtn")?.addEventListener("click", async () => {
    const courseId = document.getElementById("courseSelect").value;
    if (!courseId) return;
    const due = document.getElementById("dueAtInput").value;
    const body = { courseId };
    if (due) body.dueAt = new Date(due + "T00:00:00.000Z").toISOString();
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/courses`, getHeaders, { method: "POST", body: JSON.stringify(body) });
      showToast("Kurs tildelt.", "success");
      openClass(id);
    } catch (err) { apiErrorToast(err); }
  });
  document.getElementById("courseChips")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove-course]");
    if (!btn) return;
    try {
      await apiFetch(`/api/admin/content/classes/${encodeURIComponent(id)}/courses/${encodeURIComponent(btn.dataset.removeCourse)}`, getHeaders, { method: "DELETE" });
      openClass(id);
    } catch (err) { apiErrorToast(err); }
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
    // #1038: serveren velger språk når data HENTES. Neste kall skal be om det nye språket, og lista
    // under henter på nytt — en åpen klasse lukkes, så ingen tittel blir stående på det gamle.
    if (_headerValues && typeof _headerValues === "object") _headerValues["x-locale"] = currentLocale;
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
    _headerValues["x-locale"] = currentLocale;
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
  await renderRoute();
  window.addEventListener("popstate", () => { renderRoute(); });
}

// #1046: ?id=… åpner klassen, ?new et tomt skjema, ellers lista.
function renderRoute() {
  const q = new URLSearchParams(window.location.search);
  if (q.has("new")) return openClass(null);
  if (q.get("id")) return openClass(q.get("id"));
  openClassState = null;
  return renderListView();
}

init();
