import { localeLabels, supportedLocales, translations } from "/static/i18n/certificate-translations.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";

const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const printBtn = document.getElementById("printBtn");
const certState = document.getElementById("certState");
const certificateEl = document.getElementById("certificate");

let currentLocale = resolveInitialLocale();
// Identity used for mock-mode headers; in entra mode the Bearer token (added by apiFetch)
// authenticates and these x-user-* values are ignored.
let identity = {
  userId: "participant-1",
  email: "participant@company.com",
  name: "Platform Participant",
  department: "Consulting",
  roles: ["PARTICIPANT"],
};

function resolveInitialLocale() {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) return stored;
  const normalized = (navigator.language ?? "").toLowerCase();
  if (normalized.startsWith("nb")) return "nb";
  if (normalized.startsWith("nn")) return "nn";
  return "en-GB";
}

function t(key) {
  return translations[currentLocale]?.[key] ?? translations["en-GB"][key] ?? key;
}

function headers() {
  return buildConsoleHeaders({
    userId: identity.userId,
    email: identity.email,
    name: identity.name,
    department: identity.department,
    roles: Array.isArray(identity.roles) ? identity.roles.join(",") : (identity.roles ?? ""),
    locale: currentLocale,
  });
}

function applyTranslations() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
  document.documentElement.lang = currentLocale;
  document.title = t("certificate.docTitle");
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(currentLocale, { dateStyle: "long" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function localizeCertLevel(level) {
  if (!level) return "-";
  const key = `certLevel.${String(level).toLowerCase()}`;
  const label = t(key);
  return label === key ? String(level) : label;
}

function showState(messageKey) {
  certificateEl.hidden = true;
  certState.hidden = false;
  certState.textContent = t(messageKey);
}

function renderCertificate(data) {
  document.getElementById("certName").textContent = data.participantName ?? "-";
  document.getElementById("certCourse").textContent = data.courseTitle ?? data.courseId ?? "-";
  document.getElementById("certCompletedAt").textContent = formatDate(data.completedAt);
  document.getElementById("certLevel").textContent = localizeCertLevel(data.certificationLevel);
  const modulesWrap = document.getElementById("certModulesWrap");
  if (typeof data.moduleCount === "number" && data.moduleCount > 0) {
    document.getElementById("certModules").textContent = String(data.moduleCount);
    modulesWrap.hidden = false;
  } else {
    modulesWrap.hidden = true;
  }
  document.getElementById("certId").textContent = data.certificateId ?? "-";

  certState.hidden = true;
  certificateEl.hidden = false;
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

async function loadVersion() {
  try {
    const body = await apiFetch("/version", { headers: {} });
    appVersionLabel.textContent = `v${body.version ?? "unknown"}`;
  } catch {
    appVersionLabel.textContent = "unknown";
  }
}

async function loadIdentityDefaults() {
  try {
    const config = await getConsoleConfig();
    const def = config?.identityDefaults?.participant;
    if (def) identity = { ...identity, ...def };
  } catch {
    /* fall back to built-in defaults */
  }
}

async function loadCertificate() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    showState("certificate.missingId");
    return;
  }
  try {
    const data = await apiFetch(`/api/courses/completions/${encodeURIComponent(id)}`, headers);
    renderCertificate(data);
  } catch {
    showState("certificate.notFound");
  }
}

printBtn.addEventListener("click", () => window.print());
localeSelect.addEventListener("change", () => {
  currentLocale = supportedLocales.includes(localeSelect.value) ? localeSelect.value : "en-GB";
  localStorage.setItem("participant.locale", currentLocale);
  applyTranslations();
});

populateLocaleSelect();
applyTranslations();
loadVersion();
loadIdentityDefaults().then(loadCertificate);
