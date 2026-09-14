import { escapeHtml } from "./html-escape.js";
import { rowActionsHtml, installRowMoreMenus } from "./row-actions.js";
import { lifecycleBadge } from "./content-status-badge.js";
import { createFormPage } from "./form-page.js";
import { createSettingsTab } from "./admin-content-settings-tab.js";
import { LEGACY_STRING_LOCALE, mergeLocaleInto } from "./localized-value.js";
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
import { apiErrorCodeText, describeApiError } from "/static/api-error.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { localizeValueForLocale, buildPreviewHtml, hydratePreviewMarkdown } from "/static/admin-content-preview.js";
import { sanitizeSectionHtml } from "/static/sanitize.js";
import {
  buildCriteriaEditorHtml,
  buildEditorStateFromCriteriaRecord,
  captureLatestCriteriaState,
  buildDriftDiffModalHtml,
  computeCriteriaDiff,
  driftText,
  humaniseCriterionId,
} from "/static/criteria-editor.js";
import { setHidden } from "/static/dom-visibility.js";
import { hashBlueprintAsync, classifyDriftState } from "/static/admin-content-blueprint-hash.js";
import {
  classifyShellEditInstruction,
  detectShellRevisionTargets,
  deriveShellModuleActionModel,
  deriveShellDraftReadyActionModel,
} from "/static/admin-content-shell-state.js";
import { deriveModuleStatusChains } from "/static/module-status-logic.js";
import { renderOwnerPanel } from "/static/owner-panel.js";
import { loadVersion } from "/static/admin-content-shared.js";
import {
  buildLocalizedCopyValue,
  selectTranslatedDraftFields,
  applyMcqTranslation,
  dropMcqQuestionLocale,
  mcqCorrectAnswerIndexes,
  normalizeModuleTitlePatch,
  strictLocaleValue,
} from "/static/admin-content-localized-copy.js";

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

function t(key) {
  const map = adminContentTranslations[currentLocale] ?? adminContentTranslations["en-GB"] ?? {};
  return map[key] ?? key;
}

// #972: samtale-skallet flettet `String(err?.message ?? err)` inn i chat-loggen 19 steder. Det
// er "<status>: <hele JSON-kroppen>" fra apiFetch — rå JSON midt i en samtale, på serverens språk.
// `apiErrorText` slår opp KODEN i den delte tabellen (api-error.js) og gir en setning på
// forfatterens språk. En feil klienten selv kastet slipper uendret gjennom: den teksten er vår.
function apiErrorText(error) {
  return describeApiError(error, t).headline;
}

// Template translation: replaces {varName} placeholders in the translated string.
function tf(key, vars) {
  let str = t(key);
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(`{${k}}`, String(v));
  }
  return str;
}

function localizeValue(value) {
  return localizeValueForLocale(value, contentLocale);
}

function parsePositiveIntInRange(rawValue, min, max) {
  const value = Number.parseInt(String(rawValue).trim(), 10);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

/**
 * Like the above, but a whole number OR NOTHING — never a silent truncation.
 *
 * `Number.parseInt("72.5")` is 72, so a field that told the author "must be a whole number"
 * quietly accepted 72.5 and saved 72 instead. A threshold the author did not choose is worse than
 * a rejected one: they read 72.5 on screen, and the module scores against 72.
 */
function parsePercentInRange(rawValue, min, max) {
  const raw = String(rawValue).trim();
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// session state: 'idle' | 'picking-module' | 'loading-module' | 'module-loaded' |
//                'draft-pending' | 'generating' | 'awaiting-confirmation' | 'saving'
let sessionState = "idle";
let modules = [];
let selectedModuleId = null;
let bundle = null;
/**
 * The language the author is AUTHORING in — separate from `currentLocale`, which is the language
 * of the menus and buttons.
 *
 * Stage-tilbakemelding 2026-08-17: *"Står i preview på bokmål, endrer UI til nynorsk, navigerer så
 * til rediger, bokmål er fortsatt aktivt. Vi må tenke gjennom hvordan skift av språk for UI, og
 * skifte av språk i innholdsproduksjon samhandler."*
 *
 * Two things were wrong. The variable was called `previewLocale` and presented as a preview
 * setting, while it actually governed the preview pane, Rediger AND every generation request —
 * everything except Innstillinger, which used the UI language instead. And it FOLLOWED the UI
 * language until the author touched it, then silently stopped following. Whether a language switch
 * moved the content with it therefore depended on something the author did ten minutes earlier and
 * cannot see.
 *
 * The model now: one content language, chosen explicitly, governing all three surfaces. It never
 * follows the UI language. It starts as the UI language because a new author is almost always
 * authoring in the language they read.
 */
let contentLocale = currentLocale;

// #930: en tittel skrevet i ÉTT språk skal sendes som {[contentLocale]: tittel} — ikke som en ren
// streng.
//
// ⚠️ En ren streng bærer ikke noe språkmerke, og `missingLocalesFor` leser den som bokmål.
// Oppretter forfatteren en modul mens arbeidsflaten står på engelsk, lagres «Incident response»
// som norsk: publiseringsgaten melder at en-GB og nn mangler, når det er nb og nn som mangler, og
// «oversett det som mangler» oversetter til feil språk fra en kilde den tror er norsk.
//
// Er verdien allerede et kart, står den urørt — den bærer sitt eget språk fra før.
function titleInContentLocale(value) {
  if (value && typeof value === "object") return value;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return value;
  return { [contentLocale]: text };
}

// Generation state
let generationAbort = null; // AbortController for active generation

// Draft state — sessionDraft mirrors what will be saved; null until user accepts a generated result
let sessionDraft = null; // { taskText, assessorExpectedContent, candidateTaskConstraints, mcqQuestions: [] }
let previewDraft = null; // review candidate shown in preview before accept
let latestSavedModuleVersionId = null;

// B3 (#450): cache for the current blueprint's hash. Recomputed via refreshBlueprintHash()
// after bundle load and blueprint changes. Compared against the active rubric's stored hash
// (in scalingRule.generated_from_blueprint_hash) to detect drift.
let currentBlueprintHash = null;

// v1.1.81: tracks whether criteria-generation is in flight for the current sessionDraft.
// Used by renderPreview to show a "Vurderingskriterier genereres…" placeholder. Reset
// whenever sessionDraft is replaced (commitSessionDraftPatch / loadModule).
let criteriaGenerationInFlight = false;

// v1.1.92: when enterPreviewEditMode is active, this callback receives the freshly-generated
// criteria record so the in-progress edit-form can populate its criteria-editor state without
// the whole preview being re-rendered (which would wipe the edit form). Set by
// enterPreviewEditMode, cleared by exitEditMode, fired by populateSessionDraftCriteriaInBackground.
let criteriaReadyCallback = null;

// #1046 steg 2 (produkteier 13.09): samtaleruta er borte. Det som var «logg» er nå tre ting:
//   - framdrift og utfall → toast (showToast), med «Avbryt» når noe kan avbrytes
//   - et spørsmål som trenger svar → valgdialogen (#dialogChoice)
//   - kildemateriale og plan → «Generer innhold»-dialogen; en instruks → «Be om endring»-dialogen
// Funksjonsnavnene logBot/logProgress/logResolveSlot står igjen på kallstedene med samme signatur.


// ---------------------------------------------------------------------------
// Framdrift, utfall og spørsmål — uten samtalerute
// ---------------------------------------------------------------------------

/** Én valgdialog for alt som trenger et svar: HTML øverst, knappene under. */
function showChoiceDialog(htmlFn, choices) {
  const dialog = document.getElementById("dialogChoice");
  const body = document.getElementById("dialogChoiceBody");
  const actions = document.getElementById("dialogChoiceActions");
  if (!dialog || !body || !actions) return;
  body.innerHTML = htmlFn();
  actions.innerHTML = "";
  const hasCancel = choices.some((c) => c.labelKey === "shell.action.cancel");
  const all = hasCancel ? choices : [...choices, { labelKey: "shell.action.cancel", action: () => {} }];
  all.forEach((choice, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = index === 0 && choice.labelKey !== "shell.action.cancel" ? "btn-primary" : "btn-secondary";
    btn.textContent = resolveChoiceLabel(choice);
    btn.addEventListener("click", () => { dialog.close(); choice.action?.(); });
    actions.appendChild(btn);
  });
  if (!dialog.open) dialog.showModal();
}

/** Beskjed uten spørsmål → toast. Med valg → valgdialogen. */
function logBot(htmlFn, choices = []) {
  if (choices.length > 0) { showChoiceDialog(htmlFn, choices); return; }
  const text = htmlToPlainText(htmlFn());
  if (text) { showToast(text, "info"); announceStatus(text); }
}

/** Framdrift → en toast som står til den løses; «Avbryt» når kalleren har hengt på en lytter. */
function logProgress(textKeyOrFn, options = {}) {
  const text = typeof textKeyOrFn === "function" ? textKeyOrFn() : t(textKeyOrFn);
  announceStatus(text);
  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
  const el = document.createElement("div");
  const toast = options.quiet ? null : showToast(text, "info", "", options.abortable
    ? { sticky: true, actionLabel: t("shell.action.cancel"), onAction: () => abortBtn.click() }
    : { sticky: true });
  return { entry: { quiet: !!options.quiet }, el, abortBtn, toast };
}

/** Utfallet: toasten for framdriften fjernes; svaret vises — som toast, eller som spørsmål. */
function logResolveSlot(slot, htmlFn, choices = []) {
  slot?.toast?.remove();
  if (choices.length > 0) { showChoiceDialog(htmlFn, choices); return; }
  const text = htmlToPlainText(htmlFn());
  if (!text) return;
  announceStatus(text);
  if (slot?.entry?.quiet) return;
  showToast(text, /feil|error|failed|avvist|refus|kunne ikke|could not|mislyktes/i.test(text) ? "error" : "info");
}

// Identity / headers
let participantRuntimeConfig = {
  navigation: { workspaceItems: [], profileItem: null },
  authMode: "mock",
  identityDefaults: {
    userId: "content-owner-1",
    email: "content.owner@company.com",
    name: "Platform Content Owner",
    department: "Learning",
    roles: ["SUBJECT_MATTER_OWNER"],
  },
};
let activeUserRoles = [];

function getHeaders() {
  const d = participantRuntimeConfig.identityDefaults ?? {};
  return buildConsoleHeaders({
    userId: d.userId ?? "content-owner-1",
    email: d.email ?? "content.owner@company.com",
    name: d.name ?? "Platform Content Owner",
    department: d.department ?? "Learning",
    roles: Array.isArray(d.roles) ? d.roles.join(",") : (d.roles ?? "SUBJECT_MATTER_OWNER"),
    locale: currentLocale,
  });
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const previewPane = document.getElementById("previewPane");
const previewContent = document.getElementById("previewContent");
// #1046 (14.09): hodet — tilbake-lenke, handlingsrad med Lagre/Avbryt, navn, statusmerker,
// språkpiller og fanelinje — tegnes av form-page.js, som på kurs, seksjon og klasse. Panelene
// under (forhåndsvisning/skjema, innstillinger) ligger utenfor og styres herfra. Se `createModuleFormPage`.
const moduleFormHost = document.getElementById("moduleFormHead");
let formPage = null;
// Shown on Rediger only — see the tab handler.
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const appVersionLabel = document.getElementById("appVersion");
const uiLocaleSelect = document.getElementById("localeSelect");
const tabPanelModule = document.getElementById("tabPanelModule");
const tabPanelSettings = document.getElementById("tabPanelSettings");
const shellStatusAnnouncer = document.getElementById("shellStatusAnnouncer");

/**
 * #1052: hvor «tilbake» skal føre når forfatteren kom hit fra et kurs.
 *
 * ⚠️ VALIDERES SOM I `admin-content-sections-state.js`. `returnTo` kommer fra URL-en, altså fra
 * hvem som helst som får en forfatter til å klikke. Bare en relativ sti under `/admin-content/`
 * slipper gjennom; `//vert` ser relativ ut men forlater siden.
 *
 * ⚠️ MODULFLATEN HAR INGEN EGEN TILBAKE-KNAPP. Denne brukes derfor bare av feilveiene under, der
 * valget står mellom «gå til modullista» og «gå tilbake dit du kom fra». Skal arbeidsflaten få en
 * varig tilbake-lenke, er det en UI-avgjørelse produkteier må ta — se #1052.
 */
function opphavFraUrl() {
  const v = new URLSearchParams(location.search).get("returnTo");
  if (typeof v !== "string" || !v.startsWith("/admin-content/")) return null;
  if (v.startsWith("//") || v.startsWith("/\\")) return null;
  return v;
}



// #479 Slice A: must match SOURCE_MATERIAL_MAX_BYTES in
// src/modules/adminContent/sourceMaterialExtractionService.ts (server). Keep both at 10 MB —
// the client guard rejects oversize files before upload; the server enforces the real cap.
const SOURCE_MATERIAL_MAX_BYTES = 10 * 1024 * 1024;
// #454 Phase 3 (v1.2.3): 50K → 200K. v1.2.5: 200K → 1M. Begrunnelse: Phase 4 (auto-condense)
// komprimerer enhver source > 50K til ~30K før LLM-pipeline, så reell LLM-kost er bundet
// uavhengig av input-størrelse. 1M-cap'en eksisterer bare som sanity-grense for å unngå at
// brukeren paster inn 100MB tekst som låser nettleseren. Hvis du treffer 1M er det neppe
// fornuftig materiale uansett.
const SOURCE_MATERIAL_MAX_CHARS = 1_000_000;
const SOURCE_MATERIAL_ACCEPT =
  ".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.rtf,.odt,.odp,.ods,text/plain,text/markdown,text/x-markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/rtf,text/rtf,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.presentation,application/vnd.oasis.opendocument.spreadsheet";
const SOURCE_MATERIAL_ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".rtf",
  ".odt",
  ".odp",
  ".ods",
]);
const SOURCE_MATERIAL_ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

// ---------------------------------------------------------------------------
// Chat rendering — low-level DOM helpers (no logging)
// ---------------------------------------------------------------------------


function htmlToPlainText(html) {
  const fragment = document.createElement("div");
  fragment.innerHTML = html;
  return fragment.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

let announcerResetHandle = null;
function announceStatus(message) {
  if (!shellStatusAnnouncer || !message) return;
  if (announcerResetHandle) clearTimeout(announcerResetHandle);
  shellStatusAnnouncer.textContent = "";
  requestAnimationFrame(() => {
    shellStatusAnnouncer.textContent = message;
    announcerResetHandle = setTimeout(() => {
      shellStatusAnnouncer.textContent = "";
      announcerResetHandle = null;
    }, 1200);
  });
}



// #972/#985: returnerte `parsed.message || parsed.error` — altså serverens engelske setning, eller
// i verste fall den rå kodestrengen (`content_ownership`) som overskrift. Begge deler er brudd på
// «feilkoden er kontrakten, ikke teksten»: dette konsollet defaulter til en-GB og kjøres på tre
// språk. Nå slås koden opp i den delte tabellen; `fallbackKey` brukes bare når feilen ikke er en
// server-konvolutt i det hele tatt.
function parseApiErrorMessage(error, fallbackKey) {
  const described = describeApiError(error, t);
  // ⚠️ `code === null` betyr at feilen ikke er en server-konvolutt i det hele tatt — en FileReader
  // som feilet, en avbrutt fetch. Da er `headline` feilens egen, ofte interne, streng
  // («file_reader_failed»), og kallstedets `fallbackKey` er den eneste som er skrevet for et
  // menneske. Uten dette ville lokaliseringen av API-feilene kostet oss lokaliseringen av de andre.
  if (described.code === null) return t(fallbackKey);
  return described.headline;
}

function isSupportedSourceMaterialFile(file) {
  const normalizedName = String(file?.name ?? "").toLowerCase();
  const extension = normalizedName.includes(".")
    ? normalizedName.slice(normalizedName.lastIndexOf("."))
    : "";
  if (SOURCE_MATERIAL_ALLOWED_EXTENSIONS.has(extension)) {
    return true;
  }

  const normalizedType = String(file?.type ?? "").toLowerCase();
  return SOURCE_MATERIAL_ALLOWED_MIME_TYPES.has(normalizedType);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("file_reader_failed"));
        return;
      }
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      if (!base64) {
        reject(new Error("file_reader_failed"));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("file_reader_failed"));
    reader.readAsDataURL(file);
  });
}




// Build a choices row from an array of { labelKey, action } specs.
// disabled=true renders non-interactive buttons for past history.
function resolveChoiceLabel(choice) {
  return choice.label ?? t(choice.labelKey);
}





// Renders the interactive part of a form entry (input or textarea + submit button).
// Called both on first render and during retranslateChat for unsubmitted forms.
function _domFormFields(entry) {
  const wrap = document.createElement("div");
  const isMultiLine = entry.formType === "textarea" || entry.formType === "source-material";
  const isSourceMaterial = entry.formType === "source-material";
  wrap.className = isMultiLine ? "chat-form-col" : "chat-form-row";
  // #454 Phase 2: multi-fil-opplasting. Bytter fra ett objekt til en array slik at flere
  // filer kan stables i samme modul-opprettelse. Max 10 filer (rimelig grense; LLM-context
  // og 50K-tegn-grensen vil typisk binde lenge før).
  const uploadedFileSources = [];
  const MAX_FILE_UPLOADS = 10;

  let inputEl;
  if (isMultiLine) {
    inputEl = document.createElement("textarea");
    inputEl.className = "chat-textarea";
    inputEl.rows = 6;
  } else {
    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.className = "chat-text-input";
    inputEl.setAttribute("autocomplete", "off");
  }
  inputEl.placeholder = t(entry.placeholderKey);
  if (entry.initialValue) inputEl.value = entry.initialValue;

  // #454 Phase 1: track multiple fetched URL sources alongside the single file upload.
  // File upload remains one-at-a-time (existing constraint); URL fetching supports multiple
  // per session — both combined into the source material on submit.
  const fetchedUrlSources = [];

  if (isSourceMaterial) {
    // #360 a11y: wrap upload + textarea in a semantic group so screen readers announce
    // them as related controls. wrap is the outer chat-form-col which becomes the group.
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", t("shell.source.groupLabel"));

    const uploadRow = document.createElement("div");
    uploadRow.className = "chat-form-row";

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "btn-secondary chat-choice-btn";
    uploadBtn.textContent = t("shell.source.uploadBtn");

    // #454 Phase 1: button to fetch a URL (HTML/plain) and add its main content as source.
    const urlBtn = document.createElement("button");
    urlBtn.type = "button";
    urlBtn.className = "btn-secondary chat-choice-btn";
    urlBtn.textContent = t("shell.source.fetchUrlBtn");

    // #479 Slice B: crawl a whole site section (same-domain, up to 20 pages, 2 hops) instead of a
    // single page. Adds the combined main text of every crawled page as one source.
    const crawlBtn = document.createElement("button");
    crawlBtn.type = "button";
    crawlBtn.className = "btn-secondary chat-choice-btn";
    crawlBtn.textContent = t("shell.source.crawlUrlBtn");


    const uploadHint = document.createElement("span");
    uploadHint.className = "chat-form-help";
    uploadHint.textContent = t("shell.source.uploadHint");

    // v1.2.3 (#454 Phase 2.1): chip-liste i stedet for "·"-separert tekst, så hver kilde
    // får sin egen rad med × for fjerning. uploadHint vises kun når lista er tom.
    const sourceList = document.createElement("ul");
    sourceList.className = "source-chip-list";
    // #975: `.source-chip-list{display:flex}` (admin-content.html) slår `hidden`-attributtet, så
    // den tomme lista beholdt padding og luft over «Last opp»-hintet.
    setHidden(sourceList, true);

    const refreshUploadHint = () => {
      sourceList.innerHTML = "";
      const items = [
        ...uploadedFileSources.map((f, i) => ({ kind: "file", index: i, label: f.fileName })),
        ...fetchedUrlSources.map((s, i) => ({ kind: "url", index: i, label: s.hostname })),
      ];
      setHidden(sourceList, items.length === 0);
      setHidden(uploadHint, items.length > 0);
      for (const item of items) {
        const li = document.createElement("li");
        li.className = "source-chip";
        const label = document.createElement("span");
        label.className = "source-chip-label";
        label.textContent = item.label;
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "source-chip-remove";
        removeBtn.setAttribute("aria-label", tf("shell.source.removeSource", { label: item.label }));
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          if (item.kind === "file") uploadedFileSources.splice(item.index, 1);
          else fetchedUrlSources.splice(item.index, 1);
          refreshUploadHint();
        });
        li.appendChild(label);
        li.appendChild(removeBtn);
        sourceList.appendChild(li);
      }
    };

    urlBtn.addEventListener("click", async () => {
      const url = window.prompt(t("shell.source.urlPrompt"));
      if (!url || !url.trim()) return;
      const originalLabel = urlBtn.textContent;
      urlBtn.disabled = true;
      uploadBtn.disabled = true;
      // #555-oppfølging (forfatter-feedback): «Neste» var fortsatt klikkbar mens URL-en ble hentet
      // — uklart hva som skjedde. Deaktiver den til hentingen er ferdig.
      btn.disabled = true;
      urlBtn.textContent = t("shell.source.fetching");
      try {
        const result = await apiFetch(
          "/api/admin/content/source-material/fetch-url",
          getHeaders,
          { method: "POST", body: JSON.stringify({ url: url.trim() }) },
        );
        if (!result?.extractedText || !String(result.extractedText).trim()) {
          throw new Error(t("shell.source.fetchEmpty"));
        }
        fetchedUrlSources.push({
          hostname: String(result.sourceHostname ?? new URL(url.trim()).hostname),
          extractedText: String(result.extractedText).trim(),
        });
        refreshUploadHint();
        showToast(t("shell.source.fetchReady"), "success");
        inputEl.focus();
      } catch (error) {
        showToast(parseApiErrorMessage(error, "shell.source.fetchError"), "error");
      } finally {
        urlBtn.disabled = false;
        uploadBtn.disabled = false;
        btn.disabled = false;
        urlBtn.textContent = originalLabel;
      }
    });

    // #479 Slice B: crawl from a start URL. Combines every crawled page's main text into one
    // source entry, labelled with the hostname and page count.
    crawlBtn.addEventListener("click", async () => {
      const url = window.prompt(t("shell.source.crawlPrompt"));
      if (!url || !url.trim()) return;
      const originalLabel = crawlBtn.textContent;
      crawlBtn.disabled = true;
      urlBtn.disabled = true;
      uploadBtn.disabled = true;
      btn.disabled = true;
      crawlBtn.textContent = t("shell.source.crawling");
      try {
        const result = await apiFetch(
          "/api/admin/content/source-material/crawl-url",
          getHeaders,
          { method: "POST", body: JSON.stringify({ url: url.trim() }) },
        );
        const pages = Array.isArray(result?.pages) ? result.pages : [];
        if (pages.length === 0) {
          throw new Error(t("shell.source.crawlEmpty"));
        }
        const combined = pages
          .map((p) => `[${String(p.url ?? "")}]\n${String(p.extractedText ?? "").trim()}`)
          .join("\n\n---\n\n")
          .trim();
        if (!combined) {
          throw new Error(t("shell.source.crawlEmpty"));
        }
        const host = String(result.startHostname ?? new URL(url.trim()).hostname);
        fetchedUrlSources.push({
          hostname: tf("shell.source.crawlChip", { host, count: pages.length }),
          extractedText: combined,
        });
        refreshUploadHint();
        showToast(
          result.truncated
            ? tf("shell.source.crawlReadyTruncated", { count: pages.length })
            : tf("shell.source.crawlReady", { count: pages.length }),
          "success",
        );
        inputEl.focus();
      } catch (error) {
        showToast(parseApiErrorMessage(error, "shell.source.crawlError"), "error");
      } finally {
        crawlBtn.disabled = false;
        urlBtn.disabled = false;
        uploadBtn.disabled = false;
        btn.disabled = false;
        crawlBtn.textContent = originalLabel;
      }
    });

    // #455: external-LLM-handoff. Copies prompt + opens import modal. On successful
    // import, marks the form submitted (skipping the normal source→cert→generate path)
    // and lands user in draft-ready with module + sessionDraft populated.
    // #555: scenario velges nå ETTER kilde, så ved ekstern-LLM-handoff (som skjer på kilde-
    // steget) er scenario ennå ukjent — vi defaulter til "auto" og lar ekstern LLM avgjøre.

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = SOURCE_MATERIAL_ACCEPT;
    // v1.2.3 (#454 Phase 2.1): allow multi-select i fil-picker så bruker kan velge mange
    // filer i én operasjon. Behold "én ekstraksjon om gangen"-loopen siden parser-worker
    // håndterer én fil per job — minimerer endring i backend, gir også klarere progress.
    fileInput.multiple = true;
    fileInput.hidden = true;

    uploadBtn.addEventListener("click", () => fileInput.click());
    // v1.2.3: håndter en eller flere filer fra picker-en. Validerer hver fil for seg;
    // hopper over de som feiler (med toast) og fortsetter med resten.
    fileInput.addEventListener("change", async () => {
      const files = Array.from(fileInput.files ?? []);
      if (files.length === 0) return;

      // Filter ut filer som feiler validering, og varsle om dem før ekstraksjon starter
      const toExtract = [];
      for (const file of files) {
        if (uploadedFileSources.length + toExtract.length >= MAX_FILE_UPLOADS) {
          showToast(tf("shell.source.tooManyFiles", { max: MAX_FILE_UPLOADS }), "error");
          break;
        }
        if (!isSupportedSourceMaterialFile(file)) {
          showToast(`${t("shell.source.fileTypeInvalid")} (${file.name})`, "error");
          continue;
        }
        if (file.size > SOURCE_MATERIAL_MAX_BYTES) {
          showToast(`${t("shell.source.fileTooLarge")} (${file.name})`, "error");
          continue;
        }
        if (uploadedFileSources.some((f) => f.fileName === file.name) || toExtract.some((f) => f.name === file.name)) {
          showToast(tf("shell.source.duplicateFile", { fileName: file.name }), "error");
          continue;
        }
        toExtract.push(file);
      }
      if (toExtract.length === 0) {
        fileInput.value = "";
        return;
      }

      const originalLabel = uploadBtn.textContent;
      uploadBtn.disabled = true;
      urlBtn.disabled = true;
      // #555-oppfølging: hold «Neste» deaktivert mens filer ekstraheres (samme grunn som URL).
      btn.disabled = true;

      // v1.2.3: ekstrahérer filene sekvensielt. Sekvensielt er trygt for parser-worker
      // (én job om gangen, ingen pool-uttømming) og gir tydelig progress-status til bruker.
      // Knapp-label viser "Laster opp 2/5..." mens bruker ser progress.
      let processed = 0;
      for (const file of toExtract) {
        processed += 1;
        uploadBtn.textContent = toExtract.length === 1
          ? t("shell.source.uploading")
          : `${t("shell.source.uploading")} ${processed}/${toExtract.length}`;
        try {
          const contentBase64 = await readFileAsBase64(file);
          const { jobId } = await apiFetch(
            "/api/admin/content/source-material/extract",
            getHeaders,
            {
              method: "POST",
              body: JSON.stringify({
                fileName: file.name,
                mimeType: file.type || undefined,
                contentBase64,
              }),
            },
          );

          let poll;
          for (let i = 0; i < 30; i++) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            poll = await apiFetch(
              `/api/admin/content/source-material/extract/${jobId}`,
              getHeaders,
            );
            if (poll.status === "done" || poll.status === "failed") break;
          }
          if (!poll || poll.status === "pending") throw new Error("parse_timeout");
          if (poll.status === "failed") throw new Error(poll.error ?? "parse_failed");

          const text = poll.extractedText ?? "";
          const trimmedText = text.trim();
          if (!trimmedText) throw new Error("empty_extracted_text");
          uploadedFileSources.push({
            fileName: file.name,
            extractedText: trimmedText,
          });
          refreshUploadHint();
          // #601 Fase 1: warn when the upload is image-heavy / low on text — the extraction only
          // captures text runs, so the generated module would otherwise be silently thin.
          if (poll.lowTextDensity) {
            showToast(`${t("shell.source.lowTextWarning")} (${file.name})`, "warning");
          }
        } catch (error) {
          showToast(`${parseApiErrorMessage(error, "shell.source.fileReadError")} (${file.name})`, "error");
        }
      }
      // En kort suksess-toast på slutten i stedet for én per fil — mindre støy.
      if (uploadedFileSources.length > 0) {
        showToast(t("shell.source.fileReady"), "success");
      }
      uploadBtn.disabled = false;
      urlBtn.disabled = false;
      btn.disabled = false;
      uploadBtn.textContent = originalLabel;
      fileInput.value = "";
      inputEl.focus();
    });

    uploadRow.appendChild(uploadBtn);
    uploadRow.appendChild(urlBtn);
    uploadRow.appendChild(crawlBtn);
    uploadRow.appendChild(uploadHint);
    uploadRow.appendChild(fileInput);
    wrap.appendChild(uploadRow);
    // v1.2.3: chip-liste plassert under uploadRow så den ikke konkurrerer om plass med
    // knappene. Skjules når tom (display: none via hidden-attributtet).
    wrap.appendChild(sourceList);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary chat-submit-btn";
  btn.textContent = t(entry.submitKey);

  function submit() {
    if (isSourceMaterial) {
      const notes = inputEl.value.trim();
      // #454 Phase 1/2: concat all file uploads, all URL fetches, and pasted notes.
      // Each source prefixed with its origin marker (filename or hostname) so the LLM
      // can attribute content. Separator "---" between sources.
      const fileTexts = uploadedFileSources
        .map((f) => `[${f.fileName}]\n${f.extractedText}`)
        .join("\n\n---\n\n");
      const urlTexts = fetchedUrlSources
        .map((src) => `[${src.hostname}]\n${src.extractedText}`)
        .join("\n\n---\n\n");
      const combinedSourceMaterial = [fileTexts, urlTexts, notes].filter(Boolean).join("\n\n").trim();
      if (!combinedSourceMaterial) { inputEl.focus(); return; }
      if (combinedSourceMaterial.length > SOURCE_MATERIAL_MAX_CHARS) {
        showToast(t("shell.source.textTooLong"), "error");
        inputEl.focus();
        return;
      }
      btn.disabled = true;
      inputEl.disabled = true;
      entry.submitted = true;
      entry.onSubmit(combinedSourceMaterial);
      return;
    }

    const val = inputEl.value.trim();
    if (!val) { inputEl.focus(); return; }
    btn.disabled = true;
    inputEl.disabled = true;
    entry.submitted = true;
    entry.onSubmit(val);
  }

  btn.addEventListener("click", submit);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    if (isMultiLine && e.shiftKey) return;
    e.preventDefault();
    submit();
  });
  wrap.appendChild(inputEl);
  wrap.appendChild(btn);
  // Kildeverktøyet monteres i «Generer innhold»-dialogen; fokus på opplastingsknappen (#360).
  entry.mount.replaceChildren(wrap);
  setTimeout(() => { (wrap.querySelector(".chat-choice-btn") ?? inputEl).focus(); }, 80);
}


// ---------------------------------------------------------------------------
// Logged chat API — all flow functions use these
// ---------------------------------------------------------------------------







// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

// Innholdsspråket byttes i form-page.js sine språkpiller; dette er det som skjer ved byttet.
// Returnerer false når forfatteren sier nei (et åpent skjema med endringer ville blitt tegnet om).
function switchContentLocale(loc) {
  if (loc === contentLocale) return false;
  const wasEditing = !!document.getElementById("previewEditConfirm");
  // Bare det som faktisk var skrevet og ikke bekreftet, er verdt en beskjed.
  const wasDirty = hasOpenEditForm();
  // #920: the same question a tab switch asks. It used to ask it only for Innstillinger, so an
  // open edit form was re-rendered from the new language without a word — the typed text was
  // simply gone.
  if (!confirmLocaleSwitchDiscard()) return false;
  contentLocale = loc;
  // The panel's editors are seeded once, in the language they were seeded FOR. Discard so the
  // next render re-reads them in the new one; otherwise the author edits Norwegian text that
  // the save then files as English.
  settingsTab.resetLocaleBoundState();
  renderPreview();
  settingsTab.renderSettingsPanel();
  if (wasEditing) {
    enterPreviewEditMode({ force: true });
    if (wasDirty) showToast(t("shell.directEdit.localeSwitched"), "warning");
  }
  formPage?.refreshHeader();
  return true;
}

// B3 (#450): the blueprint that the current view "is about" — sessionDraft takes precedence
// over the loaded module-version blueprint (an unsaved edit may move the blueprint forward
// before save). Returns a parsed object or null.
function getActiveBlueprint() {
  const raw = sessionDraft?.assessmentBlueprint
    ?? bundle?.selectedConfiguration?.moduleVersion?.assessmentBlueprint
    ?? null;
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  if (typeof raw === "object") return raw;
  return null;
}

// B3: recompute currentBlueprintHash after blueprint state changes. Re-renders preview when
// the hash changed (so drift banner appears/disappears). Safe to call from anywhere — does
// nothing if hash is unchanged.
async function refreshBlueprintHash() {
  const blueprint = getActiveBlueprint();
  const next = await hashBlueprintAsync(blueprint);
  if (next === currentBlueprintHash) return;
  currentBlueprintHash = next;
  renderPreview();
}

