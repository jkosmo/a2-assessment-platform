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

// session state: 'idle' | 'picking-module' | 'loading-module' | 'module-loaded'
let sessionState = "idle";
let modules = [];
let selectedModuleId = null;
let bundle = null;
let previewLocale = currentLocale;
let generationAbort = null;

let headers = {};
let participantRuntimeConfig = {
  navigation: { workspaceItems: [], profileItem: null },
  authMode: "mock",
  identityDefaults: { userId: "content-owner-1", email: "content.owner@company.com", name: "Platform Content Owner", department: "Learning", roles: ["SUBJECT_MATTER_OWNER"] },
};

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
  if (!bundle) {
    previewContent.innerHTML = `<p class="preview-empty">${escapeHtml(t("adminContent.status.noneTitle"))}</p>`;
    return;
  }

  const mod = bundle.module;
  const cfg = bundle.selectedConfiguration;
  const isLive = !!mod.activeVersionId && cfg.moduleVersion?.id === mod.activeVersionId;
  const isDraft = !!cfg.moduleVersion && !isLive;
  const isShell = !cfg.moduleVersion;

  const badgeClass = isLive ? "live" : isDraft ? "draft" : "shell";
  const badgeText = isLive
    ? t("adminContent.status.badge.live")
    : isDraft
    ? t("adminContent.status.badge.draft")
    : t("adminContent.status.badge.none");

  const title = localizeValue(mod.title) || mod.id;
  const description = localizeValue(mod.description);
  const taskText = cfg.moduleVersion ? localizeValue(cfg.moduleVersion.taskText) : "";
  const guidanceText = cfg.moduleVersion ? localizeValue(cfg.moduleVersion.guidanceText) : "";

  const versionChainParts = [];
  if (cfg.moduleVersion) versionChainParts.push(`Modul v${cfg.moduleVersion.versionNo}`);
  if (cfg.rubricVersion) versionChainParts.push(`Rubrikk v${cfg.rubricVersion.versionNo}`);
  if (cfg.promptTemplateVersion) versionChainParts.push(`Prompt v${cfg.promptTemplateVersion.versionNo}`);
  if (cfg.mcqSetVersion) versionChainParts.push(`MCQ v${cfg.mcqSetVersion.versionNo}`);
  const versionChain = versionChainParts.join(" · ");

  const mcqCount = cfg.mcqSetVersion?.questions?.length ?? 0;

  previewContent.innerHTML = `
    <div class="preview-module-header">
      <div class="preview-module-title">${escapeHtml(title)}</div>
      <span class="module-status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
    </div>
    ${description ? `<p class="preview-description">${escapeHtml(description)}</p>` : ""}
    ${versionChain ? `<p class="preview-version-chain">${escapeHtml(versionChain)}</p>` : ""}
    ${taskText ? `
      <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.taskText"))}</div>
      <div class="preview-text-block">${escapeHtml(taskText.slice(0, 400))}${taskText.length > 400 ? "…" : ""}</div>
    ` : ""}
    ${guidanceText ? `
      <div class="preview-section-label">${escapeHtml(t("adminContent.moduleVersion.guidanceText"))}</div>
      <div class="preview-text-block preview-text-secondary">${escapeHtml(guidanceText.slice(0, 300))}${guidanceText.length > 300 ? "…" : ""}</div>
    ` : ""}
    ${mcqCount > 0 ? `<p class="preview-meta">${mcqCount} flervalgsspørsmål</p>` : ""}
  `.trim();
}

// ---------------------------------------------------------------------------
// Chat flows
// ---------------------------------------------------------------------------

function startIdle() {
  sessionState = "idle";
  bundle = null;
  selectedModuleId = null;
  renderPreview();
  pushBotMessage("Hva vil du gjøre?", [
    { label: "Åpne eksisterende modul", action: startModulePicker },
    { label: "Opprett ny modul", action: startNewModule },
  ]);
}

async function startModulePicker() {
  sessionState = "picking-module";
  const progress = pushBotProgress("Laster moduler…");

  try {
    const data = await apiFetch("/api/admin/content/modules", headers);
    modules = Array.isArray(data) ? data : [];
  } catch {
    replaceMessage(progress, "Kunne ikke laste moduler. Prøv igjen.", [
      { label: "Prøv igjen", action: startModulePicker },
      { label: "Avbryt", action: startIdle },
    ]);
    return;
  }

  if (modules.length === 0) {
    replaceMessage(progress, "Ingen moduler funnet.", [
      { label: "Opprett ny modul", action: startNewModule },
      { label: "Avbryt", action: startIdle },
    ]);
    return;
  }

  const listHtml = modules
    .map((m) => `<div class="module-list-item"><strong>${escapeHtml(m.title || m.id)}</strong>${m.activeVersion ? ` <span class=\"module-status-badge live\" style=\"font-size:11px;padding:2px 8px\">Live v${m.activeVersion.versionNo}</span>` : ""}</div>`)
    .join("");

  replaceMessage(progress, `Velg en modul:<div class="module-list">${listHtml}</div>`);

  // Render module choice buttons below
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
  const progress = pushBotProgress("Laster modul…");

  try {
    bundle = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, headers);
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
    [
      { label: "Rediger innhold", action: () => openAdvancedEditor(moduleId) },
      { label: "Velg annen modul", action: startModulePicker },
    ],
  );
}

function openAdvancedEditor(moduleId) {
  const url = `/admin-content/advanced?moduleId=${encodeURIComponent(moduleId)}`;
  pushBotMessage(`Åpner avansert editor for denne modulen…`);
  setTimeout(() => { location.href = url; }, 400);
}

function startNewModule() {
  pushBotMessage(
    "Opprettelse av ny modul gjøres i den avanserte editoren.",
    [{ label: "Åpne avansert editor", action: () => { location.href = "/admin-content/advanced"; } }],
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
      rebuildHeaders();
    }
  } catch {
    // use defaults
  }
  renderWorkspaceNavigation();
  if (workspaceNav) {
    fetchQueueCounts(headers).then((counts) => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function rebuildHeaders() {
  const d = participantRuntimeConfig.identityDefaults ?? {};
  headers = buildConsoleHeaders({
    userId: d.userId ?? "content-owner-1",
    email: d.email ?? "content.owner@company.com",
    name: d.name ?? "Platform Content Owner",
    department: d.department ?? "Learning",
    roles: Array.isArray(d.roles) ? d.roles.join(",") : (d.roles ?? "SUBJECT_MATTER_OWNER"),
    locale: currentLocale,
  });
}
rebuildHeaders();

populateUiLocaleSelect();
renderPreviewLocaleBar();
renderPreview();
loadVersion();
loadConsoleConfig();
startIdle();
