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
  if (!value) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        return parsed[previewLocale] ?? parsed["nb"] ?? parsed["en-GB"] ?? Object.values(parsed)[0] ?? "";
      }
    } catch {
      // plain string
    }
    return value;
  }
  if (typeof value === "object") {
    return value[previewLocale] ?? value["nb"] ?? value["en-GB"] ?? Object.values(value)[0] ?? "";
  }
  return String(value);
}

function localizeOptionList(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => localizeValue(option)).filter(Boolean);
}

function renderPreviewMcqQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return "";

  const questionItems = questions
    .map((question, index) => {
      const stem = localizeValue(question?.stem ?? "");
      const rationale = localizeValue(question?.rationale ?? "");
      const correctAnswer = localizeValue(question?.correctAnswer ?? "");
      const options = localizeOptionList(question?.options);
      const optionItems = options
        .map((option) => {
          const isCorrect = correctAnswer && option === correctAnswer;
          return `<li class="preview-mcq-option${isCorrect ? " correct" : ""}">${escapeHtml(option)}</li>`;
        })
        .join("");

      const rationaleHtml = rationale
        ? `
          <div class="preview-mcq-meta">
            <span class="preview-mcq-meta-label">${escapeHtml(t("shell.preview.rationale"))}</span>
            <span>${escapeHtml(rationale)}</span>
          </div>`
        : "";

      return `
        <article class="preview-mcq-item">
          <div class="preview-mcq-question-header">${escapeHtml(tf("shell.preview.questionNumber", { number: index + 1 }))}</div>
          <div class="preview-mcq-stem">${escapeHtml(stem)}</div>
          <ol class="preview-mcq-options" type="A">
            ${optionItems}
          </ol>
          <div class="preview-mcq-meta">
            <span class="preview-mcq-meta-label">${escapeHtml(t("shell.preview.correctAnswer"))}</span>
            <span>${escapeHtml(correctAnswer)}</span>
          </div>
          ${rationaleHtml}
        </article>`;
    })
    .join("");

  return `
    <div class="preview-section-label">${escapeHtml(t("shell.preview.mcqSection"))}</div>
    <div class="preview-mcq-list">
      ${questionItems}
    </div>`;
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

// Chat log — every rendered message is stored here as a re-renderable spec so
// that retranslateChat() can rebuild the entire dialog on locale switch.
// Entry kinds:
//   { kind:'bot',   html:()=>string, choices:Choice[], active:bool }
//   { kind:'user',  text:string }
//   { kind:'form',  formType:'text'|'textarea', promptHtml:()=>string,
//                   placeholderKey:string, submitKey:string, onSubmit:fn, submitted:bool }
//   { kind:'module-choices', modules:Module[], active:bool }
// Choice: { labelKey:string, action:()=>void }
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
function _domChoiceRow(choices, disabled) {
  const row = document.createElement("div");
  row.className = "chat-choices";
  for (const c of choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary chat-choice-btn";
    btn.textContent = t(c.labelKey);
    btn.disabled = disabled;
    if (!disabled) {
      btn.addEventListener("click", () => {
        _disableAllDomChoices();
        _deactivateAll();
        logUser(t(c.labelKey));
        c.action();
      });
    }
    row.appendChild(btn);
  }
  return row;
}

