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

const currentLocale = (() => {
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

function pushBotMessage(html, choices = []) {
  const msg = document.createElement("div");
  msg.className = "chat-msg chat-msg--bot";
  msg.innerHTML = `<div class="chat-bubble">${html}</div>`;
  if (choices.length > 0) {
    const row = document.createElement("div");
    row.className = "chat-choices";
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary chat-choice-btn";
      btn.textContent = c.label;
      btn.addEventListener("click", () => {
        disableChoices();
        pushUserMessage(c.label);
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
      btn.textContent = c.label;
      btn.addEventListener("click", () => {
        disableChoices();
        pushUserMessage(c.label);
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
function pushTextInputForm(promptHtml, placeholder, submitLabel, onSubmit) {
  // 1. Label bubble
  pushBotMessage(promptHtml);

  // 2. Full-width form row (not inside a bubble)
  const formRow = document.createElement("div");
  formRow.className = "chat-form-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "chat-text-input";
  input.placeholder = placeholder;
  input.setAttribute("autocomplete", "off");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary chat-submit-btn";
  btn.textContent = submitLabel;

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
function pushTextareaForm(promptHtml, placeholder, submitLabel, onSubmit) {
  // 1. Label bubble
  pushBotMessage(promptHtml);

  // 2. Full-width form column (not inside a bubble)
  const formCol = document.createElement("div");
  formCol.className = "chat-form-col";

  const textarea = document.createElement("textarea");
  textarea.className = "chat-textarea";
  textarea.placeholder = placeholder;
  textarea.rows = 6;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary chat-submit-btn";
  btn.textContent = submitLabel;

  function submit() {
    const val = textarea.value.trim();
    if (!val) { textarea.focus(); return; }
    btn.disabled = true;
    textarea.disabled = true;
    const preview = val.length > 80 ? val.slice(0, 80) + "…" : val;
    pushUserMessage(`Kildemateriale (${val.length} tegn): "${preview}"`);
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
  previewLocaleBar.innerHTML = "";
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
      ? "Ulagret utkast"
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
    if (mcqCount > 0) mcqCountHtml = `<p class="preview-meta">${mcqCount} flervalgsspørsmål</p>`;
  } else if (hasDraft) {
    // New module shell not yet saved — show draft content only
    badgeClass = "draft";
    badgeText = "Ulagret utkast";
    titleHtml = `<div class="preview-module-title">${escapeHtml(sessionDraft.title || "Ny modul")}</div>`;
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
    if (mcqCount > 0) mcqCountHtml = `<p class="preview-meta">${mcqCount} flervalgsspørsmål</p>`;
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
  progressMsg.innerHTML = `<div class="chat-bubble chat-bubble--progress"><span class="chat-spinner"></span>Genererer modulutkast…</div>`;

  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
  abortBtn.className = "btn-secondary chat-choice-btn";
  abortBtn.textContent = "Avbryt";
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
      replaceMessage(progressMsg, "Generering avbrutt.");
      return;
    }
    replaceMessage(progressMsg, `Generering feilet: ${escapeHtml(String(err?.message ?? err))}`, [
      {
        label: "Prøv igjen",
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
    <strong>Utkast klart!</strong>
    <p style="margin:8px 0 4px;font-size:13px;color:var(--color-meta)">Oppgavetekst (utdrag):</p>
    <p style="margin:0 0 8px;font-size:13px">${escapeHtml(taskPreview)}${draft.taskText?.length > 120 ? "…" : ""}</p>
  `;

  replaceMessage(progressMsg, resultHtml, [
    {
      label: "Bruk dette utkastet",
      action: () => {
        sessionDraft = sessionDraft
          ? { ...sessionDraft, taskText: draft.taskText, guidanceText: draft.guidanceText }
          : { taskText: draft.taskText, guidanceText: draft.guidanceText, mcqQuestions: [] };
        renderPreview();
        onAccept(draft, sourceMaterial, certLevel, locale);
      },
    },
    {
      label: "Forkast",
      action: () => {
        sessionState = selectedModuleId ? "module-loaded" : "idle";
        pushBotMessage("Utkastet ble forkastet. Hva vil du gjøre?", [
          { label: "Prøv igjen med nytt materiale", action: () => startGenerateDraftFlow() },
          ...(selectedModuleId ? [{ label: "Tilbake til modulen", action: () => showModuleActions() }] : []),
          { label: "Tilbake til start", action: startIdle },
        ]);
      },
    },
  ]);
}

async function generateMcqInBackground(sourceMaterial, certLevel, locale, onAccept) {
  const abort = startGeneration();

  const progressMsg = document.createElement("div");
  progressMsg.className = "chat-msg chat-msg--bot";
  progressMsg.innerHTML = `<div class="chat-bubble chat-bubble--progress"><span class="chat-spinner"></span>Genererer flervalgsspørsmål…</div>`;

  const abortBtn = document.createElement("button");
  abortBtn.type = "button";
  abortBtn.className = "btn-secondary chat-choice-btn";
  abortBtn.textContent = "Avbryt";
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
      replaceMessage(progressMsg, "MCQ-generering avbrutt.");
      return;
    }
    replaceMessage(progressMsg, `MCQ-generering feilet: ${escapeHtml(String(err?.message ?? err))}`, [
      {
        label: "Prøv igjen",
        action: () => generateMcqInBackground(sourceMaterial, certLevel, locale, onAccept),
      },
    ]);
    return;
  }

  generationAbort = null;
  sessionState = "draft-pending";

  const questions = result?.questions ?? [];
  const resultHtml = `
    <strong>${questions.length} flervalgsspørsmål generert!</strong>
    ${questions.length > 0 ? `<p style="margin:8px 0 0;font-size:13px;color:var(--color-meta)">Første spørsmål: ${escapeHtml((questions[0].stem ?? "").slice(0, 100))}…</p>` : ""}
  `;

  replaceMessage(progressMsg, resultHtml, [
    {
      label: "Bruk disse spørsmålene",
      action: () => {
        sessionDraft = sessionDraft
          ? { ...sessionDraft, mcqQuestions: questions }
          : { taskText: "", guidanceText: "", mcqQuestions: questions };
        renderPreview();
        onAccept(questions);
      },
    },
    {
      label: "Forkast",
      action: () => {
        pushBotMessage("MCQ-spørsmålene ble forkastet.", [
          { label: "Generer nye spørsmål", action: () => askForMcqGeneration(sourceMaterial, certLevel, locale) },
          { label: "Fortsett uten MCQ", action: () => showDraftReadyActions() },
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
  pushBotMessage("Hva vil du gjøre?", [
    { label: "Åpne eksisterende modul", action: startModulePicker },
    { label: "Opprett ny modul", action: startNewModuleFlow },
  ]);
}

async function startModulePicker() {
  sessionState = "picking-module";
  const progress = pushBotProgress("Laster moduler…");

  try {
    const data = await apiFetch("/api/admin/content/modules", getHeaders);
    modules = Array.isArray(data) ? data : (data?.modules ?? []);
  } catch {
    replaceMessage(progress, "Kunne ikke laste moduler. Prøv igjen.", [
      { label: "Prøv igjen", action: startModulePicker },
      { label: "Avbryt", action: startIdle },
    ]);
    return;
  }

  if (modules.length === 0) {
    replaceMessage(progress, "Ingen moduler funnet.", [
      { label: "Opprett ny modul", action: startNewModuleFlow },
      { label: "Avbryt", action: startIdle },
    ]);
    return;
  }

  const listHtml = modules
    .map(
      (m) =>
        `<div class="module-list-item"><strong>${escapeHtml(m.title || m.id)}</strong>${m.activeVersion ? ` <span class="module-status-badge live" style="font-size:11px;padding:2px 8px">Live v${m.activeVersion.versionNo}</span>` : ""}</div>`,
    )
    .join("");

  replaceMessage(progress, `Velg en modul:<div class="module-list">${listHtml}</div>`);

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
  cancelBtn.textContent = "Avbryt";
  cancelBtn.addEventListener("click", () => {
    disableChoices();
    pushUserMessage("Avbryt");
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
  const progress = pushBotProgress("Laster modul…");

  try {
    bundle = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, getHeaders);
  } catch {
    replaceMessage(progress, "Kunne ikke laste modulen. Prøv igjen.", [
      { label: "Velg annen modul", action: startModulePicker },
      { label: "Avbryt", action: startIdle },
    ]);
    return;
  }

  sessionState = "module-loaded";
  renderPreview();

  const title = localizeValue(bundle.module.title) || moduleId;
  const isLive = !!bundle.module.activeVersionId;
  const statusNote = isLive
    ? `Live – Modul v${bundle.selectedConfiguration.moduleVersion?.versionNo ?? "?"}`
    : "Ingen publisert versjon";

  replaceMessage(
    progress,
    `<strong>${escapeHtml(title)}</strong> er lastet.<br><span style="color:var(--color-meta);font-size:13px">${escapeHtml(statusNote)}</span>`,
  );
  showModuleActions();
}

function showModuleActions() {
  const hasDraft = !!sessionDraft;
  pushBotMessage("Hva vil du gjøre med denne modulen?", [
    { label: "Generer nytt innhold fra kildemateriale", action: () => startGenerateDraftFlow() },
    ...(hasDraft ? [{ label: "Generer flervalgsspørsmål", action: () => startGenerateMcqFlow() }] : []),
    { label: "Rediger i avansert editor", action: () => openAdvancedEditor(selectedModuleId) },
    { label: "Velg annen modul", action: startModulePicker },
  ]);
}

function openAdvancedEditor(moduleId) {
  const url = `/admin-content/advanced${moduleId ? `?moduleId=${encodeURIComponent(moduleId)}` : ""}`;
  pushBotMessage("Åpner avansert editor for denne modulen…");
  setTimeout(() => { location.href = url; }, 400);
}

// ---------------------------------------------------------------------------
// New module creation flow
// ---------------------------------------------------------------------------

function startNewModuleFlow() {
  pushTextInputForm(
    "Hva skal modulen hete?",
    "Tittel på modul…",
    "Neste",
    (title) => askForSourceMaterial(title, null),
  );
}

// ---------------------------------------------------------------------------
// Source material → cert level → locale → generate
// ---------------------------------------------------------------------------

function askForSourceMaterial(moduleTitle, existingModuleId) {
  pushTextareaForm(
    `<strong>Lim inn kildemateriale</strong><br><span style="font-size:13px;color:var(--color-meta)">Dette er kun bakgrunnsmateriale for deg som forfatter – kandidaten ser det ikke.</span>`,
    "Lim inn faglig tekst, prosedyre, regelverk eller annet kildemateriale…",
    "Neste",
    (sourceMaterial) => askForCertLevel(moduleTitle, existingModuleId, sourceMaterial),
  );
}

function askForCertLevel(moduleTitle, existingModuleId, sourceMaterial) {
  pushBotMessage("Velg sertifiseringsnivå:", [
    { label: "Grunnleggende", action: () => askForLocale(moduleTitle, existingModuleId, sourceMaterial, "basic") },
    { label: "Middels", action: () => askForLocale(moduleTitle, existingModuleId, sourceMaterial, "intermediate") },
    { label: "Avansert", action: () => askForLocale(moduleTitle, existingModuleId, sourceMaterial, "advanced") },
  ]);
}

const CERT_LEVEL_LABELS = { basic: "Grunnleggende", intermediate: "Middels", advanced: "Avansert" };
const LOCALE_LABELS_GEN = { nb: "Norsk bokmål", nn: "Norsk nynorsk", "en-GB": "English (UK)" };

function askForLocale(moduleTitle, existingModuleId, sourceMaterial, certLevel) {
  pushBotMessage(
    `Nivå: <strong>${escapeHtml(CERT_LEVEL_LABELS[certLevel] ?? certLevel)}</strong><br>Velg språk for generering:`,
    supportedLocales.map((loc) => ({
      label: LOCALE_LABELS_GEN[loc] ?? loc,
      action: () => confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, loc),
    })),
  );
}

async function confirmAndGenerate(moduleTitle, existingModuleId, sourceMaterial, certLevel, locale) {
  if (existingModuleId) {
    // Generating for an existing module — go straight to generation
    pushBotMessage(
      `Starter generering for <strong>${escapeHtml(localizeValue(bundle?.module?.title) || existingModuleId)}</strong>…<br>` +
      `<span style="font-size:13px;color:var(--color-meta)">Nivå: ${escapeHtml(CERT_LEVEL_LABELS[certLevel] ?? certLevel)} · Språk: ${escapeHtml(LOCALE_LABELS_GEN[locale] ?? locale)}</span>`,
    );
    generateDraftInBackground(sourceMaterial, certLevel, locale, (draft) => {
      askForMcqGeneration(sourceMaterial, certLevel, locale);
    });
    return;
  }

  // New module: create shell first, then generate
  const progress = pushBotProgress(`Oppretter modul «${escapeHtml(moduleTitle)}»…`);

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
    replaceMessage(progress, `Klarte ikke opprette modul: ${escapeHtml(String(err?.message ?? err))}`, [
      { label: "Prøv igjen", action: () => confirmAndGenerate(moduleTitle, null, sourceMaterial, certLevel, locale) },
      { label: "Avbryt", action: startIdle },
    ]);
    return;
  }

  selectedModuleId = newModule?.id ?? newModule?.moduleId;
  replaceMessage(
    progress,
    `Modul <strong>${escapeHtml(moduleTitle)}</strong> opprettet.` +
    `<br><span style="font-size:13px;color:var(--color-meta)">ID: ${escapeHtml(selectedModuleId)}</span>`,
  );

  sessionDraft = { title: moduleTitle, taskText: "", guidanceText: "", mcqQuestions: [] };
  renderPreview();

  generateDraftInBackground(sourceMaterial, certLevel, locale, (draft) => {
    askForMcqGeneration(sourceMaterial, certLevel, locale);
  });
}

function askForMcqGeneration(sourceMaterial, certLevel, locale) {
  pushBotMessage("Vil du også generere flervalgsspørsmål (MCQ) fra samme kildemateriale?", [
    {
      label: "Ja, generer MCQ",
      action: () =>
        generateMcqInBackground(sourceMaterial, certLevel, locale, () => showDraftReadyActions()),
    },
    { label: "Nei, fortsett uten MCQ", action: showDraftReadyActions },
  ]);
}

function showDraftReadyActions() {
  sessionState = "draft-pending";
  const hasMcq = (sessionDraft?.mcqQuestions?.length ?? 0) > 0;
  const msgParts = ["Utkastet er klart."];
  if (hasMcq) msgParts.push(`${sessionDraft.mcqQuestions.length} MCQ-spørsmål inkludert.`);
  msgParts.push("Du kan åpne den avanserte editoren for å lagre og publisere.");

  pushBotMessage(msgParts.join(" "), [
    ...(selectedModuleId
      ? [{ label: "Åpne i avansert editor", action: () => openAdvancedEditor(selectedModuleId) }]
      : []),
    { label: "Start på nytt", action: startIdle },
  ]);
}

// Separate entry point for MCQ-only generation from the module actions menu
function startGenerateDraftFlow() {
  askForSourceMaterial(null, selectedModuleId);
}

function startGenerateMcqFlow() {
  pushTextareaForm(
    "<strong>Lim inn kildemateriale for MCQ</strong>",
    "Kildemateriale for spørsmålene…",
    "Neste",
    (sourceMaterial) => askForCertLevelMcqOnly(sourceMaterial),
  );
}

function askForCertLevelMcqOnly(sourceMaterial) {
  pushBotMessage("Velg sertifiseringsnivå for spørsmålene:", [
    { label: "Grunnleggende", action: () => askForLocaleMcqOnly(sourceMaterial, "basic") },
    { label: "Middels", action: () => askForLocaleMcqOnly(sourceMaterial, "intermediate") },
    { label: "Avansert", action: () => askForLocaleMcqOnly(sourceMaterial, "advanced") },
  ]);
}

function askForLocaleMcqOnly(sourceMaterial, certLevel) {
  pushBotMessage("Velg språk for spørsmålene:", [
    ...supportedLocales.map((loc) => ({
      label: LOCALE_LABELS_GEN[loc] ?? loc,
      action: () =>
        generateMcqInBackground(sourceMaterial, certLevel, loc, () => showModuleActions()),
    })),
  ]);
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
renderPreviewLocaleBar();
renderPreview();
loadVersion();
loadConsoleConfig();
startIdle();