// B3: read the stored blueprint-hash off the active rubric's scalingRule. null when no
// rubric, no scalingRule, or no hash (pre-B3 rubric).
function getStoredBlueprintHash() {
  const sr = bundle?.selectedConfiguration?.rubricVersion?.scalingRule;
  if (!sr || typeof sr !== "object") return null;
  const v = sr.generated_from_blueprint_hash;
  return typeof v === "string" && v.length > 0 ? v : null;
}

// B3: classify drift for the current shell state. Returns the classifyDriftState code.
function resolveDriftState() {
  const hasBlueprint = !!getActiveBlueprint();
  const hasRubric = !!bundle?.selectedConfiguration?.rubricVersion;
  return classifyDriftState(currentBlueprintHash, getStoredBlueprintHash(), { hasBlueprint, hasRubric });
}

function renderDriftBannerHtml() {
  return `
    <div class="drift-banner" role="status" data-drift-banner>
      <div class="drift-banner-message">
        <span class="drift-banner-icon" aria-hidden="true">⚠</span>
        <p>
          <strong>${escapeHtml(t("shell.drift.title"))}</strong><br>
          ${escapeHtml(t("shell.drift.body"))}
        </p>
      </div>
      <div class="drift-banner-actions">
        <button type="button" class="btn-secondary" data-drift-action="keep">${escapeHtml(t("shell.drift.action.keep"))}</button>
        <button type="button" class="btn-secondary" data-drift-action="show-diff">${escapeHtml(t("shell.drift.action.showDiff"))}</button>
        <button type="button" class="btn-primary" data-drift-action="regenerate">${escapeHtml(t("shell.drift.action.regenerate"))}</button>
      </div>
    </div>
  `;
}

function attachDriftBannerHandlers() {
  const banner = previewContent?.querySelector("[data-drift-banner]");
  if (!banner) return;
  banner.querySelector('[data-drift-action="keep"]')?.addEventListener("click", handleDriftKeep);
  banner.querySelector('[data-drift-action="show-diff"]')?.addEventListener("click", handleDriftShowDiff);
  banner.querySelector('[data-drift-action="regenerate"]')?.addEventListener("click", handleDriftRegenerate);
}

function renderPreview() {
  const opts = { locale: contentLocale, t, tf };

  if (!bundle && !sessionDraft && !previewDraft) {
    previewContent.innerHTML = buildPreviewHtml({ emptyText: t("adminContent.status.noneTitle") }, opts);
    updateStateRail();
    return;
  }

  const activeDraft = previewDraft ?? sessionDraft;
  const hasDraft = !!activeDraft;
  const driftState = resolveDriftState();
  // The drift banner offers author actions ("Regenerer", "Vis forskjell"), so it belongs to
  // the author view only - a participant view must not hand out controls at all.
  const forParticipant = activeTab === "preview";
  const driftBanner = (driftState === "drifted" && !forParticipant) ? renderDriftBannerHtml() : "";

  if (bundle) {
    const mod = bundle?.module ?? null;
    const cfg = bundle?.selectedConfiguration ?? {};
    if (!mod) {
      previewContent.innerHTML = buildPreviewHtml({ emptyText: t("adminContent.status.noneTitle") }, opts);
      updateStateRail();
      return;
    }
    const isLive = !!mod.activeVersionId && cfg.moduleVersion?.id === mod.activeVersionId;
    const isDraft = !!cfg.moduleVersion && !isLive;

    const versionChainParts = [];
    if (cfg.moduleVersion) versionChainParts.push(`Modul v${cfg.moduleVersion.versionNo}`);
    if (cfg.rubricVersion) versionChainParts.push(`Rubrikk v${cfg.rubricVersion.versionNo}`);
    if (cfg.promptTemplateVersion) versionChainParts.push(`Prompt v${cfg.promptTemplateVersion.versionNo}`);
    if (cfg.mcqSetVersion) versionChainParts.push(`MCQ v${cfg.mcqSetVersion.versionNo}`);

    previewContent.innerHTML = buildPreviewHtml({
      // v1.2.27 (#361 follow-up): title/description respect draft-overrides like other
      // fields. Without this, edits handed off from Avansert (changed title/description)
      // were ignored because mod.title from the loaded bundle always won.
      title: (hasDraft && activeDraft.title) ? activeDraft.title : mod.title,
      description: (hasDraft && activeDraft.description) ? activeDraft.description : mod.description,
      taskText: hasDraft ? activeDraft.taskText : (cfg.moduleVersion?.taskText ?? ""),
      assessorExpectedContent: hasDraft ? activeDraft.assessorExpectedContent : (cfg.moduleVersion?.assessorExpectedContent ?? ""),
      candidateTaskConstraints: hasDraft ? activeDraft.candidateTaskConstraints : (cfg.moduleVersion?.candidateTaskConstraints ?? ""),
      mcqQuestions: hasDraft ? (activeDraft.mcqQuestions ?? []) : (cfg.mcqSetVersion?.questions ?? []),
      // B2 (#449): show Vurderingskriterier in the preview pane as content. Prefer draft
      // overrides if user has edited via Rediger direkte; fall back to persisted rubric.
      criteria: (hasDraft && activeDraft.criteria) ? activeDraft.criteria : (cfg.rubricVersion?.criteria ?? null),
      // v1.1.81: show "genereres…" placeholder when criteria-generation is in flight for
      // the current sessionDraft.
      // Generation status is an authoring signal too - the learner has no business seeing it.
      criteriaLoadingText: (criteriaGenerationInFlight && !forParticipant) ? t("shell.criteria.generating") : "",
      // B3 (#450): drift banner rendered above the criteria section.
      driftBanner,
      // #896 S1: the Forhaandsvisning tab claims to show what the participant meets, so it
      // must not leak the assessor expectation, the MCQ answer key and rationale, or criteria
      // marked candidateVisible:false. Rediger keeps showing all of it - that is the author's
      // working view.
      audience: forParticipant ? "participant" : "author",
      versionChain: versionChainParts.join(" · "),
      badgeClass: hasDraft ? "draft" : isLive ? "live" : isDraft ? "draft" : "shell",
      badgeText: hasDraft
        ? t("shell.draft.unsavedBadge")
        : isLive ? t("adminContent.status.badge.live")
        : isDraft ? t("adminContent.status.badge.draft")
        : t("adminContent.status.badge.shellOnly"),
    }, opts);
    if (!forParticipant) attachDriftBannerHandlers();
  } else if (hasDraft) {
    previewContent.innerHTML = buildPreviewHtml({
      title: activeDraft.title || t("shell.newModule.defaultTitle"),
      taskText: activeDraft.taskText ?? "",
      assessorExpectedContent: activeDraft.assessorExpectedContent ?? "",
      candidateTaskConstraints: activeDraft.candidateTaskConstraints ?? "",
      mcqQuestions: activeDraft.mcqQuestions ?? [],
      // A brand-new module lives here until it is first saved, and its Forhaandsvisning has
      // to withhold the same things as a loaded one.
      audience: forParticipant ? "participant" : "author",
      badgeClass: "draft",
      badgeText: t("shell.draft.unsavedBadge"),
    }, opts);
  }

  updateStateRail();

  // ⚠️ #1051: ÉN hydrering for alle fire monteringene over — ikke fire. Bytter de
  // markdown-bærende blokkene til server-rendret HTML, så forfatteren ser det samme som
  // deltakeren. Asynkron med vilje: teksten står escapet til svaret kommer, og aldri farlig.
  void hydratePreviewMarkdown(previewContent, {
    apiFetch,
    getHeaders,
    locale: contentLocale,
    sanitize: sanitizeSectionHtml,
  });
}

function scrollPreviewToTop() {
  previewPane?.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollPreviewToBottom() {
  if (!previewPane) return;
  previewPane.scrollTo({ top: previewPane.scrollHeight, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// State rail
// ---------------------------------------------------------------------------

function updateStateRail() {
  const hasModule = !!selectedModuleId;
  // #975: her sto `stateRail.hidden = !hasModule` alene, og `.state-rail{display:flex}` slo
  // attributtet. Lappen var en egen CSS-regel, `.state-rail[hidden]{display:none}` — en fiks oppå
  // fella i stedet for kuren. Regelen er fjernet; setHidden gjør jobben for alle tilstander.
  // #787: content-owner panel for the loaded module. Render once per module (guard on the last id) so
  // the frequent updateStateRail calls don't re-fetch/reset it; hide when no module is loaded.
  const ownerHost = document.getElementById("moduleOwnerPanelHost");
  if (ownerHost) {
    // #1046 (13.09): panelet ligger under Innstillinger — synlig bare når den fanen er valgt OG en modul er lastet.
    ownerHost.hidden = !hasModule || activeTab !== "settings";
    if (!hasModule) {
      ownerHost.dataset.moduleId = "";
    } else if (ownerHost.dataset.moduleId !== selectedModuleId) {
      ownerHost.dataset.moduleId = selectedModuleId;
      renderOwnerPanel({ container: ownerHost, contentType: "MODULE", contentId: selectedModuleId, getHeaders, t }).catch(() => {});
    }
  }
  if (!hasModule) return;

  const hasUnsaved = !!sessionDraft;
  // The version the workspace actually has open — which is NOT the same as the live one whenever
  // the author has restored an earlier version or is sitting on a saved draft.
  const loaded = bundle?.selectedConfiguration?.moduleVersion ?? null;
  const loadedIsLive = !!loaded?.id && loaded.id === bundle?.module?.activeVersionId;

  // Navn og merker står i hodet (form-page.js) — se moduleHeaderTitle/moduleStatusBadgesHtml.
  formPage?.refreshHeader();

  // «Forhåndsvisning viser …» i Forhåndsvisning-fanen: de tre tilstandene forhåndsvisningen kan være i.
  const previewShows = document.getElementById("previewShows");
  if (previewShows) {
    const shows = hasUnsaved ? t("stateRail.preview.workingDraft")
      : loadedIsLive ? t("stateRail.preview.published")
      : loaded?.versionNo != null ? tf("stateRail.preview.savedVersion", { versionNo: loaded.versionNo })
      : "—";
    previewShows.textContent = `${t("stateRail.label.preview")}: ${shows}`;
    setHidden(previewShows, activeTab !== "preview");
  }

}

// #896 S2 / #892: localizeDraftAcrossLocalesWithTitle does NOT reject when a locale fails - it
// falls back to the source text for that locale and names it in `failedLocales`. Saving that map
// as-is stores the source language under every locale: content that looks translated and reads
// as the wrong language, which is exactly what #892 fixed for titles.
//
// So strip the failed locales back out. What remains is the truth: the locales that really were
// translated. If nothing survives but the source, send a plain string - the agreed encoding for
// "written in one language, not translated yet".
function dropFailedLocales(localizedValue, failedLocales, sourceLocale) {
  if (!failedLocales?.length || !localizedValue || typeof localizedValue !== "object") return localizedValue;
  const kept = {};
  for (const [locale, value] of Object.entries(localizedValue)) {
    if (!failedLocales.includes(locale)) kept[locale] = value;
  }
  const remaining = Object.keys(kept);
  if (remaining.length === 0) return "";
  // #896 S4 QA: this used to collapse "only the source survived" back to a BARE STRING. The schema
  // accepts that — it is the #892 encoding for "one language, not translated yet" — but it throws
  // away WHICH language, and the publish gate then has to assume nb. An author working in English
  // was told English and Nynorsk were missing, and the gap-fill filled the wrong two. A one-key
  // map says exactly as much, minus the guess.
  return kept;
}

function buildPreviewCandidate(patch) {
  const baseDraft = previewDraft ?? sessionDraft ?? {};
  return {
    ...baseDraft,
    ...patch,
    title: patch.title ?? baseDraft.title ?? sessionDraft?.title ?? bundle?.module?.title ?? "",
    taskText:
      patch.taskText
      ?? baseDraft.taskText
      ?? sessionDraft?.taskText
      ?? bundle?.selectedConfiguration?.moduleVersion?.taskText
      ?? "",
    assessorExpectedContent:
      patch.assessorExpectedContent
      ?? baseDraft.assessorExpectedContent
      ?? sessionDraft?.assessorExpectedContent
      ?? bundle?.selectedConfiguration?.moduleVersion?.assessorExpectedContent
      ?? "",
    candidateTaskConstraints:
      patch.candidateTaskConstraints
      ?? baseDraft.candidateTaskConstraints
      ?? sessionDraft?.candidateTaskConstraints
      ?? bundle?.selectedConfiguration?.moduleVersion?.candidateTaskConstraints
      ?? "",
    mcqQuestions:
      patch.mcqQuestions
      ?? baseDraft.mcqQuestions
      ?? sessionDraft?.mcqQuestions
      ?? bundle?.selectedConfiguration?.mcqSetVersion?.questions
      ?? [],
    // B2 (#449 redesign): criteria carry through preview drafts so direct-edit changes
    // survive into sessionDraft and the subsequent save. Null = "no criteria override,
    // use bundle's existing rubric". Object = "user explicitly set these criteria".
    criteria:
      patch.criteria !== undefined
        ? patch.criteria
        : baseDraft.criteria !== undefined
          ? baseDraft.criteria
          : sessionDraft?.criteria,
  };
}
function clearPreviewCandidate() {
  previewDraft = null;
  renderPreview();
}

// ⛔ `translateLocalizedText(text)` sto her og returnerte `{"en-GB": text, nb: text, nn: text}`.
// Slettet 2026-08-19, etter at de to siste kallerne (`resolveMcqTitlePayload` og
// `resolveCurrentPromptPayload`) ble rettet.
//
// Den var maskinen bak løgnen #892, #905 og #918 hver for seg fjernet fra hver sin sti: én tekst i
// ett språk, kopiert inn i alle tre, slik at innholdet så oversatt ut for publiseringsgaten og for
// oversettelsesstatusen. Hver gang noen trengte «gjør denne strengen til et lokale-objekt», lå den
// her og gjorde det på den ene måten som er gal.
//
// **Ikke legg den tilbake.** Kodingen for «skrevet i ett språk, ikke oversatt ennå» er en REN
// STRENG — og `localizedTextMaybeUntranslatedSchema` godtar den overalt der det betyr noe. Skal
// språket registreres, er svaret et ett-nøkkels kart `{ [contentLocale]: tekst }` (#930), aldri tre
// kopier.

/**
 * Fjern språk som er tomme fra en lokalisert verdi.
 *
 * Skjemaet avviser tom streng i et språk, men godtar at språket mangler — det ER kodingen for
 * «ikke oversatt» (#905/#913, se doc/API_REFERENCE.md). `{"en-GB":"tekst", nb:"", nn:"tekst"}`
 * er altså ikke et delvis utfylt kart serveren skal klage på; det er et kart som skulle vært
 * skrevet uten `nb`.
 *
 * Dette het før `omitWhenEveryLocaleBlank` og lot delvise kart gå uendret gjennom, med den
 * begrunnelsen at klienten ikke skulle dikte seg ut av problemet ved å kopiere ett språk inn i de
 * andre (#892). Riktig den gangen — den gang var alternativet nettopp en kopi. Etter #905 finnes
 * et tredje valg, og det er dette. Symptomet var:
 *
 *   400 validation_error · path ["candidateTaskConstraints","nb"] · String must contain at least 1
 *
 * på en helt vanlig lagring der forfatteren bare hadde endret tittelen.
 */
function dropBlankLocales(value) {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (typeof value !== "object") return undefined;
  const kept = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text === "string" && text.trim()) kept[locale] = text;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * #905: remove one locale from every localized field of a draft-localization result.
 *
 * The maps are seeded with the source text for all locales before translation runs, so a locale
 * that fails has to be taken back out — otherwise the source language is stored as though it
 * were a translation, and nothing downstream can tell the difference.
 */
function dropLocale(localized, locale) {
  for (const field of ["title", "taskText", "assessorExpectedContent", "candidateTaskConstraints"]) {
    if (localized[field] && typeof localized[field] === "object") delete localized[field][locale];
  }
}

/**
 * #982: si fra om språk som ikke ble oversatt.
 *
 * ⚠️ #1016: det fantes to tekster, og hver beskrev sin halvdel av virkeligheten — «står fortsatt
 * med {source}-teksten» mot «står tomme». De var dessuten koblet MOTSATT flere steder. Nå slipper
 * alle veier lokalen, så det finnes én sannhet og én tekst; den andre nøkkelen er fjernet.
 */
function describeFailedLocales(failedLocales, sourceLocale) {
  if (!failedLocales?.length) return "";
  const text = tf("shell.generating.draftNotTranslated", {
    locales: failedLocales.join(", "),
    source: sourceLocale,
  });
  return `<p style="margin:8px 0 0;font-size:13px;color:var(--color-warning,#8a5f10)">${escapeHtml(text)}</p>`;
}

function buildLocalizedTextMap(baseLocale, baseText, translatedEntries = {}) {
  const result = {};
  for (const locale of supportedLocales) {
    if (locale === baseLocale) {
      result[locale] = baseText;
      continue;
    }
    result[locale] = translatedEntries[locale] ?? baseText;
  }
  return result;
}


/**
 * #982: en oversettelse som ikke kom, skal se ut som en oversettelse som ikke kom.
 *
 * ⚠️ Skrev tidligere `draft?.taskText ?? taskText` — altså KILDETEKSTEN — inn i mållokalen når
 * svaret var tomt eller manglet felt, og kastet ikke engang ved nettverksfeil. Kartet så komplett
 * ut, `missingLocalesFor` fant ingenting å savne, publiseringsgaten slapp modulen gjennom, og en
 * nynorskdeltaker fikk bokmål uten at noe sa fra. Det er #892-invarianten brutt stille.
 *
 * Søstermetoden `localizeDraftAcrossLocalesWithTitle` gjorde dette riktig allerede (#905): den
 * SLIPPER lokalen og fører den opp i `failedLocales`. Denne gjør nå det samme, og returnerer
 * `failedLocales` slik at kalleren kan si fra i stedet for å vise «ferdig».
 */
async function localizeDraftAcrossLocales(taskText, assessorExpectedContent, sourceLocale, candidateTaskConstraints) {
  const localized = {
    taskText: buildLocalizedTextMap(sourceLocale, taskText),
    assessorExpectedContent: buildLocalizedTextMap(sourceLocale, assessorExpectedContent),
    candidateTaskConstraints: buildLocalizedTextMap(sourceLocale, candidateTaskConstraints ?? ""),
    failedLocales: [],
  };

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;

    let result;
    try {
      result = await apiFetch(
        "/api/admin/content/generate/module-draft/localize",
        getHeaders,
        {
          method: "POST",
          body: JSON.stringify({ taskText, assessorExpectedContent, candidateTaskConstraints: candidateTaskConstraints ?? "", sourceLocale, targetLocale }),
        },
      );
    } catch {
      dropLocale(localized, targetLocale);
      localized.failedLocales.push(targetLocale);
      continue;
    }

    const fields = selectTranslatedDraftFields(result?.draft ?? result);
    // Et svar uten oppgavetekst er ingen oversettelse. Samme behandling som en kastet feil.
    if (!fields) {
      dropLocale(localized, targetLocale);
      localized.failedLocales.push(targetLocale);
      continue;
    }

    // ⚠️ Felter som mangler i svaret fylles IKKE med kildeteksten — de slippes for den lokalen.
    for (const field of ["taskText", "assessorExpectedContent", "candidateTaskConstraints"]) {
      if (fields[field]) localized[field][targetLocale] = fields[field];
      else delete localized[field][targetLocale];
    }
  }

  return localized;
}

/**
 * Oversett BARE tittelen, via seksjons-endepunktet (#514), som godtar tittel alene.
 *
 * Modul-endepunktet krever `taskText` OG `assessorExpectedContent` med minst ett tegn. En MCQ-only
 * modul har ingen av delene, så et tittelbytte der ga 400 — feilen ble slukt av `catch { continue }`
 * under, og tittelen ble stående på kildespråket i ALLE tre lokaler. Det er #892-signaturen på nytt:
 * tittelen SER oversatt ut, mens deltakeren møter feil språk.
 */
async function localizeTitleOnly(title, sourceLocale, targetLocale) {
  // adminSectionsRouter er montert INNE i adminContentRouter (`use("/sections", …)`), som selv er
  // montert på /api/admin/content. Full sti er derfor /api/admin/content/sections/localize — samme
  // som admin-content-sections.js bruker. /api/admin/sections finnes ikke og gir 404.
  const result = await apiFetch("/api/admin/content/sections/localize", getHeaders, {
    method: "POST",
    body: JSON.stringify({ title, sourceLocale, targetLocale }),
  });
  return typeof result?.title === "string" && result.title.trim() ? result.title.trim() : null;
}

async function localizeDraftAcrossLocalesWithTitle(title, taskText, assessorExpectedContent, sourceLocale, candidateTaskConstraints) {
  const localized = {
    title: buildLocalizedTextMap(sourceLocale, title),
    taskText: buildLocalizedTextMap(sourceLocale, taskText),
    assessorExpectedContent: buildLocalizedTextMap(sourceLocale, assessorExpectedContent),
    candidateTaskConstraints: buildLocalizedTextMap(sourceLocale, candidateTaskConstraints ?? ""),
    // Lokaler som IKKE ble oversatt. De SLIPPES nå, som i søsterfunksjonen — begrunnelsen for å la
    // kildeteksten stå («nødvendig for at lagring skal gå gjennom») falt bort med #930, som myknet
    // skjemaene til å ta imot et delvis kart. Kalleren må fortsatt si fra: stillhet her var halve #892.
    failedLocales: [],
  };
  const hasDraftBody = Boolean(taskText?.trim() && assessorExpectedContent?.trim());

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;

    if (!hasDraftBody) {
      // Ingen oppgavetekst å oversette (MCQ-only) — bare tittelen skal flyttes over.
      try {
        const translatedTitle = await localizeTitleOnly(title, sourceLocale, targetLocale);
        if (translatedTitle) {
          localized.title[targetLocale] = translatedTitle;
        } else {
          // ⚠️ #1016: her sto det bare `failedLocales.push`. Tittelen ble staaende KILDEFYLT fra
          // `buildLocalizedTextMap`, altsaa nøyaktig den tilstanden #892 forbyr — den ser oversatt
          // ut. Feilstien tre linjer ned slapp lokalen; denne gjorde det ikke. Samme funksjon.
          dropLocale(localized, targetLocale);
          localized.failedLocales.push(targetLocale);
        }
      } catch {
        dropLocale(localized, targetLocale);
        localized.failedLocales.push(targetLocale);
      }
      continue;
    }

    let result;
    try {
      result = await apiFetch(
        "/api/admin/content/generate/module-draft/localize",
        getHeaders,
        {
          method: "POST",
          body: JSON.stringify({ title, taskText, assessorExpectedContent, candidateTaskConstraints: candidateTaskConstraints ?? "", sourceLocale, targetLocale }),
        },
      );
    } catch {
      // #905: DROP the pre-filled source copy for this locale. It used to be left standing
      // "so the draft stays saveable" — but the API accepts a partial map now, and leaving the
      // copy is what made a failed translation indistinguishable from a real one. The locale is
      // recorded as failed so the caller can say so, and the field simply has no value here.
      dropLocale(localized, targetLocale);
      localized.failedLocales.push(targetLocale);
      continue;
    }
    const draft = result?.draft ?? result;
    if (!draft?.title) {
      // A response without a title is not a translation. Same treatment as a thrown error.
      dropLocale(localized, targetLocale);
      localized.failedLocales.push(targetLocale);
      continue;
    }
    // ⚠️ #1016: sto `?? taskText` osv. — KILDETEKSTEN inn i mållokalen for felt svaret utelot.
    // Det er samme feil #982 fjernet i `localizeDraftAcrossLocales`, som ligger ÉN FUNKSJON unna og
    // gjør det riktig. Rettet ett sted, glemt det andre; sjuende gang i samme klasse.
    localized.title[targetLocale] = draft.title;
    for (const field of ["taskText", "assessorExpectedContent", "candidateTaskConstraints"]) {
      if (draft?.[field]) localized[field][targetLocale] = draft[field];
      else delete localized[field][targetLocale];
    }
  }

  return localized;
}

/**
 * #1014: oversett MCQ-settet til de andre språkene — og la et språk som IKKE ble oversatt, se ut
 * som et språk som ikke ble oversatt.
 *
 * ⚠️ Skrev tidligere `?? …[sourceLocale]` på alle fire feltene, altså KILDETEKSTEN inn i mållokalen
 * når svaret manglet noe. Det er samme feil som #982 fjernet i `localizeDraftAcrossLocales`, men på
 * DELTAKERVENDT innhold: kartet så komplett ut, publiseringsgaten fant ingenting å savne, og en
 * nynorskdeltaker fikk bokmålsspørsmål som så oversatt ut.
 *
 * ⚠️ `options` og `correctAnswer` flytter SAMMEN, og det er ikke pynt. `localizedTextIdentity`
 * bygger identiteten av hele språkkartet, og svaret må være identisk med ett av alternativene.
 * Slippes et språk fra svaret mens alternativet beholder det, matcher svaret ingen — og da blir
 * spørsmålet, med skjemaets egne ord, stille ubesvarbart for alle. Derfor:
 *   - språket tas bare hvis ALLE alternativene kom tilbake, og
 *   - svaret for det språket hentes fra det oversatte ALTERNATIVET på kildesvarets plass, ikke fra
 *     modellens egen oversettelse av svaret. Identiteten holder da av konstruksjon.
 *
 * `stem` og `rationale` er ikke koblet til noe og behandles hver for seg — et manglende rasjonale
 * skal ikke koste et ellers godt oversatt spørsmål.
 *
 * Returnerer `{ questions, failedLocales }`, samme form som søsterfunksjonene, slik at kalleren kan
 * si fra i stedet for å vise «ferdig».
 */
async function localizeMcqAcrossLocales(questions, sourceLocale) {
  const localizedQuestions = questions.map((question) => ({
    stem: buildLocalizedTextMap(sourceLocale, question.stem),
    options: question.options.map((option) => buildLocalizedTextMap(sourceLocale, option)),
    correctAnswer: buildLocalizedTextMap(sourceLocale, question.correctAnswer),
    rationale: buildLocalizedTextMap(sourceLocale, question.rationale),
  }));
  const correctIndexes = mcqCorrectAnswerIndexes(questions);
  const failedLocales = [];

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;

    let result;
    try {
      result = await apiFetch(
        "/api/admin/content/generate/mcq/localize",
        getHeaders,
        {
          method: "POST",
          body: JSON.stringify({ questions, sourceLocale, targetLocale }),
        },
      );
    } catch {
      // ⚠️ Fantes ikke før: funksjonen hadde ingen try/catch, og BEGGE de opprinnelige kallerne
      // kaller den utenfor sine try-blokker. Et 500-svar ga derfor en uhåndtert rejection og en
      // fremdriftsboble som ble stående. Nå er utfallet et manglende språk — noe dataene kan
      // uttrykke og publiseringsgaten måler — og de genererte spørsmålene kastes ikke bort fordi
      // oversettelsen feilet.
      localizedQuestions.forEach((q) => dropMcqQuestionLocale(q, targetLocale));
      failedLocales.push(targetLocale);
      continue;
    }

    const oversatte = Array.isArray(result?.questions) ? result.questions : [];
    if (oversatte.length === 0) {
      // Et svar uten spørsmål er ingen oversettelse. Samme behandling som en kastet feil.
      localizedQuestions.forEach((q) => dropMcqQuestionLocale(q, targetLocale));
      failedLocales.push(targetLocale);
      continue;
    }

    applyMcqTranslation(localizedQuestions, oversatte, { targetLocale, correctIndexes });
  }

  return { questions: localizedQuestions, failedLocales };
}

// #1046 (produkteier 13.09): fanebytte er ikke navigering og spør ikke. Det som er skrevet i Rediger
// legges i `sessionDraft` når man forlater fanen, og kommer tilbake når skjemaet åpnes igjen.
// `editFormSnapshot` settes av enterPreviewEditMode (den kjenner utgangsverdiene) og leser feltene.
let editFormSnapshot = null;
// Utkastet kom fra skjemaet (én språkversjon, ikke oversatt). Da skal Lagre gå veien om oversettelse
// (previewEditConfirm), ikke lagre utkastet rått som «Lagre utkast» gjorde for genererte utkast.
let sessionDraftFromForm = false;

function readMcqQuestionsFromForm(currentMcqQuestions) {
  return currentMcqQuestions.map((question, questionIndex) => {
    const container = previewContent.querySelector(`[data-preview-edit-question="${questionIndex}"]`);
    const optionInputs = Array.from(container?.querySelectorAll("[data-preview-edit-option]") ?? []);
    const options = optionInputs.map((input, optionIndex) => input.value.trim() || question.options[optionIndex] || "");
    const checkedRadio = container?.querySelector(`input[name="previewEditCorrectAnswer${questionIndex}"]:checked`);
    const checkedIndex = Number.parseInt(checkedRadio?.value ?? "-1", 10);
    const safeCorrectAnswerIndex =
      Number.isInteger(checkedIndex) && checkedIndex >= 0 && checkedIndex < options.length
        ? checkedIndex
        : Math.max(0, options.findIndex((option) => option === question.correctAnswer));
    return {
      stem: container?.querySelector(`#previewEditMcqStem${questionIndex}`)?.value.trim() || question.stem,
      options,
      correctAnswer: options[safeCorrectAnswerIndex] ?? options[0] ?? question.correctAnswer ?? "",
      // Reverted to ||: an emptied rationale cannot be saved at all. Both the MCQ
      // localization body and the MCQ-set body require a non-empty string, so clearing it
      // produces a 400 AFTER the title and rubric may already have been written. Keeping
      // the old text is wrong but harmless; a half-written save is not. The real fix is a
      // schema that treats the rationale as genuinely optional - registered separately.
      rationale: container?.querySelector(`#previewEditMcqRationale${questionIndex}`)?.value.trim() || question.rationale,
    };
  });
}

function nonEmptyLocaleMap(value) {
  if (typeof value === "string") return value.trim() ? { [LEGACY_STRING_LOCALE]: value } : {};
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
}

/** Legg det som er skrevet i Rediger inn i utkastet. Returnerer true når noe var endret. */
function captureEditFormIntoDraft({ force = false } = {}) {
  if (!isEditFormOpen() || !editFormSnapshot) return false;
  const snap = editFormSnapshot();
  if (!snap.changed && !force) return false;
  const loc = snap.editingLocale;
  const stored = bundle?.selectedConfiguration?.moduleVersion;
  const merge = (current, text) => mergeLocaleInto(current, loc, text);
  sessionDraft = buildPreviewCandidate({
    title: merge(sessionDraft?.title ?? bundle?.module?.title ?? "", snap.title) ?? "",
    description: merge(sessionDraft?.description ?? bundle?.module?.description ?? "", snap.description),
    taskText: merge(sessionDraft?.taskText ?? stored?.taskText ?? "", snap.taskText) ?? "",
    assessorExpectedContent: merge(sessionDraft?.assessorExpectedContent ?? stored?.assessorExpectedContent ?? "", snap.assessorExpectedContent) ?? "",
    candidateTaskConstraints: merge(sessionDraft?.candidateTaskConstraints ?? stored?.candidateTaskConstraints ?? "", snap.candidateTaskConstraints) ?? "",
    mcqQuestions: snap.mcqQuestions,
  });
  sessionState = "draft-pending";
  sessionDraftFromForm = true;
  newModulePlaceholder = false;
  return true;
}

function resolveEditableMcqQuestions(locale) {
  const sourceQuestions = sessionDraft?.mcqQuestions?.length
    ? sessionDraft.mcqQuestions
    : (bundle?.selectedConfiguration?.mcqSetVersion?.questions ?? []);

  return sourceQuestions.map((question) => ({
    stem: localizeValueForLocale(question?.stem ?? "", locale),
    options: (question?.options ?? []).map((option) => localizeValueForLocale(option, locale)),
    correctAnswer: localizeValueForLocale(question?.correctAnswer ?? "", locale),
    rationale: localizeValueForLocale(question?.rationale ?? "", locale),
  }));
}

function buildDefaultSubmissionSchema() {
  return {
    fields: [
      {
        id: "response",
        label: {
          "en-GB": "Your answer",
          nb: "Ditt svar",
          nn: "Ditt svar",
        },
        type: "textarea",
        required: true,
        placeholder: {
          "en-GB": "Write your answer here",
          nb: "Skriv svaret ditt her",
          nn: "Skriv svaret ditt her",
        },
      },
    ],
  };
}

function resolveSubmissionSchemaPayload() {
  return bundle?.selectedConfiguration?.moduleVersion?.submissionSchema ?? buildDefaultSubmissionSchema();
}

function tryParseJsonTranslation(key, fallback) {
  try {
    return JSON.parse(t(key));
  } catch {
    return fallback;
  }
}

function resolveCurrentPromptPayload() {
  const prompt = bundle?.selectedConfiguration?.promptTemplateVersion;
  // QA 2026-08-19: samme vifte som i `resolveMcqTitlePayload`. Standardinstruksen hentes med `t()`
  // — altså i MENYspråket — og ble kopiert inn i alle tre. Resultatet var en lagret instruks som
  // påsto nb- og nn-oversettelser som i virkeligheten var den engelske standardteksten.
  //
  // Det er verre enn det høres ut, fordi det er selvforseglende: Innstillinger leser i
  // `contentLocale` og viser da den engelske teksten som den norske, og `mergeSettingsField` sin
  // urørt-sjekk ser en ikke-tom `nb`-verdi og regner den som ekte. Hullet kan aldri oppdages igjen.
  //
  // En ren streng er den ærlige kodingen — «ett språk, ikke oversatt ennå» — og
  // `promptTemplateBodySchema` godtar den. Merk at strengen fortsatt bærer menyspråket og leses som
  // `nb`; det er #930, som språkmerker denne klassen verdier ved kilden.
  return {
    systemPrompt: prompt?.systemPrompt ?? t("adminContent.defaults.systemPrompt"),
    userPromptTemplate: prompt?.userPromptTemplate ?? t("adminContent.defaults.userPromptTemplate"),
    examples: prompt?.examples ?? tryParseJsonTranslation("adminContent.defaults.examplesJson", []),
  };
}

function resolveMcqTitlePayload() {
  const existingTitle = bundle?.selectedConfiguration?.mcqSetVersion?.title;
  if (existingTitle) return existingTitle;
  const moduleTitle = bundle?.module?.title ?? sessionDraft?.title ?? t("shell.newModule.defaultTitle");
  // QA 2026-08-19: dette kjørte en ren streng gjennom `translateLocalizedText`, som kopierer den
  // inn i alle tre språk. Altså nøyaktig #918-løgnen — ett felt til side, på samme lagring: siden
  // #918 er modultittelen bevisst en REN STRENG, og denne tok den ærlige strengen og gjorde den om
  // til tre identiske «oversettelser» for MCQ-settets tittel.
  //
  // Verre enn på tittelen, fordi klientens `TRANSLATION_GATE_FIELDS` ikke inneholder MCQ-settets
  // tittel — så ingenting rapporterte hullet, og norske deltakere fikk den engelske.
  //
  // `mcqSetBodySchema.title` er `localizedTextMaybeUntranslatedSchema`, så en ren streng er en
  // gyldig verdi: «ett språk, ikke oversatt ennå». Send den videre som den er.
  return moduleTitle;
}

function resolveDraftForSave() {
  const taskText = sessionDraft?.taskText ?? bundle?.selectedConfiguration?.moduleVersion?.taskText ?? "";
  const assessorExpectedContent = sessionDraft?.assessorExpectedContent ?? bundle?.selectedConfiguration?.moduleVersion?.assessorExpectedContent ?? "";
  const candidateTaskConstraints = sessionDraft?.candidateTaskConstraints ?? bundle?.selectedConfiguration?.moduleVersion?.candidateTaskConstraints ?? "";
  const assessmentBlueprint = sessionDraft?.assessmentBlueprint ?? bundle?.selectedConfiguration?.moduleVersion?.assessmentBlueprint ?? undefined;
  const mcqQuestions = sessionDraft?.mcqQuestions?.length
    ? sessionDraft.mcqQuestions
    : (bundle?.selectedConfiguration?.mcqSetVersion?.questions ?? []);
  // B2 (#449 redesign v1.1.77): explicit criteria override from direct-edit flow.
  // null/undefined = "no override, let backend ensure-rubric handle it"; object = "POST
  // these criteria as a new rubric version".
  const criteria = sessionDraft?.criteria ?? null;

  return { taskText, assessorExpectedContent, candidateTaskConstraints, assessmentBlueprint, mcqQuestions, criteria };
}

function resolveCurrentDraftSnapshot(locale = (contentLocale)) {
  const fallbackTitle = bundle?.module?.title ?? sessionDraft?.title ?? t("shell.newModule.defaultTitle");
  return {
    sourceLocale: locale,
    title: localizeValueForLocale(sessionDraft?.title ?? fallbackTitle, locale) || localizeValueForLocale(fallbackTitle, "en-GB") || "",
    taskText: localizeValueForLocale(
      sessionDraft?.taskText ?? bundle?.selectedConfiguration?.moduleVersion?.taskText ?? "",
      locale,
    ),
    assessorExpectedContent: localizeValueForLocale(
      sessionDraft?.assessorExpectedContent ?? bundle?.selectedConfiguration?.moduleVersion?.assessorExpectedContent ?? "",
      locale,
    ),
    candidateTaskConstraints: localizeValueForLocale(
      sessionDraft?.candidateTaskConstraints ?? bundle?.selectedConfiguration?.moduleVersion?.candidateTaskConstraints ?? "",
      locale,
    ),
    mcqQuestions: resolveEditableMcqQuestions(locale),
  };
}

function commitSessionDraftPatch(patch, { scroll = "top" } = {}) {
  sessionDraft = buildPreviewCandidate(patch);
  sessionState = "draft-pending";
  clearPreviewCandidate();
  if (scroll === "bottom") scrollPreviewToBottom();
  else scrollPreviewToTop();
}

// #1046 steg 2: det genererte legges rett inn i skjemaet (dialogen sa det på forhånd). Har
// forfatteren skrevet noe mens genereringen pågikk, tas det med i utkastet først — ingenting
// overskrives stille, og ingenting parkeres som «forslag» i en logg som ikke finnes lenger.
function commitOrProposeGenerated({ patch, slot, readyHtml, warningHtml = "", scroll = "top", onCommit }) {
  if (hasOpenEditForm()) captureEditFormIntoDraft();
  commitSessionDraftPatch(patch, { scroll });
  onCommit?.();
  if (activeTab === "edit") enterPreviewEditMode({ force: true });
  logResolveSlot(slot, () => `${readyHtml()}${warningHtml}`);
  return true;
}



function createSessionDraftFromLoadedModule() {
  const moduleVersion = bundle?.selectedConfiguration?.moduleVersion ?? null;
  const mcqQuestions = bundle?.selectedConfiguration?.mcqSetVersion?.questions ?? [];
  const moduleTitle = bundle?.module?.title ?? t("shell.newModule.defaultTitle");

  if (!moduleVersion && mcqQuestions.length === 0) {
    return false;
  }

  // #555/#578: carry over the loaded module's type so a conversational revision of an
  // MCQ-only / free-text-only module saves under the right mode. Without this, assessmentMode
  // is undefined and saveDraftBundleInBackground treats it as FREETEXT_PLUS_MCQ — which wrongly
  // demands scenario/task text and blocks saving an MCQ-only revision. mcqMinPercent is carried
  // too, else the pass threshold silently resets to the default on save.
  const assessmentMode = moduleVersion?.assessmentMode;
  const loadedMcqMinPercent = moduleVersion?.assessmentPolicy?.passRules?.mcqMinPercent;

  sessionDraft = buildPreviewCandidate({
    title: moduleTitle,
    taskText: moduleVersion?.taskText ?? "",
    assessorExpectedContent: moduleVersion?.assessorExpectedContent ?? "",
    candidateTaskConstraints: moduleVersion?.candidateTaskConstraints ?? "",
    mcqQuestions,
    ...(assessmentMode ? { assessmentMode } : {}),
    ...(Number.isFinite(loadedMcqMinPercent) ? { mcqMinPercent: loadedMcqMinPercent } : {}),
  });
  previewDraft = null;
  sessionState = "draft-pending";
  renderPreview();
  return true;
}

// ---------------------------------------------------------------------------
// LLM generation — non-blocking, AbortController-guarded
// ---------------------------------------------------------------------------

// Cancel any in-flight generation and start a new one.
// Returns the progress card element so the caller can replace it on result.
function startGeneration() {
  if (generationAbort) {
    generationAbort.abort();
  }
  generationAbort = new AbortController();
  sessionState = "generating";
  return generationAbort;
}

async function generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onAccept, blueprint = null, scenarioMode = "auto") {
  const abort = startGeneration();
  const slot = logProgress("shell.generating.draftProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  // Blueprint may arrive as a JSON string (from confirmAndGenerate after author accepts it)
  // or as an object (in retry callbacks). Normalise to object form for the API body.
  let blueprintObject = null;
  if (blueprint) {
    if (typeof blueprint === "string") {
      try { blueprintObject = JSON.parse(blueprint); } catch { blueprintObject = null; }
    } else if (typeof blueprint === "object") {
      blueprintObject = blueprint;
    }
  }

  let result;
  try {
    result = await apiFetch(
      "/api/admin/content/generate/module-draft",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({
          sourceMaterial,
          certificationLevel: certLevel,
          locale,
          generationMode,
          scenarioMode,
          // #1049: genereringen er tilstandsløs og kan ikke slå opp modulen. Klienten sender
          // forfatterens omfang med, akkurat som den allerede sender nivået.
          ...scopeForGeneration(),
          ...(blueprintObject ? { blueprint: blueprintObject } : {}),
        }),
        signal: abort.signal,
      },
    );
  } catch (err) {
    generationAbort = null;
    sessionState = selectedModuleId ? (sessionDraft ? "draft-pending" : "module-loaded") : "idle";

    if (err?.name === "AbortError" || String(err).includes("abort")) {
      logResolveSlot(slot, () => escapeHtml(t("shell.generating.draftAborted")));
      return;
    }
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.generating.draftErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onAccept, blueprint, scenarioMode) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const draft = result?.draft ?? result;
  const localizedDraft = await localizeDraftAcrossLocales(draft.taskText, draft.assessorExpectedContent, locale, draft.candidateTaskConstraints);
  // #982: en delvis oversettelse er ikke «ferdig». Språk som ikke ble oversatt står nå tomme —
  // sier vi ingenting, oppdager forfatteren det først når publiseringsgaten stopper modulen, eller
  // verre: aldri, fordi hen tror alt er på plass.
  const localizeWarning = describeFailedLocales(localizedDraft.failedLocales, locale);
  // #926 §6: gjennom porten. Blueprint og hash-oppfriskningen hører til utkastet, ikke til
  // forslaget, så de skjer først når patchen faktisk landes.
  commitOrProposeGenerated({
    patch: { taskText: localizedDraft.taskText, assessorExpectedContent: localizedDraft.assessorExpectedContent, candidateTaskConstraints: localizedDraft.candidateTaskConstraints },
    slot,
    readyHtml: () => `<strong>${escapeHtml(t("shell.generating.draftReady"))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>`,
    warningHtml: localizeWarning,
    onCommit: () => {
      if (blueprint) {
        sessionDraft = { ...sessionDraft, assessmentBlueprint: blueprint };
        // B3 (#450): blueprint changed → may now drift from stored rubric hash.
        refreshBlueprintHash();
      }
      onAccept?.(draft, sourceMaterial, certLevel, locale);
    },
  });
}

