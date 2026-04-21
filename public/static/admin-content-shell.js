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
import { writeHandoff, readAndClearHandoff } from "/static/admin-content-handoff.js";
import { localizeValueForLocale, buildPreviewHtml } from "/static/admin-content-preview.js";
import {
  detectShellRevisionTargets,
  deriveShellModuleActionModel,
  deriveShellDraftReadyActionModel,
  resolveShellResumeBehavior,
} from "/static/admin-content-shell-state.js";
import { buildAdminContentAdvancedUrl } from "/static/admin-content-handoff-routes.js";
import { deriveModuleStatusChains } from "/static/module-status-logic.js";

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
let sessionDraft = null; // { taskText, guidanceText, mcqQuestions: [] }
let previewDraft = null; // review candidate shown in preview before accept
let latestSavedModuleVersionId = null;

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

const SOURCE_MATERIAL_MAX_BYTES = 2 * 1024 * 1024;
const SOURCE_MATERIAL_MAX_CHARS = 50000;
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

// Creates a progress bubble with an abort button. Returns { el, abortBtn }.
// textKeyOrFn: i18n key string OR () => string for dynamic text.
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
  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
  abortBtn.className = "btn-secondary chat-choice-btn";
  abortBtn.textContent = t("shell.action.cancel");
  msg.appendChild(abortBtn);
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
  let uploadedSourceMaterial = null;

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

  if (isSourceMaterial) {
    const uploadRow = document.createElement("div");
    uploadRow.className = "chat-form-row";

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "btn-secondary chat-choice-btn";
    uploadBtn.textContent = t("shell.source.uploadBtn");

    const uploadHint = document.createElement("span");
    uploadHint.className = "chat-form-help";
    uploadHint.textContent = t("shell.source.uploadHint");

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = SOURCE_MATERIAL_ACCEPT;
    fileInput.hidden = true;

    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      if (!isSupportedSourceMaterialFile(file)) {
        showToast(t("shell.source.fileTypeInvalid"), "error");
        fileInput.value = "";
        return;
      }
      if (file.size > SOURCE_MATERIAL_MAX_BYTES) {
        showToast(t("shell.source.fileTooLarge"), "error");
        fileInput.value = "";
        return;
      }

      const originalLabel = uploadBtn.textContent;
      uploadBtn.disabled = true;
      uploadBtn.textContent = t("shell.source.uploading");

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
        if (!trimmedText) {
          throw new Error("empty_extracted_text");
        }
        uploadedSourceMaterial = {
          fileName: file.name,
          extractedText: trimmedText,
        };
        uploadHint.textContent = tf("shell.source.fileImported", { fileName: file.name });
        inputEl.focus();
        showToast(t("shell.source.fileReady"), "success");
      } catch (error) {
        showToast(parseApiErrorMessage(error, "shell.source.fileReadError"), "error");
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = originalLabel;
        fileInput.value = "";
      }
    });

    uploadRow.appendChild(uploadBtn);
    uploadRow.appendChild(uploadHint);
    uploadRow.appendChild(fileInput);
    wrap.appendChild(uploadRow);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary chat-submit-btn";
  btn.textContent = t(entry.submitKey);

  function submit() {
    if (isSourceMaterial) {
      const notes = inputEl.value.trim();
      const uploadedText = uploadedSourceMaterial?.extractedText ?? "";
      const combinedSourceMaterial = [uploadedText, notes].filter(Boolean).join("\n\n").trim();
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
  setTimeout(() => inputEl.focus(), 80);
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
function logForm(formType, promptHtmlFn, placeholderKey, submitKey, onSubmit, initialValue = "") {
  const entry = { kind: "form", formType, promptHtml: promptHtmlFn, placeholderKey, submitKey, onSubmit, submitted: false, initialValue };
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

function renderPreview() {
  const opts = { locale: previewLocale, t, tf };

  if (!bundle && !sessionDraft && !previewDraft) {
    previewContent.innerHTML = buildPreviewHtml({ emptyText: t("adminContent.status.noneTitle") }, opts);
    updateStateRail();
    return;
  }

  const activeDraft = previewDraft ?? sessionDraft;
  const hasDraft = !!activeDraft;

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
      title: mod.title,
      description: mod.description,
      taskText: hasDraft ? activeDraft.taskText : (cfg.moduleVersion?.taskText ?? ""),
      guidanceText: hasDraft ? activeDraft.guidanceText : (cfg.moduleVersion?.guidanceText ?? ""),
      mcqQuestions: hasDraft ? (activeDraft.mcqQuestions ?? []) : (cfg.mcqSetVersion?.questions ?? []),
      versionChain: versionChainParts.join(" · "),
      badgeClass: hasDraft ? "draft" : isLive ? "live" : isDraft ? "draft" : "shell",
      badgeText: hasDraft
        ? t("shell.draft.unsavedBadge")
        : isLive ? t("adminContent.status.badge.live")
        : isDraft ? t("adminContent.status.badge.draft")
        : t("adminContent.status.badge.shellOnly"),
    }, opts);
  } else if (hasDraft) {
    previewContent.innerHTML = buildPreviewHtml({
      title: activeDraft.title || t("shell.newModule.defaultTitle"),
      taskText: activeDraft.taskText ?? "",
      guidanceText: activeDraft.guidanceText ?? "",
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
    srModuleName.textContent = localizeValue(bundle?.module?.title) || selectedModuleId;
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
      srChanges.innerHTML = `<span class="state-rail-value" style="color:var(--color-success)">${escapeHtml(t("stateRail.changes.saved"))}</span>`;
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
    title: patch.title ?? baseDraft.title ?? sessionDraft?.title ?? "",
    taskText: patch.taskText ?? baseDraft.taskText ?? sessionDraft?.taskText ?? "",
    guidanceText: patch.guidanceText ?? baseDraft.guidanceText ?? sessionDraft?.guidanceText ?? "",
    mcqQuestions: patch.mcqQuestions ?? baseDraft.mcqQuestions ?? sessionDraft?.mcqQuestions ?? [],
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

async function localizeDraftAcrossLocales(taskText, guidanceText, sourceLocale) {
  const localized = {
    taskText: buildLocalizedTextMap(sourceLocale, taskText),
    guidanceText: buildLocalizedTextMap(sourceLocale, guidanceText),
  };

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;
    const result = await apiFetch(
      "/api/admin/content/generate/module-draft/localize",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ taskText, guidanceText, sourceLocale, targetLocale }),
      },
    );
    const draft = result?.draft ?? result;
    localized.taskText[targetLocale] = draft?.taskText ?? taskText;
    localized.guidanceText[targetLocale] = draft?.guidanceText ?? guidanceText;
  }

  return localized;
}

