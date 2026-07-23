import {
  supportedLocales,
  localeLabels,
  translations as adminContentTranslations,
} from "/static/i18n/admin-content-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, hydrateContentAssetImages } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { showToast } from "/static/toast.js";
import { lifecycleStatusBadge } from "/static/content-status-badge.js";
import { renderOwnerPanel } from "/static/owner-panel.js";
import {
  SECTION_EDITOR_LOCALES,
  nonEmptyLocales,
  hasSavableContent,
  detectSectionRoute,
} from "/static/admin-content-sections-state.js";

// ---------------------------------------------------------------------------
// Section editor (U1 / #488). Library of reusable course learning sections.
// ---------------------------------------------------------------------------

const EDITOR_LOCALES = SECTION_EDITOR_LOCALES;

// Self-contained labels for this workspace's own UI (kept local to avoid
// threading dozens of keys through the shared translations file).
const LABELS = {
  "en-GB": {
    heading: "Sections", newSection: "+ New section", colTitle: "Title", colVersion: "Version",
    colStatus: "Status", statusDraft: "Draft", statusPublished: "Published", statusArchived: "Archived",
    publish: "Publish", unpublish: "Unpublish", archive: "Archive", restore: "Restore",
    showArchived: "Show archived", hideArchived: "Hide archived",
    filterAll: "All", filterActive: "Active", filterPublished: "Published", filterArchived: "Archived",
    colCourses: "Used in courses", coursesPopoverTitle: "Used in courses", noCourses: "Not used in any course.",
    courseFilterLabel: "Course:", courseFilterAll: "All courses", courseFilterNone: "Not in any course",
    published: "Section published.", unpublished: "Section unpublished.",
    archived: "Section archived.", restored: "Section restored.", confirmArchive: "Archive this section?",
    colUpdated: "Last changed", edit: "Edit", del: "Delete", empty: "No sections yet.",
    readonly: "Read-only", readonlyHint: "Only an owner or an administrator can change this section.",
    back: "← Back", titleLabel: "Title", markdown: "Markdown", preview: "Preview",
    save: "Save new version", saved: "Section saved.", deleted: "Section deleted.",
    confirmDelete: "Delete this section?", loadError: "Could not load sections.",
    needContent: "Add a title and content in at least one language.",
    translate: "Translate from this language", translating: "Translating…", translated: "Translated — review before saving.",
    translatingImages: "Translating drawings…", imagesTranslated: "SVG drawings translated — verify each language visually.",
    uploadImage: "Upload image", altPrompt: "Alt text (describes the image for screen readers):", saveFirst: "Save the section first, then upload images.", imageInserted: "Image inserted.",
  },
  nb: {
    heading: "Seksjoner", newSection: "+ Ny seksjon", colTitle: "Tittel", colVersion: "Versjon",
    colStatus: "Status", statusDraft: "Utkast", statusPublished: "Publisert", statusArchived: "Arkivert",
    publish: "Publiser", unpublish: "Avpubliser", archive: "Arkiver", restore: "Gjenopprett",
    showArchived: "Vis arkiverte", hideArchived: "Skjul arkiverte",
    filterAll: "Alle", filterActive: "Aktive", filterPublished: "Publiserte", filterArchived: "Arkiverte",
    colCourses: "Brukt i kurs", coursesPopoverTitle: "Brukt i kurs", noCourses: "Ikke brukt i noe kurs.",
    courseFilterLabel: "Kurs:", courseFilterAll: "Alle kurs", courseFilterNone: "Ikke i noe kurs",
    published: "Seksjon publisert.", unpublished: "Seksjon avpublisert.",
    archived: "Seksjon arkivert.", restored: "Seksjon gjenopprettet.", confirmArchive: "Arkivere denne seksjonen?",
    colUpdated: "Sist endret", edit: "Rediger", del: "Slett", empty: "Ingen seksjoner ennå.",
    readonly: "Skrivebeskyttet", readonlyHint: "Bare en eier eller administrator kan endre denne seksjonen.",
    back: "← Tilbake", titleLabel: "Tittel", markdown: "Markdown", preview: "Forhåndsvisning",
    save: "Lagre ny versjon", saved: "Seksjon lagret.", deleted: "Seksjon slettet.",
    confirmDelete: "Slette denne seksjonen?", loadError: "Kunne ikke laste seksjoner.",
    needContent: "Fyll inn tittel og innhold på minst ett språk.",
    translate: "Oversett fra dette språket", translating: "Oversetter…", translated: "Oversatt — se over før du lagrer.",
    translatingImages: "Oversetter tegninger…", imagesTranslated: "SVG-tegninger oversatt — verifiser hvert språk visuelt.",
    uploadImage: "Last opp bilde", altPrompt: "Alt-tekst (beskriver bildet for skjermlesere):", saveFirst: "Lagre seksjonen først, så kan du laste opp bilder.", imageInserted: "Bilde satt inn.",
  },
  nn: {
    heading: "Seksjonar", newSection: "+ Ny seksjon", colTitle: "Tittel", colVersion: "Versjon",
    colStatus: "Status", statusDraft: "Utkast", statusPublished: "Publisert", statusArchived: "Arkivert",
    publish: "Publiser", unpublish: "Avpubliser", archive: "Arkiver", restore: "Gjenopprett",
    showArchived: "Vis arkiverte", hideArchived: "Skjul arkiverte",
    filterAll: "Alle", filterActive: "Aktive", filterPublished: "Publiserte", filterArchived: "Arkiverte",
    colCourses: "Brukt i kurs", coursesPopoverTitle: "Brukt i kurs", noCourses: "Ikke brukt i noe kurs.",
    courseFilterLabel: "Kurs:", courseFilterAll: "Alle kurs", courseFilterNone: "Ikkje i noko kurs",
    published: "Seksjon publisert.", unpublished: "Seksjon avpublisert.",
    archived: "Seksjon arkivert.", restored: "Seksjon gjenoppretta.", confirmArchive: "Arkivere denne seksjonen?",
    colUpdated: "Sist endra", edit: "Rediger", del: "Slett", empty: "Ingen seksjonar enno.",
    readonly: "Skrivebeskytta", readonlyHint: "Berre ein eigar eller administrator kan endre denne seksjonen.",
    back: "← Tilbake", titleLabel: "Tittel", markdown: "Markdown", preview: "Førehandsvising",
    save: "Lagre ny versjon", saved: "Seksjon lagra.", deleted: "Seksjon sletta.",
    confirmDelete: "Slette denne seksjonen?", loadError: "Kunne ikkje laste seksjonar.",
    needContent: "Fyll inn tittel og innhald på minst eitt språk.",
    translate: "Omset frå dette språket", translating: "Omset…", translated: "Omsett — sjå over før du lagrar.",
    translatingImages: "Omset teikningar…", imagesTranslated: "SVG-teikningar omsette — kontroller kvart språk visuelt.",
    uploadImage: "Last opp bilete", altPrompt: "Alt-tekst (skildrar biletet for skjermlesarar):", saveFirst: "Lagre seksjonen først, så kan du laste opp bilete.", imageInserted: "Bilete sett inn.",
  },
};