async function generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, questionCount, optionCount, onAccept) {
  const abort = startGeneration();
  const slot = logProgress("shell.generating.mcqProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  // Pull blueprint from sessionDraft if present so MCQ is generated against the same contract
  // as the scenario task. Stored as JSON string — parse back to object for the API. See #372.
  let blueprintObject = null;
  const sessionBlueprint = sessionDraft?.assessmentBlueprint
    ?? bundle?.selectedConfiguration?.moduleVersion?.assessmentBlueprint;
  if (sessionBlueprint) {
    if (typeof sessionBlueprint === "string") {
      try { blueprintObject = JSON.parse(sessionBlueprint); } catch { blueprintObject = null; }
    } else if (typeof sessionBlueprint === "object") {
      blueprintObject = sessionBlueprint;
    }
  }

  let result;
  try {
    result = await apiFetch(
      "/api/admin/content/generate/mcq",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale, generationMode, questionCount, optionCount, ...(blueprintObject ? { blueprint: blueprintObject } : {}) }),
        signal: abort.signal,
      },
    );
  } catch (err) {
    generationAbort = null;
    sessionState = sessionDraft ? "draft-pending" : "module-loaded";

    if (err?.name === "AbortError" || String(err).includes("abort")) {
      logResolveSlot(slot, () => escapeHtml(t("shell.generating.mcqAborted")));
      return;
    }
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.generating.mcqErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, questionCount, optionCount, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const questions = result?.questions ?? [];
  const { questions: localizedQuestions, failedLocales } = await localizeMcqAcrossLocales(questions, locale);
  // #551: surface MCQ quality warnings (incl. the length-cue check) so the author can review.
  const mcqWarnings = Array.isArray(result?.validation?.issues) ? result.validation.issues : [];
  const mcqWarningsHtml = mcqWarnings.length > 0
    ? `<p style="margin:8px 0 0;font-size:13px;color:var(--color-warning,#b45309)">⚠ ${mcqWarnings.map(escapeHtml).join("<br>")}</p>`
    : "";
  commitOrProposeGenerated({
    patch: { mcqQuestions: localizedQuestions },
    slot,
    scroll: "bottom",
    // #982: kvalitetsadvarslene fra #551 lå også inne i `readyHtml`, og forsvant dermed når
    // forslaget ble parkert bak åpne felter — spørsmål med kjente problemer kunne landes uten at
    // advarselen noen gang var synlig. Fjerde advarsel i samme fil med samme feil.
    readyHtml: () => `<strong>${escapeHtml(tf("shell.generating.mcqReady", { count: questions.length }))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>`,
    // #1014: kvalitetsadvarslene fra #551 OG spraakene som ikke ble oversatt, i samme spor.
    warningHtml: `${mcqWarningsHtml}${describeFailedLocales(failedLocales, locale)}`,
    onCommit: () => onAccept?.(questions),
  });
}

async function reviseDraftInBackground(instruction, onAccept) {
  const abort = startGeneration();
  const slot = logProgress("shell.revision.draftProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  let result;
  try {
    // ⚠️ QA 2026-08-18: dette leste `currentLocale` — MENYspråket. Etter v2.18.12 følger ikke
    // innholdsspråket menyen, så divergens er normaltilstanden etter ett klikk, og da:
    // forfatteren skriver på bokmål, bytter menyen til engelsk, ber om en revisjon i chatten.
    // Oppslaget faller tilbake til den norske teksten, men merker den `en-GB`; LLM-en svarer på
    // engelsk; oversettingen maskinoversetter tilbake til nb og nn — og forfatterens egen
    // originaltekst er byttet mot en maskinoversettelse av en engelsk revisjon.
    //
    // Alt som LESER eller SKRIVER modulinnhold skal bruke `contentLocale`. Menyspråket styrer
    // menyer.
    result = await apiFetch(
      "/api/admin/content/generate/module-draft/revise",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({
          taskText: localizeValueForLocale(sessionDraft?.taskText ?? "", contentLocale),
          assessorExpectedContent: localizeValueForLocale(sessionDraft?.assessorExpectedContent ?? "", contentLocale),
          candidateTaskConstraints: localizeValueForLocale(sessionDraft?.candidateTaskConstraints ?? "", contentLocale),
          instruction,
          locale: contentLocale,
        }),
        signal: abort.signal,
      },
    );
  } catch (err) {
    generationAbort = null;
    sessionState = sessionDraft ? "draft-pending" : "module-loaded";

    if (err?.name === "AbortError" || String(err).includes("abort")) {
      logResolveSlot(slot, () => escapeHtml(t("shell.revision.draftAborted")));
      return;
    }
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.revision.draftErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => reviseDraftInBackground(instruction, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const draft = result?.draft ?? result;
  const localizedDraft = await localizeDraftAcrossLocales(draft.taskText, draft.assessorExpectedContent, contentLocale, draft.candidateTaskConstraints);
  // #982: samme som ved generering — språk som ikke ble oversatt står tomme, og det skal sies.
  const localizeWarning = describeFailedLocales(localizedDraft.failedLocales, contentLocale);
  // #926 §6: dette er stien saken beskriver ordrett — forfatteren har skrevet i feltene og ber om
  // en revisjon i chatten. Uten porten kom svaret rett inn over deres eget arbeid.
  commitOrProposeGenerated({
    patch: { taskText: localizedDraft.taskText, assessorExpectedContent: localizedDraft.assessorExpectedContent, candidateTaskConstraints: localizedDraft.candidateTaskConstraints },
    slot,
    readyHtml: () => `<strong>${escapeHtml(t("shell.revision.draftReady"))}</strong>`,
    warningHtml: localizeWarning,
    onCommit: () => onAccept?.(draft),
  });
}

async function reviseMcqInBackground(instruction, onAccept) {
  const abort = startGeneration();
  const slot = logProgress("shell.revision.mcqProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  const currentQuestions = (sessionDraft?.mcqQuestions ?? []).map((question) => ({
    stem: localizeValueForLocale(question.stem, contentLocale),
    options: (question.options ?? []).map((option) => localizeValueForLocale(option, contentLocale)),
    correctAnswer: localizeValueForLocale(question.correctAnswer, contentLocale),
    rationale: localizeValueForLocale(question.rationale, contentLocale),
  }));
  let result;
  try {
    result = await apiFetch(
      "/api/admin/content/generate/mcq/revise",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({
          questions: currentQuestions,
          instruction,
          locale: contentLocale,
          questionCount: currentQuestions.length,
          optionCount: currentQuestions[0]?.options?.length ?? 4,
        }),
        signal: abort.signal,
      },
    );
  } catch (err) {
    generationAbort = null;
    sessionState = sessionDraft ? "draft-pending" : "module-loaded";

    if (err?.name === "AbortError" || String(err).includes("abort")) {
      logResolveSlot(slot, () => escapeHtml(t("shell.revision.mcqAborted")));
      return;
    }
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.revision.mcqErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => reviseMcqInBackground(instruction, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const questions = result?.questions ?? [];
  const { questions: localizedQuestions, failedLocales } = await localizeMcqAcrossLocales(questions, contentLocale);
  commitOrProposeGenerated({
    patch: { mcqQuestions: localizedQuestions },
    slot,
    scroll: "bottom",
    readyHtml: () => `<strong>${escapeHtml(tf("shell.revision.mcqReady", { count: questions.length }))}</strong>`,
    // #1014: et språk som ikke ble oversatt skal stå i kvitteringen — ellers sier flaten «klart»
    // over et sett der ett språk mangler.
    //
    // ⚠️ I `warningHtml`, ikke i `readyHtml`. #982: advarsler lagt i `readyHtml` forsvinner når
    // forslaget parkeres bak åpne felter, og kunne landes uten at de noen gang var synlige.
    warningHtml: describeFailedLocales(failedLocales, contentLocale),
    onCommit: () => onAccept?.(questions),
  });
}

async function applyStructuredTitleEditInBackground(newTitle) {
  const snapshot = resolveCurrentDraftSnapshot();
  const slot = logProgress("shell.revision.titleProgress");
  slot.abortBtn.remove();

  try {
    const localizedDraft = await localizeDraftAcrossLocalesWithTitle(
      newTitle,
      snapshot.taskText,
      snapshot.assessorExpectedContent,
      snapshot.sourceLocale,
      snapshot.candidateTaskConstraints,
    );
    // En delvis oversettelse er ikke en suksess. Sier vi «ferdig» her, står forfatteren igjen med en
    // tittel som ser oversatt ut, men som er kildeteksten kopiert inn — og oppdager det først når en
    // deltaker møter feil språk.
    // ⚠️ #1016: brukte `shell.revision.titleNotTranslated`, som sier at språkene «står fortsatt med
    // kildeteksten». Koden over SLIPPER lokalen, så de står tomme. Teksten sendte forfatteren for å
    // lete etter noe som ikke er der. Det finnes nå bare én oppførsel, og derfor bare én tekst.
    const warning = localizedDraft.failedLocales?.length
      ? ` ${tf("shell.generating.draftNotTranslated", {
          locales: localizedDraft.failedLocales.join(", "),
          source: snapshot.sourceLocale,
        })}`
      : "";
    // #926 QA: denne skrev rett i utkastet. En tittelendring er noe forfatteren ba om, så det er
    // fristende å la den passere — men patchen bærer også taskText, assessorExpectedContent og
    // candidateTaskConstraints, hentet fra `resolveCurrentDraftSnapshot()`, som leser utkastet og
    // IKKE de åpne feltene. Ulagret tekst ble derfor byttet ut med den lagrede, re-lokalisert, og
    // skjemaet tegnet på nytt uten at noe spurte. Nås fra samme chat-boks som revisjonsstiene.
    commitOrProposeGenerated({
      patch: {
        title: localizedDraft.title,
        taskText: localizedDraft.taskText,
        assessorExpectedContent: localizedDraft.assessorExpectedContent,
        candidateTaskConstraints: localizedDraft.candidateTaskConstraints,
      },
      slot,
      // #982: advarselen som EGET argument. Lå den i `readyHtml`, forsvant den i det øyeblikket
      // forfatteren hadde en redigeringsflate åpen — og da parkeres forslaget i stedet.
      readyHtml: () => `<strong>${escapeHtml(tf("shell.revision.titleReady", { title: newTitle }))}</strong>`,
      warningHtml: warning
        ? `<p style="margin:8px 0 0;font-size:13px;color:var(--color-warning,#8a5f10)">${escapeHtml(warning)}</p>`
        : "",
    });
  } catch (err) {
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.revision.titleErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => applyStructuredTitleEditInBackground(newTitle) },
      { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
    ]);
  }
}

async function refreshLocalizedDraftInBackground({ draft, mcq }) {
  const snapshot = resolveCurrentDraftSnapshot();
  const slot = logProgress("shell.revision.translateProgress");
  slot.abortBtn.remove();

  try {
    const localizedDraft = draft
      ? await localizeDraftAcrossLocalesWithTitle(
        snapshot.title,
        snapshot.taskText,
        snapshot.assessorExpectedContent,
        snapshot.sourceLocale,
        snapshot.candidateTaskConstraints,
      )
      : null;
    const localizedMcq = mcq && snapshot.mcqQuestions.length
      ? await localizeMcqAcrossLocales(snapshot.mcqQuestions, snapshot.sourceLocale)
      : null;

    const patch = {};
    if (localizedDraft) {
      patch.title = localizedDraft.title;
      patch.taskText = localizedDraft.taskText;
      patch.assessorExpectedContent = localizedDraft.assessorExpectedContent;
      patch.candidateTaskConstraints = localizedDraft.candidateTaskConstraints;
    }
    if (localizedMcq) {
      patch.mcqQuestions = localizedMcq.questions;
    }
    // #926 QA: samme hull som tittelstien. «Oversett til nynorsk» i chatten leser utkastet, ikke
    // feltene, så en oversettelse skrev håndskrevet, ulagret tekst ut av veien.
    //
    // ⚠️ #982: denne sto helt stum — den ignorerte `failedLocales` og sa «Oversettelse klar»
    // uansett. Det er RE-oversettelsesflaten, altså stedet der feilede språk er mest sannsynlige,
    // og der en forfatter minst av alt bør tro at jobben er gjort.
    commitOrProposeGenerated({
      patch,
      slot,
      scroll: localizedMcq && !localizedDraft ? "bottom" : "top",
      readyHtml: () => `<strong>${escapeHtml(t("shell.revision.translateReady"))}</strong>`,
      // #1014: MCQ-oversettelsen kan feile for et sprak uten at utkastveien gjorde det. Sto her
      // bare `localizedDraft`, rapporterte re-oversettelsesflaten halve sannheten — og det er
      // nettopp flaten der feilede sprak er mest sannsynlige.
      warningHtml: describeFailedLocales(
        [...new Set([...(localizedDraft?.failedLocales ?? []), ...(localizedMcq?.failedLocales ?? [])])],
        snapshot.sourceLocale,
      ),
    });
  } catch (err) {
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.revision.translateErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => refreshLocalizedDraftInBackground({ draft, mcq }) },
    ]);
  }
}

async function saveDraftBundleInBackground(options = {}) {
  const { afterSave = null } = options;
  // #1046 A1: et nytt element finnes ikke på tjeneren før første Lagre. Navnet er det som kreves.
  if (!selectedModuleId && sessionDraft) {
    const created = await createModuleFromDraft();
    if (!created) return;
    // Bare navn, type og nivå så langt (fra Innstillinger): modulen finnes nå, men det er ingen
    // versjon å lagre. Last den inn, behold utkastet (typen!) og gå til Rediger for innholdet.
    const hasContent = Object.keys(nonEmptyLocaleMap(sessionDraft.taskText)).length > 0 || (sessionDraft.mcqQuestions?.length ?? 0) > 0;
    if (!hasContent) {
      const keep = sessionDraft;
      await loadModule(selectedModuleId);
      sessionDraft = keep;
      showDraftReadyActions({ quiet: true });
      switchToTab("edit");
      showToast(t("shell.newModule.createdGoEdit"), "success");
      return;
    }
  }
  const moduleId = selectedModuleId;
  if (!moduleId) {
    logBot(() => t("shell.save.moduleRequired"));
    return;
  }

  const { taskText, assessorExpectedContent, candidateTaskConstraints, assessmentBlueprint, mcqQuestions, criteria } = resolveDraftForSave();
  // #555: MCQ-only drafts have no taskText/rubric/prompt — they save a single MCQ_ONLY module
  // version with a pass-mark policy. assessmentMode/mcqMinPercent are flagged on sessionDraft by
  // createMcqOnlyModuleThenGenerate.
  // #896 S4 QA: fall back to the STORED mode. Reading only `sessionDraft` meant any save that
  // started without a session draft — the gap-fill flow, but also anything else that patches one
  // field on a loaded module — treated a FREETEXT_ONLY or MCQ_ONLY module as FREETEXT_PLUS_MCQ.
  // For FREETEXT_ONLY that hits the MCQ-required guard and the save silently never happens; for
  // MCQ_ONLY it would have written a version of the wrong type. The direct-edit path already
  // resolved the mode this way; the save path did not.
  const storedAssessmentMode = bundle?.selectedConfiguration?.moduleVersion?.assessmentMode;
  const effectiveAssessmentMode = sessionDraft?.assessmentMode ?? storedAssessmentMode;
  const isMcqOnly = effectiveAssessmentMode === "MCQ_ONLY";
  // #578: FREETEXT_ONLY drafts have taskText + rubric + prompt but NO MCQ set.
  const isFreetextOnly = effectiveAssessmentMode === "FREETEXT_ONLY";
  // Same fallback chain as the mode above: session draft, then the stored policy, then the
  // platform default. Skipping the stored value silently reset the pass threshold on any save
  // that did not go through the revision flow.
  const storedMcqMinPercent = bundle?.selectedConfiguration?.moduleVersion?.assessmentPolicy?.passRules?.mcqMinPercent;
  const mcqMinPercent = Number.isFinite(sessionDraft?.mcqMinPercent)
    ? sessionDraft.mcqMinPercent
    : Number.isFinite(storedMcqMinPercent)
      ? storedMcqMinPercent
      : SHELL_MCQ_ONLY_MIN_PERCENT;
  // Produkteier 13.09: ingenting som står i handlingsraden skal gjentas som valg i samtalen.
  // Meldingen sier hva som mangler; veien videre er knappene i hodet og feltene i skjemaet.
  // Skjemaet ble revet ved bekreftelsen; en stoppet lagring skal la forfatteren stå i det igjen.
  const backToForm = () => {
    if (activeTab !== "edit") switchToTab("edit");
    if (!isEditFormOpen()) enterPreviewEditMode({ force: true });
    showDraftReadyActions({ quiet: true });
  };
  if (!isMcqOnly && !localizeValueForLocale(taskText, contentLocale).trim()) {
    logBot(() => t("shell.save.taskRequired"));
    showToast(t("shell.save.taskRequired"), "error");
    backToForm();
    document.getElementById("previewEditTaskText")?.focus();
    return;
  }
  // #578: FREETEXT_ONLY modules have no MCQ — skip the MCQ-required guard for them.
  if (!isFreetextOnly && !mcqQuestions.length) {
    logBot(() => t("shell.save.mcqRequired"));
    showToast(t("shell.save.mcqRequired"), "error");
    backToForm();
    document.getElementById("previewEditAddQuestion")?.focus();
    return;
  }

  const slot = logProgress("shell.save.progress");
  slot.abortBtn.remove();

  try {
    const promptPayload = resolveCurrentPromptPayload();

    const titlePatch = normalizeModuleTitlePatch(sessionDraft?.title);

    // #555: MCQ-only save path — MCQ set plus an MCQ_ONLY version with a pass-mark policy, no
    // rubric/prompt/taskText. #906: one composed call, so the rename, the MCQ set and the
    // version share a transaction instead of committing one at a time.
    if (isMcqOnly) {
      const composed = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({
          ...(titlePatch ? { title: titlePatch } : {}),
        // #896 S3b: the description travels with the save as a locale patch, so the composer
        // merges it onto the stored value instead of replacing the other languages.
        ...(sessionDraft?.description !== undefined ? { description: sessionDraft.description } : {}),
          assessmentMode: "MCQ_ONLY",
          mcqSet: { title: resolveMcqTitlePayload(), questions: mcqQuestions },
          assessmentPolicy: { passRules: { mcqMinPercent } },
        }),
      });

      latestSavedModuleVersionId = composed?.moduleVersion?.id ?? null;
      sessionDraft = null;
      previewDraft = null;
      await loadModule(moduleId);
      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.save.success"))}</strong>`);
      showToast(t("shell.save.success"), "success");
      announceStatus(t("shell.save.success"));
      if (afterSave) afterSave();
      return;
    }

    // Rubric: two paths.
    //   - Explicit criteria from direct edit (#449) travel INSIDE the composed save below, so
    //     they land in the same transaction as the version.
    //   - Otherwise ensure-rubric (#447) runs first. It cannot join the transaction: it may
    //     call the LLM to generate a rubric, and an HTTP round trip has no business holding a
    //     database transaction open. It is idempotent by design, so a later failure just leaves
    //     a reusable rubric behind rather than an orphan.
    let inlineRubric = null;
    let rubricBody;
    if (criteria && Object.keys(criteria).length > 0) {
      const existingScaling = bundle?.selectedConfiguration?.rubricVersion?.scalingRule ?? {};
      const totalMax = Object.values(criteria).reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
      const scalingRule = { ...existingScaling, max_total: totalMax, practical_weight: existingScaling.practical_weight ?? 70 };
      inlineRubric = { criteria, scalingRule };
    } else {
      let blueprintObject = null;
      if (assessmentBlueprint) {
        if (typeof assessmentBlueprint === "string") {
          try { blueprintObject = JSON.parse(assessmentBlueprint); } catch { blueprintObject = null; }
        } else if (typeof assessmentBlueprint === "object") {
          blueprintObject = assessmentBlueprint;
        }
      }
      // ⚠️ translateLocalizedText returnerer et SPRÅKKART, ikke en streng. `String(kart)` gir
      // "[object Object]" — og dette endepunktet genererer rubrikken fra teksten, så den fikk
      // servert nettopp den strengen i stedet for scenarioet. Bruk lokale-oppslaget: dette
      // endepunktet tar ren tekst i ETT språk, og sender allerede `locale` ved siden av.
      const ensureRubricBody = {
        taskText: String(localizeValueForLocale(taskText, contentLocale) ?? "").trim(),
        assessorExpectedContent: String(localizeValueForLocale(assessorExpectedContent, contentLocale) ?? "").trim(),
        candidateTaskConstraints: String(localizeValueForLocale(candidateTaskConstraints, contentLocale) ?? "").trim() || undefined,
        certificationLevel: certificationLevelForGeneration(),
        locale: contentLocale,
        ...(blueprintObject ? { blueprint: blueprintObject } : {}),
      };
      rubricBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/rubric-versions/ensure`, getHeaders, {
        method: "POST",
        body: JSON.stringify(ensureRubricBody),
      });
    }

    // #906: one call. Rename, rubric, prompt template, MCQ set and the version that ties them
    // together now share a transaction — either the module has a complete new version or it is
    // untouched. Five separate commits used to leave orphaned component versions behind when
    // the last one failed, and a retry made a second set.
    const composed = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/versions`, getHeaders, {
      method: "POST",
      body: JSON.stringify({
        ...(titlePatch ? { title: titlePatch } : {}),
        // #896 S3b: the description travels with the save as a locale patch, so the composer
        // merges it onto the stored value instead of replacing the other languages.
        ...(sessionDraft?.description !== undefined ? { description: sessionDraft.description } : {}),
        assessmentMode: isFreetextOnly ? "FREETEXT_ONLY" : "FREETEXT_PLUS_MCQ",
        // #905: send the value as it is. translateLocalizedText used to blow a plain string up
        // into three identical locales here - not because the API demanded it, but out of
        // habit - which stored the source language under every locale and made an untranslated
        // field indistinguishable from a translated one. The schema accepts a plain string
        // ("one language, not translated yet") and now also a partial map.
        // Blank locales stripped from ALL of them, not just the optional one. A blank locale is
        // rejected wherever it appears, and the field that happened to hit it first was only the
        // first to be noticed.
        taskText: dropBlankLocales(taskText) ?? taskText,
        assessorExpectedContent: dropBlankLocales(assessorExpectedContent) ?? assessorExpectedContent,
        candidateTaskConstraints: dropBlankLocales(candidateTaskConstraints),
        assessmentBlueprint: assessmentBlueprint || undefined,
        // Explicit criteria ride along; a rubric from ensure-rubric is referenced by id.
        ...(inlineRubric ? { rubric: inlineRubric } : { rubricVersionId: rubricBody?.rubricVersion?.id }),
        promptTemplate: promptPayload,
        // #578: FREETEXT_ONLY has no MCQ set.
        ...(isFreetextOnly ? {} : { mcqSet: { title: resolveMcqTitlePayload(), questions: mcqQuestions } }),
        submissionSchema: resolveSubmissionSchemaPayload(),
      }),
    });

    latestSavedModuleVersionId = composed?.moduleVersion?.id ?? null;
    sessionDraft = null;
    previewDraft = null;
    await loadModule(moduleId);
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.save.success"))}</strong>`);
    showToast(t("shell.save.success"), "success");
    announceStatus(t("shell.save.success"));
    if (afterSave) afterSave();
  } catch (err) {
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.save.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => saveDraftBundleInBackground(options) },
    ]);
  }
}