async function localizeDraftAcrossLocalesWithTitle(title, taskText, guidanceText, sourceLocale) {
  const localized = {
    title: buildLocalizedTextMap(sourceLocale, title),
    taskText: buildLocalizedTextMap(sourceLocale, taskText),
    guidanceText: buildLocalizedTextMap(sourceLocale, guidanceText),
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
          body: JSON.stringify({ title, taskText, guidanceText, sourceLocale, targetLocale }),
        },
      );
    } catch {
      // Graceful degradation: keep source text for failed locale
      continue;
    }
    const draft = result?.draft ?? result;
    localized.title[targetLocale] = draft?.title ?? title;
    localized.taskText[targetLocale] = draft?.taskText ?? taskText;
    localized.guidanceText[targetLocale] = draft?.guidanceText ?? guidanceText;
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

function resolveCurrentRubricPayload() {
  const rubric = bundle?.selectedConfiguration?.rubricVersion;
  return {
    criteria: rubric?.criteria ?? tryParseJsonTranslation("adminContent.defaults.criteriaJson", {}),
    scalingRule: rubric?.scalingRule ?? tryParseJsonTranslation("adminContent.defaults.scalingRuleJson", {}),
    passRule: rubric?.passRule ?? tryParseJsonTranslation("adminContent.defaults.passRuleJson", {}),
  };
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
  const guidanceText = sessionDraft?.guidanceText ?? bundle?.selectedConfiguration?.moduleVersion?.guidanceText ?? "";
  const mcqQuestions = sessionDraft?.mcqQuestions?.length
    ? sessionDraft.mcqQuestions
    : (bundle?.selectedConfiguration?.mcqSetVersion?.questions ?? []);

  return { taskText, guidanceText, mcqQuestions };
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
    guidanceText: moduleVersion?.guidanceText ?? "",
    mcqQuestions,
  });
  previewDraft = null;
  sessionState = "draft-pending";
  renderPreviewLocaleBar();
  renderPreview();
  return true;
}

