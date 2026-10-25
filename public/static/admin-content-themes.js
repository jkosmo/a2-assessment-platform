// 2.102.0: tema i «Mine kurs» — /admin-content/themes.
//
// Produkteier 2026-10-25: «Tema defineres i et eget UI under innholdsforvaltning og plassert til
// venstre for kurs.» Bare administrator lager, endrer og sletter; alle andre i innholdsforvaltningen
// ser lista (de velger blant temaene inne i kurset) uten knappene.
//
// Navnet skrives på bokmål. Står nynorsk eller engelsk tomt når forfatteren lagrer, oversettes de
// med samme tjeneste som titlene på Moduler og Seksjoner (#894). Et språk som ikke kom gjennom,
// blir stående TOMT med en melding — aldri fylt med bokmålsteksten, som ville sett oversatt ut og
// lest som feil språk (#892).
import { supportedLocales, localeLabels, translations } from "/static/i18n/admin-content-translations.js";
import { resolveInitialLocale, createTranslator, pickLocalizedText } from "/static/i18n-locale.js";
import { apiFetch, buildConsoleHeaders, getConsoleConfig } from "/static/api-client.js";
import { initConsentGuard } from "/static/consent-guard.js";
import { resolveWorkspaceNavigationItems } from "/static/participant-console-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { describeApiError } from "/static/api-error.js";
import { showToast } from "/static/toast.js";
import { escapeHtml } from "/static/html-escape.js";
import { createListPage } from "/static/list-page.js";

const THEME_LOCALES = ["nb", "nn", "en-GB"];

let currentLocale = resolveInitialLocale(supportedLocales);
const { t, tf } = createTranslator(translations, () => currentLocale);

let participantRuntimeConfig = {};
let headerValues = {};
let activeUserRoles = [];
const getHeaders = () => headerValues;

const pageContent = document.getElementById("pageContent");
const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const localeSelect = document.getElementById("localeSelect");
const appVersionLabel = document.getElementById("appVersion");
const navKalibrering = document.getElementById("navKalibrering");

const isAdministrator = () => activeUserRoles.includes("ADMINISTRATOR");

function apiErrorToast(error) {
  const { headline, detail } = describeApiError(error, t);
  showToast(headline, "error", detail);
}

/** Lagret navn → språkkart. Et navn lagret som ren tekst regnes som bokmål. */
function nameMap(raw) {
  if (typeof raw !== "string") return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {/* faller gjennom til ren tekst */}
  }
  return trimmed ? { nb: trimmed } : {};
}

const displayName = (theme) => pickLocalizedText(nameMap(theme.name), currentLocale) || theme.name;

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

let listPage = null;

function getListPage() {
  if (listPage) return listPage;
  listPage = createListPage({
    host: pageContent,
    ids: { tbody: "themesTableBody", search: "themesSearch" },
    texts: () => ({
      title: t("themes.title"),
      lead: isAdministrator() ? t("themes.lead") : `${t("themes.lead")} ${t("themes.adminOnly")}`,
      searchPlaceholder: t("themes.searchPlaceholder"), searchLabel: t("themes.searchPlaceholder"),
      filterGroupLabel: t("themes.filterGroupLabel"),
      empty: t("themes.empty"), emptyFiltered: t("themes.emptyFiltered"), loadError: t("themes.loadError"), more: t("form.more"),
    }),
    headerActions: () => [{ id: "newThemeBtn", label: t("themes.new"), kind: "primary", hidden: !isAdministrator() }],
    // Tema har ingen tilstander; ett filter gir ingen piller.
    filters: { options: [["all", ""]], initial: "all", matches: () => true },
    search: { matches: (theme, q) => Object.values(nameMap(theme.name)).some((v) => String(v).toLowerCase().includes(q)) },
    // Lista står alltid alfabetisk (produkteier 2026-10-25), på navnet i leserens språk.
    sort: { key: "name", dir: "asc", locale: () => currentLocale },
    columns: () => [
      { key: "name", label: t("themes.col.nb"), className: "col-title", sortValue: (theme) => nameMap(theme.name).nb ?? "", render: (theme) => escapeHtml(nameMap(theme.name).nb ?? "") },
      { key: "nn", label: t("themes.col.nn"), render: (theme) => escapeHtml(nameMap(theme.name).nn ?? "–") },
      { key: "en", label: t("themes.col.en"), render: (theme) => escapeHtml(nameMap(theme.name)["en-GB"] ?? "–") },
      { key: "courses", label: t("themes.col.courses"), sortValue: (theme) => theme.courseCount ?? 0, render: (theme) => String(theme.courseCount ?? 0) },
    ],
    rowId: (theme) => theme.id,
    actions: () => isAdministrator()
      ? [
          `<button class="row-action-btn" data-action="edit">${escapeHtml(t("themes.action.edit"))}</button>`,
          `<button class="row-action-btn destructive" data-action="delete">${escapeHtml(t("themes.action.delete"))}</button>`,
        ]
      : [],
    load: async () => (await apiFetch("/api/admin/content/themes", getHeaders)).themes ?? [],
    describeError: (err) => describeApiError(err, t).headline,
    onAction: (action, _id, _btn, theme) => {
      if (!theme) return;
      if (action === "edit") openThemeDialog(theme);
      else if (action === "delete") openDeleteDialog(theme);
    },
    afterRender: () => {
      document.getElementById("newThemeBtn")?.addEventListener("click", () => openThemeDialog(null));
    },
  });
  return listPage;
}

