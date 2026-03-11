import { localeLabels, supportedLocales, translations } from "/static/i18n/admin-content-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import {
  findMatchingPreset,
  resolveRoleSwitchState,
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";

const output = document.getElementById("output");
const outputDetails = document.getElementById("outputDetails");
const outputStatus = document.getElementById("outputStatus");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const rolesInput = document.getElementById("roles");
const workspaceNav = document.getElementById("workspaceNav");
const mockRolePresetContainer = document.getElementById("mockRolePresetContainer");
const mockRolePresetSelect = document.getElementById("mockRolePreset");
const mockRolePresetHint = document.getElementById("mockRolePresetHint");
const loadMeButton = document.getElementById("loadMe");
const adminContentMessage = document.getElementById("adminContentMessage");

const moduleTitleInput = document.getElementById("moduleTitle");
const moduleDescriptionInput = document.getElementById("moduleDescription");
const moduleCertificationLevelInput = document.getElementById("moduleCertificationLevel");
const moduleValidFromInput = document.getElementById("moduleValidFrom");
const moduleValidToInput = document.getElementById("moduleValidTo");
const createModuleButton = document.getElementById("createModule");
const selectedModuleIdInput = document.getElementById("selectedModuleId");
const loadModulesButton = document.getElementById("loadModules");
const loadModuleContentButton = document.getElementById("loadModuleContent");
const exportModuleButton = document.getElementById("exportModule");
const deleteModuleButton = document.getElementById("deleteModule");
const moduleDropdown = document.getElementById("moduleDropdown");
const selectedModuleMeta = document.getElementById("selectedModuleMeta");

const rubricCriteriaJsonInput = document.getElementById("rubricCriteriaJson");
const rubricScalingRuleJsonInput = document.getElementById("rubricScalingRuleJson");
const rubricPassRuleJsonInput = document.getElementById("rubricPassRuleJson");

const promptSystemPromptInput = document.getElementById("promptSystemPrompt");
const promptUserPromptTemplateInput = document.getElementById("promptUserPromptTemplate");
const promptExamplesJsonInput = document.getElementById("promptExamplesJson");

const mcqSetTitleInput = document.getElementById("mcqSetTitle");
const mcqQuestionsJsonInput = document.getElementById("mcqQuestionsJson");

const moduleVersionTaskTextInput = document.getElementById("moduleVersionTaskText");
const moduleVersionGuidanceTextInput = document.getElementById("moduleVersionGuidanceText");
const moduleVersionRubricVersionIdInput = document.getElementById("moduleVersionRubricVersionId");
const moduleVersionPromptTemplateVersionIdInput = document.getElementById("moduleVersionPromptTemplateVersionId");
const moduleVersionMcqSetVersionIdInput = document.getElementById("moduleVersionMcqSetVersionId");
const saveContentBundleButton = document.getElementById("saveContentBundle");

const publishModuleVersionIdInput = document.getElementById("publishModuleVersionId");
const publishModuleVersionButton = document.getElementById("publishModuleVersion");

const defaultWorkspaceNavigationItems = [
  {
    id: "participant",
    path: "/participant",
    labelKey: "nav.participant",
    requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"],
  },
  {
    id: "participant-completed",
    path: "/participant/completed",
    labelKey: "nav.completedModules",
    requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"],
  },
  {
    id: "manual-review",
    path: "/manual-review",
    labelKey: "nav.manualReview",
    requiredRoles: ["REVIEWER", "ADMINISTRATOR"],
  },
  {
    id: "appeal-handler",
    path: "/appeal-handler",
    labelKey: "nav.appealHandler",
    requiredRoles: ["APPEAL_HANDLER", "ADMINISTRATOR"],
  },
  {
    id: "calibration",
    path: "/calibration",
    labelKey: "nav.calibration",
    requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
  },
  {
    id: "admin-content",
    path: "/admin-content",
    labelKey: "nav.adminContent",
    requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
  },
];

let currentLocale = resolveInitialLocale();
let modules = [];
let selectedModuleId = "";
let participantRuntimeConfig = {
  authMode: "mock",
  debugMode: true,
  mockRoleSwitchEnabled: true,
  mockRolePresets: [],
  navigation: {
    items: defaultWorkspaceNavigationItems,
  },
  identityDefaults: {
    contentAdmin: {
      userId: "content-owner-1",
      email: "content.owner@company.com",
      name: "Platform Content Owner",
      department: "Learning",
      roles: ["SUBJECT_MATTER_OWNER"],
    },
  },
};
let roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);