let currentLocale = (() => {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) return stored;
  const b = navigator.language?.toLowerCase() ?? "";
  if (b.startsWith("nb")) return "nb";
  if (b.startsWith("nn")) return "nn";
  return "en-GB";
})();

function L(key) {
  return LABELS[currentLocale]?.[key] ?? LABELS["en-GB"][key] ?? key;
}
function tNav(key) {
  return adminContentTranslations[currentLocale]?.[key] ?? adminContentTranslations["en-GB"]?.[key] ?? key;
}

let participantRuntimeConfig = {};
let _headerValues = {};
let activeUserRoles = [];

// Workspace nav items are filtered by the signed-in user's roles. Prefer live /api/me roles; fall
// back to mock identityDefaults; finally SUBJECT_MATTER_OWNER so the top nav is never empty (in prod
// identityDefaults is undefined, so passing "" hid every role-gated nav item).
function resolveActiveWorkspaceRoles() {
  if (Array.isArray(activeUserRoles) && activeUserRoles.length > 0) return activeUserRoles;
  const defaults = participantRuntimeConfig?.identityDefaults?.contentAdmin ?? participantRuntimeConfig?.identityDefaults ?? {};
  return Array.isArray(defaults.roles) && defaults.roles.length > 0 ? defaults.roles : ["SUBJECT_MATTER_OWNER"];
}
function getHeaders() { return _headerValues; }

