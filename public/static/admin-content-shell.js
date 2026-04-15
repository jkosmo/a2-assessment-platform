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
// Chat rendering
// ---------------------------------------------------------------------------

// messageKey: when provided the bubble gets data-message-key so the locale
// handler can re-translate it in-place without knowing its content.
function pushBotMessage(html, choices = [], messageKey = null) {
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--bot";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = html;
  if (messageKey) bubble.dataset.messageKey = messageKey;
  msg.appendChild(bubble);
  if (choices.length > 0) {
    const row = document.createElement("div");
    row.className = "chat-choices";
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary chat-choice-btn";
      const labelText = c.labelKey ? t(c.labelKey) : c.label;
      btn.textContent = labelText;
      if (c.labelKey) btn.dataset.labelKey = c.labelKey;
      btn.addEventListener("click", () => {
        disableChoices();
        pushUserMessage(c.labelKey ? t(c.labelKey) : c.label);
        c.action();
      });
      row.appendChild(btn);
    }
    msg.appendChild(row);
  }
  chatMessages.appendChild(msg);
  msg.scrollIntoView({ behavior: "smooth", block: "end" });
  return msg;
}

function pushUserMessage(text) {
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--user";
  msg.innerHTML = `<div class="chat-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(msg);
  msg.scrollIntoView({ behavior: "smooth", block: "end" });
}

function pushBotProgress(text) {
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--bot";
  msg.innerHTML = `<div class="chat-bubble chat-bubble--progress"><span class="chat-spinner"></span>${escapeHtml(text)}</div>`;
  chatMessages.appendChild(msg);
  msg.scrollIntoView({ behavior: "smooth", block: "end" });
  return msg;
}

function replaceMessage(msgEl, html, choices = []) {
  msgEl.innerHTML = `<div class="chat-bubble">${html}</div>`;
  if (choices.length > 0) {
    const row = document.createElement("div");
    row.className = "chat-choices";
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary chat-choice-btn";
      const labelText = c.labelKey ? t(c.labelKey) : c.label;
      btn.textContent = labelText;
      if (c.labelKey) btn.dataset.labelKey = c.labelKey;
      btn.addEventListener("click", () => {
        disableChoices();
        pushUserMessage(c.labelKey ? t(c.labelKey) : c.label);
        c.action();
      });
      row.appendChild(btn);
    }
    msgEl.appendChild(row);
  }
  msgEl.scrollIntoView({ behavior: "smooth", block: "end" });
}

function disableChoices() {
  for (const btn of chatMessages.querySelectorAll(".chat-choice-btn")) {
    btn.disabled = true;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Renders a label bubble followed by a full-width text input form row.
// The form is intentionally outside the bubble so it fills the chat pane width.
// placeholderKey and submitLabelKey are i18n keys; they are stored as data
// attributes so the locale-switch handler can re-translate them in-place.
function pushTextInputForm(promptHtml, placeholderKey, submitLabelKey, onSubmit, promptKey = null) {
  // 1. Label bubble
  pushBotMessage(promptHtml, [], promptKey);

  // 2. Full-width form row (not inside a bubble)
  const formRow = document.createElement("div");
  formRow.className = "chat-form-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "chat-text-input";
  input.placeholder = t(placeholderKey);
  input.dataset.placeholderKey = placeholderKey;
  input.setAttribute("autocomplete", "off");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary chat-submit-btn";
  btn.textContent = t(submitLabelKey);
  btn.dataset.labelKey = submitLabelKey;

  function submit() {
    const val = input.value.trim();
    if (!val) { input.focus(); return; }
    btn.disabled = true;
    input.disabled = true;
    pushUserMessage(val);
    onSubmit(val);
  }

  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  formRow.appendChild(input);
  formRow.appendChild(btn);
  chatMessages.appendChild(formRow);
  formRow.scrollIntoView({ behavior: "smooth", block: "end" });
  setTimeout(() => input.focus(), 80);
  return formRow;
}

// Renders a label bubble followed by a full-width textarea form.
// placeholderKey and submitLabelKey are i18n keys stored as data attributes.
function pushTextareaForm(promptHtml, placeholderKey, submitLabelKey, onSubmit, promptKey = null) {
  // 1. Label bubble
  pushBotMessage(promptHtml, [], promptKey);

  // 2. Full-width form column (not inside a bubble)
  const formCol = document.createElement("div");
  formCol.className = "chat-form-col";

  const textarea = document.createElement("textarea");
  textarea.className = "chat-textarea";
  textarea.placeholder = t(placeholderKey);
  textarea.dataset.placeholderKey = placeholderKey;
  textarea.rows = 6;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary chat-submit-btn";
  btn.textContent = t(submitLabelKey);
  btn.dataset.labelKey = submitLabelKey;

  function submit() {
    const val = textarea.value.trim();
    if (!val) { textarea.focus(); return; }
    btn.disabled = true;
    textarea.disabled = true;
    const preview = val.length > 80 ? val.slice(0, 80) + "…" : val;
    pushUserMessage(tf("shell.source.userPreview", { count: val.length, preview }));
    onSubmit(val);
  }

  btn.addEventListener("click", submit);

  formCol.appendChild(textarea);
  formCol.appendChild(btn);
  chatMessages.appendChild(formCol);
  formCol.scrollIntoView({ behavior: "smooth", block: "end" });
  setTimeout(() => textarea.focus(), 80);
  return formCol;
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

function renderPreviewLocaleBar() {
  // Only show the locale switcher when content is loaded — avoids duplicating
  // the top-bar UI language selector when nothing is being previewed.
  const hasContent = !!bundle || !!sessionDraft;
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
  if (!bundle && !sessionDraft) {
    previewContent.innerHTML = `<p class="preview-empty">${escapeHtml(t("adminContent.status.noneTitle"))}</p>`;
    return;
  }

  const hasDraft = !!sessionDraft;

  let titleHtml = "";
  let descriptionHtml = "";
  let versionChainHtml = "";
  let badgeClass = "shell";
  let badgeText = t("adminContent.status.badge.none");
  let taskTextHtml = "";
  let guidanceTextHtml = "";
  let mcqCountHtml = "";

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
      ? sessionDraft.taskText
      : cfg.moduleVersion ? localizeValue(cfg.moduleVersion.taskText) : "";
    const guidanceText = hasDraft
      ? sessionDraft.guidanceText
      : cfg.moduleVersion ? localizeValue(cfg.moduleVersion.guidanceText) : "";
    const mcqCount = hasDraft
      ? (sessionDraft.mcqQuestions?.length ?? 0)
      : (cfg.mcqSetVersion?.questions?.length ?? 0);

    if (taskText) {
      taskTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.taskText"))}</div>
        <div class="preview-text-block">${escapeHtml(taskText.slice(0, 400))}${taskText.length > 400 ? "…" : ""}</div>`;
    }
    if (guidanceText) {
      guidanceTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.guidanceText"))}</div>
        <div class="preview-text-block preview-text-secondary">${escapeHtml(guidanceText.slice(0, 300))}${guidanceText.length > 300 ? "…" : ""}</div>`;
    }
    if (mcqCount > 0) mcqCountHtml = `<p class="preview-meta">${escapeHtml(tf("shell.mcq.countLabel", { count: mcqCount }))}</p>`;
  } else if (hasDraft) {
    // New module shell not yet saved — show draft content only
    badgeClass = "draft";
    badgeText = t("shell.draft.unsavedBadge");
    titleHtml = `<div class="preview-module-title">${escapeHtml(sessionDraft.title || t("shell.newModule.defaultTitle"))}</div>`;
    const taskText = sessionDraft.taskText ?? "";
    const guidanceText = sessionDraft.guidanceText ?? "";
    const mcqCount = sessionDraft.mcqQuestions?.length ?? 0;

    if (taskText) {
      taskTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.taskText"))}</div>
        <div class="preview-text-block">${escapeHtml(taskText.slice(0, 400))}${taskText.length > 400 ? "…" : ""}</div>`;
    }
    if (guidanceText) {
      guidanceTextHtml = `
        <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.guidanceText"))}</div>
        <div class="preview-text-block preview-text-secondary">${escapeHtml(guidanceText.slice(0, 300))}${guidanceText.length > 300 ? "…" : ""}</div>`;
    }
    if (mcqCount > 0) mcqCountHtml = `<p class="preview-meta">${escapeHtml(tf("shell.mcq.countLabel", { count: mcqCount }))}</p>`;
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
  `.trim();
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

  const progressMsg = document.createElement("div");
  progressMsg.className = "chat-msg chat-msg--bot";
  progressMsg.innerHTML = `<div class="chat-bubble chat-bubble--progress"><span class="chat-spinner"></span>${escapeHtml(t("shell.generating.draftProgress"))}</div>`;

  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
  abortBtn.className = "btn-secondary chat-choice-btn";
  abortBtn.textContent = t("shell.action.cancel");
  abortBtn.dataset.labelKey = "shell.action.cancel";
  abortBtn.addEventListener("click", () => {
    abort.abort();
    abortBtn.disabled = true;
  });
  progressMsg.appendChild(abortBtn);
  chatMessages.appendChild(progressMsg);
  progressMsg.scrollIntoView({ behavior: "smooth", block: "end" });

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
      replaceMessage(progressMsg, escapeHtml(t("shell.generating.draftAborted")));
      return;
    }
    replaceMessage(progressMsg, `${escapeHtml(t("shell.generating.draftErrorPrefix"))}${escapeHtml(String(err?.message ?? err))}`, [
      {
        labelKey: "shell.action.retry",
        action: () => generateDraftInBackground(sourceMaterial, certLevel, locale, onAccept),
      },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const draft = result?.draft ?? result;
  const taskPreview = (draft.taskText ?? "").slice(0, 120);
  const resultHtml = `
    <strong>${escapeHtml(t("shell.generating.draftReady"))}</strong>
    <p style="margin:8px 0 4px;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.taskPreviewLabel"))}</p>
    <p style="margin:0 0 8px;font-size:13px">${escapeHtml(taskPreview)}${draft.taskText?.length > 120 ? "…" : ""}</p>
  `;

  replaceMessage(progressMsg, resultHtml, [
    {
      labelKey: "shell.generating.acceptDraft",
      action: () => {
        sessionDraft = sessionDraft
          ? { ...sessionDraft, taskText: draft.taskText, guidanceText: draft.guidanceText }
          : { taskText: draft.taskText, guidanceText: draft.guidanceText, mcqQuestions: [] };
        renderPreview();
        onAccept(draft, sourceMaterial, certLevel, locale);
      },
    },
    {
      labelKey: "shell.generating.discardDraft",
      action: () => {
        sessionState = selectedModuleId ? "module-loaded" : "idle";
        pushBotMessage(t("shell.generating.draftDiscarded"), [
          { labelKey: "shell.generating.retryWithMaterial", action: () => startGenerateDraftFlow() },
          ...(selectedModuleId ? [{ labelKey: "shell.generating.backToModule", action: () => showModuleActions() }] : []),
          { labelKey: "shell.generating.backToStart", action: startIdle },
        ]);
      },
    },
  ]);
}

async function generateMcqInBackground(sourceMaterial, certLevel, locale, onAccept) {
  const abort = startGeneration();

  const progressMsg = document.createElement("div");
  progressMsg.className = "chat-msg chat-msg--bot";
  progressMsg.innerHTML = `<div class="chat-bubble chat-bubble--progress"><span class="chat-spinner"></span>${escapeHtml(t("shell.generating.mcqProgress"))}</div>`;

  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
  abortBtn.className = "btn-secondary chat-choice-btn";
  abortBtn.textContent = t("shell.action.cancel");
  abortBtn.dataset.labelKey = "shell.action.cancel";
  abortBtn.addEventListener("click", () => {
    abort.abort();
    abortBtn.disabled = true;
  });
  progressMsg.appendChild(abortBtn);
  chatMessages.appendChild(progressMsg);
  progressMsg.scrollIntoView({ behavior: "smooth", block: "end" });

  let result;
  try {
    result = await apiFetch(
      "/api/admin/content/generate/mcq",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ sourceMaterial, certificationLevel: certLevel, locale, questionCount: 5 }),
        signal: abort.signal,
      },
    );
  } catch (err) {
    generationAbort = null;
    sessionState = sessionDraft ? "draft-pending" : "module-loaded";

    if (err?.name === "AbortError" || String(err).includes("abort")) {
      replaceMessage(progressMsg, escapeHtml(t("shell.generating.mcqAborted")));
      return;
    }
    replaceMessage(progressMsg, `${escapeHtml(t("shell.generating.mcqErrorPrefix"))}${escapeHtml(String(err?.message ?? err))}`, [
      {
        labelKey: "shell.action.retry",
        action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, onAccept),
      },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const questions = result?.questions ?? [];
  const resultHtml = `
    <strong>${escapeHtml(tf("shell.generating.mcqReady", { count: questions.length }))}</strong>
    ${questions.length > 0 ? `<p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.generating.mcqFirstQuestion"))}${escapeHtml((questions[0].stem ?? "").slice(0, 100))}…</p>` : ""}
  `;

  replaceMessage(progressMsg, resultHtml, [
    {
      labelKey: "shell.generating.acceptMcq",
      action: () => {
        sessionDraft = sessionDraft
          ? { ...sessionDraft, mcqQuestions: questions }
          : { taskText: "", guidanceText: "", mcqQuestions: questions };
        renderPreview();
        onAccept(questions);
      },
    },
    {
      labelKey: "shell.generating.discardMcq",
      action: () => {
        pushBotMessage(t("shell.generating.mcqDiscarded"), [
          { labelKey: "shell.generating.regenerateMcq", action: () => askForMcqGeneration(sourceMaterial, certLevel, locale) },
          { labelKey: "shell.generating.skipMcq", action: () => showDraftReadyActions() },
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
  renderPreview();
  pushBotMessage(t("shell.idle.prompt"), [
    { labelKey: "shell.idle.openExisting", action: startModulePicker },
    { labelKey: "shell.idle.createNew", action: startNewModuleFlow },
  ], "shell.idle.prompt");
}

async function startModulePicker() {
  sessionState = "picking-module";
  const progress = pushBotProgress(t("shell.modules.loading"));

  try {
    const data = await apiFetch("/api/admin/content/modules", getHeaders);
    modules = Array.isArray(data) ? data : (data?.modules ?? []);
  } catch {
    replaceMessage(progress, t("shell.modules.loadError"), [
      { labelKey: "shell.action.retry", action: startModulePicker },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  if (modules.length === 0) {
    replaceMessage(progress, t("shell.modules.empty"), [
      { labelKey: "shell.idle.createNew", action: startNewModuleFlow },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  const listHtml = modules
    .map(
      (m) =>
        `<div class="module-list-item"><strong>${escapeHtml(m.title || m.id)}</strong>${m.activeVersion ? ` <span class="module-status-badge live" style="font-size:11px;padding:2px 8px">Live v${m.activeVersion.versionNo}</span>` : ""}</div>`,
    )
    .join("");

  replaceMessage(progress, `${escapeHtml(t("shell.modules.selectPrompt"))}<div class="module-list">${listHtml}</div>`);

  const choicesRow = document.createElement("div");
  choicesRow.className = "chat-choices chat-choices--column";
  for (const m of modules) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary chat-choice-btn";
    btn.textContent = m.title || m.id;
    if (m.activeVersion) {
      const badge = document.createElement("span");
      badge.className = "module-status-badge live";
      badge.style.cssText = "font-size:11px;padding:2px 8px;margin-left:8px";
      badge.textContent = `Live v${m.activeVersion.versionNo}`;
      btn.appendChild(badge);
    }
    btn.addEventListener("click", () => {
      disableChoices();
      pushUserMessage(m.title || m.id);
      loadModule(m.id);
    });
    choicesRow.appendChild(btn);
  }
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary chat-choice-btn";
  cancelBtn.textContent = t("shell.action.cancel");
  cancelBtn.dataset.labelKey = "shell.action.cancel";
  cancelBtn.addEventListener("click", () => {
    disableChoices();
    pushUserMessage(t("shell.action.cancel"));
    startIdle();
  });
  choicesRow.appendChild(cancelBtn);
  chatMessages.appendChild(choicesRow);
  choicesRow.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function loadModule(moduleId) {
  sessionState = "loading-module";
  selectedModuleId = moduleId;
  sessionDraft = null;
  const progress = pushBotProgress(t("shell.module.loading"));

  try {
    bundle = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
  } catch {
    replaceMessage(progress, t("shell.module.loadError"), [
      { labelKey: "shell.module.pickAnother", action: startModulePicker },
      { labelKey: "shell.action.cancel", action: startIdle },
    ]);
    return;
  }

  sessionState = "module-loaded";
  renderPreview();

  const title = localizeValue(bundle.module.title) || moduleId;
  const isLive = !!bundle.module.activeVersionId;
  const statusNote = isLive
    ? tf("shell.module.liveStatus", { versionNo: bundle.selectedConfiguration.moduleVersion?.versionNo ?? "?" })
    : t("shell.module.noPublishedVersion");

  replaceMessage(
    progress,
    `<strong>${escapeHtml(title)}</strong> er lastet.<br><span style="color:var(--color-meta);font-size:13px">${escapeHtml(statusNote)}</span>`,
  );
  showModuleActions();
}

function showModuleActions() {
  const hasDraft = !!sessionDraft;
  pushBotMessage(t("shell.module.actionsPrompt"), [
    { labelKey: "shell.module.generateContent", action: () => startGenerateDraftFlow() },
    ...(hasDraft ? [{ labelKey: "shell.module.generateMcq", action: () => startGenerateMcqFlow() }] : []),
    { labelKey: "shell.module.editAdvanced", action: () => openAdvancedEditor(selectedModuleId) },
    { labelKey: "shell.module.pickAnother", action: startModulePicker },
  ], "shell.module.actionsPrompt");
}

function openAdvancedEditor(moduleId) {
  const url = `/admin-content/advanced${moduleId ? `?moduleId=${encodeURIComponent(moduleId)}` : ""}`;
  pushBotMessage(t("shell.module.openingEditor"));
  setTimeout(() => { location.href = url; }, 400);
}

// ---------------------------------------------------------------------------
// New module creation flow
// ---------------------------------------------------------------------------

function startNewModuleFlow() {
  pushTextInputForm(
    t("shell.newModule.titlePrompt"),
    "shell.newModule.titlePlaceholder",
    "shell.action.next",
    (title) => askForSourceMaterial(title, null),
    "shell.newModule.titlePrompt",
  );
}

// ---------------------------------------------------------------------------
// Source material → cert level → locale → generate
// ---------------------------------------------------------------------------

function askForSourceMaterial(moduleTitle, existingModuleId) {
  pushTextareaForm(
    `<strong>${escapeHtml(t("shell.source.promptTitle"))}</strong><br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.source.promptHint"))}</span>`,
    "shell.source.placeholder",
    "shell.action.next",
    (sourceMaterial) => askForCertLevel(moduleTitle, existingModuleId, sourceMaterial),
  );
}