// #896 S4: which locale a value ACTUALLY has, with no fallback. localizeValueForLocale falls
// back to nb/en-GB by design so the preview is never blank — exactly wrong when the question is
// "is this locale missing?", because the fallback answers "no" for every locale.

// The stored value read as one language. A bare string is legacy content read as nb — see
// LEGACY_STRING_LOCALE in localized-value.js for why the client must agree with the server here.
function sourceTextForLocale(value, locale) {
  const strict = strictLocaleValue(value, locale);
  if (strict.trim()) return strict;
  if (locale === LEGACY_STRING_LOCALE && typeof value === "string") return value;
  return "";
}

// The text fields the gate covers. Must stay in step with the server's field set — the two lists
// disagreeing means the author is offered a fix for a gap that is not the one blocking them.
const TRANSLATION_GATE_FIELDS = ["title", "description", "taskText", "assessorExpectedContent", "candidateTaskConstraints"];

// The stored value as a locale map holding only the locales that really have text. A plain string
// is recorded under `sourceLocale` — it has to land somewhere, and the author's working language
// is the only honest guess available at this point.
function localeMapOf(value) {
  const map = {};
  for (const locale of supportedLocales) {
    const existing = strictLocaleValue(value, locale);
    if (existing.trim()) map[locale] = existing;
  }
  if (Object.keys(map).length === 0 && typeof value === "string" && value.trim()) {
    // Legacy bare string: label it with the locale the server reads it as, not with whatever the
    // author happens to be looking at. Anything else silently relabels the text's language.
    map[LEGACY_STRING_LOCALE] = value;
  }
  return map;
}

function fillLocaleGap(map, locale, text) {
  if (map[locale]?.trim()) return;
  if (typeof text === "string" && text.trim()) map[locale] = text;
}

// #905: a locale with no text gets no entry — never a copy of the source. Note what this does NOT
// do: it does not collapse a single-locale map back to a bare string. A bare string is content
// whose language is unrecorded, which is what forced the gate to guess "nb" and mislabel an
// author working in English. `{nb: "..."}` says the same thing and says which language.
function collapseLocaleMap(map) {
  return Object.keys(map).length === 0 ? "" : map;
}

// #913: MCQ fields now take partial maps too, so a half-successful translation keeps what
// succeeded. This used to collapse anything short of all three locales back to the source
// language, which threw away the locales that DID translate — the author paid for a translation,
// was told it was saved, and the next publish attempt asked for it again.

function translationGateIssuesFrom(error) {
  const issues = error?.body?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((issue) => issue?.code === "translation_incomplete" && Array.isArray(issue.missingLocales));
}

function translationGateFieldLabel(field) {
  // MCQ issues are per question, so the field name carries an index: mcq.question3. There is no
  // key per question — the label is built from the pattern.
  const mcq = /^mcq\.question(\d+)$/.exec(String(field ?? ""));
  if (mcq) return t("shell.publish.field.mcqQuestion").replace("{n}", mcq[1]);
  const label = t(`shell.publish.field.${field}`);
  // An unknown field must still be NAMED — a silent omission would tell the author the module is
  // complete while publishing keeps failing. Falling back to the raw key is ugly but truthful.
  return label.startsWith("shell.publish.field.") ? String(field) : label;
}

function describeTranslationGate(issues, otherBlockers = []) {
  const lines = issues.map((issue) => {
    const label = translationGateFieldLabel(issue.field);
    return t("shell.publish.translationGate.item")
      .replace("{field}", label)
      .replace("{locales}", issue.missingLocales.join(", "));
  });
  // A publish response can carry a blueprint mismatch alongside the translation gaps. Showing only
  // the gaps meant the author translated, retried, and failed again on a blocker they were never
  // told about — the gate would have taught them to distrust it.
  // #914: koden og `params` er sannheten; serverens `message` er reserve.
  //
  // Bruker den DELTE `apiErrorCodeText`, som #980 alt hadde bygget for publiseringsdialogen. Den
  // slaar opp `errors.api.<kode>` (med variant naar koden trenger det) og fyller plassholderne.
  //
  // Foerste utgave av #914 lagde en egen `describeGateIssue` med egne `adminContent.validation.*`
  // -noekler. Det var en ANDRE mekanisme for samme jobb, med sin egen ordlyd — «Restore it before
  // publishing» mot #980 sin «Restore it before you publish». Nettopp den driften saken skal fjerne.
  const others = otherBlockers
    .map((issue) => {
      // `item_archived` slaas opp som `errors.api.item_archived.module` / `.section`, fordi den
      // brukes for begge med ulik tekst (#980). Varianten staar i `params.itemType`.
      //
      // ⚠️ Uten dette faller nettopp den koden tilbake paa serverens `message` — som er hardkodet
      // NORSK. En engelsk forfatter fikk da norsk tekst for arkiverte moduler, mens alt annet paa
      // samme skjerm var oversatt. Kursvisningen tok varianten fra RADEN og var derfor riktig, saa
      // feilen fantes bare i denne ene veien.
      const variant = typeof issue?.params?.itemType === "string" ? [issue.params.itemType.toLowerCase()] : [];
      return apiErrorCodeText(issue?.code ?? null, t, variant, issue?.params ?? null) || issue?.message;
    })
    .filter(Boolean);
  return `<strong>${escapeHtml(t("shell.publish.translationGate.heading"))}</strong><ul>${
    [...lines, ...others].map((line) => `<li>${escapeHtml(line)}</li>`).join("")
  }</ul>`;
}

// Blocking issues from the same publish response that are NOT translation gaps. "Translate what is
// missing" cannot clear these, so they are listed but not acted on.
function otherBlockingIssuesFrom(error) {
  const issues = error?.body?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((issue) => issue?.code !== "translation_incomplete" && issue?.severity === "blocking");
}

// #896 S4: "Oversett det som mangler" — fills only the holes. Every locale that already has
// content keeps exactly the text it has; the author's own wording is never overwritten by a
// machine translation of itself. What is translated goes through the ordinary save, so the
// result is a normal new version, and then publish is retried.
async function translateMissingLocalesThenPublish(issues) {
  const moduleId = selectedModuleId;
  if (!moduleId) return;

  const moduleVersion = bundle?.selectedConfiguration?.moduleVersion;
  const current = {
    title: sessionDraft?.title ?? bundle?.module?.title ?? "",
    description: sessionDraft?.description ?? bundle?.module?.description ?? "",
    taskText: sessionDraft?.taskText ?? moduleVersion?.taskText ?? "",
    assessorExpectedContent: sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
    candidateTaskConstraints: sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
  };
  const currentMcq = sessionDraft?.mcqQuestions?.length
    ? sessionDraft.mcqQuestions
    : (bundle?.selectedConfiguration?.mcqSetVersion?.questions ?? []);

  // Translate FROM a locale that actually has the content — and "the content" means the fields
  // the gate actually complained about, not a fixed pair. Requiring taskText AND
  // assessorExpectedContent made this unusable for the two cases most likely to hit the gate: an
  // MCQ-only module (no task text at all) and a module whose only gap is the title.
  const gatedTextFields = TRANSLATION_GATE_FIELDS.filter((field) =>
    issues.some((issue) => issue.field === field),
  );
  const needsMcqSource = issues.some((issue) => String(issue.field ?? "").startsWith("mcq."));
  // #974: menyspråket sto som andre kandidat her. Regelen (se `contentLocale`) er at menyen aldri
  // styrer innhold — kildeteksten til en oversettelse er innhold.
  const preferredOrder = [contentLocale, "nb", "en-GB", "nn"];
  const sourceLocale = preferredOrder.find((locale) => {
    if (!locale) return false;
    if (!gatedTextFields.every((field) => sourceTextForLocale(current[field], locale).trim())) return false;
    if (needsMcqSource) {
      // EVERY required part, not just the stem. A question can legally be mixed — a stem localized
      // into three languages next to options still stored as legacy bare strings — and picking a
      // source from the stem alone produced a request the options could not satisfy. The call
      // failed validation, and the gap went unnoticed because the option had no source text to
      // count as missing.
      return currentMcq.every((question) => {
        if (!sourceTextForLocale(question?.stem ?? "", locale).trim()) return false;
        if (!sourceTextForLocale(question?.correctAnswer ?? "", locale).trim()) return false;
        if (!(question?.options ?? []).every((option) => sourceTextForLocale(option, locale).trim())) return false;
        // The rationale too, but only when the question HAS one. Since #913 a question can hold a
        // rationale in one language and its stem in another; picking the stem's locale as source
        // left the rationale's gap unfillable, because the source locale is excluded from the
        // target list and only targets are ever checked. The republish then hit the same gate.
        const hasRationale = supportedLocales.some((l) => strictLocaleValue(question?.rationale, l).trim())
          || (typeof question?.rationale === "string" && question.rationale.trim());
        return !hasRationale || Boolean(sourceTextForLocale(question?.rationale ?? "", locale).trim());
      });
    }
    return true;
  });
  if (!sourceLocale) {
    logBot(() => t("shell.publish.translationGate.noSource"));
    return;
  }

  const missingLocales = [...new Set(issues.flatMap((issue) => issue.missingLocales))]
    .filter((locale) => locale !== sourceLocale);
  if (missingLocales.length === 0) return;

  const slot = logProgress("shell.publish.translationGate.progress");
  slot.abortBtn.remove();

  // Start from the stored values as locale maps, so untouched locales survive the save.
  const merged = {};
  for (const field of TRANSLATION_GATE_FIELDS) {
    merged[field] = localeMapOf(current[field], sourceLocale);
  }

  const sourceDraft = {
    title: sourceTextForLocale(current.title, sourceLocale),
    taskText: sourceTextForLocale(current.taskText, sourceLocale),
    assessorExpectedContent: sourceTextForLocale(current.assessorExpectedContent, sourceLocale),
    candidateTaskConstraints: sourceTextForLocale(current.candidateTaskConstraints, sourceLocale),
  };

  // The module-draft localizer translates the scenario, answer key and constraints together, which
  // is what makes them read as one coherent whole — but its schema DEMANDS a non-empty task text
  // and answer key. An MCQ-only module has neither, and a free-text module need not have the
  // answer key, so calling it unconditionally 400s and took the rest of the fill down with it.
  const canUseDraftLocalizer = Boolean(sourceDraft.taskText.trim() && sourceDraft.assessorExpectedContent.trim());
  // Fields that localizer actually returns. `description` is NOT among them — it used to be asked
  // for and never delivered, so a description-only gap could never be filled and the automatic
  // republish hit the same 422 forever.
  const DRAFT_LOCALIZER_FIELDS = ["title", "taskText", "assessorExpectedContent", "candidateTaskConstraints"];
  // The per-field localizer has two slots: `title` for short text, `bodyMarkdown` for long.
  const LONG_TEXT_FIELDS = new Set(["taskText", "assessorExpectedContent", "candidateTaskConstraints"]);

  // MCQ questions are participant-facing content too, and for an MCQ-only module they ARE the
  // assessment. Same rule as the text fields: start from what exists, fill only the empty slots.
  const mergedMcq = currentMcq.map((question) => ({
    stem: localeMapOf(question?.stem),
    options: (question?.options ?? []).map((option) => localeMapOf(option)),
    correctAnswer: localeMapOf(question?.correctAnswer),
    rationale: localeMapOf(question?.rationale),
  }));
  const needsMcqFill = issues.some((issue) => String(issue.field ?? "").startsWith("mcq."));
  const gapFields = new Set(gatedTextFields);

  const failedLocales = [];
  for (const targetLocale of missingLocales) {
    const stillMissing = () =>
      [...gapFields].filter(
        (field) => !merged[field][targetLocale]?.trim() && merged[field][sourceLocale]?.trim(),
      );

    if (canUseDraftLocalizer && stillMissing().some((field) => DRAFT_LOCALIZER_FIELDS.includes(field))) {
      try {
        const result = await apiFetch("/api/admin/content/generate/module-draft/localize", getHeaders, {
          method: "POST",
          body: JSON.stringify({ ...sourceDraft, sourceLocale, targetLocale }),
        });
        const draft = result?.draft ?? result;
        if (!draft?.title) throw new Error("localize returned no title");
        // Only the holes. A locale that already had text keeps it — this is the whole point of
        // "translate what is missing" rather than "translate everything".
        for (const field of DRAFT_LOCALIZER_FIELDS) {
          if (gapFields.has(field)) fillLocaleGap(merged[field], targetLocale, draft[field]);
        }
      } catch {
        // Swallowed on purpose: the per-field pass below is the retry, and whether this locale
        // actually failed is decided at the END from the gaps that remain — not from whether a
        // call threw. Treating the exception as failure meant a fallback that filled every gap
        // still reported failure and skipped the automatic republish.
      }
    }

    // Whatever the draft localizer could not cover — because it was skipped, because it failed, or
    // because the field is outside its vocabulary (description) — is translated one field at a
    // time. Slower, but it works for every module type.
    for (const field of stillMissing()) {
      try {
        const key = LONG_TEXT_FIELDS.has(field) ? "bodyMarkdown" : "title";
        const result = await apiFetch("/api/admin/content/sections/localize", getHeaders, {
          method: "POST",
          body: JSON.stringify({ [key]: merged[field][sourceLocale], sourceLocale, targetLocale }),
        });
        const translated = result?.[key];
        if (typeof translated === "string" && translated.trim()) merged[field][targetLocale] = translated.trim();
      } catch {
        // Same reasoning: the gap either got filled or it did not, and that is what is checked.
      }
    }

    if (needsMcqFill && mergedMcq.length > 0) {
      try {
        const mcqResult = await apiFetch("/api/admin/content/generate/mcq/localize", getHeaders, {
          method: "POST",
          body: JSON.stringify({
            questions: currentMcq.map((question) => {
              // A question may legitimately have no rationale. Sending "" for it is not the same
              // as leaving it out — the endpoint rejects an empty string, so the whole fill died
              // before the model ran.
              const rationale = sourceTextForLocale(question?.rationale ?? "", sourceLocale);
              return {
                stem: sourceTextForLocale(question?.stem ?? "", sourceLocale),
                options: (question?.options ?? []).map((option) => sourceTextForLocale(option, sourceLocale)),
                correctAnswer: sourceTextForLocale(question?.correctAnswer ?? "", sourceLocale),
                ...(rationale.trim() ? { rationale } : {}),
              };
            }),
            sourceLocale,
            targetLocale,
          }),
        });
        const translatedQuestions = mcqResult?.questions ?? [];
        translatedQuestions.forEach((question, index) => {
          const target = mergedMcq[index];
          if (!target) return;
          fillLocaleGap(target.stem, targetLocale, question?.stem);

          // The save schema requires correctAnswer to be one of options, VERBATIM. A translator
          // that renders the answer "The members." and the option "The members" produces a 200
          // here and a 400 three steps later, surfacing as a generic save failure with no hint
          // that the translation was the cause.
          //
          // Only checked for the values actually being merged: the response always carries every
          // field, so an inconsistency in an answer this locale does not need must not discard a
          // stem or rationale translation it does.
          const fillingAnswer = !target.correctAnswer[targetLocale]?.trim();
          const fillingOptions = target.options.some((option) => !option[targetLocale]?.trim());
          if (fillingAnswer || fillingOptions) {
            const translatedOptions = question?.options ?? [];
            if (
              typeof question?.correctAnswer === "string"
              && !translatedOptions.some((option) => option === question.correctAnswer)
            ) {
              throw new Error("translated correctAnswer does not match any translated option");
            }
          }
          fillLocaleGap(target.correctAnswer, targetLocale, question?.correctAnswer);
          // Only if the question HAD a rationale. The localization response contract requires the
          // model to return one, so a question without a rationale gets an invented one — stored
          // under the target locales only, and therefore read back as a gap on the very next
          // publish attempt. Inventing assessor-facing text nobody wrote is worse than the loop.
          if (Object.keys(target.rationale).length > 0) {
            fillLocaleGap(target.rationale, targetLocale, question?.rationale);
          }
          (question?.options ?? []).forEach((option, optionIndex) => {
            if (target.options[optionIndex]) fillLocaleGap(target.options[optionIndex], targetLocale, option);
          });
        });
      } catch {
        // Checked below, not here.
      }
    }

    // A locale counts as failed only if something is STILL missing after every attempt. Deciding
    // from thrown exceptions instead meant a first-choice localizer that failed marked the locale
    // as failed even when the fallback filled every gap — the author was told the translation had
    // failed, and the automatic republish they had asked for never ran.
    // A part is missing this locale when it HAS text somewhere and not here. Keyed on "the map is
    // non-empty" rather than "the source locale has text": a part with no source text is still a
    // gap the fill did not close, and reading it as satisfied reported success over the very hole
    // that blocked publishing. A rationale that is absent everywhere is not a gap — it is a field
    // this question does not have.
    const mcqStillMissing =
      needsMcqFill
      && mergedMcq.some((question) =>
        [question.stem, question.correctAnswer, question.rationale, ...question.options].some(
          (map) => Object.keys(map).length > 0 && !map[targetLocale]?.trim(),
        ),
      );
    if (stillMissing().length > 0 || mcqStillMissing) failedLocales.push(targetLocale);
  }

  // #905: never store a source-language copy under a locale that failed. An empty field is
  // honest; a copy pretends the translation happened.
  const patch = {};
  for (const field of TRANSLATION_GATE_FIELDS) {
    const value = collapseLocaleMap(merged[field]);
    // An optional field the module does not have must stay ABSENT, not become "". Materializing it
    // makes the save send an empty string, which the localized-text schema rejects — so an
    // otherwise successful gap-fill would fail at the last step for every module that has no
    // description and no candidate constraints.
    if (value === "") continue;
    patch[field] = value;
  }
  if (needsMcqFill && mergedMcq.length > 0) {
    patch.mcqQuestions = mergedMcq.map((question) => {
      const rationale = collapseLocaleMap(question.rationale);
      return {
        stem: collapseLocaleMap(question.stem),
        options: question.options.map((option) => collapseLocaleMap(option)),
        correctAnswer: collapseLocaleMap(question.correctAnswer),
        // A question may legitimately have no rationale. `rationale: ""` is a different thing and
        // the save schema rejects it, so an otherwise successful fill would 400 at the last step
        // — taking the text translations from the same attempt down with it.
        ...(rationale === "" ? {} : { rationale }),
      };
    });
  }
  commitSessionDraftPatch(patch);

  if (failedLocales.length > 0) {
    logResolveSlot(slot, () => escapeHtml(t("shell.publish.translationGate.failed")), [
      { labelKey: "shell.action.retry", action: () => translateMissingLocalesThenPublish(issues) },
    ]);
    // Save what did succeed — the author should not lose the translations that worked — but do
    // not retry publish, since it would only hit the same gate.
    await saveDraftBundleInBackground();
    return;
  }

  logResolveSlot(slot, () => escapeHtml(t("shell.revision.translateReady")));
  await saveDraftBundleInBackground({ afterSave: publishLatestDraftInBackground });
}

async function publishLatestDraftInBackground() {
  const moduleId = selectedModuleId;
  const moduleVersionId = latestSavedModuleVersionId ?? bundle?.selectedConfiguration?.moduleVersion?.id;
  if (!moduleId || !moduleVersionId) {
    logBot(() => t("shell.publish.versionRequired"));
    return;
  }

  const slot = logProgress("shell.publish.progress");
  slot.abortBtn.remove();

  try {
    await apiFetch(
      `/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions/${encodeURIComponent(moduleVersionId)}/publish`,
      getHeaders,
      { method: "POST", body: JSON.stringify({}) },
    );
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.publish.success"))}</strong>`);
    showToast(t("shell.publish.success"), "success");
    announceStatus(t("shell.publish.success"));
    sessionDraft = null;
    previewDraft = null;
    latestSavedModuleVersionId = null;
    // UX: etter publisering, last modulen på nytt (nå Live) og vis modul-handlinger
    // ("Hva vil du gjøre med denne modulen?") i stedet for full modul-velger. loadModule
    // avslutter med showModuleActions() og bevarer kontekst til modulen man nettopp
    // publiserte; "Velg en annen modul" er fortsatt tilgjengelig derfra. Samme mønster
    // som unpublishModuleInBackground.
    await loadModule(moduleId);
  } catch (err) {
    // #896 S4: a half-translated module is not a failure to report as a stack of JSON — it is a
    // list of holes with an action that fills them.
    const gateIssues = translationGateIssuesFrom(err);
    if (gateIssues.length > 0) {
      const otherBlockers = otherBlockingIssuesFrom(err);
      logResolveSlot(slot, () => describeTranslationGate(gateIssues, otherBlockers), [
        { labelKey: "shell.publish.translationGate.fillGaps", action: () => translateMissingLocalesThenPublish(gateIssues) },
        { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
      ]);
      return;
    }
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.publish.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: publishLatestDraftInBackground },
    ]);
  }
}

async function unpublishModuleInBackground() {
  const moduleId = selectedModuleId;
  if (!moduleId) return;

  const slot = logProgress("shell.unpublish.progress");
  slot.abortBtn.remove();

  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/unpublish`, getHeaders, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadModule(moduleId);
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.unpublish.success"))}</strong>`);
    showToast(t("shell.unpublish.success"), "success");
    announceStatus(t("shell.unpublish.success"));
  } catch (err) {
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.unpublish.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: unpublishModuleInBackground },
    ]);
  }
}
function confirmHighImpactAction(promptKey, confirmKey, action, cancelAction = showModuleActions, vars = {}) {
  logBot(() => escapeHtml(tf(promptKey, vars)), [
    { labelKey: confirmKey, action },
    { labelKey: "shell.action.cancel", action: cancelAction },
  ]);
}