const pageContent = document.getElementById("pageContent");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const localeSelect = document.getElementById("localeSelect");
const navKalibrering = document.getElementById("navKalibrering");
const appVersionLabel = document.getElementById("appVersion");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Localized stored values arrive as JSON strings ({locale:value}) or plain text.
function parseLocalized(raw) {
  const out = { nb: "", nn: "", "en-GB": "" };
  if (typeof raw !== "string" || raw.length === 0) return out;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      for (const loc of EDITOR_LOCALES) if (typeof parsed[loc] === "string") out[loc] = parsed[loc];
      return out;
    } catch { /* fall through */ }
  }
  out[currentLocale] = raw;
  return out;
}

function displayTitle(rawTitle) {
  const t = parseLocalized(rawTitle);
  return t[currentLocale] || t["en-GB"] || t.nb || t.nn || "(uten tittel)";
}

// ---------------------------------------------------------------------------
// Routing: list vs editor (?id=… or ?new)
// ---------------------------------------------------------------------------

function detectRoute() {
  return detectSectionRoute(window.location.search);
}

function goTo(view, sectionId) {
  const url = view === "list"
    ? "/admin-content/sections"
    : sectionId
      ? `/admin-content/sections?id=${encodeURIComponent(sectionId)}`
      : "/admin-content/sections?new";
  history.pushState({}, "", url);
  renderRoute();
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

// #705: status fra de samme to aksene som modul/kurs — arkivert overstyrer; ellers publisert hvis
// en aktiv versjon er valgt, ellers utkast.
function sectionStatus(s) {
  if (s.archivedAt) return "archived";
  if (s.activeVersionId) return "published";
  return "draft";
}

function statusBadge(status) {
  // #705: shared 3-state badge + i18n (same vocabulary as course/module lists).
  // NB: this file's admin-translations accessor is `tNav`, not `t`.
  return lifecycleStatusBadge(status, tNav);
}

// #705-UX(A): filter-piller (Alle/Aktive/Publiserte/Arkiverte) likt modul-biblioteket.
let sectionsFilter = "active";
// #745: valgt kurs i kurs-filteret. "__all__" = ingen filtrering (default),
// "__none__" = seksjoner som ikke er i noe kurs, ellers en course-id. In-memory
// (ingen persistering på tvers av reload), som øvrige filtre på siden.
let sectionCourseFilter = "__all__";
let allSections = []; // siste hentede liste — slås opp av «Brukt i kurs»-popoveren.

// #705-UX(G): popover som viser hvilke kurs en seksjon brukes i (likt modul-biblioteket).
function showSectionCoursesPopover(anchor, sectionId) {
  const section = allSections.find((s) => s.id === sectionId);
  if (!section) return;
  document.getElementById("sectionCoursesPopover")?.remove();
  const pop = document.createElement("div");
  pop.id = "sectionCoursesPopover";
  pop.className = "courses-popover";
  pop.setAttribute("role", "dialog");
  const items = (section.courses ?? []).map((c) => `<li>${escapeHtml(c.title ?? c.id)}</li>`).join("")
    || `<li><em>${escapeHtml(L("noCourses"))}</em></li>`;
  pop.innerHTML = `<p class="courses-popover-title">${escapeHtml(L("coursesPopoverTitle"))}</p><ul class="courses-popover-list">${items}</ul>`;
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${rect.bottom + window.scrollY + 6}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;
  const close = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("click", close, true);
    }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

function filterSections(sections) {
  if (sectionsFilter === "all") return sections;
  if (sectionsFilter === "archived") return sections.filter((s) => s.archivedAt);
  if (sectionsFilter === "published") return sections.filter((s) => !s.archivedAt && s.activeVersionId);
  return sections.filter((s) => !s.archivedAt); // active
}

// #745: kurs-filter komponerer med status-filteret (ekstra predikat). "__none__" beholder
// seksjoner uten kurs; en course-id beholder seksjoner som er i det kurset.
function applySectionCourseFilter(sections) {
  if (sectionCourseFilter === "__none__") return sections.filter((s) => (s.courses ?? []).length === 0);
  if (sectionCourseFilter !== "__all__") return sections.filter((s) => (s.courses ?? []).some((c) => c && c.id === sectionCourseFilter));
  return sections;
}

// #745: distinkte kurs på tvers av alle seksjoners `courses`-array (dedupe på id), sortert på tittel.
function collectSectionCourseFilterOptions(sections) {
  const byId = new Map();
  for (const s of sections) {
    for (const c of (s.courses ?? [])) {
      if (c && c.id && !byId.has(c.id)) byId.set(c.id, String(c.title ?? c.id));
    }
  }
  return [...byId.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, currentLocale));
}