function _domBotBubble(html, choices, disabled) {
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--bot";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = html;
  msg.appendChild(bubble);
  if (choices && choices.length > 0) {
    msg.appendChild(_domChoiceRow(choices, disabled));
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
  wrap.className = entry.formType === "textarea" ? "chat-form-col" : "chat-form-row";

  let inputEl;
  if (entry.formType === "textarea") {
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

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary chat-submit-btn";
  btn.textContent = t(entry.submitKey);

  function submit() {
    const val = inputEl.value.trim();
    if (!val) { inputEl.focus(); return; }
    btn.disabled = true;
    inputEl.disabled = true;
    entry.submitted = true;
    const displayText = entry.formType === "textarea"
      ? tf("shell.source.userPreview", { count: val.length, preview: val.length > 80 ? val.slice(0, 80) + "…" : val })
      : val;
    _deactivateAll();
    logUser(displayText);
    entry.onSubmit(val);
  }

  btn.addEventListener("click", submit);
  if (entry.formType !== "textarea") {
    inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }
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
}

// ---------------------------------------------------------------------------
// Logged chat API — all flow functions use these
// ---------------------------------------------------------------------------

// Log + render a bot message. htmlFn() is called at render time so re-translation works.
function logBot(htmlFn, choices = []) {
  const entry = { kind: "bot", html: htmlFn, choices, active: choices.length > 0 };
  chatLog.push(entry);
  _domBotBubble(htmlFn(), choices, false);
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
  slot.entry.html = htmlFn;
  slot.entry.choices = choices;
  slot.entry.active = choices.length > 0;
  slot.el.innerHTML = `<div class="chat-bubble">${htmlFn()}</div>`;
  if (choices.length > 0) {
    slot.el.appendChild(_domChoiceRow(choices, false));
  }
  _domScroll(slot.el);
}

// Log + render a text input or textarea form (prompt bubble + input fields).
function logForm(formType, promptHtmlFn, placeholderKey, submitKey, onSubmit) {
  const entry = { kind: "form", formType, promptHtml: promptHtmlFn, placeholderKey, submitKey, onSubmit, submitted: false };
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
  if (!bundle && !sessionDraft && !previewDraft) {
    previewContent.innerHTML = `<p class="preview-empty">${escapeHtml(t("adminContent.status.noneTitle"))}</p>`;
    return;
  }

  const activeDraft = previewDraft ?? sessionDraft;
  const hasDraft = !!activeDraft;

  let titleHtml = "";
  let descriptionHtml = "";
  let versionChainHtml = "";
  let badgeClass = "shell";
  let badgeText = t("adminContent.status.badge.none");
  let taskTextHtml = "";
  let guidanceTextHtml = "";
  let mcqCountHtml = "";
  let mcqQuestionsHtml = "";

  if (bundle) {
    const mod = bundle.module;
    const cfg = bundle.selectedConfiguration;
    const isLive = !!mod.activeVersionId && cfg.moduleVersion?.id === mod.activeVersionId;
    const isDraft = !!cfg.moduleVersion && !isLive;

    badgeClass = hasDraft ? "draft" : isLive ? "live" : isDraft ? "draft" : "shell";
    badgeText = hasDraft
      ? t("shell.draft.unsavedBadge")
      : isLive
      ? t("adminContent.status.badge.live")
      : isDraft
      ? t("adminContent.status.badge.draft")
      : t("adminContent.status.badge.none");

    const title = localizeValue(mod.title) || mod.id;
    const description = localizeValue(mod.description);
    titleHtml = `<div class="preview-module-title">${escapeHtml(title)}</div>`;
    if (description) descriptionHtml = `<p class="preview-description">${escapeHtml(description)}</p>`;

    const versionChainParts = [];
    if (cfg.moduleVersion) versionChainParts.push(`Modul v${cfg.moduleVersion.versionNo}`);
    if (cfg.rubricVersion) versionChainParts.push(`Rubrikk v${cfg.rubricVersion.versionNo}`);
    if (cfg.promptTemplateVersion) versionChainParts.push(`Prompt v${cfg.promptTemplateVersion.versionNo}`);
    if (cfg.mcqSetVersion) versionChainParts.push(`MCQ v${cfg.mcqSetVersion.versionNo}`);
    if (versionChainParts.length > 0) {
      versionChainHtml = `<p class="preview-version-chain">${escapeHtml(versionChainParts.join(" · "))}</p>`;
    }

    // Use draft content if accepted, else bundle content
    const taskText = hasDraft
      ? activeDraft.taskText
      : cfg.moduleVersion ? localizeValue(cfg.moduleVersion.taskText) : "";
    const guidanceText = hasDraft
      ? activeDraft.guidanceText
      : cfg.moduleVersion ? localizeValue(cfg.moduleVersion.guidanceText) : "";
    const mcqQuestions = hasDraft
      ? (activeDraft.mcqQuestions ?? [])
      : (cfg.mcqSetVersion?.questions ?? []);
    const mcqCount = mcqQuestions.length;

    if (taskText) {
      taskTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.taskText"))}</div>
        <div class="preview-text-block">${escapeHtml(taskText)}</div>`;
    }
    if (guidanceText) {
      guidanceTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.guidanceText"))}</div>
        <div class="preview-text-block preview-text-secondary">${escapeHtml(guidanceText)}</div>`;
    }
    if (mcqCount > 0) mcqCountHtml = `<p class="preview-meta">${escapeHtml(tf("shell.mcq.countLabel", { count: mcqCount }))}</p>`;
    mcqQuestionsHtml = renderPreviewMcqQuestions(mcqQuestions);
  } else if (hasDraft) {
    // New module shell not yet saved — show draft content only
    badgeClass = "draft";
    badgeText = t("shell.draft.unsavedBadge");
    titleHtml = `<div class="preview-module-title">${escapeHtml(activeDraft.title || t("shell.newModule.defaultTitle"))}</div>`;
    const taskText = activeDraft.taskText ?? "";
    const guidanceText = activeDraft.guidanceText ?? "";
    const mcqQuestions = activeDraft.mcqQuestions ?? [];
    const mcqCount = mcqQuestions.length;

    if (taskText) {
      taskTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.taskText"))}</div>
        <div class="preview-text-block">${escapeHtml(taskText)}</div>`;
    }
    if (guidanceText) {
      guidanceTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.guidanceText"))}</div>
        <div class="preview-text-block preview-text-secondary">${escapeHtml(guidanceText)}</div>`;
    }
    if (mcqCount > 0) mcqCountHtml = `<p class="preview-meta">${escapeHtml(tf("shell.mcq.countLabel", { count: mcqCount }))}</p>`;
    mcqQuestionsHtml = renderPreviewMcqQuestions(mcqQuestions);
  }

  previewContent.innerHTML = `
    <div class="preview-module-header">
      ${titleHtml}
      <span class="module-status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
    </div>
    ${descriptionHtml}
    ${versionChainHtml}
    ${taskTextHtml}
    ${guidanceTextHtml}
    ${mcqCountHtml}
    ${mcqQuestionsHtml}
  `.trim();
}

function scrollPreviewToTop() {
  previewPane?.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollPreviewToBottom() {
  if (!previewPane) return;
  previewPane.scrollTo({ top: previewPane.scrollHeight, behavior: "smooth" });
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

async function generateDraftInBackground(sourceMaterial, certLevel, locale, onAccept) {
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
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale }),
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
      { labelKey: "shell.action.retry", action: () => generateDraftInBackground(sourceMaterial, certLevel, locale, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const draft = result?.draft ?? result;
  setPreviewCandidate({ taskText: draft.taskText, guidanceText: draft.guidanceText });
  scrollPreviewToTop();
  logResolveSlot(slot,
    () => `<strong>${escapeHtml(t("shell.generating.draftReady"))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>`,
    [
      {
        labelKey: "shell.generating.acceptDraft",
        action: () => {
          sessionDraft = buildPreviewCandidate({ taskText: draft.taskText, guidanceText: draft.guidanceText });
          clearPreviewCandidate();
          scrollPreviewToTop();
          onAccept(draft, sourceMaterial, certLevel, locale);
        },
      },
      {
        labelKey: "shell.generating.discardDraft",
        action: () => {
          clearPreviewCandidate();
          sessionState = selectedModuleId ? "module-loaded" : "idle";
          logBot(() => t("shell.generating.draftDiscarded"), [
            { labelKey: "shell.generating.retryWithMaterial", action: () => startGenerateDraftFlow() },
            ...(selectedModuleId ? [{ labelKey: "shell.generating.backToModule", action: () => showModuleActions() }] : []),
            { labelKey: "shell.generating.backToStart", action: startIdle },
          ]);
        },
      },
    ],
  );
}

async function generateMcqInBackground(sourceMaterial, certLevel, locale, questionCount, optionCount, onAccept) {
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
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale, questionCount, optionCount }),
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
      { labelKey: "shell.action.retry", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, questionCount, optionCount, onAccept) },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const questions = result?.questions ?? [];
  setPreviewCandidate({ mcqQuestions: questions });
  scrollPreviewToBottom();
  logResolveSlot(slot,
    () => `<strong>${escapeHtml(tf("shell.generating.mcqReady", { count: questions.length }))}</strong>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.reviewPreviewHint"))}</p>`,
    [
      {
        labelKey: "shell.generating.acceptMcq",
        action: () => {
          sessionDraft = buildPreviewCandidate({ mcqQuestions: questions });
          clearPreviewCandidate();
          scrollPreviewToBottom();
          onAccept(questions);
        },
      },
      {
        labelKey: "shell.generating.discardMcq",
        action: () => {
          clearPreviewCandidate();
          logBot(() => t("shell.generating.mcqDiscarded"), [
            { labelKey: "shell.generating.regenerateMcq", action: () => askForMcqGeneration(sourceMaterial, certLevel, locale) },
            { labelKey: "shell.generating.skipMcq", action: () => showDraftReadyActions() },
          ]);
        },
      },
    ],
  );
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
          taskText: sessionDraft?.taskText ?? "",
          guidanceText: sessionDraft?.guidanceText ?? "",
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
  setPreviewCandidate({ taskText: draft.taskText, guidanceText: draft.guidanceText });
  scrollPreviewToTop();
  logResolveSlot(slot, () => `<strong>${escapeHtml(t("shell.revision.draftReady"))}</strong>`, [
    {
      labelKey: "shell.revision.acceptDraft",
      action: () => {
        sessionDraft = buildPreviewCandidate({ taskText: draft.taskText, guidanceText: draft.guidanceText });
        clearPreviewCandidate();
        scrollPreviewToTop();
        onAccept(draft);
      },
    },
    {
      labelKey: "shell.revision.discardChanges",
      action: () => {
        clearPreviewCandidate();
        logBot(() => t("shell.revision.discarded"), [
          { labelKey: "shell.revision.tryAgain", action: startDraftRevisionFlow },
          { labelKey: "shell.generating.backToModule", action: showModuleActions },
        ]);
      },
    },
  ]);
}

async function reviseMcqInBackground(instruction, onAccept) {
  const abort = startGeneration();
  const slot = logProgress("shell.revision.mcqProgress");
  slot.abortBtn.addEventListener("click", () => { abort.abort(); slot.abortBtn.disabled = true; });

  const currentQuestions = sessionDraft?.mcqQuestions ?? [];
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
  setPreviewCandidate({ mcqQuestions: questions });
  scrollPreviewToBottom();
  logResolveSlot(slot, () => `<strong>${escapeHtml(tf("shell.revision.mcqReady", { count: questions.length }))}</strong>`, [
    {
      labelKey: "shell.revision.acceptMcq",
      action: () => {
        sessionDraft = buildPreviewCandidate({ mcqQuestions: questions });
        clearPreviewCandidate();
        scrollPreviewToBottom();
        onAccept(questions);
      },
    },
    {
      labelKey: "shell.revision.discardChanges",
      action: () => {
        clearPreviewCandidate();
        logBot(() => t("shell.revision.discarded"), [
          { labelKey: "shell.revision.tryAgain", action: startMcqRevisionFlow },
          { labelKey: "shell.generating.backToModule", action: showModuleActions },
        ]);
      },
    },
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

async function loadModule(moduleId) {
  sessionState = "loading-module";
  selectedModuleId = moduleId;
  sessionDraft = null;
  previewDraft = null;
  const slot = logProgress("shell.module.loading");

  try {
    bundle = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
  } catch {
    logResolveSlot(slot, () => t("shell.module.loadError"), [
      { labelKey: "shell.module.pickAnother", action: startModulePicker },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  sessionState = "module-loaded";
  renderPreview();

  // Capture data for retranslatable closure
  const capturedTitle = localizeValue(bundle.module.title) || moduleId;
  const capturedIsLive = !!bundle.module.activeVersionId;
  const capturedVersionNo = bundle.selectedConfiguration.moduleVersion?.versionNo ?? "?";
  logResolveSlot(slot, () => {
    const statusNote = capturedIsLive
      ? tf("shell.module.liveStatus", { versionNo: capturedVersionNo })
      : t("shell.module.noPublishedVersion");
    return `<strong>${escapeHtml(capturedTitle)}</strong> ${escapeHtml(t("shell.module.loaded"))}<br><span style="color:var(--color-meta);font-size:13px">${escapeHtml(statusNote)}</span>`;
  });
  showModuleActions();
}

function showModuleActions() {
  const hasDraft = !!sessionDraft;
  const hasMcq = (sessionDraft?.mcqQuestions?.length ?? 0) > 0;
  logBot(() => t("shell.module.actionsPrompt"), [
    { labelKey: "shell.module.generateContent", action: () => startGenerateDraftFlow() },
    ...(hasDraft ? [{ labelKey: "shell.module.generateMcq", action: () => startGenerateMcqFlow() }] : []),
    ...(hasDraft ? [{ labelKey: "shell.module.editDraftChat", action: startDraftRevisionFlow }] : []),
    ...(hasMcq ? [{ labelKey: "shell.module.editMcqChat", action: startMcqRevisionFlow }] : []),
    { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(selectedModuleId) },
    { labelKey: "shell.module.pickAnother", action: startModulePicker },
  ]);
}

function openAdvancedEditor(moduleId) {
  const url = `/admin-content/advanced${moduleId ? `?moduleId=${encodeURIComponent(moduleId)}` : ""}`;
  logBot(() => t("shell.module.openingEditor"));
  setTimeout(() => { location.href = url; }, 400);
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
    "textarea",
    () => `<strong>${escapeHtml(t("shell.source.promptTitle"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.source.promptHint"))}</span>`,
    "shell.source.placeholder",
    "shell.action.next",
    (sourceMaterial) => askForCertLevel(moduleTitle, existingModuleId, sourceMaterial),
  );
}

function askForCertLevel(moduleTitle, existingModuleId, sourceMaterial) {
  logBot(() => t("shell.certLevel.prompt"), [
    { labelKey: "shell.certLevel.basic",        action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, "basic",         currentLocale) },
    { labelKey: "shell.certLevel.intermediate",  action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, "intermediate",  currentLocale) },
    { labelKey: "shell.certLevel.advanced",      action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, "advanced",      currentLocale) },
  ]);
}

async function confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale) {
  if (existingModuleId) {
    const capturedTitle = localizeValue(bundle?.module?.title) || existingModuleId;
    const levelKey = `shell.certLevel.${certLevel}`;
    const genLocale = locale;
    logBot(() =>
      `${escapeHtml(t("shell.generating.startingFor"))} <strong>${escapeHtml(capturedTitle)}</strong>…<br>` +
      `<span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.certLevel.label"))}: ${escapeHtml(t(levelKey) || certLevel)} · ${escapeHtml(t("shell.locale.label"))}: ${escapeHtml(localeLabels[genLocale] ?? genLocale)}</span>`,
    );
    generateDraftInBackground(sourceMaterial, certLevel, locale, () => {
      askForMcqGeneration(sourceMaterial, certLevel, locale);
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
        { labelKey: "shell.action.retry", action: () => confirmAndGenerate(moduleTitle, null, sourceMaterial, certLevel, locale) },
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

  generateDraftInBackground(sourceMaterial, certLevel, locale, () => {
    askForMcqGeneration(sourceMaterial, certLevel, locale);
  });
}

function askForMcqGeneration(sourceMaterial, certLevel, locale) {
  logBot(() => t("shell.askMcq.prompt"), [
    { labelKey: "shell.askMcq.yes", action: () => askForMcqQuestionCount(sourceMaterial, certLevel, locale, () => showDraftReadyActions()) },
    { labelKey: "shell.askMcq.no",  action: showDraftReadyActions },
  ]);
}

function showDraftReadyActions() {
  sessionState = "draft-pending";
  const mcqCount = sessionDraft?.mcqQuestions?.length ?? 0;
  logBot(() => {
    const parts = [t("shell.draftReady.message")];
    if (mcqCount > 0) parts.push(tf("shell.draftReady.mcqCount", { count: mcqCount }));
    parts.push(t("shell.draftReady.hint"));
    return escapeHtml(parts.join(" "));
  }, [
    { labelKey: "shell.draftReady.reviseDraft", action: startDraftRevisionFlow },
    ...(mcqCount > 0 ? [{ labelKey: "shell.draftReady.reviseMcq", action: startMcqRevisionFlow }] : []),
    ...(selectedModuleId ? [{ labelKey: "shell.draftReady.openEditor", action: () => openAdvancedEditor(selectedModuleId) }] : []),
    { labelKey: "shell.draftReady.restart", action: startIdle },
  ]);
}

// Separate entry point for MCQ-only generation from the module actions menu
function startGenerateDraftFlow() {
  askForSourceMaterial(null, selectedModuleId);
}

function startGenerateMcqFlow() {
  logForm(
    "textarea",
    () => `<strong>${escapeHtml(t("shell.mcqSource.promptTitle"))}</strong>`,
    "shell.mcqSource.placeholder",
    "shell.action.next",
    (sourceMaterial) => askForCertLevelMcqOnly(sourceMaterial),
  );
}

function startDraftRevisionFlow() {
  if (!sessionDraft?.taskText && !sessionDraft?.guidanceText) {
    logBot(() => t("shell.revision.draftUnavailable"));
    return;
  }

  logForm(
    "textarea",
    () => `<strong>${escapeHtml(t("shell.revision.draftPromptTitle"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.revision.draftPromptHint"))}</span>`,
    "shell.revision.placeholder",
    "shell.revision.submit",
    (instruction) => reviseDraftInBackground(instruction, () => showDraftReadyActions()),
  );
}

function startMcqRevisionFlow() {
  if ((sessionDraft?.mcqQuestions?.length ?? 0) === 0) {
    logBot(() => t("shell.revision.mcqUnavailable"));
    return;
  }

  logForm(
    "textarea",
    () => `<strong>${escapeHtml(t("shell.revision.mcqPromptTitle"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.revision.mcqPromptHint"))}</span>`,
    "shell.revision.placeholder",
    "shell.revision.submit",
    (instruction) => reviseMcqInBackground(instruction, () => showDraftReadyActions()),
  );
}

function askForCertLevelMcqOnly(sourceMaterial) {
  logBot(() => t("shell.mcqCertLevel.prompt"), [
    { labelKey: "shell.certLevel.basic",       action: () => askForMcqQuestionCount(sourceMaterial, "basic", currentLocale, () => showModuleActions()) },
    { labelKey: "shell.certLevel.intermediate", action: () => askForMcqQuestionCount(sourceMaterial, "intermediate", currentLocale, () => showModuleActions()) },
    { labelKey: "shell.certLevel.advanced",     action: () => askForMcqQuestionCount(sourceMaterial, "advanced", currentLocale, () => showModuleActions()) },
  ]);
}

function askForMcqQuestionCount(sourceMaterial, certLevel, locale, onAccept) {
  logBot(() => t("shell.mcq.questionCountPrompt"), [
    { labelKey: "shell.mcq.questionCountChoice3", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, 3, onAccept) },
    { labelKey: "shell.mcq.questionCountChoice5", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, 5, onAccept) },
    { labelKey: "shell.mcq.questionCountChoice10", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, 10, onAccept) },
    { labelKey: "shell.mcq.questionCountCustom", action: () => askForCustomMcqQuestionCount(sourceMaterial, certLevel, locale, onAccept) },
  ]);
}

function askForCustomMcqQuestionCount(sourceMaterial, certLevel, locale, onAccept) {
  logForm(
    "text",
    () => t("shell.mcq.questionCountPrompt"),
    "shell.mcq.questionCountPlaceholder",
    "shell.action.next",
    (rawValue) => {
      const questionCount = parsePositiveIntInRange(rawValue, 1, 20);
      if (questionCount === null) {
        logBot(() => t("shell.mcq.questionCountInvalid"), [
          { labelKey: "shell.action.retry", action: () => askForCustomMcqQuestionCount(sourceMaterial, certLevel, locale, onAccept) },
          { labelKey: "shell.action.cancel", action: () => askForMcqQuestionCount(sourceMaterial, certLevel, locale, onAccept) },
        ]);
        return;
      }
      askForMcqOptionCount(sourceMaterial, certLevel, locale, questionCount, onAccept);
    },
  );
}

function askForMcqOptionCount(sourceMaterial, certLevel, locale, questionCount, onAccept) {
  logBot(() => tf("shell.mcq.optionCountPrompt", { count: questionCount }), [
    { labelKey: "shell.mcq.optionCountChoice3", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, questionCount, 3, onAccept) },
    { labelKey: "shell.mcq.optionCountChoice4", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, questionCount, 4, onAccept) },
    { labelKey: "shell.mcq.optionCountChoice5", action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, questionCount, 5, onAccept) },
    { labelKey: "shell.mcq.optionCountCustom", action: () => askForCustomMcqOptionCount(sourceMaterial, certLevel, locale, questionCount, onAccept) },
  ]);
}

