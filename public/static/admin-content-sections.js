import {
  supportedLocales,
  localeLabels,
  translations as adminContentTranslations,
} from "/static/i18n/admin-content-translations.js";
import { pickLocalizedText } from "/static/i18n-locale.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig, hydrateContentAssetImages } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
// #1046 C5: samme datohjelper som Moduler og Kurs («28. aug. 2026»), ikke «28.8.2026».
import { createDateFormatter } from "/static/format-display.js";
const formatDate = createDateFormatter(() => currentLocale);
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { describeImportError } from "/static/import-error.js";
import { describeApiError } from "/static/api-error.js";
import { showToast } from "/static/toast.js";
import { lifecycleStatusBadge, lifecycleBadge, lifecycleOf } from "/static/content-status-badge.js";
import { renderOwnerPanel } from "/static/owner-panel.js";
import { sanitizeSectionHtml } from "/static/sanitize.js";
import { createListPage } from "/static/list-page.js";
import { createFormPage } from "/static/form-page.js";
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
    heading: "Sections", more: "More", typeLabel: "Section", untitled: "New section", savedAll: "All saved", unsaved: "Unsaved changes", cancel: "Cancel", leaveConfirm: "You have unsaved changes. Leave without saving?", contentLocale: "Content language:", required: "(required)", searchPlaceholder: "Search by section name or ID…", searchLabel: "Search sections", lead: "Reading material you can use in several courses.", newSection: "New section", colTitle: "Name", colVersion: "Version",
    colStatus: "Status", statusDraft: "Draft", statusPublished: "Published", statusArchived: "Archived",
    publish: "Publish", unpublish: "Unpublish", archive: "Archive", restore: "Restore",
    showArchived: "Show archived", hideArchived: "Hide archived",
    filterAll: "All", filterActive: "Active", filterPublished: "Published", filterArchived: "Archived",
    colCourses: "Used in courses", coursesPopoverTitle: "Used in courses", noCourses: "Not used in any course.",
    courseFilterLabel: "Course:", courseFilterAll: "All courses", courseFilterNone: "Not in any course",
    published: "Section published.", unpublished: "Section unpublished.",
    archived: "Section archived.", restored: "Section restored.", confirmArchive: "Archive this section?",
    colUpdated: "Last changed", edit: "Open", del: "Delete section", empty: "No sections yet.",
    readonly: "Owner access only", readonlyHint: "Only an owner or an administrator can open this section.",
    back: "← Back to sections", backToCourse: "← Back to the course", titleLabel: "Name", markdown: "Markdown", preview: "Preview",
    save: "Save", saved: "Section saved.", deleted: "Section deleted.",
    confirmDelete: "Are you sure you want to delete this section for good? It disappears from every course that uses it.", loadError: "Could not load sections.",
    needContent: "Add a title and content in at least one language.",
    translate: "Translate from this language", translating: "Translating…", translated: "Translated — review before saving.",
    translatingImages: "Translating drawings…", imagesTranslated: "SVG drawings translated — verify each language visually.",
    uploadImage: "Upload image", altPrompt: "Alt text (describes the image for screen readers):", saveFirst: "Save the section first, then upload images.", imageInserted: "Image inserted.",
    // #916 — standalone section portability + the publish gate's author-facing wording.
    exportSection: "Export", duplicate: "Duplicate", duplicated: "Copy created as a draft.", importSection: "Import section", exported: "Section exported.",
    notAnEnvelope: "This does not look like a section package. The file is missing the fields an export adds (exportFormat, exportedAt and scope), and its contents do not look like a section either. Use Export on a section to produce a valid file.",
    imported: "Section package imported as a draft. Review it and publish when it is ready.",
    replaceFromFile: "Replace from file", replaceConfirm: "Replace this section's content with the file? The current version is kept — the import becomes a new draft.", replaced: "Content replaced. The import is a draft — review it and publish when it is ready.",
    gateHeldBack: "Saved, but not published — the section is missing", gateBlocked: "Cannot publish — the section is missing",
    gateHint: "Use “Translate from this language” to fill the gaps, then save again.",
    fieldTitle: "the title", fieldBodyMarkdown: "the content",
  },
  nb: {
    heading: "Seksjoner", more: "Mer", typeLabel: "Seksjon", untitled: "Ny seksjon", savedAll: "Alt lagret", unsaved: "Ulagrede endringer", cancel: "Avbryt", leaveConfirm: "Du har ulagrede endringer. Vil du forlate sida uten å lagre?", contentLocale: "Innholdsspråk:", required: "(påkrevd)", searchPlaceholder: "Søk på seksjonsnavn eller seksjons-ID…", searchLabel: "Søk i seksjoner", lead: "Lesestoff du kan bruke i flere kurs.", newSection: "Ny seksjon", colTitle: "Navn", colVersion: "Versjon",
    colStatus: "Status", statusDraft: "Utkast", statusPublished: "Publisert", statusArchived: "Arkivert",
    publish: "Publiser", unpublish: "Avpubliser", archive: "Arkiver", restore: "Gjenopprett",
    showArchived: "Vis arkiverte", hideArchived: "Skjul arkiverte",
    filterAll: "Alle", filterActive: "Aktive", filterPublished: "Publiserte", filterArchived: "Arkiverte",
    colCourses: "Brukt i kurs", coursesPopoverTitle: "Brukt i kurs", noCourses: "Ikke brukt i noe kurs.",
    courseFilterLabel: "Kurs:", courseFilterAll: "Alle kurs", courseFilterNone: "Ikke i noe kurs",
    published: "Seksjon publisert.", unpublished: "Seksjon avpublisert.",
    archived: "Seksjon arkivert.", restored: "Seksjon gjenopprettet.", confirmArchive: "Arkivere denne seksjonen?",
    colUpdated: "Sist endret", edit: "Åpne", del: "Slett seksjon", empty: "Ingen seksjoner ennå.",
    readonly: "Kun for eier", readonlyHint: "Bare en eier eller en administrator kan åpne denne seksjonen.",
    back: "← Tilbake til seksjoner", backToCourse: "← Tilbake til kurset", titleLabel: "Navn", markdown: "Markdown", preview: "Forhåndsvisning",
    save: "Lagre", saved: "Seksjon lagret.", deleted: "Seksjon slettet.",
    confirmDelete: "Er du helt sikker på at du vil slette denne seksjonen for godt? Den forsvinner fra alle kurs som bruker den.", loadError: "Kunne ikke laste seksjoner.",
    needContent: "Fyll inn tittel og innhold på minst ett språk.",
    translate: "Oversett fra dette språket", translating: "Oversetter…", translated: "Oversatt — se over før du lagrer.",
    translatingImages: "Oversetter tegninger…", imagesTranslated: "SVG-tegninger oversatt — verifiser hvert språk visuelt.",
    uploadImage: "Last opp bilde", altPrompt: "Alt-tekst (beskriver bildet for skjermlesere):", saveFirst: "Lagre seksjonen først, så kan du laste opp bilder.", imageInserted: "Bilde satt inn.",
    // #916 — frittstående seksjons-portabilitet + publiseringsgatens forfattertekst.
    exportSection: "Eksporter", duplicate: "Dupliser", duplicated: "Kopi opprettet som utkast.", importSection: "Importer seksjon", exported: "Seksjon eksportert.",
    notAnEnvelope: "Dette ser ikke ut som en seksjonspakke. Fila mangler feltene en eksport legger på (exportFormat, exportedAt og scope), og innholdet ligner heller ikke på en seksjon. Bruk «Eksporter» på en seksjon for å lage en gyldig fil.",
    imported: "Seksjons-pakken er importert som utkast. Gå gjennom den og publiser når den er klar.",
    replaceFromFile: "Erstatt fra fil", replaceConfirm: "Erstatte innholdet i denne seksjonen med fila? Nåværende versjon beholdes — importen blir et nytt utkast.", replaced: "Innholdet er erstattet. Importen er et utkast — gå gjennom den og publiser når den er klar.",
    gateHeldBack: "Lagret, men ikke publisert — seksjonen mangler", gateBlocked: "Kan ikke publisere — seksjonen mangler",
    gateHint: "Bruk «Oversett fra dette språket» for å fylle hullene, og lagre på nytt.",
    fieldTitle: "tittelen", fieldBodyMarkdown: "innholdet",
  },
  nn: {
    heading: "Seksjonar", more: "Meir", typeLabel: "Seksjon", untitled: "Ny seksjon", savedAll: "Alt lagra", unsaved: "Ulagra endringar", cancel: "Avbryt", leaveConfirm: "Du har ulagra endringar. Vil du forlate sida utan å lagre?", contentLocale: "Innhaldsspråk:", required: "(påkravd)", searchPlaceholder: "Søk på seksjonsnamn eller seksjons-ID…", searchLabel: "Søk i seksjonar", lead: "Lesestoff du kan bruke i fleire kurs.", newSection: "Ny seksjon", colTitle: "Namn", colVersion: "Versjon",
    colStatus: "Status", statusDraft: "Utkast", statusPublished: "Publisert", statusArchived: "Arkivert",
    publish: "Publiser", unpublish: "Avpubliser", archive: "Arkiver", restore: "Gjenopprett",
    showArchived: "Vis arkiverte", hideArchived: "Skjul arkiverte",
    filterAll: "Alle", filterActive: "Aktive", filterPublished: "Publiserte", filterArchived: "Arkiverte",
    colCourses: "Brukt i kurs", coursesPopoverTitle: "Brukt i kurs", noCourses: "Ikkje brukt i noko kurs.",
    courseFilterLabel: "Kurs:", courseFilterAll: "Alle kurs", courseFilterNone: "Ikkje i noko kurs",
    published: "Seksjon publisert.", unpublished: "Seksjon avpublisert.",
    archived: "Seksjon arkivert.", restored: "Seksjon gjenoppretta.", confirmArchive: "Arkivere denne seksjonen?",
    colUpdated: "Sist endra", edit: "Opne", del: "Slett seksjon", empty: "Ingen seksjonar enno.",
    readonly: "Berre for eigar", readonlyHint: "Berre ein eigar eller ein administrator kan opne denne seksjonen.",
    back: "← Tilbake til seksjonar", backToCourse: "← Tilbake til kurset", titleLabel: "Namn", markdown: "Markdown", preview: "Førehandsvising",
    save: "Lagre", saved: "Seksjon lagra.", deleted: "Seksjon sletta.",
    confirmDelete: "Er du heilt sikker på at du vil slette denne seksjonen for godt? Han forsvinn frå alle kurs som bruker han.", loadError: "Kunne ikkje laste seksjonar.",
    needContent: "Fyll inn tittel og innhald på minst eitt språk.",
    translate: "Omset frå dette språket", translating: "Omset…", translated: "Omsett — sjå over før du lagrar.",
    translatingImages: "Omset teikningar…", imagesTranslated: "SVG-teikningar omsette — kontroller kvart språk visuelt.",
    uploadImage: "Last opp bilete", altPrompt: "Alt-tekst (skildrar biletet for skjermlesarar):", saveFirst: "Lagre seksjonen først, så kan du laste opp bilete.", imageInserted: "Bilete sett inn.",
    // #916 — frittståande seksjons-portabilitet + publiseringsgata sin forfattartekst.
    exportSection: "Eksporter", duplicate: "Dupliser", duplicated: "Kopi oppretta som utkast.", importSection: "Importer seksjon", exported: "Seksjon eksportert.",
    notAnEnvelope: "Dette ser ikkje ut som ein seksjonspakke. Fila manglar felta ein eksport legg på (exportFormat, exportedAt og scope), og innhaldet liknar heller ikkje på ein seksjon. Bruk «Eksporter» på ein seksjon for å lage ei gyldig fil.",
    imported: "Seksjons-pakken er importert som utkast. Gå gjennom han og publiser når han er klar.",
    replaceFromFile: "Erstatt frå fil", replaceConfirm: "Erstatte innhaldet i denne seksjonen med fila? Noverande versjon blir teken vare på — importen blir eit nytt utkast.", replaced: "Innhaldet er erstatta. Importen er eit utkast — gå gjennom han og publiser når han er klar.",
    gateHeldBack: "Lagra, men ikkje publisert — seksjonen manglar", gateBlocked: "Kan ikkje publisere — seksjonen manglar",
    gateHint: "Bruk «Omset frå dette språket» for å fylle hola, og lagre på nytt.",
    fieldTitle: "tittelen", fieldBodyMarkdown: "innhaldet",
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

// #916: render the publish gate's blockers from `field` + `missingLocales`, never from `message`.
// The server's message is English; this page runs in three languages, and the author needs to read
// which field is missing which language — not a leaked internal string. Same contract as the module
// gate (see doc/FEATURE_SURFACE_MAP.md § 18).
function translationGateMessage(prefixKey, issues) {
  const parts = (issues ?? [])
    .filter((issue) => issue && issue.field && Array.isArray(issue.missingLocales) && issue.missingLocales.length > 0)
    .map((issue) => {
      const field = L(`field${issue.field.charAt(0).toUpperCase()}${issue.field.slice(1)}`);
      const locales = issue.missingLocales.map((code) => localeLabels[code] ?? code).join(", ");
      return `${field} (${locales})`;
    });
  if (parts.length === 0) return null;
  return `${L(prefixKey)} ${parts.join("; ")}. ${L("gateHint")}`;
}

// The gate's issues ride along on the thrown error's parsed body (api-client attaches `.body`).
function gateIssuesFrom(error) {
  const issues = error?.body?.issues;
  return Array.isArray(issues) ? issues : [];
}
function tNav(key) {
  return adminContentTranslations[currentLocale]?.[key] ?? adminContentTranslations["en-GB"]?.[key] ?? key;
}

// #972/#965: syv toaster og to tomtilstander sto på `err?.message ?? "Error"`. Publiseringsgaten
// var alt kodet riktig her (`translationGateMessage` over) — alt ANNET, blant annet eierskapsvaktas
// 403, gikk rått ut. Samme flate, to regler. Nå går restene gjennom den delte kodetabellen.
//
// LABELS eier denne sidens egen ordlyd; feilKODENE bor i den delte bunten, så `tNav` er oppslaget.
function apiErrorToast(error) {
  const { headline, detail } = describeApiError(error, tNav);
  showToast(headline, "error", detail);
}

function apiErrorText(error) {
  return describeApiError(error, tNav).headline;
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
  return pickLocalizedText(t, currentLocale) || "(uten tittel)";
}

// ---------------------------------------------------------------------------
// Routing: list vs editor (?id=… or ?new)
// ---------------------------------------------------------------------------

function detectRoute() {
  return detectSectionRoute(window.location.search);
}

function goTo(view, sectionId) {
  // ⚠️ #1052: `returnTo` må BÆRES VIDERE. Lagring og intern navigasjon kaller goTo, og uten dette
  // ville opphavet forsvunnet ved første lagring — forfatteren kom inn fra et kurs, lagret, og
  // hadde plutselig bare lista igjen.
  const opphav = detectRoute().returnTo;
  const hale = opphav ? `returnTo=${encodeURIComponent(opphav)}` : "";
  const base = view === "list"
    ? "/admin-content/sections"
    : sectionId
      ? `/admin-content/sections?id=${encodeURIComponent(sectionId)}`
      : "/admin-content/sections?new";
  const url = hale ? `${base}${base.includes("?") ? "&" : "?"}${hale}` : base;
  history.pushState({}, "", url);
  renderRoute();
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function statusBadge(status) {
  // #705: shared 3-state badge + i18n (same vocabulary as course/module lists).
  // NB: this file's admin-translations accessor is `tNav`, not `t`.
  return lifecycleStatusBadge(status, tNav);
}

// #1046: lista er den felles listesida (list-page.js). Her ligger bare oppskriften for seksjoner.
let allSections = []; // siste hentede liste — slås opp av «Brukt i kurs»-popoveren.
let listPage = null;

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

function getListPage() {
  if (listPage) return listPage;
  listPage = createListPage({
    host: pageContent,
    ids: { tbody: "sectionsTableBody", search: "sectionsSearch", courseFilter: "sectionCourseFilter" },
    // Tekstene som funksjon: sida har språkvelger, og neste tegning skal bruke det nye språket.
    texts: () => ({
      title: L("heading"), lead: L("lead"),
      searchPlaceholder: L("searchPlaceholder"), searchLabel: L("searchLabel"),
      filterGroupLabel: L("heading"),
      courseFilterLabel: L("courseFilterLabel"), courseFilterAll: L("courseFilterAll"), courseFilterNone: L("courseFilterNone"),
      empty: L("empty"), emptyFiltered: L("empty"), more: L("more"), loadError: L("loadError"),
    }),
    headerActions: () => [
      { id: "importSectionBtn", label: L("importSection") },
      { id: "newSectionBtn", label: L("newSection"), kind: "primary" },
    ],
    headerExtraHtml: `<input type="file" id="importSectionFile" accept="application/json,.json" hidden>`,
    filters: {
      options: () => [["all", L("filterAll")], ["active", L("filterActive")], ["published", L("filterPublished")], ["archived", L("filterArchived")]],
      initial: "active",
    },
    // #745: kursfilteret bygges av seksjonenes `courses`.
    courseFilter: { coursesOf: (s) => s.courses ?? [] },
    // #1046 B1: søk på navn (alle språk) og ID, som på Moduler.
    search: { matches: (s, q) => Object.values(parseLocalized(s.title)).some((v) => String(v ?? "").toLowerCase().includes(q)) || String(s.id).toLowerCase().includes(q) },
    sort: { key: "title", dir: "asc", locale: () => currentLocale },
    columns: () => [
      { key: "title", label: L("colTitle"), className: "col-title", sortValue: (s) => displayTitle(s.title), render: (s) => escapeHtml(displayTitle(s.title)) },
      // #1046 steg B/C8: «Nyere utkast»-brikken følger med når tjeneren sier published_with_draft.
      { key: "status", label: L("colStatus"), className: "col-status", render: (s) => lifecycleBadge(s, tNav) },
      { key: "version", label: L("colVersion"), className: "col-version", render: (s) => `v${escapeHtml(s.versionNo ?? "1")}` },
      { key: "courses", label: L("colCourses"), className: "col-courses", sortValue: (s) => Number(s.courseCount ?? 0), render: (s) => {
        const courseCount = Number(s.courseCount ?? 0);
        return courseCount > 0
          ? `<button class="course-count-btn" data-id="${escapeHtml(s.id)}" aria-label="${courseCount}">${courseCount}</button>`
          : `<span class="course-count-zero">0</span>`;
      } },
      { key: "updatedAt", label: L("colUpdated"), className: "col-updated", sortValue: (s) => s.updatedAt ?? "", render: (s) => escapeHtml(formatDate(s.updatedAt)) },
    ],
    rowId: (s) => s.id,
    actions: (s) => {
      const lifecycle = lifecycleOf(s);
      const id = escapeHtml(s.id);
      // #787 slice 5: skjul åpne/livssyklus for innhold brukeren ikke eier (og ikke er admin for) — samme
      // regel som eierskaps-vakta, så vi ikke viser knapper som gir 403.
      const canManage = s.canManage !== false;
      const isLive = lifecycle === "published" || lifecycle === "published_with_draft";
      const publishToggle = lifecycle === "archived" ? ""
        : isLive
          ? `<button class="row-action-btn" data-action="unpublish" data-id="${id}">${escapeHtml(L("unpublish"))}</button>`
          : `<button class="row-action-btn" data-action="publish" data-id="${id}">${escapeHtml(L("publish"))}</button>`;
      const archiveToggle = lifecycle === "archived"
        ? `<button class="row-action-btn" data-action="restore" data-id="${id}">${escapeHtml(L("restore"))}</button>`
        : `<button class="row-action-btn" data-action="archive" data-id="${id}">${escapeHtml(L("archive"))}</button>`;
      // #1046 (produkteier 12.09): samme logikk som Moduler — Dupliser og Eksporter er lese-/kopihandlinger
      // og finnes også for den som ikke eier seksjonen. «Slett» er ute av lista (D3) og ligger inne på den
      // arkiverte seksjonen.
      return [
        canManage ? `<button class="row-action-btn" data-action="edit" data-id="${id}">${escapeHtml(L("edit"))}</button>` : "",
        `<button class="row-action-btn" data-action="duplicate" data-id="${id}">${escapeHtml(L("duplicate"))}</button>`,
        `<button class="row-action-btn" data-action="export" data-id="${id}">${escapeHtml(L("exportSection"))}</button>`,
        canManage ? publishToggle : "",
        canManage ? archiveToggle : "",
        canManage ? "" : `<span class="row-readonly-note" title="${escapeHtml(L("readonlyHint"))}">${escapeHtml(L("readonly"))}</span>`,
      ];
    },
    load: async () => {
      const data = await apiFetch("/api/admin/content/sections", getHeaders);
      allSections = data.sections ?? [];
      return allSections;
    },
    onClick: (event) => {
      const courseBtn = event.target.closest(".course-count-btn");
      if (!courseBtn) return false;
      showSectionCoursesPopover(courseBtn, courseBtn.dataset.id);
      return true;
    },
    describeError: (err) => apiErrorText(err),
    onAction: (action, id, btn) => {
      if (action === "edit") goTo("editor", id);
      else if (action === "export") exportSectionPackage(id, btn);
      else if (action === "duplicate") duplicateSection(id, btn);
      else if (action === "publish") sectionLifecycle(id, "publish", "published");
      else if (action === "unpublish") sectionLifecycle(id, "unpublish", "unpublished");
      else if (action === "archive") { if (window.confirm(L("confirmArchive"))) sectionLifecycle(id, "archive", "archived"); }
      else if (action === "restore") sectionLifecycle(id, "restore", "restored");
    },
    afterRender: () => {
      document.getElementById("newSectionBtn")?.addEventListener("click", () => goTo("editor", null));
      // #916: en synlig knapp som driver et skjult filfelt, som modulbibliotekets importer.
      const importBtn = document.getElementById("importSectionBtn");
      const importFile = document.getElementById("importSectionFile");
      importBtn?.addEventListener("click", () => importFile?.click());
      importFile?.addEventListener("change", (event) => importSectionPackage(event.target));
    },
  });
  return listPage;
}

async function renderListView() {
  await getListPage().reload().catch(() => undefined);
}

// #705: én felles handler for de fire livssyklus-overgangene (POST .../{action}).
async function sectionLifecycle(sectionId, action, toastKey) {
  try {
    await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}/${action}`, getHeaders, { method: "POST" });
    showToast(L(toastKey));
    renderListView();
  } catch (err) {
    // #916: a publish blocked by the translation gate gets the field × language message, not the
    // raw "422: {...}" the generic branch would print.
    const gate = translationGateMessage("gateBlocked", gateIssuesFrom(err));
    if (gate) showToast(gate, "error"); else apiErrorToast(err);
  }
}

// #916: per-row export — download the a2-content-export/v1 envelope as JSON. Same shape and file
// convention as the module/course exporters so all three behave alike for the author.
async function exportSectionPackage(sectionId, btn) {
  if (btn) btn.disabled = true;
  try {
    const body = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}/export-package`, getHeaders);
    const envelope = body?.envelope ?? null;
    if (!envelope) throw new Error("Eksport returnerte tom envelope.");
    const rawTitle = displayTitle(envelope.section?.title ?? "section");
    const safeTitle = String(rawTitle).replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "section";
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `section-${safeTitle}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(L("exported"));
  } catch (err) {
    apiErrorToast(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// #916: import a section package. It always lands as a draft (server-side rule), so there is no
// autoPublish flag to get wrong here — unlike the module importer, where two pages had to remember
// to send `autoPublish: false`.
/**
 * #1012: erstatt innholdet i en EKSISTERENDE seksjon fra fil.
 *
 * Serveren gjorde dette allerede — `mode: "replaceExisting"` med `targetId`. Klienten sendte bare
 * `createNew` hardkodet, så man kunne lage en ny seksjon fra fil, men aldri oppdatere en som fantes.
 *
 * ⚠️ Ikke destruktivt: importen lager en NY versjon som utkast (`publishedAt: null`), og den aktive
 * versjonen står urørt til forfatteren publiserer og passerer oversettelsesgaten. Bekreftelsen
 * finnes likevel, fordi «erstatt» leses som noe som ikke kan angres — teksten sier hva som faktisk
 * skjer i stedet for å be om et ja.
 */
async function replaceSectionFromFile(input) {
  const file = input?.files?.[0] ?? null;
  if (!file) return;
  // Nullstill med én gang, så samme fil kan velges på nytt etter en avbrutt eller feilet runde.
  input.value = "";
  if (!editing?.id) return;

  if (!window.confirm(L("replaceConfirm"))) return;

  try {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      throw new Error(`Filen er ikke gyldig JSON: ${parseError instanceof Error ? parseError.message : "ukjent feil"}`);
    }
    // Samme vennlige vakt som importen i lista: pek en modul-/kurspakke til siden som kan ta den,
    // i stedet for å la serverens scope_mismatch komme rått ut.
    if (payload?.scope === "course" || payload?.scope === "module") {
      throw new Error(
        payload.scope === "course"
          ? "Dette er en kurs-pakke. Importer den fra Kurs-siden."
          : "Dette er en modul-pakke. Importer den fra Moduler-siden.",
      );
    }

    await apiFetch("/api/admin/content/sections/import", getHeaders, {
      method: "POST",
      body: JSON.stringify({ payload, mode: "replaceExisting", targetId: editing.id }),
    });
    showToast(L("replaced"));
    // Hent redigeringen på nytt, ellers står forfatteren igjen med det gamle innholdet på skjermen
    // og tror ingenting skjedde.
    await renderEditorView(editing.id);
  } catch (error) {
    // ⚠️ `L` som tredje argument: uten oversetteren faller `describeImportError` tilbake på sin
    // hardkodede engelske tekst, og en eierskapsfeil ville blitt engelsk på en trespråklig side.
    // Det var #996-funnet på importen i lista, og det gjelder like mye her.
    const d = describeImportError(error, { notAnEnvelope: L("notAnEnvelope") }, L);
    showToast(`${L("replaceFromFile")}: ${d.headline}`, "error", d.detail);
    document.getElementById("replaceFromFileBtn")?.focus();
  }
}

async function importSectionPackage(input) {
  const file = input?.files?.[0] ?? null;
  if (!file) return;
  try {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      throw new Error(`Filen er ikke gyldig JSON: ${parseError instanceof Error ? parseError.message : "ukjent feil"}`);
    }
    // Friendly guard: point a module/course package at the page that can actually import it,
    // instead of surfacing the raw scope_mismatch 400.
    // ⚠️ #937: sto tidligere som `payload?.scope && payload.scope !== "section"`. Den kortsluttet
    // når `scope` manglet HELT — som er nettopp det en fil løftet ut av en kurspakke gjør — så
    // vakten slapp fila videre og forfatteren fikk rå Zod-utdata fra serveren i stedet. Vakten var
    // skrevet for akkurat denne jobben og bommet på én betingelse.
    if (payload?.scope === "course" || payload?.scope === "module") {
      throw new Error(
        payload.scope === "course"
          ? "Dette er en kurs-pakke. Importer den fra Kurs-siden."
          : "Dette er en modul-pakke. Importer den fra Moduler-siden.",
      );
    }
    const result = await apiFetch("/api/admin/content/sections/import", getHeaders, {
      method: "POST",
      body: JSON.stringify({ payload, mode: "createNew" }),
    });
    if (!result?.sectionId) throw new Error("Import-respons mangler sectionId.");
    showToast(L("imported"));
    goTo("editor", result.sectionId);
  } catch (error) {
    // #937: `error.message` fra apiFetch er `"<status>: <hele JSON-kroppen>"` — for en
    // valideringsfeil betyr det en Zod-dump i en toast.
    //
    // ⚠️ KODEN slås opp lokalt, serverens tekst brukes ikke. Konsollet er trespråklig og defaulter
    // til en-GB, så en norsk setning fra serveren ville blitt vist ordrett til en engelsk forfatter.
    // Samme regel som publiseringsgaten allerede følger (FEATURE_SURFACE_MAP §24).
    // ⚠️ #996: `L` som tredje argument sto ikke her, og fraværet var stille. Uten oversetteren
    // faller `describeApiError` tilbake på sin hardkodede engelske generiske tekst — så en
    // eierskapsfeil (`content_ownership`) ble engelsk på en side som ellers er trespråklig, mens
    // kurs- og modulimporten fikk den lokaliserte, handlingsrettede setningen.
    //
    // Feilklassen er verdt navnet: et VALGFRITT argument som stille degraderer kvaliteten. Ingenting
    // feiler, ingen test blir rød, teksten blir bare dårligere for én av tre flater.
    const d = describeImportError(error, { notAnEnvelope: L("notAnEnvelope") }, L);
    showToast(`${L("importSection")}: ${d.headline}`, "error", d.detail);
    document.getElementById("importSectionBtn")?.focus();
  } finally {
    if (input) input.value = "";
  }
}

// #1046 D3: Dupliser på seksjoner, på samme måte som på moduler (#348): eksportpakke → import som
// ny. Kopien får « (kopi)» på tittelen i alle språk og lander alltid som utkast — importen
// publiserer aldri ved ankomst (#916), så forfatteren må publisere selv etter gjennomgang.
async function duplicateSection(sectionId, btn) {
  if (btn) btn.disabled = true;
  try {
    const body = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}/export-package`, getHeaders);
    const envelope = body?.envelope ?? null;
    if (!envelope?.section) throw new Error("Eksport returnerte tom envelope.");
    const srcTitle = envelope.section.title;
    if (srcTitle && typeof srcTitle === "object") {
      envelope.section.title = Object.fromEntries(Object.entries(srcTitle).map(([l, v]) => [l, v ? `${v} (kopi)` : v]));
    } else if (typeof srcTitle === "string" && srcTitle) {
      envelope.section.title = `${srcTitle} (kopi)`;
    }
    const result = await apiFetch("/api/admin/content/sections/import", getHeaders, {
      method: "POST",
      body: JSON.stringify({ payload: envelope, mode: "createNew" }),
    });
    if (!result?.sectionId) throw new Error("Import-respons mangler sectionId.");
    showToast(L("duplicated"));
    await renderListView();
  } catch (err) {
    apiErrorToast(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteSection(sectionId) {
  if (!window.confirm(L("confirmDelete"))) return;
  try {
    await apiFetch(`/api/admin/content/sections/${encodeURIComponent(sectionId)}`, getHeaders, { method: "DELETE" });
    showToast(L("deleted"));
    goTo("list");
  } catch (err) {
    apiErrorToast(err);
  }
}

// ---------------------------------------------------------------------------
// Editor view
// ---------------------------------------------------------------------------

let editing = null; // { id, title:{}, body:{}, editLocale }
let previewTimer = null;

// ---------------------------------------------------------------------------
// Det åpnede elementet: den felles skjemasida (form-page.js). #1046 nivå to.
// ---------------------------------------------------------------------------

let formPage = null;

function sectionFormTexts() {
  const opphav = detectRoute().returnTo;
  return {
    // ⚠️ #1052: TEKSTEN MÅ FØLGE MÅLET. «← Tilbake» som sender deg til lista når du kom fra et kurs
    // er samme slags løgn som #1029 ryddet bort.
    back: opphav ? L("backToCourse") : L("back"),
    typeLabel: L("typeLabel"), untitled: L("untitled"),
    savedAll: L("savedAll"), unsaved: L("unsaved"), save: L("save"), cancel: L("cancel"),
    leaveConfirm: L("leaveConfirm"), contentLocale: L("contentLocale"), required: L("required"),
  };
}

function goBackFromEditor() {
  const opphav = detectRoute().returnTo;
  // ⚠️ IKKE `history.back()`. Kursets elementliste åpner med `target="_blank"`, og i en fersk fane
  // finnes ingen historikk å gå tilbake i — da ville knappen ikke gjort noe i det hele tatt.
  if (opphav) location.href = opphav;
  else goTo("list");
}

function getFormPage() {
  if (formPage) return formPage;
  formPage = createFormPage({
    host: pageContent,
    texts: sectionFormTexts,
    onBack: goBackFromEditor,
    title: () => (editing?.title?.[editing.editLocale] ?? "").trim() || pickLocalizedText(editing?.title ?? {}, currentLocale),
    item: () => (editing?.id ? { lifecycle: editorSectionStatus() } : null),
    t: tNav,
    actions: () => sectionActions(),
    languages: {
      locales: EDITOR_LOCALES, labels: localeLabels, required: "nb",
      current: () => editing?.editLocale ?? currentLocale,
      onChange: (loc) => { captureInputs(); editing.editLocale = loc; renderEditorFields(); getFormPage().refreshTitle(); },
    },
    body: () => sectionEditorBodyHtml(),
    save: { onSave: () => persistSection(), onCancel: goBackFromEditor },
    afterRender: () => bindEditorHandlers(),
  });
  formPage.installGuards();
  return formPage;
}

// Handlingsraden i hodet (F1/F2): det lista kan, kan det åpnede elementet også — pluss det som bare
// finnes her (Oversett, Erstatt fra fil, Last opp bilde er inne i skjemaet).
function sectionActions() {
  if (!editing) return [];
  const status = editorSectionStatus();
  const id = editing.id ? escapeHtml(editing.id) : "";
  // Rekkefølge som i lista (D2): det man gjør ofte først, det farlige sist — tre vises, resten under «Mer».
  return [
    `<button type="button" class="row-action-btn" id="translateBtn" data-editor-action="translate">${escapeHtml(L("translate"))}</button>`,
    id ? `<button type="button" class="row-action-btn" data-editor-action="export">${escapeHtml(L("exportSection"))}</button>` : "",
    id && status && status !== "archived"
      ? (status === "published"
        ? `<button type="button" class="row-action-btn" id="sectionLifecycleBtn" data-editor-action="unpublish">${escapeHtml(L("unpublish"))}</button>`
        : `<button type="button" class="row-action-btn" id="sectionLifecycleBtn" data-editor-action="publish">${escapeHtml(L("publish"))}</button>`)
      : "",
    id ? `<button type="button" class="row-action-btn" id="replaceFromFileBtn" data-editor-action="replace">${escapeHtml(L("replaceFromFile"))}</button>` : "",
    id && status ? (status === "archived"
      ? `<button type="button" class="row-action-btn" data-editor-action="restore">${escapeHtml(L("restore"))}</button>`
      : `<button type="button" class="row-action-btn" data-editor-action="archive">${escapeHtml(L("archive"))}</button>`) : "",
    // #1046 D3: sletting bor her, ikke i lista — og bare for en arkivert seksjon.
    id && status === "archived" ? `<button type="button" class="row-action-btn destructive" id="sectionDeleteBtn" data-editor-action="delete">${escapeHtml(L("del"))}</button>` : "",
  ];
}

function sectionEditorBodyHtml() {
  const sectionId = editing?.id ?? null;
  return `
    ${sectionId ? `<div id="ownerPanelHost" class="card" style="margin-bottom:var(--space-2)" data-form-untracked></div>` : ""}
    <div class="section-editor card">
      <div class="form-field">
        <label for="titleInput">${escapeHtml(L("titleLabel"))}${editing.editLocale === "nb" ? ` <span class="required-note">${escapeHtml(L("required"))}</span>` : ""}</label>
        <input type="text" id="titleInput" data-form-title value="${escapeHtml(editing.title[editing.editLocale])}" autocomplete="off" />
      </div>
      <div class="editor-cols">
        <div>
          <div class="editor-pane-label" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span>${escapeHtml(L("markdown"))}</span>
            <span data-form-untracked>
              <button type="button" id="uploadImageBtn" class="btn btn-secondary" style="width:auto;font-size:12px;padding:2px 8px">${escapeHtml(L("uploadImage"))}</button>
              <input type="file" id="imageFileInput" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg" hidden />
            </span>
          </div>
          <textarea id="markdownInput">${escapeHtml(editing.body[editing.editLocale])}</textarea>
        </div>
        <div>
          <div class="editor-pane-label">${escapeHtml(L("preview"))}</div>
          <div class="preview-pane" id="previewPane"></div>
        </div>
      </div>
      <input type="file" id="replaceFromFileInput" accept="application/json,.json" hidden data-form-untracked />
      <span class="editor-status" id="editorStatus"></span>
    </div>`;
}

function bindEditorHandlers() {
  // Handlingsraden i hodet.
  pageContent.querySelector(".form-page-actions")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-editor-action]");
    if (!btn || !editing) return;
    const action = btn.dataset.editorAction;
    if (action === "translate") return translateFromCurrent();
    if (action === "replace") return document.getElementById("replaceFromFileInput")?.click();
    if (!getFormPage().confirmLeave()) return;
    if (action === "export") return exportSectionPackage(editing.id, btn);
    if (action === "publish" || action === "unpublish") return toggleSectionLifecycle(action, btn);
    if (action === "archive") { if (window.confirm(L("confirmArchive"))) await lifecycleInEditor("archive", "archived"); return; }
    if (action === "restore") return lifecycleInEditor("restore", "restored");
    if (action === "delete") return deleteSection(editing.id);
  });
  document.getElementById("replaceFromFileInput")?.addEventListener("change", (event) => replaceSectionFromFile(event.target));
  document.getElementById("titleInput")?.addEventListener("input", captureInputs);
  document.getElementById("markdownInput")?.addEventListener("input", () => { captureInputs(); schedulePreview(); });
  document.getElementById("uploadImageBtn")?.addEventListener("click", () => {
    document.getElementById("imageFileInput")?.click();
  });
  document.getElementById("imageFileInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadImage(file);
  });
  refreshPreview();
  // #787: content-owner management for an existing section (new sections have no id yet).
  if (editing?.id) {
    const ownerHost = document.getElementById("ownerPanelHost");
    if (ownerHost) renderOwnerPanel({ container: ownerHost, contentType: "SECTION", contentId: editing.id, getHeaders, t: tNav }).catch(() => {});
  }
}