// #745: kurs-dropdown, bygget per render fra dataene. Bevarer valgt kurs hvis det fortsatt finnes.
function sectionCourseFilterBar(sections) {
  const options = collectSectionCourseFilterOptions(sections);
  const valid = new Set(["__all__", "__none__", ...options.map((o) => o.id)]);
  if (!valid.has(sectionCourseFilter)) sectionCourseFilter = "__all__";
  const opts = [
    `<option value="__all__"${sectionCourseFilter === "__all__" ? " selected" : ""}>${escapeHtml(L("courseFilterAll"))}</option>`,
    ...options.map((o) => `<option value="${escapeHtml(o.id)}"${o.id === sectionCourseFilter ? " selected" : ""}>${escapeHtml(o.title)}</option>`),
    `<option value="__none__"${sectionCourseFilter === "__none__" ? " selected" : ""}>${escapeHtml(L("courseFilterNone"))}</option>`,
  ].join("");
  return `<div class="list-course-filter"><label for="sectionCourseFilter">${escapeHtml(L("courseFilterLabel"))}</label><select id="sectionCourseFilter" class="list-course-select">${opts}</select></div>`;
}

function sectionFilterBar() {
  const pills = [
    ["all", L("filterAll")],
    ["active", L("filterActive")],
    ["published", L("filterPublished")],
    ["archived", L("filterArchived")],
  ];
  return `<div class="list-filters" role="group" aria-label="Filtrer seksjoner">${pills
    .map(([key, label]) => `<button type="button" class="list-filter-btn${sectionsFilter === key ? " active" : ""}" data-filter="${key}">${escapeHtml(label)}</button>`)
    .join("")}</div>`;
}

async function renderListView() {
  let sections;
  try {
    const data = await apiFetch("/api/admin/content/sections", getHeaders);
    sections = data.sections ?? [];
    allSections = sections;
  } catch (err) {
    pageContent.innerHTML = `<div class="empty-state"><p class="empty-state-title">${escapeHtml(L("loadError"))}</p><p class="empty-state-text">${escapeHtml(err?.message ?? "")}</p></div>`;
    return;
  }

  // #745: status-filter (piller) + kurs-filter (dropdown) komponeres.
  const visible = applySectionCourseFilter(filterSections(sections));

  // #705: samme handlings-rekkefølge og status-vokabular som modul/kurs.
  const rows = visible.map((s) => {
    const status = sectionStatus(s);
    const id = escapeHtml(s.id);
    // #787 slice 5: skjul rediger/livssyklus-handlingene for innhold brukeren ikke eier (og ikke er admin
    // for) — samme regel som eierskaps-vakta, så vi ikke viser knapper som gir 403 ved lagring.
    const canManage = s.canManage !== false;
    // #705-UX: Slett vises kun for arkiverte elementer (terminal steg etter arkivering).
    const lifecycle = status === "archived"
      ? `<button class="row-action-btn" data-action="restore" data-id="${id}">${escapeHtml(L("restore"))}</button>
         <button class="row-action-btn destructive" data-action="delete" data-id="${id}">${escapeHtml(L("del"))}</button>`
      : status === "published"
        ? `<button class="row-action-btn" data-action="unpublish" data-id="${id}">${escapeHtml(L("unpublish"))}</button>
           <button class="row-action-btn" data-action="archive" data-id="${id}">${escapeHtml(L("archive"))}</button>`
        : `<button class="row-action-btn" data-action="publish" data-id="${id}">${escapeHtml(L("publish"))}</button>
           <button class="row-action-btn" data-action="archive" data-id="${id}">${escapeHtml(L("archive"))}</button>`;
    const courseCount = Number(s.courseCount ?? 0);
    const courseCell = courseCount > 0
      ? `<button class="course-count-btn" data-id="${id}" aria-label="${courseCount}">${courseCount}</button>`
      : `<span class="course-count-zero">0</span>`;
    return `<tr>
      <td class="col-title">${escapeHtml(displayTitle(s.title))}</td>
      <td>${statusBadge(status)}</td>
      <td>v${escapeHtml(s.versionNo ?? "1")}</td>
      <td>${courseCell}</td>
      <td style="white-space:nowrap">${escapeHtml(new Date(s.updatedAt).toLocaleDateString(currentLocale))}</td>
      <td class="col-actions">
        <div class="row-actions">
          ${canManage
            ? `<button class="row-action-btn" data-action="edit" data-id="${id}">${escapeHtml(L("edit"))}</button>
          ${lifecycle}`
            : `<span class="row-readonly-note" title="${escapeHtml(L("readonlyHint"))}">${escapeHtml(L("readonly"))}</span>`}
        </div>
      </td>
    </tr>`;
  }).join("");

  pageContent.innerHTML = `
    <div class="page-header">
      <h1>${escapeHtml(L("heading"))}</h1>
      <button type="button" id="newSectionBtn" class="btn btn-primary" style="width:auto">${escapeHtml(L("newSection"))}</button>
    </div>
    <div class="list-filters-row">${sectionFilterBar()}${sectionCourseFilterBar(sections)}</div>
    ${visible.length === 0
      ? `<div class="empty-state"><p class="empty-state-text">${escapeHtml(L("empty"))}</p></div>`
      : `<div class="sections-table-wrap"><table class="sections-table">
          <thead><tr><th>${escapeHtml(L("colTitle"))}</th><th>${escapeHtml(L("colStatus"))}</th><th>${escapeHtml(L("colVersion"))}</th><th>${escapeHtml(L("colCourses"))}</th><th>${escapeHtml(L("colUpdated"))}</th><th class="col-actions"></th></tr></thead>
          <tbody id="sectionsTableBody">${rows}</tbody></table></div>`}`;

  document.getElementById("newSectionBtn")?.addEventListener("click", () => goTo("editor", null));
  pageContent.querySelector(".list-filters")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-filter]");
    if (!btn) return;
    sectionsFilter = btn.dataset.filter;
    renderListView();
  });
  // #745: kurs-filter — re-render lista med det valgte kurset.
  document.getElementById("sectionCourseFilter")?.addEventListener("change", (event) => {
    sectionCourseFilter = event.target.value;
    renderListView();
  });
  document.getElementById("sectionsTableBody")?.addEventListener("click", (event) => {
    const courseBtn = event.target.closest(".course-count-btn");
    if (courseBtn) { showSectionCoursesPopover(courseBtn, courseBtn.dataset.id); return; }
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "edit") goTo("editor", id);
    else if (action === "delete") deleteSection(id);
    else if (action === "publish") sectionLifecycle(id, "publish", "published");
    else if (action === "unpublish") sectionLifecycle(id, "unpublish", "unpublished");
    else if (action === "archive") { if (window.confirm(L("confirmArchive"))) sectionLifecycle(id, "archive", "archived"); }
    else if (action === "restore") sectionLifecycle(id, "restore", "restored");
  });
}