// ---------------------------------------------------------------------------
// Nytt / endre
// ---------------------------------------------------------------------------

const themeDialog = document.getElementById("themeDialog");
const themeDialogForm = document.getElementById("themeDialogForm");
const themeDialogError = document.getElementById("themeDialogError");
const themeDialogSaveBtn = document.getElementById("themeDialogSaveBtn");
const nameInput = (locale) => document.getElementById(`themeName-${locale}`);
let editingTheme = null;

function showDialogError(text) {
  themeDialogError.textContent = text;
  themeDialogError.hidden = !text;
}

function applyDialogTexts() {
  document.getElementById("themeDialogTitle").textContent = t(editingTheme ? "themes.dialog.editTitle" : "themes.dialog.newTitle");
  document.getElementById("themeDialogHint").textContent = t("themes.dialog.hint");
  document.getElementById("themeNameLabel-nb").textContent = t("themes.dialog.labelNb");
  document.getElementById("themeNameLabel-nn").textContent = t("themes.dialog.labelNn");
  document.getElementById("themeNameLabel-en-GB").textContent = t("themes.dialog.labelEn");
  themeDialogSaveBtn.textContent = t("themes.dialog.save");
  document.getElementById("themeDialogCancelBtn").textContent = t("themes.dialog.cancel");
}

function openThemeDialog(theme) {
  editingTheme = theme;
  const names = theme ? nameMap(theme.name) : {};
  for (const locale of THEME_LOCALES) nameInput(locale).value = names[locale] ?? "";
  showDialogError("");
  applyDialogTexts();
  themeDialogSaveBtn.disabled = false;
  themeDialog.showModal();
  nameInput("nb").focus();
}

/**
 * Fyller tomme språk fra bokmål. Returnerer språkene som ikke kom gjennom; de står tomme.
 * @param {Record<string,string>} names
 */
async function translateMissing(names) {
  const missing = THEME_LOCALES.filter((locale) => locale !== "nb" && !names[locale]);
  if (missing.length === 0) return [];
  try {
    const body = await apiFetch("/api/admin/content/titles/localize", getHeaders, {
      method: "POST",
      body: JSON.stringify({ title: names.nb, sourceLocale: "nb", targetLocales: missing }),
    });
    for (const locale of missing) {
      const value = body?.title?.[locale];
      if (typeof value === "string" && value.trim()) names[locale] = value.trim();
    }
  } catch {/* alle som mangler, står tomme og meldes under */}
  return missing.filter((locale) => !names[locale]);
}

async function saveTheme(event) {
  event.preventDefault();
  /** @type {Record<string,string>} */
  const names = {};
  for (const locale of THEME_LOCALES) {
    const value = nameInput(locale).value.trim();
    if (value) names[locale] = value;
  }
  if (!names.nb) {
    showDialogError(t("themes.nameRequired"));
    nameInput("nb").focus();
    return;
  }
  showDialogError("");
  themeDialogSaveBtn.disabled = true;
  themeDialogSaveBtn.textContent = t("themes.dialog.saving");
  try {
    const failed = await translateMissing(names);
    // Det som ble oversatt, vises i feltene — forfatteren ser hva som lagres.
    for (const locale of THEME_LOCALES) nameInput(locale).value = names[locale] ?? "";
    const url = editingTheme ? `/api/admin/content/themes/${encodeURIComponent(editingTheme.id)}` : "/api/admin/content/themes";
    const body = await apiFetch(url, getHeaders, { method: editingTheme ? "PUT" : "POST", body: JSON.stringify({ name: names }) });
    if (failed.length > 0) {
      // Lagret, men et språk mangler: vinduet blir stående med meldingen, så forfatteren kan fylle
      // inn. Et nytt tema har nå en id — neste lagring skal endre det, ikke lage et til.
      editingTheme = body.theme;
      showToast(t("themes.saved"), "success");
      await getListPage().reload();
      applyDialogTexts();
      // Språket med samme navn som feltet det står i — ikke språkvelgerens «English (UK)» midt i norsk tekst.
      const fieldLabel = { nn: t("themes.dialog.labelNn"), "en-GB": t("themes.dialog.labelEn") };
      showDialogError(tf("themes.translateFailed", { locales: failed.map((l) => fieldLabel[l] ?? l).join(", ") }));
      return;
    }
    themeDialog.close();
    showToast(t("themes.saved"), "success");
    await getListPage().reload();
  } catch (error) {
    apiErrorToast(error);
  } finally {
    themeDialogSaveBtn.disabled = false;
    themeDialogSaveBtn.textContent = t("themes.dialog.save");
  }
}

