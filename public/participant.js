import { localeLabels, supportedLocales, translations } from "/static/i18n/participant-translations.js";

const output = document.getElementById("output");
const moduleList = document.getElementById("moduleList");
const mcqQuestions = document.getElementById("mcqQuestions");
const localeSelect = document.getElementById("localeSelect");

const selectedModuleIdInput = document.getElementById("selectedModuleId");
const submissionIdLabel = document.getElementById("submissionId");
const attemptIdLabel = document.getElementById("attemptId");
const appealIdLabel = document.getElementById("appealId");
const appVersionLabel = document.getElementById("appVersion");
const resultSummary = document.getElementById("resultSummary");
const historySummary = document.getElementById("historySummary");

let currentQuestions = [];
let currentLocale = resolveInitialLocale();
let latestResult = null;
let latestHistory = null;

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

function setLocale(locale) {
  currentLocale = supportedLocales.includes(locale) ? locale : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  document.documentElement.lang = currentLocale;
  applyTranslations();
  renderResultSummary(latestResult);
  renderHistorySummary(latestHistory);
}

function applyTranslations() {
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const key = element.getAttribute("data-i18n");
    if (!key) {
      continue;
    }
    element.textContent = t(key);
  }

  output.textContent = t("defaults.ready");
  if (!resultSummary.dataset.hasResult) {
    resultSummary.textContent = t("defaults.noResult");
  }
  if (!historySummary.dataset.hasHistory) {
    historySummary.textContent = t("defaults.noHistory");
  }
}