// #705: én felles handler for de fire livssyklus-overgangene (POST .../{action}).
async function sectionLifecycle(sectionId, action, toastKey) {
  try {
    await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}/${action}`, getHeaders, { method: "POST" });
    showToast(L(toastKey));
    renderListView();
  } catch (err) {
    showToast(err?.message ?? "Error", "error");
  }
}

async function deleteSection(sectionId) {
  if (!window.confirm(L("confirmDelete"))) return;
  try {
    await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}`, getHeaders, { method: "DELETE" });
    showToast(L("deleted"));
    renderListView();
  } catch (err) {
    showToast(err?.message ?? "Error", "error");
  }
}

// ---------------------------------------------------------------------------
// Editor view
// ---------------------------------------------------------------------------

let editing = null; // { id, title:{}, body:{}, editLocale }
let previewTimer = null;

async function renderEditorView(sectionId) {
  editing = { id: sectionId, title: { nb: "", nn: "", "en-GB": "" }, body: { nb: "", nn: "", "en-GB": "" }, editLocale: currentLocale, activeVersionId: null, archivedAt: null };

  if (sectionId) {
    try {
      const data = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}`, getHeaders);
      editing.title = parseLocalized(data.section.title);
      editing.body = parseLocalized(data.section.bodyMarkdown);
      editing.activeVersionId = data.section.activeVersionId ?? null;
      editing.archivedAt = data.section.archivedAt ?? null;
    } catch (err) {
      pageContent.innerHTML = `<div class="empty-state"><p class="empty-state-title">${escapeHtml(err?.message ?? "Error")}</p></div>`;
      return;
    }
  }

  pageContent.innerHTML = `
    <div class="page-header-back" style="display:flex;align-items:center;gap:10px">
      <a href="#" class="back-link" id="backLink">${escapeHtml(L("back"))}</a>
      <span id="sectionStatusBadge"></span>
    </div>
    ${sectionId ? `<div id="ownerPanelHost" class="card" style="margin-bottom:var(--space-2)"></div>` : ""}
    <div class="section-editor">
      <div class="lang-tabs" id="langTabs">
        ${EDITOR_LOCALES.map((loc) => `<button type="button" class="lang-tab${loc === editing.editLocale ? " active" : ""}" data-locale="${loc}">${escapeHtml(localeLabels[loc] ?? loc)}</button>`).join("")}
      </div>
      <div class="editor-field">
        <label for="titleInput">${escapeHtml(L("titleLabel"))}</label>
        <input type="text" id="titleInput" value="${escapeHtml(editing.title[editing.editLocale])}" />
      </div>
      <div class="editor-cols">
        <div>
          <div class="editor-pane-label" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span>${escapeHtml(L("markdown"))}</span>
            <button type="button" id="uploadImageBtn" class="btn btn-secondary" style="width:auto;font-size:12px;padding:2px 8px">${escapeHtml(L("uploadImage"))}</button>
            <input type="file" id="imageFileInput" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg" hidden />
          </div>
          <textarea id="markdownInput">${escapeHtml(editing.body[editing.editLocale])}</textarea>
        </div>
        <div>
          <div class="editor-pane-label">${escapeHtml(L("preview"))}</div>
          <div class="preview-pane" id="previewPane"></div>
        </div>
      </div>
      <div class="editor-actions">
        <button type="button" id="saveBtn" class="btn btn-primary">${escapeHtml(L("save"))}</button>
        <button type="button" id="translateBtn" class="btn btn-secondary" style="width:auto">${escapeHtml(L("translate"))}</button>
        <button type="button" id="sectionLifecycleBtn" class="btn btn-secondary" style="width:auto;display:none"></button>
        <span class="editor-status" id="editorStatus"></span>
      </div>
    </div>`;

  document.getElementById("backLink")?.addEventListener("click", (e) => { e.preventDefault(); goTo("list"); });
  document.getElementById("translateBtn")?.addEventListener("click", translateFromCurrent);
  document.getElementById("langTabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-locale]");
    if (!tab) return;
    captureInputs();
    editing.editLocale = tab.dataset.locale;
    renderEditorFields();
  });
  document.getElementById("titleInput")?.addEventListener("input", captureInputs);
  document.getElementById("markdownInput")?.addEventListener("input", () => { captureInputs(); schedulePreview(); });
  document.getElementById("saveBtn")?.addEventListener("click", saveSection);
  document.getElementById("uploadImageBtn")?.addEventListener("click", () => {
    document.getElementById("imageFileInput")?.click();
  });
  document.getElementById("imageFileInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadImage(file);
  });
  document.getElementById("sectionLifecycleBtn")?.addEventListener("click", toggleSectionLifecycle);
  refreshSectionLifecycleUI();
  refreshPreview();
  // #787: content-owner management for an existing section (new sections have no id yet).
  if (sectionId) {
    const ownerHost = document.getElementById("ownerPanelHost");
    if (ownerHost) renderOwnerPanel({ container: ownerHost, contentType: "SECTION", contentId: sectionId, getHeaders }).catch(() => {});
  }
}

// #705: status i editoren (samme vokabular som modul) + Publiser/Avpubliser-knapp. Seksjoner
// auto-publiseres ved lagring, så knappen er først og fremst for å avpublisere en live seksjon,
// eller publisere en som er tatt ned igjen — uten å redigere innholdet.
function editorSectionStatus() {
  if (!editing?.id) return null;
  if (editing.archivedAt) return "archived";
  if (editing.activeVersionId) return "published";
  return "draft";
}

function refreshSectionLifecycleUI() {
  const badge = document.getElementById("sectionStatusBadge");
  const btn = document.getElementById("sectionLifecycleBtn");
  const status = editorSectionStatus();
  if (badge) badge.innerHTML = status ? statusBadge(status) : "";
  if (!btn) return;
  if (!status || status === "archived") {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  if (status === "published") {
    btn.textContent = L("unpublish");
    btn.dataset.action = "unpublish";
  } else {
    btn.textContent = L("publish");
    btn.dataset.action = "publish";
  }
}

async function toggleSectionLifecycle() {
  const btn = document.getElementById("sectionLifecycleBtn");
  if (!editing?.id || !btn) return;
  const action = btn.dataset.action;
  btn.disabled = true;
  try {
    const data = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/${action}`, getHeaders, { method: "POST" });
    editing.activeVersionId = data.section?.activeVersionId ?? null;
    editing.archivedAt = data.section?.archivedAt ?? null;
    showToast(L(action === "publish" ? "published" : "unpublished"));
    refreshSectionLifecycleUI();
  } catch (err) {
    showToast(err?.message ?? "Error", "error");
  } finally {
    btn.disabled = false;
  }
}