function applyHandoffDraft(draft) {
  if (!draft?.taskText && !draft?.guidanceText && !(draft?.mcqQuestions?.length > 0)) {
    return false;
  }
  sessionDraft = buildPreviewCandidate({
    title: bundle?.module?.title ?? "",
    taskText: draft.taskText ?? "",
    guidanceText: draft.guidanceText ?? "",
    mcqQuestions: draft.mcqQuestions ?? [],
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

async function generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onAccept) {
  const abort = startGeneration();
  const slot = logProgress("shell.generating.draftProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  let result;
  try {
    result = await apiFetch(
      "/api/admin/content/generate/module-draft",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale, generationMode }),
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
      { labelKey: "shell.action.retry", action: () => generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const draft = result?.draft ?? result;
  const localizedDraft = await localizeDraftAcrossLocales(draft.taskText, draft.guidanceText, locale);
  sessionDraft = buildPreviewCandidate({ taskText: localizedDraft.taskText, guidanceText: localizedDraft.guidanceText });
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

  let result;
  try {
    result = await apiFetch(
      "/api/admin/content/generate/mcq",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale, generationMode, questionCount, optionCount }),
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
  logResolveSlot(
    slot,
    () => `<strong>${escapeHtml(tf("shell.generating.mcqReady", { count: questions.length }))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>`,
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
          guidanceText: localizeValueForLocale(sessionDraft?.guidanceText ?? "", currentLocale),
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
  const localizedDraft = await localizeDraftAcrossLocales(draft.taskText, draft.guidanceText, currentLocale);
  sessionDraft = buildPreviewCandidate({ taskText: localizedDraft.taskText, guidanceText: localizedDraft.guidanceText });
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

async function saveDraftBundleInBackground(options = {}) {
  const { afterSave = null } = options;
  const moduleId = selectedModuleId;
  if (!moduleId) {
    logBot(() => t("shell.save.moduleRequired"));
    return;
  }

  const { taskText, guidanceText, mcqQuestions } = resolveDraftForSave();
  if (!localizeValueForLocale(taskText, currentLocale).trim()) {
    logBot(() => t("shell.save.taskRequired"));
    return;
  }
  if (!mcqQuestions.length) {
    logBot(() => t("shell.save.mcqRequired"));
    return;
  }

  const slot = logProgress("shell.save.progress");
  slot.abortBtn.remove();

  try {
    const rubricPayload = resolveCurrentRubricPayload();
    const promptPayload = resolveCurrentPromptPayload();

    if (sessionDraft?.title && typeof sessionDraft.title === "object") {
      await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/title`, getHeaders, {
        method: "PATCH",
        body: JSON.stringify({ title: sessionDraft.title }),
      });
    }

    const rubricBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/rubric-versions`, getHeaders, {
      method: "POST",
      body: JSON.stringify(rubricPayload),
    });

    const promptBody = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/prompt-template-versions`, getHeaders, {
      method: "POST",
      body: JSON.stringify(promptPayload),
    });

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
        taskText: translateLocalizedText(taskText),
        guidanceText: translateLocalizedText(guidanceText),
        rubricVersionId: rubricBody?.rubricVersion?.id,
        promptTemplateVersionId: promptBody?.promptTemplateVersion?.id,
        mcqSetVersionId: mcqBody?.mcqSetVersion?.id,
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
    latestSavedModuleVersionId = moduleVersionId;
    await loadModule(moduleId);
    logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.publish.success"))}</strong>`);
    showToast(t("shell.publish.success"), "success");
    announceStatus(t("shell.publish.success"));
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
          passRule: sourceConfig.rubricVersion.passRule,
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
          guidanceText: sourceConfig.moduleVersion.guidanceText,
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

  // Check for a handoff payload written by the advanced editor (or by ourselves before navigating away).
  // Handoff wins over resumeEditing: it carries more recent unsaved state than the saved bundle.
  const handoff = readAndClearHandoff(moduleId);
  if (handoff?.locale && supportedLocales.includes(handoff.locale) && handoff.locale !== currentLocale) {
    currentLocale = handoff.locale;
    if (handoff.previewLocale && supportedLocales.includes(handoff.previewLocale)) {
      previewLocale = handoff.previewLocale;
    }
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
    hasDraft: !!(sessionDraft?.taskText || sessionDraft?.guidanceText),
    hasMcq: (sessionDraft?.mcqQuestions?.length ?? 0) > 0,
  });
}

async function runUnifiedRevision(instruction) {
  const targets = detectRevisionTargets(instruction);

  if (!targets.draft && !targets.mcq) {
    logBot(() => t("shell.revision.unavailable"));
    return;
  }

  if (targets.draft) {
    await reviseDraftInBackground(instruction);
  }
  if (targets.mcq) {
    await reviseMcqInBackground(instruction);
  }
  showDraftReadyActions();
}

function startUnifiedRevisionFlow() {
  if (!sessionDraft?.taskText && !sessionDraft?.guidanceText && (sessionDraft?.mcqQuestions?.length ?? 0) === 0) {
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

function enterPreviewEditMode() {
  const currentTitle = localizeValue(sessionDraft?.title ?? bundle?.module?.title) || "";
  const currentTaskText = localizeValueForLocale(
    sessionDraft?.taskText ?? bundle?.selectedConfiguration?.moduleVersion?.taskText ?? "",
    currentLocale,
  );
  const currentGuidanceText = localizeValueForLocale(
    sessionDraft?.guidanceText ?? bundle?.selectedConfiguration?.moduleVersion?.guidanceText ?? "",
    currentLocale,
  );

  // Lock locale bar and signal edit mode visually
  const previewPaneEl = document.querySelector(".preview-pane");
  if (previewPaneEl) previewPaneEl.classList.add("preview-pane--editing");

  // Build edit-mode HTML using same visual classes as preview
  const escapedTitle = escapeHtml(currentTitle);
  const escapedTask = escapeHtml(currentTaskText);
  const escapedGuidance = escapeHtml(currentGuidanceText);
  const labelTask = escapeHtml(t("adminContent.moduleVersion.taskText"));
  const labelGuidance = escapeHtml(t("adminContent.moduleVersion.guidanceText"));

  previewContent.innerHTML = `
    <div class="preview-module-header">
      <input id="previewEditTitle" class="preview-edit-title" value="${escapedTitle}"
        aria-label="${escapeHtml(t("shell.directEdit.titlePlaceholder"))}" />
      <span class="module-status-badge draft">${escapeHtml(t("shell.directEdit.editingBadge"))}</span>
    </div>
    <div class="preview-section-label">${labelTask}</div>
    <textarea id="previewEditTaskText" class="preview-edit-textarea"
      aria-label="${labelTask}">${escapedTask}</textarea>
    <div class="preview-section-label">${labelGuidance}</div>
    <textarea id="previewEditGuidanceText" class="preview-edit-textarea preview-edit-textarea--secondary"
      aria-label="${labelGuidance}">${escapedGuidance}</textarea>
    <div class="preview-edit-actions">
      <button id="previewEditCancel" class="btn-secondary">${escapeHtml(t("shell.action.cancel"))}</button>
      <button id="previewEditConfirm" class="btn-primary">${escapeHtml(t("shell.directEdit.submit"))}</button>
    </div>
  `.trim();

  scrollPreviewToTop();
  document.getElementById("previewEditTitle")?.focus();

  function exitEditMode() {
    if (previewPaneEl) previewPaneEl.classList.remove("preview-pane--editing");
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

    exitEditMode();

    const abort = startGeneration();
    const slot = logProgress(() => t("shell.directEdit.translating"));
    slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

    localizeDraftAcrossLocalesWithTitle(newTitle, newTaskText, newGuidanceText, currentLocale)
      .then((localized) => {
        generationAbort = null;
        sessionDraft = buildPreviewCandidate({
          title: localized.title,
          taskText: localized.taskText,
          guidanceText: localized.guidanceText,
        });
        sessionState = "draft-pending";
        clearPreviewCandidate();
        logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.directEdit.done"))}</strong>`);
        showDraftReadyActions();
      })
      .catch(() => {
        generationAbort = null;
        sessionDraft = buildPreviewCandidate({
          title: buildLocalizedTextMap(currentLocale, newTitle),
          taskText: buildLocalizedTextMap(currentLocale, newTaskText),
          guidanceText: buildLocalizedTextMap(currentLocale, newGuidanceText),
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
      labelKey: "shell.draftReady.publish",
      action: () => confirmHighImpactAction("shell.publish.confirmPrompt", "shell.publish.confirmAction", publishLatestDraftInBackground, showModuleActions, { module: moduleLabel }),
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
    !!(sessionDraft.taskText || sessionDraft.guidanceText || (sessionDraft.mcqQuestions?.length ?? 0) > 0);

  if (!hasUnsavedDraft) {
    // No unsaved work — carry locale context only so the advanced editor can restore it
    writeHandoff({ moduleId: moduleId ?? null, source: "shell", draft: null, locale: currentLocale, previewLocale });
    logBot(() => t("shell.module.openingEditor"));
    setTimeout(() => { location.href = url; }, 400);
    return;
  }

  // Has unsaved work — ask what to do
  const navigateWithDraft = () => {
    writeHandoff({ moduleId: moduleId ?? null, source: "shell", draft: sessionDraft, locale: currentLocale, previewLocale });
    logBot(() => t("shell.module.openingEditor"));
    setTimeout(() => { location.href = url; }, 400);
  };
  const navigateWithoutDraft = () => {
    writeHandoff({ moduleId: moduleId ?? null, source: "shell", draft: null, locale: currentLocale, previewLocale });
    logBot(() => t("shell.module.openingEditor"));
    setTimeout(() => { location.href = url; }, 400);
  };

  logBot(() => t("handoff.hasDraft.prompt"), [
    { labelKey: "handoff.hasDraft.takeDraft", action: navigateWithDraft },
    {
      labelKey: "handoff.hasDraft.saveFirst",
      action: () => saveDraftBundleInBackground({ afterSave: navigateWithoutDraft }),
    },
    { labelKey: "handoff.hasDraft.discard", action: navigateWithoutDraft },
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
    (title) => askForSourceMaterial(title, null),
  );
}

// ---------------------------------------------------------------------------
// Source material → cert level → locale → generate
// ---------------------------------------------------------------------------

function askForSourceMaterial(moduleTitle, existingModuleId) {
  logForm(
    "source-material",
    () => `<strong>${escapeHtml(t("shell.source.promptTitle"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.source.promptHint"))}</span>`,
    "shell.source.placeholder",
    "shell.action.next",
    (sourceMaterial) => askForCertLevel(moduleTitle, existingModuleId, sourceMaterial),
  );
}

function askForCertLevel(moduleTitle, existingModuleId, sourceMaterial) {
  logBot(() => t("shell.certLevel.prompt"), [
    { labelKey: "shell.certLevel.basic", action: () => askForGenerationMode(moduleTitle, existingModuleId, sourceMaterial, "basic", currentLocale) },
    { labelKey: "shell.certLevel.intermediate", action: () => askForGenerationMode(moduleTitle, existingModuleId, sourceMaterial, "intermediate", currentLocale) },
    { labelKey: "shell.certLevel.advanced", action: () => askForGenerationMode(moduleTitle, existingModuleId, sourceMaterial, "advanced", currentLocale) },
  ]);
}

function askForGenerationMode(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale) {
  logBot(() => t("shell.generationMode.prompt"), [
    { labelKey: "shell.generationMode.ordinary", action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale, "ordinary") },
    { labelKey: "shell.generationMode.thorough", action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale, "thorough") },
  ]);
}

async function confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale, generationMode) {
  if (existingModuleId) {
    const capturedTitle = localizeValue(bundle?.module?.title) || existingModuleId;
    const levelKey = `shell.certLevel.${certLevel}`;
    const genLocale = locale;
    logBot(() =>
      `${escapeHtml(t("shell.generating.startingFor"))} <strong>${escapeHtml(capturedTitle)}</strong>…<br>` +
      `<span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.certLevel.label"))}: ${escapeHtml(t(levelKey) || certLevel)} · ${escapeHtml(t("shell.locale.label"))}: ${escapeHtml(localeLabels[genLocale] ?? genLocale)}</span>`,
    );
    generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, () => {
      askForMcqGeneration(sourceMaterial, certLevel, locale, generationMode);
    });
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
        { labelKey: "shell.action.openAdvancedEditor", action: () => { location.href = "/admin-content/advanced"; } },
        { labelKey: "shell.action.retry", action: () => confirmAndGenerate(moduleTitle, null, sourceMaterial, certLevel, locale, generationMode) },
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

  sessionDraft = { title: moduleTitle, taskText: "", guidanceText: "", mcqQuestions: [] };
  renderPreview();

  generateDraftInBackground(sourceMaterial, certLevel, locale, generationMode, () => {
    askForMcqGeneration(sourceMaterial, certLevel, locale, generationMode);
  });
}

function askForMcqGeneration(sourceMaterial, certLevel, locale, generationMode) {
  logBot(() => t("shell.askMcq.prompt"), [
    { labelKey: "shell.askMcq.yes", action: () => askForMcqQuestionCount(sourceMaterial, certLevel, locale, generationMode, () => showDraftReadyActions()) },
    { labelKey: "shell.askMcq.no",  action: showDraftReadyActions },
  ]);
}

function showDraftReadyActions() {
  sessionState = "draft-pending";
  const mcqCount = sessionDraft?.mcqQuestions?.length ?? 0;
  const model = deriveShellDraftReadyActionModel({ hasSelectedModule: !!selectedModuleId });
  const actionMap = {
    directEdit: { labelKey: "shell.directEdit.action", action: () => startDirectEditFlow() },
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

// Separate entry point for MCQ-only generation from the module actions menu
function startGenerateDraftFlow() {
  askForSourceMaterial(null, selectedModuleId);
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
  logBot(() => t("shell.mcqCertLevel.prompt"), [
    { labelKey: "shell.certLevel.basic", action: () => askForMcqGenerationMode(sourceMaterial, "basic", currentLocale, () => showModuleActions()) },
    { labelKey: "shell.certLevel.intermediate", action: () => askForMcqGenerationMode(sourceMaterial, "intermediate", currentLocale, () => showModuleActions()) },
    { labelKey: "shell.certLevel.advanced", action: () => askForMcqGenerationMode(sourceMaterial, "advanced", currentLocale, () => showModuleActions()) },
  ]);
}

function askForMcqGenerationMode(sourceMaterial, certLevel, locale, onAccept) {
  logBot(() => t("shell.generationMode.prompt"), [
    { labelKey: "shell.generationMode.ordinary", action: () => askForMcqQuestionCount(sourceMaterial, certLevel, locale, "ordinary", onAccept) },
    { labelKey: "shell.generationMode.thorough", action: () => askForMcqQuestionCount(sourceMaterial, certLevel, locale, "thorough", onAccept) },
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
  const roles = participantRuntimeConfig.identityDefaults?.roles?.join(",") ?? "SUBJECT_MATTER_OWNER";
  const allItems = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    roles,
    window.location.pathname,
  ).filter((item) => item.visible);

  const profileItem = allItems.find((item) => item.id === "profile");
  const items = allItems.filter((item) => item.id !== "profile");

  workspaceNav.innerHTML = "";
  workspaceNav.hidden = items.length === 0;
  for (const item of items) {
    const a = document.createElement("a");
    a.href = item.path;
    a.className = item.active ? "workspace-nav-link active" : "workspace-nav-link";
    a.textContent = t(item.labelKey) || item.id;
    workspaceNav.appendChild(a);
  }

  if (profileItem) {
    const localePicker = document.querySelector(".locale-picker");
    if (localePicker) {
      let profileLink = document.getElementById("profileNavLink");
      if (!profileLink) {
        profileLink = document.createElement("a");
        profileLink.id = "profileNavLink";
        localePicker.appendChild(profileLink);
      }
      profileLink.href = profileItem.path;
      profileLink.textContent = t(profileItem.labelKey);
      profileLink.className = profileItem.active ? "workspace-nav-link active" : "workspace-nav-link";
    }
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