function setDefaultFieldValues() {
  document.getElementById("rawText").value = t("defaults.rawText");
  document.getElementById("reflectionText").value = t("defaults.reflection");
  document.getElementById("promptExcerpt").value = t("defaults.promptExcerpt");
  document.getElementById("appealReason").value = t("defaults.appealReason");
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

function headers() {
  const roles = document
    .getElementById("roles")
    .value.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");

  return {
    "Content-Type": "application/json",
    "x-user-id": document.getElementById("userId").value,
    "x-user-email": document.getElementById("email").value,
    "x-user-name": document.getElementById("name").value,
    "x-user-department": document.getElementById("department").value,
    "x-user-roles": roles,
    "x-locale": currentLocale,
  };
}

function log(data) {
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers ?? {}) },
  });

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function loadVersion() {
  try {
    const body = await api("/version", { headers: {} });
    const version = body.version ?? "unknown";
    document.title = `A2 Participant Test Console v${version}`;
    appVersionLabel.textContent = `v${version}`;
  } catch {
    appVersionLabel.textContent = "unknown";
  }
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat(currentLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatNumber(value, maxFractionDigits = 2) {
  if (typeof value !== "number") {
    return "-";
  }

  return new Intl.NumberFormat(currentLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function renderResultSummary(body) {
  latestResult = body;

  if (!body) {
    resultSummary.dataset.hasResult = "";
    resultSummary.textContent = t("result.none");
    return;
  }

  const lines = [
    `${t("result.status")}: ${body.status ?? "-"}`,
    `${t("result.statusExplanation")}: ${body.statusExplanation ?? "-"}`,
    `${t("result.totalScore")}: ${formatNumber(body.scoreComponents?.totalScore)}`,
    `${t("result.mcqScore")}: ${formatNumber(body.scoreComponents?.mcqScaledScore)}`,
    `${t("result.practicalScore")}: ${formatNumber(body.scoreComponents?.practicalScaledScore)}`,
    `${t("result.decision")}: ${body.decision?.decisionType ?? "-"}`,
    `${t("result.decisionReason")}: ${body.participantGuidance?.decisionReason ?? "-"}`,
    `${t("result.confidence")}: ${body.participantGuidance?.confidenceNote ?? "-"}`,
    `${t("result.improvementAdvice")}: ${body.participantGuidance?.improvementAdvice ?? "-"}`,
    `${t("result.rationales")}:`,
  ];

  const rationales = body.participantGuidance?.criterionRationales ?? {};
  for (const [criterion, rationale] of Object.entries(rationales)) {
    lines.push(`- ${criterion}: ${String(rationale)}`);
  }

  resultSummary.dataset.hasResult = "true";
  resultSummary.textContent = lines.join("\n");
}

function renderHistorySummary(body) {
  latestHistory = body;
  const history = body?.history ?? [];

  if (!Array.isArray(history) || history.length === 0) {
    historySummary.dataset.hasHistory = "";
    historySummary.textContent = t("history.empty");
    return;
  }

  const lines = [];
  for (const item of history) {
    lines.push(`${t("history.entry")}: ${item.submissionId}`);
    lines.push(`${t("history.module")}: ${item.module?.title ?? "-"} (${item.module?.id ?? "-"})`);
    lines.push(`${t("history.submittedAt")}: ${formatDateTime(item.submittedAt)}`);
    lines.push(`${t("history.latestStatus")}: ${item.status ?? "-"}`);
    lines.push(`${t("history.latestDecision")}: ${item.latestDecision?.decisionType ?? "-"}`);
    lines.push(`${t("history.latestScore")}: ${formatNumber(item.latestDecision?.totalScore)}`);
    lines.push("");
  }

  historySummary.dataset.hasHistory = "true";
  historySummary.textContent = lines.join("\n").trim();
}

document.getElementById("loadMe").addEventListener("click", async () => {
  try {
    const body = await api("/api/me");
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("loadModules").addEventListener("click", async () => {
  try {
    const body = await api("/api/modules");
    moduleList.innerHTML = "";
    for (const module of body.modules) {
      const btn = document.createElement("button");
      btn.textContent = `${module.title} (${module.id})`;
      btn.addEventListener("click", () => {
        selectedModuleIdInput.value = module.id;
        log({ selectedModule: module });
      });
      moduleList.appendChild(btn);
      moduleList.appendChild(document.createElement("br"));
    }
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("createSubmission").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleIdInput.value;
    if (!moduleId) {
      throw new Error(t("errors.selectModuleFirst"));
    }
    const body = await api("/api/submissions", {
      method: "POST",
      body: JSON.stringify({
        moduleId,
        deliveryType: "text",
        rawText: document.getElementById("rawText").value,
        reflectionText: document.getElementById("reflectionText").value,
        promptExcerpt: document.getElementById("promptExcerpt").value,
        responsibilityAcknowledged: document.getElementById("ack").checked,
      }),
    });
    submissionIdLabel.textContent = body.submission.id;
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("startMcq").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleIdInput.value;
    const submissionId = submissionIdLabel.textContent;
    if (!moduleId || !submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(
      `/api/modules/${moduleId}/mcq/start?submissionId=${encodeURIComponent(submissionId)}`,
    );
    attemptIdLabel.textContent = body.attemptId;
    currentQuestions = body.questions;
    renderQuestions();
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("submitMcq").addEventListener("click", async () => {
  try {
    const moduleId = selectedModuleIdInput.value;
    const submissionId = submissionIdLabel.textContent;
    const attemptId = attemptIdLabel.textContent;
    if (!moduleId || !submissionId || !attemptId || attemptId === "-") {
      throw new Error(t("errors.startMcqFirst"));
    }

    const responses = currentQuestions.map((q) => {
      const selected = document.querySelector(`input[name='q_${q.id}']:checked`);
      return {
        questionId: q.id,
        selectedAnswer: selected ? selected.value : "",
      };
    });

    const body = await api(`/api/modules/${moduleId}/mcq/submit`, {
      method: "POST",
      body: JSON.stringify({
        submissionId,
        attemptId,
        responses,
      }),
    });
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("queueAssessment").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(`/api/assessments/${submissionId}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("checkAssessment").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(`/api/assessments/${submissionId}`);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("checkResult").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const body = await api(`/api/submissions/${submissionId}/result`);
    renderResultSummary(body);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("createAppeal").addEventListener("click", async () => {
  try {
    const submissionId = submissionIdLabel.textContent;
    if (!submissionId || submissionId === "-") {
      throw new Error(t("errors.createSubmissionFirst"));
    }
    const appealReason = document.getElementById("appealReason").value;
    const body = await api(`/api/submissions/${submissionId}/appeals`, {
      method: "POST",
      body: JSON.stringify({ appealReason }),
    });
    appealIdLabel.textContent = body.appeal.id;
    log(body);
  } catch (error) {
    log(error.message);
  }
});

document.getElementById("loadHistory").addEventListener("click", async () => {
  try {
    const body = await api("/api/submissions/history?limit=20");
    renderHistorySummary(body);
    log(body);
  } catch (error) {
    log(error.message);
  }
});

localeSelect.addEventListener("change", () => {
  setLocale(localeSelect.value);
});

function renderQuestions() {
  mcqQuestions.innerHTML = "";
  for (const question of currentQuestions) {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "12px";
    const title = document.createElement("div");
    title.textContent = question.stem;
    wrapper.appendChild(title);

    for (const option of question.options) {
      const label = document.createElement("label");
      label.style.display = "block";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q_${question.id}`;
      input.value = option;
      label.appendChild(input);
      label.append(` ${option}`);
      wrapper.appendChild(label);
    }

    mcqQuestions.appendChild(wrapper);
  }
}

populateLocaleSelect();
setLocale(currentLocale);
setDefaultFieldValues();
loadVersion();
