import { escapeHtml } from "./html-escape.js";
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
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { localizeValueForLocale, buildPreviewHtml } from "/static/admin-content-preview.js";
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
import { makeSrBadge, loadVersion } from "/static/admin-content-shared.js";
import {
  buildExternalLlmAuthoringPrompt,
  parseExternalLlmJson,
} from "/static/admin-content-external-llm.js";

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

// Chat log — every rendered message is stored here as a re-renderable spec so
// that retranslateChat() can rebuild the entire dialog on locale switch.
// Entry kinds:
//   { kind:'bot',   html:()=>string, choices:Choice[], active:bool }
//   { kind:'user',  text:string }
//   { kind:'form',  formType:'text'|'textarea', promptHtml:()=>string,
//                   placeholderKey:string, submitKey:string, onSubmit:fn, submitted:bool }
//   { kind:'module-choices', modules:Module[], active:bool }
// Choice: { labelKey?:string, label?:string, action:()=>void }
let chatLog = [];

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

const chatMessages = document.getElementById("chatMessages");
const previewPane = document.getElementById("previewPane");
const contentLocaleBar = document.getElementById("previewLocaleBar");
const previewContent = document.getElementById("previewContent");
// The fixed action bar above the chat log. See `renderWorkspaceActions`.
const workspaceActionsBar = document.getElementById("workspaceActions");
// Shown on Rediger only — see the tab handler.
const privacyNotice = document.getElementById("privacyNotice");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const appVersionLabel = document.getElementById("appVersion");
const uiLocaleSelect = document.getElementById("localeSelect");
// #896 S1: the Samtale/Avansert mode switch is replaced by three views on one module.
const tabButtons = {
  preview: document.getElementById("tabPreview"),
  edit: document.getElementById("tabEdit"),
  settings: document.getElementById("tabSettings"),
};
const tabPanelModule = document.getElementById("tabPanelModule");
const tabPanelSettings = document.getElementById("tabPanelSettings");
const unsavedTabSwitchDialog = document.getElementById("dialogUnsavedTabSwitch");
const shellStatusAnnouncer = document.getElementById("shellStatusAnnouncer");
const stateRail = document.getElementById("stateRail");
const srModuleName = document.getElementById("srModuleName");
const srEditing = document.getElementById("srEditing");
const srLive = document.getElementById("srLive");
const srChanges = document.getElementById("srChanges");
const srPreview = document.getElementById("srPreview");
const srLang = document.getElementById("srLang");

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

function setChatBusy(isBusy) {
  if (!chatMessages) return;
  if (isBusy) {
    chatMessages.setAttribute("aria-busy", "true");
  } else {
    chatMessages.removeAttribute("aria-busy");
  }
}

function focusFirstEnabledChoice(container) {
  const firstChoice = container?.querySelector?.(".chat-choice-btn:not([disabled])");
  if (!firstChoice) return;
  setTimeout(() => firstChoice.focus(), 40);
}

function parseApiErrorMessage(error, fallbackKey) {
  const fallback = t(fallbackKey);
  if (!(error instanceof Error) || typeof error.message !== "string") {
    return fallback;
  }

  const match = error.message.match(/^\d+:\s*(\{[\s\S]*\})$/);
  if (!match) return fallback;

  try {
    const parsed = JSON.parse(match[1]);
    return parsed.message || parsed.error || fallback;
  } catch {
    return fallback;
  }
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

function _domScroll(el) {
  el.scrollIntoView({ behavior: "smooth", block: "end" });
}

// Disable every current choice button in the DOM immediately (live feedback).
function _disableAllDomChoices() {
  for (const btn of chatMessages.querySelectorAll(".chat-choice-btn:not([disabled])")) {
    btn.disabled = true;
  }
}

// Mark all log entries as inactive so replays render them with disabled choices.
function _deactivateAll() {
  for (const e of chatLog) {
    if ("active" in e) e.active = false;
  }
}

// Build a choices row from an array of { labelKey, action } specs.
// disabled=true renders non-interactive buttons for past history.
function resolveChoiceLabel(choice) {
  return choice.label ?? t(choice.labelKey);
}

function _domChoiceRow(choices, disabled, autoFocus = false) {
  const row = document.createElement("div");
  row.className = "chat-choices";
  for (const c of choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary chat-choice-btn";
    btn.textContent = resolveChoiceLabel(c);
    btn.disabled = disabled;
    if (!disabled) {
      btn.addEventListener("click", () => {
        _disableAllDomChoices();
        _deactivateAll();
        logUser(resolveChoiceLabel(c));
        c.action();
      });
    }
    row.appendChild(btn);
  }
  if (autoFocus && !disabled) {
    focusFirstEnabledChoice(row);
  }
  return row;
}

function _domBotBubble(html, choices, disabled, autoFocusChoices = false) {
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--bot";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = html;
  msg.appendChild(bubble);
  if (choices && choices.length > 0) {
    msg.appendChild(_domChoiceRow(choices, disabled, autoFocusChoices));
  }
  chatMessages.appendChild(msg);
  _domScroll(msg);
  return msg;
}

function _domUserBubble(text) {
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--user";
  msg.innerHTML = `<div class="chat-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(msg);
  _domScroll(msg);
}

// Creates a progress bubble. Returns { el, abortBtn }.
// v1.1.98: abort button removed from progress messages. Value was low (LLM calls take
// 30-60s; users can wait or navigate away) and it created a dead-end — clicking Avbryt
// ended the chat with "...avbrutt" without a recovery menu, leaving the user stuck.
// The abortBtn return is now a detached stub so existing callers (~17 places using
// addEventListener/remove/disabled) keep working without behavior — the click event
// never fires since the button isn't attached to the DOM.
function _domProgress(textKeyOrFn, { abortable = false } = {}) {
  const text = typeof textKeyOrFn === "function" ? textKeyOrFn() : t(textKeyOrFn);
  setChatBusy(true);
  announceStatus(text);
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--bot";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--progress";
  bubble.innerHTML = `<span class="chat-spinner"></span>${escapeHtml(text)}`;
  msg.appendChild(bubble);
  // v1.1.98 dropped the Avbryt button because it ended the chat with no way forward -
  // "dead-end, low value, high complexity". Correct then. #896 S2 changes that for ONE
  // caller: Lagre now commits to a write, and cancelling hands the form back with every
  // typed value intact, which is a recovery rather than a dead end. So the button is
  // opt-in: abortable callers get a real one, everyone else keeps the detached stub and
  // its harmless no-op listeners.
  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
  if (abortable) {
    abortBtn.className = "btn-secondary chat-progress-abort";
    abortBtn.textContent = t("shell.action.cancel");
    bubble.appendChild(abortBtn);
  }
  chatMessages.appendChild(msg);
  _domScroll(msg);
  return { el: msg, abortBtn };
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

    // #455: external-LLM handoff. Copies authoring prompt to clipboard and opens modal
    // where the user pastes the JSON the LLM produced. Bypasses the normal source-material
    // submit path — the module is created directly from the imported JSON.
    const externalLlmBtn = document.createElement("button");
    externalLlmBtn.type = "button";
    externalLlmBtn.className = "btn-secondary chat-choice-btn";
    externalLlmBtn.textContent = t("shell.source.externalLlmBtn");

    const uploadHint = document.createElement("span");
    uploadHint.className = "chat-form-help";
    uploadHint.textContent = t("shell.source.uploadHint");

    // v1.2.3 (#454 Phase 2.1): chip-liste i stedet for "·"-separert tekst, så hver kilde
    // får sin egen rad med × for fjerning. uploadHint vises kun når lista er tom.
    const sourceList = document.createElement("ul");
    sourceList.className = "source-chip-list";
    sourceList.hidden = true;

    const refreshUploadHint = () => {
      sourceList.innerHTML = "";
      const items = [
        ...uploadedFileSources.map((f, i) => ({ kind: "file", index: i, label: f.fileName })),
        ...fetchedUrlSources.map((s, i) => ({ kind: "url", index: i, label: s.hostname })),
      ];
      sourceList.hidden = items.length === 0;
      uploadHint.hidden = items.length > 0;
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
    externalLlmBtn.addEventListener("click", async () => {
      const scenarioMode = entry.context?.scenarioMode ?? "auto";
      const promptText = buildExternalLlmAuthoringPrompt(scenarioMode);
      try {
        await navigator.clipboard.writeText(promptText);
        showToast(t("shell.source.externalLlm.copied"), "success");
      } catch {
        // Clipboard API can fail in some browsers/contexts. Still open the modal — the
        // textarea inside lets the user copy the prompt manually as fallback.
        showToast(t("shell.source.externalLlm.copyFailed"), "error");
      }
      openExternalLlmModal({
        scenarioMode,
        onImportSuccess: () => {
          entry.submitted = true;
          _deactivateAll();
          btn.disabled = true;
          inputEl.disabled = true;
          uploadBtn.disabled = true;
          urlBtn.disabled = true;
          crawlBtn.disabled = true;
          externalLlmBtn.disabled = true;
        },
      });
    });

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
    uploadRow.appendChild(externalLlmBtn);
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
      _deactivateAll();
      logUser(t("shell.source.userPreview"));
      entry.onSubmit(combinedSourceMaterial);
      return;
    }

    const val = inputEl.value.trim();
    if (!val) { inputEl.focus(); return; }
    btn.disabled = true;
    inputEl.disabled = true;
    entry.submitted = true;
    const displayText = isMultiLine
      ? tf("shell.source.userPreview", { count: val.length, preview: val.length > 80 ? val.slice(0, 80) + "…" : val })
      : val;
    _deactivateAll();
    logUser(displayText);
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
  chatMessages.appendChild(wrap);
  _domScroll(wrap);
  // #360 a11y: for source-material, focus the upload button — the first meaningful
  // control in the step. Keyboard users discover both upload AND textarea via natural
  // Tab order; previously textarea autofocus required Shift+Tab to find the upload.
  // For other form types, keep textarea/input autofocus (instant typing).
  setTimeout(() => {
    if (isSourceMaterial) {
      const uploadBtn = wrap.querySelector(".chat-choice-btn");
      (uploadBtn ?? inputEl).focus();
    } else {
      inputEl.focus();
    }
  }, 80);
}

// Renders a module-picker choices column.
function _domModuleChoicesCol(modules, active) {
  const row = document.createElement("div");
  row.className = "chat-choices chat-choices--column";
  for (const m of modules) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary chat-choice-btn";
    btn.textContent = m.title || m.id;
    btn.disabled = !active;
    if (m.activeVersion) {
      const badge = document.createElement("span");
      badge.className = "module-status-badge live";
      badge.style.cssText = "font-size:11px;padding:2px 8px;margin-left:8px";
      badge.textContent = `Live v${m.activeVersion.versionNo}`;
      btn.appendChild(badge);
    }
    if (active) {
      btn.addEventListener("click", () => {
        _disableAllDomChoices();
        _deactivateAll();
        logUser(m.title || m.id);
        loadModule(m.id);
      });
    }
    row.appendChild(btn);
  }
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary chat-choice-btn";
  cancelBtn.textContent = t("shell.action.cancel");
  cancelBtn.disabled = !active;
  if (active) {
    cancelBtn.addEventListener("click", () => {
      _disableAllDomChoices();
      _deactivateAll();
      logUser(t("shell.action.cancel"));
      startIdle();
    });
  }
  row.appendChild(cancelBtn);
  chatMessages.appendChild(row);
  _domScroll(row);
  if (active) {
    focusFirstEnabledChoice(row);
  }
}

// ---------------------------------------------------------------------------
// Logged chat API — all flow functions use these
// ---------------------------------------------------------------------------

// Log + render a bot message. htmlFn() is called at render time so re-translation works.
function logBot(htmlFn, choices = []) {
  const entry = { kind: "bot", html: htmlFn, choices, active: choices.length > 0 };
  chatLog.push(entry);
  _domBotBubble(htmlFn(), choices, false, choices.length > 0);
}

// Log + render a user bubble. Marks all preceding entries inactive.
function logUser(text) {
  _deactivateAll();
  chatLog.push({ kind: "user", text });
  _domUserBubble(text);
}

// Create a progress slot (logged as a pending bot entry). Caller attaches abort listener.
// textKeyOrFn: i18n key OR () => string.  Returns { entry, el, abortBtn }.
function logProgress(textKeyOrFn, options = {}) {
  const { el, abortBtn } = _domProgress(textKeyOrFn, options);
  const entry = { kind: "bot", html: null, choices: [], active: false };
  chatLog.push(entry);
  return { entry, el, abortBtn };
}

// Resolve a progress slot with its final content + choices.
// Updates both the log entry and the DOM element in-place.
function logResolveSlot(slot, htmlFn, choices = []) {
  setChatBusy(false);
  slot.entry.html = htmlFn;
  slot.entry.choices = choices;
  slot.entry.active = choices.length > 0;
  slot.el.innerHTML = `<div class="chat-bubble">${htmlFn()}</div>`;
  if (choices.length > 0) {
    slot.el.appendChild(_domChoiceRow(choices, false, true));
  }
  const announcement = htmlToPlainText(htmlFn());
  if (announcement && announcement.length <= 160) {
    announceStatus(announcement);
  }
  _domScroll(slot.el);
}

// Log + render a text input or textarea form (prompt bubble + input fields).
function logForm(formType, promptHtmlFn, placeholderKey, submitKey, onSubmit, initialValue = "", context = {}) {
  const entry = { kind: "form", formType, promptHtml: promptHtmlFn, placeholderKey, submitKey, onSubmit, submitted: false, initialValue, context };
  chatLog.push(entry);
  _domBotBubble(promptHtmlFn(), [], false);
  _domFormFields(entry);
}

// Log + render the module picker choices column.
function logModuleChoices(modules) {
  const entry = { kind: "module-choices", modules, active: true };
  chatLog.push(entry);
  _domModuleChoicesCol(modules, true);
}

// ---------------------------------------------------------------------------
// Re-translate — clears and replays the entire chatLog with the current locale
// ---------------------------------------------------------------------------

function retranslateChat() {
  chatMessages.innerHTML = "";
  for (const entry of chatLog) {
    if (entry.kind === "bot" && entry.html) {
      _domBotBubble(entry.html(), entry.choices, !entry.active);
    } else if (entry.kind === "user") {
      _domUserBubble(entry.text);
    } else if (entry.kind === "form") {
      _domBotBubble(entry.promptHtml(), [], true);
      if (!entry.submitted) {
        _domFormFields(entry);
      }
    } else if (entry.kind === "module-choices") {
      _domModuleChoicesCol(entry.modules, entry.active);
    }
  }
  chatMessages.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

function renderPreviewLocaleBar() {
  // Only show the switcher when content is loaded — with nothing to author, the only language that
  // means anything is the UI one, and that has its own selector in the top bar.
  const hasContent = !!bundle || !!sessionDraft || !!previewDraft;
  contentLocaleBar.classList.toggle("visible", hasContent);
  contentLocaleBar.innerHTML = "";
  if (!hasContent) return;

  // Stage-tilbakemelding 2026-08-17: this reads as a PREVIEW control, but it decides the language
  // for Forhåndsvisning, Rediger and Innstillinger alike. Saying so is half the fix; the other
  // half was making Innstillinger actually obey it.
  const label = document.createElement("span");
  label.className = "content-locale-label";
  label.textContent = t("shell.contentLocale.label");
  contentLocaleBar.appendChild(label);

  for (const loc of supportedLocales) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preview-locale-btn" + (loc === contentLocale ? " active" : "");
    btn.textContent = localeLabels[loc] ?? loc;
    btn.setAttribute("aria-pressed", String(loc === contentLocale));
    btn.setAttribute("aria-label", tf("shell.contentLocale.switchAria", { locale: localeLabels[loc] ?? loc }));
    btn.addEventListener("click", () => {
      if (loc === contentLocale) return;
      // Disse knappene er i dag deaktivert under redigering via CSS. Guarden står likevel her, så
      // flaten ikke får tilbake blindveien i det øyeblikket noen fjerner den CSS-regelen.
      const wasEditing = !!document.getElementById("previewEditConfirm");
      // Innstillinger holds one language's text in DOM-only fields, exactly like the UI-language
      // switch does — so it needs the same guard, or a typed instruction is lost on the way.
      if (activeTab === "settings" && hasUnsavedSettingsEdits()
        && !window.confirm(t("shell.tab.unsaved.settingsBody"))) {
        return;
      }
      contentLocale = loc;
      // The panel's editors are seeded once, in the language they were seeded FOR. Discard so the
      // next render re-reads them in the new one; otherwise the author edits Norwegian text that
      // the save then files as English.
      settingsCriteriaState = null;
      settingsCriteriaBaseline = null;
      settingsCriteriaDraftBaseline = undefined;
      settingsDraftValues = null;
      renderPreviewLocaleBar();
      renderPreview();
      renderSettingsPanel();
      if (wasEditing) {
        enterPreviewEditMode({ force: true });
        logBot(() => escapeHtml(t("shell.directEdit.localeSwitched")));
      }
    });
    contentLocaleBar.appendChild(btn);
  }
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
  if (!stateRail) return;
  const hasModule = !!selectedModuleId;
  stateRail.hidden = !hasModule;
  // #787: content-owner panel for the loaded module. Render once per module (guard on the last id) so
  // the frequent updateStateRail calls don't re-fetch/reset it; hide when no module is loaded.
  const ownerHost = document.getElementById("moduleOwnerPanelHost");
  if (ownerHost) {
    if (!hasModule) {
      ownerHost.hidden = true;
      ownerHost.dataset.moduleId = "";
    } else if (ownerHost.dataset.moduleId !== selectedModuleId) {
      ownerHost.dataset.moduleId = selectedModuleId;
      ownerHost.hidden = false;
      renderOwnerPanel({ container: ownerHost, contentType: "MODULE", contentId: selectedModuleId, getHeaders }).catch(() => {});
    }
  }
  if (!hasModule) return;

  const chains = bundle ? deriveModuleStatusChains(bundle) : null;
  const hasUnsaved = !!sessionDraft;
  // The version the workspace actually has open — which is NOT the same as the live one whenever
  // the author has restored an earlier version or is sitting on a saved draft. Both rail fields
  // below describe what is on screen, so both read this rather than the published chain.
  const loaded = bundle?.selectedConfiguration?.moduleVersion ?? null;
  const loadedIsLive = !!loaded?.id && loaded.id === bundle?.module?.activeVersionId;

  if (srModuleName) {
    srModuleName.textContent = localizeValue(sessionDraft?.title ?? previewDraft?.title ?? bundle?.module?.title) || selectedModuleId;
  }

  if (srEditing) {
    // Same correction as the preview field below: this read `liveChain` — what is PUBLISHED —
    // while the field is called "Du redigerer" and the author is editing whatever is loaded.
    if (hasUnsaved) {
      srEditing.innerHTML = makeSrBadge("unsaved", t("stateRail.editing.workingDraft"));
    } else if (loaded?.versionNo != null) {
      srEditing.innerHTML = loadedIsLive
        ? makeSrBadge("published", tf("stateRail.editing.published", { versionNo: loaded.versionNo }))
        : makeSrBadge("saved-draft", tf("stateRail.editing.savedDraft", { versionNo: loaded.versionNo }));
    } else if (chains?.liveChain.length > 0) {
      srEditing.innerHTML = makeSrBadge("published", tf("stateRail.editing.published", { versionNo: chains.liveChain[0].versionNo }));
    } else {
      srEditing.innerHTML = `<span class="state-rail-value">—</span>`;
    }
  }

  if (srLive) {
    if (chains?.liveChain.length > 0) {
      srLive.innerHTML = makeSrBadge("published", tf("stateRail.live.published", { versionNo: chains.liveChain[0].versionNo }));
    } else {
      srLive.innerHTML = `<span class="state-rail-value" style="color:var(--color-meta)">${escapeHtml(t("stateRail.live.none"))}</span>`;
    }
  }

  if (srChanges) {
    if (hasUnsaved) {
      srChanges.innerHTML = makeSrBadge("unsaved", t("stateRail.changes.unsaved"));
    } else {
      // v1.1.97: "Alt lagret" får ✓-prefiks og grønn-tint via dedikert klasse i stedet for
       // inline style — mer fremtredende OK-indikator.
      srChanges.innerHTML = `<span class="state-rail-value state-rail-value--saved-ok">✓ ${escapeHtml(t("stateRail.changes.saved"))}</span>`;
    }
  }

  if (srPreview) {
    // Stage-tilbakemelding 2026-08-17: *"det står at preview viser publisert versjon, men det som
    // faktisk vises er min versjon under endring"*. This field had exactly two answers — "working
    // draft" when a session draft existed, and otherwise the flat claim "published version". It
    // never looked at WHICH version the preview had loaded. Open a saved draft, or restore an
    // older version, and it asserted "published" over content that was not published at all.
    //
    // Three states now, and they are the three the preview can actually be in.
    if (hasUnsaved) {
      srPreview.innerHTML = makeSrBadge("unsaved", t("stateRail.preview.workingDraft"));
    } else if (loadedIsLive) {
      srPreview.innerHTML = `<span class="state-rail-value">${escapeHtml(t("stateRail.preview.published"))}</span>`;
    } else if (loaded?.versionNo != null) {
      srPreview.innerHTML = makeSrBadge("saved-draft", tf("stateRail.preview.savedVersion", { versionNo: loaded.versionNo }));
    } else {
      srPreview.innerHTML = `<span class="state-rail-value">—</span>`;
    }
  }

  if (srLang) {
    srLang.textContent = localeLabels[contentLocale] ?? (contentLocale);
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

function setPreviewCandidate(patch) {
  previewDraft = buildPreviewCandidate(patch);
  renderPreviewLocaleBar();
  renderPreview();
}

function clearPreviewCandidate() {
  previewDraft = null;
  renderPreviewLocaleBar();
  renderPreview();
}

function translateLocalizedText(text) {
  if (!text) return "";
  if (typeof text === "object") return text;
  return {
    "en-GB": text,
    nb: text,
    nn: text,
  };
}

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

function normalizeModuleTitlePatch(title) {
  if (!title) return null;
  if (typeof title === "string") {
    const normalized = title.trim();
    if (!normalized) return null;
    // #892: en uoversatt tittel sendes som streng. Tidligere fylte buildLocalizedTextMap alle tre
    // språk med samme tekst, som fikk tittelen til å se oversatt ut og skjulte at den ikke var det.
    // Utkast som FAKTISK er oversatt kommer hit som objekt (localizeDraftAcrossLocales) og merges.
    return normalized;
  }
  if (typeof title !== "object") {
    return null;
  }

  const normalized = {};
  for (const locale of supportedLocales) {
    const value = title?.[locale];
    if (typeof value === "string" && value.trim()) {
      normalized[locale] = value.trim();
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function localizeDraftAcrossLocales(taskText, assessorExpectedContent, sourceLocale, candidateTaskConstraints) {
  const localized = {
    taskText: buildLocalizedTextMap(sourceLocale, taskText),
    assessorExpectedContent: buildLocalizedTextMap(sourceLocale, assessorExpectedContent),
    candidateTaskConstraints: buildLocalizedTextMap(sourceLocale, candidateTaskConstraints ?? ""),
  };

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;
    const result = await apiFetch(
      "/api/admin/content/generate/module-draft/localize",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ taskText, assessorExpectedContent, candidateTaskConstraints: candidateTaskConstraints ?? "", sourceLocale, targetLocale }),
      },
    );
    const draft = result?.draft ?? result;
    localized.taskText[targetLocale] = draft?.taskText ?? taskText;
    localized.assessorExpectedContent[targetLocale] = draft?.assessorExpectedContent ?? assessorExpectedContent;
    localized.candidateTaskConstraints[targetLocale] = draft?.candidateTaskConstraints ?? candidateTaskConstraints ?? "";
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
    // Lokaler som IKKE ble oversatt. De står nå med kildeteksten, som er nødvendig for at lagring
    // skal gå gjennom — men kalleren MÅ si fra, ellers ser forfatteren «ferdig» på en tittel som i
    // praksis er kopiert. Stillhet her var halve #892.
    failedLocales: [],
  };
  const hasDraftBody = Boolean(taskText?.trim() && assessorExpectedContent?.trim());

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;

    if (!hasDraftBody) {
      // Ingen oppgavetekst å oversette (MCQ-only) — bare tittelen skal flyttes over.
      try {
        const translatedTitle = await localizeTitleOnly(title, sourceLocale, targetLocale);
        if (translatedTitle) localized.title[targetLocale] = translatedTitle;
        else localized.failedLocales.push(targetLocale);
      } catch {
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
    localized.title[targetLocale] = draft.title;
    localized.taskText[targetLocale] = draft?.taskText ?? taskText;
    localized.assessorExpectedContent[targetLocale] = draft?.assessorExpectedContent ?? assessorExpectedContent;
    localized.candidateTaskConstraints[targetLocale] = draft?.candidateTaskConstraints ?? candidateTaskConstraints ?? "";
  }

  return localized;
}

async function localizeMcqAcrossLocales(questions, sourceLocale) {
  const localizedQuestions = questions.map((question) => ({
    stem: buildLocalizedTextMap(sourceLocale, question.stem),
    options: question.options.map((option) => buildLocalizedTextMap(sourceLocale, option)),
    correctAnswer: buildLocalizedTextMap(sourceLocale, question.correctAnswer),
    rationale: buildLocalizedTextMap(sourceLocale, question.rationale),
  }));

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;
    const result = await apiFetch(
      "/api/admin/content/generate/mcq/localize",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ questions, sourceLocale, targetLocale }),
      },
    );
    const translatedQuestions = result?.questions ?? [];
    translatedQuestions.forEach((question, index) => {
      if (!localizedQuestions[index]) return;
      localizedQuestions[index].stem[targetLocale] = question?.stem ?? localizedQuestions[index].stem[sourceLocale];
      localizedQuestions[index].correctAnswer[targetLocale] = question?.correctAnswer ?? localizedQuestions[index].correctAnswer[sourceLocale];
      localizedQuestions[index].rationale[targetLocale] = question?.rationale ?? localizedQuestions[index].rationale[sourceLocale];
      (question?.options ?? []).forEach((option, optionIndex) => {
        if (!localizedQuestions[index].options[optionIndex]) return;
        localizedQuestions[index].options[optionIndex][targetLocale] = option ?? localizedQuestions[index].options[optionIndex][sourceLocale];
      });
    });
  }

  return localizedQuestions;
}

function buildLocalizedMcqDraft(questions, sourceLocale) {
  return (questions ?? []).map((question) => ({
    stem: buildLocalizedTextMap(sourceLocale, question?.stem ?? ""),
    options: (question?.options ?? []).map((option) => buildLocalizedTextMap(sourceLocale, option ?? "")),
    correctAnswer: buildLocalizedTextMap(sourceLocale, question?.correctAnswer ?? ""),
    rationale: buildLocalizedTextMap(sourceLocale, question?.rationale ?? ""),
  }));
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
  return {
    systemPrompt: prompt?.systemPrompt ?? translateLocalizedText(t("adminContent.defaults.systemPrompt")),
    userPromptTemplate: prompt?.userPromptTemplate ?? translateLocalizedText(t("adminContent.defaults.userPromptTemplate")),
    examples: prompt?.examples ?? tryParseJsonTranslation("adminContent.defaults.examplesJson", []),
  };
}

function resolveMcqTitlePayload() {
  const existingTitle = bundle?.selectedConfiguration?.mcqSetVersion?.title;
  if (existingTitle) return existingTitle;
  const moduleTitle = bundle?.module?.title ?? sessionDraft?.title ?? t("shell.newModule.defaultTitle");
  return typeof moduleTitle === "string" ? translateLocalizedText(moduleTitle) : moduleTitle;
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

// ---------------------------------------------------------------------------
// #926 (#896 §6 krav 1): samtalen foreslår — den overskriver aldri.
//
// Spesifikasjonen: har feltene ulagrede endringer, skal et generert resultat lande som et
// FORSLAG med «Bruk»/«Forkast», ikke skrives rett inn. Uten dette kan forfatteren skrive et
// scenario for hånd, be om en revisjon i chatten, og få sitt eget arbeid erstattet uten å ha
// sagt ja.
//
// Verre enn som så, før denne endringen: med redigeringsskjemaet åpent ble feltene ikke tegnet
// på nytt etter en generering. Utkastet under dem var byttet ut, men skjermen viste fortsatt
// forfatterens egen tekst — overskrivingen ble først synlig ved lagring.
//
// Forslaget parkeres i samtaleloggen fordi det er der forfatteren nettopp ba om endringen, og
// fordi chat-panelet er synlig i begge fanene der dette kan inntreffe. Det holdes UTENFOR
// `sessionDraft`: et forslag som allerede ligger i utkastet er ikke et forslag, og ville blitt
// lagret av neste «Lagre».
//
// Merk at «ulagrede endringer» her betyr `hasOpenEditForm()` — feltverdier som avviker fra det
// de ble tegnet med. Et urørt skjema er ikke i bruk, og et forslag der ville bare vært et ekstra
// klikk foran den handlingen forfatteren nettopp ba om.
// ---------------------------------------------------------------------------
let pendingProposal = null;

/**
 * Commit a generated patch, or park it as a proposal when the edit form holds unsaved typing.
 *
 * @param patch      the localized patch, ready for `buildPreviewCandidate`
 * @param slot       the conversation-log slot the generation is reporting into
 * @param readyHtml  () => html — what the log says when the patch is applied
 * @param scroll     "top" | "bottom"
 * @param onCommit   runs after the patch lands, on both paths. NOT run while parked: it starts
 *                   criteria generation and moves the session state, and neither should happen
 *                   for content the author has not accepted.
 * @returns true if committed, false if parked.
 */
function commitOrProposeGenerated({ patch, slot, readyHtml, scroll = "top", onCommit }) {
  const commit = () => {
    commitSessionDraftPatch(patch, { scroll });
    onCommit?.();
  };

  if (!hasOpenEditForm()) {
    commit();
    logResolveSlot(slot, readyHtml);
    return true;
  }

  // A second proposal replaces the first rather than queueing: two competing "Bruk"-buttons in
  // the log, both claiming to be the generated result, is worse than losing the older one — and
  // the older one is by definition the one the author did not answer.
  pendingProposal = { commit };
  const thisProposal = pendingProposal;
  logResolveSlot(
    slot,
    () => `<strong>${escapeHtml(t("shell.proposal.title"))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.proposal.body"))}</p>`,
    [
      {
        labelKey: "shell.proposal.use",
        action: () => {
          // Stale guard: the log entry survives a re-render, so an old proposal's button must not
          // resurrect content the author already answered for.
          if (pendingProposal !== thisProposal) return;
          pendingProposal = null;
          thisProposal.commit();
          // The fields on screen still hold the author's typing. They said yes, so repaint from
          // the draft — otherwise the accepted proposal is invisible until the next re-render,
          // which is the exact failure this whole mechanism exists to remove.
          if (activeTab === "edit") enterPreviewEditMode({ force: true });
          logBot(() => escapeHtml(t("shell.proposal.used")));
        },
      },
      {
        labelKey: "shell.proposal.discard",
        action: () => {
          if (pendingProposal !== thisProposal) return;
          pendingProposal = null;
          logBot(() => escapeHtml(t("shell.proposal.discarded")));
        },
      },
    ],
  );
  return false;
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
  renderPreviewLocaleBar();
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
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale, generationMode, scenarioMode, ...(blueprintObject ? { blueprint: blueprintObject } : {}) }),
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
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.generating.draftErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onAccept, blueprint, scenarioMode) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const draft = result?.draft ?? result;
  const localizedDraft = await localizeDraftAcrossLocales(draft.taskText, draft.assessorExpectedContent, locale, draft.candidateTaskConstraints);
  // #926 §6: gjennom porten. Blueprint og hash-oppfriskningen hører til utkastet, ikke til
  // forslaget, så de skjer først når patchen faktisk landes.
  commitOrProposeGenerated({
    patch: { taskText: localizedDraft.taskText, assessorExpectedContent: localizedDraft.assessorExpectedContent, candidateTaskConstraints: localizedDraft.candidateTaskConstraints },
    slot,
    readyHtml: () => `<strong>${escapeHtml(t("shell.generating.draftReady"))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>`,
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
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.generating.mcqErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, questionCount, optionCount, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const questions = result?.questions ?? [];
  const localizedQuestions = await localizeMcqAcrossLocales(questions, locale);
  // #551: surface MCQ quality warnings (incl. the length-cue check) so the author can review.
  const mcqWarnings = Array.isArray(result?.validation?.issues) ? result.validation.issues : [];
  const mcqWarningsHtml = mcqWarnings.length > 0
    ? `<p style="margin:8px 0 0;font-size:13px;color:var(--color-warning,#b45309)">⚠ ${mcqWarnings.map(escapeHtml).join("<br>")}</p>`
    : "";
  commitOrProposeGenerated({
    patch: { mcqQuestions: localizedQuestions },
    slot,
    scroll: "bottom",
    readyHtml: () => `<strong>${escapeHtml(tf("shell.generating.mcqReady", { count: questions.length }))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>${mcqWarningsHtml}`,
    onCommit: () => onAccept?.(questions),
  });
}

async function reviseDraftInBackground(instruction, onAccept) {
  const abort = startGeneration();
  const slot = logProgress("shell.revision.draftProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  let result;
  try {
    result = await apiFetch(
      "/api/admin/content/generate/module-draft/revise",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({
          taskText: localizeValueForLocale(sessionDraft?.taskText ?? "", currentLocale),
          assessorExpectedContent: localizeValueForLocale(sessionDraft?.assessorExpectedContent ?? "", currentLocale),
          candidateTaskConstraints: localizeValueForLocale(sessionDraft?.candidateTaskConstraints ?? "", currentLocale),
          instruction,
          locale: currentLocale,
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
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.revision.draftErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => reviseDraftInBackground(instruction, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const draft = result?.draft ?? result;
  const localizedDraft = await localizeDraftAcrossLocales(draft.taskText, draft.assessorExpectedContent, currentLocale, draft.candidateTaskConstraints);
  // #926 §6: dette er stien saken beskriver ordrett — forfatteren har skrevet i feltene og ber om
  // en revisjon i chatten. Uten porten kom svaret rett inn over deres eget arbeid.
  commitOrProposeGenerated({
    patch: { taskText: localizedDraft.taskText, assessorExpectedContent: localizedDraft.assessorExpectedContent, candidateTaskConstraints: localizedDraft.candidateTaskConstraints },
    slot,
    readyHtml: () => `<strong>${escapeHtml(t("shell.revision.draftReady"))}</strong>`,
    onCommit: () => onAccept?.(draft),
  });
}

async function reviseMcqInBackground(instruction, onAccept) {
  const abort = startGeneration();
  const slot = logProgress("shell.revision.mcqProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  const currentQuestions = (sessionDraft?.mcqQuestions ?? []).map((question) => ({
    stem: localizeValueForLocale(question.stem, currentLocale),
    options: (question.options ?? []).map((option) => localizeValueForLocale(option, currentLocale)),
    correctAnswer: localizeValueForLocale(question.correctAnswer, currentLocale),
    rationale: localizeValueForLocale(question.rationale, currentLocale),
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
          locale: currentLocale,
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
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.revision.mcqErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => reviseMcqInBackground(instruction, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const questions = result?.questions ?? [];
  const localizedQuestions = await localizeMcqAcrossLocales(questions, currentLocale);
  commitOrProposeGenerated({
    patch: { mcqQuestions: localizedQuestions },
    slot,
    scroll: "bottom",
    readyHtml: () => `<strong>${escapeHtml(tf("shell.revision.mcqReady", { count: questions.length }))}</strong>`,
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
    commitSessionDraftPatch({
      title: localizedDraft.title,
      taskText: localizedDraft.taskText,
      assessorExpectedContent: localizedDraft.assessorExpectedContent,
      candidateTaskConstraints: localizedDraft.candidateTaskConstraints,
    });
    // En delvis oversettelse er ikke en suksess. Sier vi «ferdig» her, står forfatteren igjen med en
    // tittel som ser oversatt ut, men som er kildeteksten kopiert inn — og oppdager det først når en
    // deltaker møter feil språk.
    const warning = localizedDraft.failedLocales?.length
      ? ` ${tf("shell.revision.titleNotTranslated", {
          locales: localizedDraft.failedLocales.join(", "),
          source: snapshot.sourceLocale,
        })}`
      : "";
    logResolveSlot(
      slot,
      () => `<strong>${escapeHtml(tf("shell.revision.titleReady", { title: newTitle }))}</strong>${escapeHtml(warning)}`,
    );
  } catch (err) {
    const errMsg = String(err?.message ?? err);
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
      patch.mcqQuestions = localizedMcq;
    }
    commitSessionDraftPatch(patch, { scroll: localizedMcq && !localizedDraft ? "bottom" : "top" });
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.revision.translateReady"))}</strong>`);
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.revision.translateErrorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => refreshLocalizedDraftInBackground({ draft, mcq }) },
    ]);
  }
}

async function saveDraftBundleInBackground(options = {}) {
  const { afterSave = null } = options;
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
  // v1.1.95: when save fails on pre-save validation, attach recovery actions to the error
  // message. Previously the bot message had no choices and the chat menu was deactivated
  // (because the user just clicked Lagre utkast and _deactivateAll fired), so users were
  // stuck with no way forward. Same action set as draft-ready menu — user can edit,
  // revise, open Avansert, restart, or retry Lagre.
  // v1.1.97: when MCQ is missing (cancelled or failed generation), recovery menu also
  // includes "Generer MCQ" so the user can re-trigger generation without going via
  // Avansert or restart. Uses startGenerateMcqFlow which asks for source material again
  // — friction acceptable for a rare failure-recovery case.
  const buildSaveRecoveryActions = ({ includeGenerateMcq = false } = {}) => {
    const model = deriveShellDraftReadyActionModel({ hasSelectedModule: !!selectedModuleId });
    const actionMap = {
      revise: { labelKey: "shell.draftReady.editInChat", action: () => startUnifiedRevisionFlow() },
      restart: { labelKey: "shell.draftReady.restart", action: startIdle },
      saveDraft: { labelKey: "shell.draftReady.saveDraft", action: saveDraftBundleInBackground },
    };
    const actions = model.actionKeys.map((key) => actionMap[key]).filter(Boolean);
    if (includeGenerateMcq) {
      actions.unshift({ labelKey: "shell.module.generateMcq", action: () => startGenerateMcqFlow() });
    }
    return actions;
  };
  if (!isMcqOnly && !localizeValueForLocale(taskText, currentLocale).trim()) {
    logBot(() => t("shell.save.taskRequired"), buildSaveRecoveryActions());
    return;
  }
  // #578: FREETEXT_ONLY modules have no MCQ — skip the MCQ-required guard for them.
  if (!isFreetextOnly && !mcqQuestions.length) {
    logBot(() => t("shell.save.mcqRequired"), buildSaveRecoveryActions({ includeGenerateMcq: true }));
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
        taskText: String(localizeValueForLocale(taskText, currentLocale) ?? "").trim(),
        assessorExpectedContent: String(localizeValueForLocale(assessorExpectedContent, currentLocale) ?? "").trim(),
        candidateTaskConstraints: String(localizeValueForLocale(candidateTaskConstraints, currentLocale) ?? "").trim() || undefined,
        certificationLevel: certificationLevelForGeneration(),
        locale: currentLocale,
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
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.save.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => saveDraftBundleInBackground(options) },
    ]);
  }
}

// #896 S4: which locale a value ACTUALLY has, with no fallback. localizeValueForLocale falls
// back to nb/en-GB by design so the preview is never blank — exactly wrong when the question is
// "is this locale missing?", because the fallback answers "no" for every locale.
function strictLocaleValue(value, locale) {
  if (!value) return "";
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      const maybe = JSON.parse(parsed);
      parsed = maybe && typeof maybe === "object" && !Array.isArray(maybe) ? maybe : null;
    } catch {
      // A plain string is written in one language. It belongs to no locale in particular, so
      // the caller decides what the source locale is — it is not "present" under any of them.
      parsed = null;
    }
    if (parsed === null) return "";
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const candidate = parsed[locale];
  return typeof candidate === "string" ? candidate : "";
}

// The stored value read as one language.
//
// A bare string is legacy content whose language was never recorded, and the SERVER resolves it as
// nb (`missingLocalesFor`'s sourceLocale default). The client must agree, or the two disagree
// about the same bytes: this used to hand the string back for whatever locale was asked, so with
// an English UI a Norwegian legacy title was accepted as the en-GB source, saved under en-GB, and
// nb ended up missing — the republish then failed on a gap the gap-fill had just created.
const LEGACY_STRING_LOCALE = "nb";

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
  const others = otherBlockers.map((issue) => issue?.message).filter(Boolean);
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
  const preferredOrder = [contentLocale, currentLocale, "nb", "en-GB", "nn"];
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
    const errMsg = String(err?.message ?? err);
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
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.unpublish.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: unpublishModuleInBackground },
    ]);
  }
}

