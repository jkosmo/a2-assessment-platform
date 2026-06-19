import {
  supportedLocales,
  localeLabels,
  translations as adminContentTranslations,
} from "/static/i18n/admin-content-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, hydrateContentAssetImages } from "/static/api-client.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { showToast } from "/static/toast.js";

// ---------------------------------------------------------------------------
// Section editor (U1 / #488). Library of reusable course learning sections.
// ---------------------------------------------------------------------------

const EDITOR_LOCALES = ["nb", "nn", "en-GB"];

// Self-contained labels for this workspace's own UI (kept local to avoid
// threading dozens of keys through the shared translations file).
const LABELS = {
  "en-GB": {
    heading: "Sections", newSection: "+ New section", colTitle: "Title", colVersion: "Version",
    colUpdated: "Last changed", edit: "Edit", del: "Delete", empty: "No sections yet.",
    back: "← Back", titleLabel: "Title", markdown: "Markdown", preview: "Preview",
    save: "Save new version", saved: "Section saved.", deleted: "Section deleted.",
    confirmDelete: "Delete this section?", loadError: "Could not load sections.",
    needContent: "Add a title and content in at least one language.",
    translate: "Translate from this language", translating: "Translating…", translated: "Translated — review before saving.",
    uploadImage: "Upload image", altPrompt: "Alt text (describes the image for screen readers):", saveFirst: "Save the section first, then upload images.", imageInserted: "Image inserted.",
  },
  nb: {
    heading: "Seksjoner", newSection: "+ Ny seksjon", colTitle: "Tittel", colVersion: "Versjon",
    colUpdated: "Sist endret", edit: "Rediger", del: "Slett", empty: "Ingen seksjoner ennå.",
    back: "← Tilbake", titleLabel: "Tittel", markdown: "Markdown", preview: "Forhåndsvisning",
    save: "Lagre ny versjon", saved: "Seksjon lagret.", deleted: "Seksjon slettet.",
    confirmDelete: "Slette denne seksjonen?", loadError: "Kunne ikke laste seksjoner.",
    needContent: "Fyll inn tittel og innhold på minst ett språk.",
    translate: "Oversett fra dette språket", translating: "Oversetter…", translated: "Oversatt — se over før du lagrer.",
    uploadImage: "Last opp bilde", altPrompt: "Alt-tekst (beskriver bildet for skjermlesere):", saveFirst: "Lagre seksjonen først, så kan du laste opp bilder.", imageInserted: "Bilde satt inn.",
  },
  nn: {
    heading: "Seksjonar", newSection: "+ Ny seksjon", colTitle: "Tittel", colVersion: "Versjon",
    colUpdated: "Sist endra", edit: "Rediger", del: "Slett", empty: "Ingen seksjonar enno.",
    back: "← Tilbake", titleLabel: "Tittel", markdown: "Markdown", preview: "Førehandsvising",
    save: "Lagre ny versjon", saved: "Seksjon lagra.", deleted: "Seksjon sletta.",
    confirmDelete: "Slette denne seksjonen?", loadError: "Kunne ikkje laste seksjonar.",
    needContent: "Fyll inn tittel og innhald på minst eitt språk.",
    translate: "Omset frå dette språket", translating: "Omset…", translated: "Omsett — sjå over før du lagrar.",
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
function getHeaders() { return _headerValues; }

const pageContent = document.getElementById("pageContent");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const localeSelect = document.getElementById("localeSelect");
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
  const params = new URLSearchParams(window.location.search);
  if (params.has("new")) return { view: "editor", sectionId: null };
  const id = params.get("id");
  if (id) return { view: "editor", sectionId: id };
  return { view: "list" };
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

async function renderListView() {
  let sections;
  try {
    const data = await apiFetch("/api/admin/content/sections", getHeaders);
    sections = data.sections ?? [];
  } catch (err) {
    pageContent.innerHTML = `<div class="empty-state"><p class="empty-state-title">${escapeHtml(L("loadError"))}</p><p class="empty-state-text">${escapeHtml(err?.message ?? "")}</p></div>`;
    return;
  }

  const rows = sections.map((s) => `<tr>
      <td class="col-title">${escapeHtml(displayTitle(s.title))}</td>
      <td>v${escapeHtml(s.versionNo ?? "1")}</td>
      <td style="white-space:nowrap">${escapeHtml(new Date(s.updatedAt).toLocaleDateString(currentLocale))}</td>
      <td class="col-actions">
        <button class="row-action-btn" data-action="edit" data-id="${escapeHtml(s.id)}">${escapeHtml(L("edit"))}</button>
        <button class="row-action-btn destructive" data-action="delete" data-id="${escapeHtml(s.id)}">${escapeHtml(L("del"))}</button>
      </td>
    </tr>`).join("");

  pageContent.innerHTML = `
    <div class="page-header">
      <h1>${escapeHtml(L("heading"))}</h1>
      <button type="button" id="newSectionBtn" class="btn btn-primary" style="width:auto">${escapeHtml(L("newSection"))}</button>
    </div>
    ${sections.length === 0
      ? `<div class="empty-state"><p class="empty-state-text">${escapeHtml(L("empty"))}</p></div>`
      : `<div class="sections-table-wrap"><table class="sections-table">
          <thead><tr><th>${escapeHtml(L("colTitle"))}</th><th>${escapeHtml(L("colVersion"))}</th><th>${escapeHtml(L("colUpdated"))}</th><th class="col-actions"></th></tr></thead>
          <tbody id="sectionsTableBody">${rows}</tbody></table></div>`}`;

  document.getElementById("newSectionBtn")?.addEventListener("click", () => goTo("editor", null));
  document.getElementById("sectionsTableBody")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "edit") goTo("editor", btn.dataset.id);
    else if (btn.dataset.action === "delete") deleteSection(btn.dataset.id);
  });
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
  editing = { id: sectionId, title: { nb: "", nn: "", "en-GB": "" }, body: { nb: "", nn: "", "en-GB": "" }, editLocale: currentLocale };

  if (sectionId) {
    try {
      const data = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}`, getHeaders);
      editing.title = parseLocalized(data.section.title);
      editing.body = parseLocalized(data.section.bodyMarkdown);
    } catch (err) {
      pageContent.innerHTML = `<div class="empty-state"><p class="empty-state-title">${escapeHtml(err?.message ?? "Error")}</p></div>`;
      return;
    }
  }

  pageContent.innerHTML = `
    <div class="page-header-back"><a href="#" class="back-link" id="backLink">${escapeHtml(L("back"))}</a></div>
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
            <input type="file" id="imageFileInput" accept="image/png,image/jpeg,image/gif,image/webp" hidden />
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
    if (!editing.id) { showToast(L("saveFirst"), "error"); return; }
    document.getElementById("imageFileInput")?.click();
  });
  document.getElementById("imageFileInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadImage(file);
  });
  refreshPreview();
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
      body: JSON.stringify({ markdown: editing.body[editing.editLocale] ?? "" }),
    });
    pane.innerHTML = data.html ?? "";
    await hydrateContentAssetImages(pane, getHeaders);
  } catch {
    /* leave previous preview on transient error */
  }
}