themeDialogForm?.addEventListener("submit", saveTheme);
document.getElementById("themeDialogCancelBtn")?.addEventListener("click", () => themeDialog.close());

// ---------------------------------------------------------------------------
// Slett
// ---------------------------------------------------------------------------

const deleteDialog = document.getElementById("themeDeleteDialog");
let deletingTheme = null;

function openDeleteDialog(theme) {
  deletingTheme = theme;
  document.getElementById("themeDeleteTitle").textContent = tf("themes.delete.title", { name: displayName(theme) });
  document.getElementById("themeDeleteText").textContent = theme.courseCount > 0
    ? tf("themes.delete.text", { count: theme.courseCount })
    : t("themes.delete.textNone");
  document.getElementById("themeDeleteConfirmBtn").textContent = t("themes.delete.confirm");
  document.getElementById("themeDeleteCancelBtn").textContent = t("themes.dialog.cancel");
  deleteDialog.showModal();
}

document.getElementById("themeDeleteCancelBtn")?.addEventListener("click", () => deleteDialog.close());
document.getElementById("themeDeleteConfirmBtn")?.addEventListener("click", async () => {
  if (!deletingTheme) return;
  const btn = document.getElementById("themeDeleteConfirmBtn");
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/content/themes/${encodeURIComponent(deletingTheme.id)}`, getHeaders, { method: "DELETE" });
    deleteDialog.close();
    showToast(t("themes.deleted"), "success");
    await getListPage().reload();
  } catch (error) {
    apiErrorToast(error);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Oppstart
// ---------------------------------------------------------------------------

function buildLocaleSelector() {
  if (!localeSelect) return;
  localeSelect.innerHTML = supportedLocales.map((l) => `<option value="${l}"${l === currentLocale ? " selected" : ""}>${localeLabels[l] ?? l}</option>`).join("");
  localeSelect.addEventListener("change", () => {
    currentLocale = localeSelect.value;
    localStorage.setItem("participant.locale", currentLocale);
    if (headerValues && typeof headerValues === "object") headerValues["x-locale"] = currentLocale;
    renderWorkspaceNavigation();
    getListPage().rerender();
  });
}

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const roles = activeUserRoles.length > 0 ? activeUserRoles : ["SUBJECT_MATTER_OWNER"];
  const items = resolveWorkspaceNavigationItems(participantRuntimeConfig?.navigation?.items, roles.join(","), window.location.pathname);
  renderWorkspaceNavigationWithProfile({ workspaceNav, localePicker, items, buildLabel: (item) => t(item.labelKey) || item.id });
}

function renderContentAreaNav() {
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  if (navKalibrering) navKalibrering.hidden = !activeUserRoles.some((r) => calibrationRoles.has(r));
}

async function init() {
  try {
    const cfg = await getConsoleConfig();
    participantRuntimeConfig = cfg;
    const defaults = cfg?.identityDefaults?.contentAdmin ?? cfg?.identityDefaults ?? {};
    headerValues = buildConsoleHeaders({
      userId: defaults.userId,
      email: defaults.email,
      name: defaults.name,
      department: defaults.department,
      roles: Array.isArray(defaults.roles) ? defaults.roles.join(",") : defaults.roles,
      locale: currentLocale,
    });
    try {
      const me = await apiFetch("/api/me", getHeaders);
      activeUserRoles = Array.isArray(me?.user?.roles) ? me.user.roles : [];
    } catch {
      activeUserRoles = [];
    }
  } catch {
    headerValues = {};
  }

  buildLocaleSelector();
  renderWorkspaceNavigation();
  renderContentAreaNav();
  await initConsentGuard(getHeaders, currentLocale);

  try {
    const body = await apiFetch("/version", { headers: {} });
    if (appVersionLabel) appVersionLabel.textContent = `v${body.version ?? "unknown"}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  await getListPage().reload().catch(() => {/* lista viser selv feilen */});
}

init();