function captureInputs() {
  if (!editing) return;
  const title = document.getElementById("titleInput");
  const md = document.getElementById("markdownInput");
  if (title) editing.title[editing.editLocale] = title.value;
  if (md) editing.body[editing.editLocale] = md.value;
}

function renderEditorFields() {
  document.querySelectorAll(".lang-tab").forEach((t) => t.classList.toggle("active", t.dataset.locale === editing.editLocale));
  const title = document.getElementById("titleInput");
  const md = document.getElementById("markdownInput");
  if (title) title.value = editing.title[editing.editLocale];
  if (md) md.value = editing.body[editing.editLocale];
  refreshPreview();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 300);
}

async function refreshPreview() {
  const pane = document.getElementById("previewPane");
  if (!pane) return;
  try {
    const data = await apiFetch("/api/admin/content/sections/preview", getHeaders, {
      method: "POST",
      body: JSON.stringify({ markdown: editing.body[editing.editLocale] ?? "", locale: editing.editLocale }),
    });
    pane.innerHTML = data.html ?? "";
    await hydrateContentAssetImages(pane, getHeaders);
  } catch {
    /* leave previous preview on transient error */
  }
}

// Persist the section (create on first save, otherwise update title + content).
// Returns true on success. `silent` suppresses the success toast so callers like
// the image upload can auto-save transparently without a confusing extra toast.
async function persistSection({ silent } = {}) {
  captureInputs();
  const status = document.getElementById("editorStatus");
  const title = nonEmptyLocales(editing.title);
  const bodyMarkdown = nonEmptyLocales(editing.body);
  if (!hasSavableContent(editing.title, editing.body)) {
    showToast(L("needContent"), "error");
    return false;
  }
  try {
    if (!editing.id) {
      const data = await apiFetch("/api/admin/content/sections", getHeaders, {
        method: "POST",
        body: JSON.stringify({ title, bodyMarkdown }),
      });
      editing.id = data.section.id;
      editing.activeVersionId = data.section.activeVersionId ?? editing.activeVersionId;
      editing.archivedAt = data.section.archivedAt ?? null;
      history.replaceState({}, "", `/admin-content/sections?id=${encodeURIComponent(editing.id)}`);
    } else {
      await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/title`, getHeaders, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      const contentRes = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/content`, getHeaders, {
        method: "PUT",
        body: JSON.stringify({ bodyMarkdown }),
      });
      // Lagring publiserer (latest-wins) — oppdater status så merkelappen blir riktig.
      editing.activeVersionId = contentRes.section?.activeVersionId ?? editing.activeVersionId;
    }
    // #705: hold status-merkelappen + Publiser/Avpubliser-knappen i editoren i synk etter lagring.
    refreshSectionLifecycleUI();
    if (!silent) {
      showToast(L("saved"));
      if (status) status.textContent = L("saved");
    }
    return true;
  } catch (err) {
    showToast(err?.message ?? "Error", "error");
    return false;
  }
}

