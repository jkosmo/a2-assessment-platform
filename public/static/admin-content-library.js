import { createDateFormatter } from "./format-display.js";
const formatDate = createDateFormatter(() => currentLocale);
import { escapeHtml } from "./html-escape.js";
import { createListPage } from "./list-page.js";
import { lifecycleBadge, lifecycleOf } from "./content-status-badge.js";
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
import { initConsentGuard } from "/static/consent-guard.js";
import {
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";
import { describeImportError } from "/static/import-error.js";
import { describeApiError } from "/static/api-error.js";
import { showToast } from "/static/toast.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";

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

// #972: fem toaster og fire tekstfelt her viste `err.message` — altså `"<status>: <hele
// JSON-kroppen>"` fra apiFetch. De norske `?? "Kunne ikke arkivere modul."`-fallbackene var død
// kode: apiFetch setter ALLTID `message`, så de kunne aldri kjøre. Nå slås KODEN opp.
// Forfatterflate, så diagnostikken beholdes i toastens detaljfelt.
function apiErrorToast(error) {
  const { headline, detail } = describeApiError(error, t);
  showToast(headline, "error", detail);
}

function apiErrorText(error) {
  return describeApiError(error, t).headline;
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
// v1.2.11: Rydd upubliserte (kun ADMINISTRATOR).
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

let allModules = []; // siste hentede liste — slås opp av «Brukt i kurs»-popoveren.
// #1046: lista er den felles listesida (list-page.js). Her ligger bare oppskriften for moduler.
let listPage = null;
// v1.2.12 (#348): pendingCreateTarget fjernet — én create-path, alltid Samtale.

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

// v1.2.17: bruk i18n-keyene fra adminContent.promptDialog.certificationLevel{Basic,
// Intermediate,Advanced} i stedet for hardkodet engelsk. "Foundation" var dead-code —
// skjemaet aksepterer kun basic/intermediate/advanced.
const CERT_I18N_KEYS = {
  basic: "adminContent.promptDialog.certificationLevelBasic",
  intermediate: "adminContent.promptDialog.certificationLevelIntermediate",
  advanced: "adminContent.promptDialog.certificationLevelAdvanced",
};

function certBadge(level) {
  if (!level) return `<span class="cert-badge">—</span>`;
  // level kan være en literal string ("intermediate"), en JSON-encoded locale-object
  // (importerte moduler), eller en allerede-lokalisert streng fra serverens
  // localizeContentText. Vi normaliserer til enum-key og slår opp i18n; om vi ikke
  // klarer å normalisere, vis verdien som den er (fallback for legacy-data).
  let normalized = null;
  if (typeof level === "string") {
    const lower = level.toLowerCase().trim();
    if (lower in CERT_I18N_KEYS) {
      normalized = lower;
    } else if (lower.startsWith("{")) {
      // Locale-object lagret som JSON-string — prøv å parse og finne en kjent enum-verdi.
      try {
        const obj = JSON.parse(level);
        const candidates = Object.values(obj).filter(v => typeof v === "string");
        const match = candidates.find(v => v.toLowerCase().trim() in CERT_I18N_KEYS);
        if (match) normalized = match.toLowerCase().trim();
      } catch { /* fall through to raw display */ }
    }
  }
  const label = normalized ? t(CERT_I18N_KEYS[normalized]) : String(level);
  return `<span class="cert-badge">${escapeHtml(label)}</span>`;
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
// Lista (den felles listesida)
// ---------------------------------------------------------------------------

function getListPage() {
  if (listPage) return listPage;
  listPage = createListPage({
    host: libraryContent,
    ids: { tbody: "libraryTableBody", search: "librarySearch", courseFilter: "libraryCourseFilter" },
    texts: {
      title: "Moduler",
      lead: "Vurderingsmoduler du kan redigere, publisere og bruke i kurs.",
      searchPlaceholder: "Søk på modulnavn eller modul-ID…",
      searchLabel: "Søk i modulbiblioteket",
      filterGroupLabel: "Filtrer moduler",
      courseFilterLabel: "Kurs:", courseFilterAll: "Alle kurs", courseFilterNone: "Ikke i noe kurs",
      empty: "Ingen moduler ennå.",
      emptyFiltered: "Ingen moduler matcher søket.",
      loadError: "Kunne ikke laste moduler.",
    },
    headerActions: [
      { id: "importModulePackageBtn", label: "Importer modul" },
      { id: "createModuleBtn", label: "Ny modul", kind: "primary" },
    ],
    headerExtraHtml: `<input id="importModulePackageFile" type="file" accept="application/json,.json" hidden />`,
    // #1046 B2: samme rekkefølge som Kurs og Seksjoner; modulens egen «Har upublisert utkast» sist.
    // Default «Aktive», så forfatterne lander på det som er aktuelt nå.
    // v1.2.20 (#460): «Har upublisert utkast» dekker både aldri publisert OG live med et nyere utkast —
    // regelen bor i matchesLifecycleFilter (content-status-badge.js), felles for alle listene.
    filters: {
      options: [["all", "Alle"], ["active", "Aktive"], ["published", "Publiserte"], ["archived", "Arkiverte"], ["unpublished_draft", "Har upublisert utkast"]],
      initial: "active",
    },
    // #745: kursfilteret bygges av modulenes egne `courses`.
    courseFilter: { coursesOf: (m) => m.courses ?? [] },
    search: { matches: (m, q) => (m.title ?? "").toLowerCase().includes(q) || m.id.toLowerCase().includes(q) },
    sort: { key: "title", dir: "asc", locale: () => currentLocale },
    columns: [
      { key: "title", label: "Navn", className: "col-name", sortValue: (m) => m.title ?? "", render: (m) => escapeHtml(m.title ?? m.id) },
      { key: "status", label: "Status", className: "col-status", render: (m) => lifecycleBadge(m, t) },
      { key: "level", label: "Sertifiseringsnivå", className: "col-level", render: (m) => certBadge(m.certificationLevel) },
      { key: "courses", label: "Brukt i kurs", className: "col-courses", sortValue: (m) => m.courseCount ?? 0, render: (m) => (m.courseCount > 0
        ? `<button class="course-count-btn" data-module-id="${escapeHtml(m.id)}" aria-label="${m.courseCount} kurs">${m.courseCount}</button>`
        : `<span class="course-count-zero">0</span>`) },
      { key: "updatedAt", label: "Sist endret", className: "col-updated", sortValue: (m) => m.updatedAt ?? "", render: (m) => formatDate(m.updatedAt) },
    ],
    rowId: (m) => m.id,
    actions: (m) => {
      const openConvUrl = `/admin-content/module/${encodeURIComponent(m.id)}/conversation`;
      const lifecycle = lifecycleOf(m);
      const isArchived = lifecycle === "archived";
      // #787 slice 5: eier/admin styrer om redigerings-/livssyklus-handlingene vises (speiler eierskaps-
      // vakta). Dupliser/Eksporter beholdes — de er lese-/kopi-handlinger som ikke vaktes av eierskap.
      const canManage = m.canManage !== false;
      const id = escapeHtml(m.id);
      const title = escapeHtml(m.title ?? m.id);
      // v1.2.20 (#459): Avpubliser bare for moduler som er aktivt publisert.
      const isPublished = lifecycle === "published" || lifecycle === "published_with_draft";
      return [
        // #896 S3c: knappen sier hva den gjør — åpner modulen.
        canManage ? `<a href="${openConvUrl}" class="row-action-btn">Åpne</a>` : "",
        `<button class="row-action-btn" data-action="duplicate" data-module-id="${id}">Dupliser</button>`,
        `<button class="row-action-btn" data-action="export" data-module-id="${id}" data-module-title="${title}">Eksporter</button>`,
        canManage && isPublished ? `<button class="row-action-btn" data-action="unpublish" data-module-id="${id}" data-module-title="${title}">Avpubliser</button>` : "",
        // #705-UX: Slett vises kun for arkiverte moduler (terminal steg etter arkivering).
        canManage ? (isArchived
          ? `<button class="row-action-btn" data-action="restore" data-module-id="${id}">Gjenopprett</button>`
          : `<button class="row-action-btn" data-action="archive" data-module-id="${id}">Arkiver</button>`) : "",
        canManage && isArchived ? `<button class="row-action-btn destructive" data-action="delete" data-module-id="${id}" data-module-title="${title}">Slett</button>` : "",
        canManage ? "" : `<span class="row-readonly-note" title="Bare en eier eller en administrator kan åpne denne modulen.">Kun for eier</span>`,
      ];
    },
    emptyHtml: () => `
      <div class="empty-state">
        <p class="empty-state-title">Ingen moduler ennå</p>
        <p class="empty-state-text">Opprett den første modulen for å komme i gang.</p>
        <button class="btn btn-primary" id="emptyCreateBtn">Ny modul</button>
      </div>`,
    load: async () => {
      const data = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
      allModules = data.modules ?? [];
      return allModules;
    },
    onClick: (event) => {
      const btn = event.target.closest(".course-count-btn[data-module-id]");
      if (!btn) return false;
      showCoursesPopover(btn, btn.dataset.moduleId);
      return true;
    },
    describeError: (err) => apiErrorText(err),
    onAction: (_action, _id, btn) => handleTableClick(btn),
    afterRender: () => {
      document.getElementById("createModuleBtn")?.addEventListener("click", openCreateDialog);
      document.getElementById("emptyCreateBtn")?.addEventListener("click", openCreateDialog);
    },
  });
  return listPage;
}

// ---------------------------------------------------------------------------
// Table click handler
// ---------------------------------------------------------------------------

function handleTableClick(btn) {
  if (!btn) return;
  const moduleId = btn.dataset.moduleId;
  const action = btn.dataset.action;
  if (action === "archive") archiveModule(moduleId, btn);
  else if (action === "restore") restoreModule(moduleId, btn);
  else if (action === "delete") deleteModuleFromRow(moduleId, btn.dataset.moduleTitle ?? moduleId, btn);
  else if (action === "duplicate") duplicateModule(moduleId, btn);
  else if (action === "export") exportModulePackage(moduleId, btn.dataset.moduleTitle ?? moduleId, btn);
  else if (action === "unpublish") unpublishModuleFromRow(moduleId, btn.dataset.moduleTitle ?? moduleId, btn);
}

// #705-UX: slett en arkivert modul (terminal). Vaktet i backend — blokkeres med forklarende
// melding hvis modulen har avhengigheter eller brukes i et kurs.
async function deleteModuleFromRow(moduleId, moduleTitle, btn) {
  if (!window.confirm(`Slette modulen «${moduleTitle}» permanent? Dette kan ikke angres.`)) return;
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}`, getHeaders, { method: "DELETE" });
    showToast("Modul slettet.", "success");
    await loadModules();
  } catch (err) {
    apiErrorToast(err);
    btn.disabled = false;
  }
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
    const msg = apiErrorText(err);
    showToast(tf("adminContent.library.exportFailed", { reason: msg }), "error");
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
    apiErrorToast(err);
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
    apiErrorToast(err);
    btn.disabled = false;
  }
}

// v1.2.20 (#459): Avpubliser fra bibliotek-rad. Krever skrevet bekreftelse via
// window.confirm. POSTer til samme /unpublish-endepunkt som Avansert bruker.
async function unpublishModuleFromRow(moduleId, moduleTitle, btn) {
  const confirmed = window.confirm(
    `Avpubliser «${moduleTitle}»?\n\n` +
    `Modulen blir utilgjengelig for nye innleveringer. Eksisterende innleveringer ` +
    `går videre uforandret. Du kan publisere en versjon på nytt fra modulens Innstillinger.`
  );
  if (!confirmed) return;
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/unpublish`, getHeaders, { method: "POST" });
    showToast(`«${moduleTitle}» avpublisert.`, "success");
    await loadModules();
  } catch (err) {
    apiErrorToast(err);
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
    // v1.2.13: bytt fra /export (live editing-bundle) til /export-package — det er
    // sistnevnte som returnerer a2-content-export/v1-envelope-en /import faktisk forventer.
    const exportResult = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export-package`, getHeaders);
    const envelope = exportResult?.envelope ?? exportResult;
    if (!envelope || envelope.exportFormat !== "a2-content-export/v1" || !envelope.module) {
      throw new Error("Uventet eksport-format fra server.");
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

    // v1.2.14 (#456): autoPublish=false så kopien lander som "Upublisert utkast" uansett
    // om kilden var publisert. Forfatter skal eksplisitt publisere etter gjennomgang.
    const importResult = await apiFetch("/api/admin/content/modules/import", getHeaders, {
      method: "POST",
      body: JSON.stringify({ payload: envelope, mode: "createNew", autoPublish: false }),
    });
    if (!importResult?.moduleId) throw new Error("Import-respons mangler moduleId.");

    showToast(`Full kopi av «${sourceTitle}» opprettet.`, "success");
    await loadModules();
  } catch (err) {
    apiErrorToast(err);
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
    purgeError.textContent = `Klarte ikke hente forhåndsvisning: ${apiErrorText(error)}`;
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
      showToast(`Slettet ${deleted} upubliserte moduler.`);
    }
    await loadModules();
  } catch (error) {
    purgeError.hidden = false;
    purgeError.textContent = `Sletting feilet: ${apiErrorText(error)}`;
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
    // #930: tittelen sendes med språkmerke. Biblioteket har alltid sendt en ren streng, og en ren
    // streng leses som bokmål av `missingLocalesFor` — så en tittel skrevet på engelsk ble lagret
    // som norsk, og publiseringsgaten navnga feil språk som manglende.
    //
    // Denne skjermen har ingen egen innholdsspråk-velger; den skriver på grensesnittspråket.
    const body = await apiFetch("/api/admin/content/modules", getHeaders, {
      method: "POST",
      body: JSON.stringify({ title: { [currentLocale]: title }, certificationLevel: level }),
    });
    const newId = body.module?.id ?? body.id;
    if (!newId) throw new Error("Fikk ikke modul-ID.");

    createModuleDialog.close();
    window.location.href = `/admin-content/module/${encodeURIComponent(newId)}/conversation`;
  } catch (err) {
    createModuleError.textContent = apiErrorText(err);
    createModuleError.hidden = false;
    createOpenConversation.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Load modules
// ---------------------------------------------------------------------------

async function loadModules() {
  await getListPage().reload().catch(() => undefined);
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
    const me = await initConsentGuard(getHeaders, currentLocale);
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

  // v1.2.11: Rydd upubliserte — kun ADMINISTRATOR ser knappen.
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
  // #1046: hodet tegnes av listesida, så lytterne delegeres fra verten (overlever ny tegning).
  libraryContent.addEventListener("click", (event) => {
    if (event.target.closest("#importModulePackageBtn")) document.getElementById("importModulePackageFile")?.click();
  });
  libraryContent.addEventListener("change", async (event) => {
    if (event.target?.id !== "importModulePackageFile") return;
    const importModulePackageBtn = document.getElementById("importModulePackageBtn");
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
      // Friendly guard: a course package can't be imported here — point the author to the Kurs page
      // instead of surfacing the raw scope_mismatch 400 (#563-relatert UX-funn).
      if (payload?.scope === "course") {
        throw new Error("Dette er en kurs-pakke. Importer den fra Kurs-siden med «Importer kurs-pakke».");
      }
      // #896: importerte moduler skal alltid lande som UTKAST — publisering er en eksplisitt
      // handling forfatteren gjør etter gjennomgang, på samme måte som ved kursimport. Uten
      // autoPublish:false gikk en pakke rett live så snart kilden hadde vært publisert, før noen
      // hadde sett på den i denne installasjonen.
      const result = await apiFetch("/api/admin/content/modules/import", getHeaders, {
        method: "POST",
        body: JSON.stringify({ payload, mode: "createNew", autoPublish: false }),
      });
      if (!result?.moduleId) throw new Error("Import-respons mangler moduleId.");
      showToast("Modul-pakken er importert som utkast. Gå gjennom den og publiser når den er klar.");
      // #896: land i arbeidsrommet, ikke i Avansert. Avansert-siden skal bort (S3c), og å sende
      // forfatteren dit rett etter en import ga dem den ene flaten epicen forsøker å avvikle —
      // og den uten publiseringsgatens utbedringshandling. Rapportert fra stage 2026-08-16.
      window.location.href = `/admin-content/module/${encodeURIComponent(result.moduleId)}/conversation`;
    } catch (error) {
      // #937: samme lesbare feil som seksjonsimporten, via den delte oversetteren.
      const d = describeImportError(error, {
        notAnEnvelope: t("adminContent.library.importNotAnEnvelope"),
      }, t);
      showToast(tf("adminContent.library.importFailed", { reason: d.headline }), "error", d.detail);
      // v1.2.18 (#458): toast har role="alert" så SR annonserer feilen. I tillegg flytter
      // vi fokus tilbake til importbtn så tastatur-bruker kan re-trigge uten å Tab-e fra
      // den (nå tomme) file-input-en.
      importModulePackageBtn?.focus();
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