async function archiveModuleInBackground() {
  const moduleId = selectedModuleId;
  if (!moduleId) return;

  const slot = logProgress("shell.archive.progress");
  slot.abortBtn.remove();

  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/archive`, getHeaders, {
      method: "POST",
      body: JSON.stringify({}),
    });
    bundle = null;
    selectedModuleId = null;
    sessionDraft = null;
    previewDraft = null;
    latestSavedModuleVersionId = null;
    renderPreviewLocaleBar();
    renderPreview();
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.archive.success"))}</strong>`);
    showToast(t("shell.archive.success"), "success");
    announceStatus(t("shell.archive.success"));
    startIdle();
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.archive.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: archiveModuleInBackground },
    ]);
  }
}

async function restoreArchivedModuleInBackground(moduleId, moduleTitle) {
  const slot = logProgress("shell.restore.progress");
  slot.abortBtn.remove();

  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/restore`, getHeaders, {
      method: "POST",
      body: JSON.stringify({}),
    });
    logResolveSlot(slot, () => `<strong>${escapeHtml(tf("shell.restore.success", { module: moduleTitle ?? moduleId }))}</strong>`);
    showToast(tf("shell.restore.success", { module: moduleTitle ?? moduleId }), "success");
    announceStatus(tf("shell.restore.success", { module: moduleTitle ?? moduleId }));
    await loadModule(moduleId);
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.restore.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: () => restoreArchivedModuleInBackground(moduleId, moduleTitle) },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
  }
}

async function startArchivedModulePicker() {
  const slot = logProgress("shell.archive.loading");
  slot.abortBtn.remove();

  try {
    const data = await apiFetch(`/api/admin/content/modules/archive?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
    const archivedModules = Array.isArray(data?.modules) ? data.modules : [];
    if (archivedModules.length === 0) {
      logResolveSlot(slot, () => escapeHtml(t("shell.archive.empty")), [
        { labelKey: "shell.action.cancel", action: startIdle },
      ]);
      return;
    }

    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.archive.prompt"))}</strong>`);
    logBot(
      () => escapeHtml(t("shell.archive.pickHint")),
      [
        ...archivedModules.map((module) => ({
          label: module.title || module.id,
          action: () => restoreArchivedModuleInBackground(module.id, module.title || module.id),
        })),
        { labelKey: "shell.action.cancel", action: startIdle },
      ],
    );
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.archive.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: startArchivedModulePicker },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
  }
}

function buildLocalizedCopyValue(value) {
  if (value && typeof value === "object") {
    return Object.fromEntries(
      supportedLocales.map((locale) => {
        const localizedValue = localizeValueForLocale(value, locale) || localizeValueForLocale(value, "en-GB") || "";
        return [locale, `${localizedValue} ${t("shell.duplicate.copySuffix")}`.trim()];
      }),
    );
  }
  const fallback = String(value ?? "").trim();
  const label = fallback || t("shell.newModule.defaultTitle");
  return Object.fromEntries(
    supportedLocales.map((locale) => [locale, `${label} ${t("shell.duplicate.copySuffix")}`.trim()]),
  );
}

async function duplicateCurrentModuleInBackground() {
  const sourceModule = bundle?.module;
  const sourceConfig = bundle?.selectedConfiguration ?? {};
  if (!sourceModule) {
    logBot(() => t("shell.duplicate.moduleRequired"));
    return;
  }

  const slot = logProgress("shell.duplicate.progress");
  slot.abortBtn.remove();

  try {
    const createBody = await apiFetch(
      "/api/admin/content/modules",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({
          title: buildLocalizedCopyValue(sourceModule.title),
          description: sourceModule.description ?? undefined,
          certificationLevel: sourceModule.certificationLevel ?? "intermediate",
          validFrom: sourceModule.validFrom ?? undefined,
          validTo: sourceModule.validTo ?? undefined,
        }),
      },
    );
    const duplicatedModule = createBody?.module ?? createBody;
    const duplicatedModuleId = duplicatedModule?.id;
    if (!duplicatedModuleId) {
      throw new Error(t("shell.duplicate.errorUnknown"));
    }

    const rubricVersion = sourceConfig.rubricVersion
      ? await apiFetch(`/api/admin/content/modules/${encodeURIComponent(duplicatedModuleId)}/rubric-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({
          criteria: sourceConfig.rubricVersion.criteria,
          scalingRule: sourceConfig.rubricVersion.scalingRule,
        }),
      })
      : null;

    const promptTemplateVersion = sourceConfig.promptTemplateVersion
      ? await apiFetch(`/api/admin/content/modules/${encodeURIComponent(duplicatedModuleId)}/prompt-template-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({
          systemPrompt: sourceConfig.promptTemplateVersion.systemPrompt,
          userPromptTemplate: sourceConfig.promptTemplateVersion.userPromptTemplate,
          examples: sourceConfig.promptTemplateVersion.examples ?? [],
        }),
      })
      : null;

    const mcqSetVersion = sourceConfig.mcqSetVersion
      ? await apiFetch(`/api/admin/content/modules/${encodeURIComponent(duplicatedModuleId)}/mcq-set-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({
          title: sourceConfig.mcqSetVersion.title,
          questions: sourceConfig.mcqSetVersion.questions ?? [],
        }),
      })
      : null;

    if (sourceConfig.moduleVersion) {
      await apiFetch(`/api/admin/content/modules/${encodeURIComponent(duplicatedModuleId)}/module-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({
          taskText: sourceConfig.moduleVersion.taskText,
          assessorExpectedContent: sourceConfig.moduleVersion.assessorExpectedContent,
          candidateTaskConstraints: sourceConfig.moduleVersion.candidateTaskConstraints || undefined,
          rubricVersionId: rubricVersion?.rubricVersion?.id,
          promptTemplateVersionId: promptTemplateVersion?.promptTemplateVersion?.id,
          mcqSetVersionId: mcqSetVersion?.mcqSetVersion?.id,
          submissionSchema: sourceConfig.moduleVersion.submissionSchema ?? buildDefaultSubmissionSchema(),
          assessmentPolicy: sourceConfig.moduleVersion.assessmentPolicy ?? undefined,
        }),
      });
    }

    const sourceLabel = localizeValue(sourceModule.title) || sourceModule.id;
    await loadModule(duplicatedModuleId);
    logResolveSlot(slot, () => `<strong>${escapeHtml(tf("shell.duplicate.success", { module: sourceLabel }))}</strong>`);
    showToast(tf("shell.duplicate.success", { module: sourceLabel }), "success");
    announceStatus(tf("shell.duplicate.success", { module: sourceLabel }));
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.duplicate.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: duplicateCurrentModuleInBackground },
    ]);
  }
}