// #1046 A1: lag modulen på tjeneren fra utkastets navn. Returnerer false (og sier hvorfor) når navnet
// mangler eller opprettingen feilet. Adressen byttes til den ekte, så oppfrisking og tilbake-lenker
// virker som for et element som fantes fra før.
async function createModuleFromDraft() {
  const title = sessionDraft?.title;
  const hasTitle = typeof title === "string" ? title.trim().length > 0
    : !!title && Object.values(title).some((v) => typeof v === "string" && v.trim().length > 0);
  if (!hasTitle) {
    logBot(() => t("shell.save.titleRequired"));
    showToast(t("shell.save.titleRequired"), "error");
    return false;
  }
  const slot = logProgress("shell.newModule.creating", { quiet: true });
  slot.abortBtn.remove();
  try {
    const body = await apiFetch("/api/admin/content/modules", getHeaders, {
      method: "POST",
      body: JSON.stringify({
        title: typeof title === "string" ? titleInContentLocale(title) : title,
        ...(sessionDraft?.certificationLevel ? { certificationLevel: sessionDraft.certificationLevel } : {}),
      }),
    });
    const created = body?.module ?? body;
    const id = created?.id ?? created?.moduleId;
    if (!id) throw new Error("no module id");
    selectedModuleId = id;
    newModulePlaceholder = false;
    window.history.replaceState(null, "", `/admin-content/module/${encodeURIComponent(id)}/conversation`);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.newModule.created"))} <strong>${escapeHtml(localizeValue(title))}</strong>`);
    return true;
  } catch (err) {
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.newModule.createError"))} ${escapeHtml(errMsg)}`);
    showToast(`${t("shell.newModule.createError")} ${errMsg}`, "error");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Chat flows
// ---------------------------------------------------------------------------

function startIdle() {
  sessionState = "idle";
  bundle = null;
  selectedModuleId = null;
  sessionDraft = null;
  sessionDraftFromForm = false;
  newModulePlaceholder = false;
  previewDraft = null;
  latestSavedModuleVersionId = null;
  renderPreview();
  // Uten modul er lista stedet: «Ny modul» og åpning skjer der (#1046 A1). Ingen samtalevalg her.
  logBot(() => t("shell.idle.prompt"));
}


async function loadModule(moduleId, options = {}) {
  const { resumeEditing = false } = options;
  sessionState = "loading-module";
  selectedModuleId = moduleId;
  sessionDraft = null;
  sessionDraftFromForm = false;
  newModulePlaceholder = false;
  previewDraft = null;
  latestSavedModuleVersionId = null;
  settingsTab.resetSettingsPanelState();
  const slot = logProgress("shell.module.loading", { quiet: true });

  try {
    const exportData = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    bundle = exportData?.moduleExport ?? null;
  } catch {
    // Stage-tilbakemelding 2026-08-17: send forfatteren til modul-lista i stedet for å bygge en
    // ny, lang liste inne i samtalen. Lista har søk og filtre; dette hadde ingen av delene.
    logResolveSlot(slot, () => t("shell.module.loadError"), [
      { labelKey: opphavFraUrl() ? "shell.module.backToCourse" : "shell.module.goToLibrary", action: () => { location.href = opphavFraUrl() ?? "/admin-content"; } },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  sessionState = "module-loaded";

  // B3 (#450): recompute blueprint hash so the drift banner can be classified on first render.
  await refreshBlueprintHash();

  // #896 S3c: the handoff is gone with the Avansert editor. It existed to carry an unsaved draft
  // and the two locales between two surfaces; there is one surface now, so there is nothing to
  // carry and nothing to keep in sync. `resumeEditing` survives because the module list and old
  // links still use it to mean "open this module ready to edit".
  const resumedIntoDraft = resumeEditing && createSessionDraftFromLoadedModule();
  renderPreview();
  // QA round 6: reloading on `?tab=settings` selected the tab, drew the panel before the module
  // had arrived — "load a module to see the settings" — and then never drew it again. The author
  // had to switch tabs and back. Only the preview was re-rendered here.
  settingsTab.renderSettingsPanel();
  // Rediger is the default tab, so a module opened from its URL lands here — and it has to land in
  // an editable state, not a read-only one behind a button.
  if (activeTab === "edit") enterPreviewEditMode();

  // Capture data for retranslatable closure
  const capturedTitle = localizeValue(bundle?.module?.title) || moduleId;
  const capturedIsLive = !!bundle?.module?.activeVersionId;
  const capturedIsArchived = !!bundle?.module?.archivedAt;
  const capturedVersionNo = bundle?.selectedConfiguration?.moduleVersion?.versionNo ?? "?";
  logResolveSlot(slot, () => {
    const statusNote = capturedIsArchived
      ? t("shell.module.archivedStatus")
      : capturedIsLive
        ? tf("shell.module.liveStatus", { versionNo: capturedVersionNo })
        : t("shell.module.noPublishedVersion");
    return `<strong>${escapeHtml(capturedTitle)}</strong> ${escapeHtml(t("shell.module.loaded"))}<br><span style="color:var(--color-meta);font-size:13px">${escapeHtml(statusNote)}</span>`;
  });
  if (resumedIntoDraft) {
    logBot(() => t("shell.module.resumeEditingReady"));
    showDraftReadyActions();
    return;
  }
  showModuleActions();
}
function describeStructuredEditIntent(intent) {
  if (intent.kind === "title") {
    return tf("shell.revision.intent.title", { title: intent.title });
  }
  if (intent.kind === "translate") {
    return t("shell.revision.intent.translate");
  }
  if (intent.kind === "revision" && intent.draft && intent.mcq) {
    return t("shell.revision.intent.draftAndMcq");
  }
  if (intent.kind === "revision" && intent.draft) {
    return t("shell.revision.intent.draft");
  }
  if (intent.kind === "revision" && intent.mcq) {
    return t("shell.revision.intent.mcq");
  }
  return "";
}

// v1.2.23 (#357 Phase A): instrumentering. Sender hver intent-klassifisering til server
// så vi kan samle ekte pilot-bruker-ordbruk og bygge evidensen som Phase B (hybrid LLM-
// fallback) trenger. Best-effort fire-and-forget — feil i loggingen skal aldri påvirke
// brukerens flyt.
function logIntentClassificationToServer(rawInput, intent, ctx) {
  apiFetch(
    "/api/admin/content/intent-log",
    getHeaders,
    {
      method: "POST",
      body: JSON.stringify({
        rawInput,
        intentKind: intent?.kind ?? null,
        targets: { draft: !!intent?.draft, mcq: !!intent?.mcq },
        locale: currentLocale,
        moduleId: selectedModuleId ?? null,
        hasDraft: ctx.hasDraft,
        hasMcq: ctx.hasMcq,
      }),
    },
  ).catch(() => { /* intentional — instrumentation must never block user flow */ });
}

async function runUnifiedRevision(instruction) {
  const classifyCtx = {
    hasDraft: !!(sessionDraft?.taskText || sessionDraft?.assessorExpectedContent),
    hasMcq: (sessionDraft?.mcqQuestions?.length ?? 0) > 0,
    hasSelectedModule: !!(selectedModuleId || sessionDraft?.title || bundle?.module?.title),
  };
  const intent = classifyShellEditInstruction(instruction, classifyCtx);
  logIntentClassificationToServer(instruction, intent, classifyCtx);

  if (intent.kind === "unsupported") {
    logBot(
      () => `${escapeHtml(t("shell.revision.unsupported"))}<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.revision.unsupportedHint"))}</span>`,
      [
        { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
      ],
    );
    return;
  }

  if (intent.kind === "clarify") {
    logBot(() => escapeHtml(t("shell.revision.clarify")), [
      { labelKey: "shell.revision.tryAgain", action: () => openReviseDialog() },
      { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
    ]);
    return;
  }

  const summary = describeStructuredEditIntent(intent);
  if (summary) {
    logBot(() => escapeHtml(summary));
  }

  if (intent.kind === "title") {
    await applyStructuredTitleEditInBackground(intent.title);
    showDraftReadyActions();
    return;
  }

  if (intent.kind === "translate") {
    await refreshLocalizedDraftInBackground({ draft: intent.draft, mcq: intent.mcq });
    showDraftReadyActions();
    return;
  }

  if (intent.kind !== "revision") {
    logBot(() => t("shell.revision.unavailable"));
    return;
  }

  if (intent.draft) {
    await reviseDraftInBackground(intent.instruction);
  }
  if (intent.mcq) {
    await reviseMcqInBackground(intent.instruction);
  }
  showDraftReadyActions();
}


function startDirectEditFlow() {
  enterPreviewEditMode();
}

// B2 (#449 redesign): builds inline criteria-editor HTML for use inside preview-edit-mode.
// criteria is an array of { id, label, description, maxScore, candidateVisible }. Renders
// as .vk-* cards (same classes the chat-bubble editor used; styles now sized for the wider
// preview pane). Total weight + add/regenerate buttons at the bottom.


/**
 * #896 S3c: the criteria editor's event behaviour, extracted so it can be mounted anywhere.
 *
 * It was ~110 lines inlined in `enterPreviewEditMode`, closing over five local variables. The
 * caller now supplies the container and a state accessor pair; everything else — slider echo,
 * aria upkeep, add/remove/regenerate — is identical, because a second copy of this behaviour is
 * exactly what the epic is trying to get rid of.
 */
// #1049: nivåets standard for svarlengde, vist som plassholder når forfatteren ikke har satt noe.
//
// ⚠️ En kopi av LEVEL_SCOPE på serveren, og det er en bevisst en: klienten trenger tallet for å vise
// hva som gjelder når feltet står tomt, og den kan ikke importere serverens TypeScript.
// `test/unit/level-budget-copies-guard.test.ts` holder den i takt med kilden.
const LEVEL_SCOPE_DEFAULTS = {
  basic: { minWords: 100, maxWords: 200 },
  intermediate: { minWords: 250, maxWords: 450 },
  advanced: { minWords: 400, maxWords: 700 },
};

const CERTIFICATION_LEVELS = ["basic", "intermediate", "advanced"];

/**
 * The certification level as a single plain value.
 *
 * The level is a FIXED SCALE — easy, medium, hard — and one module has one of them. It is not
 * prose, and it is not translated per module: the three labels are translated once, in
 * `shell.certLevel.*`, and the stored value is the key.
 *
 * I got that wrong. QA round 2 reported that an UNTOUCHED level was being overwritten, and the
 * actual cause was a locale mix-up in the comparison. I fixed that, but also made the save merge
 * the field per locale — which produced values like `{"en-GB":"advanced","nb":"basic"}`, i.e. "the
 * module is advanced in English and basic in Norwegian". That is not a translation, it is
 * contradictory data, and it broke the `generate/*` endpoints, which validate an enum. This
 * function reads whatever shape is already stored and gives back one value.
 */
function certificationLevelValue(raw) {
  if (typeof raw === "string") return raw.trim();
  if (!raw || typeof raw !== "object") return "";
  const values = Object.values(raw).map((v) => String(v ?? "").trim()).filter(Boolean);
  // A legacy locale object can disagree with itself; a canonical level wins over free text.
  return values.find((v) => CERTIFICATION_LEVELS.includes(v)) ?? values[0] ?? "";
}

/**
 * The level as the GENERATION endpoints want it: one of the three enum values, never a container.
 *
 * Five call sites used to send `bundle.module.certificationLevel` raw, so a locale object — or the
 * free text older modules were invited to type — gave a 400 and no criteria at all. Anything
 * outside the scale falls back to `intermediate`: the generators use it to pitch difficulty, so a
 * wrong-but-valid level degrades the output while an invalid one fails the whole call.
 */
/**
 * #1049: forfatterens omfang, hvis modulen har et. Utelates helt når hen ikke har satt noe — da
 * bruker serveren nivåets standard, og det er ETT sted den regnes ut.
 */
function scopeForGeneration() {
  const mod = bundle?.module ?? {};
  const min = typeof mod.scopeMinWords === "number" ? mod.scopeMinWords : null;
  const max = typeof mod.scopeMaxWords === "number" ? mod.scopeMaxWords : null;
  return min === null && max === null ? {} : { scope: { minWords: min, maxWords: max } };
}

function certificationLevelForGeneration() {
  // The level chosen in Innstillinger wins over the stored one while the panel is open. QA round 7:
  // picking `advanced` and then regenerating asked the service for `basic`, and the same save then
  // filed the module as `advanced` — the criteria and the level described different difficulties.
  const selected = document.getElementById("settingsCertLevel")?.value?.trim();
  if (selected && CERTIFICATION_LEVELS.includes(selected)) return selected;
  const value = certificationLevelValue(bundle?.module?.certificationLevel);
  return CERTIFICATION_LEVELS.includes(value) ? value : "intermediate";
}

/**
 * A fresh criterion id that collides with nothing already in the editor.
 *
 * QA round 4 fixed "add, remove, add reuses an id" with a counter; QA round 5 pointed out the
 * counter restarts on page load, so a rubric that already contains `new_criterion_1` gets it
 * handed out a second time — and `Object.fromEntries` keeps only the last one. Check the state.
 */
function freshCriterionId(existing) {
  const taken = new Set((existing ?? []).map((c) => String(c?.id ?? "")));
  let candidate;
  do {
    nextNewCriterionSeq += 1;
    candidate = `new_criterion_${nextNewCriterionSeq}`;
  } while (taken.has(candidate));
  return candidate;
}

let nextNewCriterionSeq = 0;

function wireCriteriaEditor({ container, getState, setState, rerender, onRegenerate }) {
  if (!container) return;

  // QA 2026-08-16: this was a second, byte-for-byte copy of `captureLatestCriteriaState`, and when
  // that one learned to carry the locale metadata (#902) this one did not — so Add or Remove threw
  // `storedLabel` away and the next save wrote bare strings, deleting the other two languages.
  // Deduplicated rather than patched: two copies of a DOM read is how the bug happened.
  const captureFromDom = () => {
    setState(captureLatestCriteriaState(container, getState()));
  };

  container.addEventListener("input", (e) => {
    if (e.target.classList?.contains("vk-weight")) {
      const card = e.target.closest(".vk-card");
      const valueEl = card?.querySelector(".vk-weight-value");
      if (valueEl) valueEl.textContent = String(e.target.value);
      // B4 (#451) a11y: keep aria-valuenow + aria-valuetext in sync during drag/arrow-key use.
      e.target.setAttribute("aria-valuenow", String(e.target.value));
      e.target.setAttribute("aria-valuetext", tf("shell.criteria.weightOfTen", { value: e.target.value }));
      const total = Array.from(container.querySelectorAll(".vk-weight"))
        .reduce((sum, el) => sum + (Number(el.value) || 0), 0);
      const totalEl = container.querySelector(".vk-total-value");
      if (totalEl) totalEl.textContent = String(total);
    }
    // B4 (#451) a11y: the remove button must always say "Fjern: {current label}", not the name
    // it had at render time.
    if (e.target.classList?.contains("vk-label")) {
      const card = e.target.closest(".vk-card");
      const removeBtn = card?.querySelector(".vk-remove");
      if (removeBtn) {
        const idx = Number(card.dataset.criterionIndex ?? 0) + 1;
        const newLabel = String(e.target.value ?? "").trim();
        removeBtn.setAttribute(
          "aria-label",
          newLabel
            ? tf("shell.criteria.removeAriaWithLabel", { label: newLabel })
            : tf("shell.criteria.removeAriaPositional", { index: idx }),
        );
      }
    }
  });

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    // The stepper and the visibility toggle write to the SAME `vk-weight` / `vk-visible` inputs the
    // save and the tests already read, then fire `input`/`change` so the existing listeners run.
    // One source of truth per value; the buttons are only a smaller way to reach it.
    if (btn.classList.contains("vk-step")) {
      const range = btn.closest(".vk-stepper")?.querySelector(".vk-weight");
      if (!range) return;
      const next = Math.max(1, Math.min(10, (Number(range.value) || 5) + Number(btn.dataset.step)));
      if (next === Number(range.value)) return;
      range.value = String(next);
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (btn.classList.contains("vk-visible-toggle")) {
      const box = btn.querySelector(".vk-visible");
      if (!box) return;
      box.checked = !box.checked;
      btn.setAttribute("aria-pressed", box.checked ? "true" : "false");
      const glyph = btn.querySelector("span[aria-hidden]");
      if (glyph) glyph.textContent = box.checked ? "◉" : "○";
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (btn.classList.contains("vk-remove")) {
      captureFromDom();
      // QA round 6: removing the LAST criterion could not be saved. An empty list builds a `null`
      // record, and every save path reads `null` as "no criteria change" — so the deletion was
      // dropped and the old criterion came back, or Lagre said "ingen endringer". A rubric needs
      // at least one criterion, so say that instead of accepting an action that cannot take.
      if (getState().length <= 1) {
        showToast(t("shell.criteria.lastCriterionRequired"), "error");
        return;
      }
      const idx = Number(btn.dataset.criterionIndex);
      if (Number.isFinite(idx)) {
        const next = getState();
        next.splice(idx, 1);
        setState(next);
        rerender();
      }
    } else if (btn.classList.contains("vk-add")) {
      captureFromDom();
      const next = getState();
      // #902: a new criterion has nothing stored, but it IS being typed in a specific language,
      // so it is saved as a one-locale map rather than a bare string the reader would have to
      // guess at. `storedLabel: null` (not undefined) is what selects the merging path.
      next.push({
        // QA round 4: the id used to be `new_criterion_${length + 1}`, and the list SHRINKS on
        // remove — so add, remove, add produced the same id twice. `Object.fromEntries` keeps the
        // last entry per key, so one of the two new criteria vanished at save time without a word.
        // A counter that only ever goes up cannot collide.
        id: freshCriterionId(next), label: "", description: "", maxScore: 5,
        candidateVisible: false, storedLabel: null, storedDescription: null, locale: contentLocale,
      });
      setState(next);
      rerender();
      const inputs = container.querySelectorAll(".vk-label");
      inputs[inputs.length - 1]?.focus();
    } else if (btn.classList.contains("vk-regenerate")) {
      captureFromDom();
      // v1.1.80: no confirm here. Nothing is persisted yet — close without saving and the edits
      // are gone anyway. The B3 drift-banner confirm stays, because that one writes immediately.
      onRegenerate?.();
    }
  });
}

// B2 (#449 redesign): one-shot DOM-to-state capture, used when leaving edit mode. Re-reads
// every visible criterion card and returns a fresh array; falls back to the closure's last
// known state if the container has already been torn down. Same shape as criteriaEditorState
// items but read from inputs to avoid stale-state bugs.

// B2 (#449 redesign): transform editor-state array into storage-shape record (id-keyed).
// Drops criteria with blank labels (they're noise). Auto-id new criteria from a slug of
// the label, falling back to "criterion_N" if the slug ends up empty. Weight is computed
// as a fraction of maxScore over the total — keeps the existing scalingRule.max_total math
// happy. Returns null when no usable criteria, so callers can fall through to ensure-rubric.
function buildCriteriaRecordFromEditorState(criteria) {
  const valid = (criteria ?? []).filter((c) => c && c.label && c.label.trim());
  if (valid.length === 0) return null;
  const totalMax = valid.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 1;
  return Object.fromEntries(valid.map((c, idx) => {
    const baseId = c.id ?? slugifyLabel(c.label) ?? `criterion_${idx + 1}`;
    // #902: merge the edited language into whatever was stored. A criterion the editor never
    // localized (`storedLabel` absent — a brand-new one, or a caller that does not track it)
    // keeps the old bare-string behaviour, which the reader still understands as "one language".
    const locale = c.locale ?? contentLocale;
    // An UNTOUCHED field keeps its stored value byte for byte. Merging it would turn a bare
    // string — "one language, not translated yet" — into a two-locale map asserting the same
    // text is valid in both, which is a translation nobody made.
    const mergeIfEdited = (stored, edited) => {
      if (stored === undefined) return edited;
      if (edited === localizeValueForLocale(stored ?? "", locale)) return stored;
      return mergeLocaleInto(stored, locale, edited);
    };
    const label = mergeIfEdited(c.storedLabel, c.label) ?? c.label;
    const description = mergeIfEdited(c.storedDescription, c.description ?? "") ?? "";
    return [String(baseId), {
      label,
      description,
      maxScore: Number(c.maxScore),
      weight: Number(((Number(c.maxScore) || 0) / totalMax).toFixed(2)),
      candidateVisible: Boolean(c.candidateVisible),
      // B3 (#450): direct-edit always counts as manual editing — the user explicitly chose
      // these values. Used by the drift "Regenerer fra ny plan" confirm prompt so we warn
      // before overwriting. False positives (treating every edit as manual) are acceptable.
      manuallyEdited: true,
    }];
  }));
}

// B3 (#450): "Behold kriteriene" — patch the active rubric's blueprint-hash to the current
// hash so the drift banner hides. Criteria unchanged.
//
// #915: the server now creates a NEW rubric version (same criteria, new hash) instead of patching
// the old one in place — so a restored older module version keeps the hash it was authored with.
// The bundle is patched to point at the new version, so the next save attaches it
// (`latestRubricId` reads `cfg.rubricVersion.id`). Until saved, a reload shows the banner again —
// correctly: the persisted draft still references the old rubric.
async function handleDriftKeep() {
  if (!selectedModuleId) return;
  const hash = currentBlueprintHash;
  if (!hash) return;
  try {
    const result = await apiFetch(
      `/api/admin/content/modules/${encodeURIComponent(selectedModuleId)}/rubric-versions/sync-blueprint`,
      getHeaders,
      { method: "POST", body: JSON.stringify({ blueprintHash: hash, rubricVersionId: bundle?.selectedConfiguration?.rubricVersion?.id ?? undefined }) },
    );
    // Patch bundle in place so we don't clobber unsaved sessionDraft via full reload.
    const cfgRubric = bundle?.selectedConfiguration?.rubricVersion;
    if (cfgRubric && result?.rubricVersionId) {
      const previousId = cfgRubric.id;
      cfgRubric.id = result.rubricVersionId;
      if (typeof result.versionNo === "number") cfgRubric.versionNo = result.versionNo;
      cfgRubric.scalingRule = { ...(cfgRubric.scalingRule ?? {}), generated_from_blueprint_hash: hash };
      if (Array.isArray(bundle?.versions?.rubricVersions) && result.rubricVersionId !== previousId) {
        bundle.versions.rubricVersions.unshift({ ...cfgRubric });
      }
    }
    renderPreview();
    showToast(t("shell.drift.keep.success"), "success");
  } catch (err) {
    showToast(`${t("shell.drift.keep.error")}: ${apiErrorText(err)}`, "error");
  }
}

// B3 (#450): "Regenerer fra ny plan" — if any criterion was manually edited, confirm with
// the user first (their edits will be overwritten). Then POST /rubric-versions/ensure with
// force:true to generate + persist a new RubricVersion against the current blueprint, and
// reload the module to pick up the new versionNo and stored hash.
async function handleDriftRegenerate() {
  if (!selectedModuleId) return;
  if (hasManuallyEditedCriteria() && !window.confirm(t("shell.drift.regenerate.confirm"))) return;

  const moduleVersion = bundle?.selectedConfiguration?.moduleVersion;
  const taskText = localizeValueForLocale(
    sessionDraft?.taskText ?? moduleVersion?.taskText ?? "",
    contentLocale,
  );
  const assessorText = localizeValueForLocale(
    sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
    contentLocale,
  );
  const constraintsText = localizeValueForLocale(
    sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
    contentLocale,
  );
  if (!taskText || !assessorText) {
    showToast(t("shell.drift.regenerate.missingTask"), "error");
    return;
  }
  const blueprint = getActiveBlueprint();

  const slot = logProgress("shell.drift.regenerate.progress");
  try {
    await apiFetch(
      `/api/admin/content/modules/${encodeURIComponent(selectedModuleId)}/rubric-versions/ensure`,
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({
          taskText,
          assessorExpectedContent: assessorText,
          candidateTaskConstraints: constraintsText || undefined,
          certificationLevel: certificationLevelForGeneration(),
          locale: contentLocale,
          ...(blueprint ? { blueprint } : {}),
          force: true,
        }),
      },
    );
    logResolveSlot(slot, () => escapeHtml(t("shell.drift.regenerate.success")));
    // Clear any direct-edit override — the freshly persisted rubric is now the truth.
    if (sessionDraft?.criteria) {
      sessionDraft = { ...sessionDraft, criteria: null };
    }
    await loadModule(selectedModuleId);
    await refreshBlueprintHash();
  } catch (err) {
    logResolveSlot(slot, () =>
      `${escapeHtml(t("shell.drift.regenerate.error"))}: ${escapeHtml(apiErrorText(err))}`,
    );
  }
}

// B3 (#450): "Vis hva som ville endret seg" — call /generate/rubric (dry-run, doesn't
// persist) to see what the LLM would now produce given the new blueprint. Diff against the
// existing rubric criteria, then offer accept-all / accept-selected. User can also cancel.
async function handleDriftShowDiff() {
  if (!selectedModuleId) return;
  const moduleVersion = bundle?.selectedConfiguration?.moduleVersion;
  const taskText = localizeValueForLocale(
    sessionDraft?.taskText ?? moduleVersion?.taskText ?? "",
    contentLocale,
  );
  const assessorText = localizeValueForLocale(
    sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
    contentLocale,
  );
  const constraintsText = localizeValueForLocale(
    sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
    contentLocale,
  );
  if (!taskText || !assessorText) {
    showToast(t("shell.drift.regenerate.missingTask"), "error");
    return;
  }
  const blueprint = getActiveBlueprint();

  // QA round 5: I changed this request to send `requestedLocale` without declaring it here — it
  // only existed inside regenerateCriteriaFromTask. Every "show what would change" threw a
  // ReferenceError that the catch below reported as a generation error, so the action was dead.
  const requestedLocale = contentLocale;
  const slot = logProgress("shell.drift.diff.progress");
  let result;
  try {
    result = await apiFetch("/api/admin/content/generate/rubric", getHeaders, {
      method: "POST",
      body: JSON.stringify({
        taskText,
        assessorExpectedContent: assessorText,
        candidateTaskConstraints: constraintsText || undefined,
        certificationLevel: certificationLevelForGeneration(),
        locale: requestedLocale,
        ...(blueprint ? { blueprint } : {}),
      }),
    });
  } catch (err) {
    logResolveSlot(slot, () =>
      `${escapeHtml(t("shell.drift.diff.error"))}: ${escapeHtml(apiErrorText(err))}`,
    );
    return;
  }
  logResolveSlot(slot, () => escapeHtml(t("shell.drift.diff.computed")));

  const newCriteriaArr = Array.isArray(result?.rubric?.criteria) ? result.rubric.criteria : [];
  // QA round 6: the request captured `requestedLocale`, but the response was tagged with the
  // LIVE locale. Switch language while the call is in flight and the generated text is filed
  // under a language it was never written in.
  const newCriteriaRecord = llmCriteriaArrayToStorageRecord(newCriteriaArr, requestedLocale);
  const existing = bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
  const diff = computeCriteriaDiff(existing, newCriteriaRecord, contentLocale);

  openDriftDiffModal(diff, newCriteriaRecord);
}

// B3 (#450): mirror of moduleRubricToStoragePayload's criteria branch. LLM returns an array
// (with .id, .label, .description, .maxScore, .candidateVisible per item); storage wants a
// record keyed by id with weight derived from maxScore.
/**
 * @param locale the language the generator was ASKED for. Required: the record it produces is
 *   written straight to storage, and a bare string there means "one language, not translated" —
 *   which the reader resolves as bokmal. QA round 4: generating with an English UI therefore
 *   filed English criteria as Norwegian, and a later English edit produced a two-locale map whose
 *   Norwegian side was already the English text.
 */
function llmCriteriaArrayToStorageRecord(arr, locale) {
  const valid = (arr ?? []).filter((c) => c && c.label && c.label.trim());
  const totalMax = valid.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 1;
  const tag = (text) => (locale && text ? { [locale]: text } : text);
  return Object.fromEntries(valid.map((c, idx) => {
    const baseId = String(c.id ?? slugifyLabel(c.label) ?? `criterion_${idx + 1}`);
    return [baseId, {
      label: tag(c.label ?? ""),
      description: tag(c.description ?? ""),
      maxScore: Number(c.maxScore) || 0,
      weight: Number(((Number(c.maxScore) || 0) / totalMax).toFixed(2)),
      candidateVisible: Boolean(c.candidateVisible),
    }];
  }));
}

// B3 (#450): per-criterion diff — categorise each id as "added" (only in new), "removed"
// (only in existing), "changed" (id present in both but label/description/maxScore differs),
// or "unchanged". Returns parallel arrays keyed for easy modal rendering. Compares by `id`
// so an LLM relabeling the same criterion would still match — risk we accept (id stability
// is the LLM's job, not ours).
/**
 * The readable text of a criterion field, whether it is a bare string or a locale map.
 *
 * The drift diff both COMPARES and RENDERS these values, and it used `String(...)` for each — fine
 * while everything was a bare string, useless the moment a locale object appears.
 */


function hasManuallyEditedCriteria() {
  const criteria = bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
  return Object.values(criteria).some((c) => c && typeof c === "object" && c.manuallyEdited === true);
}


// B3 (#450): full-screen modal showing the diff. Accept-all triggers a single regenerate
// against the LLM's proposal (writes a new RubricVersion with the proposed criteria).
// Accept-selected lets the author pick a subset (checkboxes); the resulting rubric is a
// merge of existing + selected proposals.
function openDriftDiffModal(diff, proposedRecord) {
  // B4 (#451) a11y: remember the element that triggered the modal so focus can return
  // to it on close — without this, keyboard users lose their place.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = document.createElement("div");
  overlay.className = "drift-diff-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "driftDiffTitle");
  overlay.innerHTML = buildDriftDiffModalHtml(diff, contentLocale, t, tf);
  document.body.appendChild(overlay);

  // B4 a11y: focus trap + ESC handler. The trap is implemented as a Tab/Shift-Tab handler
  // on the overlay that wraps focus inside the modal's focusable elements. ESC closes.
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const getFocusables = () => Array.from(overlay.querySelectorAll(focusableSelector))
    .filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);

  const keyHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = getFocusables();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener("keydown", keyHandler);

  const close = () => {
    overlay.removeEventListener("keydown", keyHandler);
    overlay.remove();
    // B4 a11y: return focus to the opener so keyboard users land back where they were.
    opener?.focus?.();
  };

  overlay.querySelector('[data-diff-action="close"]')?.addEventListener("click", close);
  overlay.querySelector('[data-diff-action="cancel"]')?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  overlay.querySelector('[data-diff-action="accept-all"]')?.addEventListener("click", async () => {
    close();
    // #919: «godta alle» is the same decision as ticking every box, so it takes the same road.
    // Handing `proposedRecord` straight to the save skipped the locale merge entirely — and it is
    // the button an author in a hurry presses, so it was the likelier way to lose the two
    // languages that were not on screen.
    const allIds = new Set([
      ...diff.added.map(({ id }) => id),
      ...diff.removed.map(({ id }) => id),
      ...diff.changed.map(({ id }) => id),
    ]);
    await persistMergedRubric(mergeProposedCriteria(diff, proposedRecord, allIds));
  });

  overlay.querySelector('[data-diff-action="accept-selected"]')?.addEventListener("click", async () => {
    const acceptedIds = Array.from(overlay.querySelectorAll('input[data-diff-checkbox]:checked'))
      .map((input) => input.getAttribute("data-criterion-id"))
      .filter(Boolean);
    if (acceptedIds.length === 0) {
      showToast(t("shell.drift.diff.noneSelected"), "error");
      return;
    }
    close();
    const merged = mergeProposedCriteria(diff, proposedRecord, new Set(acceptedIds));
    await persistMergedRubric(merged);
  });

  // B4 a11y: focus the modal's first focusable on open (default: the close button) so
  // keyboard/screen-reader users land inside the dialog instead of staying outside.
  const initial = getFocusables()[0];
  initial?.focus?.();
}


// B3 (#450): build the storage-shape record from "merge existing criteria with the proposed
// changes the user accepted". Logic per id:
//   - added id, accepted     → use proposed
//   - added id, not accepted → drop (not present in result)
//   - removed id, accepted   → drop (user accepted the removal)
//   - removed id, not accepted → keep existing
//   - changed id, accepted   → proposed MERGED onto existing (#919 — see below)
//   - changed id, not accepted → keep existing
//   - unchanged              → keep existing
// Weights are recomputed from the resulting maxScore totals so scalingRule.max_total stays
// coherent — done downstream by the backend on POST, but we pre-normalise here too.
function mergeProposedCriteria(diff, proposedRecord, acceptedIds) {
  const result = {};
  const existing = bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};

  for (const { id } of diff.unchanged) {
    result[id] = existing[id];
  }
  for (const { id, prev } of diff.removed) {
    if (!acceptedIds.has(id)) result[id] = prev;
  }
  for (const { id } of diff.changed) {
    result[id] = acceptedIds.has(id) ? mergeProposedCriterion(existing[id], proposedRecord[id]) : existing[id];
  }
  for (const { id } of diff.added) {
    // Nothing to merge against — a brand-new criterion exists in exactly the language the
    // generator was asked for, and `llmCriteriaArrayToStorageRecord` already tagged it as such.
    if (acceptedIds.has(id)) result[id] = proposedRecord[id];
  }

  const totalMax = Object.values(result).reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
  for (const [id, c] of Object.entries(result)) {
    const maxScore = Number(c?.maxScore) || 0;
    result[id] = { ...c, weight: Number((maxScore / totalMax).toFixed(2)) };
  }
  return result;
}

/**
 * #919: fold an accepted drift proposal into the criterion it replaces, instead of replacing it.
 *
 * Same class as #892/#902/#905, and the same rule as the regeneration path got in v2.18.10: the
 * composition writes localized fields VERBATIM, so a surface that shows one language must merge
 * that language in itself. The generator is asked for `contentLocale` and answers in it —
 * `llmCriteriaArrayToStorageRecord` tags the answer `{[locale]: text}` — so accepting a proposal
 * wholesale wrote a one-locale map over a criterion that had three, and deleted two translations
 * the author never saw and never edited. See doc/FEATURE_SURFACE_MAP.md point 21.
 *
 * Everything that is NOT localized (maxScore, candidateVisible) comes from the proposal: that is
 * the change being accepted. Only `label` and `description` are merged.
 */
function mergeProposedCriterion(stored, proposed) {
  if (!proposed || typeof proposed !== "object") return proposed;
  if (!stored || typeof stored !== "object") return proposed;
  return {
    ...proposed,
    label: mergeProposedLocalizedField(stored.label, proposed.label),
    description: mergeProposedLocalizedField(stored.description, proposed.description),
  };
}

/**
 * Merge every locale the proposal actually carries into the stored value, and leave the rest of
 * the stored value byte for byte. A stored value that does not exist has nothing to merge onto,
 * so the proposal stands as it is.
 */
function mergeProposedLocalizedField(stored, proposed) {
  if (stored === undefined || stored === null || stored === "") return proposed;
  const entries = typeof proposed === "string"
    // A bare string from the generator carries no locale marker, and the one language it can
    // honestly be attributed to is the one it was asked for.
    ? [[contentLocale, proposed]]
    : Object.entries(proposed ?? {}).filter(([, text]) => typeof text === "string");
  if (entries.length === 0) return stored;
  let next = stored;
  for (const [locale, text] of entries) next = mergeLocaleInto(next, locale, text);
  return next ?? proposed;
}

// B3 (#450): POST the merged criteria as a new RubricVersion. Server-side createRubricVersion
// bumps versionNo and stamps generated_from_blueprint_hash via scalingRule passed here.
async function persistMergedRubric(criteriaRecord) {
  if (!selectedModuleId) return;
  const blueprintHash = currentBlueprintHash;
  const totalMax = Object.values(criteriaRecord).reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
  const existingScalingRule = bundle?.selectedConfiguration?.rubricVersion?.scalingRule ?? {};
  const scalingRule = {
    ...existingScalingRule,
    // `|| 70` turned a legitimate 0 into 70: an author who deliberately set the practical weight
    // to zero got it silently restored the next time they accepted a criteria-drift suggestion.
    // Now that the weight is editable in Innstillinger (#896 S3c), 0 is a real value someone can
    // actually choose.
    practical_weight: Number.isFinite(Number(existingScalingRule.practical_weight))
      ? Number(existingScalingRule.practical_weight)
      : 70,
    max_total: totalMax,
  };
  if (blueprintHash) scalingRule.generated_from_blueprint_hash = blueprintHash;
  else delete scalingRule.generated_from_blueprint_hash;

  const slot = logProgress("shell.drift.diff.persisting");
  try {
    await apiFetch(
      `/api/admin/content/modules/${encodeURIComponent(selectedModuleId)}/rubric-versions`,
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ criteria: criteriaRecord, scalingRule, active: true }),
      },
    );
    logResolveSlot(slot, () => escapeHtml(t("shell.drift.diff.persisted")));
    if (sessionDraft?.criteria) {
      sessionDraft = { ...sessionDraft, criteria: null };
    }
    await loadModule(selectedModuleId);
    await refreshBlueprintHash();
  } catch (err) {
    logResolveSlot(slot, () =>
      `${escapeHtml(t("shell.drift.diff.persistError"))}: ${escapeHtml(apiErrorText(err))}`,
    );
  }
}

// B2 (#449 redesign): fetch new criteria from /generate/rubric using the current taskText
// and assessor expectations in the form (NOT the persisted versions — the user may have
// edited them in this same direct-edit session). Calls onSuccess with the new criteria
// array so the caller can update its state and re-render.
async function regenerateCriteriaFromTask(criteriaContainer, onSuccess) {
  // QA 2026-08-16 round 3: these three inputs belong to the Rediger edit form, and since S3c the
  // ONLY Regenerate button lives in Innstillinger — where the form is not rendered. Every click
  // therefore took the "no task text" alert and never called the API: the button was dead.
  //
  // The form still wins when it is open (the author may have edited the scenario in this same
  // session and not saved it yet); otherwise fall back to the draft, then to what is stored.
  // The language this regeneration is FOR: it decides what text is sent, what the service is
  // asked to write, and what locale the result is stored under. All three must be the same value.
  const requestedLocale = contentLocale;
  const fieldOr = (id, stored) => {
    const el = document.getElementById(id);
    if (el) return el.value.trim();
    return localizeValueForLocale(stored ?? "", requestedLocale).trim();
  };
  const storedVersion = bundle?.selectedConfiguration?.moduleVersion ?? {};
  const taskText = fieldOr("previewEditTaskText", sessionDraft?.taskText ?? storedVersion.taskText);
  const assessorText = fieldOr(
    "previewEditGuidanceText",
    sessionDraft?.assessorExpectedContent ?? storedVersion.assessorExpectedContent,
  );
  const constraintsText = fieldOr(
    "previewEditCandidateTaskConstraints",
    sessionDraft?.candidateTaskConstraints ?? storedVersion.candidateTaskConstraints,
  );
  if (!taskText || !assessorText) {
    window.alert(t("shell.criteria.regenerateMissingTask"));
    return;
  }
  // Show inline progress in the criteria container.
  const originalHtml = criteriaContainer.innerHTML;
  criteriaContainer.innerHTML = `<p class="vk-total">${escapeHtml(t("shell.criteria.regenerating"))}</p>`;
  let blueprintObj = null;
  const bp = bundle?.selectedConfiguration?.moduleVersion?.assessmentBlueprint;
  if (bp) {
    if (typeof bp === "string") {
      try { blueprintObj = JSON.parse(bp); } catch { blueprintObj = null; }
    } else if (typeof bp === "object") {
      blueprintObj = bp;
    }
  }
  try {
    const result = await apiFetch("/api/admin/content/generate/rubric", getHeaders, {
      method: "POST",
      body: JSON.stringify({
        taskText,
        assessorExpectedContent: assessorText,
        candidateTaskConstraints: constraintsText || undefined,
        certificationLevel: certificationLevelForGeneration(),
        locale: contentLocale,
        ...(blueprintObj ? { blueprint: blueprintObj } : {}),
      }),
    });
    const generated = Array.isArray(result?.rubric?.criteria) ? result.rubric.criteria : [];
    // QA round 6: regeneration produces text in ONE language, and `storedLabel: null` told the
    // save "nothing to merge onto" — so regenerating with an English preview kept the English
    // criteria and deleted nb and nn. When the generator reuses an existing id, that criterion
    // still has the other two languages and they must survive; only a genuinely new id has
    // nothing behind it. The stage plan promises exactly this ("de andre språkene urørt").
    const storedCriteria = bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
    const mapped = generated.map((c) => {
      const id = String(c.id ?? slugifyLabel(c.label) ?? "criterion");
      const previous = storedCriteria[id];
      return {
        id,
        label: c.label ?? "",
        description: c.description ?? "",
        maxScore: Math.max(1, Math.min(10, Number(c.maxScore) || 5)),
        candidateVisible: Boolean(c.candidateVisible),
        // #902: one language, so the save writes `{<locale>: "..."}` rather than a bare string the
        // reader would have to guess the language of. QA round 4: this said `currentLocale` while
        // the REQUEST asked for `contentLocale`, so English text was filed as Norwegian. One
        // variable feeds both now.
        storedLabel: previous?.label ?? null,
        storedDescription: previous?.description ?? null,
        locale: requestedLocale,
      };
    });
    onSuccess(mapped);
    showToast(t("shell.criteria.regenerated"), "success");
  } catch (err) {
    const errMsg = apiErrorText(err);
    criteriaContainer.innerHTML = originalHtml;
    showToast(`${t("shell.criteria.regenerateError")}: ${errMsg}`, "error");
  }
}

/**
 * @param force rebuild even when the open form holds unsaved text. Only for the callers that MEAN
 *   to replace it — a language switch shows the other language, Avbryt re-reads the stored values.
 *
 * Rebuilding re-reads every field from the bundle, so doing it over a form the author is typing
 * into silently deletes their work. While the form only existed after "Rediger direkte" that could
 * not happen; now that it is open the whole time Rediger is, any async completion that reaches
 * here would do it. The guard belongs in one place rather than in each caller — I already got one
 * caller's check wrong (it asked "is it dirty" where it meant "does it exist").
 */
function enterPreviewEditMode({ force = false } = {}) {
  if (!force && hasOpenEditForm()) return;
  const editingLocale = contentLocale;
  const currentTitle = localizeValueForLocale(sessionDraft?.title ?? bundle?.module?.title ?? "", editingLocale) || "";
  const currentTaskText = localizeValueForLocale(
    sessionDraft?.taskText ?? bundle?.selectedConfiguration?.moduleVersion?.taskText ?? "",
    editingLocale,
  );
  const currentGuidanceText = localizeValueForLocale(
    sessionDraft?.assessorExpectedContent ?? bundle?.selectedConfiguration?.moduleVersion?.assessorExpectedContent ?? "",
    editingLocale,
  );
  const currentCandidateTaskConstraints = localizeValueForLocale(
    sessionDraft?.candidateTaskConstraints ?? bundle?.selectedConfiguration?.moduleVersion?.candidateTaskConstraints ?? "",
    editingLocale,
  );
  const currentMcqQuestions = resolveEditableMcqQuestions(editingLocale);
  // #665: the module type must survive direct-edit. For a loaded MCQ-only/free-text-only module
  // sessionDraft is null, so read assessmentMode (and the MCQ pass threshold) from the loaded
  // module version. Without this the rebuilt draft loses its mode → save/publish wrongly demands
  // scenario text, and the editor shows free-text fields that an MCQ-only module never has.
  const editAssessmentMode = sessionDraft?.assessmentMode ?? bundle?.selectedConfiguration?.moduleVersion?.assessmentMode;
  const editIsMcqOnly = editAssessmentMode === "MCQ_ONLY";
  const editMcqMinPercent = Number.isFinite(sessionDraft?.mcqMinPercent)
    ? sessionDraft.mcqMinPercent
    : bundle?.selectedConfiguration?.moduleVersion?.assessmentPolicy?.passRules?.mcqMinPercent;
  // #896 S2 baseline, #896 S3c: what the criteria were when the form opened, so Lagre can tell
  // "nothing changed" from an edit. The form no longer EDITS them — the baseline exists only so
  // criteria that arrive from the conversation mid-session are recognised as a change worth
  // saving.
  const existingCriteriaRecord = sessionDraft?.criteria ?? null;

  // Lock locale bar and signal edit mode visually
  const previewPaneEl = document.querySelector(".preview-pane");
  if (previewPaneEl) previewPaneEl.classList.add("preview-pane--editing");

  // Build edit-mode HTML using same visual classes as preview
  const escapedTitle = escapeHtml(currentTitle);
  // #896 S3b: the description is participant-visible in the module list, so it is content and
  // belongs in Rediger — not in Innstillinger with the setup. Until now it could only be
  // corrected from the Avansert page, which the epic is retiring.
  const currentDescription = localizeValueForLocale(
    sessionDraft?.description ?? bundle?.module?.description ?? "",
    editingLocale,
  ) || "";
  const escapedDescription = escapeHtml(currentDescription);
  const labelDescription = escapeHtml(t("adminContent.module.description"));
  const escapedTask = escapeHtml(currentTaskText);
  const escapedGuidance = escapeHtml(currentGuidanceText);
  const escapedCandidateConstraints = escapeHtml(currentCandidateTaskConstraints);
  const labelTask = escapeHtml(t("adminContent.moduleVersion.taskText"));
  const labelCandidateConstraints = escapeHtml(t("adminContent.moduleVersion.candidateTaskConstraints"));
  const labelGuidance = escapeHtml(t("adminContent.moduleVersion.assessorExpectedContent"));
  const mcqSectionLabel = escapeHtml(t("shell.preview.mcqSection"));
  const optionsLabel = escapeHtml(t("adminContent.dialog.mcq.options"));
  const correctAnswerLabel = escapeHtml(t("shell.preview.correctAnswer"));
  const rationaleLabel = escapeHtml(t("adminContent.dialog.mcq.rationale"));
  const mcqHelp = escapeHtml(t("adminContent.help.mcqQuestions"));
  // Produkteier 13.09: spørsmål kan legges til og fjernes her, ikke bare genereres i samtalen.
  // Seksjonen vises alltid når typen har flervalg — også tom, med «Legg til spørsmål».
  const hasMcqPart = editAssessmentMode !== "FREETEXT_ONLY";
  const mcqHtml = hasMcqPart
    ? `
      <div class="preview-section-label">${mcqSectionLabel}</div>
      <div class="preview-edit-mcq-list">
        ${currentMcqQuestions.map((question, questionIndex) => {
          const questionLabel = escapeHtml(tf("shell.preview.questionNumber", { number: questionIndex + 1 }));
          const options = Array.isArray(question.options) ? question.options : [];
          const selectedOptionIndex = Math.max(0, options.findIndex((option) => option === question.correctAnswer));
          const optionsHtml = options
            .map((option, optionIndex) => {
              const optionLetter = String.fromCharCode(65 + optionIndex);
              return `
                <label class="preview-edit-mcq-option">
                  <input
                    type="radio"
                    name="previewEditCorrectAnswer${questionIndex}"
                    value="${optionIndex}"
                    ${optionIndex === selectedOptionIndex ? "checked" : ""}
                    aria-label="${escapeHtml(`${questionLabel} ${correctAnswerLabel} ${optionLetter}`)}"
                  />
                  <input
                    type="text"
                    id="previewEditMcqOption${questionIndex}_${optionIndex}"
                    class="preview-edit-input"
                    data-preview-edit-option
                    value="${escapeHtml(option)}"
                    aria-label="${escapeHtml(`${questionLabel} ${optionsLabel} ${optionLetter}`)}"
                  />
                </label>
              `.trim();
            })
            .join("");

          return `
            <article class="preview-edit-mcq-item" data-preview-edit-question="${questionIndex}">
              <div class="preview-mcq-question-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <span>${questionLabel}</span>
                <button type="button" class="row-action-btn destructive" data-remove-question="${questionIndex}">${escapeHtml(t("shell.directEdit.removeQuestion"))}</button>
              </div>
              <textarea
                id="previewEditMcqStem${questionIndex}"
                class="preview-edit-textarea preview-edit-textarea--compact"
                aria-label="${questionLabel}"
              >${escapeHtml(question.stem)}</textarea>
              <div class="preview-section-label">${optionsLabel}</div>
              <div class="preview-edit-mcq-options">
                ${optionsHtml}
              </div>
              <div class="preview-mcq-meta">
                <span class="preview-mcq-meta-label">${correctAnswerLabel}</span>
                <span class="preview-edit-mcq-help">${mcqHelp}</span>
              </div>
              <div class="preview-section-label">${rationaleLabel}</div>
              <textarea
                id="previewEditMcqRationale${questionIndex}"
                class="preview-edit-textarea preview-edit-textarea--secondary preview-edit-textarea--compact"
                aria-label="${escapeHtml(`${questionLabel} ${rationaleLabel}`)}"
              >${escapeHtml(question.rationale)}</textarea>
            </article>
          `.trim();
        }).join("")}
      </div>
      <div class="preview-edit-mcq-add">
        <button type="button" id="previewEditAddQuestion" class="row-action-btn">${escapeHtml(t("shell.directEdit.addQuestion"))}</button>
      </div>
    `
    : "";

  // v1.1.92: when criteria-generation is in flight AND editor has no criteria yet, show
  // a "Genererer…" placeholder instead of an empty editor. When generation completes,
  // criteriaReadyCallback fires and the placeholder is replaced with real editor cards.
  // #896 S3c: NO criteria editor here any more.
  //
  // The spec says the criteria move to Innstillinger *from Rediger* — and the reason is in the
  // spec too: "kriterieeditoren er en hel underredigerer som fyller mye plass, og endres sjelden
  // etter at den er satt. Den vanlige oppgaven — juster scenarioteksten og lagre — skal ikke
  // betale for den hver gang."
  //
  // An earlier pass mounted the editor in Innstillinger but left this one standing, which made
  // the criteria editable in two surfaces — the duplication the whole epic exists to remove
  // (reported from stage 2026-08-16: "vurderingskriteria ligger nå 4 steder").
  //
  // Criteria generated asynchronously from the conversation still land in `sessionDraft.criteria`
  // and are saved by either surface; only the EDITING lives in one place.
  const criteriaSectionHtml = "";

  // #665: free-text fields (task / candidate constraints / assessor guidance) only apply to
  // FREETEXT_PLUS_MCQ and FREETEXT_ONLY. For MCQ-only they are omitted entirely so the author
  // cannot edit fields the module does not have.
  const freetextFieldsHtml = editIsMcqOnly ? "" : `
    <div class="preview-section-label">${labelTask}</div>
    <textarea id="previewEditTaskText" class="preview-edit-textarea"
      aria-label="${labelTask}">${escapedTask}</textarea>
    <details id="privacyNotice" class="privacy-notice" role="note">
      <summary>⚠ ${escapeHtml(t("adminContent.privacy.warning.short"))}</summary>
      <p><strong>${escapeHtml(t("adminContent.privacy.warning.title"))}</strong> — ${escapeHtml(t("adminContent.privacy.warning.body"))}</p>
    </details>
    <div class="preview-section-label">${labelCandidateConstraints}</div>
    <textarea id="previewEditCandidateTaskConstraints" class="preview-edit-textarea preview-edit-textarea--secondary"
      aria-label="${labelCandidateConstraints}">${escapedCandidateConstraints}</textarea>
    <div class="preview-section-label">${labelGuidance}</div>
    <textarea id="previewEditGuidanceText" class="preview-edit-textarea preview-edit-textarea--secondary"
      aria-label="${labelGuidance}">${escapedGuidance}</textarea>`;

  // Fanebytte uten å lagre: det som står i feltene nå, mot det skjemaet ble åpnet med.
  editFormSnapshot = () => {
    const val = (id) => document.getElementById(id)?.value.trim();
    const title = val("previewEditTitle") ?? currentTitle;
    const description = val("previewEditDescription") ?? currentDescription;
    const taskText = editIsMcqOnly ? "" : (val("previewEditTaskText") ?? currentTaskText);
    const assessorExpectedContent = editIsMcqOnly ? "" : (val("previewEditGuidanceText") ?? currentGuidanceText);
    const candidateTaskConstraints = editIsMcqOnly ? "" : (val("previewEditCandidateTaskConstraints") ?? currentCandidateTaskConstraints);
    const mcqQuestions = readMcqQuestionsFromForm(currentMcqQuestions);
    const changed = title !== currentTitle || description !== currentDescription || taskText !== currentTaskText
      || assessorExpectedContent !== currentGuidanceText || candidateTaskConstraints !== currentCandidateTaskConstraints
      || JSON.stringify(mcqQuestions) !== JSON.stringify(currentMcqQuestions);
    return { changed, editingLocale, title, description, taskText, assessorExpectedContent, candidateTaskConstraints, mcqQuestions };
  };

  // Produkteier 13.09: navnet er et vanlig felt med etikett («Navn (påkrevd)»), ikke en understreket
  // tittel som ser ut som en overskrift. Tittelen på sida står i hodet.
  previewContent.innerHTML = `
    <div class="preview-section-label">${escapeHtml(t("shell.directEdit.nameLabel"))} <span class="required-note">${escapeHtml(t("shell.directEdit.required"))}</span></div>
    <input id="previewEditTitle" class="preview-edit-input" value="${escapedTitle}"
      aria-label="${escapeHtml(t("shell.directEdit.nameLabel"))}" placeholder="${escapeHtml(t("shell.directEdit.titlePlaceholder"))}" />
    <div class="preview-section-label">${labelDescription}</div>
    <textarea id="previewEditDescription" class="preview-edit-textarea preview-edit-textarea--compact"
      aria-label="${labelDescription}">${escapedDescription}</textarea>
    ${freetextFieldsHtml}
    ${mcqHtml}
    ${criteriaSectionHtml}
    <div class="preview-edit-actions">
      <button id="previewEditCancel" class="btn-secondary">${escapeHtml(t("shell.action.cancel"))}</button>
      <button id="previewEditConfirm" class="btn-primary">${escapeHtml(t("shell.directEdit.submit"))}</button>
    </div>
  `.trim();

  scrollPreviewToTop();
  // `hasOpenEditForm` compares against these, and the form is now open the whole time Rediger is,
  // so an unstamped field would read as changed from the first render.
  stampEditFormValues();
  // Legg til / fjern spørsmål: det som står i feltene tas med i utkastet, lista endres, skjemaet
  // tegnes på nytt fra utkastet. Ingenting går tapt, og tellingen stemmer.
  const rebuildWithQuestions = (mutate) => {
    captureEditFormIntoDraft({ force: true });
    const list = [...(sessionDraft?.mcqQuestions ?? [])];
    mutate(list);
    sessionDraft = { ...sessionDraft, mcqQuestions: list };
    newModulePlaceholder = false;
    enterPreviewEditMode({ force: true });
    refreshModuleHeaderState();
  };
  previewContent.querySelector("#previewEditAddQuestion")?.addEventListener("click", () => {
    rebuildWithQuestions((list) => list.push({ stem: "", options: ["", "", "", ""], correctAnswer: "", rationale: "" }));
  });
  for (const btn of previewContent.querySelectorAll("[data-remove-question]")) {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.removeQuestion);
      rebuildWithQuestions((list) => list.splice(index, 1));
    });
  }
  // No auto-focus any more. Moving the caret into the title made sense when opening the form was
  // a deliberate action; now the form opens on every tab switch, every save and every language
  // change, and grabbing focus each time takes it away from wherever the author actually is.

  // #896 S3c: criteria generated asynchronously from the conversation used to repaint an editor
  // that lived here. That editor is gone, so they are parked on the session draft instead — kept,
  // saveable, and visible the moment the author opens Innstillinger.
  //
  // #926 (§6 krav 2): fanen merkes nå. Kriteriene lander fortsatt stille på utkastet — det er
  // riktig, de har ingen editor her — men Innstillinger får en prikk så forfatteren vet at de
  // finnes, i stedet for å oppdage det ved et tilfeldig fanebytte.
  criteriaReadyCallback = (record) => {
    if (!record || Object.keys(record).length === 0) return;
    sessionDraft = { ...(sessionDraft ?? {}), criteria: record };
    markTabAttention("settings");
  };

  function exitEditMode() {
    if (previewPaneEl) previewPaneEl.classList.remove("preview-pane--editing");
    // v1.1.92: clear the criteriaReadyCallback so async generation that completes after
    // exit doesn't try to write into a torn-down DOM.
    criteriaReadyCallback = null;
    renderPreview();
  }

  document.getElementById("previewEditCancel").addEventListener("click", () => {
    exitEditMode();
    // On Rediger the form IS the tab, so leaving it would strand the author in a read-only view of
    // a tab called "Rediger". Re-opening re-reads the stored values, which is what "forkast" means
    // here: the typed text is dropped and the fields show what is saved.
    if (activeTab === "edit" && (bundle || sessionDraft)) {
      enterPreviewEditMode({ force: true });
      return;
    }
    if (sessionDraft) showDraftReadyActions(); else showModuleActions();
  });

  document.getElementById("previewEditConfirm").addEventListener("click", () => {
    const newTitle = document.getElementById("previewEditTitle").value.trim() || currentTitle;
    // #1046 A1: et nytt element kan ikke lages uten navn — si det FØR noe rives ned, så feltet står.
    if (!selectedModuleId && !newTitle) {
      showToast(t("shell.save.titleRequired"), "error");
      document.getElementById("previewEditTitle")?.focus();
      return;
    }
    // #665: free-text inputs are absent for MCQ-only — guard the reads and keep the fields empty.
    const newTaskText = editIsMcqOnly ? "" : (document.getElementById("previewEditTaskText")?.value.trim() || currentTaskText);
    const newGuidanceText = editIsMcqOnly ? "" : (document.getElementById("previewEditGuidanceText")?.value.trim() || currentGuidanceText);
    // ?? not ||: "Rammer for kandidaten" is optional, so an emptied field must stay empty.
    // With || an author who deleted it got the old text silently restored - and if that was
    // the only edit, the save reported "nothing changed".
    const newCandidateTaskConstraints = editIsMcqOnly
      ? ""
      : (document.getElementById("previewEditCandidateTaskConstraints")?.value.trim() ?? currentCandidateTaskConstraints);
    // B2 (#449 redesign): capture criteria-editor state into a normalized record before
    // exitEditMode tears down the DOM. transform to storage shape (id-keyed) with weight
    // derived from maxScore. Empty/blank labels are dropped (matching the validation in
    // the save flow). Returns null when criteria section wasn't rendered (no rubric).
    // #896 S3c: Rediger no longer edits criteria, so there is nothing to capture here. Whatever
    // is on the session draft — from the conversation, or from Innstillinger — carries through
    // untouched. `null` would mean "no override" and send the save to ensure-rubric, which would
    // discard criteria the author had just generated.
    const newCriteriaRecord = sessionDraft?.criteria ?? null;
    const newMcqQuestions = readMcqQuestionsFromForm(currentMcqQuestions);
    // Et spørsmål lagt til for hånd må være helt: tjeneren avviser tomme tekster etter at annet
    // kan være skrevet. Si det før noe sendes, og la skjemaet stå.
    const incomplete = newMcqQuestions.find((q) => !q.stem?.trim() || !q.rationale?.trim() || (q.options ?? []).some((o) => !o?.trim()));
    if (incomplete) {
      showToast(t("shell.directEdit.mcqIncomplete"), "error");
      previewContent.querySelector(`[data-preview-edit-question="${newMcqQuestions.indexOf(incomplete)}"] textarea`)?.focus();
      return;
    }

    // #896 S2: one commitment. "Bekreft" used to stop here and hand the author a separate
    // "Lagre utkast" step, which meant the translation round was paid on every confirm even
    // when nothing was ever saved. Now Lagre translates AND writes the version.
    //
    // Order is load-bearing: translate first (abortable, nothing written), then persist
    // (not abortable). Abort therefore means nothing was written - and because the form is
    // left standing until the translation resolves, the author keeps every typed value.
    const criteriaUnchanged = JSON.stringify(newCriteriaRecord) === JSON.stringify(existingCriteriaRecord);
    const newDescription = document.getElementById("previewEditDescription")?.value.trim() ?? currentDescription;
    const nothingChanged =
      newDescription === currentDescription
      && newTitle === currentTitle
      && newTaskText === currentTaskText
      && newGuidanceText === currentGuidanceText
      && newCandidateTaskConstraints === currentCandidateTaskConstraints
      && JSON.stringify(newMcqQuestions) === JSON.stringify(currentMcqQuestions)
      && criteriaUnchanged;
    // Et utkast som kom fra skjemaet via et fanebytte er ulagret selv om feltene nå er like det.
    if (nothingChanged && !sessionDraftFromForm) {
      // No edit means no LLM round and no new version - saving an identical copy would
      // spend a translation and leave a version nobody asked for.
      exitEditMode();
      logBot(() => escapeHtml(t("shell.directEdit.noChanges")));
      // Same rule as Avbryt: on Rediger the form IS the tab, so it has to come back rather than
      // leave the author looking at a read-only version of the tab they are editing in.
      if (activeTab === "edit" && (bundle || sessionDraft)) {
        enterPreviewEditMode({ force: true });
        return;
      }
      if (sessionDraft) showDraftReadyActions(); else showModuleActions();
      return;
    }

    const editActions = previewContent.querySelector(".preview-edit-actions");
    const setFormBusy = (busy) => {
      for (const button of editActions?.querySelectorAll("button") ?? []) button.disabled = busy;
      // The locale picker rebuilds the chat AND the edit form (retranslateChat), which would
      // leave the in-flight save writing the OLD values over a freshly rebuilt form. One save
      // owns the session until it resolves or is aborted.
      if (uiLocaleSelect) uiLocaleSelect.disabled = busy;
      formPage?.setBusy(busy);
    };
    setFormBusy(true);

    const abort = startGeneration();
    const slot = logProgress(() => t("shell.directEdit.translatingAndSaving"), { abortable: true });
    // The AbortController is not wired through to the localize requests, so the in-flight call
    // cannot be stopped - it is ORPHANED instead. Because nothing is written until the
    // translation resolves, and `commit` refuses to run once aborted, the stray response lands
    // nowhere. Hang the restore off the SIGNAL, not the button, so a programmatic abort (a tab
    // switch discarding the form, a locale change) unwinds exactly the same way.
    abort.signal.addEventListener("abort", () => {
      slot.abortBtn.disabled = true;
      generationAbort = null;
      setFormBusy(false);
      logResolveSlot(slot, () => escapeHtml(t("shell.directEdit.saveAborted")));
    }, { once: true });
    slot.abortBtn.addEventListener("click", () => abort.abort());

    const commit = (localized, localizedMcqQuestions, failedLocales) => {
      // The author has the discard dialog open and has not answered yet. Do not commit - the
      // values may be about to be discarded - but do not abort either: aborting would throw
      // away a translation that already succeeded, so "Bli vaerende" would leave them with
      // nothing saved. Hold it until the dialog is answered.
      generationAbort = null;
      // Release the locale controls before the form is torn down. Only the abort path used to
      // do this, so a SUCCESSFUL save left the UI language selector disabled for the rest of
      // the session - with no failing test and no error to explain it.
      setFormBusy(false);
      // The form goes away only now, once there is something to save.
      exitEditMode();
      // Only the TITLE can carry the truth today. Its patch route keeps a plain string as
      // "not translated yet" (#892). Body fields cannot: localizedTextSchema accepts either
      // all three locales or a plain string, so a partial map is a 400 - and a plain string
      // is expanded right back into three identical copies by translateLocalizedText before
      // it is sent. Until that contract changes, a failed body translation is stored as the
      // source text under every locale, and only the chat warning says otherwise. Registered
      // rather than papered over; the publish gate in S4 is where it has to be resolved.
      sessionDraft = buildPreviewCandidate({
        title: dropFailedLocales(localized.title, failedLocales, editingLocale),
        // The description is not part of the translation round — it is one field in one
        // language, patched onto the stored value by the composer so the other locales
        // survive. Sent as a locale-keyed patch for exactly that reason.
        ...(newDescription !== currentDescription ? { description: { [editingLocale]: newDescription } } : {}),
        taskText: localized.taskText,
        assessorExpectedContent: localized.assessorExpectedContent,
        candidateTaskConstraints: localized.candidateTaskConstraints,
        mcqQuestions: localizedMcqQuestions,
        // Only send criteria when they were actually edited: rewriting an untouched rubric on
        // every save collapses its localized labels to one language (#902). OMIT the key -
        // passing null would overwrite criteria the draft is already carrying (generated or
        // handed off from Avansert) and the save would fall back to the old persisted rubric.
        ...(editIsMcqOnly ? { criteria: null } : (criteriaUnchanged ? {} : { criteria: newCriteriaRecord })),
        // #665: keep the module type (and MCQ threshold) on the draft so save/publish uses the
        // right mode instead of falling back to FREETEXT_PLUS_MCQ and demanding scenario text.
        ...(editAssessmentMode ? { assessmentMode: editAssessmentMode } : {}),
        ...(Number.isFinite(editMcqMinPercent) ? { mcqMinPercent: editMcqMinPercent } : {}),
      });
      sessionState = "draft-pending";
      newModulePlaceholder = false;
      clearPreviewCandidate();
      // A locale that failed to translate stays UNTRANSLATED rather than being filled with a
      // copy of the source text (#892). The hole is named here and blocks publishing in S4.
      // #1016: samme tekst som alle andre veier — lokalen slippes, altså står språket tomt.
      const warning = failedLocales?.length
        ? ` ${tf("shell.generating.draftNotTranslated", {
            locales: failedLocales.join(", "),
            source: editingLocale,
          })}`
        : "";
      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.directEdit.saving"))}</strong>${escapeHtml(warning)}`);
      saveDraftBundleInBackground();
    };

    Promise.all([
      localizeDraftAcrossLocalesWithTitle(newTitle, newTaskText, newGuidanceText, editingLocale, newCandidateTaskConstraints),
      currentMcqQuestions.length
        ? localizeMcqAcrossLocales(newMcqQuestions, editingLocale)
        : Promise.resolve({ questions: [], failedLocales: [] }),
    ])
      .then(([localizedDraft, localizedMcq]) => {
        if (abort.signal.aborted) return;
        // #1014: MCQ-veien kan naa feile for ETT sprak uten at utkastveien gjorde det. Sprakene fra
        // begge slaas sammen, ellers rapporterer flaten bare halve sannheten.
        const alleFeilede = [...new Set([...(localizedDraft.failedLocales ?? []), ...localizedMcq.failedLocales])];
        commit(localizedDraft, localizedMcq.questions, alleFeilede);
      })
      .catch(() => {
        // Already handled by the abort listener above - the form is back and the slot is
        // resolved. Nothing was written, so there is nothing to undo here.
        if (abort.signal.aborted) return;
        // Translation failed outright. Send PLAIN STRINGS: under #892 a plain string means
        // "written in one language, not translated yet", which is the truth here.
        // buildLocalizedTextMap would instead copy the source text into all three locales -
        // content that looks translated and reads as the wrong language, the exact bug #892
        // fixed. Every target locale is reported as failed so the author is told.
        commit(
          {
            title: newTitle,
            taskText: newTaskText,
            assessorExpectedContent: newGuidanceText,
            candidateTaskConstraints: newCandidateTaskConstraints,
          },
          newMcqQuestions,
          supportedLocales.filter((locale) => locale !== editingLocale),
        );
      });
  });

  // «Rediger feltene til venstre …» loggen på hver åpning av skjemaet — og skjemaet åpnes ved hvert
  // fanebytte. Ruta er dessuten skjult. Linja er borte.
}