function askForCertLevel(moduleTitle, existingModuleId, sourceMaterial) {
  pushBotMessage(t("shell.certLevel.prompt"), [
    {
      labelKey: "shell.certLevel.basic",
      action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, "basic", currentLocale),
    },
    {
      labelKey: "shell.certLevel.intermediate",
      action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, "intermediate", currentLocale),
    },
    {
      labelKey: "shell.certLevel.advanced",
      action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, "advanced", currentLocale),
    },
  ], "shell.certLevel.prompt");
}

async function confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale) {
  if (existingModuleId) {
    // Generating for an existing module — go straight to generation
    pushBotMessage(
      `${escapeHtml(t("shell.generating.startingFor"))} <strong>${escapeHtml(localizeValue(bundle?.module?.title) || existingModuleId)}</strong>…<br>` +
      `<span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.certLevel.label"))}: ${escapeHtml(t(`shell.certLevel.${certLevel}`) || certLevel)} · ${escapeHtml(t("shell.locale.label"))}: ${escapeHtml(localeLabels[locale] ?? locale)}</span>`,
    );
    generateDraftInBackground(sourceMaterial, certLevel, locale, (draft) => {
      askForMcqGeneration(sourceMaterial, certLevel, locale);
    });
    return;
  }

  // New module: create shell first, then generate
  const progress = pushBotProgress(`${t("shell.newModule.creating").replace(/…$/, "")} «${escapeHtml(moduleTitle)}»…`);

  let newModule;
  try {
    const titleLocalized = { nb: moduleTitle, nn: moduleTitle, "en-GB": moduleTitle };
    const body = await apiFetch(
      "/api/admin/content/modules",
      getHeaders,
      {
        method: "POST",
        body: JSON.stringify({ title: titleLocalized, certificationLevel: certLevel }),
      },
    );
    newModule = body?.module ?? body;
  } catch (err) {
    replaceMessage(
      progress,
      `${escapeHtml(t("shell.newModule.createError"))}<br><span style="font-size:13px;color:var(--color-meta)">${escapeHtml(t("shell.newModule.createErrorHint"))}</span>`,
      [
        { labelKey: "shell.action.openAdvancedEditor", action: () => { location.href = "/admin-content/advanced"; } },
        { labelKey: "shell.action.retry", action: () => confirmAndGenerate(moduleTitle, null, sourceMaterial, certLevel, locale) },
        { labelKey: "shell.action.cancel", action: startIdle },
      ],
    );
    return;
  }

  selectedModuleId = newModule?.id ?? newModule?.moduleId;
  replaceMessage(
    progress,
    `${escapeHtml(t("shell.newModule.created"))} <strong>${escapeHtml(moduleTitle)}</strong>` +
    `<br><span style="font-size:13px;color:var(--color-meta)">ID: ${escapeHtml(selectedModuleId)}</span>`,
  );

  sessionDraft = { title: moduleTitle, taskText: "", guidanceText: "", mcqQuestions: [] };
  renderPreview();

  generateDraftInBackground(sourceMaterial, certLevel, locale, (draft) => {
    askForMcqGeneration(sourceMaterial, certLevel, locale);
  });
}

