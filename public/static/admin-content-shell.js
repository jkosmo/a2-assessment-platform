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
import { renderWorkspaceNavigationWithProfile } from "/static/workspace-nav.js";
import { writeHandoff, readAndClearHandoff } from "/static/admin-content-handoff.js";
import { localizeValueForLocale, buildPreviewHtml } from "/static/admin-content-preview.js";
import { hashBlueprintAsync, classifyDriftState } from "/static/admin-content-blueprint-hash.js";
import {
  classifyShellEditInstruction,
  detectShellRevisionTargets,
  deriveShellModuleActionModel,
  deriveShellDraftReadyActionModel,
  resolveShellResumeBehavior,
} from "/static/admin-content-shell-state.js";
import { buildAdminContentAdvancedUrl } from "/static/admin-content-handoff-routes.js";
import { deriveModuleStatusChains } from "/static/module-status-logic.js";
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
  return localizeValueForLocale(value, previewLocale);
}

function parsePositiveIntInRange(rawValue, min, max) {
  const value = Number.parseInt(String(rawValue).trim(), 10);
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
let previewLocale = currentLocale;

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
const previewLocaleBar = document.getElementById("previewLocaleBar");
const previewContent = document.getElementById("previewContent");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const appVersionLabel = document.getElementById("appVersion");
const uiLocaleSelect = document.getElementById("localeSelect");
const modeSwitchAdvancedBtn = document.getElementById("modeSwitchAdvanced");
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
function _domProgress(textKeyOrFn) {
  const text = typeof textKeyOrFn === "function" ? textKeyOrFn() : t(textKeyOrFn);
  setChatBusy(true);
  announceStatus(text);
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--bot";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--progress";
  bubble.innerHTML = `<span class="chat-spinner"></span>${escapeHtml(text)}`;
  msg.appendChild(bubble);
  // Detached stub — kept for API compatibility with existing slot.abortBtn references.
  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
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
function logProgress(textKeyOrFn) {
  const { el, abortBtn } = _domProgress(textKeyOrFn);
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
  // Only show the locale switcher when content is loaded — avoids duplicating
  // the top-bar UI language selector when nothing is being previewed.
  const hasContent = !!bundle || !!sessionDraft || !!previewDraft;
  previewLocaleBar.classList.toggle("visible", hasContent);
  previewLocaleBar.innerHTML = "";
  if (!hasContent) return;

  for (const loc of supportedLocales) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preview-locale-btn" + (loc === previewLocale ? " active" : "");
    btn.textContent = localeLabels[loc] ?? loc;
    btn.setAttribute("aria-pressed", String(loc === previewLocale));
    btn.addEventListener("click", () => {
      previewLocale = loc;
      renderPreviewLocaleBar();
      renderPreview();
    });
    previewLocaleBar.appendChild(btn);
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
  const opts = { locale: previewLocale, t, tf };

  if (!bundle && !sessionDraft && !previewDraft) {
    previewContent.innerHTML = buildPreviewHtml({ emptyText: t("adminContent.status.noneTitle") }, opts);
    updateStateRail();
    return;
  }

  const activeDraft = previewDraft ?? sessionDraft;
  const hasDraft = !!activeDraft;
  const driftState = resolveDriftState();
  const driftBanner = driftState === "drifted" ? renderDriftBannerHtml() : "";

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
      criteriaLoadingText: criteriaGenerationInFlight ? t("shell.criteria.generating") : "",
      // B3 (#450): drift banner rendered above the criteria section.
      driftBanner,
      versionChain: versionChainParts.join(" · "),
      badgeClass: hasDraft ? "draft" : isLive ? "live" : isDraft ? "draft" : "shell",
      badgeText: hasDraft
        ? t("shell.draft.unsavedBadge")
        : isLive ? t("adminContent.status.badge.live")
        : isDraft ? t("adminContent.status.badge.draft")
        : t("adminContent.status.badge.shellOnly"),
    }, opts);
    attachDriftBannerHandlers();
  } else if (hasDraft) {
    previewContent.innerHTML = buildPreviewHtml({
      title: activeDraft.title || t("shell.newModule.defaultTitle"),
      taskText: activeDraft.taskText ?? "",
      assessorExpectedContent: activeDraft.assessorExpectedContent ?? "",
      candidateTaskConstraints: activeDraft.candidateTaskConstraints ?? "",
      mcqQuestions: activeDraft.mcqQuestions ?? [],
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

function makeSrBadge(modifier, text) {
  return `<span class="sr-badge sr-badge--${modifier}">${escapeHtml(text)}</span>`;
}

function updateStateRail() {
  if (!stateRail) return;
  const hasModule = !!selectedModuleId;
  stateRail.hidden = !hasModule;
  if (!hasModule) return;

  const chains = bundle ? deriveModuleStatusChains(bundle) : null;
  const hasUnsaved = !!sessionDraft;

  if (srModuleName) {
    srModuleName.textContent = localizeValue(sessionDraft?.title ?? previewDraft?.title ?? bundle?.module?.title) || selectedModuleId;
  }

  if (srEditing) {
    if (hasUnsaved) {
      srEditing.innerHTML = makeSrBadge("unsaved", t("stateRail.editing.workingDraft"));
    } else if (chains?.latestDraftChain.length > 0) {
      srEditing.innerHTML = makeSrBadge("saved-draft", tf("stateRail.editing.savedDraft", { versionNo: chains.latestDraftChain[0].versionNo }));
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
    srPreview.innerHTML = hasUnsaved
      ? makeSrBadge("unsaved", t("stateRail.preview.workingDraft"))
      : `<span class="state-rail-value">${escapeHtml(t("stateRail.preview.published"))}</span>`;
  }

  if (srLang) {
    srLang.textContent = localeLabels[previewLocale ?? currentLocale] ?? (previewLocale ?? currentLocale);
  }
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
    return buildLocalizedTextMap("en-GB", normalized);
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

async function localizeDraftAcrossLocalesWithTitle(title, taskText, assessorExpectedContent, sourceLocale, candidateTaskConstraints) {
  const localized = {
    title: buildLocalizedTextMap(sourceLocale, title),
    taskText: buildLocalizedTextMap(sourceLocale, taskText),
    assessorExpectedContent: buildLocalizedTextMap(sourceLocale, assessorExpectedContent),
    candidateTaskConstraints: buildLocalizedTextMap(sourceLocale, candidateTaskConstraints ?? ""),
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
          body: JSON.stringify({ title, taskText, assessorExpectedContent, candidateTaskConstraints: candidateTaskConstraints ?? "", sourceLocale, targetLocale }),
        },
      );
    } catch {
      // Graceful degradation: keep source text for failed locale
      continue;
    }
    const draft = result?.draft ?? result;
    localized.title[targetLocale] = draft?.title ?? title;
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

function resolveCurrentDraftSnapshot(locale = (previewLocale ?? currentLocale)) {
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

function createSessionDraftFromLoadedModule() {
  const moduleVersion = bundle?.selectedConfiguration?.moduleVersion ?? null;
  const mcqQuestions = bundle?.selectedConfiguration?.mcqSetVersion?.questions ?? [];
  const moduleTitle = bundle?.module?.title ?? t("shell.newModule.defaultTitle");

  if (!moduleVersion && mcqQuestions.length === 0) {
    return false;
  }

  sessionDraft = buildPreviewCandidate({
    title: moduleTitle,
    taskText: moduleVersion?.taskText ?? "",
    assessorExpectedContent: moduleVersion?.assessorExpectedContent ?? "",
    candidateTaskConstraints: moduleVersion?.candidateTaskConstraints ?? "",
    mcqQuestions,
  });
  previewDraft = null;
  sessionState = "draft-pending";
  renderPreviewLocaleBar();
  renderPreview();
  return true;
}

function applyHandoffDraft(draft) {
  // v1.2.26 (#361): handoff inkluderer nå title, description, criteria og assessmentBlueprint
  // i tillegg til eksisterende felt. Tomt-sjekk dekker hele settet — handoff appliseres
  // hvis noen av feltene har innhold.
  const hasAnything =
    draft?.title ||
    draft?.description ||
    draft?.taskText ||
    draft?.assessorExpectedContent ||
    draft?.candidateTaskConstraints ||
    (draft?.mcqQuestions?.length > 0) ||
    (draft?.criteria && typeof draft.criteria === "object" && Object.keys(draft.criteria).length > 0) ||
    draft?.assessmentBlueprint;
  if (!hasAnything) {
    return false;
  }
  const patch = {
    title: draft?.title ?? bundle?.module?.title ?? "",
    description: draft?.description ?? bundle?.module?.description,
    taskText: draft?.taskText ?? "",
    assessorExpectedContent: draft?.assessorExpectedContent ?? "",
    candidateTaskConstraints: draft?.candidateTaskConstraints ?? "",
    mcqQuestions: draft?.mcqQuestions ?? [],
  };
  if (draft?.criteria && typeof draft.criteria === "object" && Object.keys(draft.criteria).length > 0) {
    patch.criteria = draft.criteria;
  }
  if (draft?.assessmentBlueprint) {
    patch.assessmentBlueprint = draft.assessmentBlueprint;
  }
  sessionDraft = buildPreviewCandidate(patch);
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
  sessionDraft = buildPreviewCandidate({ taskText: localizedDraft.taskText, assessorExpectedContent: localizedDraft.assessorExpectedContent, candidateTaskConstraints: localizedDraft.candidateTaskConstraints });
  if (blueprint) {
    sessionDraft = { ...sessionDraft, assessmentBlueprint: blueprint };
    // B3 (#450): blueprint changed → may now drift from stored rubric hash.
    refreshBlueprintHash();
  }
  clearPreviewCandidate();
  scrollPreviewToTop();
  logResolveSlot(
    slot,
    () => `<strong>${escapeHtml(t("shell.generating.draftReady"))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>`,
  );
  onAccept?.(draft, sourceMaterial, certLevel, locale);
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
  sessionDraft = buildPreviewCandidate({ mcqQuestions: localizedQuestions });
  clearPreviewCandidate();
  scrollPreviewToBottom();
  // #551: surface MCQ quality warnings (incl. the length-cue check) so the author can review.
  const mcqWarnings = Array.isArray(result?.validation?.issues) ? result.validation.issues : [];
  const mcqWarningsHtml = mcqWarnings.length > 0
    ? `<p style="margin:8px 0 0;font-size:13px;color:var(--color-warning,#b45309)">⚠ ${mcqWarnings.map(escapeHtml).join("<br>")}</p>`
    : "";
  logResolveSlot(
    slot,
    () => `<strong>${escapeHtml(tf("shell.generating.mcqReady", { count: questions.length }))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>${mcqWarningsHtml}`,
  );
  onAccept?.(questions);
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
  sessionDraft = buildPreviewCandidate({ taskText: localizedDraft.taskText, assessorExpectedContent: localizedDraft.assessorExpectedContent, candidateTaskConstraints: localizedDraft.candidateTaskConstraints });
  clearPreviewCandidate();
  scrollPreviewToTop();
  logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.revision.draftReady"))}</strong>`);
  onAccept?.(draft);
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
  sessionDraft = buildPreviewCandidate({ mcqQuestions: localizedQuestions });
  clearPreviewCandidate();
  scrollPreviewToBottom();
  logResolveSlot(slot, () => `<strong>${escapeHtml(tf("shell.revision.mcqReady", { count: questions.length }))}</strong>`);
  onAccept?.(questions);
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
    logResolveSlot(slot, () => `<strong>${escapeHtml(tf("shell.revision.titleReady", { title: newTitle }))}</strong>`);
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
      { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(selectedModuleId) },
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
  const isMcqOnly = sessionDraft?.assessmentMode === "MCQ_ONLY";
  // #578: FREETEXT_ONLY drafts have taskText + rubric + prompt but NO MCQ set.
  const isFreetextOnly = sessionDraft?.assessmentMode === "FREETEXT_ONLY";
  const mcqMinPercent = Number.isFinite(sessionDraft?.mcqMinPercent) ? sessionDraft.mcqMinPercent : SHELL_MCQ_ONLY_MIN_PERCENT;
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
      directEdit: { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
      revise: { labelKey: "shell.draftReady.editInChat", action: () => startUnifiedRevisionFlow() },
      openEditor: { labelKey: "shell.draftReady.openEditor", action: () => openAdvancedEditor(selectedModuleId) },
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
    if (titlePatch) {
      await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/title`, getHeaders, {
        method: "PATCH",
        body: JSON.stringify({ title: titlePatch }),
      });
    }

    // #555: MCQ-only save path — create the MCQ set and a MCQ_ONLY module version with a
    // pass-mark policy, skipping rubric/prompt/taskText entirely. The server's module-version
    // schema accepts assessmentMode + assessmentPolicy.passRules.mcqMinPercent for this mode.
    if (isMcqOnly) {
      const mcqBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/mcq-set-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({
          title: resolveMcqTitlePayload(),
          questions: mcqQuestions,
        }),
      });

      const moduleVersionBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({
          assessmentMode: "MCQ_ONLY",
          mcqSetVersionId: mcqBody?.mcqSetVersion?.id,
          assessmentPolicy: { passRules: { mcqMinPercent } },
        }),
      });

      latestSavedModuleVersionId = moduleVersionBody?.moduleVersion?.id ?? null;
      sessionDraft = null;
      previewDraft = null;
      await loadModule(moduleId);
      logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.save.success"))}</strong>`);
      showToast(t("shell.save.success"), "success");
      announceStatus(t("shell.save.success"));
      if (afterSave) afterSave();
      return;
    }

    // Rubric-save: two paths.
    //   - If direct-edit produced explicit criteria (sessionDraft.criteria), POST them as a
    //     new RubricVersion. This is the B2 (#449) flow — user edited criteria in preview.
    //   - Otherwise call ensure-rubric (#447 idempotent flow). Backend reuses existing or
    //     auto-generates from taskText if none exists.
    let rubricBody;
    if (criteria && Object.keys(criteria).length > 0) {
      const existingScaling = bundle?.selectedConfiguration?.rubricVersion?.scalingRule ?? {};
      const totalMax = Object.values(criteria).reduce((sum, c) => sum + (Number(c?.maxScore) || 0), 0) || 1;
      const scalingRule = { ...existingScaling, max_total: totalMax, practical_weight: existingScaling.practical_weight ?? 70 };
      rubricBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/rubric-versions`, getHeaders, {
        method: "POST",
        body: JSON.stringify({ criteria, scalingRule, active: true }),
      });
    } else {
      let blueprintObject = null;
      if (assessmentBlueprint) {
        if (typeof assessmentBlueprint === "string") {
          try { blueprintObject = JSON.parse(assessmentBlueprint); } catch { blueprintObject = null; }
        } else if (typeof assessmentBlueprint === "object") {
          blueprintObject = assessmentBlueprint;
        }
      }
      const ensureRubricBody = {
        taskText: String(translateLocalizedText(taskText) ?? "").trim(),
        assessorExpectedContent: String(translateLocalizedText(assessorExpectedContent) ?? "").trim(),
        candidateTaskConstraints: String(translateLocalizedText(candidateTaskConstraints) ?? "").trim() || undefined,
        certificationLevel: bundle?.module?.certificationLevel ?? "intermediate",
        locale: currentLocale,
        ...(blueprintObject ? { blueprint: blueprintObject } : {}),
      };
      rubricBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/rubric-versions/ensure`, getHeaders, {
        method: "POST",
        body: JSON.stringify(ensureRubricBody),
      });
    }

    const promptBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/prompt-template-versions`, getHeaders, {
      method: "POST",
      body: JSON.stringify(promptPayload),
    });

    // #578: FREETEXT_ONLY has no MCQ set — skip MCQ creation and omit mcqSetVersionId.
    const mcqBody = isFreetextOnly
      ? null
      : await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/mcq-set-versions`, getHeaders, {
          method: "POST",
          body: JSON.stringify({
            title: resolveMcqTitlePayload(),
            questions: mcqQuestions,
          }),
        });

    const moduleVersionBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions`, getHeaders, {
      method: "POST",
      body: JSON.stringify({
        assessmentMode: isFreetextOnly ? "FREETEXT_ONLY" : undefined,
        taskText: translateLocalizedText(taskText),
        assessorExpectedContent: translateLocalizedText(assessorExpectedContent),
        candidateTaskConstraints: translateLocalizedText(candidateTaskConstraints) || undefined,
        assessmentBlueprint: assessmentBlueprint || undefined,
        rubricVersionId: rubricBody?.rubricVersion?.id,
        promptTemplateVersionId: promptBody?.promptTemplateVersion?.id,
        mcqSetVersionId: isFreetextOnly ? undefined : mcqBody?.mcqSetVersion?.id,
        submissionSchema: resolveSubmissionSchemaPayload(),
      }),
    });

    latestSavedModuleVersionId = moduleVersionBody?.moduleVersion?.id ?? null;
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
      { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(moduleId) },
    ]);
  }
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
    const errMsg = String(err?.message ?? err);
    logResolveSlot(slot, () => `${escapeHtml(t("shell.publish.errorPrefix"))}${escapeHtml(errMsg)}`, [
      { labelKey: "shell.action.retry", action: publishLatestDraftInBackground },
      { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(moduleId) },
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
  const slot = logProgress("shell.module.loading");

  try {
    const exportData = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
    bundle = exportData?.moduleExport ?? null;
  } catch {
    logResolveSlot(slot, () => t("shell.module.loadError"), [
      { labelKey: "shell.module.pickAnother", action: startModulePicker },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  sessionState = "module-loaded";

  // B3 (#450): recompute blueprint hash so the drift banner can be classified on first render.
  await refreshBlueprintHash();

  // Check for a handoff payload written by the advanced editor (or by ourselves before navigating away).
  // Handoff wins over resumeEditing: it carries more recent unsaved state than the saved bundle.
  const handoff = readAndClearHandoff(moduleId);
  if (handoff?.locale && supportedLocales.includes(handoff.locale) && handoff.locale !== currentLocale) {
    currentLocale = handoff.locale;
  }
  if (handoff?.previewLocale && supportedLocales.includes(handoff.previewLocale)) {
    previewLocale = handoff.previewLocale;
  }
  const resumeBehavior = resolveShellResumeBehavior({
    hasHandoffDraft: !!handoff?.draft,
    resumeEditing,
  });
  const resumedIntoDraft = resumeBehavior.shouldApplyHandoffDraft
    ? applyHandoffDraft(handoff.draft)
    : resumeBehavior.shouldCreateDraftFromLoadedModule && createSessionDraftFromLoadedModule();
  renderPreview();

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
        { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(selectedModuleId) },
      ],
    );
    return;
  }

  if (intent.kind === "clarify") {
    logBot(() => escapeHtml(t("shell.revision.clarify")), [
      { labelKey: "shell.revision.tryAgain", action: () => startUnifiedRevisionFlow() },
      { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
      { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(selectedModuleId) },
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
    return `
      <li class="vk-card" data-criterion-index="${i}">
        <div class="vk-row">
          <input class="vk-label" type="text" value="${escapeHtml(c.label)}"
                 placeholder="${escapeHtml(t("shell.criteria.labelPlaceholder"))}"
                 aria-label="${labelLabel}" />
          <button type="button" class="vk-remove" data-criterion-index="${i}"
                  aria-label="${removeAria}">×</button>
        </div>
        <textarea class="vk-description" rows="2"
                  placeholder="${escapeHtml(t("shell.criteria.descPlaceholder"))}"
                  aria-label="${descLabel}">${escapeHtml(c.description)}</textarea>
        <label class="vk-weight-label">
          <span>${weightText}:</span>
          <input class="vk-weight" type="range" min="1" max="10" step="1" value="${c.maxScore}"
                 aria-label="${weightText}"
                 aria-valuemin="1" aria-valuemax="10" aria-valuenow="${c.maxScore}"
                 aria-valuetext="${weightValueText}" />
          <span class="vk-weight-value">${c.maxScore}</span>
        </label>
        <label class="vk-visible-label">
          <input class="vk-visible" type="checkbox" ${c.candidateVisible ? "checked" : ""} />
          ${escapeHtml(t("shell.criteria.visibleToCandidate"))}
        </label>
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
    return [String(baseId), {
      label: c.label,
      description: c.description ?? "",
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
    previewLocale ?? currentLocale,
  );
  const assessorText = localizeValueForLocale(
    sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
    previewLocale ?? currentLocale,
  );
  const constraintsText = localizeValueForLocale(
    sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
    previewLocale ?? currentLocale,
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
          certificationLevel: bundle?.module?.certificationLevel ?? "intermediate",
          locale: previewLocale ?? currentLocale,
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
    previewLocale ?? currentLocale,
  );
  const assessorText = localizeValueForLocale(
    sessionDraft?.assessorExpectedContent ?? moduleVersion?.assessorExpectedContent ?? "",
    previewLocale ?? currentLocale,
  );
  const constraintsText = localizeValueForLocale(
    sessionDraft?.candidateTaskConstraints ?? moduleVersion?.candidateTaskConstraints ?? "",
    previewLocale ?? currentLocale,
  );
  if (!taskText || !assessorText) {
    showToast(t("shell.drift.regenerate.missingTask"), "error");
    return;
  }
  const blueprint = getActiveBlueprint();

  const slot = logProgress("shell.drift.diff.progress");
  let result;
  try {
    result = await apiFetch("/api/admin/content/generate/rubric", getHeaders, {
      method: "POST",
      body: JSON.stringify({
        taskText,
        assessorExpectedContent: assessorText,
        candidateTaskConstraints: constraintsText || undefined,
        certificationLevel: bundle?.module?.certificationLevel ?? "intermediate",
        locale: previewLocale ?? currentLocale,
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
  const newCriteriaRecord = llmCriteriaArrayToStorageRecord(newCriteriaArr);
  const existing = bundle?.selectedConfiguration?.rubricVersion?.criteria ?? {};
  const diff = computeCriteriaDiff(existing, newCriteriaRecord);

  openDriftDiffModal(diff, newCriteriaRecord);
}

// B3 (#450): mirror of moduleRubricToStoragePayload's criteria branch. LLM returns an array
// (with .id, .label, .description, .maxScore, .candidateVisible per item); storage wants a
// record keyed by id with weight derived from maxScore.
function llmCriteriaArrayToStorageRecord(arr) {
  const valid = (arr ?? []).filter((c) => c && c.label && c.label.trim());
  const totalMax = valid.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 1;
  return Object.fromEntries(valid.map((c, idx) => {
    const baseId = String(c.id ?? slugifyLabel(c.label) ?? `criterion_${idx + 1}`);
    return [baseId, {
      label: c.label ?? "",
      description: c.description ?? "",
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
    const labelChanged = String(a.label ?? "") !== String(b.label ?? "");
    const descChanged = String(a.description ?? "") !== String(b.description ?? "");
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
    <strong>${escapeHtml(String(next?.label ?? id))}</strong>
    ${next?.description ? `<p class="drift-diff-row-desc">${escapeHtml(String(next.description))}</p>` : ""}
  `)).join("");

  const removedHtml = removed.map(({ id, prev }) => renderRow(id, "removed", `
    <span class="drift-diff-row-tag drift-diff-row-tag--removed">${escapeHtml(t("shell.drift.diff.removed"))}</span>
    <strong>${escapeHtml(String(prev?.label ?? id))}</strong>
    ${prev?.description ? `<p class="drift-diff-row-desc">${escapeHtml(String(prev.description))}</p>` : ""}
  `)).join("");

  const changedHtml = changed.map(({ id, prev, next, fields }) => {
    const parts = [];
    if (fields.labelChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.label"))}:</em> <s>${escapeHtml(String(prev?.label ?? ""))}</s> → <strong>${escapeHtml(String(next?.label ?? ""))}</strong></p>`);
    if (fields.descChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.description"))}:</em> ${escapeHtml(String(next?.description ?? ""))}</p>`);
    if (fields.scoreChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.maxScore"))}:</em> ${escapeHtml(String(prev?.maxScore ?? ""))} → ${escapeHtml(String(next?.maxScore ?? ""))}</p>`);
    if (fields.visChanged) parts.push(`<p class="drift-diff-row-fieldchange"><em>${escapeHtml(t("shell.drift.diff.candidateVisible"))}:</em> ${Boolean(prev?.candidateVisible) ? "✓" : "—"} → ${Boolean(next?.candidateVisible) ? "✓" : "—"}</p>`);
    return renderRow(id, "changed", `
      <span class="drift-diff-row-tag drift-diff-row-tag--changed">${escapeHtml(t("shell.drift.diff.changed"))}</span>
      <strong>${escapeHtml(String(next?.label ?? id))}</strong>
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
    practical_weight: Number(existingScalingRule.practical_weight) || 70,
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
  const taskText = document.getElementById("previewEditTaskText")?.value.trim() ?? "";
  const assessorText = document.getElementById("previewEditGuidanceText")?.value.trim() ?? "";
  const constraintsText = document.getElementById("previewEditCandidateTaskConstraints")?.value.trim() ?? "";
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
        certificationLevel: bundle?.module?.certificationLevel ?? "intermediate",
        locale: previewLocale ?? currentLocale,
        ...(blueprintObj ? { blueprint: blueprintObj } : {}),
      }),
    });
    const generated = Array.isArray(result?.rubric?.criteria) ? result.rubric.criteria : [];
    const mapped = generated.map((c) => ({
      id: String(c.id ?? slugifyLabel(c.label) ?? "criterion"),
      label: c.label ?? "",
      description: c.description ?? "",
      maxScore: Math.max(1, Math.min(10, Number(c.maxScore) || 5)),
      candidateVisible: Boolean(c.candidateVisible),
    }));
    onSuccess(mapped);
    showToast(t("shell.criteria.regenerated"), "success");
  } catch (err) {
    const errMsg = String(err?.message ?? err);
    criteriaContainer.innerHTML = originalHtml;
    showToast(`${t("shell.criteria.regenerateError")}: ${errMsg}`, "error");
  }
}

function enterPreviewEditMode() {
  const editingLocale = previewLocale ?? currentLocale;
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
  // B2 (#449 redesign): pull criteria from sessionDraft override OR existing rubric. Stored
  // as record (id-keyed) — normalize to an ordered array for the editor. Mutated locally;
  // captured back into a record on confirm. Tolerates rich + sparse shapes (#378 vs default).
  // v1.1.92: extracted as helper so the criteriaReadyCallback can rebuild editor state when
  // async generation completes mid-edit-session.
  const buildEditorStateFromCriteriaRecord = (source) => {
    if (!source || typeof source !== "object") return [];
    return Object.entries(source).map(([id, raw]) => {
      const c = raw && typeof raw === "object" ? raw : {};
      // v1.1.78: for sparse legacy criteria with only `weight` (no maxScore), derive
      // maxScore from weight × 10 so the slider opens at a meaningful position.
      const derivedFromWeight = Number(c.weight) > 0 ? Math.max(1, Math.round(Number(c.weight) * 10)) : 0;
      const initialMaxScore = Number(c.maxScore) > 0
        ? Number(c.maxScore)
        : (derivedFromWeight > 0 ? derivedFromWeight : 5);
      // v1.2.10: c.label/c.description kan være string ELLER locale-objekt. Bruk
      // localizeValueForLocale så direkte-edit-view-en plukker riktig locale i input-feltet.
      // humaniseCriterionId-fallback brukes kun når både string og locale-objekt mangler.
      const rawLabel = localizeValueForLocale(c.label, currentLocale);
      const rawDesc = localizeValueForLocale(c.description, currentLocale);
      return {
        id: String(id),
        label: typeof rawLabel === "string" && rawLabel.trim() ? rawLabel : humaniseCriterionId(String(id)),
        description: typeof rawDesc === "string" ? rawDesc : "",
        maxScore: Math.max(1, Math.min(10, initialMaxScore)),
        candidateVisible: Boolean(c.candidateVisible),
      };
    });
  };
  const sourceCriteria = sessionDraft?.criteria ?? bundle?.selectedConfiguration?.rubricVersion?.criteria ?? null;
  let criteriaEditorState = buildEditorStateFromCriteriaRecord(sourceCriteria);
  let nextNewCriterionId = 1;

  // Lock locale bar and signal edit mode visually
  const previewPaneEl = document.querySelector(".preview-pane");
  if (previewPaneEl) previewPaneEl.classList.add("preview-pane--editing");

  // Build edit-mode HTML using same visual classes as preview
  const escapedTitle = escapeHtml(currentTitle);
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
  const renderCriteriaEditor = () => {
    if (criteriaEditorState.length === 0 && criteriaGenerationInFlight) {
      return `<p class="vk-total" style="font-style:italic;color:var(--color-meta);">${escapeHtml(t("shell.criteria.generating"))}</p>`;
    }
    return buildCriteriaEditorHtml(criteriaEditorState, t, tf);
  };
  // Show criteria section if existing rubric OR editor has criteria OR generation in flight.
  // The last branch is what makes the placeholder visible in the race-condition scenario.
  const showCriteriaSection = bundle?.selectedConfiguration?.rubricVersion
    || criteriaEditorState.length > 0
    || criteriaGenerationInFlight;
  const criteriaSectionHtml = showCriteriaSection
    ? `<div class="preview-section-label">${escapeHtml(tf("shell.criteria.title", { count: criteriaEditorState.length }))}</div>
       <div id="previewEditCriteriaContainer">${renderCriteriaEditor()}</div>`
    : "";

  previewContent.innerHTML = `
    <div class="preview-module-header">
      <input id="previewEditTitle" class="preview-edit-title" value="${escapedTitle}"
        aria-label="${escapeHtml(t("shell.directEdit.titlePlaceholder"))}" />
      <span class="module-status-badge draft">${escapeHtml(t("shell.directEdit.editingBadge"))}</span>
    </div>
    <div class="preview-section-label">${labelTask}</div>
    <textarea id="previewEditTaskText" class="preview-edit-textarea"
      aria-label="${labelTask}">${escapedTask}</textarea>
    <div class="preview-section-label">${labelCandidateConstraints}</div>
    <textarea id="previewEditCandidateTaskConstraints" class="preview-edit-textarea preview-edit-textarea--secondary"
      aria-label="${labelCandidateConstraints}">${escapedCandidateConstraints}</textarea>
    <div class="preview-section-label">${labelGuidance}</div>
    <textarea id="previewEditGuidanceText" class="preview-edit-textarea preview-edit-textarea--secondary"
      aria-label="${labelGuidance}">${escapedGuidance}</textarea>
    ${mcqHtml}
    ${criteriaSectionHtml}
    <div class="preview-edit-actions">
      <button id="previewEditCancel" class="btn-secondary">${escapeHtml(t("shell.action.cancel"))}</button>
      <button id="previewEditConfirm" class="btn-primary">${escapeHtml(t("shell.directEdit.submit"))}</button>
    </div>
  `.trim();

  scrollPreviewToTop();
  document.getElementById("previewEditTitle")?.focus();

  // B2 (#449 redesign): wire up criteria-editor interactions. Captures DOM into state,
  // mutates, re-renders the criteria container only (not the full preview, since other
  // fields would lose their unsaved values). Uses event delegation on the container.
  const criteriaContainer = document.getElementById("previewEditCriteriaContainer");
  if (criteriaContainer) {
    // v1.1.92: register callback so async populateSessionDraftCriteriaInBackground can
    // populate the criteria editor when it completes mid-edit-session. Cleared in exitEditMode.
    // Title-label count is also updated since it's derived from criteriaEditorState.length.
    criteriaReadyCallback = (record) => {
      const fresh = buildEditorStateFromCriteriaRecord(record);
      if (fresh.length === 0) return;
      criteriaEditorState = fresh;
      criteriaContainer.innerHTML = renderCriteriaEditor();
      // Update the section label's count (it lives just above the container).
      const sectionLabel = criteriaContainer.previousElementSibling;
      if (sectionLabel?.classList?.contains("preview-section-label")) {
        sectionLabel.textContent = tf("shell.criteria.title", { count: criteriaEditorState.length });
      }
    };

    const captureCriteriaFromDom = () => {
      const cards = criteriaContainer.querySelectorAll(".vk-card");
      criteriaEditorState = Array.from(cards).map((card, idx) => {
        const existing = criteriaEditorState[idx] ?? {};
        return {
          id: existing.id,
          label: card.querySelector(".vk-label")?.value.trim() ?? "",
          description: card.querySelector(".vk-description")?.value.trim() ?? "",
          maxScore: Math.max(1, Math.min(10, Number(card.querySelector(".vk-weight")?.value) || 5)),
          candidateVisible: card.querySelector(".vk-visible")?.checked ?? false,
        };
      });
    };

    const reRenderCriteria = () => {
      criteriaContainer.innerHTML = renderCriteriaEditor();
    };

    criteriaContainer.addEventListener("input", (e) => {
      if (e.target.classList?.contains("vk-weight")) {
        const card = e.target.closest(".vk-card");
        const valueEl = card?.querySelector(".vk-weight-value");
        if (valueEl) valueEl.textContent = String(e.target.value);
        // B4 (#451) a11y: keep aria-valuenow + aria-valuetext in sync with the slider so
        // screen readers announce the current weight during drag/arrow-key adjustment.
        e.target.setAttribute("aria-valuenow", String(e.target.value));
        e.target.setAttribute("aria-valuetext", tf("shell.criteria.weightOfTen", { value: e.target.value }));
        const total = Array.from(criteriaContainer.querySelectorAll(".vk-weight"))
          .reduce((sum, el) => sum + (Number(el.value) || 0), 0);
        const totalEl = criteriaContainer.querySelector(".vk-total-value");
        if (totalEl) totalEl.textContent = String(total);
      }
      // B4 (#451) a11y: when the label changes, update the remove-button's aria-label so
      // it always says "Fjern: {current label}". Without this, screen readers would
      // announce the stale name set at render time.
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

    criteriaContainer.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.classList.contains("vk-remove")) {
        captureCriteriaFromDom();
        const idx = Number(btn.dataset.criterionIndex);
        if (Number.isFinite(idx)) {
          criteriaEditorState.splice(idx, 1);
          reRenderCriteria();
        }
      } else if (btn.classList.contains("vk-add")) {
        captureCriteriaFromDom();
        criteriaEditorState.push({
          id: `new_criterion_${nextNewCriterionId++}`,
          label: "",
          description: "",
          maxScore: 5,
          candidateVisible: false,
        });
        reRenderCriteria();
        const inputs = criteriaContainer.querySelectorAll(".vk-label");
        inputs[inputs.length - 1]?.focus();
      } else if (btn.classList.contains("vk-regenerate")) {
        captureCriteriaFromDom();
        // v1.1.80: ingen confirm-dialog her. Endringene i editoren er ikke persistert
        // ennå — lukker du edit-modus uten å lagre, så er de like borte uansett. Den
        // gamle dialogen forhindret kun et tilfeldig museklikk og kostet en ekstra OK
        // hver gang. Confirm-dialogen for B3 drift-banner ("Regenerer fra ny plan") er
        // beholdt der den faktisk skriver til DB umiddelbart.
        regenerateCriteriaFromTask(criteriaContainer, (newList) => {
          criteriaEditorState = newList;
          reRenderCriteria();
        });
      }
    });
  }

  function exitEditMode() {
    if (previewPaneEl) previewPaneEl.classList.remove("preview-pane--editing");
    // v1.1.92: clear the criteriaReadyCallback so async generation that completes after
    // exit doesn't try to write into a torn-down DOM.
    criteriaReadyCallback = null;
    renderPreview();
  }

  document.getElementById("previewEditCancel").addEventListener("click", () => {
    exitEditMode();
    if (sessionDraft) showDraftReadyActions(); else showModuleActions();
  });

  document.getElementById("previewEditConfirm").addEventListener("click", () => {
    const newTitle = document.getElementById("previewEditTitle").value.trim() || currentTitle;
    const newTaskText = document.getElementById("previewEditTaskText").value.trim() || currentTaskText;
    const newGuidanceText = document.getElementById("previewEditGuidanceText").value.trim() || currentGuidanceText;
    const newCandidateTaskConstraints = document.getElementById("previewEditCandidateTaskConstraints").value.trim() || currentCandidateTaskConstraints;
    // B2 (#449 redesign): capture criteria-editor state into a normalized record before
    // exitEditMode tears down the DOM. transform to storage shape (id-keyed) with weight
    // derived from maxScore. Empty/blank labels are dropped (matching the validation in
    // the save flow). Returns null when criteria section wasn't rendered (no rubric).
    const newCriteriaRecord = criteriaContainer
      ? buildCriteriaRecordFromEditorState(captureLatestCriteriaState(criteriaContainer, criteriaEditorState))
      : null;
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
        rationale: container?.querySelector(`#previewEditMcqRationale${questionIndex}`)?.value.trim() || question.rationale,
      };
    });

    exitEditMode();

    const abort = startGeneration();
    const slot = logProgress(() => t("shell.directEdit.translating"));
    slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

    Promise.all([
      localizeDraftAcrossLocalesWithTitle(newTitle, newTaskText, newGuidanceText, editingLocale, newCandidateTaskConstraints),
      currentMcqQuestions.length ? localizeMcqAcrossLocales(newMcqQuestions, editingLocale) : Promise.resolve([]),
    ])
      .then(([localizedDraft, localizedMcqQuestions]) => {
        generationAbort = null;
        sessionDraft = buildPreviewCandidate({
          title: localizedDraft.title,
          taskText: localizedDraft.taskText,
          assessorExpectedContent: localizedDraft.assessorExpectedContent,
          candidateTaskConstraints: localizedDraft.candidateTaskConstraints,
          mcqQuestions: localizedMcqQuestions,
          criteria: newCriteriaRecord,
        });
        sessionState = "draft-pending";
        clearPreviewCandidate();
        logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.directEdit.done"))}</strong>`);
        showDraftReadyActions();
      })
      .catch(() => {
        generationAbort = null;
        sessionDraft = buildPreviewCandidate({
          title: buildLocalizedTextMap(editingLocale, newTitle),
          taskText: buildLocalizedTextMap(editingLocale, newTaskText),
          assessorExpectedContent: buildLocalizedTextMap(editingLocale, newGuidanceText),
          candidateTaskConstraints: buildLocalizedTextMap(editingLocale, newCandidateTaskConstraints),
          mcqQuestions: buildLocalizedMcqDraft(newMcqQuestions, editingLocale),
          criteria: newCriteriaRecord,
        });
        sessionState = "draft-pending";
        clearPreviewCandidate();
        logResolveSlot(slot, () => escapeHtml(t("shell.directEdit.translateError")));
        showDraftReadyActions();
      });
  });

  logBot(() => escapeHtml(t("shell.directEdit.editingHint")));
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
    directEdit: { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
    editAdvanced: { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(selectedModuleId) },
    pickAnother: { labelKey: "shell.module.pickAnother", action: startModulePicker },
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
  logBot(() => t("shell.module.actionsPrompt"), model.actionKeys.map((key) => actionMap[key]).filter(Boolean));
  if (model.shouldOfferUnifiedRevision) {
    startUnifiedRevisionFlow();
  }
}

function openAdvancedEditor(moduleId) {
  const url = buildAdminContentAdvancedUrl(moduleId);
  const hasUnsavedDraft =
    !!sessionDraft &&
    !!(sessionDraft.taskText || sessionDraft.assessorExpectedContent || (sessionDraft.mcqQuestions?.length ?? 0) > 0);

  if (!hasUnsavedDraft) {
    // No unsaved work — carry locale context only so the advanced editor can restore it
    writeHandoff({ moduleId: moduleId ?? null, source: "shell", draft: null, locale: currentLocale, previewLocale });
    logBot(() => t("shell.module.openingEditor"));
    setTimeout(() => { location.href = url; }, 400);
    return;
  }

  // Has unsaved work — ask what to do
  // v1.2.26 (#361): "Take draft" carries the FULL sessionDraft to Avansert as a handoff
  // so user can continue editing in Avansert without losing unsaved work. Previously
  // this action discarded the draft.
  const takeDraftAndNavigate = () => {
    writeHandoff({
      moduleId: moduleId ?? null,
      source: "shell",
      draft: {
        title: sessionDraft?.title,
        description: sessionDraft?.description,
        taskText: sessionDraft?.taskText,
        candidateTaskConstraints: sessionDraft?.candidateTaskConstraints,
        assessorExpectedContent: sessionDraft?.assessorExpectedContent,
        mcqQuestions: sessionDraft?.mcqQuestions ?? [],
        criteria: sessionDraft?.criteria ?? null,
        assessmentBlueprint: sessionDraft?.assessmentBlueprint ?? null,
      },
      locale: currentLocale,
      previewLocale,
    });
    logBot(() => t("shell.module.openingEditor"));
    setTimeout(() => { location.href = url; }, 400);
  };

  // v1.1.73 (#447 follow-up): default handoff action is "save first, then open" — this avoids
  // the race condition where Avansert opens for a freshly-created module that isn't yet visible
  // in /api/admin/content/modules ("Modul ID påkrevd" error). Users who regret can delete the
  // module after; that's cheaper UX than maintaining the take-draft-to-Avansert code path.
  const saveAndNavigate = () => {
    saveDraftBundleInBackground({ afterSave: navigateWithoutDraft });
  };

  logBot(() => t("handoff.hasDraft.prompt"), [
    { labelKey: "handoff.hasDraft.saveAndOpen", action: saveAndNavigate },
    { labelKey: "handoff.hasDraft.discard", action: takeDraftAndNavigate },
    { labelKey: "shell.action.cancel", action: showModuleActions },
  ]);
}

function bindModeSwitchButtons() {
  if (modeSwitchAdvancedBtn) {
    modeSwitchAdvancedBtn.addEventListener("click", () => openAdvancedEditor(selectedModuleId));
  }
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
        // v1.2.18 (#352): legacy /admin-content/advanced retired — send brukeren tilbake til
        // modul-bibliotek der de kan velge en eksisterende modul eller opprette en ny.
        { labelKey: "shell.action.openAdvancedEditor", action: () => { location.href = "/admin-content"; } },
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
  renderPreview();

  generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onDraftReady, blueprint, scenarioMode);
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
  const taskText = String(translateLocalizedText(sessionDraft.taskText ?? "") ?? "").trim();
  const assessorText = String(translateLocalizedText(sessionDraft.assessorExpectedContent ?? "") ?? "").trim();
  if (!taskText || !assessorText) return;
  const constraintsText = String(translateLocalizedText(sessionDraft.candidateTaskConstraints ?? "") ?? "").trim();

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
  renderPreview();
  try {
    const result = await apiFetch("/api/admin/content/generate/rubric", getHeaders, {
      method: "POST",
      body: JSON.stringify({
        taskText,
        assessorExpectedContent: assessorText,
        candidateTaskConstraints: constraintsText || undefined,
        certificationLevel: bundle?.module?.certificationLevel ?? "intermediate",
        locale: currentLocale,
        ...(blueprintObject ? { blueprint: blueprintObject } : {}),
      }),
    });
    const generated = Array.isArray(result?.rubric?.criteria) ? result.rubric.criteria : [];
    const record = llmCriteriaArrayToStorageRecord(generated);
    if (sessionDraft && Object.keys(record).length > 0) {
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
  }
}

function showDraftReadyActions() {
  sessionState = "draft-pending";
  // v1.1.81: kick off criteria-generation in background so preview shows them.
  // Idempotent — does nothing if sessionDraft.criteria is already populated.
  populateSessionDraftCriteriaInBackground();
  const mcqCount = sessionDraft?.mcqQuestions?.length ?? 0;
  const model = deriveShellDraftReadyActionModel({ hasSelectedModule: !!selectedModuleId });
  const actionMap = {
    directEdit: { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
    revise: { labelKey: "shell.draftReady.editInChat", action: () => startUnifiedRevisionFlow() },
    openEditor: { labelKey: "shell.draftReady.openEditor", action: () => openAdvancedEditor(selectedModuleId) },
    restart: { labelKey: "shell.draftReady.restart", action: startIdle },
    saveDraft: { labelKey: "shell.draftReady.saveDraft", action: saveDraftBundleInBackground },
  };
  logBot(() => {
    const parts = [t("shell.draftReady.message")];
    if (mcqCount > 0) parts.push(tf("shell.draftReady.mcqCount", { count: mcqCount }));
    parts.push(t("shell.draftReady.hint"));
    return escapeHtml(parts.join(" "));
  }, model.actionKeys.map((key) => actionMap[key]).filter(Boolean));
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

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Content Workspace v${version}`;
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }
}

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
    localStorage.setItem("participant.locale", chosen);
    const prev = currentLocale;
    currentLocale = chosen;
    // Keep preview locale in sync if it wasn't manually overridden
    if (previewLocale === prev) previewLocale = chosen;
    // Replay the full chat log in the new locale
    retranslateChat();
    translatePageStaticText();
    renderPreviewLocaleBar();
    renderPreview();
    renderWorkspaceNavigation();
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
  bindModeSwitchButtons();
  renderPreviewLocaleBar();
  renderPreview();
  loadVersion();
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