/**
 * Render the module's actions into the fixed bar above the chat log.
 *
 * Stage-tilbakemelding 2026-08-17: *«UI i rediger der tidligere knapper vises som inaktive gir
 * ikke lengre mening nå som dette ikke er et samtale basert UI, den gjør også at høyresiden blir
 * veldig lang, hvorpå man må skrolle mye opp og ned.»*
 *
 * The actions used to be chat bubbles. Every time one was used, its row stayed behind greyed out,
 * so the pane grew monotonically and the live choices sank to the bottom — after a round trip the
 * author had to scroll past a museum of spent buttons to find anything they could press.
 *
 * They live in one place now, and that place does not scroll. The log below keeps what is actually
 * a conversation: questions, instructions, generated results, status.
 */
// #1046 (13.09): handlingsraden i hodet, med samme regel som listene og de andre skjemasidene —
// maks fire i raden, resten under «Mer» (rowActionsHtml). Knappene er HTML, så handlingene slås
// opp via indeks ved klikk (én lytter, satt én gang).
let workspaceActionChoices = [];

// Produkteier 13.09: Lagre og Avbryt står FØRST i raden, som på de andre skjemasidene (form-page.js).
// Én Lagre for hele modulen: den lagrer det som er ulagret der du står — feltene i Rediger, feltene
// i Innstillinger, eller et generert utkast som ikke er lagret som versjon ennå. Knappene i selve
// skjemaet (previewEditConfirm/settingsSave) er skjult og klikkes herfra, så lagreflyten er den samme.
// #1046 A1: et nytt, tomt element har et plassholder-utkast som ikke teller som «ulagret» før noe
// er skrevet. Flagget slås av når skjemaet bekreftes, assistenten fyller utkastet, eller modulen lages.
let newModulePlaceholder = false;
function moduleDirtyKind() {
  if (activeTab === "settings" && settingsTab.hasUnsavedSettingsEdits()) return "settings";
  if (hasOpenEditForm()) return "form";
  if (settingsTab.hasUnsavedSettingsEdits()) return "settings";
  if (sessionDraft && !newModulePlaceholder) return "draft";
  return null;
}

// «Alt lagret / Ulagrede endringer», Lagre og Avbryt i hodet leser moduleDirtyKind() via form-page.js
// (`isDirty`). Mens noe genereres står knappene og språkpillene stille.
function refreshModuleHeaderState() {
  formPage?.setBusy(generationAbort !== null);
}

// B2: navnet er tittelen på sida. Følger feltet mens man skriver; ellers det som er lastet/utkastet.
function moduleHeaderTitle() {
  // Bare når skjemaet er det man ser: det kan stå tegnet i den skjulte Rediger-fanen mens navnet
  // skrives under Innstillinger (ny modul).
  const field = activeTab === "edit" ? document.getElementById("previewEditTitle") : null;
  if (field) return field.value.trim();
  return localizeValue(sessionDraft?.title ?? previewDraft?.title ?? bundle?.module?.title) || "";
}

// Produkteier 13.09: versjonsfaktaene fra den gamle tilstandslinja står som merker i hodet —
// «Publisert v2» (live nå) og «Utkast v4» (det du redigerer, når det ikke er den som er live).
function moduleStatusBadgesHtml() {
  if (!bundle && !sessionDraft) return "";
  const chains = bundle ? deriveModuleStatusChains(bundle) : null;
  const loaded = bundle?.selectedConfiguration?.moduleVersion ?? null;
  const loadedIsLive = !!loaded?.id && loaded.id === bundle?.module?.activeVersionId;
  const liveNo = chains?.liveChain?.[0]?.versionNo ?? null;
  const parts = [];
  if (bundle?.module?.archivedAt) parts.push(lifecycleBadge({ lifecycle: "archived" }, t));
  else if (liveNo != null) parts.push(`<span class="status-badge status-badge--published">${escapeHtml(tf("stateRail.live.published", { versionNo: liveNo }))}</span>`);
  const editingNo = loaded?.versionNo ?? null;
  if (sessionDraft && !loaded) parts.push(`<span class="status-badge status-badge--draft">${escapeHtml(t("stateRail.editing.workingDraft"))}</span>`);
  else if (editingNo != null && !loadedIsLive) parts.push(`<span class="status-badge status-badge--draft">${escapeHtml(tf("shell.header.draftVersion", { versionNo: editingNo }))}</span>`);
  else if (liveNo == null && bundle) parts.push(lifecycleBadge({ lifecycle: "draft" }, t));
  return parts.join(" ");
}

function createModuleFormPage() {
  if (!moduleFormHost) return;
  formPage = createFormPage({
    host: moduleFormHost,
    texts: () => ({
      back: t("shell.header.back"), typeLabel: t("shell.page.title"), untitled: t("shell.newModule.defaultTitle"),
      savedAll: t("stateRail.changes.saved"), unsaved: t("stateRail.changes.unsaved"),
      save: t("shell.header.save"), cancel: t("shell.header.cancel"),
      leaveConfirm: t("shell.header.leaveConfirm"), discardConfirm: t("shell.header.discardConfirm"),
      contentLocale: t("shell.contentLocale.label"), required: "",
    }),
    backHref: "/admin-content",
    title: moduleHeaderTitle,
    statusHtml: moduleStatusBadgesHtml,
    t,
    actions: () => workspaceActionChoices.map((choice, i) =>
      `<button type="button" class="row-action-btn workspace-action-btn" data-ws-action="${i}"${choice.hintKey ? ` title="${escapeHtml(t(choice.hintKey))}"` : ""}>${escapeHtml(resolveChoiceLabel(choice))}</button>`),
    languages: { locales: supportedLocales, labels: localeLabels, current: () => contentLocale, onChange: switchContentLocale },
    tabs: {
      label: t("shell.tab.listLabel"),
      items: () => TAB_ORDER.map((id) => ({ id, label: t(`shell.tab.${id}`), panel: id === "settings" ? "tabPanelSettings" : "tabPanelModule" })),
      initial: activeTab,
      onChange: onTabSelected,
    },
    // Lagre-flyten kjøres av skallet (saveFromHeader); «false» lar form-page.js la tilstanden stå til
    // skallet melder fra gjennom isDirty.
    save: { onSave: async () => { saveFromHeader(); return false; }, onDiscard: discardFromHeader },
    isDirty: () => moduleDirtyKind() !== null,
    body: () => "",
  });
  moduleFormHost.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-ws-action]") : null;
    if (btn) workspaceActionChoices[Number(btn.dataset.wsAction)]?.action?.();
  });
  formPage.render();
  formPage.installGuards();
}

function saveFromHeader() {
  const kind = moduleDirtyKind();
  if (kind === "settings") { if (activeTab !== "settings") switchToTab("settings"); document.getElementById("settingsSave")?.click(); return; }
  if (kind === "form") { document.getElementById("previewEditConfirm")?.click(); return; }
  if (kind === "draft") {
    if (activeTab === "edit" && isEditFormOpen() && sessionDraftFromForm) { document.getElementById("previewEditConfirm")?.click(); return; }
    void saveDraftBundleInBackground();
  }
}

// Avbryt i hodet (form-page.js har alt spurt): vis det som er lagret.
function discardFromHeader() {
  const kind = moduleDirtyKind();
  if (!kind) return;
  if (kind === "settings") { settingsTab.clearDraftValues(); settingsTab.renderSettingsPanel(); refreshModuleHeaderState(); return; }
  // Skjema og utkast er samme sak når modulen finnes: alt ulagret bort, modulen inn fra det lagrede.
  // (Et skjema som bare ble skrevet i, uten utkast bak seg, er dekket av det samme — loadModule
  // tegner skjemaet på nytt. Å bare lukke skjemaet holdt ikke: etter en tur innom Innstillinger
  // står det skrevne også i utkastet, og skjemaet ville åpnet igjen med det.)
  if (selectedModuleId) { void loadModule(selectedModuleId); return; }
  // Nytt element: skjemaet tilbake til utkastet (navn, type, nivå fra Innstillinger står).
  if (kind === "form") { document.getElementById("previewEditCancel")?.click(); refreshModuleHeaderState(); return; }
  // Et nytt utkast uten modul har ingenting å gå tilbake til — da er lista stedet.
  window.location.href = "/admin-content";
}

// Skriving i et felt gjør modulen ulagret — merket og knappene i hodet følger med.
document.addEventListener("input", (event) => {
  const el = event.target instanceof Element ? event.target : null;
  // Feltene i dialogene (kilde, plan, instruks) er ikke modulens skjema.
  if (!el || !el.matches("input, textarea, select") || el.closest("dialog")) return;
  refreshModuleHeaderState();
  // Navnet er tittelen på sida (B2) — følg feltet mens man skriver.
  if (el.id === "previewEditTitle") formPage?.refreshTitle();
});
document.addEventListener("change", (event) => {
  const el = event.target instanceof Element ? event.target : null;
  if (el && el.matches("input, textarea, select") && !el.closest("dialog")) refreshModuleHeaderState();
});