function askForMcqGeneration(sourceMaterial, certLevel, locale) {
  pushBotMessage(t("shell.askMcq.prompt"), [
    {
      labelKey: "shell.askMcq.yes",
      action: () =>
        generateMcqInBackground(sourceMaterial, certLevel, locale, () => showDraftReadyActions()),
    },
    { labelKey: "shell.askMcq.no", action: showDraftReadyActions },
  ], "shell.askMcq.prompt");
}

function showDraftReadyActions() {
  sessionState = "draft-pending";
  const mcqCount = sessionDraft?.mcqQuestions?.length ?? 0;
  const msgParts = [t("shell.draftReady.message")];
  if (mcqCount > 0) msgParts.push(tf("shell.draftReady.mcqCount", { count: mcqCount }));
  msgParts.push(t("shell.draftReady.hint"));

  const msgEl = pushBotMessage(msgParts.join(" "), [
    ...(selectedModuleId
      ? [{ labelKey: "shell.draftReady.openEditor", action: () => openAdvancedEditor(selectedModuleId) }]
      : []),
    { labelKey: "shell.draftReady.restart", action: startIdle },
  ]);
  // Store data for in-place re-translation on locale switch
  const bubble = msgEl.querySelector(".chat-bubble");
  if (bubble) {
    bubble.dataset.messageKey = "draftReady";
    bubble.dataset.mcqCount = String(mcqCount);
  }
}