async function lifecycleInEditor(action, toastKey) {
  try {
    const data = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/${action}`, getHeaders, { method: "POST" });
    editing.archivedAt = data.section?.archivedAt ?? (action === "archive" ? new Date().toISOString() : null);
    editing.activeVersionId = data.section?.activeVersionId ?? editing.activeVersionId;
    showToast(L(toastKey));
    refreshSectionLifecycleUI();
  } catch (err) {
    apiErrorToast(err);
  }
}

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
      pageContent.innerHTML = `<div class="empty-state"><p class="empty-state-title">${escapeHtml(apiErrorText(err))}</p></div>`;
      return;
    }
  }
  const page = getFormPage();
  page.render();
  page.markClean();
  if (!sectionId) document.getElementById("titleInput")?.focus();
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
  // Statusmerket og handlingsraden bor i skjemasidas hode; tegn det på nytt.
  if (formPage && editing) formPage.refreshHeader();
}

async function toggleSectionLifecycle(action, btn) {
  if (!editing?.id || !btn) return;
  btn.disabled = true;
  try {
    const data = await apiFetch(`/api/admin/content/sections/${encodeURIComponent(editing.id)}/${action}`, getHeaders, { method: "POST" });
    editing.activeVersionId = data.section?.activeVersionId ?? null;
    editing.archivedAt = data.section?.archivedAt ?? null;
    showToast(L(action === "publish" ? "published" : "unpublished"));
    refreshSectionLifecycleUI();
  } catch (err) {
    // #916: same gate rendering as the list's Publiser — both are the same door.
    const gate = translationGateMessage("gateBlocked", gateIssuesFrom(err));
    if (gate) showToast(gate, "error"); else apiErrorToast(err);
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
    // #814: server-sanitised (F3/X1) preview HTML re-sanitised client-side (defense-in-depth) before sink.
    pane.innerHTML = sanitizeSectionHtml(data.html);
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
    let heldBack = null;
    if (!editing.id) {
      const data = await apiFetch("/api/admin/content/sections", getHeaders, {
        method: "POST",
        body: JSON.stringify({ title, bodyMarkdown }),
      });
      editing.id = data.section.id;
      editing.activeVersionId = data.section.activeVersionId ?? null;
      editing.archivedAt = data.section.archivedAt ?? null;
      heldBack = data.translationGate?.heldBack ? data.translationGate.issues : null;
      history.replaceState({}, "", `/admin-content/sections?id=${encodeURIComponent(editing.id)}`);
      // Første lagring lager seksjonen: hodet får eierpanel, Eksporter osv. — tegn sida på nytt.
      getFormPage().render();
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
      editing.activeVersionId = contentRes.section?.activeVersionId ?? null;
      heldBack = contentRes.translationGate?.heldBack ? contentRes.translationGate.issues : null;
    }
    // #705: hold status-merkelappen + Publiser/Avpubliser-knappen i editoren i synk etter lagring.
    refreshSectionLifecycleUI();
    // #916: the save always lands, but the publish gate may have held the activation back. Saying
    // only "Lagret" would let the author believe participants can read text that is not live.
    const gateMessage = heldBack ? translationGateMessage("gateHeldBack", heldBack) : null;
    if (gateMessage) {
      showToast(gateMessage, "error");
      if (status) status.textContent = gateMessage;
      return true;
    }
    if (!silent) {
      showToast(L("saved"));
      if (status) status.textContent = L("saved");
    }
    return true;
  } catch (err) {
    apiErrorToast(err);
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
  const controls = ["translateBtn", "formSaveBtn", "titleInput", "markdownInput", "formBackLink"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const tabs = Array.from(document.querySelectorAll("[data-form-locale]"));
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
        apiErrorToast(assetErr);
      }
    }
    showToast(L("translated"));
    renderEditorFields();
    getFormPage().markDirty();
  } catch (err) {
    apiErrorToast(err);
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
    apiErrorToast(err);
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