// Rekkefølgen i raden: det som endrer hva deltakerne ser først (Publiser/Avpubliser), så resten.
const WS_ACTION_ORDER = ["publish", "unpublish", "generateContent", "resumeChatEdit", "revise", "generateMcq", "export", "import"];
function renderWorkspaceActions(actions) {
  // saveDraft og restart er Lagre og Avbryt i hodet.
  const live = (actions ?? []).filter(Boolean).filter((a) => a.key !== "saveDraft" && a.key !== "restart");
  live.sort((a, b) => {
    const ia = WS_ACTION_ORDER.indexOf(a.key), ib = WS_ACTION_ORDER.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  workspaceActionChoices = live;
  formPage?.refreshHeader();
  refreshModuleHeaderState();
}

/** Nothing to act on — used when a module is unloaded or the flow takes over the conversation. */
function showModuleActions() {
  const hasDraft = !!sessionDraft;
  const hasMcq = (sessionDraft?.mcqQuestions?.length ?? 0) > 0;
  const canResumeEditing = !hasDraft && !!bundle?.selectedConfiguration?.moduleVersion;
  const selectedModuleVersionId = bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
  const isLiveVersion = !!bundle?.module?.activeVersionId && selectedModuleVersionId === bundle.module.activeVersionId;
  const canUnpublish = !hasDraft && !!bundle?.module?.activeVersionId;
  const canPublish = !!latestSavedModuleVersionId || (!!selectedModuleVersionId && !isLiveVersion);
  const moduleLabel = localizeValue(bundle?.module?.title) || selectedModuleId || "";
  const model = deriveShellModuleActionModel({
    hasDraft,
    hasMcq,
    canResumeEditing,
    canPublish,
    canUnpublish,
  });
  const actionMap = {
    generateContent: { labelKey: "shell.module.generateContent", action: () => openGenerateDialog() },
    generateMcq: { labelKey: "shell.module.generateMcq", action: () => openGenerateDialog({ mcqOnly: true }) },
    resumeChatEdit: { labelKey: "shell.module.resumeChatEdit", action: () => openReviseDialog() },
    saveDraft: { labelKey: "shell.draftReady.saveDraft", action: saveDraftBundleInBackground },
    publish: {
      // Direct publish — author already confirmed by clicking "Publish". The prior
      // double-confirm dialog was redundant friction. (2026-05-18 author feedback)
      labelKey: "shell.draftReady.publish",
      hintKey: "shell.draftReady.publishHint",
      action: publishLatestDraftInBackground,
    },
    unpublish: {
      labelKey: "shell.module.unpublish",
      action: () => confirmHighImpactAction("shell.unpublish.confirmPrompt", "shell.unpublish.confirmAction", unpublishModuleInBackground, showModuleActions, { module: moduleLabel }),
    },
  };
  const actions = model.actionKeys.map((key) => actionMap[key] && { key, ...actionMap[key] }).filter(Boolean);
  // #896 S6: export/import belong on Rediger, per the IA table. They lived only on the module list
  // and in Avansert, so moving content between installations meant leaving the workspace you were
  // working in. Appended rather than folded into `actionKeys` because they are not part of the
  // authoring progression the status model describes — they are available whenever a module is.
  if (selectedModuleId) {
    actions.push(
      { key: "export", labelKey: "shell.module.exportPackage", action: () => exportModulePackageInBackground() },
      { key: "import", labelKey: "shell.module.importPackage", action: () => startImportPackageFlow() },
    );
  }
  renderWorkspaceActions(actions);
}

/**
 * #896 S6: export the module as a portable package.
 *
 * `export-package`, not `/export`. The two are not a pair: `/export` returns the live editing
 * bundle, while the import endpoint only accepts the `a2-content-export/v1` envelope this one
 * produces. Exporting from the wrong endpoint gives a file that cannot be imported.
 */
async function exportModulePackageInBackground() {
  const moduleId = selectedModuleId;
  if (!moduleId) return;

  const slot = logProgress("shell.module.exportProgress");
  slot.abortBtn.remove();

  try {
    // Export the version this workspace is SHOWING. Without it the endpoint packages the live
    // version, so an author looking at an unpublished v2 exported v1 and their newest work
    // silently did not travel.
    const shownVersionId = bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
    const query = shownVersionId ? `?moduleVersionId=${encodeURIComponent(shownVersionId)}` : "";
    const body = await apiFetch(
      `/api/admin/content/modules/${encodeURIComponent(moduleId)}/export-package${query}`,
      getHeaders,
    );
    const envelope = body?.envelope;
    if (!envelope) throw new Error("empty envelope");

    const title = localizeValueForLocale(bundle?.module?.title ?? "module", contentLocale);
    const safeTitle =
      String(title).replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "module";
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `module-${safeTitle}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logResolveSlot(slot, () => escapeHtml(t("shell.module.exportSuccess")));
    showToast(t("shell.module.exportSuccess"), "success");
    // Choosing a chat action disables the whole menu. Without putting it back, downloading a file
    // left the author on Rediger with no actions at all until they reloaded the page.
    showModuleActions();
  } catch (err) {
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.module.exportError"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => exportModulePackageInBackground() },
    ]);
  }
}

/**
 * #896 S6: import a package INTO this module, as a new unpublished version.
 *
 * Not "create a new module" — that is the module list's job. Here the package becomes just another
 * «Mellomlagring» in this module's version chain: reviewable, discardable by restoring an earlier
 * version, and publishable only by the ordinary explicit act. Same rule as course import.
 *
 * The module's own title and description are NOT taken from the package. The module keeps its
 * identity; only its content gains a version.
 */
function startImportPackageFlow() {
  const moduleId = selectedModuleId;
  if (!moduleId) return;

  // Same combined guard as restore: the settings inputs are DOM-only until Lagre, so `sessionDraft`
  // alone does not know whether the reload after import would throw work away.
  if ((sessionDraft || settingsTab.hasUnsavedSettingsEdits()) && !window.confirm(t("shell.module.importConfirmDiscardDraft"))) {
    // Choosing this action already disabled the menu. Declining must not leave the workspace with
    // no actions at all.
    showModuleActions();
    return;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void importModulePackageInBackground(moduleId, file);
    else showModuleActions();
  });
  // A cancelled file chooser fires `cancel` in modern browsers and nothing at all in older ones.
  // Either way the menu has to come back; `cancel` covers the common case.
  input.addEventListener("cancel", () => showModuleActions());
  input.click();
}

async function importModulePackageInBackground(moduleId, file, idempotencyKey = null) {
  const slot = logProgress("shell.module.importProgress");
  slot.abortBtn.remove();
  // One key per import ACTION, reused by a retry: a lost response must not turn one package into
  // two complete versions.
  const key = idempotencyKey ?? `import-${moduleId}-${Date.now()}`;

  try {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(t("shell.module.importNotJson"));
    }
    // A course package imported here would either fail deep inside the importer or, worse, be
    // half-understood. Say so before sending it.
    if (payload?.scope === "course") throw new Error(t("shell.module.importIsCourse"));

    const result = await apiFetch(`/api/admin/content/modules/import`, getHeaders, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        payload,
        // Into THIS module, appending a version — not a new module beside it.
        mode: "replaceExisting",
        // `targetId`, not `targetModuleId`. The route renames it on the way to the service, and
        // the schema strips unknown keys — so `targetModuleId` here produced a 400 on every single
        // import, invisibly, because the e2e mocked the endpoint instead of exercising it.
        targetId: moduleId,
        // #896 §9: import always lands unpublished, whatever the source's state was.
        autoPublish: false,
      }),
    });

    sessionDraft = null;
    previewDraft = null;
    await loadModule(moduleId);
    switchToTab("edit");

    // loadModule swallows its own fetch errors, so getting here does not prove the workspace shows
    // the imported version. Announcing success over the old content would be the worst outcome:
    // the change happened, and the screen says otherwise.
    const importedId = result?.moduleVersionId ?? null;
    const shown = bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
    if (importedId && shown !== importedId) {
      logResolveSlot(slot, () => escapeHtml(t("shell.module.importReloadFailed")), [
        { labelKey: "shell.action.retry", action: () => loadModule(moduleId) },
      ]);
      showToast(t("shell.module.importReloadFailed"), "error");
      return;
    }

    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.module.importSuccess"))}</strong>`);
    showToast(t("shell.module.importSuccess"), "success");
    announceStatus(t("shell.module.importSuccess"));
  } catch (err) {
    const errMsg = apiErrorText(err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.module.importError"))}${escapeHtml(errMsg)}`, [
      // Two different recoveries, because there are two different failures. A transient one
      // (network, 502) is fixed by retrying the SAME file with the SAME key — no double import.
      // A deterministic one (wrong package, malformed JSON) is not: retrying re-sends the file
      // that was just rejected, and with the action menu disabled the author had no way to pick
      // another one short of reloading the page.
      { labelKey: "shell.action.retry", action: () => importModulePackageInBackground(moduleId, file, key) },
      { labelKey: "shell.module.importPickAnother", action: () => startImportPackageFlow() },
      { labelKey: "shell.module.backToActions", action: () => showModuleActions() },
    ]);
  }
}

// ---------------------------------------------------------------------------
// #896 S1: view tabs (Forhaandsvisning / Rediger / Innstillinger)
//
// Rediger is the default and is where the shell has always lived: chat plus the
// preview pane, which doubles as the edit surface. The tabs do not re-render the
// preview or touch session state - they only change which panes are visible - so
// switching back and forth cannot lose a generated draft.
//
// The one thing a switch CAN destroy is an open direct-edit form, whose field
// values live only in the DOM (enterPreviewEditMode rewrites previewContent).
// That case, and only that case, is guarded by a confirm dialog. A saved-but-
// unpublished sessionDraft needs no warning: it survives in memory and is what
// Forhaandsvisning renders.
// ---------------------------------------------------------------------------

// Declared before tabFromUrl() runs at module scope - a const in the temporal dead zone
// would throw on load and take the whole shell with it.
const TAB_ORDER = ["edit", "preview", "settings"];
const TAB_QUERY_PARAM = "tab";

function tabFromUrl() {
  const requested = new URLSearchParams(location.search).get(TAB_QUERY_PARAM);
  return TAB_ORDER.includes(requested) ? requested : "edit";
}

function syncTabToUrl(tab) {
  const url = new URL(location.href);
  if (tab === "edit") url.searchParams.delete(TAB_QUERY_PARAM);
  else url.searchParams.set(TAB_QUERY_PARAM, tab);
  // replaceState, not pushState: tabs are a view of one module, and filling the back stack
  // with them would make Back mean "previous tab" instead of "previous page".
  history.replaceState(history.state, "", url);
}

let activeTab = tabFromUrl();

/**
 * Does the edit form hold work a tab switch would destroy?
 *
 * This used to mean "is the form on screen", which was the same question while the form only
 * existed after clicking "Rediger direkte". Now that Rediger IS the form, mere existence says
 * nothing — and the old reading made every switch to Innstillinger raise an unsaved-changes
 * dialog over a form the author had not touched. A warning that always fires is a warning people
 * learn to click through, which is worse than none.
 *
 * Each field is stamped with what it was rendered with (`stampEditFormValues`), so "dirty" is a
 * comparison, exactly as it is in the settings panel.
 */
/**
 * Is the edit form on screen at all? Distinct from `hasOpenEditForm`, which asks whether it holds
 * unsaved work. Callers that auto-open the form must use THIS one: asking the dirty question and
 * getting "no" led `showDraftReadyActions` to rebuild a form the author was typing into, which
 * re-reads every field from the bundle and throws the typed text away.
 */
function isEditFormOpen() {
  return !!document.getElementById("previewEditConfirm");
}

function hasOpenEditForm() {
  const form = document.getElementById("previewEditConfirm");
  if (!form) return false;
  const fields = previewContent?.querySelectorAll("[data-rendered-value]") ?? [];
  for (const el of fields) {
    // Same accessor the stamp used, so the two halves of the comparison can never disagree about
    // what "the value" of a field is (#973).
    if (fieldStateValue(el) !== el.dataset.renderedValue) return true;
  }
  return false;
}

/**
 * The module type the settings panel is currently showing — the dropdown's value while the panel
 * is open, the stored one otherwise. Everything whose visibility depends on the type reads this,
 * so the panel and the save agree about what is about to happen.
 */
function settingsSelectedMode() {
  const selected = document.getElementById("settingsModuleType")?.value;
  if (selected) return selected;
  return bundle?.selectedConfiguration?.moduleVersion?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
}

/**
 * What a form control HOLDS right now, as one comparable string.
 *
 * The type is read off the ELEMENT, never off a list of selectors. #973: the stamp used `el.value`
 * for everything, and for a tickable input `value` is a constant — `"on"` for a checkbox, the
 * option index for a radio — so its state was invisible to every dirty check no matter which
 * selector list it appeared in. The MCQ correct-answer radios are exactly that case: the author
 * picked a different correct answer, switched tab, got no warning, and the form was rebuilt from
 * the bundle with the choice gone. Asking the element what kind of field it is means the NEXT
 * tickable field is covered the day it is added, without anyone remembering a list.
 */
function fieldStateValue(el) {
  if (el.type === "checkbox" || el.type === "radio") return el.checked ? "checked" : "unchecked";
  return el.value;
}

/** The inverse of `fieldStateValue`, so a stamped/cached state can be put back on the element. */
function applyFieldStateValue(el, state) {
  if (el.type === "checkbox" || el.type === "radio") el.checked = state === "checked";
  else el.value = state;
}

// Controls that hold no author input: stamping them would compare a constant with itself, and a
// file input cannot be restamped from a string at all.
const UNSTAMPED_INPUT_TYPES = new Set(["button", "submit", "reset", "image", "file", "hidden"]);

/**
 * Record what every edit-form field was drawn with, so `hasOpenEditForm` can tell a touched field
 * from an untouched one.
 *
 * Every control inside the form is stamped — the query asks the DOM what is there rather than
 * naming classes, because a class list can only cover the fields someone remembered to add to it,
 * and the two that were missing (#973) were missing precisely because nobody thought of them.
 * Tickable inputs are stamped with their checked state, per `fieldStateValue`.
 */
function stampEditFormValues() {
  const fields = previewContent?.querySelectorAll("input, select, textarea") ?? [];
  for (const el of fields) {
    if (UNSTAMPED_INPUT_TYPES.has(el.type)) continue;
    el.dataset.renderedValue = fieldStateValue(el);
  }
}


/**
 * #920 (§7): the guard the two language switchers share.
 *
 * §7 asks for the same warning on a language change as on a tab change, and the reason is the
 * same in both places: the surfaces that hold work only in the DOM are torn down and rebuilt from
 * the other language. Until now only Innstillinger was asked about, so «Rediger direkte» + type +
 * switch language silently replaced the typed text with the stored text of the new language.
 *
 * Same `unsavedTabSwitchKind()` as the tab switch, with one deliberate difference: `"draft"` does
 * NOT ask. A tab switch warns about a draft because it is unsaved; a language switch does not
 * endanger it at all — both re-renders read FROM the draft. Warning here would put a dialog in
 * front of every language switch for the whole life of a draft, and a warning the author knows is
 * wrong is one they learn to click through.
 *
 * Returns true to proceed, false to stay.
 */
function confirmLocaleSwitchDiscard() {
  // Et åpent skjema med endringer, eller endrede innstillinger, tegnes om fra det andre språket.
  // Et utkast er trygt: begge tegningene leser FRA det.
  const kind = activeTab === "edit" && hasOpenEditForm() ? "form"
    : (activeTab === "edit" || activeTab === "settings") && settingsTab.hasUnsavedSettingsEdits() ? "settings"
    : null;
  if (kind !== "form" && kind !== "settings") return true;
  return window.confirm(t(kind === "form" ? "shell.tab.unsaved.body" : "shell.tab.unsaved.settingsBody"));
}

// ---------------------------------------------------------------------------
// #926 (#896 §6 krav 2): merk fanen når noe lander i en fane forfatteren ikke ser på.
//
// Kriterier genereres asynkront og lander i Innstillinger. Står forfatteren i Rediger, kom de
// uten et eneste tegn — koden innrømmet det selv i en TODO. Nå settes en prikk på fanen, og
// merkingen fjernes idet fanen åpnes: den betyr «noe har skjedd du ikke har sett», ikke «noe er
// galt», så den skal ikke kunne bli hengende.
//
// Merkingen er ikke bare farge. `aria-label` får «(endret)» i tillegg, ellers finnes signalet
// bare for den som ser prikken.
// ---------------------------------------------------------------------------
const tabAttention = new Set();

function markTabAttention(tab) {
  // Ingen grunn til å merke fanen forfatteren står i — der ER endringen synlig.
  if (tab === activeTab) return;
  const button = formPage?.tabButton(tab);
  if (!button) return;
  tabAttention.add(tab);
  button.dataset.attention = "1";
  applyTabAttentionLabel(tab);
  // Prikken er lett å gå glipp av hvis blikket står i venstre kolonne. Skjermleseren får det
  // uansett; dette er den synlige halvparten.
  announceStatus(tf("shell.tab.attention.announce", { tab: t(`shell.tab.${tab}`) }));
}

function clearTabAttention(tab) {
  if (!tabAttention.delete(tab)) return;
  const button = formPage?.tabButton(tab);
  if (!button) return;
  delete button.dataset.attention;
  applyTabAttentionLabel(tab);
}

// The tab's accessible name is its own label plus, when marked, the reason. Rebuilt from the
// label each time rather than appended to, so repeated marking cannot stack the suffix.
function applyTabAttentionLabel(tab) {
  const button = formPage?.tabButton(tab);
  if (!button) return;
  const base = t(`shell.tab.${tab}`);
  if (tabAttention.has(tab)) button.setAttribute("aria-label", `${base} (${t("shell.tab.attention.suffix")})`);
  else button.removeAttribute("aria-label");
}

// Produkteier 13.09: samtaleruta er til overs i Rediger til assistenten trenger et svar. Den åpnes
// når en flyt spør (valg, skjema, avbrytbar framdrift) og lukkes med «Skjul samtalen». Skjult rute
// = skjemaet i full bredde.

function applyTabState(tab) {
  // Opening the tab IS seeing what landed in it.
  clearTabAttention(tab);
  // Forhaandsvisning renders the same module for a different audience, so crossing that
  // boundary needs a re-render. Edit <-> Innstillinger does not - both are the author view,
  // and re-rendering there would be wasted work on every settings visit.
  const audienceChanges = (activeTab === "preview") !== (tab === "preview");
  // QA 2026-08-16: last chance to read the criteria editor — after this the panel is hidden and
  // re-rendered from the bundle. Typing into a label never reaches `settingsCriteriaState`, so a
  // criteria edit made on a fresh draft would otherwise be gone by the time the draft is
  // confirmed, and the GENERATED criteria would be saved instead. No-op unless a draft exists.
  if (activeTab === "settings" && tab !== "settings") settingsTab.syncSettingsCriteriaToDraft();
  activeTab = tab;
  // setHidden, not the .hidden class: workspace-shell sets display:grid and the panels
  // are .card (display:block), so a class-based toggle loses the cascade (CLAUDE.md).
  setHidden(tabPanelModule, tab === "settings");
  setHidden(tabPanelSettings, tab !== "settings");
  const ownerHostEl = document.getElementById("moduleOwnerPanelHost");
  if (ownerHostEl) ownerHostEl.hidden = tab !== "settings" || !ownerHostEl.dataset.moduleId;
  // Forhaandsvisning and Rediger share this panel, so point it at whichever tab owns it now.
  if (tab !== "settings") tabPanelModule?.setAttribute("aria-labelledby", `formTab-${tab}`);
  // Safe here: an open edit form is torn down before any switch away from Rediger, so this
  // cannot discard typed values. No bundle guard - a new module has a draft and no bundle,
  // and its preview needs the audience swap just as much.
  if (audienceChanges) renderPreview();
  // Rendered on entry rather than kept in sync: the panel is a read-out of the loaded
  // bundle, and the bundle cannot change while Innstillinger is the visible tab.
  if (tab === "settings") settingsTab.renderSettingsPanel();
  // Stage-tilbakemelding 2026-08-18: the special-category warning belongs where the assignment
  // text is WRITTEN. On Forhåndsvisning and Innstillinger there is nothing to reword, so it is
  // noise — and a warning that shows everywhere stops being read where it matters.
  // GDPR-linja ligger inne i redigeringsskjemaet (under oppgavefeltet) og følger det.

  // Stage-tilbakemelding 2026-08-17: *"Åpner modul, den havner på rediger fanen, men jeg kan ikke
  // redigere før jeg trykker på «Rediger direkte»."* A tab called Rediger that does not let you
  // edit is a tab that lies about its name. The fields are open on arrival now, and the separate
  // "Rediger direkte" action is gone from the menu — one way in, not two.
  //
  // Forhåndsvisning shares this pane and must stay read-only: it is the participant's view.
  if (tab === "edit") {
    if (!isEditFormOpen() && (bundle || sessionDraft)) enterPreviewEditMode();
  } else {
    // Leaving Rediger tears the form down. The discard path clicks Avbryt while `activeTab` is
    // still "edit", so the cancel handler re-opens the form a moment before the switch lands —
    // and `renderPreview` replaces the pane's CONTENT but not this class, so it lingered and the
    // participant view stayed styled as if it were being edited.
    document.querySelector(".preview-pane")?.classList.remove("preview-pane--editing");
  }
}

// Fra kode (Lagre som må til Innstillinger, lenker): gå via form-page, så fanelinja følger med.
function switchToTab(tab) {
  if (tab === activeTab) return;
  if (formPage) { formPage.showTab(tab); return; }
  onTabSelected(tab);
}

// Fanen er valgt (klikk, piltast eller showTab) — form-page.js har alt merket knappen.
function onTabSelected(tab) {
  if (tab === activeTab) return;
  // Produkteier 13.09: fanebytte er ikke navigering og spør ikke — samme regel som kurs, seksjon og
  // klasse (form-page.js). Det som er skrevet i Rediger legges i utkastet og kommer tilbake;
  // Forhåndsvisning viser utkastet; Innstillinger-verdiene fanges og settes tilbake ved neste
  // tegning. Én Lagre lagrer det som er ulagret der du står.
  if (activeTab === "edit") captureEditFormIntoDraft();
  if (activeTab === "settings") {
    settingsTab.captureSettingsDraftValues();
    // Kriterieeditoren lever i DOM-en til noe leser den; neste tegning kaster den. Les den ut nå,
    // så et byttet «synlig for kandidat» eller en ny etikett står der når man kommer tilbake.
    settingsTab.captureCriteriaStateFromDom();
  }
  applyTabState(tab);
  syncTabToUrl(tab);
  if (tab === "settings") scrollPreviewToTop();
}

// ---------------------------------------------------------------------------
// New module creation flow
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// #1046 (produkteier 13.09): «Generer innhold» og «Be om endring» som dialoger. Type og nivå kommer
// fra Innstillinger og spørres ikke om. Resultatet legges i skjemaet som ulagret utkast.
// ---------------------------------------------------------------------------
// Antallene fra «Generer innhold»-dialogen, lest av MCQ-genereringen etter planen.
let pendingMcqCounts = null;
function effectiveModuleMode() {
  return sessionDraft?.assessmentMode ?? bundle?.selectedConfiguration?.moduleVersion?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
}
function effectiveCertLevel() {
  return sessionDraft?.certificationLevel ?? bundle?.module?.certificationLevel ?? "intermediate";
}

async function openGenerateDialog({ mcqOnly = false } = {}) {
  const dialog = document.getElementById("dialogGenerate");
  if (!dialog) return;
  // Et nytt element må finnes på tjeneren før innhold kan genereres til det (navn kreves).
  if (!selectedModuleId && sessionDraft) {
    const created = await createModuleFromDraft();
    if (!created) return;
  }
  const mode = effectiveModuleMode();
  const hasMcq = mcqOnly || mode !== "FREETEXT_ONLY";
  const context = document.getElementById("dialogGenerateContext");
  if (context) {
    context.textContent = tf("shell.generateDialog.context", {
      type: t(`shell.settings.mode.${mode}`),
      level: t(`shell.certLevel.${effectiveCertLevel()}`),
    });
  }
  setHidden(document.getElementById("dialogGenerateMcq"), !hasMcq);
  setHidden(document.getElementById("dialogGenerateStep1"), false);
  setHidden(document.getElementById("dialogGeneratePlan"), true);
  // Det som står i skjemaet tas med i utkastet før noe genereres — det genererte legges oppå.
  if (isEditFormOpen()) captureEditFormIntoDraft();
  const host = document.getElementById("dialogGenerateSource");
  const entry = {
    kind: "form", formType: "source-material", placeholderKey: "shell.source.placeholder",
    submitKey: "shell.generateDialog.submit", submitted: false, initialValue: "", context: {}, mount: host,
    onSubmit: (sourceMaterial) => {
      pendingMcqCounts = hasMcq
        ? {
            questionCount: Number(document.getElementById("dialogGenerateQuestionCount")?.value ?? 5),
            optionCount: Number(document.getElementById("dialogGenerateOptionCount")?.value ?? 4),
          }
        : null;
      const cert = effectiveCertLevel();
      const counts = pendingMcqCounts ?? { questionCount: 5, optionCount: 4 };
      pendingMcqCounts = null;
      if (mcqOnly) {
        dialog.close();
        generateMcqInBackground(sourceMaterial, cert, contentLocale, "thorough", counts.questionCount, counts.optionCount, () => showDraftReadyActions({ quiet: true }));
        return;
      }
      if (mode === "MCQ_ONLY") {
        dialog.close();
        startMcqOnlyRegen(sourceMaterial, cert, counts);
        return;
      }
      // Fritekst: planen kommer som steg 2 i samme dialog; «Bruk denne planen» lukker og genererer.
      pendingMcqCounts = counts;
      generateBlueprintAndConfirm(null, selectedModuleId, sourceMaterial, cert, contentLocale, "thorough", "auto", mode === "FREETEXT_ONLY");
    },
  };
  _domFormFields(entry);
  dialog.showModal();
}

const REVISE_EXAMPLE_KEYS = ["shorter", "sharper", "moreQuestions", "guidance", "example"];
function openReviseDialog() {
  const dialog = document.getElementById("dialogRevise");
  if (!dialog) return;
  // Endringen gjøres på utkastet; finnes det ikke, lages det fra det som er lastet.
  if (!sessionDraft && !createSessionDraftFromLoadedModule()) {
    showToast(t("shell.revision.unavailable"), "info");
    return;
  }
  if (!sessionDraft?.taskText && !sessionDraft?.assessorExpectedContent && (sessionDraft?.mcqQuestions?.length ?? 0) === 0) {
    showToast(t("shell.revision.unavailable"), "info");
    return;
  }
  const input = document.getElementById("dialogReviseInput");
  const examples = document.getElementById("dialogReviseExamples");
  if (examples) {
    examples.innerHTML = REVISE_EXAMPLE_KEYS.map((k) =>
      `<button type="button" class="row-action-btn revise-example" data-example="${k}">${escapeHtml(t(`shell.reviseDialog.example.${k}`))}</button>`).join("");
  }
  if (input) input.value = "";
  dialog.showModal();
  setTimeout(() => input?.focus(), 50);
}

function bindGenerateAndReviseDialogs() {
  document.getElementById("dialogGenerateCancel")?.addEventListener("click", () => document.getElementById("dialogGenerate")?.close());
  // Kildeverktøyet rives når dialogen lukkes, så det ikke ligger igjen som et «aktivt» skjema i DOM-en.
  document.getElementById("dialogGenerate")?.addEventListener("close", () => { document.getElementById("dialogGenerateSource")?.replaceChildren(); });
  document.getElementById("dialogReviseCancel")?.addEventListener("click", () => document.getElementById("dialogRevise")?.close());
  document.getElementById("dialogReviseExamples")?.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-example]") : null;
    if (!btn) return;
    const input = document.getElementById("dialogReviseInput");
    if (input) { input.value = t(`shell.reviseDialog.example.${btn.dataset.example}`); input.focus(); }
  });
  document.getElementById("dialogReviseSubmit")?.addEventListener("click", () => {
    const input = document.getElementById("dialogReviseInput");
    const instruction = input?.value.trim();
    if (!instruction) { input?.focus(); return; }
    document.getElementById("dialogRevise")?.close();
    if (isEditFormOpen()) captureEditFormIntoDraft();
    runUnifiedRevision(instruction);
  });
  document.getElementById("dialogReviseInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); document.getElementById("dialogReviseSubmit")?.click(); }
  });
}
bindGenerateAndReviseDialogs();

// #1046 A1 (avgjørelse 1b): «Ny modul» åpner et tomt skjema — ingen dialog, ingen spørsmål først.
// Utkastet er tomt, av typen fritekst (uten flervalg kan ikke FREETEXT_PLUS_MCQ lagres); typen kan
// endres under Innstillinger etter første Lagre. `saveDraftBundleInBackground` lager modulen på
// tjeneren når den ikke finnes ennå, og adressen byttes til den ekte.
function startNewEmptyModule() {
  sessionState = "draft-pending";
  bundle = null;
  selectedModuleId = null;
  previewDraft = null;
  latestSavedModuleVersionId = null;
  sessionDraft = buildPreviewCandidate({
    title: "",
    taskText: "",
    assessorExpectedContent: "",
    candidateTaskConstraints: "",
    mcqQuestions: [],
    assessmentMode: "FREETEXT_ONLY",
  });
  newModulePlaceholder = true;
  renderPreview();
  updateStateRail();
  // Produkteier 13.09: det første valget for en modul er typen (fritekst, flervalg eller begge) — så
  // et nytt element åpner på Innstillinger: navn, type og nivå. Lagre oppretter modulen; Rediger
  // viser deretter feltene for valgt type.
  showDraftReadyActions({ quiet: true });
  if (activeTab !== "settings") switchToTab("settings"); else settingsTab.renderSettingsPanel();
}


// ---------------------------------------------------------------------------
// Scenario mode → source material → cert level → locale → generate
// ---------------------------------------------------------------------------


function startMcqOnlyRegen(sourceMaterial, knownCertLevel, counts = { questionCount: 5, optionCount: 4 }) {
  // Flag the in-progress draft as MCQ_ONLY so saveDraftBundleInBackground emits the MCQ_ONLY
  // module version (no rubric/prompt/taskText). Cert level is reused from the existing module.
  sessionDraft = {
    ...(sessionDraft ?? {}),
    title: sessionDraft?.title ?? bundle?.module?.title,
    assessmentMode: "MCQ_ONLY",
    mcqMinPercent: SHELL_MCQ_ONLY_MIN_PERCENT,
    mcqQuestions: [],
  };
  renderPreview();
  const certLevel = knownCertLevel ?? bundle?.module?.certificationLevel ?? "intermediate";
  generateMcqInBackground(sourceMaterial, certLevel, contentLocale, "thorough", counts.questionCount, counts.optionCount, () => showDraftReadyActions({ quiet: true }));
}


// Default pass mark for MCQ-only modules created via the conversation (author can override in
// Avansert). Mirrors DEFAULT_MCQ_ONLY_MIN_PERCENT on the server (decisionService).
const SHELL_MCQ_ONLY_MIN_PERCENT = 70;


// #454 Phase 4 (v1.2.4): condense source material once before blueprint generation if it
// exceeds 50K chars. Avoids paying full-context cost 4× (blueprint, draft, MCQ, rubric).
const SOURCE_CONDENSE_THRESHOLD = 50_000;
async function maybeCondenseSourceMaterial(sourceMaterial, certLevel, locale) {
  if (!sourceMaterial || sourceMaterial.length < SOURCE_CONDENSE_THRESHOLD) {
    return sourceMaterial;
  }
  const slot = logProgress("shell.source.condensing");
  slot.abortBtn.remove();
  try {
    const result = await apiFetch(
      "/api/admin/content/source-material/condense",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale }),
      },
    );
    const condensed = String(result?.condensedText ?? "").trim();
    if (!condensed) {
      // Condensation failed silently — fall back to raw, log a warning bubble.
      logResolveSlot(slot, () => escapeHtml(t("shell.source.condenseFallback")));
      return sourceMaterial;
    }
    logResolveSlot(slot, () =>
      escapeHtml(tf("shell.source.condensed", {
        from: result.originalLength ?? sourceMaterial.length,
        to: result.condensedLength ?? condensed.length,
      })),
    );
    return condensed;
  } catch (err) {
    // On condense failure, fall through to raw source — generation still works, just costlier.
    logResolveSlot(slot, () => escapeHtml(t("shell.source.condenseFallback")));
    return sourceMaterial;
  }
}