// Separate entry point for MCQ-only generation from the module actions menu
function startGenerateDraftFlow() {
  askForSourceMaterial(null, selectedModuleId);
}

function startGenerateMcqFlow() {
  pushTextareaForm(
    `<strong>${escapeHtml(t("shell.mcqSource.promptTitle"))}</strong>`,
    "shell.mcqSource.placeholder",
    "shell.action.next",
    (sourceMaterial) => askForCertLevelMcqOnly(sourceMaterial),
  );
}

function askForCertLevelMcqOnly(sourceMaterial) {
  pushBotMessage(t("shell.mcqCertLevel.prompt"), [
    {
      labelKey: "shell.certLevel.basic",
      action: () => generateMcqInBackground(sourceMaterial, "basic", currentLocale, () => showModuleActions()),
    },
    {
      labelKey: "shell.certLevel.intermediate",
      action: () => generateMcqInBackground(sourceMaterial, "intermediate", currentLocale, () => showModuleActions()),
    },
    {
      labelKey: "shell.certLevel.advanced",
      action: () => generateMcqInBackground(sourceMaterial, "advanced", currentLocale, () => showModuleActions()),
    },
  ], "shell.mcqCertLevel.prompt");
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

// Clears the chat and re-renders from the current session state using the
// active currentLocale.  Called when the user switches locale without reloading.
function reRenderCurrentState() {
  chatMessages.innerHTML = "";
  renderPreviewLocaleBar();
  renderPreview();
  renderWorkspaceNavigation();
  translatePageStaticText();

  switch (sessionState) {
    case "picking-module":
      startModulePicker();
      break;

    case "module-loaded": {
      const title = localizeValue(bundle?.module?.title) || selectedModuleId;
      const isLive = !!bundle?.module?.activeVersionId;
      const vno = bundle?.selectedConfiguration?.moduleVersion?.versionNo ?? "?";
      const statusNote = isLive
        ? tf("shell.module.liveStatus", { versionNo: vno })
        : t("shell.module.noPublishedVersion");
      pushBotMessage(
        `<strong>${escapeHtml(title)}</strong><br><span style="color:var(--color-meta);font-size:13px">${escapeHtml(statusNote)}</span>`,
      );
      showModuleActions();
      break;
    }

    case "draft-pending":
    case "awaiting-confirmation": {
      const draftTitle = bundle
        ? localizeValue(bundle.module.title)
        : (sessionDraft?.title ?? selectedModuleId ?? t("shell.newModule.defaultTitle"));
      pushBotMessage(`<strong>${escapeHtml(draftTitle)}</strong>`);
      showDraftReadyActions();
      break;
    }

    case "generating":
      // Cannot restore in-flight generation; show module actions if we still have a module.
      if (selectedModuleId && bundle) {
        const title = localizeValue(bundle.module.title) || selectedModuleId;
        pushBotMessage(`<strong>${escapeHtml(title)}</strong>`);
        showModuleActions();
      } else {
        sessionState = "idle";
        pushBotMessage(t("shell.idle.prompt"), [
          { label: t("shell.idle.openExisting"), action: startModulePicker },
          { label: t("shell.idle.createNew"), action: startNewModuleFlow },
        ]);
      }
      break;

    default: // idle or unknown
      sessionState = "idle";
      pushBotMessage(t("shell.idle.prompt"), [
        { label: t("shell.idle.openExisting"), action: startModulePicker },
        { label: t("shell.idle.createNew"), action: startNewModuleFlow },
      ]);
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
    // Re-translate all interactive elements in-place — no history cleared
    for (const btn of chatMessages.querySelectorAll("[data-label-key]")) {
      btn.textContent = t(btn.dataset.labelKey);
    }
    for (const el of chatMessages.querySelectorAll("[data-placeholder-key]")) {
      el.placeholder = t(el.dataset.placeholderKey);
    }
    // Re-translate bot message bubbles that carry a message key
    for (const bubble of chatMessages.querySelectorAll(".chat-bubble[data-message-key]")) {
      const key = bubble.dataset.messageKey;
      if (key === "draftReady") {
        // Interpolated message — re-build from stored context
        const count = Number(bubble.dataset.mcqCount ?? 0);
        const parts = [t("shell.draftReady.message")];
        if (count > 0) parts.push(tf("shell.draftReady.mcqCount", { count }));
        parts.push(t("shell.draftReady.hint"));
        bubble.textContent = parts.join(" ");
      } else {
        bubble.textContent = t(key);
      }
    }
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