function resolveInitialLocale() {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) {
    return stored;
  }

  const browser = navigator.language;
  if (!browser) {
    return "en-GB";
  }
  const normalized = browser.toLowerCase();
  if (normalized.startsWith("nb")) {
    return "nb";
  }
  if (normalized.startsWith("nn")) {
    return "nn";
  }
  if (normalized.startsWith("en")) {
    return "en-GB";
  }
  return "en-GB";
}

function t(key) {
  return translations[currentLocale][key] ?? translations["en-GB"][key] ?? key;
}

function setMessage(text) {
  adminContentMessage.textContent = text ?? "";
}

function setLocale(locale) {
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  document.documentElement.lang = currentLocale;
  applyTranslations();
}

function applyTranslations() {
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const key = element.getAttribute("data-i18n");
    if (!key) {
      continue;
    }
    element.textContent = t(key);
  }

  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = element.getAttribute("data-i18n-placeholder");
    if (!key) {
      continue;
    }
    element.placeholder = t(key);
  }

  applyOutputVisibility();
  if (!output.dataset.hasContent) {
    output.textContent = t("defaults.ready");
  }
  if (!outputStatus.dataset.hasContent) {
    outputStatus.textContent = t("defaults.ready");
  }

  renderRolePresetControl();
  renderWorkspaceNavigation();
  renderModuleMeta();
}

function isDebugModeEnabled() {
  return participantRuntimeConfig?.debugMode !== false;
}

function applyOutputVisibility() {
  output.hidden = !isDebugModeEnabled();
  outputDetails.hidden = !isDebugModeEnabled();
}

function formatOutputStatus(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim().length > 0) {
      return data.message;
    }
    const preferredKeys = ["moduleVersion", "module", "modules", "promptTemplateVersion", "rubricVersion", "mcqSetVersion"];
    const matchedKey = preferredKeys.find((key) => key in data);
    if (matchedKey) {
      return `Updated: ${matchedKey}`;
    }
  }
  return "Request completed.";
}

function populateLocaleSelect() {
  localeSelect.innerHTML = "";
  for (const locale of supportedLocales) {
    const option = document.createElement("option");
    option.value = locale;
    option.textContent = localeLabels[locale] ?? locale;
    option.selected = locale === currentLocale;
    localeSelect.appendChild(option);
  }
}

function log(data) {
  output.dataset.hasContent = "true";
  outputStatus.dataset.hasContent = "true";
  outputStatus.textContent = formatOutputStatus(data);

  if (!isDebugModeEnabled()) {
    output.textContent = "";
    return;
  }

  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function headers() {
  const roles = rolesInput.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");

  return buildConsoleHeaders({
    userId: document.getElementById("userId").value,
    email: document.getElementById("email").value,
    name: document.getElementById("name").value,
    department: document.getElementById("department").value,
    roles,
    locale: currentLocale,
  });
}

async function runWithBusyButton(button, action) {
  if (!button || button.dataset.busy === "true") {
    return;
  }

  const wasDisabled = button.disabled;
  button.dataset.busy = "true";
  button.disabled = true;
  button.classList.add("button-busy");
  button.setAttribute("aria-busy", "true");

  try {
    await action();
  } finally {
    button.dataset.busy = "";
    button.classList.remove("button-busy");
    button.removeAttribute("aria-busy");
    button.disabled = wasDisabled;
  }
}

function parseActionableErrorMessage(error) {
  if (!(error instanceof Error)) {
    return "Unexpected error.";
  }

  const raw = error.message ?? "";
  const splitIndex = raw.indexOf(":");
  if (splitIndex === -1) {
    return raw;
  }

  const payloadText = raw.slice(splitIndex + 1).trim();
  try {
    const payload = JSON.parse(payloadText);
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
    if (Array.isArray(payload.issues) && payload.issues.length > 0) {
      return payload.issues.map((issue) => issue.message).join("; ");
    }
  } catch {
    return raw;
  }

  return raw;
}

function parseJsonField(value, fieldLabelKey) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid_json";
    throw new Error(`${t("adminContent.errors.invalidJsonPrefix")} ${t(fieldLabelKey)}: ${detail}`);
  }
}