// Only send locales the author actually filled — the API rejects empty strings
// (each present locale must be min 1 char), but accepts a partial object.
function nonEmptyLocales(obj) {
  const out = {};
  for (const loc of EDITOR_LOCALES) {
    if ((obj[loc] ?? "").trim().length > 0) out[loc] = obj[loc];
  }
  return out;
}

async function saveSection() {
  captureInputs();
  const status = document.getElementById("editorStatus");
  const title = nonEmptyLocales(editing.title);
  const bodyMarkdown = nonEmptyLocales(editing.body);
  if (Object.keys(title).length === 0 || Object.keys(bodyMarkdown).length === 0) {
    showToast(L("needContent"), "error");
    return;
  }
  try {
    if (!editing.id) {
      const data = await apiFetch("/api/admin/content/sections", getHeaders, {
        method: "POST",
        body: JSON.stringify({ title, bodyMarkdown }),
      });
      editing.id = data.section.id;
      history.replaceState({}, "", `/admin-content/sections?id=${encodeURIComponent(editing.id)}`);
    } else {
      await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/title`, getHeaders, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/content`, getHeaders, {
        method: "PUT",
        body: JSON.stringify({ bodyMarkdown }),
      });
    }
    showToast(L("saved"));
    if (status) status.textContent = L("saved");
  } catch (err) {
    showToast(err?.message ?? "Error", "error");
  }
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
// image referencing the asset (![alt](asset:<id>)) at the cursor. Requires the section to
// be saved first (assets attach to a section id). Alt text is mandatory (a11y).
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
  if (!editing.id) { showToast(L("saveFirst"), "error"); return; }
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
    "",
    window.location.pathname,
  );
  renderWorkspaceNavigationWithProfile({ workspaceNav, localePicker, items, buildLabel: (item) => tNav(item.labelKey) || item.id });
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
  } catch {
    _headerValues = {};
  }

  buildLocaleSelector();
  renderWorkspaceNavigation();

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