async function deleteModuleInBackground() {
  const moduleId = selectedModuleId;
  if (!moduleId) return;

  const slot = logProgress("shell.delete.progress");
  slot.abortBtn.remove();

  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}`, getHeaders, {
      method: "DELETE",
    });
    bundle = null;
    selectedModuleId = null;
    sessionDraft = null;
    previewDraft = null;
    latestSavedModuleVersionId = null;
    renderPreviewLocaleBar();
    renderPreview();
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.delete.success"))}</strong>`);
    showToast(t("shell.delete.success"), "success");
    announceStatus(t("shell.delete.success"));
    startIdle();
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.delete.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: deleteModuleInBackground },
    ]);
  }
}

function confirmModuleDeletion() {
  const moduleLabel = localizeValue(bundle?.module?.title) || selectedModuleId || "";
  if (!moduleLabel) {
    logBot(() => t("shell.delete.moduleRequired"));
    return;
  }

  logForm(
    "text",
    () => `<strong>${escapeHtml(tf("shell.delete.confirmPrompt", { module: moduleLabel }))}</strong>`,
    "shell.delete.confirmPlaceholder",
    "shell.delete.confirmSubmit",
    (typedValue) => {
      if (typedValue.trim() !== moduleLabel) {
        logBot(() => t("shell.delete.confirmMismatch"), [
          { labelKey: "shell.action.retry", action: confirmModuleDeletion },
          { labelKey: "shell.action.cancel", action: showModuleActions },
        ]);
        return;
      }
      deleteModuleInBackground();
    },
  );
}

function confirmHighImpactAction(promptKey, confirmKey, action, cancelAction = showModuleActions, vars = {}) {
  logBot(() => escapeHtml(tf(promptKey, vars)), [
    { labelKey: confirmKey, action },
    { labelKey: "shell.action.cancel", action: cancelAction },
  ]);
}

// ---------------------------------------------------------------------------
// Chat flows
// ---------------------------------------------------------------------------

function startIdle() {
  sessionState = "idle";
  bundle = null;
  selectedModuleId = null;
  sessionDraft = null;
  previewDraft = null;
  latestSavedModuleVersionId = null;
  chatLog = [];
  renderPreview();
  logBot(() => t("shell.idle.prompt"), [
    { labelKey: "shell.idle.openExisting", action: startModulePicker },
    { labelKey: "shell.idle.createNew", action: startNewModuleFlow },
  ]);
}