async function saveSection() {
  await persistSection();
}

// Explicit LLM translation (#514): translate the active language's content into
// the other locales, which the author reviews/edits before saving.
async function translateFromCurrent() {
  captureInputs();
  const src = editing.editLocale;
  const title = (editing.title[src] ?? "").trim();
  const body = (editing.body[src] ?? "").trim();
  if (!title && !body) {
    showToast(L("needContent"), "error");
    return;
  }
  // Lock the editor while translating so the author can't edit/navigate mid-call.
  const controls = ["translateBtn", "saveBtn", "titleInput", "markdownInput", "backLink"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const tabs = Array.from(document.querySelectorAll(".lang-tab"));
  const setLocked = (locked) => {
    controls.forEach((el) => { el.disabled = locked; el.style.pointerEvents = locked ? "none" : ""; el.style.opacity = locked ? "0.6" : ""; });
    tabs.forEach((el) => { el.disabled = locked; el.style.pointerEvents = locked ? "none" : ""; });
  };
  const btn = document.getElementById("translateBtn");
  setLocked(true);
  if (btn) btn.textContent = L("translating");
  try {
    for (const target of EDITOR_LOCALES.filter((l) => l !== src)) {
      const res = await apiFetch("/api/admin/content/sections/localize", getHeaders, {
        method: "POST",
        body: JSON.stringify({ title: title || undefined, bodyMarkdown: body || undefined, sourceLocale: src, targetLocale: target }),
      });
      if (res.title) editing.title[target] = res.title;
      if (res.bodyMarkdown) editing.body[target] = res.bodyMarkdown;
    }
    // #657: also generate translated SVG-drawing variants for this section's SVG assets, so a
    // drawing's baked-in labels follow the same language as the surrounding text. Only possible on
    // a saved section (assets need a section id); non-fatal if it fails — text is already translated.
    if (editing.id) {
      try {
        if (btn) btn.textContent = L("translatingImages");
        const assetRes = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/assets/localize`, getHeaders, {
          method: "POST",
          body: JSON.stringify({ sourceLocale: src }),
        });
        if (assetRes?.localizedAssetCount > 0) showToast(L("imagesTranslated"));
      } catch (assetErr) {
        showToast(assetErr?.message ?? "Image translation failed", "error");
      }
    }
    showToast(L("translated"));
    renderEditorFields();
  } catch (err) {
    showToast(err?.message ?? "Error", "error");
  } finally {
    setLocked(false);
    if (btn) btn.textContent = L("translate");
  }
}

// Image upload (#489/U2): upload to the section's blob storage, then insert a markdown
// image referencing the asset (![alt](asset:<id>)) at the cursor. Assets attach to a
// section id, so an unsaved section is auto-saved first (transparent to the author).
// Alt text is mandatory (a11y).
function insertAtCursor(text) {
  const ta = document.getElementById("markdownInput");
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  const pos = start + text.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
}

async function uploadImage(file) {
  // Assets need a section id — auto-save first (silently) if this is a new section.
  // persistSection shows the needContent toast if there's nothing to save yet.
  if (!editing.id) {
    const saved = await persistSection({ silent: true });
    if (!saved || !editing.id) return;
  }
  const alt = window.prompt(L("altPrompt"), "");
  if (alt === null) return; // cancelled
  const btn = document.getElementById("uploadImageBtn");
  if (btn) btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/assets`, getHeaders, {
      method: "POST",
      body: fd,
    });
    insertAtCursor(`![${alt}](${res.asset.ref})`);
    captureInputs();
    schedulePreview();
    showToast(L("imageInserted"));
  } catch (err) {
    showToast(err?.message ?? "Error", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function renderRoute() {
  const route = detectRoute();
  if (route.view === "editor") renderEditorView(route.sectionId);
  else renderListView();
}

function buildLocaleSelector() {
  if (!localeSelect) return;
  localeSelect.innerHTML = supportedLocales.map((l) => `<option value="${l}"${l === currentLocale ? " selected" : ""}>${localeLabels[l] ?? l}</option>`).join("");
  localeSelect.addEventListener("change", () => {
    currentLocale = localeSelect.value;
    localStorage.setItem("participant.locale", currentLocale);
    if (_headerValues && typeof _headerValues === "object") _headerValues["x-locale"] = currentLocale;
    renderRoute();
  });
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    resolveActiveWorkspaceRoles().join(","),
    window.location.pathname,
  );
  renderWorkspaceNavigationWithProfile({ workspaceNav, localePicker, items, buildLabel: (item) => tNav(item.labelKey) || item.id });
}

// #705-UX(H): vis Kalibrering-fanen for brukere med kalibreringstilgang (likt kurs/modul-sidene).
function renderContentAreaNav() {
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  const userRoles = new Set(resolveActiveWorkspaceRoles());
  const hasCalibrationRole = [...calibrationRoles].some((r) => userRoles.has(r));
  if (navKalibrering) navKalibrering.hidden = !hasCalibrationRole;
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
      department: defaults.department,
      roles: Array.isArray(defaults.roles) ? defaults.roles.join(",") : defaults.roles,
      locale: currentLocale,
    });
    // Live roles drive the workspace nav filter (identityDefaults is undefined in prod).
    try {
      const me = await apiFetch("/api/me", getHeaders);
      activeUserRoles = Array.isArray(me?.user?.roles) ? me.user.roles : [];
    } catch {
      activeUserRoles = [];
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
    const version = body.version ?? "unknown";
    document.title = `Seksjoner – A2 v${version}`;
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  window.addEventListener("popstate", renderRoute);
  renderRoute();
}

init();