function parseLocalizedTextField(value, fieldLabelKey, options = { required: true }) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    if (options.required) {
      throw new Error(`${t("adminContent.errors.valueRequiredPrefix")} ${t(fieldLabelKey)}`);
    }
    return undefined;
  }

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return trimmed;
  }

  const parsed = parseJsonField(trimmed, fieldLabelKey);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return trimmed;
  }

  const localeKeys = ["en-GB", "nb", "nn"];
  const isLocaleObject = localeKeys.every((key) => typeof parsed[key] === "string" && parsed[key].trim().length > 0);
  return isLocaleObject ? parsed : trimmed;
}

function formatJsonDefault(key) {
  const raw = t(key);
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatEditorValue(value, fallback = "") {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function populateFormFromModuleExport(moduleExport) {
  const selectedConfiguration = moduleExport?.selectedConfiguration ?? {};
  const moduleVersion = selectedConfiguration.moduleVersion ?? null;
  const rubricVersion = selectedConfiguration.rubricVersion ?? null;
  const promptTemplateVersion = selectedConfiguration.promptTemplateVersion ?? null;
  const mcqSetVersion = selectedConfiguration.mcqSetVersion ?? null;

  rubricCriteriaJsonInput.value = formatEditorValue(rubricVersion?.criteria, "");
  rubricScalingRuleJsonInput.value = formatEditorValue(rubricVersion?.scalingRule, "");
  rubricPassRuleJsonInput.value = formatEditorValue(rubricVersion?.passRule, "");

  promptSystemPromptInput.value = formatEditorValue(promptTemplateVersion?.systemPrompt, "");
  promptUserPromptTemplateInput.value = formatEditorValue(promptTemplateVersion?.userPromptTemplate, "");
  promptExamplesJsonInput.value = formatEditorValue(promptTemplateVersion?.examples, "[]");

  mcqSetTitleInput.value = formatEditorValue(mcqSetVersion?.title, "");
  mcqQuestionsJsonInput.value = formatEditorValue(mcqSetVersion?.questions, "[]");

  moduleVersionTaskTextInput.value = formatEditorValue(moduleVersion?.taskText, "");
  moduleVersionGuidanceTextInput.value = formatEditorValue(moduleVersion?.guidanceText, "");
  moduleVersionRubricVersionIdInput.value = rubricVersion?.id ?? "";
  moduleVersionPromptTemplateVersionIdInput.value = promptTemplateVersion?.id ?? "";
  moduleVersionMcqSetVersionIdInput.value = mcqSetVersion?.id ?? "";
  publishModuleVersionIdInput.value = moduleVersion?.id ?? "";
}

async function fetchModuleExport() {
  const moduleId = resolveModuleIdOrThrow();
  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/export`, headers);
  return body?.moduleExport ?? null;
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function renderRolePresetControl() {
  mockRolePresetSelect.innerHTML = "";

  const manualOption = document.createElement("option");
  manualOption.value = "";
  manualOption.textContent = t("identity.rolePresetManual");
  mockRolePresetSelect.appendChild(manualOption);

  for (const role of roleSwitchState.presets) {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    mockRolePresetSelect.appendChild(option);
  }

  const matchingPreset = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matchingPreset;

  const disabled = !roleSwitchState.enabled;
  mockRolePresetSelect.disabled = disabled;
  mockRolePresetHint.textContent = disabled
    ? t("identity.rolePresetDisabledEntra")
    : t("identity.rolePresetHint");
  mockRolePresetContainer.hidden = roleSwitchState.presets.length === 0;
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) {
    return;
  }

  const items = resolveWorkspaceNavigationItems(
    participantRuntimeConfig?.navigation?.items,
    rolesInput.value,
    window.location.pathname,
    defaultWorkspaceNavigationItems,
  ).filter((item) => item.visible);

  workspaceNav.innerHTML = "";
  workspaceNav.hidden = items.length === 0;
  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    const link = document.createElement("a");
    link.href = item.path;
    link.className = item.active ? "workspace-nav-link active" : "workspace-nav-link";
    link.textContent = t(item.labelKey);
    if (item.active) {
      link.setAttribute("aria-current", "page");
    }
    workspaceNav.appendChild(link);
  }
}

function applyIdentityDefaults() {
  const identityDefaults = participantRuntimeConfig?.identityDefaults?.contentAdmin;
  if (!identityDefaults) {
    return;
  }

  document.getElementById("userId").value = identityDefaults.userId ?? "";
  document.getElementById("email").value = identityDefaults.email ?? "";
  document.getElementById("name").value = identityDefaults.name ?? "";
  document.getElementById("department").value = identityDefaults.department ?? "";
  rolesInput.value = Array.isArray(identityDefaults.roles) ? identityDefaults.roles.join(",") : "";
}

function setDefaultFormValues() {
  rubricCriteriaJsonInput.value = formatJsonDefault("adminContent.defaults.criteriaJson");
  rubricScalingRuleJsonInput.value = formatJsonDefault("adminContent.defaults.scalingRuleJson");
  rubricPassRuleJsonInput.value = formatJsonDefault("adminContent.defaults.passRuleJson");
  promptSystemPromptInput.value = t("adminContent.defaults.systemPrompt");
  promptUserPromptTemplateInput.value = t("adminContent.defaults.userPromptTemplate");
  promptExamplesJsonInput.value = formatJsonDefault("adminContent.defaults.examplesJson");
  mcqQuestionsJsonInput.value = formatJsonDefault("adminContent.defaults.questionsJson");
  moduleVersionTaskTextInput.value = t("adminContent.defaults.taskText");
  moduleVersionGuidanceTextInput.value = t("adminContent.defaults.guidanceText");
}

function normalizeModuleSummary(module) {
  if (!module || typeof module !== "object") {
    return null;
  }
  if (typeof module.id !== "string" || typeof module.title !== "string") {
    return null;
  }

  return {
    id: module.id,
    title: module.title,
    description: typeof module.description === "string" ? module.description : "",
  };
}

function renderModuleDropdown() {
  moduleDropdown.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-";
  emptyOption.selected = !selectedModuleId;
  moduleDropdown.appendChild(emptyOption);

  for (const module of modules) {
    const option = document.createElement("option");
    option.value = module.id;
    option.textContent = `${module.title} (${module.id})`;
    option.selected = module.id === selectedModuleId;
    moduleDropdown.appendChild(option);
  }
}

function renderModuleMeta() {
  const module = modules.find((item) => item.id === selectedModuleId) ?? null;
  if (module) {
    selectedModuleMeta.textContent = `${t("adminContent.meta.selectedModulePrefix")}: ${module.title} (${module.id})`;
    return;
  }

  if (selectedModuleId) {
    selectedModuleMeta.textContent = `${t("adminContent.meta.selectedModulePrefix")}: ${selectedModuleId}`;
    return;
  }

  selectedModuleMeta.textContent = `${t("adminContent.meta.selectedModulePrefix")}: ${t("adminContent.meta.noneSelected")}`;
}

function setSelectedModule(nextModuleId, syncInput = true) {
  selectedModuleId = typeof nextModuleId === "string" ? nextModuleId.trim() : "";
  if (syncInput) {
    selectedModuleIdInput.value = selectedModuleId;
  }
  renderModuleDropdown();
  renderModuleMeta();
}

function resolveModuleIdOrThrow() {
  const moduleId = selectedModuleIdInput.value.trim();
  if (!moduleId) {
    throw new Error(t("adminContent.errors.moduleIdRequired"));
  }
  selectedModuleId = moduleId;
  renderModuleDropdown();
  renderModuleMeta();
  return moduleId;
}

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Content Setup Workspace v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
  }
}

async function loadParticipantConsoleConfig() {
  try {
    const body = await getConsoleConfig();
    participantRuntimeConfig = {
      ...participantRuntimeConfig,
      ...body,
      navigation: {
        ...participantRuntimeConfig.navigation,
        ...(body?.navigation ?? {}),
      },
      identityDefaults: {
        ...participantRuntimeConfig.identityDefaults,
        ...(body?.identityDefaults ?? {}),
      },
    };
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  } catch {
    roleSwitchState = resolveRoleSwitchState(participantRuntimeConfig);
  }

  applyOutputVisibility();
  applyIdentityDefaults();
  renderRolePresetControl();
  renderWorkspaceNavigation();
}

async function loadModules() {
  const body = await apiFetch("/api/modules?includeCompleted=true", headers);
  modules = Array.isArray(body.modules)
    ? body.modules
      .map((module) => normalizeModuleSummary(module))
      .filter(Boolean)
    : [];

  if (!selectedModuleId && modules.length > 0) {
    setSelectedModule(modules[0].id);
  } else if (selectedModuleId && !modules.some((module) => module.id === selectedModuleId)) {
    setSelectedModule(selectedModuleId);
  } else {
    renderModuleDropdown();
    renderModuleMeta();
  }

  setMessage(`${t("adminContent.meta.loadedCountPrefix")}: ${modules.length}`);
  log(body);
}

async function handleCreateModule(options = { silent: false }) {
  const payload = {
    title: parseLocalizedTextField(moduleTitleInput.value, "adminContent.module.name"),
    description: parseLocalizedTextField(moduleDescriptionInput.value, "adminContent.module.description", {
      required: false,
    }),
    certificationLevel: parseLocalizedTextField(
      moduleCertificationLevelInput.value,
      "adminContent.module.certificationLevel",
      { required: false },
    ),
    validFrom: moduleValidFromInput.value || undefined,
    validTo: moduleValidToInput.value || undefined,
  };

  const body = await apiFetch("/api/admin/content/modules", headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const module = normalizeModuleSummary(body.module);
  if (module) {
    modules = [module, ...modules.filter((item) => item.id !== module.id)];
    setSelectedModule(module.id);
  }

  if (!options.silent) {
    setMessage(t("adminContent.message.moduleCreated"));
    log(body);
  }
  return body;
}

async function handleDeleteSelectedModule() {
  if (!selectedModuleId) {
    throw new Error(t("adminContent.errors.moduleIdRequired"));
  }

  const module = modules.find((item) => item.id === selectedModuleId) ?? null;
  const moduleLabel = module?.title ?? selectedModuleId;
  const confirmed = window.confirm(
    t("adminContent.confirm.deleteModule").replace("{module}", moduleLabel),
  );
  if (!confirmed) {
    return;
  }

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(selectedModuleId)}`, headers, {
    method: "DELETE",
  });

  modules = modules.filter((item) => item.id !== selectedModuleId);
  const nextModuleId = modules[0]?.id ?? "";
  setSelectedModule(nextModuleId);
  renderModuleDropdown();
  renderModuleMeta();
  setMessage(t("adminContent.message.moduleDeleted"));
  log(body);
}

async function handleLoadSelectedModuleContent() {
  const moduleExport = await fetchModuleExport();
  if (!moduleExport) {
    throw new Error("Module export payload was empty.");
  }

  populateFormFromModuleExport(moduleExport);
  setMessage(
    `${t("adminContent.message.moduleContentLoaded")} (${moduleExport.selectedConfiguration?.source ?? "unknown"})`,
  );
  log({ moduleExport });
}

async function handleExportSelectedModule() {
  const moduleExport = await fetchModuleExport();
  if (!moduleExport) {
    throw new Error("Module export payload was empty.");
  }

  const filename = `module-${selectedModuleId || moduleExport.module?.id || "export"}.json`;
  downloadJsonFile(filename, moduleExport);
  setMessage(t("adminContent.message.moduleExported"));
  log({ moduleExport });
}

async function handleCreateRubricVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const payload = {
    criteria: parseJsonField(rubricCriteriaJsonInput.value, "adminContent.rubric.criteria"),
    scalingRule: parseJsonField(rubricScalingRuleJsonInput.value, "adminContent.rubric.scalingRule"),
    passRule: parseJsonField(rubricPassRuleJsonInput.value, "adminContent.rubric.passRule"),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/rubric-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  moduleVersionRubricVersionIdInput.value = body?.rubricVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.rubricCreated"));
    log(body);
  }
  return body;
}

async function handleCreatePromptTemplateVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const payload = {
    systemPrompt: parseLocalizedTextField(promptSystemPromptInput.value, "adminContent.prompt.systemPrompt"),
    userPromptTemplate: parseLocalizedTextField(
      promptUserPromptTemplateInput.value,
      "adminContent.prompt.userPromptTemplate",
    ),
    examples: parseJsonField(promptExamplesJsonInput.value, "adminContent.prompt.examplesJson"),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/prompt-template-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  moduleVersionPromptTemplateVersionIdInput.value = body?.promptTemplateVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.promptCreated"));
    log(body);
  }
  return body;
}

async function handleCreateMcqSetVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const payload = {
    title: parseLocalizedTextField(mcqSetTitleInput.value, "adminContent.mcq.setTitle"),
    questions: parseJsonField(mcqQuestionsJsonInput.value, "adminContent.mcq.questionsJson"),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/mcq-set-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  moduleVersionMcqSetVersionIdInput.value = body?.mcqSetVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.mcqCreated"));
    log(body);
  }
  return body;
}

async function handleCreateModuleVersion(options = { silent: false }) {
  const moduleId = resolveModuleIdOrThrow();
  const payload = {
    taskText: parseLocalizedTextField(moduleVersionTaskTextInput.value, "adminContent.moduleVersion.taskText"),
    guidanceText: parseLocalizedTextField(
      moduleVersionGuidanceTextInput.value,
      "adminContent.moduleVersion.guidanceText",
      { required: false },
    ),
    rubricVersionId: moduleVersionRubricVersionIdInput.value.trim(),
    promptTemplateVersionId: moduleVersionPromptTemplateVersionIdInput.value.trim(),
    mcqSetVersionId: moduleVersionMcqSetVersionIdInput.value.trim(),
  };

  const body = await apiFetch(`/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions`, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  publishModuleVersionIdInput.value = body?.moduleVersion?.id ?? "";
  if (!options.silent) {
    setMessage(t("adminContent.message.moduleVersionCreated"));
    log(body);
  }
  return body;
}

async function handleSaveContentBundle() {
  const rubricBody = await handleCreateRubricVersion({ silent: true });
  const promptBody = await handleCreatePromptTemplateVersion({ silent: true });
  const mcqBody = await handleCreateMcqSetVersion({ silent: true });
  const moduleVersionBody = await handleCreateModuleVersion({ silent: true });

  setMessage(t("adminContent.message.bundleSaved"));
  log({
    rubricVersion: rubricBody.rubricVersion,
    promptTemplateVersion: promptBody.promptTemplateVersion,
    mcqSetVersion: mcqBody.mcqSetVersion,
    moduleVersion: moduleVersionBody.moduleVersion,
  });
}

async function handlePublishModuleVersion() {
  const moduleId = resolveModuleIdOrThrow();
  const moduleVersionId = publishModuleVersionIdInput.value.trim();
  if (!moduleVersionId) {
    throw new Error(t("adminContent.errors.moduleVersionIdRequired"));
  }

  const body = await apiFetch(
    `/api/admin/content/modules/${encodeURIComponent(moduleId)}/module-versions/${encodeURIComponent(moduleVersionId)}/publish`,
    headers,
    { method: "POST", body: JSON.stringify({}) },
  );
  setMessage(t("adminContent.message.moduleVersionPublished"));
  log(body);
}

loadMeButton.addEventListener("click", async () => {
  await runWithBusyButton(loadMeButton, async () => {
    try {
      const body = await apiFetch("/api/me", headers);
      log(body);
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

createModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(createModuleButton, async () => {
    try {
      await handleCreateModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

loadModulesButton.addEventListener("click", async () => {
  await runWithBusyButton(loadModulesButton, async () => {
    try {
      await loadModules();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

loadModuleContentButton.addEventListener("click", async () => {
  await runWithBusyButton(loadModuleContentButton, async () => {
    try {
      await handleLoadSelectedModuleContent();
    } catch (error) {
      setMessage(parseActionableErrorMessage(error));
      throw error;
    }
  });
});

exportModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(exportModuleButton, async () => {
    try {
      await handleExportSelectedModule();
    } catch (error) {
      setMessage(parseActionableErrorMessage(error));
      throw error;
    }
  });
});

deleteModuleButton.addEventListener("click", async () => {
  await runWithBusyButton(deleteModuleButton, async () => {
    try {
      await handleDeleteSelectedModule();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

saveContentBundleButton.addEventListener("click", async () => {
  await runWithBusyButton(saveContentBundleButton, async () => {
    try {
      await handleSaveContentBundle();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

publishModuleVersionButton.addEventListener("click", async () => {
  await runWithBusyButton(publishModuleVersionButton, async () => {
    try {
      await handlePublishModuleVersion();
    } catch (error) {
      const message = parseActionableErrorMessage(error);
      setMessage(message);
      log(message);
    }
  });
});

selectedModuleIdInput.addEventListener("input", () => {
  setSelectedModule(selectedModuleIdInput.value.trim(), false);
});

moduleDropdown.addEventListener("change", () => {
  setSelectedModule(moduleDropdown.value, true);
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
});

mockRolePresetSelect.addEventListener("change", () => {
  if (!mockRolePresetSelect.value || !roleSwitchState.enabled) {
    return;
  }

  rolesInput.value = mockRolePresetSelect.value;
  renderWorkspaceNavigation();
});

rolesInput.addEventListener("input", () => {
  const matchingPreset = findMatchingPreset(rolesInput.value, roleSwitchState.presets);
  mockRolePresetSelect.value = matchingPreset;
  renderWorkspaceNavigation();
});

populateLocaleSelect();
setLocale(currentLocale);
setDefaultFormValues();
loadVersion();
loadParticipantConsoleConfig();
renderModuleDropdown();
renderModuleMeta();