async function startModulePicker() {
  sessionState = "picking-module";
  previewDraft = null;
  renderPreviewLocaleBar();
  renderPreview();
  const slot = logProgress("shell.modules.loading");

  try {
    const data = await apiFetch("/api/admin/content/modules", getHeaders);
    modules = Array.isArray(data) ? data : (data?.modules ?? []);
  } catch {
    logResolveSlot(slot, () => t("shell.modules.loadError"), [
      { labelKey: "shell.action.retry", action: startModulePicker },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  if (modules.length === 0) {
    logResolveSlot(slot, () => t("shell.modules.empty"), [
      { labelKey: "shell.idle.createNew", action: startNewModuleFlow },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  // Build a snapshot of module list HTML (module titles are data, not translatable)
  const listItems = modules.map(
    (m) =>
      `<div class="module-list-item"><strong>${escapeHtml(m.title || m.id)}</strong>${m.activeVersion ? ` <span class="module-status-badge live" style="font-size:11px;padding:2px 8px">Live v${m.activeVersion.versionNo}</span>` : ""}</div>`,
  );
  const listSnapshot = listItems.join("");
  logResolveSlot(slot, () => `${escapeHtml(t("shell.modules.selectPrompt"))}<div class="module-list">${listSnapshot}</div>`);
  logModuleChoices(modules);
}

async function loadModule(moduleId, options = {}) {
  const { resumeEditing = false } = options;
  sessionState = "loading-module";
  selectedModuleId = moduleId;
  sessionDraft = null;
  previewDraft = null;
  latestSavedModuleVersionId = null;
  // #896 S3c: the Innstillinger panel keeps its editors in module-level state, and none of it
  // belonged to this module. Before S3c the criteria state was only seeded once the author opened
  // the editor; now it is seeded on every visit to the tab, so merely looking at module A's
  // settings and then switching to B would show — and save — A's criteria on B.
  resetSettingsPanelState();
  const slot = logProgress("shell.module.loading");

  try {
    const exportData = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    bundle = exportData?.moduleExport ?? null;
  } catch {
    // Stage-tilbakemelding 2026-08-17: send forfatteren til modul-lista i stedet for å bygge en
    // ny, lang liste inne i samtalen. Lista har søk og filtre; dette hadde ingen av delene.
    logResolveSlot(slot, () => t("shell.module.loadError"), [
      { labelKey: "shell.module.goToLibrary", action: () => { location.href = "/admin-content"; } },
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
  renderSettingsPanel();
  // The content-language switcher is hidden until there is content, and `loadModule` never told it
  // that content had arrived — so opening a module straight from its URL left it invisible. It
  // showed up only if you had come through the conversation flow, which renders it on its own.
  renderPreviewLocaleBar();
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

function detectRevisionTargets(instruction) {
  return detectShellRevisionTargets(instruction, {
    hasDraft: !!(sessionDraft?.taskText || sessionDraft?.assessorExpectedContent),
    hasMcq: (sessionDraft?.mcqQuestions?.length ?? 0) > 0,
  });
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
      { labelKey: "shell.revision.tryAgain", action: () => startUnifiedRevisionFlow() },
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

function startUnifiedRevisionFlow() {
  if (!sessionDraft?.taskText && !sessionDraft?.assessorExpectedContent && (sessionDraft?.mcqQuestions?.length ?? 0) === 0) {
    logBot(() => t("shell.revision.unavailable"));
    return;
  }

  logForm(
    "textarea",
    () => `<strong>${escapeHtml(t("shell.revision.unifiedPromptTitle"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.revision.unifiedPromptHint"))}</span>`,
    "shell.revision.placeholder",
    "shell.revision.submit",
    (instruction) => runUnifiedRevision(instruction),
  );
}

function startDirectEditFlow() {
  enterPreviewEditMode();
}

// B2 (#449 redesign): builds inline criteria-editor HTML for use inside preview-edit-mode.
// criteria is an array of { id, label, description, maxScore, candidateVisible }. Renders
// as .vk-* cards (same classes the chat-bubble editor used; styles now sized for the wider
// preview pane). Total weight + add/regenerate buttons at the bottom.
function buildCriteriaEditorHtml(criteria, t, tf) {
  const items = criteria.map((c, i) => {
    const labelLabel = escapeHtml(t("shell.criteria.labelLabel"));
    const descLabel = escapeHtml(t("shell.criteria.descLabel"));
    const weightText = escapeHtml(t("shell.criteria.weight"));
    // B4 (#451) a11y: remove-button aria-label includes the criterion's title so screen
    // readers say "Fjern: Klar kommunikasjon" — not just "Fjern". Falls back to a
    // positional label when title is empty.
    const removeAria = escapeHtml(
      c.label?.trim()
        ? tf("shell.criteria.removeAriaWithLabel", { label: c.label })
        : tf("shell.criteria.removeAriaPositional", { index: i + 1 })
    );
    // B4 a11y: aria-valuetext is what screen readers announce. Localised "{value} av 10" /
    // "{value} of 10". The vk-weight input event listener updates this dynamically.
    const weightValueText = escapeHtml(tf("shell.criteria.weightOfTen", { value: c.maxScore }));
    // Stage-tilbakemelding 2026-08-17: "Vurderingskriterium tar veldig mye plass". Fire stablede
    // rader i en kolonne dobbelt så bred som innholdet trengte. Samme felt, samme redigerbarhet —
    // pakket i BREDDEN. Skyveknappen er byttet mot en teller (femtedel av plassen, treffer et helt
    // tall hver gang), og beskrivelsen er én linje som vokser når man klikker i den.
    //
    // `vk-weight` beholder `type="range"` og klassenavnet: totalvekt-utregningen, aria-oppdateringen
    // og fire e2e-er leser dem. Den er visuelt skjult og erstattet av tellerknappene, som skriver
    // til samme input — ett tall, én kilde.
    return `
      <li class="vk-card" data-criterion-index="${i}">
        <input class="vk-label" type="text" value="${escapeHtml(c.label)}"
               placeholder="${escapeHtml(t("shell.criteria.labelPlaceholder"))}"
               aria-label="${labelLabel}" />
        <span class="vk-stepper">
          <button type="button" class="vk-step" data-step="-1"
                  aria-label="${escapeHtml(tf("shell.criteria.weightDown", { label: c.label || String(i + 1) }))}">&minus;</button>
          <input class="vk-weight" type="range" min="1" max="10" step="1" value="${c.maxScore}"
                 aria-label="${weightText}"
                 aria-valuemin="1" aria-valuemax="10" aria-valuenow="${c.maxScore}"
                 aria-valuetext="${weightValueText}" />
          <span class="vk-weight-value">${c.maxScore}</span>
          <button type="button" class="vk-step" data-step="1"
                  aria-label="${escapeHtml(tf("shell.criteria.weightUp", { label: c.label || String(i + 1) }))}">+</button>
        </span>
        <button type="button" class="vk-visible-toggle" aria-pressed="${c.candidateVisible ? "true" : "false"}"
                title="${escapeHtml(t("shell.criteria.visibleToCandidate"))}"
                aria-label="${escapeHtml(t("shell.criteria.visibleToCandidate"))}">
          <input class="vk-visible" type="checkbox" ${c.candidateVisible ? "checked" : ""} tabindex="-1" aria-hidden="true" />
          <span aria-hidden="true">${c.candidateVisible ? "◉" : "○"}</span>
        </button>
        <button type="button" class="vk-remove" data-criterion-index="${i}"
                aria-label="${removeAria}">×</button>
        <textarea class="vk-description" rows="1"
                  placeholder="${escapeHtml(t("shell.criteria.descPlaceholder"))}"
                  aria-label="${descLabel}">${escapeHtml(c.description)}</textarea>
      </li>`;
  }).join("");
  const total = criteria.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0);
  return `
    <ul class="vk-list">${items}</ul>
    <p class="vk-total"><strong>${escapeHtml(t("shell.criteria.totalWeight"))}:</strong> <span class="vk-total-value">${total}</span></p>
    <div class="vk-actions-row">
      <button type="button" class="vk-add vk-add-btn">+ ${escapeHtml(t("shell.criteria.add"))}</button>
      <button type="button" class="vk-regenerate vk-add-btn">${escapeHtml(t("shell.criteria.regenerate"))}</button>
    </div>`;
}

/**
 * #896 S3c: storage-shape criteria record → editor state.
 *
 * Lifted out of `enterPreviewEditMode`, where it closed over `editingLocale`. The locale is now a
 * parameter because the editor is moving to Innstillinger, which has no editing locale of its own
 * — it reads in the UI language. Same function, two callers, one behaviour.
 */
function buildEditorStateFromCriteriaRecord(source, locale) {
  if (!source || typeof source !== "object") return [];
  return Object.entries(source).map(([id, raw]) => {
    const c = raw && typeof raw === "object" ? raw : {};
    // v1.1.78: for sparse legacy criteria with only `weight` (no maxScore), derive
    // maxScore from weight × 10 so the slider opens at a meaningful position.
    const derivedFromWeight = Number(c.weight) > 0 ? Math.max(1, Math.round(Number(c.weight) * 10)) : 0;
    const initialMaxScore = Number(c.maxScore) > 0
      ? Number(c.maxScore)
      : (derivedFromWeight > 0 ? derivedFromWeight : 5);
    // v1.2.10: c.label/c.description kan være string ELLER locale-objekt.
    // #902: read in the locale being edited — reading in the UI language put English criteria
    // beside Norwegian scenario text, and what was typed was written back as the edited language.
    const rawLabel = localizeValueForLocale(c.label, locale);
    const rawDesc = localizeValueForLocale(c.description, locale);
    return {
      id: String(id),
      label: typeof rawLabel === "string" && rawLabel.trim() ? rawLabel : humaniseCriterionId(String(id)),
      description: typeof rawDesc === "string" ? rawDesc : "",
      maxScore: Math.max(1, Math.min(10, initialMaxScore)),
      candidateVisible: Boolean(c.candidateVisible),
      // #902: the editor shows ONE language, but the stored value may hold three. Carry the whole
      // stored value and the locale it is being edited in, so the save can merge instead of
      // replacing — writing back a bare string deleted the two languages never shown.
      storedLabel: c.label ?? null,
      storedDescription: c.description ?? null,
      locale,
    };
  });
}

/**
 * #896 S3c: the criteria editor's event behaviour, extracted so it can be mounted anywhere.
 *
 * It was ~110 lines inlined in `enterPreviewEditMode`, closing over five local variables. The
 * caller now supplies the container and a state accessor pair; everything else — slider echo,
 * aria upkeep, add/remove/regenerate — is identical, because a second copy of this behaviour is
 * exactly what the epic is trying to get rid of.
 */
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
function captureLatestCriteriaState(container, fallbackState) {
  if (!container) return Array.isArray(fallbackState) ? fallbackState.slice() : [];
  const cards = container.querySelectorAll(".vk-card");
  if (cards.length === 0) return [];
  return Array.from(cards).map((card, idx) => {
    const fallback = (Array.isArray(fallbackState) && fallbackState[idx]) ? fallbackState[idx] : {};
    return {
      id: fallback.id,
      label: card.querySelector(".vk-label")?.value.trim() ?? "",
      description: card.querySelector(".vk-description")?.value.trim() ?? "",
      maxScore: Math.max(1, Math.min(10, Number(card.querySelector(".vk-weight")?.value) || 5)),
      candidateVisible: card.querySelector(".vk-visible")?.checked ?? false,
      // #902: the DOM holds one language; the other two live only on the state object. Rebuilding
      // the item from the cards alone would drop them again on the way to the save — which is
      // exactly how the bare-string write survived the first fix.
      storedLabel: fallback.storedLabel,
      storedDescription: fallback.storedDescription,
      locale: fallback.locale,
    };
  });
}

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
// hash so the drift banner hides. No version bump; criteria unchanged.
async function handleDriftKeep() {
  if (!selectedModuleId) return;
  const hash = currentBlueprintHash;
  if (!hash) return;
  try {
    await apiFetch(
      `/api/admin/content/modules/${encodeURIComponent(selectedModuleId)}/rubric-versions/sync-blueprint`,
      getHeaders,
      { method: "POST", body: JSON.stringify({ blueprintHash: hash }) },
    );
    // Patch bundle in place so we don't clobber unsaved sessionDraft via full reload.
    const sr = bundle?.selectedConfiguration?.rubricVersion?.scalingRule;
    if (sr && typeof sr === "object") sr.generated_from_blueprint_hash = hash;
    renderPreview();
    showToast(t("shell.drift.keep.success"), "success");
  } catch (err) {
    showToast(`${t("shell.drift.keep.error")}: ${String(err?.message ?? err)}`, "error");
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
      `${escapeHtml(t("shell.drift.regenerate.error"))}: ${escapeHtml(String(err?.message ?? err))}`,
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
      `${escapeHtml(t("shell.drift.diff.error"))}: ${escapeHtml(String(err?.message ?? err))}`,
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
  const diff = computeCriteriaDiff(existing, newCriteriaRecord);

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
function driftText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return localizeValueForLocale(value, contentLocale) ?? "";
}

function computeCriteriaDiff(existing, next) {
  const existingIds = new Set(Object.keys(existing ?? {}));
  const nextIds = new Set(Object.keys(next ?? {}));
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const id of nextIds) {
    if (!existingIds.has(id)) {
      added.push({ id, next: next[id] });
      continue;
    }
    const a = existing[id] ?? {};
    const b = next[id] ?? {};
    // QA round 5: proposals are locale objects now, and `String({...})` is "[object Object]" for
    // every one of them — so two different proposals compared EQUAL and a text-only change was
    // filed as unchanged, which "accept selected" then left out. Compare the language on screen.
    const labelChanged = driftText(a.label) !== driftText(b.label);
    const descChanged = driftText(a.description) !== driftText(b.description);
    const scoreChanged = Number(a.maxScore ?? 0) !== Number(b.maxScore ?? 0);
    const visChanged = Boolean(a.candidateVisible) !== Boolean(b.candidateVisible);
    if (labelChanged || descChanged || scoreChanged || visChanged) {
      changed.push({ id, prev: a, next: b, fields: { labelChanged, descChanged, scoreChanged, visChanged } });
    } else {
      unchanged.push({ id, prev: a, next: b });
    }
  }
  for (const id of existingIds) {
    if (!nextIds.has(id)) {
      removed.push({ id, prev: existing[id] });
    }
  }
  return { added, removed, changed, unchanged };
}

function hasManuallyEditedCriteria() {
  const criteria = bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
  return Object.values(criteria).some((c) => c && typeof c === "object" && c.manuallyEdited === true);
}

// #455: external-LLM import modal. Lets the author paste the JSON an external LLM produced
// (after copying our authoring prompt), or upload a .json file. On Importer, parses the
// JSON, creates a new module, populates sessionDraft, and lands the author in draft-ready.
// Reuses the focus-trap / ESC pattern from openDriftDiffModal — they should stay in sync.
function openExternalLlmModal({ scenarioMode = "auto", onImportSuccess } = {}) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = document.createElement("div");
  overlay.className = "drift-diff-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "externalLlmTitle");
  overlay.innerHTML = `
    <div class="drift-diff-modal external-llm-modal">
      <header class="drift-diff-modal-header">
        <h2 id="externalLlmTitle">${escapeHtml(t("shell.externalLlm.title"))}</h2>
        <button type="button" class="drift-diff-close" data-ext-action="close" aria-label="${escapeHtml(t("shell.externalLlm.close"))}">×</button>
      </header>
      <ol class="external-llm-steps">
        <li>${escapeHtml(t("shell.externalLlm.step1"))}</li>
        <li>${escapeHtml(t("shell.externalLlm.step2"))}</li>
        <li>${escapeHtml(t("shell.externalLlm.step3"))}</li>
      </ol>
      <div class="external-llm-prompt-actions">
        <button type="button" class="btn-secondary" data-ext-action="copy-prompt">${escapeHtml(t("shell.externalLlm.copyPromptAgain"))}</button>
        <button type="button" class="btn-secondary" data-ext-action="upload-json">${escapeHtml(t("shell.externalLlm.uploadJson"))}</button>
        <input type="file" accept="application/json,.json" hidden data-ext-input="file">
      </div>
      <label class="external-llm-json-label" for="externalLlmJsonInput">${escapeHtml(t("shell.externalLlm.jsonLabel"))}</label>
      <textarea id="externalLlmJsonInput" class="chat-textarea external-llm-json" rows="10" placeholder="${escapeHtml(t("shell.externalLlm.jsonPlaceholder"))}" data-ext-input="textarea"></textarea>
      <p class="external-llm-error" data-ext-output="error" role="alert" hidden></p>
      <footer class="drift-diff-modal-footer">
        <button type="button" class="btn-secondary" data-ext-action="cancel">${escapeHtml(t("shell.externalLlm.cancel"))}</button>
        <button type="button" class="btn-primary" data-ext-action="import">${escapeHtml(t("shell.externalLlm.import"))}</button>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);

  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const getFocusables = () => Array.from(overlay.querySelectorAll(focusableSelector))
    .filter((el) => !el.hasAttribute("disabled") && !el.hasAttribute("hidden") && el.offsetParent !== null);

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
    opener?.focus?.();
  };

  const textarea = overlay.querySelector('[data-ext-input="textarea"]');
  const fileInput = overlay.querySelector('[data-ext-input="file"]');
  const errorEl = overlay.querySelector('[data-ext-output="error"]');
  const importBtn = overlay.querySelector('[data-ext-action="import"]');

  const setError = (message) => {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    } else {
      errorEl.hidden = false;
      errorEl.textContent = message;
    }
  };

  overlay.querySelector('[data-ext-action="close"]').addEventListener("click", close);
  overlay.querySelector('[data-ext-action="cancel"]').addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  overlay.querySelector('[data-ext-action="copy-prompt"]').addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildExternalLlmAuthoringPrompt(scenarioMode));
      showToast(t("shell.source.externalLlm.copied"), "success");
    } catch {
      showToast(t("shell.source.externalLlm.copyFailed"), "error");
    }
  });

  overlay.querySelector('[data-ext-action="upload-json"]').addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      textarea.value = text;
      setError("");
    } catch {
      setError(t("shell.externalLlm.fileReadError"));
    } finally {
      fileInput.value = "";
    }
  });

  importBtn.addEventListener("click", async () => {
    setError("");
    const raw = textarea.value;
    let parsed;
    try {
      parsed = parseExternalLlmJson(raw);
    } catch (err) {
      setError(err?.message ?? t("shell.externalLlm.parseError"));
      return;
    }
    importBtn.disabled = true;
    try {
      await applyExternalLlmJsonImport(parsed);
      onImportSuccess?.();
      close();
    } catch (err) {
      setError(err?.message ?? t("shell.externalLlm.importError"));
      importBtn.disabled = false;
    }
  });

  const initial = textarea ?? getFocusables()[0];
  initial?.focus?.();
}

// #455: take the parsed external-LLM JSON, create the module shell, populate sessionDraft,
// and land the author in draft-ready. Mirrors the new-module branch of confirmAndGenerate
// (line ~3759) without the LLM round-trips — the LLM work was done off-platform.
async function applyExternalLlmJsonImport(parsed) {
  // Wrap a plain-string title in a tri-locale object so it survives the module-create API
  // contract (title: localized object). Locale-object titles pass through unchanged.
  const moduleTitle = parsed.moduleTitle;
  const titleLocalized = typeof moduleTitle === "string"
    ? { nb: moduleTitle, nn: moduleTitle, "en-GB": moduleTitle }
    : moduleTitle;
  const certificationLevel = ["basic", "intermediate", "advanced"].includes(parsed.certificationLevel)
    ? parsed.certificationLevel
    : "intermediate";

  const slot = logProgress(() => {
    const previewTitle = typeof moduleTitle === "string"
      ? moduleTitle
      : (localizeValueForLocale(moduleTitle, currentLocale) || localizeValueForLocale(moduleTitle, "en-GB") || "");
    return `${t("shell.newModule.creating").replace(/…$/, "")} «${previewTitle}»…`;
  });
  slot.abortBtn.remove();

  let newModule;
  try {
    const body = await apiFetch(
      "/api/admin/content/modules",
      getHeaders,
      { method: "POST", body: JSON.stringify({ title: titleLocalized, certificationLevel }) },
    );
    newModule = body?.module ?? body;
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    logResolveSlot(
      slot,
      () => `${escapeHtml(t("shell.newModule.createError"))}<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(errMsg)}</span>`,
    );
    throw new Error(t("shell.externalLlm.importError"));
  }

  selectedModuleId = newModule?.id ?? newModule?.moduleId;
  const capturedId = selectedModuleId;
  const capturedTitle = typeof moduleTitle === "string"
    ? moduleTitle
    : (localizeValueForLocale(moduleTitle, currentLocale) || localizeValueForLocale(moduleTitle, "en-GB") || "");
  logResolveSlot(slot, () =>
    `${escapeHtml(t("shell.newModule.created"))} <strong>${escapeHtml(capturedTitle)}</strong>` +
    `<br><span style="font-size:13px;color:var(--color-meta)">ID: ${escapeHtml(capturedId)}</span>`,
  );

  // Build sessionDraft from imported content. buildPreviewCandidate accepts string OR
  // locale-object values for any localizable field, so we pass parsed values through.
  // Criteria, if provided, become an explicit override that saveDraftBundleInBackground
  // POSTs as a new RubricVersion (the B2 explicit-criteria branch, not ensure-rubric).
  sessionDraft = buildPreviewCandidate({
    title: titleLocalized,
    taskText: parsed.taskText,
    assessorExpectedContent: parsed.assessorExpectedContent,
    candidateTaskConstraints: parsed.candidateTaskConstraints,
    mcqQuestions: parsed.mcqQuestions,
  });
  if (parsed.criteria && Object.keys(parsed.criteria).length > 0) {
    sessionDraft = { ...sessionDraft, criteria: parsed.criteria };
  }
  previewDraft = null;
  sessionState = "draft-pending";
  // Third creation path: an imported external-LLM draft is a new module too, and Innstillinger
  // needs the bundle or it shows "load a module".
  await attachBundleForNewModule(selectedModuleId);
  renderPreviewLocaleBar();
  renderPreview();

  logBot(() => `<strong>${escapeHtml(t("shell.externalLlm.imported"))}</strong>
    <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.externalLlm.importedHint"))}</p>`);
  showDraftReadyActions();
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
  overlay.innerHTML = buildDriftDiffModalHtml(diff);
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
    await persistMergedRubric(proposedRecord);
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

function buildDriftDiffModalHtml(diff) {
  const { added, removed, changed } = diff;
  const totalChanges = added.length + removed.length + changed.length;

  const renderRow = (id, kind, body) => `
    <li class="drift-diff-row drift-diff-row--${kind}">
      <label>
        <input type="checkbox" data-diff-checkbox data-criterion-id="${escapeHtml(id)}" checked>
        <span class="drift-diff-row-body">${body}</span>
      </label>
    </li>
  `;

  const addedHtml = added.map(({ id, next }) => renderRow(id, "added", `
    <span class="drift-diff-row-tag drift-diff-row-tag--added">${escapeHtml(t("shell.drift.diff.added"))}</span>
    <strong>${escapeHtml(driftText(next?.label) || id)}</strong>
    ${driftText(next?.description) ? `<p class="drift-diff-row-desc">${escapeHtml(driftText(next.description))}</p>` : ""}
  `)).join("");

  const removedHtml = removed.map(({ id, prev }) => renderRow(id, "removed", `
    <span class="drift-diff-row-tag drift-diff-row-tag--removed">${escapeHtml(t("shell.drift.diff.removed"))}</span>
    <strong>${escapeHtml(driftText(prev?.label) || id)}</strong>
    ${driftText(prev?.description) ? `<p class="drift-diff-row-desc">${escapeHtml(driftText(prev.description))}</p>` : ""}
  `)).join("");

  const changedHtml = changed.map(({ id, prev, next, fields }) => {
    const parts = [];
    if (fields.labelChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.label"))}:</em> <s>${escapeHtml(driftText(prev?.label))}</s> → <strong>${escapeHtml(driftText(next?.label))}</strong></p>`);
    if (fields.descChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.description"))}:</em> ${escapeHtml(driftText(next?.description))}</p>`);
    if (fields.scoreChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.maxScore"))}:</em> ${escapeHtml(String(prev?.maxScore ?? ""))} → ${escapeHtml(String(next?.maxScore ?? ""))}</p>`);
    if (fields.visChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.candidateVisible"))}:</em> ${Boolean(prev?.candidateVisible) ? "✓" : "—"} → ${Boolean(next?.candidateVisible) ? "✓" : "—"}</p>`);
    return renderRow(id, "changed", `
      <span class="drift-diff-row-tag drift-diff-row-tag--changed">${escapeHtml(t("shell.drift.diff.changed"))}</span>
      <strong>${escapeHtml(driftText(next?.label) || id)}</strong>
      ${parts.join("")}
    `);
  }).join("");

  const emptyHtml = totalChanges === 0
    ? `<p class="drift-diff-empty">${escapeHtml(t("shell.drift.diff.noChanges"))}</p>`
    : "";

  return `
    <div class="drift-diff-modal">
      <header class="drift-diff-modal-header">
        <h2 id="driftDiffTitle">${escapeHtml(t("shell.drift.diff.title"))}</h2>
        <button type="button" class="drift-diff-close" data-diff-action="close" aria-label="${escapeHtml(t("shell.drift.diff.close"))}">×</button>
      </header>
      <p class="drift-diff-modal-summary">${escapeHtml(tf("shell.drift.diff.summary", { added: added.length, removed: removed.length, changed: changed.length }))}</p>
      <ul class="drift-diff-list">
        ${addedHtml}
        ${changedHtml}
        ${removedHtml}
      </ul>
      ${emptyHtml}
      <footer class="drift-diff-modal-footer">
        <button type="button" class="btn-secondary" data-diff-action="cancel">${escapeHtml(t("shell.drift.diff.cancel"))}</button>
        <button type="button" class="btn-secondary" data-diff-action="accept-selected">${escapeHtml(t("shell.drift.diff.acceptSelected"))}</button>
        <button type="button" class="btn-primary" data-diff-action="accept-all">${escapeHtml(t("shell.drift.diff.acceptAll"))}</button>
      </footer>
    </div>
  `;
}

// B3 (#450): build the storage-shape record from "merge existing criteria with the proposed
// changes the user accepted". Logic per id:
//   - added id, accepted     → use proposed
//   - added id, not accepted → drop (not present in result)
//   - removed id, accepted   → drop (user accepted the removal)
//   - removed id, not accepted → keep existing
//   - changed id, accepted   → use proposed
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
    result[id] = acceptedIds.has(id) ? proposedRecord[id] : existing[id];
  }
  for (const { id } of diff.added) {
    if (acceptedIds.has(id)) result[id] = proposedRecord[id];
  }

  const totalMax = Object.values(result).reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
  for (const [id, c] of Object.entries(result)) {
    const maxScore = Number(c?.maxScore) || 0;
    result[id] = { ...c, weight: Number((maxScore / totalMax).toFixed(2)) };
  }
  return result;
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
      `${escapeHtml(t("shell.drift.diff.persistError"))}: ${escapeHtml(String(err?.message ?? err))}`,
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
    const errMsg = String(err?.message ?? err);
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
  const mcqHtml = currentMcqQuestions.length
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
              <div class="preview-mcq-question-header">${questionLabel}</div>
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
    <div class="preview-section-label">${labelCandidateConstraints}</div>
    <textarea id="previewEditCandidateTaskConstraints" class="preview-edit-textarea preview-edit-textarea--secondary"
      aria-label="${labelCandidateConstraints}">${escapedCandidateConstraints}</textarea>
    <div class="preview-section-label">${labelGuidance}</div>
    <textarea id="previewEditGuidanceText" class="preview-edit-textarea preview-edit-textarea--secondary"
      aria-label="${labelGuidance}">${escapedGuidance}</textarea>`;

  previewContent.innerHTML = `
    <div class="preview-module-header">
      <input id="previewEditTitle" class="preview-edit-title" value="${escapedTitle}"
        aria-label="${escapeHtml(t("shell.directEdit.titlePlaceholder"))}" />
      <span class="module-status-badge draft">${escapeHtml(t("shell.directEdit.editingBadge"))}</span>
    </div>
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
    const newMcqQuestions = currentMcqQuestions.map((question, questionIndex) => {
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
    if (nothingChanged) {
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
      for (const btn of contentLocaleBar?.querySelectorAll("button") ?? []) btn.disabled = busy;
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
      if (pendingTabSwitchKind === "form") {
        pendingSaveCommit = () => commit(localized, localizedMcqQuestions, failedLocales);
        return;
      }
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
      clearPreviewCandidate();
      // A locale that failed to translate stays UNTRANSLATED rather than being filled with a
      // copy of the source text (#892). The hole is named here and blocks publishing in S4.
      const warning = failedLocales?.length
        ? ` ${tf("shell.revision.titleNotTranslated", {
            locales: failedLocales.join(", "),
            source: editingLocale,
          })}`
        : "";
      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.directEdit.saving"))}</strong>${escapeHtml(warning)}`);
      saveDraftBundleInBackground();
    };

    Promise.all([
      localizeDraftAcrossLocalesWithTitle(newTitle, newTaskText, newGuidanceText, editingLocale, newCandidateTaskConstraints),
      currentMcqQuestions.length ? localizeMcqAcrossLocales(newMcqQuestions, editingLocale) : Promise.resolve([]),
    ])
      .then(([localizedDraft, localizedMcqQuestions]) => {
        if (abort.signal.aborted) return;
        commit(localizedDraft, localizedMcqQuestions, localizedDraft.failedLocales);
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

  logBot(() => escapeHtml(t("shell.directEdit.editingHint")));
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
function renderWorkspaceActions(actions) {
  if (!workspaceActionsBar) return;
  workspaceActionsBar.innerHTML = "";
  const live = (actions ?? []).filter(Boolean);
  setHidden(workspaceActionsBar, live.length === 0);
  if (live.length === 0) return;

  for (const choice of live) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "workspace-action-btn";
    btn.textContent = resolveChoiceLabel(choice);
    btn.addEventListener("click", () => { choice.action?.(); });
    workspaceActionsBar.appendChild(btn);
  }
}

/** Nothing to act on — used when a module is unloaded or the flow takes over the conversation. */
function clearWorkspaceActions() {
  renderWorkspaceActions([]);
}

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
    generateContent: { labelKey: "shell.module.generateContent", action: () => startGenerateDraftFlow() },
    generateMcq: { labelKey: "shell.module.generateMcq", action: () => startGenerateMcqFlow() },
    resumeChatEdit: {
      labelKey: "shell.module.resumeChatEdit",
      action: () => {
        if (createSessionDraftFromLoadedModule()) {
          showDraftReadyActions();
        } else {
          showModuleActions();
        }
      },
    },
    saveDraft: { labelKey: "shell.draftReady.saveDraft", action: saveDraftBundleInBackground },
    publish: {
      // Direct publish — author already confirmed by clicking "Publish". The prior
      // double-confirm dialog was redundant friction. (2026-05-18 author feedback)
      labelKey: "shell.draftReady.publish",
      action: publishLatestDraftInBackground,
    },
    unpublish: {
      labelKey: "shell.module.unpublish",
      action: () => confirmHighImpactAction("shell.unpublish.confirmPrompt", "shell.unpublish.confirmAction", unpublishModuleInBackground, showModuleActions, { module: moduleLabel }),
    },
  };
  const actions = model.actionKeys.map((key) => actionMap[key]).filter(Boolean);
  // #896 S6: export/import belong on Rediger, per the IA table. They lived only on the module list
  // and in Avansert, so moving content between installations meant leaving the workspace you were
  // working in. Appended rather than folded into `actionKeys` because they are not part of the
  // authoring progression the status model describes — they are available whenever a module is.
  if (selectedModuleId) {
    actions.push(
      { labelKey: "shell.module.exportPackage", action: () => exportModulePackageInBackground() },
      { labelKey: "shell.module.importPackage", action: () => startImportPackageFlow() },
    );
  }
  renderWorkspaceActions(actions);
  if (model.shouldOfferUnifiedRevision) {
    startUnifiedRevisionFlow();
  }
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

    const title = localizeValueForLocale(bundle?.module?.title ?? "module", currentLocale);
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
    const errMsg = String(err?.message ?? err);
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
  if ((sessionDraft || hasUnsavedSettingsEdits()) && !window.confirm(t("shell.module.importConfirmDiscardDraft"))) {
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
    const errMsg = String(err?.message ?? err);
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
const TAB_ORDER = ["preview", "edit", "settings"];
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
let pendingTabSwitch = null;
let pendingTabSwitchKind = null;
// A save whose translation resolved while the discard dialog was open. Held rather than
// committed OR thrown away, because the author has not answered yet: "Bli vaerende" must
// finish the save they asked for, "Forkast" must drop it.
let pendingSaveCommit = null;

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
    if (el.value !== el.dataset.renderedValue) return true;
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
 * Record what every edit-form field was drawn with, so `hasOpenEditForm` can tell a typed value
 * from an untouched one. Checkboxes carry their state as a string for the same comparison.
 */
function stampEditFormValues() {
  const fields = previewContent?.querySelectorAll(
    ".preview-edit-title, .preview-edit-input, .preview-edit-textarea, .vk-label, .vk-description, .vk-weight",
  ) ?? [];
  for (const el of fields) {
    el.dataset.renderedValue = el.value;
  }
}

// Same signal as the status rail's "Ulagrede endringer": if the rail calls it unsaved, a
// tab switch says so too. The two cost different things, so the dialog says which:
// an open form's field values are LOST, while a draft is kept but stays unsaved.
function unsavedTabSwitchKind() {
  if (hasOpenEditForm()) return "form";
  // While a draft exists, a criteria edit is not unsaved work that a tab switch would destroy —
  // it is absorbed into the draft here, which is what makes it survive to the draft save. Doing
  // this before the check also stops the warning from claiming the edit is about to be lost when
  // it is not; a warning the author knows is wrong is a warning they learn to click through.
  syncSettingsCriteriaToDraft();
  // #896 S6 QA: settings BEFORE the draft, deliberately. The Innstillinger inputs are DOM-only
  // until Lagre and are destroyed by the re-render; a draft survives the switch. When both are
  // dirty, checking the draft first showed the reassuring "your draft is kept" message while the
  // settings were quietly thrown away — the most misleading of the three outcomes.
  if (hasUnsavedSettingsEdits()) return "settings";
  if (sessionDraft) return "draft";
  return null;
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
  const button = tabButtons[tab];
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
  const button = tabButtons[tab];
  if (!button) return;
  delete button.dataset.attention;
  applyTabAttentionLabel(tab);
}

// The tab's accessible name is its own label plus, when marked, the reason. Rebuilt from the
// label each time rather than appended to, so repeated marking cannot stack the suffix.
function applyTabAttentionLabel(tab) {
  const button = tabButtons[tab];
  if (!button) return;
  const base = t(`shell.tab.${tab}`);
  if (tabAttention.has(tab)) button.setAttribute("aria-label", `${base} (${t("shell.tab.attention.suffix")})`);
  else button.removeAttribute("aria-label");
}

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
  if (activeTab === "settings" && tab !== "settings") syncSettingsCriteriaToDraft();
  activeTab = tab;
  for (const [name, button] of Object.entries(tabButtons)) {
    if (!button) continue;
    const selected = name === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
    // Roving tabindex: a tablist is ONE tab stop, and the arrow keys move within it.
    button.tabIndex = selected ? 0 : -1;
  }
  // setHidden, not the .hidden class: workspace-shell sets display:grid and the panels
  // are .card (display:block), so a class-based toggle loses the cascade (CLAUDE.md).
  setHidden(tabPanelModule, tab === "settings");
  setHidden(tabPanelSettings, tab !== "settings");
  const chatPane = document.querySelector(".chat-pane");
  setHidden(chatPane, tab === "preview");
  tabPanelModule?.classList.toggle("workspace-shell--preview-only", tab === "preview");
  // Forhaandsvisning and Rediger share this panel, so point it at whichever tab owns it now.
  if (tab !== "settings") tabPanelModule?.setAttribute("aria-labelledby", tabButtons[tab]?.id ?? "tabEdit");
  // Safe here: an open edit form is torn down before any switch away from Rediger, so this
  // cannot discard typed values. No bundle guard - a new module has a draft and no bundle,
  // and its preview needs the audience swap just as much.
  if (audienceChanges) renderPreview();
  // Rendered on entry rather than kept in sync: the panel is a read-out of the loaded
  // bundle, and the bundle cannot change while Innstillinger is the visible tab.
  if (tab === "settings") renderSettingsPanel();
  // Stage-tilbakemelding 2026-08-18: the special-category warning belongs where the assignment
  // text is WRITTEN. On Forhåndsvisning and Innstillinger there is nothing to reword, so it is
  // noise — and a warning that shows everywhere stops being read where it matters.
  setHidden(privacyNotice, tab !== "edit");

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

function switchToTab(tab) {
  if (tab === activeTab) return;
  // Gate on the tab being LEFT. Rediger holds the editing surface; Innstillinger holds inputs that
  // exist only in the DOM until Lagre and are re-rendered from `bundle` on the way back — leaving
  // it without asking simply threw typed values away. Forhaandsvisning risks nothing.
  const kind = activeTab === "edit" || activeTab === "settings" ? unsavedTabSwitchKind() : null;
  if (kind && unsavedTabSwitchDialog) {
    pendingTabSwitch = tab;
    pendingTabSwitchKind = kind;
    const body = document.getElementById("unsavedTabSwitchBody");
    const confirmBtn = document.getElementById("tabSwitchDiscard");
    const bodyKey = kind === "form"
      ? "shell.tab.unsaved.body"
      : kind === "settings"
        ? "shell.tab.unsaved.settingsBody"
        : "shell.tab.unsaved.draftBody";
    if (body) body.textContent = t(bodyKey);
    if (confirmBtn) {
      // Leaving Innstillinger DOES destroy the typed values, so that confirm is destructive —
      // unlike an unsaved draft, which survives the switch.
      confirmBtn.textContent = t(kind === "draft" ? "shell.tab.unsaved.switchAnyway" : "shell.tab.unsaved.discard");
      confirmBtn.className = kind === "draft" ? "btn-primary" : "btn-danger";
    }
    unsavedTabSwitchDialog.showModal();
    return;
  }
  applyTabState(tab);
  syncTabToUrl(tab);
  if (tab === "settings") scrollPreviewToTop();
}

// ---------------------------------------------------------------------------
// #896 S3a: the Innstillinger read-out.
//
// Every value here already sits in the bundle the shell loaded — this reads, it never
// writes. Editing still hands off to the Avansert page until S3b wires each row up, which
// is a deliberate split: the settings surface is worth having in the new IA before the
// write paths follow, and a read-only panel cannot corrupt a module.
// ---------------------------------------------------------------------------

function renderSettingsPanel() {
  const host = document.getElementById("settingsSummary");
  if (!host) return;

  if (!bundle) {
    host.innerHTML = `<p class="settings-empty">${escapeHtml(t("shell.settings.noModule"))}</p>`;
    return;
  }

  const cfg = bundle.selectedConfiguration ?? {};
  const version = cfg.moduleVersion ?? null;
  const mod = bundle.module ?? {};
  const policy = version?.assessmentPolicy ?? null;
  const criteria = cfg.rubricVersion?.criteria ?? null;

  // The type the panel is DRAWING for: whatever is selected in the dropdown right now, falling
  // back to what is stored. #896 S3c: it read only the stored one, so picking "Bare flervalg" left
  // the criteria and instruction editors standing — editors the save then refuses to carry. The
  // panel has to show the consequences of the choice at the moment it is made, not after Lagre.
  const mode = settingsSelectedMode();
  const modeLabel = t(`shell.settings.mode.${mode}`);

  // #896 S3c: eleven rows in one undifferentiated list, with three full editors bolted on after
  // it, told the author nothing about what belongs together. Four groups: what the module IS, how
  // it is ASSESSED, what the participant SUBMITS, and the history — which is a log, not a setting,
  // and therefore sits on the far side of Lagre.
  //
  // `group()` opens a bucket; `row()` fills the open one. Rendering happens once at the end, so
  // the order of the groups on screen is the order they are opened here.
  const groups = new Map();
  let openGroup = null;
  const group = (labelKey) => {
    openGroup = [];
    groups.set(labelKey, openGroup);
  };
  // Stage-tilbakemelding 2026-08-17: poengreglene sier ikke hva de gjør. Forklaringen ligger bak
  // et i-ikon, åpnet med KLIKK — hover finnes ikke på nettbrett og kan ikke nås med tastatur.
  // Ingen innebygde hjelpetekster: forfatteren ba om den kompakte varianten.
  const row = (labelKey, valueHtml, isEmpty = false, infoKey = null) => {
    const info = infoKey
      ? ` <button type="button" class="settings-info" data-info="${escapeHtml(infoKey)}"
          aria-label="${escapeHtml(tf("shell.settings.infoAria", { field: t(labelKey) }))}"
          aria-expanded="false">i</button>`
      : "";
    openGroup.push(`<dt>${escapeHtml(t(labelKey))}${info}</dt><dd${isEmpty ? ' class="settings-empty"' : ""}>${valueHtml}</dd>`);
  };
  const emptyText = escapeHtml(t("shell.settings.notSet"));
  // #896 S3c: Innstillinger reads in the UI language, not the preview language. The summary rows
  // used localizeValue (preview locale) while the editors use currentLocale, so with the UI in
  // Norwegian and the preview in English the criteria summary showed English while "Endre
  // kriterier" opened the Norwegian values and said it was editing nb. One language per surface.
  const settingsValue = (value) => localizeValueForLocale(value, contentLocale);

  // #896 S3b: module type is editable, and first, as the issue specifies — it decides which
  // fields Rediger even shows. Only the types this module has the components for are offered;
  // the rest are disabled with the reason, rather than allowed and then rejected by the API.
  // Availability comes from the module's HISTORY, not from what the current version happens to
  // point at. Switching to MCQ-only writes a version without rubric or prompt pointers — reading
  // availability off that version would then disable every free-text mode and strand the module
  // in the type it was last saved as. The components still exist; the version simply stopped
  // referencing them, which is exactly what makes switching back possible.
  const rubricHistory = bundle.versions?.rubricVersions ?? [];
  const promptHistory = bundle.versions?.promptTemplateVersions ?? [];
  const mcqHistory = bundle.versions?.mcqSetVersions ?? [];
  const taskHistory = (bundle.versions?.moduleVersions ?? []).find((v) => !!settingsValue(v?.taskText));

  const hasRubric = rubricHistory.length > 0 || !!cfg.rubricVersion;
  const hasPrompt = promptHistory.length > 0 || !!cfg.promptTemplateVersion;
  const hasMcq = mcqHistory.length > 0 || !!cfg.mcqSetVersion;
  const hasTask = !!settingsValue(version?.taskText) || !!taskHistory;
  const freetextReady = hasTask && hasRubric && hasPrompt;

  const modeOptions = [
    { value: "FREETEXT_PLUS_MCQ", ok: freetextReady && hasMcq, missingKey: "shell.settings.needsBoth" },
    { value: "FREETEXT_ONLY", ok: freetextReady, missingKey: "shell.settings.needsFreetext" },
    { value: "MCQ_ONLY", ok: hasMcq, missingKey: "shell.settings.needsMcq" },
  ];
  const optionsHtml = modeOptions
    .map(({ value, ok, missingKey }) => {
      const label = t(`shell.settings.mode.${value}`);
      const suffix = ok || value === mode ? "" : ` — ${t(missingKey)}`;
      const disabled = !ok && value !== mode ? " disabled" : "";
      const selected = value === mode ? " selected" : "";
      return `<option value="${value}"${disabled}${selected}>${escapeHtml(label + suffix)}</option>`;
    })
    .join("");
  group("shell.settings.groupModule");
  row(
    "shell.settings.moduleType",
    `<select id="settingsModuleType" class="settings-input">${optionsHtml}</select>`,
  );

  // #896 S3b: editable now that the composed save can write module-level fields. They were
  // create-only before — set once at creation and impossible to correct afterwards.
  //
  // A FIXED SCALE, not translatable text (produkteier 2026-08-17: "Nivå er ment som en fast skala
  // enkel→medium→vanskelig … dette er ikke noe som bør oversettes modul for modul"). The value is
  // one of three; the LABEL is translated at render, from `shell.certLevel.*`. A free-text input
  // let an author type anything into a field the generate endpoints validate as an enum.
  const certLevel = certificationLevelValue(mod.certificationLevel);
  const certOptions = [
    // "Not set" is offered only while nothing IS set. QA round 7: as a clearing action it sent
    // `certificationLevel: null`, and the composed-version schema takes a string or a record but
    // not null — a 400 every time. `description` right beside it in that schema is `.nullable()`
    // and can be cleared; this field is not, and making it so is a backend change that does not
    // belong in this diff. Better to not offer an action than to offer one that fails.
    ...(certLevel ? [] : [`<option value="" selected>${escapeHtml(t("shell.settings.notSet"))}</option>`]),
    ...CERTIFICATION_LEVELS.map((level) =>
      `<option value="${level}"${level === certLevel ? " selected" : ""}>${escapeHtml(t(`shell.certLevel.${level}`))}</option>`),
    // Existing data may hold something outside the scale — older modules were told "plain text,
    // e.g. foundation", and imports carry whatever they carry. Offer it back verbatim rather than
    // silently rewriting it to a neighbouring level the author never chose.
    ...(certLevel && !CERTIFICATION_LEVELS.includes(certLevel)
      ? [`<option value="${escapeHtml(certLevel)}" selected>${escapeHtml(certLevel)}</option>`]
      : []),
  ].join("");
  row(
    "shell.settings.certificationLevel",
    `<select id="settingsCertLevel" class="settings-input">${certOptions}</select>`,
  );

  // date inputs need yyyy-mm-dd, not a localized rendering
  const asDateValue = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  row(
    "shell.settings.validity",
    `<input id="settingsValidFrom" class="settings-input" type="date" value="${escapeHtml(asDateValue(mod.validFrom))}" />
     <span aria-hidden="true">→</span>
     <input id="settingsValidTo" class="settings-input" type="date" value="${escapeHtml(asDateValue(mod.validTo))}" />`,
  );

  group("shell.settings.groupAssessment");
  const mcqMinPercent = policy?.passRules?.mcqMinPercent;
  if (mode !== "FREETEXT_ONLY") {
    row(
      "shell.settings.mcqThreshold",
      // QA round 7: this used to show 70 when nothing was stored, and the save copied whatever was
      // on screen into `passRules` — so changing a validity date on a module with no policy at all
      // silently gave it an MCQ pass mark of 70. A candidate with a good total but 69 % on the
      // multiple choice would then fail a module that had no such rule the day before.
      //
      // Blank means "not set", exactly like the other three pass rules. That consistency is the
      // point of the redesign; this field was the one left behaving differently.
      `<input id="settingsMcqMinPercent" class="settings-input" type="number" min="0" max="100"
        value="${Number.isFinite(mcqMinPercent) ? escapeHtml(String(mcqMinPercent)) : ""}"
        placeholder="${escapeHtml(t("shell.settings.noLimit"))}" /> %`,
      false,
      "mcqThreshold",
    );
  }

  // #896 S3c: the rest of the pass rules. Only mcqMinPercent was editable, so an author who wanted
  // to change the overall pass mark still had to go to Avansert — which makes "ett sted å gjøre
  // hver ting" untrue for the very field most likely to be adjusted after a calibration round.
  //
  // Blank means "not set": decisionService falls back to the platform rules, and writing a number
  // in would turn a deliberate default into a per-module override nobody chose.
  //
  // Stage-tilbakemelding 2026-08-17 avdekket at "tomt = plattformstandard" bare gjelder EN av de
  // fire. decisionService.ts:101-132: totalMin faller tilbake på plattformverdien, mens de tre
  // andre er AV når de er tomme — ingen sperre i det hele tatt. Plassholderen sier derfor hva
  // tomt faktisk gjør for nettopp det feltet, i stedet for en felles forklaring som er usann for
  // tre av dem. Å fylle inn verdiene i stedet, som først foreslått, ville slått PÅ en sperre som
  // er av — akkurat feilen QA fant på MCQ-feltet.
  const numberRow = (labelKey, id, value, placeholderText, infoKey, suffix = " %", wide = false) =>
    row(
      labelKey,
      `<input id="${id}" class="settings-input${wide ? " settings-input--wide" : ""}" type="number" min="0" max="100"
        value="${Number.isFinite(Number(value)) && value !== null && value !== undefined ? escapeHtml(String(value)) : ""}"
        placeholder="${escapeHtml(placeholderText)}" />${suffix}`,
      false,
      infoKey,
    );
  // The one rule with a platform fallback: show the number it falls back TO, without storing it.
  const platformTotalMin = bundle?.platformDefaults?.totalMin;
  numberRow(
    "shell.settings.totalMin",
    "settingsTotalMin",
    policy?.passRules?.totalMin,
    Number.isFinite(platformTotalMin)
      ? tf("shell.settings.platformDefault", { value: platformTotalMin })
      : t("shell.settings.notSet"),
    "totalMin",
    " %",
    // The only field whose placeholder is a sentence rather than a word.
    true,
  );
  if (mode !== "MCQ_ONLY") {
    numberRow(
      "shell.settings.practicalMin",
      "settingsPracticalMin",
      policy?.passRules?.practicalMinPercent,
      t("shell.settings.noLimit"),
      "practicalMin",
    );
  }
  const borderline = policy?.passRules?.borderlineWindow;
  row(
    "shell.settings.borderlineWindow",
    `<input id="settingsBorderlineMin" class="settings-input" type="number" min="0" max="100"
      value="${Number.isFinite(Number(borderline?.min)) ? escapeHtml(String(borderline.min)) : ""}"
      placeholder="${escapeHtml(t("shell.settings.noneShort"))}" />
     <span aria-hidden="true">→</span>
     <input id="settingsBorderlineMax" class="settings-input" type="number" min="0" max="100"
      value="${Number.isFinite(Number(borderline?.max)) ? escapeHtml(String(borderline.max)) : ""}"
      placeholder="${escapeHtml(t("shell.settings.noneShort"))}" /> %`,
    false,
    "borderlineWindow",
  );

  // #896 S3c: NO summary rows for criteria, assessment instruction or submission schema.
  //
  // Each of them used to have a row here showing the value AND a section further down editing it.
  // Three duplications inside one panel — reported from stage as "vurderingskriteria ligger nå 4
  // steder". The editors below carry their own summary; the row was the redundant half.

  // #896 S3c: the scaling rule's practical weight — the last settings field that existed only on
  // Avansert. `max_total` is NOT editable: it is derived from the criteria and shown there, so an
  // input for it would be a second, conflicting way to set the same number.
  if (mode !== "MCQ_ONLY") {
    const practicalWeight = Number(cfg.rubricVersion?.scalingRule?.practical_weight);
    row(
      "shell.settings.practicalWeight",
      `<input id="settingsPracticalWeight" class="settings-input" type="number" min="0" max="100"
        value="${escapeHtml(String(Number.isFinite(practicalWeight) ? practicalWeight : 70))}" /> %`,
      false,
      "practicalWeight",
    );
  }

  // An unsaved draft and a settings save would fight over the same next version: the settings
  // save carries the PERSISTED content forward, so it would quietly drop whatever is in the
  // draft. Blocking with a reason beats a silent loss.
  const draftBlocks = !!sessionDraft;
  const actionHtml = draftBlocks
    ? `<p class="settings-empty">${escapeHtml(t("shell.settings.draftBlocks"))}</p>`
    : `<button type="button" id="settingsSave" class="btn-primary">${escapeHtml(t("shell.settings.save"))}</button>`;

  // A group with nothing in it is not rendered: MCQ_ONLY has no submission schema and no
  // criteria, and an empty heading reads as something that failed to load.
  const settingsGroup = (labelKey, ...parts) => {
    const body = parts.filter(Boolean).join("");
    if (!body.trim()) return "";
    return `<section class="settings-group" aria-labelledby="${labelKey.replace(/\./g, "-")}">
      <h3 id="${labelKey.replace(/\./g, "-")}" class="settings-group-title">${escapeHtml(t(labelKey))}</h3>
      ${body}
    </section>`;
  };
  const groupList = (labelKey) => {
    const items = groups.get(labelKey) ?? [];
    return items.length > 0 ? `<dl class="settings-list">${items.join("")}</dl>` : "";
  };

  // Lagre sits after every setting and before the history — the author reads down, edits, saves,
  // and only then looks at what came before. Putting it mid-panel made the fields below it look
  // like they belonged to something else.
  host.innerHTML = [
    settingsGroup("shell.settings.groupModule", groupList("shell.settings.groupModule")),
    settingsGroup(
      "shell.settings.groupAssessment",
      // Stage-tilbakemelding 2026-08-17: fem tall uten kontekst. Det uklare er ikke hva hvert felt
      // heter, men at grensene legges OPPÅ hverandre og at totalen vektes — det forklares én gang
      // her, ikke gjentatt i fem verktøytips. Feltdetaljene ligger bak i-ikonene.
      `<p class="settings-group-explainer">${escapeHtml(t("shell.settings.assessmentExplainer"))}</p>`,
      groupList("shell.settings.groupAssessment"),
      renderCriteriaSection(),
      renderPromptSection(),
    ),
    // Innsendingsskjema and Versjonshistorikk already carry their own headings, so they ARE the
    // group — wrapping them would print the same word twice. CSS gives those two headings the
    // same weight as the group titles above, which is what makes the four levels read as peers.
    renderSubmissionSchemaSection(),
    actionHtml,
    renderVersionHistory(),
  ].join("");
  mountCriteriaSection();
  mountPromptSection();
  mountSubmissionSchemaSection();

  // Stamp what was rendered, so hasUnsavedSettingsEdits can tell an edited field from an
  // untouched one. Without this, restoring silently discarded typed-but-unsaved settings.
  stampRenderedValues(SETTINGS_INPUT_IDS.panel);
  // #896 S3c: put back anything the author had typed but not saved. Expanding a section re-renders
  // the WHOLE panel, so opening the criteria editor after typing a new validity date silently
  // reverted the date. `renderedValue` above is the stored value; this restores the typed one on
  // top of it, so the dirty-check still knows the difference.
  restoreSettingsDraftValues();
  mountSettingsInfoButtons(host);

  // Changing the type changes which fields the save can carry, so the panel redraws to match.
  // Without this the author picked "Bare flervalg" and kept looking at a criteria editor whose
  // contents the save would refuse — the choice and its consequences on two different screens.
  document.getElementById("settingsModuleType")?.addEventListener("change", () => {
    captureSettingsDraftValues();
    // The criteria editor lives in the DOM until something reads it, and a re-render throws that
    // DOM away. Typing in a criterion and then changing the type would have lost the text —
    // including on the way BACK to a type that has criteria. Read it out first.
    if (settingsCriteriaState !== null) {
      settingsCriteriaState = captureLatestCriteriaState(
        document.getElementById("settingsCriteriaEditor"),
        settingsCriteriaState,
      );
    }
    renderSettingsPanel();
  });

  document.getElementById("settingsSave")?.addEventListener("click", (event) => {
    // Disabled on the first click, like the restore buttons. A double-click on a slow connection
    // sent two concurrent POSTs and produced either two identical versions or a confusing
    // conflict; the idempotency key inside handles the lost-response retry, which is a different
    // problem. Re-enabled on the failure paths, since success re-renders the panel.
    event.currentTarget.disabled = true;
    void saveSettingsInBackground();
  });
  host.querySelectorAll("[data-restore-version]").forEach((button) => {
    button.addEventListener("click", () => {
      // #896 S6 QA: a physical double-click produced two calls with two different Date.now() keys,
      // so idempotency could not help — either two versions, or the second failing on the unique
      // (moduleId, versionNo). Disabling every restore button on the first click is what makes
      // "exactly one new version" true from the author's side; the server key covers the
      // lost-response retry, which is a different problem.
      host.querySelectorAll("[data-restore-version]").forEach((other) => { other.disabled = true; });
      void restoreModuleVersionInBackground(button.dataset.restoreVersion);
    });
  });
}

/**
 * #896 S3c: replace ONE locale in a stored localized value, keeping the others.
 *
 * The composer writes `promptTemplate.systemPrompt` verbatim — it does not merge. So an editor that
 * edits one language has to do the merging itself, or the two languages it never showed are gone.
 * That exact mistake has been made three times in this epic (title #892, description and
 * certification level in S3b); this helper exists so it is made once and fixed once.
 */
function mergeLocaleInto(stored, locale, text) {
  const next = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === "string" && value.trim()) next[key] = value;
    }
  } else if (typeof stored === "string" && stored.trim()) {
    // A bare string is legacy content the server reads as nb (#896 S4).
    next[LEGACY_STRING_LOCALE] = stored;
  }
  if (typeof text === "string" && text.trim()) next[locale] = text;
  else delete next[locale];
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * #896 S3c: unsaved settings values survive a panel re-render.
 *
 * The panel is rebuilt from `bundle` every time a section is expanded or collapsed. Without this,
 * typing a validity date and then opening the criteria editor reverted the date — the author would
 * not necessarily notice, because their eyes were on the section they just opened.
 *
 * Captured before the rebuild, reapplied after. `renderedValue` still holds the STORED value, so
 * `hasUnsavedSettingsEdits` keeps working.
 */
/**
 * Every input in Innstillinger, grouped by the section that renders it.
 *
 * QA 2026-08-16 found the four pass-rule fields added in v2.18.9 missing from BOTH the draft
 * preservation and the dirty check: typing a new overall pass mark and then expanding the
 * assessment instruction silently reverted it, and leaving the tab warned about nothing. The
 * cause was that this id list existed in six places — a stamping loop per section, a dirty check
 * per section, and two panel-wide lists — so adding a field meant remembering all six. It is one
 * list now, and `stampRenderedValues` / `anyFieldDirty` are the only readers.
 */
const SETTINGS_INPUT_IDS = {
  // Rendered by renderSettingsPanel itself, so always present when the tab is open.
  panel: [
    "settingsModuleType", "settingsCertLevel", "settingsValidFrom", "settingsValidTo",
    "settingsMcqMinPercent", "settingsTotalMin", "settingsPracticalMin",
    "settingsBorderlineMin", "settingsBorderlineMax", "settingsPracticalWeight",
  ],
  // Inside collapsible sections: absent from the DOM until the author expands them.
  prompt: ["settingsPromptSystem", "settingsPromptUser", "settingsPromptExamples"],
  schema: ["settingsSchemaLabel", "settingsSchemaPlaceholder"],
};
const SETTINGS_TEXT_INPUT_IDS = [
  ...SETTINGS_INPUT_IDS.panel, ...SETTINGS_INPUT_IDS.prompt, ...SETTINGS_INPUT_IDS.schema,
];

/** Record what the DOM was rendered with, so an edit can be told from an untouched field. */
function stampRenderedValues(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.dataset.renderedValue = el.value;
  }
}

/** True when any of `ids` holds something other than what it was rendered with. */
function anyFieldDirty(ids) {
  return ids.some((id) => {
    const el = document.getElementById(id);
    return el && el.dataset.renderedValue !== undefined && el.value !== el.dataset.renderedValue;
  });
}

let settingsDraftValues = null;

// The Save button is disabled on click to stop a double-submit. Every path that returns without
// saving has to put it back, or the panel is dead until the next re-render.
function reenableSettingsSave() {
  const btn = document.getElementById("settingsSave");
  if (btn) btn.disabled = false;
}

function captureSettingsDraftValues() {
  // QA 2026-08-16 round 3: this REPLACED the cache with whatever was on screen, so an edit made in
  // a section that is now collapsed — and therefore absent from the DOM — was thrown away the
  // moment a sibling section was opened. Editing the instruction, folding it, opening the answer
  // field and unfolding the instruction again silently restored the stored text.
  //
  // Start from what is already cached and let the live DOM override it: a field that is present
  // is authoritative for itself, and one that is absent keeps whatever was last typed into it.
  const dirty = { ...(settingsDraftValues ?? {}) };
  for (const id of SETTINGS_TEXT_INPUT_IDS) {
    const el = document.getElementById(id);
    if (!el || el.dataset.renderedValue === undefined) continue;
    if (el.value !== el.dataset.renderedValue) dirty[id] = el.value;
    // Present and back to its stored value: the author undid the edit, so drop the stale entry
    // rather than resurrect it on the next render.
    else delete dirty[id];
  }
  settingsDraftValues = Object.keys(dirty).length > 0 ? dirty : null;
}

/**
 * The value of a settings field, whether or not its section is currently open.
 *
 * QA 2026-08-16 round 3: `promptDirty` and `schemaDirty` read only live DOM elements, so an edit
 * made and then folded away counted as no change at all — "ingen endringer" and no POST if it was
 * the only edit, or a save that wrote everything except it. Collapsing a section is not undoing it.
 */
function settingsFieldValue(id) {
  const el = document.getElementById(id);
  if (el) return el.value;
  return settingsDraftValues?.[id];
}

/** True when this ONE field differs from what was stored, counting a collapsed section. */
function fieldIsDirty(id) {
  const el = document.getElementById(id);
  if (el) return el.dataset.renderedValue !== undefined && el.value !== el.dataset.renderedValue;
  return settingsDraftValues?.[id] !== undefined;
}

/**
 * Merge an edited localized field, or hand back the stored value untouched.
 *
 * QA round 5: a section is saved as a unit, so editing the system instruction ran
 * `mergeLocaleInto` over the user template too. A stored bare string means "one language, not
 * translated yet" — merging an untouched one turned it into `{nb: "…", "en-GB": "…"}` with the
 * same text in both, asserting an English translation nobody wrote. Same rule the criteria editor
 * already follows: only what changed is rewritten.
 */
function mergeSettingsField(id, stored) {
  if (!fieldIsDirty(id)) return stored;
  return mergeLocaleInto(stored, contentLocale, settingsFieldValue(id) ?? "");
}

/** True when any of `ids` differs from its stored value, counting collapsed sections. */
function anyFieldDirtyIncludingCollapsed(ids) {
  return ids.some((id) => {
    const el = document.getElementById(id);
    if (el) return el.dataset.renderedValue !== undefined && el.value !== el.dataset.renderedValue;
    return settingsDraftValues?.[id] !== undefined;
  });
}

function restoreSettingsDraftValues() {
  if (!settingsDraftValues) return;
  for (const [id, value] of Object.entries(settingsDraftValues)) {
    const el = document.getElementById(id);
    // A field belonging to a collapsed section is simply not in the DOM; its value stays in
    // `settingsDraftValues` until the section is opened again.
    if (el) el.value = value;
  }
}

// #896 S3c: the criteria editor's state while Innstillinger is open. Module-level, because the
// panel re-renders on every settings change and a closure would lose the author's edits each time.
// `null` = not opened this visit; an array = opened, and whatever is in it is what will be saved.
let settingsCriteriaState = null;
// #896 S3c, forfatterbeslutning 2026-08-16: kriteriene står ALLTID åpne, så det finnes ingen
// sammenslått tilstand å holde styr på. Spesifikasjonens begrunnelse for å flytte dem hit var at
// de «endres sjelden etter at den er satt» — men i praksis varierer genererte moduler mye, så de
// er verdt et blikk hver gang man er innom. Instruks og svarfelt er fortsatt sammenslått: de er
// lange, og endres faktisk sjelden.

function settingsCriteriaSource() {
  return sessionDraft?.criteria ?? bundle?.selectedConfiguration?.rubricVersion?.criteria ?? null;
}

// The record the section opened with, so the save can tell an edit from a visit.
let settingsCriteriaBaseline = null;

// What sessionDraft.criteria held when the panel was opened, so "Forkast" can put it back.
// undefined = nothing captured yet; null = the draft had no criteria at all.
let settingsCriteriaDraftBaseline;

/**
 * #896 S3c: discard everything the Innstillinger panel is holding that is tied to one module.
 *
 * Five separate variables, cleared in one place because clearing four of five is the bug this
 * epic keeps producing. Called when a module is loaded (the state belongs to the previous one)
 * and after a settings save (what was typed is now what is stored).
 */
/**
 * Throw away unsaved settings work, on purpose, because the author said so.
 *
 * Distinct from `resetSettingsPanelState`, which runs when the panel's subject changes. This one
 * is the answer to "Forkast": the criteria editor AND the cache that holds folded-away fields.
 * Clearing only what is on screen left the folded edits to reappear later — the author was told
 * their changes were discarded and they were not.
 */
function discardSettingsEdits() {
  // QA round 6: criteria edits are absorbed into the session draft as they are made, so clearing
  // only the panel state left them in the draft — they came back and were saved, after the author
  // had confirmed "Forkast". Put the draft's criteria back to what they were when the panel was
  // opened, so discarding means the same thing for every field in it.
  if (sessionDraft && settingsCriteriaDraftBaseline !== undefined) {
    const restored = { ...sessionDraft };
    if (settingsCriteriaDraftBaseline === null) delete restored.criteria;
    else restored.criteria = settingsCriteriaDraftBaseline;
    sessionDraft = restored;
  }
  settingsCriteriaState = null;
  settingsCriteriaBaseline = null;
  settingsCriteriaDraftBaseline = undefined;
  settingsDraftValues = null;
}

function resetSettingsPanelState() {
  settingsCriteriaState = null;
  settingsCriteriaBaseline = null;
  // QA round 7: left behind, this belonged to the PREVIOUS module — and a later language switch
  // would write its criteria onto the new draft, or delete them when it was null.
  settingsCriteriaDraftBaseline = undefined;
  settingsPromptExpanded = false;
  settingsSchemaExpanded = false;
  settingsDraftValues = null;
}

function renderCriteriaSection() {
  if (!bundle) return "";
  // #665: MCQ-only modules have no rubric, so no criteria to show.
  if (settingsSelectedMode() === "MCQ_ONLY") return "";

  // Read the stored criteria the first time the panel renders them. Re-reading on every render
  // would discard edits, since the panel rebuilds whenever anything else in it changes.
  if (settingsCriteriaState === null) {
    settingsCriteriaState = buildEditorStateFromCriteriaRecord(settingsCriteriaSource(), contentLocale);
    settingsCriteriaBaseline = buildCriteriaRecordFromEditorState(settingsCriteriaState);
    settingsCriteriaDraftBaseline = sessionDraft?.criteria ?? null;
  }

  // Always open, and therefore no summary row above it: the editor IS the summary. A row listing
  // the criteria plus a section editing them was the duplication reported from stage.
  return `<section class="settings-criteria-section" aria-labelledby="settingsCriteriaHeading">
    <h3 id="settingsCriteriaHeading" class="settings-subsection-title">${
      escapeHtml(tf("shell.criteria.title", { count: settingsCriteriaState.length }))
    }</h3>
    <div id="settingsCriteriaEditor" class="settings-criteria-editor">${
      buildCriteriaEditorHtml(settingsCriteriaState, t, tf)
    }</div>
  </section>`;
}

/**
 * QA 2026-08-16: carry a criteria edit into the session draft while one exists.
 *
 * While there is an unsaved draft, Innstillinger has NO Lagre button — saving settings would
 * carry the persisted content forward and drop the draft, so it is deliberately blocked. But the
 * criteria editor still accepts edits, and they were written only to `settingsCriteriaState`.
 * Confirming the draft reads `sessionDraft.criteria`, so an author who generated a module and then
 * adjusted its criteria in Innstillinger saved the GENERATED criteria, silently, every time.
 *
 * `settingsCriteriaSource()` already prefers `sessionDraft.criteria` when reading; this is the
 * matching write. The baseline moves with it, because an edit that is safely in the draft is not
 * unsaved work and must not raise the exit warning.
 */
function syncSettingsCriteriaToDraft() {
  if (!sessionDraft || settingsCriteriaState === null) return;
  // Typing into a label never reaches `settingsCriteriaState` — only add/remove do — so the live
  // DOM is the truth here, exactly as it is on the settings-save path.
  const state = captureLatestCriteriaState(
    document.getElementById("settingsCriteriaEditor"),
    settingsCriteriaState,
  );
  const record = buildCriteriaRecordFromEditorState(state);
  if (!record) return;
  settingsCriteriaState = state;
  sessionDraft = { ...sessionDraft, criteria: record };
  // The baseline deliberately does NOT move. It answers one question — "has the author changed
  // anything since the panel opened?" — and moving it on every sync made the answer always "no",
  // which let background generation overwrite manual edits and let a language switch roll them
  // back (QA round 7, three findings from this one line).
}

function mountCriteriaSection() {
  const container = document.getElementById("settingsCriteriaEditor");
  if (!container) return;

  // Typing never reaches the editor state — only Add and Remove do — so `change` (which fires on
  // blur, including the blur caused by clicking a tab) is when a typed criterion becomes part of
  // the draft. No-op when there is no draft.
  container.addEventListener("change", () => { syncSettingsCriteriaToDraft(); });

  wireCriteriaEditor({
    container,
    getState: () => settingsCriteriaState ?? [],
    // NO sync here. QA 2026-08-16 round 3: `syncSettingsCriteriaToDraft` re-reads the DOM, and
    // `setState` runs BEFORE `rerender` has drawn the new cards — so Add read one card too few and
    // dropped the new criterion, Remove read the removed card back in, and regeneration replaced
    // the generated list with the old DOM while still reporting success. The sync belongs at the
    // exits (`unsavedTabSwitchKind`, `applyTabState`), where state and DOM agree.
    setState: (next) => { settingsCriteriaState = next; },
    rerender: () => {
      container.innerHTML = buildCriteriaEditorHtml(settingsCriteriaState ?? [], t, tf);
      // After the redraw, so the sync reads the cards that now exist. Add and Remove go through
      // here, and doing it from setState (round 3) read the DOM one redraw too early.
      syncSettingsCriteriaToDraft();
    },
    onRegenerate: () => regenerateCriteriaFromTask(container, (newList) => {
      settingsCriteriaState = newList;
      container.innerHTML = buildCriteriaEditorHtml(settingsCriteriaState, t, tf);
      // After the redraw, not before: the DOM is what the sync reads.
      syncSettingsCriteriaToDraft();
    }),
  });
}

// Criteria count as unsaved settings work, so every exit from Innstillinger warns about them too
// — the same three exits the tab, language and Avansert guards already cover.
/**
 * Wire the i-buttons beside the pass-rule labels.
 *
 * Stage-tilbakemelding 2026-08-17. Opened on CLICK, not hover: hover does not exist on a tablet
 * and cannot be reached from the keyboard, so a hover-only explanation is an explanation some
 * authors can never read. One popover open at a time; Escape and a click elsewhere close it.
 */
function mountSettingsInfoButtons(host) {
  // ONCE per host, not once per render. `renderSettingsPanel` replaces `host.innerHTML`, which
  // destroys child listeners — but `host` itself survives, so a listener attached here accumulates
  // one copy per render. Two copies made the popover open and close within the same click: the
  // first created it, the second read `aria-expanded="true"` and treated the click as "close".
  // Symptom was a button that did nothing at all.
  if (host.dataset.infoButtonsMounted === "1") return;
  host.dataset.infoButtonsMounted = "1";

  const close = () => {
    host.querySelectorAll(".settings-popover").forEach((p) => p.remove());
    host.querySelectorAll(".settings-info[aria-expanded='true']").forEach((b) => {
      b.setAttribute("aria-expanded", "false");
    });
  };

  host.addEventListener("click", (event) => {
    if (event.target.closest(".settings-popover")) return;
    const button = event.target.closest(".settings-info");
    const wasOpen = button?.getAttribute("aria-expanded") === "true";
    close();
    if (!button || wasOpen) return;

    const body = t(`shell.settings.info.${button.dataset.info}`);
    // A missing key resolves to the key itself; showing that to an author is worse than nothing.
    if (!body || body.startsWith("shell.settings.info.")) return;

    const popover = document.createElement("div");
    popover.className = "settings-popover";
    popover.setAttribute("role", "note");
    popover.textContent = body;
    button.setAttribute("aria-expanded", "true");
    button.insertAdjacentElement("afterend", popover);
  });

  host.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

/** Has the author changed the criteria since the panel opened? Independent of where they land. */
function settingsCriteriaEdited() {
  if (settingsCriteriaState === null) return false;
  const current = buildCriteriaRecordFromEditorState(
    captureLatestCriteriaState(document.getElementById("settingsCriteriaEditor"), settingsCriteriaState),
  );
  return JSON.stringify(current) !== JSON.stringify(settingsCriteriaBaseline);
}

/**
 * Is there criteria work a tab or language switch would DESTROY?
 *
 * Only when there is no session draft. With one, the edits are absorbed into it as they are made,
 * so the switch keeps them — and the dialog the author then sees says exactly that.
 */
function hasUnsavedCriteriaEdits() {
  return settingsCriteriaEdited() && !sessionDraft;
}

/**
 * #896 S3c: the assessment instruction (prompt) editor.
 *
 * One language at a time, per §7 — the workspace edits in the active UI language and the other two
 * are merged, not overwritten. Avansert shows three locale panes side by side; that is the model
 * this epic is moving away from.
 *
 * Examples stay a JSON textarea, exactly as on Avansert. They are an array of free-shaped objects
 * consumed by the LLM, and inventing a structured editor for them here would be a guess at a shape
 * nothing else in the system constrains.
 */
let settingsPromptExpanded = false;

function renderPromptSection() {
  if (!bundle) return "";
  // QA round 4: an MCQ-only version has no prompt, and the save omits the whole rubric/prompt
  // branch for it — but the editor was still drawn. Editing the instruction on an MCQ-only module
  // produced a new, identical version and a green confirmation, with the edit nowhere in the
  // payload and gone after reload. Same rule as the criteria editor: if the save cannot carry it,
  // do not offer it.
  if (settingsSelectedMode() === "MCQ_ONLY") return "";
  const prompt = bundle.selectedConfiguration?.promptTemplateVersion ?? null;
  const localeLabel = escapeHtml(tf("shell.settings.editingInLocale", { locale: contentLocale }));

  if (!settingsPromptExpanded) {
    return `<section class="settings-criteria-section">
      <div class="settings-criteria-head">
        <h3 class="settings-subsection-title">${escapeHtml(t("shell.settings.assessmentPrompt"))}</h3>
        <button type="button" id="settingsPromptToggle" class="btn-secondary settings-criteria-toggle"
          aria-expanded="false" aria-controls="settingsPromptEditor">${escapeHtml(t("shell.settings.promptEdit"))}</button>
      </div>
      <div id="settingsPromptEditor" hidden></div>
    </section>`;
  }

  const sys = escapeHtml(localizeValueForLocale(prompt?.systemPrompt ?? "", contentLocale));
  const user = escapeHtml(localizeValueForLocale(prompt?.userPromptTemplate ?? "", contentLocale));
  const examples = escapeHtml(JSON.stringify(prompt?.examples ?? [], null, 2));

  return `<section class="settings-criteria-section">
    <div class="settings-criteria-head">
      <h3 class="settings-subsection-title">${escapeHtml(t("shell.settings.assessmentPrompt"))}</h3>
      <button type="button" id="settingsPromptToggle" class="btn-secondary settings-criteria-toggle"
        aria-expanded="true" aria-controls="settingsPromptEditor">${escapeHtml(t("shell.settings.criteriaDone"))}</button>
    </div>
    <div id="settingsPromptEditor" class="settings-criteria-editor">
      <p class="settings-empty">${localeLabel}</p>
      <label class="settings-field-label" for="settingsPromptSystem">${escapeHtml(t("shell.settings.promptSystem"))}</label>
      <textarea id="settingsPromptSystem" class="settings-textarea" rows="4">${sys}</textarea>
      <label class="settings-field-label" for="settingsPromptUser">${escapeHtml(t("shell.settings.promptUser"))}</label>
      <textarea id="settingsPromptUser" class="settings-textarea" rows="4">${user}</textarea>
      <label class="settings-field-label" for="settingsPromptExamples">${escapeHtml(t("shell.settings.promptExamples"))}</label>
      <textarea id="settingsPromptExamples" class="settings-textarea settings-textarea--mono" rows="4">${examples}</textarea>
    </div>
  </section>`;
}

function mountPromptSection() {
  const toggle = document.getElementById("settingsPromptToggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    captureSettingsDraftValues();
    settingsPromptExpanded = !settingsPromptExpanded;
    renderSettingsPanel();
  });
  stampRenderedValues(SETTINGS_INPUT_IDS.prompt);
}

/**
 * #896 S3c: the submission schema — what the participant is asked to fill in.
 *
 * One field, per #901: the backend, the participant view and the assessment all support several,
 * but the admin UI clamps it to one and that limitation is tracked separately. Editing the first
 * field here rather than pretending the others do not exist: any extra fields are carried through
 * untouched, so a module authored via the API keeps them.
 */
let settingsSchemaExpanded = false;

function renderSubmissionSchemaSection() {
  if (!bundle) return "";
  const field = bundle.selectedConfiguration?.moduleVersion?.submissionSchema?.fields?.[0] ?? null;

  if (!settingsSchemaExpanded) {
    return `<section class="settings-criteria-section">
      <div class="settings-criteria-head">
        <h3 class="settings-group-title">${escapeHtml(t("shell.settings.submissionSchema"))}</h3>
        <button type="button" id="settingsSchemaToggle" class="btn-secondary settings-criteria-toggle"
          aria-expanded="false" aria-controls="settingsSchemaEditor">${escapeHtml(t("shell.settings.schemaEdit"))}</button>
      </div>
      <div id="settingsSchemaEditor" hidden></div>
    </section>`;
  }

  const label = escapeHtml(localizeValueForLocale(field?.label ?? "", contentLocale));
  const placeholder = escapeHtml(localizeValueForLocale(field?.placeholder ?? "", contentLocale));
  return `<section class="settings-criteria-section">
    <div class="settings-criteria-head">
      <h3 class="settings-group-title">${escapeHtml(t("shell.settings.submissionSchema"))}</h3>
      <button type="button" id="settingsSchemaToggle" class="btn-secondary settings-criteria-toggle"
        aria-expanded="true" aria-controls="settingsSchemaEditor">${escapeHtml(t("shell.settings.criteriaDone"))}</button>
    </div>
    <div id="settingsSchemaEditor" class="settings-criteria-editor">
      <p class="settings-empty">${escapeHtml(tf("shell.settings.editingInLocale", { locale: contentLocale }))}</p>
      <label class="settings-field-label" for="settingsSchemaLabel">${escapeHtml(t("shell.settings.schemaLabel"))}</label>
      <input id="settingsSchemaLabel" class="settings-input" type="text" value="${label}" />
      <label class="settings-field-label" for="settingsSchemaPlaceholder">${escapeHtml(t("shell.settings.schemaPlaceholder"))}</label>
      <input id="settingsSchemaPlaceholder" class="settings-input" type="text" value="${placeholder}" />
    </div>
  </section>`;
}

function mountSubmissionSchemaSection() {
  const toggle = document.getElementById("settingsSchemaToggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    captureSettingsDraftValues();
    settingsSchemaExpanded = !settingsSchemaExpanded;
    renderSettingsPanel();
  });
  stampRenderedValues(SETTINGS_INPUT_IDS.schema);
}

/**
 * #896 S5: the list of saved versions, and the way back to one of them.
 *
 * Every «Mellomlagring» already wrote a row — the data has been there since long before this UI.
 * What was missing was any way to SEE it, so "I liked the previous wording better" meant retyping
 * from memory.
 *
 * The current version has no restore button: restoring it would create an identical copy and
 * nothing else, which is a confusing way to spend a click.
 */
function renderVersionHistory() {
  const versions = [...(bundle?.versions?.moduleVersions ?? [])].sort(
    (a, b) => (b?.versionNo ?? 0) - (a?.versionNo ?? 0),
  );
  if (versions.length === 0) return "";

  const currentId = bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
  const activeId = bundle?.module?.activeVersionId ?? null;

  const items = versions.map((version) => {
    const isCurrent = version.id === currentId;
    const isLive = version.id === activeId;
    const badges = [
      isLive ? `<span class="version-badge live">${escapeHtml(t("shell.versions.live"))}</span>` : "",
      isCurrent && !isLive ? `<span class="version-badge current">${escapeHtml(t("shell.versions.current"))}</span>` : "",
    ].join("");
    const when = version.createdAt
      ? `<span class="version-when">${escapeHtml(formatDateTime(version.createdAt))}</span>`
      : "";
    // No restore button on the version already loaded — it would copy the module onto itself.
    // aria-label carries the version number: a screen-reader user tabbing a list of five
    // identically-named "Restore" buttons has no way to tell which one goes where.
    const action = isCurrent
      ? ""
      : `<button type="button" class="btn-secondary version-restore" data-restore-version="${escapeHtml(version.id)}"
          aria-label="${escapeHtml(tf("shell.versions.restoreVersionAria", { versionNo: version.versionNo }))}">${
          escapeHtml(t("shell.versions.restore"))
        }</button>`;
    return `<li class="version-item">
      <span class="version-no">${escapeHtml(tf("shell.versions.versionNo", { versionNo: version.versionNo }))}</span>
      ${when}${badges}${action}
    </li>`;
  });

  return `<section class="version-history" aria-labelledby="versionHistoryHeading">
    <h3 id="versionHistoryHeading" class="settings-group-title">${escapeHtml(t("shell.versions.heading"))}</h3>
    <p class="settings-empty">${escapeHtml(t("shell.versions.explainer"))}</p>
    <ul class="version-list">${items.join("")}</ul>
  </section>`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(currentLocale === "en-GB" ? "en-GB" : "nb-NO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * #896 S5: restore. The server copies the chosen version forward into a NEW version — history is
 * append-only, so this is undoable by restoring whatever came before it.
 */
async function restoreModuleVersionInBackground(sourceVersionId, idempotencyKey = null) {
  const moduleId = selectedModuleId;
  if (!moduleId || !sourceVersionId) return;

  // Unsaved work would be lost: the restore writes the next version from STORED content, so
  // whatever is only in the browser never reaches the database. That includes the settings inputs,
  // which are DOM-only until Lagre — `sessionDraft` says nothing about them.
  const losesWork = !!sessionDraft || hasUnsavedSettingsEdits();
  if (losesWork && !window.confirm(t("shell.versions.confirmDiscardDraft"))) return;

  // One key per restore ACTION, reused by the retry. Without it a lost response leaves the author
  // choosing between "retry and maybe get two versions" and "do not retry and maybe get none";
  // with it, the retry either finds the committed result or performs the restore once.
  const key = idempotencyKey ?? `restore-${moduleId}-${sourceVersionId}-${Date.now()}`;

  const slot = logProgress("shell.versions.restoreProgress");
  slot.abortBtn.remove();

  try {
    const result = await apiFetch(
      `/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions/${encodeURIComponent(sourceVersionId)}/restore`,
      getHeaders,
      { method: "POST", body: JSON.stringify({}), headers: { "Idempotency-Key": key } },
    );
    const restoredId = result?.moduleVersion?.id ?? null;
    latestSavedModuleVersionId = restoredId;
    sessionDraft = null;
    previewDraft = null;
    await loadModule(moduleId);
    // Restore is triggered from Innstillinger, but what the author wants to see afterwards is the
    // restored CONTENT — and the confirmation itself lands in the chat log, which that tab hides.
    switchToTab("edit");

    // loadModule swallows its own fetch errors, so reaching this line does NOT prove the workspace
    // is showing the restored version. Saying "restored" over the previous content would be the
    // worst of both: the change happened, and the screen argues otherwise.
    const shown = bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
    if (restoredId && shown !== restoredId) {
      logResolveSlot(slot, () => escapeHtml(t("shell.versions.restoreReloadFailed")), [
        { labelKey: "shell.action.retry", action: () => loadModule(moduleId) },
      ]);
      showToast(t("shell.versions.restoreReloadFailed"), "error");
      return;
    }

    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.versions.restoreSuccess"))}</strong>`);
    showToast(t("shell.versions.restoreSuccess"), "success");
    announceStatus(t("shell.versions.restoreSuccess"));
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    // The click disabled every restore button to stop a double-click. A success path reloads and
    // re-renders them; a failure has to put them back by hand, or the list is dead until reload.
    document.querySelectorAll("[data-restore-version]").forEach((button) => { button.disabled = false; });
    logResolveSlot(slot, () => `${escapeHtml(t("shell.versions.restoreError"))}${escapeHtml(errMsg)}`, [
      // Same key: a retry after a lost response must not create a second version.
      { labelKey: "shell.action.retry", action: () => restoreModuleVersionInBackground(sourceVersionId, key) },
    ]);
  }
}

// The settings inputs live only in the DOM until Lagre. Their rendered values are stamped on the
// elements so anything that reloads the module can tell whether it would be throwing away edits.
function hasUnsavedSettingsEdits() {
  // Every field in the panel — plus the ones inside COLLAPSED sections, which are not in the DOM
  // at all and whose typed values live only in `settingsDraftValues`.
  //
  // Only entries whose field is currently absent count from there. A field that is on screen is
  // judged by the DOM, because the snapshot is taken before a re-render and goes stale the moment
  // the author reverts the value by hand — trusting it would warn about an edit that is no longer
  // there, and a warning the author knows is wrong is a warning they learn to click through.
  const heldInCollapsedSection = Object.keys(settingsDraftValues ?? {}).some(
    (id) => document.getElementById(id) === null,
  );
  return anyFieldDirty(SETTINGS_TEXT_INPUT_IDS) || heldInCollapsedSection || hasUnsavedCriteriaEdits();
}

/**
 * #896 S3b: save the settings as a new module version.
 *
 * Everything not shown here is carried forward from the current version by reference, so the
 * save changes the setup and nothing else. Content belonging to a type that is being switched
 * away from is NOT deleted — it stays on the previous version, and switching back brings it
 * into view again. That is what "beholdes, ikke slettes" means in a versioned model.
 */
async function saveSettingsInBackground() {
  const moduleId = selectedModuleId;
  if (!moduleId || !bundle) return;

  const cfg = bundle.selectedConfiguration ?? {};
  const version = cfg.moduleVersion ?? null;
  const mode = document.getElementById("settingsModuleType")?.value ?? version?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
  const thresholdInput = document.getElementById("settingsMcqMinPercent");
  // No `?? SHELL_MCQ_ONLY_MIN_PERCENT` here: that fallback made the guard below unreachable, so an
  // out-of-range or fractional threshold was silently saved as 70 — the exact behaviour the guard
  // was written to prevent.
  const mcqMinPercent = thresholdInput ? parsePercentInRange(thresholdInput.value, 0, 100) : null;

  const isMcqOnly = mode === "MCQ_ONLY";
  const isFreetextOnly = mode === "FREETEXT_ONLY";

  // Blank is a legitimate value — "no per-module override" — and must not be treated as invalid.
  // Only a filled field that does not parse is the author's mistake to see.
  const thresholdBlank = !thresholdInput || thresholdInput.value.trim() === "";
  // An out-of-range threshold is the author's mistake to see, not something to quietly turn
  // into 70. parsePercentInRange returns null for 101, for 72.5 and for gibberish alike.
  if (thresholdInput && !thresholdBlank && !isFreetextOnly && mcqMinPercent === null) {
    showToast(t("shell.settings.invalidThreshold"), "error");
    thresholdInput.focus();
    reenableSettingsSave();
    return;
  }

  // Falling back to history: switching back to a type needs the components the CURRENT version
  // stopped pointing at. Newest first, matching how the bundle orders them.
  const latestRubricId = cfg.rubricVersion?.id ?? bundle.versions?.rubricVersions?.[0]?.id;
  const latestPromptId = cfg.promptTemplateVersion?.id ?? bundle.versions?.promptTemplateVersions?.[0]?.id;
  const latestMcqId = cfg.mcqSetVersion?.id ?? bundle.versions?.mcqSetVersions?.[0]?.id;
  const latestTaskVersion = version?.taskText
    ? version
    : (bundle.versions?.moduleVersions ?? []).find((v) => !!localizeValue(v?.taskText));

  // The policy is carried whole. Sending only the MCQ rule would drop totalMin, the practical
  // minimum and the borderline window — pass/fail rules the author never touched, silently
  // reverting to platform defaults on a mode change.
  const existingPolicy = version?.assessmentPolicy ?? null;
  const passRules = { ...(existingPolicy?.passRules ?? {}) };
  if (isFreetextOnly || (thresholdInput && thresholdBlank)) {
    // Blank clears the override, the same as the other three pass rules. Before this, a module
    // with no policy showed a placeholder 70 that the save wrote in for real.
    delete passRules.mcqMinPercent;
  } else if (mcqMinPercent !== null) {
    passRules.mcqMinPercent = mcqMinPercent;
  }

  // #896 S3c: the rest of the pass rules, now editable here. An EMPTY field means "not set" and
  // removes the per-module override — decisionService then falls back to the platform rules. That
  // is a real, distinct choice from "set it to 0", so the two cannot be collapsed.
  const readOptionalPercent = (id) => {
    const el = document.getElementById(id);
    if (!el) return { present: false };
    const raw = el.value.trim();
    if (raw === "") return { present: true, value: null };
    const parsed = parsePercentInRange(raw, 0, 100);
    return { present: true, value: parsed };
  };
  const policyFieldSpecs = [
    { id: "settingsTotalMin", key: "totalMin" },
    { id: "settingsPracticalMin", key: "practicalMinPercent" },
  ];
  for (const { id, key } of policyFieldSpecs) {
    const read = readOptionalPercent(id);
    if (!read.present) continue;
    if (read.value === null && document.getElementById(id).value.trim() !== "") {
      showToast(t("shell.settings.invalidThreshold"), "error");
      document.getElementById(id).focus();
      // Without this the author fixes the number and finds Lagre dead — the click handler
      // disables it, so every early return has to hand it back.
      reenableSettingsSave();
      return;
    }
    if (read.value === null) delete passRules[key];
    else passRules[key] = read.value;
  }
  const bMin = readOptionalPercent("settingsBorderlineMin");
  const bMax = readOptionalPercent("settingsBorderlineMax");
  if (bMin.present || bMax.present) {
    if (bMin.value === null && bMax.value === null) {
      delete passRules.borderlineWindow;
    } else if (bMin.value === null || bMax.value === null || bMin.value > bMax.value) {
      // Half a window is not a window, and a reversed one silently matches nothing.
      showToast(t("shell.settings.invalidBorderline"), "error");
      document.getElementById("settingsBorderlineMin")?.focus();
      reenableSettingsSave();
    return;
    } else {
      passRules.borderlineWindow = { min: bMin.value, max: bMax.value };
    }
  }

  const policy = existingPolicy || Object.keys(passRules).length > 0
    ? { ...(existingPolicy ?? {}), passRules }
    : null;

  // Module-level fields. Sent only when the author actually changed them, so a mode switch
  // does not rewrite a description or a date the panel merely displayed.
  const certInput = document.getElementById("settingsCertLevel");
  const fromInput = document.getElementById("settingsValidFrom");
  const toInput = document.getElementById("settingsValidTo");
  // One value, not one per language — see `certificationLevelValue`. The QA-round-2 defect was
  // that the comparison read a different locale than the one on screen, which made an untouched
  // level look changed; with a single value there is no locale to get wrong.
  const currentCert = certificationLevelValue(bundle.module?.certificationLevel);
  const currentFrom = bundle.module?.validFrom ? new Date(bundle.module.validFrom).toISOString().slice(0, 10) : "";
  const currentTo = bundle.module?.validTo ? new Date(bundle.module.validTo).toISOString().slice(0, 10) : "";

  if (fromInput?.value && toInput?.value && toInput.value < fromInput.value) {
    showToast(t("shell.settings.invalidValidity"), "error");
    toInput.focus();
    reenableSettingsSave();
    return;
  }

  const moduleFields = {
    // Replaced outright, and deliberately: the level is one value on a fixed scale, so there is
    // nothing from another language to preserve. (This is the opposite of the title, description
    // and criteria, which ARE prose and must be merged — the difference is what the field means,
    // not how it happens to be typed.)
    // Never `null`: the schema does not accept it (see the select above), and a blank selection
    // is only reachable when the level was already unset — in which case there is no change.
    ...(certInput && certInput.value.trim() && certInput.value.trim() !== currentCert
      ? { certificationLevel: certInput.value.trim() }
      : {}),
    ...(fromInput && fromInput.value !== currentFrom ? { validFrom: fromInput.value || null } : {}),
    ...(toInput && toInput.value !== currentTo ? { validTo: toInput.value || null } : {}),
  };

  // Same rule as the edit form: nothing changed, nothing written. Without this, opening
  // Innstillinger and pressing Lagre out of habit creates a module version identical to the
  // last one — #896's "ingen endringer ⇒ ingen ny versjon" applies here too.
  const currentMode = version?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
  const currentThreshold = version?.assessmentPolicy?.passRules?.mcqMinPercent;
  const thresholdChanged = thresholdInput
    ? mcqMinPercent !== (Number.isFinite(currentThreshold) ? currentThreshold : SHELL_MCQ_ONLY_MIN_PERCENT)
    : false;
  // The whole pass-rule object, not just the MCQ threshold. Adding the other three rules to the
  // payload without adding them here meant editing the overall pass mark hit "no changes" and
  // nothing was written — the field existed and did nothing.
  const policyChanged = JSON.stringify(passRules) !== JSON.stringify(existingPolicy?.passRules ?? {});
  // #896 S3c: criteria edited here ride along as an INLINE rubric, exactly as the direct-edit save
  // does. Referencing `rubricVersionId` would carry the old criteria forward and quietly discard
  // what the author just typed.
  const criteriaRecord = hasUnsavedCriteriaEdits()
    ? buildCriteriaRecordFromEditorState(
        captureLatestCriteriaState(document.getElementById("settingsCriteriaEditor"), settingsCriteriaState),
      )
    : null;

  // #896 S3c: the practical weight lives on the rubric's scalingRule, so changing it means writing
  // a rubric — the criteria come along unchanged when they were not edited.
  const weightInput = document.getElementById("settingsPracticalWeight");
  const storedWeight = Number(cfg.rubricVersion?.scalingRule?.practical_weight);
  const practicalWeight = weightInput ? parsePercentInRange(weightInput.value, 0, 100) : null;
  const weightChanged = Boolean(
    weightInput && practicalWeight !== (Number.isFinite(storedWeight) ? storedWeight : 70),
  );
  if (weightInput && weightInput.value.trim() !== "" && practicalWeight === null) {
    // Out of range or not a whole number is the author's mistake to see, not something to round.
    showToast(t("shell.settings.invalidWeight"), "error");
    weightInput.focus();
    reenableSettingsSave();
    return;
  }

  // #896 S3c: the assessment instruction. Edited in ONE language, merged onto the stored value —
  // the composer writes it verbatim, so sending only the edited locale would delete the other two.
  const promptDirty = anyFieldDirtyIncludingCollapsed(SETTINGS_INPUT_IDS.prompt);
  let promptPayload = null;
  if (promptDirty) {
    const stored = cfg.promptTemplateVersion ?? {};
    const examplesRaw = settingsFieldValue("settingsPromptExamples");
    let examples = stored.examples ?? [];
    if (examplesRaw !== undefined) {
      try {
        const parsed = JSON.parse(examplesRaw || "[]");
        if (!Array.isArray(parsed)) throw new Error("not an array");
        examples = parsed;
      } catch {
        // Malformed JSON is the author's to see, not something to silently drop or guess at.
        // The field may be folded away, in which case there is nothing to focus — the message
        // still has to appear, or the save fails without a reason.
        showToast(t("shell.settings.promptExamplesInvalid"), "error");
        document.getElementById("settingsPromptExamples")?.focus();
        reenableSettingsSave();
        return;
      }
    }
    const systemPrompt = mergeSettingsField("settingsPromptSystem", stored.systemPrompt);
    const userPromptTemplate = mergeSettingsField("settingsPromptUser", stored.userPromptTemplate);
    if (!systemPrompt || !userPromptTemplate) {
      showToast(t("shell.settings.promptRequired"), "error");
      reenableSettingsSave();
    return;
    }
    promptPayload = { systemPrompt, userPromptTemplate, examples };
  }

  // #896 S3c: the submission schema. Only the FIRST field is editable (#901), and the rest are
  // carried through untouched — a module authored via the API can legitimately have several, and
  // rebuilding the array from one input would delete them.
  const schemaDirty = anyFieldDirtyIncludingCollapsed(SETTINGS_INPUT_IDS.schema);
  let submissionSchemaPayload = null;
  if (schemaDirty) {
    const existing = version?.submissionSchema ?? buildDefaultSubmissionSchema();
    const fields = (existing.fields ?? []).map((f) => ({ ...f }));
    const first = fields[0] ?? { id: "response", type: "textarea", required: true };
    const label = mergeSettingsField("settingsSchemaLabel", first.label);
    if (!label) {
      showToast(t("shell.settings.schemaLabelRequired"), "error");
      reenableSettingsSave();
    return;
    }
    const placeholder = mergeSettingsField("settingsSchemaPlaceholder", first.placeholder);
    fields[0] = { ...first, label, ...(placeholder ? { placeholder } : {}) };
    submissionSchemaPayload = { ...existing, fields };
  }

  // QA 2026-08-16: switching to MCQ-only in the SAME save as a criteria, instruction or weight
  // edit dropped the edit without a word. The version model keeps stored free-text content on the
  // previous version — switching back brings it into view — but an edit that was never saved has
  // no previous version to survive on, so it is simply gone, and switching back shows the OLD
  // criteria as if nothing had been typed. Refusing is the only honest option: the author can
  // save the edit first, or undo it, and both are recoverable. Guessing is not.
  if (isMcqOnly && mode !== currentMode && (criteriaRecord || promptPayload || weightChanged)) {
    showToast(t("shell.settings.mcqOnlyDiscardsEdits"), "error");
    // Put the type back and redraw. Since the panel started following the dropdown, picking
    // MCQ-only hides the criteria and instruction editors — so a refusal that said "save them
    // first or undo them" left the author with no editor to do either in. Reverting restores the
    // editors WITH the edit still in them, which is what makes the message actionable.
    const typeInput = document.getElementById("settingsModuleType");
    if (typeInput) typeInput.value = currentMode;
    renderSettingsPanel();
    reenableSettingsSave();
    return;
  }

  if (
    mode === currentMode && !thresholdChanged && !criteriaRecord && !promptPayload
    && !submissionSchemaPayload && !weightChanged && !policyChanged && Object.keys(moduleFields).length === 0
  ) {
    showToast(t("shell.settings.noChanges"), "info");
    reenableSettingsSave();
    return;
  }

  const body = {
    ...moduleFields,
    assessmentMode: mode,
    ...(isMcqOnly ? {} : {
      // Same stripping here: this carries the STORED content forward, so any blank locale already
      // in the database would otherwise fail a settings-only save the author never touched.
      taskText: dropBlankLocales(latestTaskVersion?.taskText) ?? latestTaskVersion?.taskText,
      assessorExpectedContent:
        dropBlankLocales(latestTaskVersion?.assessorExpectedContent) ?? latestTaskVersion?.assessorExpectedContent,
      candidateTaskConstraints: dropBlankLocales(latestTaskVersion?.candidateTaskConstraints),
      // Inline rubric when the author edited criteria here, otherwise keep referencing the
      // existing one. Sending both would be ambiguous; sending only the id would drop the edit.
      // A rubric is written when the criteria OR the practical weight changed — both live on the
      // same row, so either one means a new version of it. `criteriaRecord` falls back to the
      // stored criteria so a weight-only change does not rewrite them.
      ...(criteriaRecord || weightChanged
        ? {
            rubric: (() => {
              const criteria = criteriaRecord
                ?? buildCriteriaRecordFromEditorState(
                  buildEditorStateFromCriteriaRecord(cfg.rubricVersion?.criteria ?? null, contentLocale),
                );
              return {
                criteria,
                scalingRule: {
                  ...(cfg.rubricVersion?.scalingRule ?? {}),
                  max_total: Object.values(criteria ?? {}).reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 1,
                  practical_weight: weightChanged
                    ? practicalWeight
                    : (cfg.rubricVersion?.scalingRule?.practical_weight ?? 70),
                },
              };
            })(),
          }
        : { rubricVersionId: latestRubricId }),
      // Same either/or as the rubric: a new inline prompt, or a reference to the existing one.
      ...(promptPayload ? { promptTemplate: promptPayload } : { promptTemplateVersionId: latestPromptId }),
    }),
    ...(isFreetextOnly ? {} : { mcqSetVersionId: latestMcqId }),
    ...(policy ? { assessmentPolicy: policy } : {}),
    ...(submissionSchemaPayload
      ? { submissionSchema: submissionSchemaPayload }
      : (version?.submissionSchema ? { submissionSchema: version.submissionSchema } : {})),
  };

  const slot = logProgress("shell.settings.saving");
  slot.abortBtn.remove();
  const versionBefore = version?.id ?? null;
  try {
    await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/versions`, getHeaders, {
      method: "POST",
      // A lost response must not turn one Lagre into two versions on retry.
      headers: { "Idempotency-Key": `settings-${moduleId}-${Date.now()}` },
      body: JSON.stringify(body),
    });
    await loadModule(moduleId);
    // The criteria the author typed are now the stored ones, so the panel state is discarded and
    // the next render reads them back from the bundle. Keeping it would report unsaved edits
    // forever and warn on every exit from a tab with nothing left to lose. (loadModule above
    // already does this; the call is kept so the reset does not depend on that being true.)
    resetSettingsPanelState();
    renderSettingsPanel();
    // loadModule swallows its own fetch errors, so a 502 on the reload would leave the panel
    // showing the previous version under a green toast. Verify what came back instead of
    // trusting that it came back at all.
    const reloadedMode = bundle?.selectedConfiguration?.moduleVersion?.assessmentMode ?? "FREETEXT_PLUS_MCQ";
    // Check the module-level fields too. When certification or validity was the only change,
    // comparing the mode alone always matched and a failed reload still showed green.
    // Both sides through the same reader, so the comparison cannot be confused by the shape the
    // value happens to be stored in. (Round 3 had this comparing a locale object against a
    // localized string, which was never equal — every successful edit reported a stale reload.)
    const reloadedCert = certificationLevelValue(bundle?.module?.certificationLevel);
    const savedCert = moduleFields.certificationLevel === undefined
      ? undefined
      : certificationLevelValue(moduleFields.certificationLevel);
    const certStale = savedCert !== undefined && reloadedCert !== savedCert;
    // Validity too. Checking mode and certification only meant a date-only change always compared
    // equal on the two fields that were checked, so a failed reload still showed green over the
    // old date — the exact hole the check was added to close, left open for one more field.
    const asDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
    const datesStale = ["validFrom", "validTo"].some(
      (field) => moduleFields[field] !== undefined && asDay(bundle?.module?.[field]) !== asDay(moduleFields[field]),
    );
    // The check above only looks at mode, certification and dates. A criteria-, prompt-, schema-
    // or weight-only save changes none of them, so a failed reload compared equal on everything
    // that WAS checked and reported success over the old configuration. Every successful save
    // writes a NEW module version, so the version id is the one signal that covers all of them.
    const reloadedVersionId = bundle?.selectedConfiguration?.moduleVersion?.id ?? null;
    const versionStale = versionBefore !== null && reloadedVersionId === versionBefore;
    if (reloadedMode !== mode || certStale || datesStale || versionStale) {
      logResolveSlot(slot, () => escapeHtml(t("shell.settings.savedStale")));
      showToast(t("shell.settings.savedStale"), "info");
      return;
    }
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.settings.saved"))}</strong>`);
    showToast(t("shell.settings.saved"), "success");
  } catch (error) {
    // The composed save is all-or-nothing, so the module is untouched. Say what the server
    // said rather than a generic failure - the reason is usually actionable.
    const message = error?.body?.message || error?.message || t("shell.settings.saveFailed");
    logResolveSlot(slot, () => escapeHtml(`${t("shell.settings.saveFailed")} ${message}`));
    showToast(t("shell.settings.saveFailed"), "error");
    reenableSettingsSave();
  }
}

function bindViewTabs() {
  for (const [name, button] of Object.entries(tabButtons)) {
    button?.addEventListener("click", () => switchToTab(name));
    // Standard tablist keyboard model. Focus follows the arrow keys and the view
    // switches with it, which is the expected behaviour for tabs whose panels are
    // already loaded.
    button?.addEventListener("keydown", (event) => {
      const index = TAB_ORDER.indexOf(name);
      let target = null;
      if (event.key === "ArrowRight") target = TAB_ORDER[(index + 1) % TAB_ORDER.length];
      else if (event.key === "ArrowLeft") target = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length];
      else if (event.key === "Home") target = TAB_ORDER[0];
      else if (event.key === "End") target = TAB_ORDER[TAB_ORDER.length - 1];
      if (!target) return;
      event.preventDefault();
      tabButtons[target]?.focus();
      switchToTab(target);
    });
  }


  const stayOnCurrentTab = () => {
    pendingTabSwitch = null;
    pendingTabSwitchKind = null;
    // Staying means "keep what I was doing" - including a save that finished while the
    // dialog was up.
    const resume = pendingSaveCommit;
    pendingSaveCommit = null;
    resume?.();
    // Arrowing to a tab focuses it before the dialog opens, so staying would otherwise
    // leave focus on a tab that is not the selected one - or nowhere, in the closed
    // dialog. Put focus back where the selection actually is.
    //
    // Deferred a frame: a native <dialog> restores focus to its invoker as part of closing, and
    // that restoration runs AFTER this handler. Focusing synchronously meant the browser promptly
    // moved focus somewhere else — for Escape, nowhere at all.
    requestAnimationFrame(() => { tabButtons[activeTab]?.focus(); });
  };

  document.getElementById("tabSwitchStay")?.addEventListener("click", () => {
    unsavedTabSwitchDialog?.close();
    stayOnCurrentTab();
  });

  // Escape closes a native <dialog> without going through any button, which would leave
  // pendingTabSwitch stale and focus parked on an unselected tab. The dialog's close event
  // covers every dismissal path, so treat anything that is not an explicit discard as Stay.
  unsavedTabSwitchDialog?.addEventListener("close", () => {
    if (pendingTabSwitch) stayOnCurrentTab();
  });

  // A native <dialog> does not close on a backdrop click by itself. The click lands on the
  // dialog element (the backdrop is its pseudo-element), so target identity is the test.
  unsavedTabSwitchDialog?.addEventListener("click", (event) => {
    if (event.target === unsavedTabSwitchDialog) unsavedTabSwitchDialog.close();
  });

  document.getElementById("tabSwitchDiscard")?.addEventListener("click", () => {
    const target = pendingTabSwitch;
    const kind = pendingTabSwitchKind;
    pendingTabSwitch = null;
    pendingTabSwitchKind = null;
    unsavedTabSwitchDialog?.close();
    if (!target) return;
    // Tear the form down FIRST. applyTabState re-renders the preview when the audience
    // changes, which removes #previewEditCancel - and then its handler never runs, leaving
    // preview-pane--editing, criteriaReadyCallback and the chat actions stranded until a
    // reload. Only an open form is discarded; a draft is carried along untouched.
    if (kind === "form") {
      // A save in flight has disabled that Cancel button, so clicking it would do NOTHING and
      // the running translation would go on to save the values just discarded. Abort first:
      // the signal handler re-enables the form, and commit() refuses to run once aborted.
      pendingSaveCommit = null;
      generationAbort?.abort();
      document.getElementById("previewEditCancel")?.click();
    }
    // QA round 5: "Forkast" did not clear the cache that holds the values of COLLAPSED sections,
    // so a discarded instruction came back the next time the section was opened. Worse across a
    // language switch: the English cache was laid over the Norwegian field, and the next save
    // could file English text as `nb`. Discarding settings has to discard all of them.
    if (kind === "settings") discardSettingsEdits();
    applyTabState(target);
    syncTabToUrl(target);
    tabButtons[target]?.focus();
  });

  // Establish the roving tabindex now. Without this the assignment in applyTabState first
  // runs on the initial tab switch, so until then all three tabs sit in the tab order -
  // the exact behaviour the roving model exists to remove.
  applyTabState(activeTab);
}

// ---------------------------------------------------------------------------
// New module creation flow
// ---------------------------------------------------------------------------

function startNewModuleFlow() {
  previewDraft = null;
  renderPreviewLocaleBar();
  renderPreview();
  logForm(
    "text",
    () => t("shell.newModule.titlePrompt"),
    "shell.newModule.titlePlaceholder",
    "shell.action.next",
    // #555: unified authoring order — Kilde → Modultype → Innhold → Publiser. Source material
    // is now the first question; module-type (free-text+MCQ vs MCQ-only) is asked after source,
    // and scenario/cert only follow for the free-text branch. Matches the Avansert IA (#554).
    (title) => askForSourceMaterial(title, null, null),
  );
}

// ---------------------------------------------------------------------------
// Scenario mode → source material → cert level → locale → generate
// ---------------------------------------------------------------------------

// #555: regen på en eksisterende modul følger samme rekkefølge som ny-modul-flyten — KILDE
// først, så scenario, så (cert hvis ukjent →) vurderingsplan. Tidligere kom scenario før kilde,
// som forfatter-feedback (skjermbilde 2026-06-21) bekreftet føltes feil også her. knownCertLevel
// videreføres fra regen så vi ikke spør om cert-nivå på nytt. scenarioMode brukes server-side
// (prompt) og i ekstern-LLM-handoff.
function askForScenarioModeRegen(existingModuleId, sourceMaterial, knownCertLevel = null, freetextOnly = false) {
  logBot(() => `<strong>${escapeHtml(t("shell.scenario.prompt"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.scenario.hint"))}</span>`, [
    { labelKey: "shell.scenario.auto", action: () => continueRegenAfterScenario(existingModuleId, sourceMaterial, knownCertLevel, "auto", freetextOnly) },
    { labelKey: "shell.scenario.include", action: () => continueRegenAfterScenario(existingModuleId, sourceMaterial, knownCertLevel, "include", freetextOnly) },
    { labelKey: "shell.scenario.exclude", action: () => continueRegenAfterScenario(existingModuleId, sourceMaterial, knownCertLevel, "exclude", freetextOnly) },
  ]);
}

function continueRegenAfterScenario(existingModuleId, sourceMaterial, knownCertLevel, scenarioMode, freetextOnly = false) {
  if (knownCertLevel) {
    // Hard-default "thorough" — se askForCertLevel-kommentaren.
    generateBlueprintAndConfirm(null, existingModuleId, sourceMaterial, knownCertLevel, currentLocale, "thorough", scenarioMode, freetextOnly);
  } else {
    askForCertLevel(null, existingModuleId, sourceMaterial, scenarioMode, freetextOnly);
  }
}

// #579: modultype-valg i regen-flyten. Den anbefalte opprett-veien (biblioteks-dialogen, #348)
// oppretter modulen og lander her, så dette er stedet forfatter faktisk velger type. Etter kilde,
// før scenario. Tillater typebytte: lagring skriver en ny versjon i valgt modus.
//   - «Fritekst + flervalg» → uendret regen (scenario → cert/vurderingsplan → MCQ)
//   - «Kun flervalg» → MCQ-only-generering, lagres som MCQ_ONLY (ingen scenario/rubrikk/prompt)
function askForModuleTypeRegen(existingModuleId, sourceMaterial, knownCertLevel) {
  logBot(
    () =>
      `<strong>${escapeHtml(t("shell.moduleType.prompt"))}</strong>`
      + `<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.moduleType.hint"))}</span>`,
    [
      { labelKey: "shell.moduleType.freetext", action: () => askForScenarioModeRegen(existingModuleId, sourceMaterial, knownCertLevel, false) },
      { labelKey: "shell.moduleType.freetextOnly", action: () => askForScenarioModeRegen(existingModuleId, sourceMaterial, knownCertLevel, true) },
      { labelKey: "shell.moduleType.mcqOnly", action: () => startMcqOnlyRegen(sourceMaterial, knownCertLevel) },
    ],
  );
}

function startMcqOnlyRegen(sourceMaterial, knownCertLevel) {
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
  askForMcqQuestionCount(sourceMaterial, certLevel, currentLocale, "thorough", () => showDraftReadyActions());
}

function askForSourceMaterial(moduleTitle, existingModuleId, knownCertLevel, scenarioMode = "auto") {
  logForm(
    "source-material",
    () => `<strong>${escapeHtml(t("shell.source.promptTitle"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.source.promptHint"))}</span>`,
    "shell.source.placeholder",
    "shell.action.next",
    (sourceMaterial) => {
      // #555: unified order — KILDE kommer først i begge flytene.
      //  - Ny modul (existingModuleId == null): spør modultype etter kilde.
      //  - Regen (existingModuleId satt): spør scenario etter kilde, så cert/vurderingsplan.
      if (!existingModuleId) {
        askForModuleType(moduleTitle, sourceMaterial);
        return;
      }
      // #579: regen spør også modultype etter kilde (forfatter kan bytte type ved regenerering).
      askForModuleTypeRegen(existingModuleId, sourceMaterial, knownCertLevel);
    },
    "",
    {},
  );
}

function askForCertLevel(moduleTitle, existingModuleId, sourceMaterial, scenarioMode = "auto", freetextOnly = false) {
  // Generation mode is always "thorough" — author feedback (2026-05-18) confirmed the
  // "Vanlig" option was never selected in practice. Removed to reduce conversation friction.
  logBot(() => t("shell.certLevel.prompt"), [
    { labelKey: "shell.certLevel.basic", action: () => generateBlueprintAndConfirm(moduleTitle, existingModuleId, sourceMaterial, "basic", currentLocale, "thorough", scenarioMode, freetextOnly) },
    { labelKey: "shell.certLevel.intermediate", action: () => generateBlueprintAndConfirm(moduleTitle, existingModuleId, sourceMaterial, "intermediate", currentLocale, "thorough", scenarioMode, freetextOnly) },
    { labelKey: "shell.certLevel.advanced", action: () => generateBlueprintAndConfirm(moduleTitle, existingModuleId, sourceMaterial, "advanced", currentLocale, "thorough", scenarioMode, freetextOnly) },
  ]);
}

// #555: module-type fork in the new-module flow. Asked after source material, before any
// content generation. "Fritekst + flervalg" continues into the existing scenario → cert →
// blueprint pipeline; "Kun flervalg" creates an MCQ_ONLY module and skips straight to MCQ
// generation (no scenario, no rubric/prompt). Mirrors the Avansert editor's Modultype panel.
function askForModuleType(moduleTitle, sourceMaterial) {
  logBot(
    () =>
      `<strong>${escapeHtml(t("shell.moduleType.prompt"))}</strong>`
      + `<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.moduleType.hint"))}</span>`,
    [
      { labelKey: "shell.moduleType.freetext", action: () => askForScenarioModeForFreetext(moduleTitle, sourceMaterial, false) },
      { labelKey: "shell.moduleType.freetextOnly", action: () => askForScenarioModeForFreetext(moduleTitle, sourceMaterial, true) },
      { labelKey: "shell.moduleType.mcqOnly", action: () => askForCertLevelMcqOnlyNewModule(moduleTitle, sourceMaterial) },
    ],
  );
}

// Free-text branch of the new-module flow: scenario choice now follows source+module-type
// (not before source as in the legacy order). Routes into the unchanged cert → blueprint path.
function askForScenarioModeForFreetext(moduleTitle, sourceMaterial, freetextOnly = false) {
  logBot(
    () =>
      `<strong>${escapeHtml(t("shell.scenario.prompt"))}</strong>`
      + `<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.scenario.hint"))}</span>`,
    [
      { labelKey: "shell.scenario.auto", action: () => askForCertLevel(moduleTitle, null, sourceMaterial, "auto", freetextOnly) },
      { labelKey: "shell.scenario.include", action: () => askForCertLevel(moduleTitle, null, sourceMaterial, "include", freetextOnly) },
      { labelKey: "shell.scenario.exclude", action: () => askForCertLevel(moduleTitle, null, sourceMaterial, "exclude", freetextOnly) },
    ],
  );
}

// MCQ-only branch of the new-module flow: ask cert level, then create the module shell and
// hand off to the existing MCQ-generation chain. The shell is created up-front (like the
// free-text confirmAndGenerate path) so selectedModuleId exists when MCQ is attached and saved.
function askForCertLevelMcqOnlyNewModule(moduleTitle, sourceMaterial) {
  logBot(() => t("shell.mcqCertLevel.prompt"), [
    { labelKey: "shell.certLevel.basic", action: () => createMcqOnlyModuleThenGenerate(moduleTitle, sourceMaterial, "basic") },
    { labelKey: "shell.certLevel.intermediate", action: () => createMcqOnlyModuleThenGenerate(moduleTitle, sourceMaterial, "intermediate") },
    { labelKey: "shell.certLevel.advanced", action: () => createMcqOnlyModuleThenGenerate(moduleTitle, sourceMaterial, "advanced") },
  ]);
}

// Default pass mark for MCQ-only modules created via the conversation (author can override in
// Avansert). Mirrors DEFAULT_MCQ_ONLY_MIN_PERCENT on the server (decisionService).
const SHELL_MCQ_ONLY_MIN_PERCENT = 70;

async function createMcqOnlyModuleThenGenerate(moduleTitle, sourceMaterial, certLevel) {
  const slot = logProgress(() => `${t("shell.newModule.creating").replace(/…$/, "")} «${moduleTitle}»…`);
  slot.abortBtn.remove(); // creation is not abortable

  let newModule;
  try {
    const titleLocalized = { nb: moduleTitle, nn: moduleTitle, "en-GB": moduleTitle };
    const body = await apiFetch(
      "/api/admin/content/modules",
      getHeaders,
      { method: "POST", body: JSON.stringify({ title: titleLocalized, certificationLevel: certLevel }) },
    );
    newModule = body?.module ?? body;
  } catch (err) {
    logResolveSlot(
      slot,
      () => `${escapeHtml(t("shell.newModule.createError"))}<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.newModule.createErrorHint"))}</span>`,
      [
        { labelKey: "shell.action.retry", action: () => createMcqOnlyModuleThenGenerate(moduleTitle, sourceMaterial, certLevel) },
        { labelKey: "shell.action.cancel", action: startIdle },
      ],
    );
    return;
  }

  selectedModuleId = newModule?.id ?? newModule?.moduleId;
  const capturedId = selectedModuleId;
  logResolveSlot(slot, () =>
    `${escapeHtml(t("shell.newModule.created"))} <strong>${escapeHtml(moduleTitle)}</strong>` +
    `<br><span style="font-size:13px;color:var(--color-meta)">ID: ${escapeHtml(capturedId)}</span>`,
  );

  // MCQ-only draft: no taskText/rubric/prompt. assessmentMode + mcqMinPercent flagged here so
  // saveDraftBundleInBackground emits the MCQ_ONLY module version (see that function's branch).
  sessionDraft = {
    title: moduleTitle,
    assessmentMode: "MCQ_ONLY",
    mcqMinPercent: SHELL_MCQ_ONLY_MIN_PERCENT,
    taskText: "",
    assessorExpectedContent: "",
    candidateTaskConstraints: "",
    mcqQuestions: [],
  };
  // QA round 4: same as the free-text path — Innstillinger needs the bundle or it shows
  // "load a module". Three creation paths, and the first fix reached one of them.
  await attachBundleForNewModule(selectedModuleId);
  renderPreview();

  // Reuse the existing MCQ-generation chain; on accept go straight to the draft-ready actions
  // (no draft/criteria generation step, which is free-text-only).
  askForMcqQuestionCount(sourceMaterial, certLevel, currentLocale, "thorough", () => showDraftReadyActions());
}

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
    confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale, generationMode, null, scenarioMode, freetextOnly);
    return;
  }

  generationAbort = null;
  sessionState = selectedModuleId ? (sessionDraft ? "draft-pending" : "module-loaded") : "idle";

  const bp = blueprintResult?.blueprint;
  // v1.2.4: pass effectiveSourceMaterial (possibly condensed) so all downstream LLM calls
  // (draft, MCQ, rubric) get the same condensed view rather than re-paying for raw.
  // v1.2.8: scenarioMode forwarded through to draft generation.
  renderEditableBlueprint(slot, bp, { moduleTitle, existingModuleId, sourceMaterial: effectiveSourceMaterial, certLevel, locale, generationMode, scenarioMode, freetextOnly });
}

// B1 (#448): editable Vurderingsplan card replaces the static accept/skip preview. Lærer
// can add, edit, and remove læringsmål and sentrale temaer before continuing. "Bruk denne
// planen" captures current inputs and passes them to confirmAndGenerate. "Generer på nytt"
// re-runs blueprint generation, warning first if the user made manual edits.
function renderEditableBlueprint(slot, initialBlueprint, ctx) {
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
    const objInputs = slot.el.querySelectorAll(".bp-objective-input");
    const topInputs = slot.el.querySelectorAll(".bp-topic-input");
    working.learningObjectives = Array.from(objInputs).map((i) => i.value.trim()).filter(Boolean);
    working.keyTopics = Array.from(topInputs).map((i) => i.value.trim()).filter(Boolean);
  };

  const renderAndWire = () => {
    logResolveSlot(slot, renderHtml, [
      {
        labelKey: "shell.blueprint.usePlan",
        action: () => {
          captureInputs();
          if (working.learningObjectives.length === 0) {
            window.alert(t("shell.blueprint.objectivesRequired"));
            return;
          }
          const blueprintJson = JSON.stringify(working);
          confirmAndGenerate(ctx.moduleTitle, ctx.existingModuleId, ctx.sourceMaterial, ctx.certLevel, ctx.locale, ctx.generationMode, blueprintJson, ctx.scenarioMode, ctx.freetextOnly);
        },
      },
      {
        labelKey: "shell.blueprint.regenerate",
        action: () => {
          captureInputs();
          if (hasManualEdits && !window.confirm(t("shell.blueprint.regenerateWarning"))) return;
          generateBlueprintAndConfirm(ctx.moduleTitle, ctx.existingModuleId, ctx.sourceMaterial, ctx.certLevel, ctx.locale, ctx.generationMode, ctx.scenarioMode);
        },
      },
    ]);

    const editor = slot.el.querySelector(".bp-editor");
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
        const inputs = slot.el.querySelectorAll(".bp-objective-input");
        inputs[inputs.length - 1]?.focus();
      } else if (target.classList.contains("bp-add-topic")) {
        captureInputs();
        working.keyTopics.push("");
        renderAndWire();
        const inputs = slot.el.querySelectorAll(".bp-topic-input");
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
function humaniseCriterionId(id) {
  return String(id).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    const titleLocalized = { nb: moduleTitle, nn: moduleTitle, "en-GB": moduleTitle };
    const body = await apiFetch(
      "/api/admin/content/modules",
      getHeaders,
      { method: "POST", body: JSON.stringify({ title: titleLocalized, certificationLevel: certLevel }) },
    );
    newModule = body?.module ?? body;
  } catch (err) {
    logResolveSlot(
      slot,
      () => `${escapeHtml(t("shell.newModule.createError"))}<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.newModule.createErrorHint"))}</span>`,
      [
        // v1.2.18 (#352) sendte denne til modul-biblioteket, men beholdt etiketten «Åpne avansert
        // editor». Den har altså løyet i et halvt år. Nå sier den hvor den går.
        { labelKey: "shell.module.goToLibrary", action: () => { location.href = "/admin-content"; } },
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
  resetSettingsPanelState();
  try {
    const exportData = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    bundle = exportData?.moduleExport ?? bundle;
  } catch {
    // Left as it was.
  }
}

function askForMcqGeneration(sourceMaterial, certLevel, locale, generationMode) {
  // v1.1.96: Yes/No-dialogen ble fjernet. MCQ er nødvendig for save fra samtale, så "Nei"
  // var en dead-end (bekreftet via bruker-feedback 2026-05-22). Går direkte til count-
  // dialogen. Bruker kan fortsatt avbryte via "Avbryt"-knappen på progress-meldingen
  // hvis de virkelig ikke vil ha MCQ — da må de bruke Avansert editor i stedet.
  askForMcqQuestionCount(sourceMaterial, certLevel, locale, generationMode, () => showDraftReadyActions());
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
  const generationLocale = currentLocale;
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
    if (sessionDraft && Object.keys(record).length > 0 && !settingsCriteriaEdited()) {
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
    if (sessionDraft?.criteria && !settingsCriteriaEdited()) {
      settingsCriteriaState = null;
      settingsCriteriaBaseline = null;
      if (activeTab === "settings") renderSettingsPanel();
      // #926 §6 krav 2: dette er selve tilfellet saken beskriver. Kriteriene er generert
      // asynkront og ligger nå i Innstillinger; står forfatteren i Rediger, kom de uten et
      // eneste tegn. Merkingen er betinget av `activeTab` inne i `markTabAttention`, så den
      // uteblir når panelet er synlig — der endringen allerede kan ses.
      markTabAttention("settings");
    }
  }
}

function showDraftReadyActions() {
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
    revise: { labelKey: "shell.draftReady.editInChat", action: () => startUnifiedRevisionFlow() },
    restart: { labelKey: "shell.draftReady.restart", action: startIdle },
    saveDraft: { labelKey: "shell.draftReady.saveDraft", action: saveDraftBundleInBackground },
  };
  // The message is conversation and stays in the log; the actions go to the fixed bar, where they
  // do not sink out of reach as the log grows.
  logBot(() => {
    const parts = [t("shell.draftReady.message")];
    if (mcqCount > 0) parts.push(tf("shell.draftReady.mcqCount", { count: mcqCount }));
    parts.push(t("shell.draftReady.hint"));
    return escapeHtml(parts.join(" "));
  });
  renderWorkspaceActions(model.actionKeys.map((key) => actionMap[key]).filter(Boolean));
  if (model.shouldOpenUnifiedRevision) {
    startUnifiedRevisionFlow();
  }
}

// Separate entry point for MCQ-only generation from the module actions menu.
// v1.2.8 (follow-up): regen-flyten på eksisterende modul skal også spørre om scenario
// — samme intent som ved ny modul-flyten. Tidligere antakelse om at eksisterende moduler
// bevarer egen stil var feil; forfatter vil styre per regenerering.
function startGenerateDraftFlow() {
  // #555: KILDE først også ved regenerering (var: scenario først).
  askForSourceMaterial(null, selectedModuleId, bundle?.module?.certificationLevel ?? null);
}

function startGenerateMcqFlow() {
  logForm(
    "source-material",
    () => `<strong>${escapeHtml(t("shell.mcqSource.promptTitle"))}</strong>`,
    "shell.mcqSource.placeholder",
    "shell.action.next",
    (sourceMaterial) => askForCertLevelMcqOnly(sourceMaterial),
  );
}

function askForCertLevelMcqOnly(sourceMaterial) {
  // Generation mode hard-defaulted to "thorough" — see askForCertLevel above for rationale.
  logBot(() => t("shell.mcqCertLevel.prompt"), [
    { labelKey: "shell.certLevel.basic", action: () => askForMcqQuestionCount(sourceMaterial, "basic", currentLocale, "thorough", () => showModuleActions()) },
    { labelKey: "shell.certLevel.intermediate", action: () => askForMcqQuestionCount(sourceMaterial, "intermediate", currentLocale, "thorough", () => showModuleActions()) },
    { labelKey: "shell.certLevel.advanced", action: () => askForMcqQuestionCount(sourceMaterial, "advanced", currentLocale, "thorough", () => showModuleActions()) },
  ]);
}

function askForMcqQuestionCount(sourceMaterial, certLevel, locale, generationMode, onAccept) {
  logBot(() => t("shell.mcq.questionCountPrompt"), [
    { labelKey: "shell.mcq.questionCountChoice3", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, 3, onAccept) },
    { labelKey: "shell.mcq.questionCountChoice5", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, 5, onAccept) },
    { labelKey: "shell.mcq.questionCountChoice10", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, 10, onAccept) },
    { labelKey: "shell.mcq.questionCountCustom", action: () => askForCustomMcqQuestionCount(sourceMaterial, certLevel, locale, generationMode, onAccept) },
  ]);
}

function askForCustomMcqQuestionCount(sourceMaterial, certLevel, locale, generationMode, onAccept) {
  logForm(
    "text",
    () => t("shell.mcq.questionCountPrompt"),
    "shell.mcq.questionCountPlaceholder",
    "shell.action.next",
    (rawValue) => {
      const questionCount = parsePositiveIntInRange(rawValue, 1, 20);
      if (questionCount === null) {
        logBot(() => t("shell.mcq.questionCountInvalid"), [
          { labelKey: "shell.action.retry", action: () => askForCustomMcqQuestionCount(sourceMaterial, certLevel, locale, generationMode, onAccept) },
          { labelKey: "shell.action.cancel", action: () => askForMcqQuestionCount(sourceMaterial, certLevel, locale, generationMode, onAccept) },
        ]);
        return;
      }
      askForMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, questionCount, onAccept);
    },
  );
}

function askForMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, questionCount, onAccept) {
  logBot(() => tf("shell.mcq.optionCountPrompt", { count: questionCount }), [
    { labelKey: "shell.mcq.optionCountChoice3", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, questionCount, 3, onAccept) },
    { labelKey: "shell.mcq.optionCountChoice4", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, questionCount, 4, onAccept) },
    { labelKey: "shell.mcq.optionCountChoice5", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, questionCount, 5, onAccept) },
    { labelKey: "shell.mcq.optionCountCustom", action: () => askForCustomMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, questionCount, onAccept) },
  ]);
}

function askForCustomMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, questionCount, onAccept) {
  logForm(
    "text",
    () => tf("shell.mcq.optionCountPrompt", { count: questionCount }),
    "shell.mcq.optionCountPlaceholder",
    "shell.action.next",
    (rawValue) => {
      const optionCount = parsePositiveIntInRange(rawValue, 2, 6);
      if (optionCount === null) {
        logBot(() => t("shell.mcq.optionCountInvalid"), [
          { labelKey: "shell.action.retry", action: () => askForCustomMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, questionCount, onAccept) },
          { labelKey: "shell.action.cancel", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, generationMode, questionCount, onAccept) },
        ]);
        return;
      }
      generateMcqInBackground(sourceMaterial, certLevel, locale, generationMode, questionCount, optionCount, onAccept);
    },
  );
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
    if (activeTab === "settings" && hasUnsavedSettingsEdits() && !window.confirm(t("shell.tab.unsaved.settingsBody"))) {
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
    // Round 7: but NOT `discardSettingsEdits()`, which also rolls the draft back to what it held
    // before the panel opened. Criteria already absorbed into a draft are the author's work, not
    // something they asked to throw away — the guard above only established that nothing is at
    // risk of being LOST, which is true precisely because the draft is keeping it.
    settingsCriteriaState = null;
    settingsCriteriaBaseline = null;
    settingsCriteriaDraftBaseline = undefined;
    settingsDraftValues = null;
    // The content language does NOT follow. Stage-tilbakemelding 2026-08-17: it used to, until the
    // author touched the selector — after which it silently stopped, with nothing on screen saying
    // so. Changing the menu language now changes the menus; the content stays in the language it
    // is written in, which is the only rule that can be stated in one sentence.
    // Direkte redigering bygges INN i forhåndsvisningsruten, så renderPreview() river den.
    // Forhåndsvisningens EGEN språkvelger er deaktivert under redigering
    // (.preview-pane--editing .preview-locale-btn { pointer-events: none }) — men denne, i
    // topplinja, var det ikke. Man havnet i lesemodus med en samtale som fortsatt sa «rediger
    // feltene og trykk Bekreft», og handlingsknappene var allerede brukt opp og deaktiverte.
    // Ingen vei videre uten å laste siden på nytt (rapportert fra stage 13.08).
    const wasEditing = !!document.getElementById("previewEditConfirm");
    // Replay the full chat log in the new locale
    retranslateChat();
    translatePageStaticText();
    renderPreviewLocaleBar();
    renderPreview();
    renderWorkspaceNavigation();
    // #926: the attention suffix is built from `t()`, so it is stale text after a language change.
    // `translatePageStaticText` cannot reach it — the tab carries `data-i18n`, not
    // `data-i18n-aria-label`, and the suffix is not in the markup at all.
    for (const tab of Object.keys(tabButtons)) applyTabAttentionLabel(tab);
    // #896 S3b: the settings panel is built in JS, so translatePageStaticText cannot reach it.
    // Without this the module types, the "missing component" reasons and the save button stay
    // in the previous language while the page around them switches.
    renderSettingsPanel();
    if (wasEditing) {
      enterPreviewEditMode({ force: true });
      // Feltene fylles fra det nye språket. Det som var skrevet i det forrige — og ikke bekreftet
      // — er borte, og det skal man få vite, ikke oppdage.
      logBot(() => escapeHtml(t("shell.directEdit.localeSwitched")));
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
  bindViewTabs();
  renderPreviewLocaleBar();
  renderPreview();
  loadVersion(appVersionLabel, "A2 Content Workspace");
  await loadConsoleConfig();

  // Path-based moduleId: /admin-content/module/:moduleId/conversation
  const pathModuleId = window.location.pathname.match(/\/admin-content\/module\/([^/]+)\//)?.[1] ?? null;
  const queryModuleId = new URLSearchParams(location.search).get("moduleId");
  const autoModuleId = pathModuleId ?? queryModuleId;
  const resumeEditing = new URLSearchParams(location.search).get("resumeEditing") === "1";
  if (autoModuleId) {
    await loadModule(autoModuleId, { resumeEditing });
    return;
  }

  startIdle();
}

initShell().catch(() => {
  startIdle();
});