function askForCustomMcqOptionCount(sourceMaterial, certLevel, locale, questionCount, onAccept) {
  logForm(
    "text",
    () => tf("shell.mcq.optionCountPrompt", { count: questionCount }),
    "shell.mcq.optionCountPlaceholder",
    "shell.action.next",
    (rawValue) => {
      const optionCount = parsePositiveIntInRange(rawValue, 2, 6);
      if (optionCount === null) {
        logBot(() => t("shell.mcq.optionCountInvalid"), [
          { labelKey: "shell.action.retry", action: () => askForCustomMcqOptionCount(sourceMaterial, certLevel, locale, questionCount, onAccept) },
          { labelKey: "shell.action.cancel", action: () => askForMcqOptionCount(sourceMaterial, certLevel, locale, questionCount, onAccept) },
        ]);
        return;
      }
      generateMcqInBackground(sourceMaterial, certLevel, locale, questionCount, optionCount, onAccept);
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
  const h1 = document.querySelector(".shell-header h1");
  if (h1) h1.textContent = t("shell.page.title");
  const advLink = document.querySelector(".advanced-link");
  if (advLink) advLink.textContent = t("shell.page.advancedLink");
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

populateUiLocaleSelect();
translatePageStaticText();
renderPreviewLocaleBar();
renderPreview();
loadVersion();
loadConsoleConfig();
startIdle();