async function generateBlueprintAndConfirm(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale, generationMode, scenarioMode = "auto", freetextOnly = false) {
  // v1.2.4: condense source material if over threshold. Condensed result replaces raw
  // for ALL downstream calls (blueprint → draft → MCQ → rubric).
  const effectiveSourceMaterial = await maybeCondenseSourceMaterial(sourceMaterial, certLevel, locale);

  const abort = startGeneration();
  const slot = logProgress("shell.blueprint.progress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  let blueprintResult = null;
  try {
    blueprintResult = await apiFetch(
      "/api/admin/content/generate/blueprint",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ sourceMaterial: effectiveSourceMaterial, certificationLevel: certLevel, locale }),
        signal: abort.signal,
      },
    );
  } catch (err) {
    generationAbort = null;
    sessionState = selectedModuleId ? (sessionDraft ? "draft-pending" : "module-loaded") : "idle";
    if (err?.name === "AbortError" || String(err).includes("abort")) {
      logResolveSlot(slot, () => escapeHtml(t("shell.blueprint.aborted")));
      return;
    }
    logResolveSlot(slot, () => escapeHtml(t("shell.blueprint.errorFallback")));
    document.getElementById("dialogGenerate")?.close();
    confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale, generationMode, null, scenarioMode, freetextOnly);
    return;
  }

  generationAbort = null;
  sessionState = selectedModuleId ? (sessionDraft ? "draft-pending" : "module-loaded") : "idle";
  logResolveSlot(slot, () => escapeHtml(t("shell.blueprint.ready")), []);

  const bp = blueprintResult?.blueprint;
  // v1.2.4: pass effectiveSourceMaterial (possibly condensed) so all downstream LLM calls
  // (draft, MCQ, rubric) get the same condensed view rather than re-paying for raw.
  // v1.2.8: scenarioMode forwarded through to draft generation.
  // Planen står i «Generer innhold»-dialogen (steg 2 i den), ikke i en samtalerute.
  const planHost = document.getElementById("dialogGeneratePlan");
  const dialog = document.getElementById("dialogGenerate");
  if (planHost) {
    setHidden(document.getElementById("dialogGenerateStep1"), true);
    setHidden(planHost, false);
    if (dialog && !dialog.open) dialog.showModal();
    renderEditableBlueprint(planHost, bp, { moduleTitle, existingModuleId, sourceMaterial: effectiveSourceMaterial, certLevel, locale, generationMode, scenarioMode, freetextOnly });
  }
}

// B1 (#448): editable Vurderingsplan card replaces the static accept/skip preview. Lærer
// can add, edit, and remove læringsmål and sentrale temaer before continuing. "Bruk denne
// planen" captures current inputs and passes them to confirmAndGenerate. "Generer på nytt"
// re-runs blueprint generation, warning first if the user made manual edits.
function renderEditableBlueprint(host, initialBlueprint, ctx) {
  // Local mutable working copy — never mutates the original bundle/sessionDraft until
  // the user clicks "Bruk denne planen".
  const working = {
    learningObjectives: Array.isArray(initialBlueprint?.learningObjectives) ? [...initialBlueprint.learningObjectives] : [],
    keyTopics: Array.isArray(initialBlueprint?.keyTopics) ? [...initialBlueprint.keyTopics] : [],
    complexityBudget: initialBlueprint?.complexityBudget ?? null,
    mcqProfile: initialBlueprint?.mcqProfile ?? null,
    notes: initialBlueprint?.notes ?? "",
  };
  let hasManualEdits = false;

  const renderHtml = () => {
    // B4 (#451) a11y: each input gets a positional aria-label ("Læringsmål 2") so screen
    // readers can navigate without relying on the section header alone. Remove buttons
    // include the item value when present ("Fjern: Analysér tekst") and fall back to
    // positional ("Fjern læringsmål 3") when the field is empty.
    const objectiveItems = working.learningObjectives.map((o, i) => {
      const itemAriaLabel = escapeHtml(tf("shell.blueprint.objectiveAria", { index: i + 1 }));
      const removeAria = escapeHtml(
        String(o ?? "").trim()
          ? tf("shell.blueprint.removeObjectiveWithLabel", { label: o })
          : tf("shell.blueprint.removeObjectivePositional", { index: i + 1 })
      );
      return `<li class="bp-row" data-objective-index="${i}">`
        + `<input class="bp-objective-input chat-textarea" type="text" value="${escapeHtml(o)}" data-index="${i}" aria-label="${itemAriaLabel}" />`
        + `<button type="button" class="bp-objective-remove" data-index="${i}" aria-label="${removeAria}">×</button>`
        + `</li>`;
    }).join("");
    const topicItems = working.keyTopics.map((tp, i) => {
      const itemAriaLabel = escapeHtml(tf("shell.blueprint.topicAria", { index: i + 1 }));
      const removeAria = escapeHtml(
        String(tp ?? "").trim()
          ? tf("shell.blueprint.removeTopicWithLabel", { label: tp })
          : tf("shell.blueprint.removeTopicPositional", { index: i + 1 })
      );
      return `<li class="bp-row" data-topic-index="${i}">`
        + `<input class="bp-topic-input chat-textarea" type="text" value="${escapeHtml(tp)}" data-index="${i}" aria-label="${itemAriaLabel}" />`
        + `<button type="button" class="bp-topic-remove" data-index="${i}" aria-label="${removeAria}">×</button>`
        + `</li>`;
    }).join("");
    const mcqCount = working.mcqProfile?.suggestedCount ?? "–";
    const notes = working.notes ? `<p class="bp-notes">${escapeHtml(working.notes)}</p>` : "";
    return `<strong>${escapeHtml(t("shell.blueprint.ready"))}</strong>
      <div class="bp-editor">
        <p class="bp-section-label">${escapeHtml(t("shell.blueprint.objectives"))}</p>
        <ul class="bp-objectives">${objectiveItems}</ul>
        <button type="button" class="bp-add-objective bp-add-btn">+ ${escapeHtml(t("shell.blueprint.addObjective"))}</button>
        <p class="bp-section-label">${escapeHtml(t("shell.blueprint.keyTopics"))}</p>
        <ul class="bp-topics">${topicItems}</ul>
        <button type="button" class="bp-add-topic bp-add-btn">+ ${escapeHtml(t("shell.blueprint.addTopic"))}</button>
        <p class="bp-mcq-suggestion"><strong>${escapeHtml(t("shell.blueprint.mcqSuggestion"))}</strong> ${escapeHtml(String(mcqCount))}</p>
        ${notes}
      </div>`;
  };

  const captureInputs = () => {
    const objInputs = host.querySelectorAll(".bp-objective-input");
    const topInputs = host.querySelectorAll(".bp-topic-input");
    working.learningObjectives = Array.from(objInputs).map((i) => i.value.trim()).filter(Boolean);
    working.keyTopics = Array.from(topInputs).map((i) => i.value.trim()).filter(Boolean);
  };

  const renderAndWire = () => {
    host.innerHTML = `${renderHtml()}
      <div class="row" style="justify-content:flex-end;gap:var(--space-1);margin-top:var(--space-2)">
        <button type="button" class="btn-secondary" data-bp-action="regenerate">${escapeHtml(t("shell.blueprint.regenerate"))}</button>
        <button type="button" class="btn-primary" data-bp-action="use">${escapeHtml(t("shell.blueprint.usePlan"))}</button>
      </div>`;
    host.querySelector('[data-bp-action="use"]')?.addEventListener("click", () => {
      captureInputs();
      if (working.learningObjectives.length === 0) {
        showToast(t("shell.blueprint.objectivesRequired"), "error");
        return;
      }
      const blueprintJson = JSON.stringify(working);
      document.getElementById("dialogGenerate")?.close();
      confirmAndGenerate(ctx.moduleTitle, ctx.existingModuleId, ctx.sourceMaterial, ctx.certLevel, ctx.locale, ctx.generationMode, blueprintJson, ctx.scenarioMode, ctx.freetextOnly);
    });
    host.querySelector('[data-bp-action="regenerate"]')?.addEventListener("click", () => {
      captureInputs();
      if (hasManualEdits && !window.confirm(t("shell.blueprint.regenerateWarning"))) return;
      generateBlueprintAndConfirm(ctx.moduleTitle, ctx.existingModuleId, ctx.sourceMaterial, ctx.certLevel, ctx.locale, ctx.generationMode, ctx.scenarioMode, ctx.freetextOnly);
    });

    const editor = host.querySelector(".bp-editor");
    if (!editor) return;
    editor.addEventListener("input", (e) => {
      hasManualEdits = true;
      // B4 (#451) a11y: keep remove-button aria-label in sync with the input value so the
      // announced text matches what's visible. Without this, screen readers would read the
      // stale label from initial render.
      const target = e.target;
      if (target?.classList?.contains("bp-objective-input")) {
        const row = target.closest("[data-objective-index]");
        const btn = row?.querySelector(".bp-objective-remove");
        if (btn) {
          const idx = Number(row.dataset.objectiveIndex ?? 0) + 1;
          const value = String(target.value ?? "").trim();
          btn.setAttribute(
            "aria-label",
            value
              ? tf("shell.blueprint.removeObjectiveWithLabel", { label: value })
              : tf("shell.blueprint.removeObjectivePositional", { index: idx }),
          );
        }
      } else if (target?.classList?.contains("bp-topic-input")) {
        const row = target.closest("[data-topic-index]");
        const btn = row?.querySelector(".bp-topic-remove");
        if (btn) {
          const idx = Number(row.dataset.topicIndex ?? 0) + 1;
          const value = String(target.value ?? "").trim();
          btn.setAttribute(
            "aria-label",
            value
              ? tf("shell.blueprint.removeTopicWithLabel", { label: value })
              : tf("shell.blueprint.removeTopicPositional", { index: idx }),
          );
        }
      }
    });
    editor.addEventListener("click", (e) => {
      const target = e.target.closest("button");
      if (!target) return;
      hasManualEdits = true;
      if (target.classList.contains("bp-objective-remove")) {
        captureInputs();
        const idx = Number(target.dataset.index);
        working.learningObjectives.splice(idx, 1);
        renderAndWire();
      } else if (target.classList.contains("bp-topic-remove")) {
        captureInputs();
        const idx = Number(target.dataset.index);
        working.keyTopics.splice(idx, 1);
        renderAndWire();
      } else if (target.classList.contains("bp-add-objective")) {
        captureInputs();
        working.learningObjectives.push("");
        renderAndWire();
        const inputs = host.querySelectorAll(".bp-objective-input");
        inputs[inputs.length - 1]?.focus();
      } else if (target.classList.contains("bp-add-topic")) {
        captureInputs();
        working.keyTopics.push("");
        renderAndWire();
        const inputs = host.querySelectorAll(".bp-topic-input");
        inputs[inputs.length - 1]?.focus();
      }
    });
  };

  renderAndWire();
}

// B2 helpers — used by enterPreviewEditMode and regenerateCriteriaFromTask. Hoisted as
// function declarations so they're visible across the file. The chat-bubble criteria editor
// (openCriteriaEditor + renderEditableCriteria) was removed in v1.1.77 when B2 was moved into
// the preview pane / direct-edit flow — these two utilities are all that remained worth keeping.

function slugifyLabel(label) {
  if (typeof label !== "string") return null;
  const slug = label.trim().toLowerCase()
    .replace(/[æÆ]/g, "ae").replace(/[øØ]/g, "o").replace(/[åÅ]/g, "a")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || null;
}


async function confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale, generationMode, blueprint = null, scenarioMode = "auto", freetextOnly = false) {
  // #578: after the free-text draft is generated, FREETEXT_ONLY skips MCQ generation entirely and
  // flags the draft so saveDraftBundleInBackground emits a FREETEXT_ONLY version (no mcqSet).
  const onDraftReady = () => {
    if (freetextOnly) {
      sessionDraft = { ...(sessionDraft ?? {}), assessmentMode: "FREETEXT_ONLY", mcqQuestions: [] };
      renderPreview();
      showDraftReadyActions();
    } else {
      askForMcqGeneration(sourceMaterial, certLevel, locale, generationMode);
    }
  };

  if (existingModuleId) {
    const capturedTitle = localizeValue(bundle?.module?.title) || existingModuleId;
    const levelKey = `shell.certLevel.${certLevel}`;
    const genLocale = locale;
    logBot(() =>
      `${escapeHtml(t("shell.generating.startingFor"))} <strong>${escapeHtml(capturedTitle)}</strong>…<br>` +
      `<span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.certLevel.label"))}: ${escapeHtml(t(levelKey) || certLevel)} · ${escapeHtml(t("shell.locale.label"))}: ${escapeHtml(localeLabels[genLocale] ?? genLocale)}</span>`,
    );
    generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onDraftReady, blueprint, scenarioMode);
    return;
  }

  // New module: create shell first, then generate
  const capturedTitle = moduleTitle;
  const slot = logProgress(() => `${t("shell.newModule.creating").replace(/\u2026$/, "")} \u00ab${moduleTitle}\u00bb\u2026`);
  slot.abortBtn.remove(); // creation is not abortable

  let newModule;
  try {
    // #918 sluttet å fylle tre språk med samme tekst. #930 legger til hvilket språk teksten
    // faktisk er skrevet i — en ren streng leses som bokmål, så en engelsk tittel ble lagret som
    // norsk.
    //
    // ⚠️ Fjerde og siste opprettelsessti. De tre andre ble rettet først, og bare denne testen
    // fanget at den fantes. Fire veier til samme endepunkt er én for mange.
    const body = await apiFetch(
      "/api/admin/content/modules",
      getHeaders,
      { method: "POST", body: JSON.stringify({ title: titleInContentLocale(moduleTitle), certificationLevel: certLevel }) },
    );
    newModule = body?.module ?? body;
  } catch (err) {
    logResolveSlot(
      slot,
      () => `${escapeHtml(t("shell.newModule.createError"))}<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.newModule.createErrorHint"))}</span>`,
      [
        // v1.2.18 (#352) sendte denne til modul-biblioteket, men beholdt etiketten «Åpne avansert
        // editor». Den har altså løyet i et halvt år. Nå sier den hvor den går.
        { labelKey: opphavFraUrl() ? "shell.module.backToCourse" : "shell.module.goToLibrary", action: () => { location.href = opphavFraUrl() ?? "/admin-content"; } },
        { labelKey: "shell.action.retry", action: () => confirmAndGenerate(moduleTitle, null, sourceMaterial, certLevel, locale, generationMode, blueprint, scenarioMode, freetextOnly) },
        { labelKey: "shell.action.cancel", action: startIdle },
      ],
    );
    return;
  }

  selectedModuleId = newModule?.id ?? newModule?.moduleId;
  const capturedId = selectedModuleId;
  logResolveSlot(slot, () =>
    `${escapeHtml(t("shell.newModule.created"))} <strong>${escapeHtml(capturedTitle)}</strong>` +
    `<br><span style="font-size:13px;color:var(--color-meta)">ID: ${escapeHtml(capturedId)}</span>`,
  );

  sessionDraft = { title: moduleTitle, taskText: "", assessorExpectedContent: "", candidateTaskConstraints: "", assessmentBlueprint: blueprint ?? undefined, mcqQuestions: [], ...(freetextOnly ? { assessmentMode: "FREETEXT_ONLY" } : {}) };
  // QA 2026-08-16 round 3: the new-module flow set `selectedModuleId` and `sessionDraft` but never
  // loaded `bundle`, and `renderSettingsPanel` refuses without one. Before S3c that cost nothing —
  // the criteria were in Rediger. Now they are ONLY in Innstillinger, so the documented flow
  // "create a module, check the criteria, adjust one, then save" ended at "load a module to see
  // the settings". Attach the freshly created module's envelope so the tab works.
  //
  // Deliberately NOT loadModule(): that clears `sessionDraft`, which is the draft being generated.
  await attachBundleForNewModule(selectedModuleId);
  renderPreview();

  generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onDraftReady, blueprint, scenarioMode);
}

/**
 * Load a just-created module's export envelope into `bundle`, leaving everything else alone.
 *
 * A brand-new module has no versions yet, so the envelope is nearly empty — but it is enough for
 * Innstillinger to render, which is the point: the criteria editor lives there now, and the author
 * is meant to be able to look at the criteria before the first save.
 *
 * Failure is silent and non-fatal: the panel falls back to "load a module", which is what it did
 * before. Generation must not be blocked by a settings panel that could not be drawn.
 */
async function attachBundleForNewModule(moduleId) {
  if (!moduleId) return;
  // QA round 4: `loadModule` was the only path that cleared the settings panel state, and this one
  // deliberately bypasses it. Visiting module A's settings, going back to idle and creating module
  // B therefore showed A's criteria on B — and leaving the tab synced them into B's draft. The
  // state belongs to whichever module the panel last drew; a different module means none of it.
  settingsTab.resetSettingsPanelState();
  try {
    const exportData = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    bundle = exportData?.moduleExport ?? bundle;
  } catch {
    // Left as it was.
  }
}

function askForMcqGeneration(sourceMaterial, certLevel, locale, generationMode) {
  // Antallene ble valgt i «Generer innhold»-dialogen; ingen spørsmål her.
  const counts = pendingMcqCounts ?? { questionCount: 5, optionCount: 4 };
  pendingMcqCounts = null;
  generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, counts.questionCount, counts.optionCount, () => showDraftReadyActions({ quiet: true }));
}

// v1.1.81: auto-generate criteria into sessionDraft so the preview pane shows them during
// creation (before save). B2 (#449 redesign) made criteria "content" — they belong in the
// preview pane, not gated behind save+publish+reopen. Fires once per session-draft when:
//   - sessionDraft exists with taskText + assessor (otherwise LLM has nothing to work with)
//   - sessionDraft.criteria not already set (idempotent — handoff/edit may pre-populate it)
// On success, sessionDraft.criteria becomes the storage-shape record that saveDraftBundle
// then POSTs as a new RubricVersion (the "explicit criteria" branch, not ensure-rubric).
async function populateSessionDraftCriteriaInBackground() {
  if (!sessionDraft) return;
  if (sessionDraft.criteria) return;
  // translateLocalizedText returns a locale MAP, so String() on it produced the literal
  // "[object Object]" - and the criteria generator was asked to build a rubric for a task it
  // never saw. localizeValue picks the text for the active locale, which is what was meant.
  const taskText = localizeValue(sessionDraft.taskText ?? "").trim();
  const assessorText = localizeValue(sessionDraft.assessorExpectedContent ?? "").trim();
  if (!taskText || !assessorText) return;
  const constraintsText = localizeValue(sessionDraft.candidateTaskConstraints ?? "").trim();

  let blueprintObject = null;
  const bp = sessionDraft.assessmentBlueprint ?? bundle?.selectedConfiguration?.moduleVersion?.assessmentBlueprint;
  if (bp) {
    if (typeof bp === "string") {
      try { blueprintObject = JSON.parse(bp); } catch { blueprintObject = null; }
    } else if (typeof bp === "object") {
      blueprintObject = bp;
    }
  }

  criteriaGenerationInFlight = true;
  // QA round 6: captured BEFORE the call. The author can switch UI language while generation runs,
  // and tagging the reply with the live locale files English text as Norwegian — which then looks
  // like a translation that exists.
  const generationLocale = contentLocale;
  // #926: this repaint used to be unconditional, and `renderPreview` writes straight into
  // `previewContent.innerHTML` — so it tore down an open Rediger form and rebuilt it from the
  // bundle, throwing away whatever the author had typed. Same class as §6 itself: content
  // changing without the author asking, this time by a background job nobody saw start.
  //
  // The completion handler at the bottom already makes exactly this distinction. It only ever
  // held for the way OUT; the way IN had no guard at all.
  if (!isEditFormOpen()) renderPreview();
  try {
    const result = await apiFetch("/api/admin/content/generate/rubric", getHeaders, {
      method: "POST",
      body: JSON.stringify({
        taskText,
        assessorExpectedContent: assessorText,
        candidateTaskConstraints: constraintsText || undefined,
        certificationLevel: certificationLevelForGeneration(),
        locale: generationLocale,
        ...(blueprintObject ? { blueprint: blueprintObject } : {}),
      }),
    });
    const generated = Array.isArray(result?.rubric?.criteria) ? result.rubric.criteria : [];
    const record = llmCriteriaArrayToStorageRecord(generated, generationLocale);
    // QA round 7: the author can open Innstillinger while this is in flight and edit the criteria,
    // and those edits are synced into the draft as they are made. Overwriting the draft here threw
    // them away — and because the sync also used to move the dirty baseline, the guard below then
    // saw a "clean" editor and replaced it with the generated list too. Their work wins.
    if (sessionDraft && Object.keys(record).length > 0 && !settingsTab.settingsCriteriaEdited()) {
      sessionDraft = { ...sessionDraft, criteria: record };
    }
  } catch {
    // Silent fail — save-time ensure-rubric will still produce a rubric. Users just won't
    // see the criteria in preview until after save in that case.
  } finally {
    criteriaGenerationInFlight = false;
    // v1.1.91: don't re-render if user has entered Rediger direkte while generation was
    // in flight — would wipe their edit form. v1.1.92: also notify the active edit-mode
    // via criteriaReadyCallback so the placeholder is replaced with editor cards.
    // v1.1.93: previewPaneEl is block-scoped inside enterPreviewEditMode — referencing it
    // here threw ReferenceError, which prevented renderPreview() from running. Users saw
    // criteria appear only after Lagre (which triggers loadModule → renderPreview). Use
    // document.querySelector directly to read the live edit-mode state.
    const previewPaneNow = document.querySelector(".preview-pane");
    const inEditMode = previewPaneNow?.classList.contains("preview-pane--editing");
    if (inEditMode) {
      if (criteriaReadyCallback && sessionDraft?.criteria) {
        criteriaReadyCallback(sessionDraft.criteria);
      }
    } else {
      renderPreview();
    }
    // QA 2026-08-16 round 3: since S3c the criteria live in Innstillinger, and its editor state is
    // seeded ONCE — on the first render. An author who opened Innstillinger while generation was
    // still running seeded it to an empty list, and this completion only re-rendered the preview.
    // The panel then kept showing "no criteria" over a draft that had them, and would have saved
    // that emptiness. Discard the stale seed so the next render reads the generated criteria.
    // ...but ONLY when the author has not started editing. QA round 4: an unconditional reset
    // erased criteria they had added or changed while generation was still running — trading one
    // silent loss for another. If the editor is dirty, their work wins and the generated criteria
    // stay on the draft, where the save still reads them.
    if (sessionDraft?.criteria && !settingsTab.settingsCriteriaEdited()) {
      settingsTab.resetLocaleBoundState();
      if (activeTab === "settings") settingsTab.renderSettingsPanel();
      // #926 §6 krav 2: dette er selve tilfellet saken beskriver. Kriteriene er generert
      // asynkront og ligger nå i Innstillinger; står forfatteren i Rediger, kom de uten et
      // eneste tegn. Merkingen er betinget av `activeTab` inne i `markTabAttention`, så den
      // uteblir når panelet er synlig — der endringen allerede kan ses.
      markTabAttention("settings");
    }
  }
}

function showDraftReadyActions({ quiet = false } = {}) {
  sessionState = "draft-pending";
  // v1.1.81: kick off criteria-generation in background so preview shows them.
  // Idempotent — does nothing if sessionDraft.criteria is already populated.
  populateSessionDraftCriteriaInBackground();
  // A freshly generated draft lands on Rediger, and Rediger is editable — the invariant has to
  // hold on the new-module flow too, or the tab is editable everywhere except where a new author
  // meets it first.
  if (activeTab === "edit" && !isEditFormOpen() && (bundle || sessionDraft)) enterPreviewEditMode();
  const mcqCount = sessionDraft?.mcqQuestions?.length ?? 0;
  const model = deriveShellDraftReadyActionModel({ hasSelectedModule: !!selectedModuleId });
  const actionMap = {
    revise: { labelKey: "shell.draftReady.editInChat", action: () => openReviseDialog() },
    restart: { labelKey: "shell.draftReady.restart", action: startIdle },
    saveDraft: { labelKey: "shell.draftReady.saveDraft", action: saveDraftBundleInBackground },
  };
  // The message is conversation and stays in the log; the actions go to the fixed bar, where they
  // do not sink out of reach as the log grows. `quiet`: et tomt nytt element har ikke noe utkast
  // å melde om.
  if (!quiet) {
    newModulePlaceholder = false;
    logBot(() => {
      const parts = [t("shell.draftReady.message")];
      if (mcqCount > 0) parts.push(tf("shell.draftReady.mcqCount", { count: mcqCount }));
      parts.push(t("shell.draftReady.hint"));
      return escapeHtml(parts.join(" "));
    });
  }
  const actions = model.actionKeys.map((key) => actionMap[key] && { key, ...actionMap[key] }).filter(Boolean);
  // Produkteier 13.09 (stage-funn): med et utkast sto bare «Be om endring» igjen — ingen vei til
  // kilder eller generering. Generer innhold (og Generer spørsmål når typen har flervalg) er alltid
  // med; dialogen henter type og nivå fra Innstillinger.
  actions.push({ key: "generateContent", labelKey: "shell.module.generateContent", action: () => openGenerateDialog() });
  if (effectiveModuleMode() !== "FREETEXT_ONLY") {
    actions.push({ key: "generateMcq", labelKey: "shell.module.generateMcq", action: () => openGenerateDialog({ mcqOnly: true }) });
  }
  renderWorkspaceActions(actions);
}






// ---------------------------------------------------------------------------
// Nav / version / locale
// ---------------------------------------------------------------------------

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const roles = activeUserRoles.join(",") || participantRuntimeConfig.identityDefaults?.roles?.join(",") || "SUBJECT_MATTER_OWNER";
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
  // #787 QA r3: role-gate the content-area sub-nav's Kalibrering link (same accessRoles as the
  // calibration workspace) so the Samtale editor shows the same top menu as courses/sections.
  const navKalibrering = document.getElementById("navKalibrering");
  if (navKalibrering) {
    const calibrationRoles = ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"];
    const current = new Set(activeUserRoles.length ? activeUserRoles : (participantRuntimeConfig.identityDefaults?.roles ?? []));
    navKalibrering.hidden = !calibrationRoles.some((role) => current.has(role));
  }
}

// Translates static text that lives in the HTML source (not rendered by chat flow).
function translatePageStaticText() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.placeholder = t(key);
  }
  // #896 S1: accessible names need translating too. Without this an aria-label stays in
  // whatever language it was authored in, so a screen reader announces a Norwegian group
  // name around English tabs.
  for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
    const key = el.getAttribute("data-i18n-aria-label");
    if (key) el.setAttribute("aria-label", t(key));
  }
}


function populateUiLocaleSelect() {
  if (!uiLocaleSelect) return;
  uiLocaleSelect.innerHTML = "";
  for (const loc of supportedLocales) {
    const opt = document.createElement("option");
    opt.value = loc;
    opt.textContent = localeLabels[loc] ?? loc;
    opt.selected = loc === currentLocale;
    uiLocaleSelect.appendChild(opt);
  }
  uiLocaleSelect.addEventListener("change", () => {
    const chosen = uiLocaleSelect.value;
    if (!supportedLocales.includes(chosen)) return;
    // #896 S6 QA: switching UI language re-renders the settings panel further down, which destroys
    // the DOM-only inputs. This is the second exit from Innstillinger and it had no guard at all —
    // a typed validity date vanished the instant the language changed. Ask before, and put the
    // selector back if the author says no.
    //
    // #920: and the same for Rediger. `renderPreview()` further down rebuilds the pane the edit
    // form is built INTO, so an open form's fields are just as DOM-only as the settings inputs —
    // the guard was simply asking about the wrong tab.
    if (!confirmLocaleSwitchDiscard()) {
      uiLocaleSelect.value = currentLocale;
      return;
    }
    localStorage.setItem("participant.locale", chosen);
    currentLocale = chosen;
    // QA 2026-08-16: the criteria editor holds the text of ONE language plus the locale it was
    // read in, and it only seeds itself when the state is null. Switching language therefore left
    // the previous language's text on screen, tagged with the previous language — so a "Norwegian"
    // edit was merged into the English locale. The guard above has already established that there
    // is nothing unsaved to lose, so discarding and re-seeding is safe.
    //
    // Round 5: the folded-section cache had to go too, and this is the dangerous case. Its values
    // were typed in the OLD language; leaving them behind laid English text over a Norwegian field
    // the moment the section was reopened, and the next save filed it as `nb`.
    //
    // Round 7: but NOT `settingsTab.discardSettingsEdits()`, which also rolls the draft back to what it held
    // before the panel opened. Criteria already absorbed into a draft are the author's work, not
    // something they asked to throw away — the guard above only established that nothing is at
    // risk of being LOST, which is true precisely because the draft is keeping it.
    settingsTab.resetLocaleBoundState();
    // The content language does NOT follow. Stage-tilbakemelding 2026-08-17: it used to, until the
    // author touched the selector — after which it silently stopped, with nothing on screen saying
    // so. Changing the menu language now changes the menus; the content stays in the language it
    // is written in, which is the only rule that can be stated in one sentence.
    // Direkte redigering bygges INN i forhåndsvisningsruten, så renderPreview() river den — åpne
    // skjemaet igjen etterpå (rapportert fra stage 13.08: man havnet i lesemodus uten vei videre).
    const wasEditing = !!document.getElementById("previewEditConfirm");
    const wasDirty = hasOpenEditForm();
    // Replay the full chat log in the new locale
    translatePageStaticText();
    // Hodet (form-page.js) bygges fra t(): tegn det på nytt, og legg fanemerkingen (#926) tilbake —
    // suffikset i aria-label er også oversatt tekst.
    formPage?.render();
    for (const tab of tabAttention) {
      const button = formPage?.tabButton(tab);
      if (button) button.dataset.attention = "1";
      applyTabAttentionLabel(tab);
    }
    renderPreview();
    renderWorkspaceNavigation();
    // #896 S3b: the settings panel is built in JS, so translatePageStaticText cannot reach it.
    // Without this the module types, the "missing component" reasons and the save button stay
    // in the previous language while the page around them switches.
    settingsTab.renderSettingsPanel();
    // Handlingsraden og merkene i hodet bygges også i JS (#1046): tegn dem om med samme valg.
    renderWorkspaceActions(workspaceActionChoices);
    updateStateRail();
    if (wasEditing) {
      enterPreviewEditMode({ force: true });
      // Feltene fylles fra det nye språket. Det som var skrevet i det forrige — og ikke bekreftet
      // — er borte, og det skal man få vite, ikke oppdage.
      if (wasDirty) {
        logBot(() => escapeHtml(t("shell.directEdit.localeSwitched")));
        showToast(t("shell.directEdit.localeSwitched"), "warning");
      }
    }
  });
}

async function loadConsoleConfig() {
  try {
    const body = await getConsoleConfig();
    if (body) {
      participantRuntimeConfig = {
        ...participantRuntimeConfig,
        ...body,
        navigation: { ...participantRuntimeConfig.navigation, ...(body?.navigation ?? {}) },
        identityDefaults: { ...participantRuntimeConfig.identityDefaults, ...(body?.identityDefaults ?? {}) },
      };
    }
  } catch {
    // use defaults
  }

  try {
    const me = await apiFetch("/api/me", getHeaders);
    activeUserRoles = Array.isArray(me?.user?.roles) ? me.user.roles : [];
  } catch {
    activeUserRoles = [];
  }
  renderWorkspaceNavigation();
  if (workspaceNav) {
    fetchQueueCounts(getHeaders).then((counts) => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function initShell() {
  populateUiLocaleSelect();
  translatePageStaticText();
  createModuleFormPage();
  applyTabState(activeTab);
  renderPreview();
  loadVersion(appVersionLabel, "A2 Content Workspace");
  await loadConsoleConfig();

  // Path-based moduleId: /admin-content/module/:moduleId/conversation
  const pathModuleId = window.location.pathname.match(/\/admin-content\/module\/([^/]+)\//)?.[1] ?? null;
  const queryModuleId = new URLSearchParams(location.search).get("moduleId");
  const autoModuleId = pathModuleId ?? queryModuleId;
  const resumeEditing = new URLSearchParams(location.search).get("resumeEditing") === "1";
  // #1046 A1: /module/new — et tomt element. Modulen lages på tjeneren ved første Lagre.
  if (autoModuleId === "new") {
    startNewEmptyModule();
    return;
  }
  if (autoModuleId) {
    await loadModule(autoModuleId, { resumeEditing });
    return;
  }

  startIdle();
}

// ---------------------------------------------------------------------------
// #1046 punkt 2: Innstillinger-fanen bor i admin-content-settings-tab.js. Den får tilstanden som
// get/set-egenskaper (så begge sider ser samme verdi) og skallets funksjoner som referanser.
// ---------------------------------------------------------------------------
const settingsTab = createSettingsTab({
  get currentLocale() { return currentLocale; },
  get selectedModuleId() { return selectedModuleId; },
  get bundle() { return bundle; },
  get contentLocale() { return contentLocale; },
  get sessionDraft() { return sessionDraft; }, set sessionDraft(v) { sessionDraft = v; },
  get previewDraft() { return previewDraft; }, set previewDraft(v) { previewDraft = v; },
  get latestSavedModuleVersionId() { return latestSavedModuleVersionId; }, set latestSavedModuleVersionId(v) { latestSavedModuleVersionId = v; },
  get formPage() { return formPage; },
  get newModulePlaceholder() { return newModulePlaceholder; }, set newModulePlaceholder(v) { newModulePlaceholder = v; },
  get LEVEL_SCOPE_DEFAULTS() { return LEVEL_SCOPE_DEFAULTS; },
  get CERTIFICATION_LEVELS() { return CERTIFICATION_LEVELS; },
  get SHELL_MCQ_ONLY_MIN_PERCENT() { return SHELL_MCQ_ONLY_MIN_PERCENT; },
  t, tf, logProgress, buildCriteriaRecordFromEditorState, announceStatus, applyTabState, dropBlankLocales, logResolveSlot, apiErrorText, loadModule, settingsSelectedMode, getHeaders, switchToTab, certificationLevelValue, localizeValue, wireCriteriaEditor, parsePercentInRange, refreshModuleHeaderState, applyFieldStateValue, fieldStateValue, buildDefaultSubmissionSchema, regenerateCriteriaFromTask,
});

initShell().catch(() => {
  startIdle();
});
