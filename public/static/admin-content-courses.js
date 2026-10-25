import { createDateFormatter } from "./format-display.js";
const formatDate = createDateFormatter(() => currentLocale);
import { pickLocalizedText, resolveInitialLocale, createTranslator } from "/static/i18n-locale.js";
import { escapeHtml } from "./html-escape.js";
import { lifecycleBadge, lifecycleOf } from "./content-status-badge.js";
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
import { initConsentGuard } from "/static/consent-guard.js";
import { setHidden } from "/static/dom-visibility.js";
import { runWithWorkDialog } from "/static/work-dialog.js";
import {
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";
import { describeImportError } from "/static/import-error.js";
import { apiErrorCodeText, describeApiError } from "/static/api-error.js";
import { flushQueuedToast, queueToast, showToast } from "/static/toast.js";
import {
  detectCoursesRoute,
  buildCourseDeleteDialogText,
  deriveCourseListRows,
  moveItem,
  courseItemTypeBadge,
  buildCourseItemHref,
} from "/static/admin-content-courses-state.js";
import { renderWorkspaceNavigationWithProfile } from "./workspace-nav.js";
import { renderOwnerPanel } from "/static/owner-panel.js";
import { createListPage } from "/static/list-page.js";
import { createFormPage, formPageTexts } from "/static/form-page.js";

// #1046 C2: bokmål først, som i alle språkvelgere. Bokmål er det påkrevde språket (produkteier 12.09); publiseringsgaten krever fortsatt alle tre.
const DETAIL_LOCALES = ["nb", "nn", "en-GB"];

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

let currentLocale = resolveInitialLocale(supportedLocales);

const { t, tf } = createTranslator(adminContentTranslations, () => currentLocale);

// #972: én vei ut for hver fanget apiFetch-feil på denne siden. Åtte steder sendte tidligere
// `err.message` rett i en toast, med en norsk setning som `??`-reserve — og viste dermed
// `403: {"error":"content_ownership",…}`, mens reserven aldri kunne kjøre (apiFetch setter alltid
// `message`). Nå slås KODEN opp i den delte tabellen.
//
// Dette er en FORFATTERflate, så serverens diagnostikk beholdes i toastens detaljfelt: en forfatter
// kan bruke `path: ["bodyMarkdown"]` til å finne feilen i fila si. Deltakerflaten gjør det ikke.
function apiErrorToast(error) {
  const { headline, detail } = describeApiError(error, t);
  showToast(headline, "error", detail);
}

// Samme oversettelse for de flatene som ikke er en toast: feilbannere og tomtilstander. De sto
// utenfor showToast-vakta i #972 og viste derfor fortsatt rå JSON etter at toastene var fikset.
function apiErrorText(error) {
  return describeApiError(error, t).headline;
}

// ---------------------------------------------------------------------------
// Runtime config / auth
// ---------------------------------------------------------------------------

let participantRuntimeConfig = {
  identityDefaults: { roles: ["SUBJECT_MATTER_OWNER"] },
  navigation: { items: [] },
  calibrationWorkspace: { accessRoles: [] },
};
let activeUserRoles = [];

let _headerValues = {};
function getHeaders() { return _headerValues; }

// #762: gate ADMINISTRATOR-only controls on the roles resolved from /api/me (activeUserRoles) —
// never on identityDefaults alone (see CLAUDE.md / FEATURE_SURFACE_MAP #12).
function isAdministrator() {
  return Array.isArray(activeUserRoles) && activeUserRoles.includes("ADMINISTRATOR");
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const workspaceNav = document.getElementById("workspaceNav");
const localePicker = document.querySelector(".locale-picker");
const appVersionLabel = document.getElementById("appVersion");
const localeSelect = document.getElementById("localeSelect");
const pageContent = document.getElementById("pageContent");
const navKalibrering = document.getElementById("navKalibrering");
const deleteDialog = document.getElementById("deleteDialog");
const deleteDialogText = document.getElementById("deleteDialogText");
const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
const deleteCancelBtn = document.getElementById("deleteCancelBtn");
const cascadePublishDialog = document.getElementById("cascadePublishDialog");
const cascadeDeleteDialog = document.getElementById("cascadeDeleteDialog");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



function localizedText(value) {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return pickLocalizedText(parsed, currentLocale) || value;
        }
      } catch { /* plain string */ }
    }
    return value;
  }
  return pickLocalizedText(value, currentLocale);
}

function parseLocalizedFieldValues(value) {
  const empty = { "en-GB": "", nb: "", nn: "" };
  if (value == null) {
    return empty;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return {
            "en-GB": typeof parsed["en-GB"] === "string" ? parsed["en-GB"] : "",
            nb: typeof parsed.nb === "string" ? parsed.nb : "",
            nn: typeof parsed.nn === "string" ? parsed.nn : "",
          };
        }
      } catch {
        // Fall through and treat it as a plain string.
      }
    }
    // En ren streng uten språkmerke leses som bokmål — samme regel som tjeneren (#930,
    // contentValidationService: sourceLocale = "nb"). Klienten la den før i en-GB, så et kurs med
    // ren strengtittel så ut som engelsk og manglet bokmål.
    return { "en-GB": "", nb: value, nn: "" };
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      "en-GB": typeof value["en-GB"] === "string" ? value["en-GB"] : "",
      nb: typeof value.nb === "string" ? value.nb : "",
      nn: typeof value.nn === "string" ? value.nn : "",
    };
  }

  return empty;
}

function cloneLocalizedFieldValues(valueMap) {
  const clone = {};
  for (const locale of supportedLocales) {
    clone[locale] = typeof valueMap?.[locale] === "string" ? valueMap[locale] : "";
  }
  return clone;
}

function cloneCourseLocaleValues(values) {
  return {
    title: cloneLocalizedFieldValues(values?.title),
    description: cloneLocalizedFieldValues(values?.description),
  };
}

function hasAnyLocalizedValue(valueMap) {
  return supportedLocales.some((locale) => typeof valueMap?.[locale] === "string" && valueMap[locale].trim().length > 0);
}

function firstNonEmptyLocale(valueMap, preferredLocales = supportedLocales) {
  const orderedLocales = [...new Set([...preferredLocales, ...supportedLocales])];
  for (const locale of orderedLocales) {
    const value = valueMap?.[locale];
    if (typeof value === "string" && value.trim().length > 0) {
      return locale;
    }
  }
  return null;
}

function getChangedCourseLocales(currentValues, initialValues) {
  const changed = new Set();
  for (const locale of supportedLocales) {
    const currentTitle = currentValues?.title?.[locale] ?? "";
    const initialTitle = initialValues?.title?.[locale] ?? "";
    const currentDescription = currentValues?.description?.[locale] ?? "";
    const initialDescription = initialValues?.description?.[locale] ?? "";
    if (currentTitle !== initialTitle || currentDescription !== initialDescription) {
      changed.add(locale);
    }
  }
  return changed;
}

function applyCourseLocaleValuesToForm(values) {
  for (const locale of supportedLocales) {
    const titleInput = document.getElementById(`title-${locale}`);
    const descriptionInput = document.getElementById(`desc-${locale}`);
    if (titleInput) {
      titleInput.value = values?.title?.[locale] ?? "";
    }
    if (descriptionInput) {
      descriptionInput.value = values?.description?.[locale] ?? "";
    }
  }

  // Tittelen i hodet følger navnefeltet (skjemasida leser det).
  courseFormPage?.refreshTitle();
}

function resolveCourseLocalizationSourceLocale(currentValues, initialValues) {
  const changedLocales = getChangedCourseLocales(currentValues, initialValues);
  if (changedLocales.size === 1) {
    return [...changedLocales][0];
  }
  if (changedLocales.size === 0) {
    return firstNonEmptyLocale(currentValues?.title, [activeDetailLocale, currentLocale, "en-GB"]) ??
      firstNonEmptyLocale(currentValues?.description, [activeDetailLocale, currentLocale, "en-GB"]);
  }
  return null;
}

/**
 * #1037: en oversettelse som ikke kom, skal se ut som en oversettelse som ikke kom.
 *
 * ⚠️ SKREV TIDLIGERE KILDETEKSTEN INN I MÅLLOKALET. To steder gjorde det: `|| sourceTitle` når
 * svaret manglet feltet, og `catch`-blokka ved nettverksfeil. Resultatet var et fullt trespråkskart
 * som PÅSTO at kurset var oversatt — og løgnen ble fortalt nettopp når noe allerede hadde gått galt,
 * mens forfatteren så en feilmelding om noe annet.
 *
 * Nedstrøms trodde publiseringsgaten at kurset var ferdig, oversettelsesstatusen i lista viste det
 * som komplett, og en nynorskdeltaker fikk bokmål servert som nynorsk. Det er #892-invarianten
 * brutt stille.
 *
 * ⚠️ #930 DEKKET IKKE DETTE. Den sørget for at innhold skrevet i ETT språk bærer hvilket. Denne
 * stien skriver TRE, og ligger derfor utenfor.
 *
 * Retter etter #982/#905-mønsteret: lokalen SLIPPES, og føres opp i `failedLocales` slik at kalleren
 * kan si fra. Stillhet her var halve #892 — derfor returnerer funksjonen listen, og begge kallerne
 * viser den.
 *
 * `preserveExisting` er urørt: redigerer man et kurs som allerede har en oversettelse, beholdes den
 * når en ny ikke kom. Det er ikke en løgn — teksten ER oversatt, bare ikke på nytt.
 */
async function localizeCourseCopyAcrossLocales({ titleValues, descriptionValues, sourceLocale, preserveExisting = false }) {
  const localized = {
    title: cloneLocalizedFieldValues(titleValues),
    description: cloneLocalizedFieldValues(descriptionValues),
    failedLocales: [],
  };

  const sourceTitle = localized.title[sourceLocale]?.trim() ?? "";
  const sourceDescription = localized.description[sourceLocale]?.trim() ?? "";
  const hasSourceTitle = sourceTitle.length > 0;
  const hasSourceDescription = sourceDescription.length > 0;

  if (!hasSourceTitle && !hasSourceDescription) {
    return localized;
  }

  for (const targetLocale of supportedLocales) {
    if (targetLocale === sourceLocale) continue;

    try {
      const result = await apiFetch("/api/admin/content/courses/localize-copy", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          ...(hasSourceTitle ? { title: sourceTitle } : {}),
          ...(hasSourceDescription ? { description: sourceDescription } : {}),
          sourceLocale,
          targetLocale,
        }),
      });

      // ⚠️ INGEN `|| sourceTitle` HER. Kom det ingen oversettelse, blir lokalen stående tom — med
      // mindre det ALLEREDE fantes en, og vi er i redigeringsmodus.
      let feilet = false;
      if (hasSourceTitle) {
        const oversatt = result?.title?.trim?.() || "";
        const beholdt = preserveExisting ? localized.title[targetLocale] : "";
        localized.title[targetLocale] = oversatt || beholdt || "";
        if (!oversatt && !beholdt) feilet = true;
      }
      if (hasSourceDescription) {
        const oversatt = result?.description?.trim?.() || "";
        const beholdt = preserveExisting ? localized.description[targetLocale] : "";
        localized.description[targetLocale] = oversatt || beholdt || "";
        if (!oversatt && !beholdt) feilet = true;
      }
      if (feilet) localized.failedLocales.push(targetLocale);
    } catch {
      // ⚠️ NETTVERKSFEILEN VAR DEN VERSTE VARIANTEN: den fylte tre språk med kildeteksten mens
      // forfatteren så en feilmelding om noe helt annet. Nå slippes lokalen, og kalleren sier fra.
      const beholdtTittel = preserveExisting ? localized.title[targetLocale] : "";
      const beholdtBeskrivelse = preserveExisting ? localized.description[targetLocale] : "";
      if (hasSourceTitle) localized.title[targetLocale] = beholdtTittel || "";
      if (hasSourceDescription) localized.description[targetLocale] = beholdtBeskrivelse || "";
      if ((hasSourceTitle && !beholdtTittel) || (hasSourceDescription && !beholdtBeskrivelse)) {
        localized.failedLocales.push(targetLocale);
      }
    }
  }

  return localized;
}

/**
 * #1037: si fra når en oversettelse ikke kom.
 *
 * ⚠️ STILLHET VAR HALVE #892. Å slutte å fylle kildetekst inn i mållokalet er bare halve rettingen:
 * hvis ingenting sier fra, tror forfatteren fortsatt at kurset er ferdig oversatt — forskjellen er
 * bare at nå er feltet tomt i stedet for feilmerket. Begge kallerne må derfor vise dette.
 *
 * Meldingen er en advarsel, ikke en feil: lagringen GIKK gjennom, og kildespråket er lagret riktig.
 */
function meldFeiledeLokaler(failedLocales) {
  if (!failedLocales?.length) return;
  showToast(
    `Lagret, men oversettelsen kom ikke for: ${failedLocales.join(", ")}. ` +
      t("courses.notTranslatedHint"),
    "error",
  );
}

const CERT_LABELS = { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced" };
// ---------------------------------------------------------------------------
// Route detection
// ---------------------------------------------------------------------------

function certLabel(level) {
  if (!level) return "";
  const key =
    level === "basic"
      ? "adminContent.promptDialog.certificationLevelBasic"
      : level === "intermediate"
        ? "adminContent.promptDialog.certificationLevelIntermediate"
        : level === "advanced"
          ? "adminContent.promptDialog.certificationLevelAdvanced"
          : null;
  return key ? t(key) : localizedText(level) || level;
}
function detectRoute() {
  return detectCoursesRoute(window.location.pathname);
}

function certBadge(level) {
  if (!level) return `<span class="cert-badge">-</span>`;
  return `<span class="cert-badge">${escapeHtml(certLabel(level))}</span>`;
}

function canPublishCourse(course) {
  const moduleCount = Number(course?.moduleCount ?? course?.modules?.length ?? 0);
  return !course?.publishedAt && !course?.archivedAt && moduleCount > 0;
}

// #734: publishing a course must never leave it containing unavailable (draft/archived) modules or
// sections (invariant I1). Before publishing we ask the API which items are unpublished and whether
// each is publishable. If everything is already live we publish directly (unchanged behaviour). If
// there are unpublished items we open the cascade-publish dialog: it offers to publish them together
// with the course, or — when some item cannot be published — explains what must be fixed first and
// blocks publishing (no "course only" escape hatch, which would violate I1).
async function publishCourseInAdmin(courseId, triggerButton = null) {
  if (!courseId) return;
  if (triggerButton) triggerButton.disabled = true;

  let preview;
  try {
    preview = await apiFetch(
      `/api/admin/content/courses/${encodeURIComponent(courseId)}/publish-preview`,
      getHeaders,
    );
  } catch (err) {
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
    return;
  }

  // Everything already published — keep the direct-publish behaviour (no dialog).
  if (preview?.allPublished) {
    await commitCoursePublish(courseId, false, triggerButton);
    return;
  }

  openCascadePublishDialog(courseId, preview, triggerButton);
}

// POST the publish. `publishItems` cascades the unpublished modules/sections; false is the plain
// publish (used when everything is already live).
async function commitCoursePublish(courseId, publishItems, triggerButton = null) {
  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/publish`, getHeaders, {
      method: "POST",
      body: JSON.stringify({ publishItems }),
    });
    showToast(t("adminContent.courses.message.published") || t("courses.published"), "success");

    const route = detectRoute();
    if (route.view === "list") {
      await renderListView();
    } else {
      await renderDetailView(courseId);
    }
  } catch (err) {
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Cascade-publish dialog (#734)
// ---------------------------------------------------------------------------

let pendingCascadePublish = null; // { courseId, triggerButton }

function cascadeItemTypeLabel(type) {
  return type === "SECTION"
    ? (t("adminContent.courses.cascadePublish.sectionLabel") || t("ui.kind.section"))
    : (t("adminContent.courses.cascadePublish.moduleLabel") || t("ui.kind.module"));
}

// #896 S4: translation blockers arrive with `field` + `missingLocales` so they can be rendered in
// the viewer's language.
//
// #980: gaten var kodet RIKTIG for `translation_incomplete` og FEIL for de seks andre kodene på
// samme flate — de falt tilbake på `blocker.message`, som coursePublishService skriver i hardkodet
// bokmål («Modulen er arkivert. Gjenopprett den før du publiserer.»). En innholdsansvarlig med
// konsollet på en-GB (default) fikk altså en engelsk dialog med én norsk linje i; en nn-bruker fikk
// bokmål. Nå slås hver kode opp i den delte tabellen, som denne siden allerede bruker for toaster.
//
// ⚠️ `item_archived` sendes for BÅDE moduler og seksjoner med hver sin norske setning. Koden alene
// kan ikke skille dem — men klienten vet hvilken rad den tegner, så typen sendes inn som variant.
//
// ⚠️ Det som fortsatt ikke er oversatt: blokkeringene fra contentValidationService
// (MCQ_COUNT_FAR_BELOW_BLUEPRINT m.fl.). De bar ingen `params`, så tallene og tersklene fantes
// bare inne i den engelske setningen, og å erstatte den med en kodenavn-setning ville fjernet
// informasjonen forfatteren trenger.
//
// #914 er nå gjort: hver kode bærer `params`, og `describeGateIssue` bygger setningen på leserens
// språk. Reservekjeden under står igjen for koder som ennå ikke har en nøkkel — den er sømmen som
// gjør et hull synlig i stedet for stille.
function blockerText(blocker, itemType) {
  if (blocker?.code !== "translation_incomplete" || !blocker.field || !Array.isArray(blocker.missingLocales)) {
    // #914: `params` sendes naa med, saa setninger med tall (MCQ_COUNT_*, DISTRACTOR_*) kan
    // lokaliseres. Varianten fra raden beholdes for `item_archived`, som #980 innfoerte.
    const variant = typeof itemType === "string" ? itemType.toLowerCase() : null;
    const known = apiErrorCodeText(blocker?.code ?? null, t, variant ? [variant] : [], blocker?.params ?? null);
    if (known) return known;
    const reason = typeof blocker?.message === "string" ? blocker.message : "";
    if (!reason) return "";
    return tf("adminContent.courses.cascadePublish.blockerUnknown", { reason });
  }
  const mcq = /^mcq\.question(\d+)$/.exec(String(blocker.field));
  const label = mcq
    ? (t("adminContent.courses.cascadePublish.field.mcqQuestion") || "MCQ question {n}").replace("{n}", mcq[1])
    : (t(`adminContent.courses.cascadePublish.field.${blocker.field}`) || blocker.field);
  const template = t("adminContent.courses.cascadePublish.translationBlocker")
    || t("courses.moduleMissingTranslation");
  return template.replace("{field}", label).replace("{locales}", blocker.missingLocales.join(", "));
}

function renderCascadeItemList(items, { showBlockers }) {
  return `<ul class="cascade-publish-list">${(items ?? [])
    .map((item) => {
      const title = escapeHtml(localizedText(item.title) || item.id);
      const badge = `<span class="item-type-badge">${escapeHtml(cascadeItemTypeLabel(item.type))}</span>`;
      const blocked = showBlockers && !item.publishable && Array.isArray(item.blockers) && item.blockers.length > 0;
      const blockerNote = blocked
        ? `<span class="cascade-publish-blocker">${escapeHtml(item.blockers.map((b) => blockerText(b, item.type)).join(" "))}</span>`
        : "";
      // #896 S4: a blocked module needs a way OUT of the dialog, not just an explanation of why
      // it is stuck. Every blocker here — untranslated, archived, no content — is fixed in the
      // module's own workspace, so link straight there. The dialog otherwise offers only "Lukk",
      // leaving the author to find the module by hand.
      const fixLink = blocked && item.type === "MODULE"
        ? ` <a class="cascade-publish-fix" href="/admin-content/module/${encodeURIComponent(item.id)}/conversation">${escapeHtml(t("adminContent.courses.cascadePublish.openModule") || t("courses.openModule"))}</a>`
        : "";
      return `<li class="cascade-publish-item${item.publishable ? "" : " is-blocked"}">${badge} <span class="cascade-publish-item-title">${title}</span>${blockerNote}${fixLink}</li>`;
    })
    .join("")}</ul>`;
}

// Data-driven so wording/options can be adjusted (or a future option added) without restructuring.
// Two modes: `confirm` (all items publishable → offer cascade) and `blocked` (some item cannot be
// published → explain + block, only a close action).
function openCascadePublishDialog(courseId, preview, triggerButton) {
  if (!cascadePublishDialog) {
    // Defensive fallback: without the dialog, do not silently publish broken content.
    showToast(t("courses.publish.unpublishedFirst"), "error");
    if (triggerButton) triggerButton.disabled = false;
    return;
  }

  pendingCascadePublish = { courseId, triggerButton };
  const blocked = !preview?.publishable;
  const items = preview?.unpublishedItems ?? [];

  const titleEl = document.getElementById("cascadePublishTitle");
  const textEl = document.getElementById("cascadePublishText");
  const listEl = document.getElementById("cascadePublishList");
  const confirmBtn = document.getElementById("cascadePublishConfirmBtn");
  const cancelBtn = document.getElementById("cascadePublishCancelBtn");

  if (titleEl) {
    titleEl.textContent = blocked
      ? (t("adminContent.courses.cascadePublish.blockedTitle") || t("courses.publish.blockedTitle"))
      : (t("adminContent.courses.cascadePublish.confirmTitle") || t("courses.publish.cascadeTitle"));
  }
  if (textEl) {
    textEl.textContent = blocked
      ? (t("adminContent.courses.cascadePublish.blockedText") ||
          t("courses.publish.blockedBody"))
      : (t("adminContent.courses.cascadePublish.confirmText") ||
          t("courses.publish.cascadeBody"));
  }
  if (listEl) listEl.innerHTML = renderCascadeItemList(items, { showBlockers: blocked });

  if (confirmBtn) {
    confirmBtn.textContent = t("adminContent.courses.cascadePublish.confirmBtn") || t("courses.publish.cascadeConfirm");
    // No cascade primary action when something is un-publishable — only a close action (I1).
    setHidden(confirmBtn, blocked);
  }
  if (cancelBtn) {
    cancelBtn.textContent = blocked
      ? (t("adminContent.courses.cascadePublish.closeBtn") || t("ui.action.close"))
      : (t("adminContent.courses.cascadePublish.cancelBtn") || t("ui.action.cancel"));
  }

  cascadePublishDialog.showModal();
}

function initCascadePublishDialog() {
  const confirmBtn = document.getElementById("cascadePublishConfirmBtn");
  const cancelBtn = document.getElementById("cascadePublishCancelBtn");
  confirmBtn?.addEventListener("click", async () => {
    if (!pendingCascadePublish) return;
    const { courseId, triggerButton } = pendingCascadePublish;
    pendingCascadePublish = null;
    confirmBtn.disabled = true;
    cascadePublishDialog.close();
    await commitCoursePublish(courseId, true, triggerButton);
    confirmBtn.disabled = false;
  });
  cancelBtn?.addEventListener("click", () => {
    cascadePublishDialog?.close();
    if (pendingCascadePublish?.triggerButton) pendingCascadePublish.triggerButton.disabled = false;
    pendingCascadePublish = null;
  });
}

// ---------------------------------------------------------------------------
// 2.101.0: publiser alle nye versjoner i kurset
// ---------------------------------------------------------------------------
//
// Produkteier, 2026-10-25: etter «Oppdater dette kurset» ligger hver ny versjon klar, og forfatteren
// måtte inn i hver modul for å publisere den — og svare på «Er dette en revisjon?» hver gang. Her er
// det ett spørsmål for alle, og ett revisjonssvar for alle modulene. Publiseringen er fortsatt en
// bevisst handling (#1095): dialogen åpnes etter importen, men ingenting skjer uten et klikk.
//
// Serveren eier reglene (alt eller ingenting, bare egne elementer, svaret kreves når noen har
// bestått, og den publiserer bare versjonene dialogen viste). Klienten viser dem.

let pendingVersions = null; // siste svar fra /pending-versions for kurset som er åpent

async function loadPendingVersions(courseId) {
  try {
    return await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/pending-versions`, getHeaders);
  } catch {
    // Knappen er en snarvei; uten svar vises den ikke, og hver modul kan publiseres for seg som før.
    return null;
  }
}

function pendingPublishButtons() {
  return {
    confirm: document.getElementById("pendingPublishConfirmBtn"),
    keep: document.getElementById("pendingPublishKeepBtn"),
    supersede: document.getElementById("pendingPublishSupersedeBtn"),
    cancel: document.getElementById("pendingPublishCancelBtn"),
  };
}

let pendingPublishTarget = null; // { courseId, versionIds }

async function openPendingPublishDialog(courseId) {
  const dialog = document.getElementById("pendingPublishDialog");
  if (!dialog || typeof dialog.showModal !== "function") return;
  // Alltid ferskt: det forfatteren svarer på, skal være det som står i kurset nå.
  const pending = await loadPendingVersions(courseId);
  if (!pending) return;
  pendingVersions = pending;
  const items = pending.items ?? [];
  const notOwned = pending.notOwnedItems ?? [];
  if (items.length === 0) return;

  const blocked = !pending.publishable;
  const asksRevision = !blocked && Number(pending.passedTotal) > 0;
  pendingPublishTarget = { courseId, versionIds: items.map((item) => item.versionId) };

  document.getElementById("pendingPublishTitle").textContent = blocked
    ? t("adminContent.courses.pendingPublish.blockedTitle")
    : t("adminContent.courses.pendingPublish.title");
  document.getElementById("pendingPublishText").textContent = blocked
    ? t("adminContent.courses.pendingPublish.blockedText")
    : tf("adminContent.courses.pendingPublish.text", { count: items.length });
  document.getElementById("pendingPublishList").innerHTML = renderCascadeItemList(
    items.map((item) => ({
      ...item,
      // Et element som aldri er publisert, merkes «ny» — resten er en nyere versjon av noe levende.
      title: item.isNew ? `${localizedText(item.title) || item.id} (${t("adminContent.courses.pendingPublish.newLabel")})` : item.title,
    })),
    { showBlockers: blocked },
  );
  const notOwnedEl = document.getElementById("pendingPublishNotOwned");
  notOwnedEl.textContent = notOwned.length > 0 ? tf("adminContent.courses.pendingPublish.notOwned", { count: notOwned.length }) : "";
  setHidden(notOwnedEl, notOwned.length === 0);

  setHidden(document.getElementById("pendingPublishRevision"), !asksRevision);
  if (asksRevision) {
    document.getElementById("pendingPublishRevisionHeading").textContent = t("adminContent.courses.pendingPublish.revisionHeading");
    document.getElementById("pendingPublishRevisionBody").textContent = tf("adminContent.courses.pendingPublish.revisionBody", {
      people: pending.passedTotal,
      modules: pending.modulesWithPasses,
    });
  }

  const buttons = pendingPublishButtons();
  buttons.confirm.textContent = t("adminContent.courses.pendingPublish.confirm");
  buttons.keep.textContent = t("adminContent.courses.pendingPublish.keep");
  buttons.supersede.textContent = tf("adminContent.courses.pendingPublish.supersede", { people: pending.passedTotal });
  buttons.cancel.textContent = blocked ? t("adminContent.courses.pendingPublish.close") : t("adminContent.courses.pendingPublish.later");
  // Har noen bestått, finnes det ingen nøytral «Publiser alle»: svaret er et valg, ikke en standard (#997).
  setHidden(buttons.confirm, blocked || asksRevision);
  setHidden(buttons.keep, !asksRevision);
  setHidden(buttons.supersede, !asksRevision);
  for (const button of [buttons.confirm, buttons.keep, buttons.supersede]) button.disabled = false;

  if (!dialog.open) dialog.showModal();
}

async function commitPendingPublish(supersedesEarlierPasses) {
  const target = pendingPublishTarget;
  if (!target) return;
  const dialog = document.getElementById("pendingPublishDialog");
  const buttons = pendingPublishButtons();
  for (const button of [buttons.confirm, buttons.keep, buttons.supersede]) button.disabled = true;
  try {
    const result = await runWithWorkDialog(t("adminContent.work.publishing"), () => apiFetch(`/api/admin/content/courses/${encodeURIComponent(target.courseId)}/publish-pending`, getHeaders, {
      method: "POST",
      body: JSON.stringify({
        versionIds: target.versionIds,
        ...(supersedesEarlierPasses === undefined ? {} : { supersedesEarlierPasses }),
      }),
    }));
    pendingPublishTarget = null;
    dialog?.close();
    showToast(tf("adminContent.courses.pendingPublish.published", { count: result?.publishedItems?.length ?? 0 }), "success");
    await refreshCourseView(target.courseId);
  } catch (err) {
    if (err?.status === 409 || err?.status === 422) {
      // Noe er endret, eller noe stopper: vis lista slik den er nå, i stedet for en feil uten neste steg.
      showToast(t("adminContent.courses.pendingPublish.changed"), "warning");
      await openPendingPublishDialog(target.courseId);
      return;
    }
    apiErrorToast(err);
    for (const button of [buttons.confirm, buttons.keep, buttons.supersede]) button.disabled = false;
  }
}

function initPendingPublishDialog() {
  const buttons = pendingPublishButtons();
  buttons.confirm?.addEventListener("click", () => commitPendingPublish(undefined));
  buttons.keep?.addEventListener("click", () => commitPendingPublish(false));
  buttons.supersede?.addEventListener("click", () => commitPendingPublish(true));
  buttons.cancel?.addEventListener("click", () => {
    pendingPublishTarget = null;
    document.getElementById("pendingPublishDialog")?.close();
  });
}

// ---------------------------------------------------------------------------
// ── LIST VIEW ─────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

// #1046: lista er den felles listesida (list-page.js). Her ligger bare oppskriften for kurs.
let listPage = null;

function courseRowModel(course) {
  return deriveCourseListRows([course], { localizeTitle: localizedText, formatDate })[0];
}

function getListPage() {
  if (listPage) return listPage;
  listPage = createListPage({
    host: pageContent,
    ids: { tbody: "coursesTableBody", search: "coursesSearch" },
    texts: {
      title: t("courses.title"), lead: t("courses.lead"),
      searchPlaceholder: t("courses.searchPlaceholder"), searchLabel: t("courses.searchLabel"), filterGroupLabel: t("courses.filterGroupLabel"),
      empty: t("courses.empty"), emptyFiltered: t("courses.emptyFiltered"), loadError: t("courses.loadError"), more: t("form.more"),
    },
    headerActions: [
      { id: "importCoursePackageBtn", label: t("courses.importCourse") },
      { id: "newCourseBtn", label: t("courses.newCourse"), kind: "primary", href: "/admin-content/courses/new" },
    ],
    headerExtraHtml: `<input id="importCoursePackageFile" type="file" accept="application/json,.json" hidden />`,
    // #705-UX(A): filter-piller (Alle/Aktive/Publiserte/Arkiverte) likt modul-biblioteket.
    filters: { options: [["all", t("ui.filter.all")], ["active", t("ui.filter.active")], ["published", t("ui.filter.published")], ["archived", t("ui.filter.archived")]], initial: "active" },
    // #1046 B1: søk på navn (alle språk) og ID, som på Moduler.
    search: { matches: (c, q) => {
      const titles = c.title && typeof c.title === "object" ? Object.values(c.title) : [c.title, localizedText(c.title)];
      return titles.some((v) => String(v ?? "").toLowerCase().includes(q)) || String(c.id ?? "").toLowerCase().includes(q);
    } },
    sort: { key: "title", dir: "asc", locale: () => currentLocale },
    columns: [
      // #1094: plasseringen i «Mine kurs» som merke ved navnet — forfatteren slipper å åpne hvert kurs
      // for å se den. Et merke, ikke en kolonne: lista skal ikke bli bredere enn ramma (#1084).
      { key: "title", label: t("ui.name"), className: "col-title", sortValue: (c) => courseRowModel(c).title, render: (c) => escapeHtml(courseRowModel(c).title)
        + (Number.isInteger(c.sortOrder) ? ` <span class="status-chip course-placement-chip" title="${escapeHtml(t("courses.sortOrder"))}">${escapeHtml(tf("courses.list.placement", { n: c.sortOrder }))}</span>` : "") },
      { key: "status", label: t("ui.status"), className: "col-status", render: (c) => lifecycleBadge(c, t) },
      { key: "level", label: t("ui.certLevel"), className: "col-level", render: (c) => certBadge(c.certificationLevel) },
      { key: "moduleCount", label: t("courses.col.moduleCount"), className: "col-module-count", sortValue: (c) => c.moduleCount ?? 0, render: (c) => String(c.moduleCount ?? 0) },
      { key: "inProgress", label: t("courses.col.inProgress"), className: "col-inprogress", title: t("courses.col.inProgressHint"), sortValue: (c) => c.inProgressCount ?? 0, render: (c) => (c.inProgressCount > 0 ? String(c.inProgressCount) : "–") },
      { key: "updatedAt", label: t("ui.lastChanged"), className: "col-updated", sortValue: (c) => c.updatedAt ?? "", render: (c) => escapeHtml(courseRowModel(c).updatedLabel) },
    ],
    rowId: (c) => c.id,
    actions: (c) => {
      const course = courseRowModel(c);
      const lifecycle = lifecycleOf(c);
      const cid = escapeHtml(course.courseId);
      const ctitle = escapeHtml(course.title);
      // #787 slice 5: eier/admin styrer om rediger/livssyklus-handlingene vises (speiler eierskaps-vakta).
      const canManage = course.canManage !== false;
      // ⚠️ #1029: merket sier «Kun for eier», ikke «Skrivebeskyttet» — etter #943 er også LESING
      // eierskapsvaktet, og et merke som lover mer enn flaten gir er verre enn ikke noe merke.
      if (!canManage) return [`<span class="row-readonly-note" title="${escapeHtml(t("adminContent.courses.row.noAccessTitle"))}">${escapeHtml(t("adminContent.courses.row.noAccess"))}</span>`];
      // #705: samme handlings-rekkefølge som modul/seksjon — Publiser⇄Avpubliser, Arkiver⇄Gjenopprett.
      // Publiser vises bare for et utkast som har innhold (samme krav som canPublishCourse i detaljvisningen).
      const publishToggle = lifecycle === "archived" ? ""
        : lifecycle === "published"
          ? `<button class="row-action-btn" data-action="unpublish" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.unpublish"))}</button>`
          : (course.moduleCount > 0 ? `<button class="row-action-btn" data-action="publish" data-course-id="${cid}">${escapeHtml(t("ui.action.publish"))}</button>` : "");
      // #705-UX: Slett vises kun for arkiverte elementer (terminal steg etter arkivering).
      const archiveToggle = lifecycle === "archived"
        ? `<button class="row-action-btn" data-action="restore" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.restore"))}</button>`
        : `<button class="row-action-btn" data-action="archive" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.archive"))}</button>`;
      const deleteBtn = lifecycle === "archived"
        ? `<button class="row-action-btn destructive" data-action="delete" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.delete"))}</button>`
        : "";
      // #762: ADMINISTRATOR-only destructive cleanup — slett kurset + moduler/seksjoner som kun brukes
      // her. Delt innhold beholdes. Skjult for ikke-ADMINISTRATOR (rollen løses fra /api/me).
      const cascadeDeleteBtn = isAdministrator()
        ? `<button class="row-action-btn destructive" data-action="cascade-delete" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("courses.deleteWithContent"))}</button>`
        : "";
      return [
        `<a href="/admin-content/courses/${encodeURIComponent(course.courseId)}" class="row-action-btn">${escapeHtml(t("ui.action.open"))}</a>`,
        `<button class="row-action-btn" data-action="export" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.export"))}</button>`,
        publishToggle,
        archiveToggle,
        deleteBtn,
        cascadeDeleteBtn,
      ];
    },
    emptyHtml: () => `
      <div class="empty-state">
        <p class="empty-state-title">${escapeHtml(t("courses.emptyTitle"))}</p>
        <p class="empty-state-text">${escapeHtml(t("courses.emptyHint"))}</p>
        <a href="/admin-content/courses/new" class="btn btn-primary">${escapeHtml(t("courses.create"))}</a>
      </div>`,
    load: async () => (await apiFetch("/api/admin/content/courses", getHeaders)).courses ?? [],
    describeError: (err) => apiErrorText(err),
    onAction: (_action, _id, btn, _item, event) => handleListTableClick(event, btn),
    afterRender: () => {
      document.getElementById("importCoursePackageFile")?.addEventListener("change", handleImportCoursePackageFile);
      document.getElementById("importCoursePackageBtn")?.addEventListener("click", () => {
        document.getElementById("importCoursePackageFile")?.click();
      });
    },
  });
  return listPage;
}

async function renderListView() {
  pageContent.innerHTML = `<div class="page-loading">${escapeHtml(t("courses.loadingCourses"))}</div>`;
  await getListPage().reload().catch(() => undefined);
}

// #433 phase 4b — course export download. Calls /export-package and saves the
// versioned envelope as a JSON file the destination environment can import.
async function exportCoursePackage(courseId, courseTitle) {
  try {
    const body = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/export-package`, getHeaders);
    const envelope = body?.envelope ?? null;
    if (!envelope) throw new Error(t("courses.exportEmpty"));
    const safeTitle = String(courseTitle ?? "course").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "course";
    const filename = `course-${safeTitle}-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Kurs «${courseTitle}» er eksportert.`);
  } catch (error) {
    const described = describeApiError(error, t);
    showToast(tf("adminContent.courses.exportFailed", { reason: described.headline }), "error", described.detail);
  }
}

// #433 phase 4b — course import from file. POSTs envelope to /courses/import
// with mode=createNew, re-renders the list, and navigates to the new course.
async function handleImportCoursePackageFile(event) {
  const target = event.target;
  const file = target?.files?.[0] ?? null;
  if (!file) return;
  try {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      throw new Error(`Filen er ikke gyldig JSON: ${parseError instanceof Error ? parseError.message : "ukjent feil"}`);
    }
    // #1095: fila kan bære kursets id fra en eksport i dette miljøet. Finnes kurset her, velger
    // forfatteren: oppdatere det (nye versjoner legges klar, ingenting publiseres) eller importere
    // som nytt kurs. En fil fra et annet miljø peker på et kurs som ikke finnes, og går som før.
    const originCourseId = payload?.course?.course?.origin?.courseId;
    const existing = originCourseId ? await findImportTargetCourse(originCourseId) : null;
    const choice = existing ? await askImportChoice(existing) : "createNew";
    if (choice === "cancel") return;
    if (choice === "updateExisting") {
      // 2.101.2: en kursimport kan ta minutter — vis at det jobbes, og sperr siden imens.
      const updated = await runWithWorkDialog(t("adminContent.work.importCourse"), () => apiFetch("/api/admin/content/courses/import", getHeaders, {
        method: "POST",
        body: JSON.stringify({ payload, mode: "updateExisting", targetId: originCourseId }),
      }), { detail: t("adminContent.work.detail") });
      if (!updated?.courseId) throw new Error(t("courses.importNoId"));
      const s = updated.summary ?? {};
      // Oppsummeringen skal leses på kurssiden, ikke forsvinne med denne siden.
      const unplaced = Array.isArray(s.unplacedModuleIds) ? s.unplacedModuleIds.length : 0;
      const replaced = Array.isArray(s.replacedUnownedIds) ? s.replacedUnownedIds.length : 0;
      const notPublishable = Array.isArray(s.keptUnownedIds) ? s.keptUnownedIds.filter((k) => k?.reason === "not_publishable").length : 0;
      const details = [
        unplaced > 0 ? tf("adminContent.courses.updatedUnplaced", { count: unplaced }) : "",
        replaced > 0 ? tf("adminContent.courses.updatedReplacedUnowned", { count: replaced }) : "",
        notPublishable > 0 ? tf("adminContent.courses.updatedKeptNotPublishable", { count: notPublishable }) : "",
      ].filter(Boolean);
      queueToast(
        tf("adminContent.courses.updated", {
          updated: (s.updatedSections ?? 0) + (s.updatedModules ?? 0),
          created: (s.createdSections ?? 0) + (s.createdModules ?? 0),
          removed: (s.removedSections ?? 0) + (s.removedModules ?? 0),
        }),
        details.length > 0 ? "warning" : "success",
        details.join(" "),
      );
      // 2.101.0: kurssiden spør straks om de nye versjonene skal publiseres (samlet).
      window.location.href = `/admin-content/courses/${encodeURIComponent(updated.courseId)}?publishPending=1`;
      return;
    }
    const result = await runWithWorkDialog(t("adminContent.work.importCourse"), () => apiFetch("/api/admin/content/courses/import", getHeaders, {
      method: "POST",
      body: JSON.stringify({ payload, mode: "createNew" }),
    }), { detail: t("adminContent.work.detail") });
    if (!result?.courseId) throw new Error(t("courses.importNoId"));
    // ⚠️ #957/#996: responsen BÆRER forklaringen; her ble den kastet.
    //
    // Forfatteren fikk «Kurs importert» og ble sendt til et kurs som lå som utkast, uten et ord om
    // hvorfor. Serveren regnet ut `heldBackByTranslationGate`, brukte det til å holde kurset
    // tilbake, og rapporterte det — og så leste ingen det. Et flagg ingen leser er samme klasse som
    // en vakt som ikke kjører.
    //
    // Teksten sier også hva forfatteren skal GJØRE. «Lagret som utkast» uten neste steg er en
    // beskjed om systemets tilstand, ikke hjelp.
    const count = result.moduleIds?.length ?? 0;
    // #1095: samme for disse — de ble vist og navigert bort fra i samme øyeblikk.
    if (result.heldBackByTranslationGate) {
      queueToast(tf("adminContent.courses.importedHeldBack", { count }), "warning");
    } else {
      queueToast(tf("adminContent.courses.imported", { count }), "success");
    }
    window.location.href = `/admin-content/courses/${encodeURIComponent(result.courseId)}`;
  } catch (error) {
    const d = describeImportError(error, {
      notAnEnvelope: t("adminContent.courses.importNotAnEnvelope"),
    }, t);
    showToast(tf("adminContent.courses.importFailed", { reason: d.headline }), "error", d.detail);
  } finally {
    target.value = "";
  }
}

// #1095: finnes kurset fila peker på, i dette miljøet — og får forfatteren se det? 404 og 403 er
// begge «nei»: da importeres fila som nytt kurs, slik den alltid ble. Alt annet (500, nettverk)
// er IKKE «nei»: da vet vi ikke, og å importere som nytt kurs ville lage et duplikat av et kurs
// som finnes. Feilen går videre og importen stopper med melding.
async function findImportTargetCourse(courseId) {
  try {
    const body = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}`, getHeaders);
    return body?.course ?? null;
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) return null;
    throw error;
  }
}

/** Spør forfatteren: oppdater kurset fila hører til, importer som nytt, eller avbryt. */
function askImportChoice(course) {
  const dialog = document.getElementById("courseImportChoiceDialog");
  if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve("createNew");
  const textEl = document.getElementById("courseImportChoiceText");
  if (textEl) textEl.textContent = tf("adminContent.courses.importChoice.text", { title: localizedText(course.title) || course.id });
  return new Promise((resolve) => {
    const done = (value) => {
      dialog.removeEventListener("close", onClose);
      updateBtn?.removeEventListener("click", onUpdate);
      createBtn?.removeEventListener("click", onCreate);
      cancelBtn?.removeEventListener("click", onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const updateBtn = document.getElementById("courseImportUpdateBtn");
    const createBtn = document.getElementById("courseImportCreateBtn");
    const cancelBtn = document.getElementById("courseImportCancelBtn");
    const onUpdate = () => done("updateExisting");
    const onCreate = () => done("createNew");
    const onCancel = () => done("cancel");
    const onClose = () => done("cancel");
    updateBtn?.addEventListener("click", onUpdate);
    createBtn?.addEventListener("click", onCreate);
    cancelBtn?.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

function handleListTableClick(event, btn = event.target.closest("[data-action]")) {
  if (!btn) return;
  if (btn.dataset.action === "publish") {
    publishCourseInAdmin(btn.dataset.courseId, btn);
    return;
  }
  if (btn.dataset.action === "export") {
    exportCoursePackage(btn.dataset.courseId, btn.dataset.courseTitle);
    return;
  }
  if (btn.dataset.action === "publish-pending") {
    openPendingPublishDialog(btn.dataset.courseId);
    return;
  }
  if (btn.dataset.action === "unpublish") {
    unpublishCourseInAdmin(btn.dataset.courseId, btn.dataset.courseTitle, btn);
    return;
  }
  if (btn.dataset.action === "archive") {
    archiveCourseInAdmin(btn.dataset.courseId, btn.dataset.courseTitle, btn);
    return;
  }
  if (btn.dataset.action === "restore") {
    restoreCourseInAdmin(btn.dataset.courseId, btn.dataset.courseTitle, btn);
    return;
  }
  if (btn.dataset.action === "delete") {
    openDeleteDialog(btn.dataset.courseId, btn.dataset.courseTitle);
    return;
  }
  if (btn.dataset.action === "cascade-delete") {
    openCascadeDeleteDialog(btn.dataset.courseId, btn.dataset.courseTitle);
  }
}

// Archive (soft-delete) a course. Archiving is the alternative to deleting when a course has
// completions/certificates that must be preserved (#660). Reversible, so a lightweight confirm.
async function archiveCourseInAdmin(courseId, courseTitle, triggerButton = null) {
  if (!window.confirm(`Arkivere kurset «${courseTitle}»? Det skjules for deltakere, men beholdes med fullføringer.`)) {
    return;
  }
  if (triggerButton) triggerButton.disabled = true;
  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/archive`, getHeaders, { method: "POST" });
    showToast(t("courses.archived"), "success");
    await refreshCourseView(courseId);
  } catch (err) {
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
  }
}

// #705: avpubliser et kurs (motstykke til Publiser). G3-vakta (påbegynt deltaker) i backend gir
// en forklarende feilmelding hvis det ikke er lov.
async function unpublishCourseInAdmin(courseId, courseTitle, triggerButton = null) {
  if (!window.confirm(`Avpublisere kurset «${courseTitle}»? Det blir skjult for deltakere til du publiserer igjen.`)) {
    return;
  }
  if (triggerButton) triggerButton.disabled = true;
  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/unpublish`, getHeaders, { method: "POST" });
    showToast(t("courses.unpublished"), "success");
    await refreshCourseView(courseId);
  } catch (err) {
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
  }
}

// #673: gjenopprett et arkivert kurs (nullstill arkivering).
async function restoreCourseInAdmin(courseId, courseTitle, triggerButton = null) {
  if (triggerButton) triggerButton.disabled = true;
  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/restore`, getHeaders, { method: "POST" });
    showToast(`Kurset «${courseTitle}» ble gjenopprettet.`, "success");
    await refreshCourseView(courseId);
  } catch (err) {
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

let pendingDeleteId = null;

function openDeleteDialog(courseId, courseTitle) {
  pendingDeleteId = courseId;
  deleteDialogText.textContent = buildCourseDeleteDialogText(courseTitle);
  deleteDialog.showModal();
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  deleteConfirmBtn.disabled = true;
  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(pendingDeleteId)}`, getHeaders, { method: "DELETE" });
    deleteDialog.close();
    showToast(t("courses.deleted"), "success");
    await renderListView();
  } catch (err) {
    apiErrorToast(err);
    deleteConfirmBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Cascade-delete dialog (#762, ADMINISTRATOR-only)
// ---------------------------------------------------------------------------
// Destructive cleanup for test content: delete a course together with the modules/sections it
// EXCLUSIVELY owns. Shared items are spared (only unlinked). The confirm button is only shown when
// the preview reports no blockers (course completions, or an exclusive module with
// submissions/certifications).

let pendingCascadeDelete = null; // { courseId }

function cascadeDeleteEntryList(entries) {
  return `<ul class="cascade-publish-list">${(entries ?? [])
    .map((entry) => {
      const title = escapeHtml(localizedText(entry.title) || entry.id);
      const reason = entry.reason ? `<span class="cascade-publish-blocker">${escapeHtml(entry.reason)}</span>` : "";
      return `<li class="cascade-publish-item"><span class="cascade-publish-item-title">${title}</span>${reason}</li>`;
    })
    .join("")}</ul>`;
}

function renderCascadeDeletePreview(preview) {
  const bodyEl = document.getElementById("cascadeDeleteBody");
  const textEl = document.getElementById("cascadeDeleteText");
  const confirmBtn = document.getElementById("cascadeDeleteConfirmBtn");
  const blockers = preview?.blockers ?? [];
  const delModules = preview?.deletableModules ?? [];
  const delSections = preview?.deletableSections ?? [];
  const sparedModules = preview?.sparedModules ?? [];
  const sparedSections = preview?.sparedSections ?? [];
  const blocked = blockers.length > 0;

  if (textEl) {
    textEl.textContent = blocked
      ? t("courses.delete.blocked")
      : `Dette sletter kurset, ${delModules.length} modul(er) og ${delSections.length} seksjon(er) som kun brukes i dette kurset. Delt innhold beholdes.`;
  }

  let html = "";
  if (blocked) {
    html += `<h3 class="cascade-delete-heading">${escapeHtml(t("courses.delete.blockers"))}</h3>${cascadeDeleteEntryList(blockers)}`;
  }
  if (delModules.length > 0 || delSections.length > 0) {
    html += `<h3 class="cascade-delete-heading">${escapeHtml(t("courses.delete.willDelete"))}</h3>${cascadeDeleteEntryList([...delModules, ...delSections])}`;
  }
  if (sparedModules.length > 0 || sparedSections.length > 0) {
    html += `<h3 class="cascade-delete-heading">${escapeHtml(t("courses.delete.willKeep"))}</h3>${cascadeDeleteEntryList([...sparedModules, ...sparedSections])}`;
  }
  if (!html) {
    html = `<p class="dialog-text">${escapeHtml(t("courses.delete.onlyCourse"))}</p>`;
  }
  if (bodyEl) bodyEl.innerHTML = html;
  if (confirmBtn) {
    // Confirm only when there are no blockers.
    setHidden(confirmBtn, blocked);
    confirmBtn.disabled = blocked;
  }
}

async function openCascadeDeleteDialog(courseId, courseTitle) {
  if (!cascadeDeleteDialog) {
    showToast(t("courses.delete.openError"), "error");
    return;
  }
  pendingCascadeDelete = { courseId };
  const titleEl = document.getElementById("cascadeDeleteTitle");
  const textEl = document.getElementById("cascadeDeleteText");
  const bodyEl = document.getElementById("cascadeDeleteBody");
  const confirmBtn = document.getElementById("cascadeDeleteConfirmBtn");
  if (titleEl) titleEl.textContent = `Slett «${courseTitle}» og ubrukt innhold`;
  if (textEl) textEl.textContent = t("courses.delete.loading");
  if (bodyEl) bodyEl.innerHTML = "";
  if (confirmBtn) {
    setHidden(confirmBtn, true);
    confirmBtn.disabled = true;
  }
  cascadeDeleteDialog.showModal();

  try {
    const preview = await apiFetch(
      `/api/admin/content/courses/${encodeURIComponent(courseId)}/cascade-delete-preview`,
      getHeaders,
    );
    renderCascadeDeletePreview(preview);
  } catch (err) {
    if (textEl) textEl.textContent = apiErrorText(err);
  }
}

function initCascadeDeleteDialog() {
  const confirmBtn = document.getElementById("cascadeDeleteConfirmBtn");
  const cancelBtn = document.getElementById("cascadeDeleteCancelBtn");
  confirmBtn?.addEventListener("click", async () => {
    if (!pendingCascadeDelete) return;
    const { courseId } = pendingCascadeDelete;
    confirmBtn.disabled = true;
    try {
      const summary = await apiFetch(
        `/api/admin/content/courses/${encodeURIComponent(courseId)}/cascade-delete`,
        getHeaders,
        { method: "POST" },
      );
      cascadeDeleteDialog.close();
      pendingCascadeDelete = null;
      const modCount = summary?.deletedModuleIds?.length ?? 0;
      const secCount = summary?.deletedSectionIds?.length ?? 0;
      showToast(`Kurset ble slettet (${modCount} modul(er), ${secCount} seksjon(er)).`, "success");
      await renderListView();
    } catch (err) {
      apiErrorToast(err);
      confirmBtn.disabled = false;
    }
  });
  cancelBtn?.addEventListener("click", () => {
    cascadeDeleteDialog?.close();
    pendingCascadeDelete = null;
  });
}

// ---------------------------------------------------------------------------
// ── DETAIL VIEW ───────────────────────────────────────────────────────────
// Active locale tab for the detail form
// #1052: hvilket kurs detaljvisningen står i. Elementlistas lenker trenger det for å kunne
// sende forfatteren tilbake hit, og `renderModuleList()` tar ingen parametre.
let aktivtKursId = null;
// #974: kursdetaljens INNHOLDSspråk — fanen forfatteren redigerer i. Samme rolle som `contentLocale`
// i admin-content-shell, men per visning: den starter som menyspråket når et kurs åpnes (1252) og
// følger deretter bare fanevalget. Shellens `contentLocale` lever i minnet på sin egen side, så de
// to kan ikke dele verdi i dag; et felles, lagret innholdsspråk på tvers av forfattersidene er en
// egen avgjørelse (se #974).
let activeDetailLocale = supportedLocales.includes(currentLocale) ? currentLocale : "en-GB";
let initialDetailLocaleValues = cloneCourseLocaleValues();

// Course items being edited — modules and learning sections interleaved (#490/U3).
// Each entry: { type: "MODULE" | "SECTION", refId, title }
let courseModules = [];

// All available library modules (for the combobox)
let allLibraryModules = [];

// All available library sections (for the section picker, #490)
let allLibrarySections = [];

// Combobox state
let comboboxQuery = "";
// #935: det valgte elementet er { id, type } — velgeren dekker både moduler og seksjoner.
let comboboxSelected = null;
let comboboxOpen = false;
// #353: WAI-ARIA combobox keyboard nav. Highlight (visual + a11y focus
// via aria-activedescendant) er separat fra selection (det som faktisk legges til). Arrow
// up/down flytter highlight; Enter velger highlighted og legger den til; Escape lukker.
//
// #977: da saken ble funnet fantes det TO kombobokser — samtaleveiviserens med tastaturstøtte og
// kursdetaljens uten. Veiviserens er siden fjernet, og variabelen under sto igjen ubrukt, med
// kommentaren over som påsto at støtten fantes. Nå har den gjenværende komboboksen den: en
// tastaturbruker kunne ikke velge noe, og «Legg til modul» forble deaktivert.
let comboboxHighlightedIndex = -1;

async function renderDetailView(courseId) {
  // #1046 nivå to (1b, produkteier 12.09): «Nytt kurs» åpner det samme skjemaet tomt; kurset lages ved
  // første Lagre.
  aktivtKursId = courseId ?? null;

  pageContent.innerHTML = `<div class="page-loading">${escapeHtml(t("ui.loading"))}</div>`;

  activeDetailLocale = supportedLocales.includes(currentLocale) ? currentLocale : "en-GB";

  let course = null;
  if (courseId) {
    try {
      const data = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}`, getHeaders);
      course = data.course;
    } catch (err) {
      pageContent.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">${escapeHtml(t("courses.loadOneError"))}</p>
          <p class="empty-state-text">${escapeHtml(apiErrorText(err))}</p>
          <a href="/admin-content/courses" class="btn btn-secondary">${escapeHtml(t("courses.backToCourses"))}</a>
        </div>`;
      return;
    }
  }

  // Load library modules for combobox
  try {
    const libData = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
    // #440: only show PUBLISHED modules in the course picker. A course referring
    // to an unpublished module creates latent failures (broken exports, broken
    // course publish, broken participant view). Authors finalise modules first,
    // then assemble courses.
    allLibraryModules = (libData.modules ?? []).filter(m => m.status === "published");
  } catch {
    allLibraryModules = [];
  }

  // Load library sections for the section picker (#490)
  //
  // #992: arkiverte seksjoner filtreres bort — samme grep som modul-søsteren over gjør med
  // upubliserte. Uten det tilbød nedtrekkslista noe `/items` avviser med 400, og fordi ruta skriver
  // HELE sekvensen, feilet da ikke bare den ene raden: forfatteren mistet alle endringene i lagringen.
  //
  // ⚠️ Dette er ikke sannheten om regelen, bare høfligheten. Backend eier avslaget
  // (`assertContentUsableInCourse`), og skal fortsette å gjøre det — en klient som filtrerer er en
  // klient som kan bli utdatert. Poenget er å ikke by fram noe vi vet blir avvist.
  try {
    const secData = await apiFetch("/api/admin/content/sections", getHeaders);
    allLibrarySections = (secData.sections ?? []).filter(s => !s.archivedAt);
  } catch {
    allLibrarySections = [];
  }

  // Init course item list from the mixed CourseItem sequence (#490). Falls back
  // to the legacy module-only shape if the items endpoint is unavailable.
  if (course) {
    try {
      const itemsData = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/items`, getHeaders);
      courseModules = (itemsData.items ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(it => ({ type: it.type, refId: it.type === "MODULE" ? it.moduleId : it.sectionId, title: localizedText(it.title) || it.moduleId || it.sectionId, discussionsEnabled: it.discussionsEnabled !== false }));
    } catch {
      courseModules = (course.modules ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(cm => ({ type: "MODULE", refId: cm.moduleId, title: localizedText(cm.moduleTitle) || cm.moduleId }));
    }
  } else {
    courseModules = [];
  }

  // Init locale values from existing course or empty
  const titleValues = parseLocalizedFieldValues(course?.title);
  const descriptionValues = parseLocalizedFieldValues(course?.description);
  const localeValues = {};
  for (const loc of DETAIL_LOCALES) {
    localeValues[loc] = {
      title: titleValues[loc] ?? "",
      description: descriptionValues[loc] ?? "",
    };
  }
  initialDetailLocaleValues = cloneCourseLocaleValues({
    title: titleValues,
    description: descriptionValues,
  });

  const certLevel = course?.certificationLevel ?? "";
  const enrollmentPolicy = course?.enrollmentPolicy ?? "OPEN";
  // #495/T-QA-4: default på for nye kurs og når feltet mangler (eldre detaljer).
  const discussionsEnabled = course?.discussionsEnabled !== false;
  // #1093: plassering i «Mine kurs»; tomt = alfabetisk.
  const sortOrder = Number.isInteger(course?.sortOrder) ? String(course.sortOrder) : "";
  const pageTitle = course ? (localizedText(course.title) || t("ui.kind.course")) : t("courses.newCourse");
  const showPublishButton = canPublishCourse({
    ...course,
    moduleCount: courseModules.filter(it => it.type === "MODULE").length,
  });

  pendingVersions = course ? await loadPendingVersions(courseId) : null;

  courseDetail = { courseId: courseId ?? null, course, localeValues, certLevel, enrollmentPolicy, discussionsEnabled, sortOrder };
  const page = getCourseFormPage();
  page.render();
  page.markClean();
  if (!courseId) document.getElementById("title-nb")?.focus();

  // 2.101.0: kom forfatteren hit fra «Oppdater dette kurset», stilles spørsmålet med en gang. Flagget
  // fjernes fra adressen, så en omlasting ikke spør på nytt.
  const params = new URLSearchParams(window.location.search);
  if (courseId && params.has("publishPending")) {
    params.delete("publishPending");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    if ((pendingVersions?.items?.length ?? 0) > 0) await openPendingPublishDialog(courseId);
  }
}

// Kroppen i skjemasida: kursdetaljer + innhold. Feltene beholder id-ene sine (title-nb, certLevel …).
function courseDetailBodyHtml() {
  const { courseId, localeValues, certLevel, enrollmentPolicy, discussionsEnabled, sortOrder } = courseDetail;
  return `<div class="detail-layout">
    <div data-form-tab="rediger">
      <div class="detail-section">
        <h2 class="detail-section-title">${escapeHtml(t("courses.detailsTitle"))}</h2>

        ${DETAIL_LOCALES.map(loc => `
          <div class="locale-tab-pane${loc === activeDetailLocale ? " active" : ""}"
            id="pane-${loc}" role="tabpanel" aria-labelledby="tab-${loc}">
            <div class="form-field">
              <label for="title-${loc}">
                ${escapeHtml(t("ui.name"))}${loc === "nb" ? `<span class="required-note">${escapeHtml(t("ui.required"))}</span>` : ""}
              </label>
              <input id="title-${loc}" type="text" data-field="title" data-locale="${loc}"${loc === "nb" ? " data-form-title" : ""}
                value="${escapeHtml(localeValues[loc].title)}"
                placeholder="${loc === "nb" ? "" : "Viser bokmål hvis tomt"}"
                autocomplete="off" />
            </div>
            <div class="form-field">
              <label for="desc-${loc}">${escapeHtml(t("ui.description"))}</label>
              <textarea id="desc-${loc}" data-field="description" data-locale="${loc}"
                placeholder="${loc === "nb" ? "" : "Viser bokmål hvis tomt"}">${escapeHtml(localeValues[loc].description)}</textarea>
            </div>
          </div>`).join("")}

        <div class="form-field" style="margin-top: var(--space-2)">
          <label for="certLevel">${escapeHtml(t("ui.certLevel"))} <span class="required-note">${escapeHtml(t("ui.required"))}</span></label>
          <select id="certLevel">
            <option value="">${escapeHtml(t("courses.pickLevel"))}</option>
            <option value="basic"${certLevel === "basic" ? " selected" : ""}>${escapeHtml(certLabel("basic"))}</option>
            <option value="intermediate"${certLevel === "intermediate" ? " selected" : ""}>${escapeHtml(certLabel("intermediate"))}</option>
            <option value="advanced"${certLevel === "advanced" ? " selected" : ""}>${escapeHtml(certLabel("advanced"))}</option>
          </select>
        </div>

      </div>

      <div class="detail-section">
        <h2 class="detail-section-title">${escapeHtml(t("courses.contentTitle"))}</h2>
        <div id="moduleListContainer"></div>
        <!-- #935: ÉN velger for begge typene. Kurset er én ordnet liste av moduler og seksjoner, og
             forfatteren skal ikke lære to mønstre for én handling. Lista åpner ved fokus, så den
             kan blas i som nedtrekket kunne, og søkes i som kombiboksen kunne. -->
        <div class="form-add-row">
          <div class="combobox-wrap" id="comboboxWrap">
            <label for="comboboxInput" class="sr-only">${escapeHtml(t("courses.pickItem"))}</label>
            <input id="comboboxInput" type="text" class="combobox-input"
              placeholder="${escapeHtml(t("courses.itemSearchPlaceholder"))}"
              autocomplete="off" role="combobox" aria-expanded="false"
              aria-autocomplete="list" aria-controls="comboboxDropdown" />
            <div id="comboboxDropdown" class="combobox-dropdown" role="listbox" hidden></div>
          </div>
          <button id="addItemBtn" class="btn btn-secondary" disabled>${escapeHtml(t("courses.addItem"))}</button>
        </div>
      </div>

    </div>
    <!-- #1094 (QA): utenfor fanepanelene, så meldingen ses fra «Innstillinger» også — en ugyldig plassering
         bytter dit, og feil fra tjeneren kan komme mens forfatteren står der. -->
    <div id="formErrorBanner" hidden></div>
    <div data-form-tab="innstillinger" hidden>
      ${courseId ? `<div class="detail-section" id="ownerPanelHost" data-form-untracked></div>` : ""}
      <div class="detail-section">
        <h2 class="detail-section-title">${escapeHtml(t("ui.tab.settings"))}</h2>
        <div class="form-field">
          <label for="enrollmentPolicy">${escapeHtml(t("courses.visibility"))}</label>
          <select id="enrollmentPolicy">
            <option value="OPEN"${enrollmentPolicy !== "RESTRICTED" ? " selected" : ""}>${escapeHtml(t("courses.visibility.open"))}</option>
            <option value="RESTRICTED"${enrollmentPolicy === "RESTRICTED" ? " selected" : ""}>${escapeHtml(t("courses.visibility.restricted"))}</option>
          </select>
        </div>
        <div class="form-field" style="margin-top: var(--space-2)">
          <label for="sortOrder">${escapeHtml(t("courses.sortOrder"))}</label>
          <input type="number" id="sortOrder" min="0" max="9999" step="1" inputmode="numeric" value="${escapeHtml(sortOrder)}" style="max-width: 8rem" />
          <p class="small" style="margin: 4px 0 0">${escapeHtml(t("courses.sortOrderHelp"))}</p>
        </div>
        <div class="form-field" style="margin-top: var(--space-2)">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="discussionsEnabled"${discussionsEnabled ? " checked" : ""} />
            Diskusjon på dette kurset (deltakere kan stille spørsmål og diskutere)
          </label>
        </div>
        ${courseId ? "" : `<p class="small" style="margin:var(--space-2) 0 0">${escapeHtml(t("courses.saveFirstOwners"))}</p>`}
      </div>
    </div>
    </div>`;
}

function bindCourseDetail() {
  const { courseId } = courseDetail;
  renderModuleList();
  initDetailEventListeners(courseId);
  // #787 slice 5: content-owner management for this course (a new course has no id yet).
  const ownerHost = document.getElementById("ownerPanelHost");
  if (ownerHost && courseId) {
    renderOwnerPanel({ container: ownerHost, contentType: "COURSE", contentId: courseId, getHeaders, t }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Skjemasida for kurs (form-page.js). #1046 nivå to.
// ---------------------------------------------------------------------------

let courseDetail = null; // { courseId, course, localeValues, certLevel, enrollmentPolicy, discussionsEnabled }
let courseFormPage = null;

const courseFormTexts = () => formPageTexts(t, { back: t("courses.back"), typeLabel: t("courses.typeLabel"), untitled: t("courses.untitled") });

function switchDetailLocale(loc) {
  activeDetailLocale = loc;
  document.querySelectorAll(".locale-tab-pane").forEach(p => {
    p.classList.toggle("active", p.id === `pane-${activeDetailLocale}`);
  });
}

function getCourseFormPage() {
  if (courseFormPage) return courseFormPage;
  courseFormPage = createFormPage({
    host: pageContent,
    texts: courseFormTexts,
    backHref: "/admin-content/courses",
    title: () => {
      const nb = document.getElementById("title-nb")?.value?.trim();
      if (nb) return nb;
      return courseDetail?.course ? (localizedText(courseDetail.course.title) || "") : "";
    },
    item: () => courseDetail?.course ?? null,
    t,
    actions: () => courseDetailActions(),
    languages: {
      locales: DETAIL_LOCALES, labels: localeLabels, required: "nb",
      current: () => activeDetailLocale,
      onChange: (loc) => switchDetailLocale(loc),
    },
    tabs: { items: () => [{ id: "rediger", label: t("ui.tab.edit") }, { id: "innstillinger", label: t("ui.tab.settings") }], initial: "rediger" },
    body: () => courseDetailBodyHtml(),
    save: { onSave: () => saveCourse(courseDetail?.courseId ?? null) },
    afterRender: () => bindCourseDetail(),
  });
  courseFormPage.installGuards();
  return courseFormPage;
}

// Handlingsraden i hodet (F1/F2): det lista kan, kan det åpnede kurset også.
function courseDetailActions() {
  const c = courseDetail?.course;
  if (!c) return [];
  const lifecycle = lifecycleOf(c);
  const cid = escapeHtml(c.id);
  const ctitle = escapeHtml(localizedText(c.title) || c.id);
  const moduleCount = courseModules.filter(it => it.type === "MODULE").length;
  const pendingCount = lifecycle === "archived" ? 0 : (pendingVersions?.items?.length ?? 0);
  return [
    pendingCount > 0
      ? `<button type="button" class="row-action-btn" data-action="publish-pending" data-course-id="${cid}">${escapeHtml(tf("adminContent.courses.pendingPublish.action", { count: pendingCount }))}</button>`
      : "",
    `<button type="button" class="row-action-btn" data-action="export" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.export"))}</button>`,
    lifecycle === "archived" ? ""
      : lifecycle === "published"
        ? `<button type="button" class="row-action-btn" data-action="unpublish" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.unpublish"))}</button>`
        : (moduleCount > 0 ? `<button type="button" id="publishCourseBtn" class="row-action-btn" data-action="publish" data-course-id="${cid}">${escapeHtml(t("ui.action.publish"))}</button>` : ""),
    lifecycle === "archived"
      ? `<button type="button" class="row-action-btn" data-action="restore" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.restore"))}</button>`
      : `<button type="button" class="row-action-btn" data-action="archive" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.archive"))}</button>`,
    lifecycle === "archived" ? `<button type="button" class="row-action-btn destructive" data-action="delete" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.delete"))}</button>` : "",
    isAdministrator() ? `<button type="button" class="row-action-btn destructive" data-action="cascade-delete" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("courses.deleteWithContent"))}</button>` : "",
  ];
}

// Etter en livssyklushandling: bli på kurset når man står i det, ellers lista.
async function refreshCourseView(courseId) {
  const route = detectRoute();
  if (route.view === "list") await renderListView();
  else await renderDetailView(courseId ?? route.courseId);
}

// ---------------------------------------------------------------------------
// Module list rendering (detail view)
// ---------------------------------------------------------------------------

function renderModuleList() {
  const container = document.getElementById("moduleListContainer");
  if (!container) return;
  // Innholdslista lagres med Lagre — men først etter at den er tegnet første gang (markClean etter render).
  if (courseFormPage && courseFormPage.state && container.dataset.rendered === "1") courseFormPage.markDirty();
  container.dataset.rendered = "1";

  // #935: velgeren tegnes av seg selv ved åpning; det som alt ligger i kurset, filtreres der.
  if (courseModules.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: var(--space-3) var(--space-2)">
        <p class="empty-state-title" style="font-size: 15px;">${escapeHtml(t("courses.noItemsTitle"))}</p>
        <p class="empty-state-text">${escapeHtml(t("courses.noItemsHint"))}</p>
      </div>`;
    return;
  }

  // #1046 G1: den delte «rad i skjema» (shared.css .form-row) — samme rad som klassens kurs og medlemmer.
  container.innerHTML = `<ul class="form-rows" id="moduleList">
    ${courseModules.map((m, i) => {
      // #744: åpne elementets editor i ny fane så kursbyggeren ikke går tapt.
      // Modul → samtale-editoren; seksjon → seksjons-editoren.
      const openHref = buildCourseItemHref(m, aktivtKursId);
      return `
      <li class="form-row" data-item-type="${m.type}" data-ref-id="${escapeHtml(m.refId)}">
        <span class="form-row-order">${i + 1}.</span>
        <span class="form-row-badge">${courseItemTypeBadge(m.type)}</span>
        <span class="form-row-title">${escapeHtml(m.title)}</span>
        <div class="form-row-actions">
          <button type="button" class="row-action-btn" data-move="up" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="${escapeHtml(t("courses.moveUp"))}">↑</button>
          <button type="button" class="row-action-btn" data-move="down" data-index="${i}" ${i === courseModules.length - 1 ? "disabled" : ""} aria-label="${escapeHtml(t("courses.moveDown"))}">↓</button>
          <a href="${openHref}" class="row-action-btn" target="_blank" rel="noopener">${escapeHtml(t("ui.action.open"))}</a>
          <button type="button" class="row-action-btn destructive" data-remove="${i}" aria-label="${escapeHtml(t("courses.removeModule"))}">${escapeHtml(t("ui.action.remove"))}</button>
        </div>
      </li>`;
    }).join("")}
  </ul>`;

  document.getElementById("moduleList")?.addEventListener("click", handleModuleListClick);
  // #923: per-element diskusjons-toggle er borte. Diskusjon finnes bare på kursnivå, så en bryter
  // for «diskusjon på akkurat dette elementet» styrte en flate deltakeren ikke lenger har.
  // Verdien leses fortsatt fra kurset og sendes uendret tilbake i PUT /courses/:id/items ved lagring,
  // så ingenting i databasen endres av at bryteren forsvant — den kan skrus på igjen ved å
  // gjenopprette dette feltet.
}

function handleModuleListClick(e) {
  const moveBtn = e.target.closest("[data-move]");
  if (moveBtn) {
    const idx = parseInt(moveBtn.dataset.index, 10);
    const dir = moveBtn.dataset.move;
    moveModule(idx, dir);
    return;
  }
  const removeBtn = e.target.closest("[data-remove]");
  if (removeBtn) {
    const idx = parseInt(removeBtn.dataset.remove, 10);
    courseModules.splice(idx, 1);
    renderModuleList();
    updateComboboxDropdown();
  }
}

function moveModule(idx, dir) {
  courseModules = moveItem(courseModules, idx, dir);
  renderModuleList();
}

// ---------------------------------------------------------------------------
// Searchable combobox
// ---------------------------------------------------------------------------

// #935: moduler og seksjoner i én liste, alfabetisk, med typen som merke i raden. Det som alt
// ligger i kurset, tilbys ikke igjen (samme regel begge veier — den fantes for begge før også).
function getComboboxOptions() {
  const added = new Set(courseModules.map(m => `${m.type}:${m.refId}`));
  const q = comboboxQuery.trim().toLowerCase();
  const items = [
    ...allLibraryModules.map(m => ({ id: m.id, type: "MODULE", title: localizedText(m.title) || m.id })),
    ...allLibrarySections.map(s => ({ id: s.id, type: "SECTION", title: localizedText(s.title) || s.id })),
  ];
  return items
    .filter(item => !added.has(`${item.type}:${item.id}`))
    .filter(item => !q || item.title.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, "nb"));
}

function isComboboxSelected(item) {
  return !!comboboxSelected && comboboxSelected.id === item.id && comboboxSelected.type === item.type;
}

function updateComboboxDropdown() {
  const input = document.getElementById("comboboxInput");
  const dropdown = document.getElementById("comboboxDropdown");
  const addBtn = document.getElementById("addItemBtn");
  if (!input || !dropdown) return;

  const options = getComboboxOptions();

  // #935: lista står åpen også uten søketekst (ved fokus), så forfatteren kan bla som i et
  // nedtrekk. Før krevde den tekst — og seksjonene lå i et nedtrekk som ikke kunne søkes i.
  if (!comboboxOpen) {
    dropdown.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }

  dropdown.hidden = false;
  input.setAttribute("aria-expanded", "true");

  if (options.length === 0) {
    dropdown.innerHTML = `<div class="combobox-empty">${escapeHtml(t(comboboxQuery.trim() ? "courses.noItemsMatch" : "courses.noItemsAvailable"))}</div>`;
    comboboxSelected = null;
    if (addBtn) addBtn.disabled = true;
    return;
  }

  if (comboboxHighlightedIndex >= options.length) comboboxHighlightedIndex = options.length - 1;
  dropdown.innerHTML = options.map((item, index) => `
    <div class="combobox-option${isComboboxSelected(item) ? " selected" : ""}${index === comboboxHighlightedIndex ? " highlighted" : ""}"
      id="comboboxOption-${index}"
      role="option" aria-selected="${isComboboxSelected(item)}"
      data-item-id="${escapeHtml(item.id)}" data-item-type="${item.type}" data-item-title="${escapeHtml(item.title)}">
      <span class="form-row-badge">${courseItemTypeBadge(item.type)}</span>
      ${escapeHtml(item.title)}
      <span class="combobox-option-id">${escapeHtml(item.id)}</span>
    </div>`).join("");
  // #977: skjermleseren følger markeringen via aria-activedescendant; fokus blir i feltet.
  if (comboboxHighlightedIndex >= 0) {
    input.setAttribute("aria-activedescendant", `comboboxOption-${comboboxHighlightedIndex}`);
    dropdown.querySelector(`#comboboxOption-${comboboxHighlightedIndex}`)?.scrollIntoView?.({ block: "nearest" });
  } else {
    input.removeAttribute("aria-activedescendant");
  }

  dropdown.querySelectorAll(".combobox-option").forEach(opt => {
    opt.addEventListener("mousedown", e => {
      e.preventDefault();
      chooseComboboxItem({ id: opt.dataset.itemId, type: opt.dataset.itemType, title: opt.dataset.itemTitle });
    });
  });

  if (addBtn) addBtn.disabled = !comboboxSelected;
}

// Ett valg, samme vei for mus og tastatur: feltet viser tittelen, lista lukkes, «Legg til» åpnes.
function chooseComboboxItem(item) {
  comboboxSelected = { id: item.id, type: item.type };
  const input = document.getElementById("comboboxInput");
  if (input) input.value = item.title;
  comboboxOpen = false;
  comboboxHighlightedIndex = -1;
  updateComboboxDropdown();
  const addBtn = document.getElementById("addItemBtn");
  if (addBtn) addBtn.disabled = false;
}

// #935: én «Legg til» for begge typene. Seksjonsvelgeren (#490) var et eget nedtrekk med en knapp
// som alltid var aktiv — nå går seksjoner samme vei som moduler.
function addSelectedItem() {
  if (!comboboxSelected) return;
  const item = getComboboxOptions().find(isComboboxSelected)
    ?? (comboboxSelected.type === "SECTION"
      ? allLibrarySections.filter(x => x.id === comboboxSelected.id).map(x => ({ id: x.id, type: "SECTION", title: localizedText(x.title) || x.id }))[0]
      : allLibraryModules.filter(x => x.id === comboboxSelected.id).map(x => ({ id: x.id, type: "MODULE", title: localizedText(x.title) || x.id }))[0]);
  if (!item) return;
  courseModules.push({ type: item.type, refId: item.id, title: item.title });
  comboboxSelected = null;
  comboboxQuery = "";
  comboboxOpen = false;
  const input = document.getElementById("comboboxInput");
  if (input) input.value = "";
  updateComboboxDropdown();
  renderModuleList();
}

// ---------------------------------------------------------------------------
// Detail event listeners
// ---------------------------------------------------------------------------

// Handlingsraden i skjemasidas hode — samme handlere som lista (handleListTableClick). ⚠️ Delegert fra
// `pageContent`, bundet ÉN gang: hodet tegnes på nytt (`refreshHeader`, f.eks. når en navnefeil bytter
// til bokmålspanelet), og en lytter på `.form-page-actions` fulgte med det gamle elementet ut — knappene
// sluttet å virke til sida ble lastet på nytt (QA-porten 2.89.1; samme feil som seksjonsredigereren
// hadde i 2.88.3). Lista har ingen `.form-page-actions`, så dette rører ikke radhandlingene.
let headerActionsBound = false;
function bindHeaderActions() {
  if (headerActionsBound) return;
  headerActionsBound = true;
  pageContent.addEventListener("click", (e) => {
    const btn = e.target.closest(".form-page-actions [data-action]");
    if (!btn) return;
    if (!getCourseFormPage().confirmLeave()) return;
    handleListTableClick(e, btn);
  });
}

function initDetailEventListeners(courseId) {
  bindHeaderActions();

  // Combobox
  const comboboxInput = document.getElementById("comboboxInput");
  comboboxInput?.addEventListener("input", () => {
    comboboxQuery = comboboxInput.value;
    comboboxSelected = null;
    comboboxHighlightedIndex = -1;
    comboboxOpen = true;
    const addBtn = document.getElementById("addItemBtn");
    if (addBtn) addBtn.disabled = true;
    updateComboboxDropdown();
  });
  // #977: tastaturet. Piltaster flytter markeringen, Enter velger den markerte (og legger den til om
  // den alt var valgt), Escape lukker. Uten dette var «Legg til modul» uoppnåelig uten mus.
  comboboxInput?.addEventListener("keydown", (e) => {
    const options = getComboboxOptions();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (options.length === 0) return;
      e.preventDefault();
      if (!comboboxOpen) comboboxOpen = true;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      comboboxHighlightedIndex = (comboboxHighlightedIndex + delta + options.length) % options.length;
      updateComboboxDropdown();
      return;
    }
    if (e.key === "Enter") {
      if (!comboboxOpen || comboboxHighlightedIndex < 0 || comboboxHighlightedIndex >= options.length) return;
      e.preventDefault();
      chooseComboboxItem(options[comboboxHighlightedIndex]);
      return;
    }
    if (e.key === "Escape" && comboboxOpen) {
      e.preventDefault();
      comboboxOpen = false;
      comboboxHighlightedIndex = -1;
      updateComboboxDropdown();
    }
  });
  comboboxInput?.addEventListener("focus", () => {
    // #935: åpner ved fokus, også uten tekst — lista kan blas i.
    if (!comboboxSelected) {
      comboboxOpen = true;
      updateComboboxDropdown();
    }
  });
  comboboxInput?.addEventListener("blur", () => {
    setTimeout(() => {
      comboboxOpen = false;
      updateComboboxDropdown();
    }, 150);
  });

  document.getElementById("addItemBtn")?.addEventListener("click", addSelectedItem);

  // Save
}

// ---------------------------------------------------------------------------
// Save course
// ---------------------------------------------------------------------------

function collectLocaleValues() {
  const title = {};
  const description = {};
  for (const loc of DETAIL_LOCALES) {
    const titleEl = document.getElementById(`title-${loc}`);
    const descEl = document.getElementById(`desc-${loc}`);
    const tv = titleEl?.value.trim() ?? "";
    const dv = descEl?.value.trim() ?? "";
    if (tv) title[loc] = tv;
    if (dv) description[loc] = dv;
  }
  return { title, description };
}

function normalizeLocalizedRequestValue(valueMap) {
  const entries = Object.entries(valueMap).filter(([, value]) => typeof value === "string" && value.trim());
  if (entries.length === 0) return undefined;
  // ⚠️ Her sto: er ENGELSK det eneste utfylte språket, send en ren streng i stedet for kartet.
  //
  // En ren streng bærer ikke noe språkmerke, og serveren leser den som bokmål (#930). Et kurs med
  // bare engelsk tittel ble derfor registrert som norsk, og publiseringsgaten navnga feil språk som
  // manglende — nøyaktig feilen #930 rettet for moduler.
  //
  // Merk asymmetrien den skapte: bare-norsk beholdt kartet, bare-engelsk mistet det. Serveren
  // godtar delvise kart (`localizedTextPatchSchema`), så kollapsen var aldri nødvendig.
  return Object.fromEntries(entries);
}

function resolveContentAdminDefaults() {
  const defaults = participantRuntimeConfig?.identityDefaults?.contentAdmin;
  if (defaults && typeof defaults === "object") {
    return defaults;
  }
  return participantRuntimeConfig?.identityDefaults ?? {
    userId: "content-owner-1",
    email: "content.owner@company.com",
    name: "Platform Content Owner",
    department: "Learning",
    roles: ["SUBJECT_MATTER_OWNER"],
  };
}

function resolveActiveWorkspaceRoles() {
  if (Array.isArray(activeUserRoles) && activeUserRoles.length > 0) {
    return activeUserRoles;
  }
  const defaults = resolveContentAdminDefaults();
  return Array.isArray(defaults?.roles) && defaults.roles.length > 0 ? defaults.roles : ["SUBJECT_MATTER_OWNER"];
}

async function saveCourse(courseId) {
  const saveBtn = document.getElementById("formSaveBtn");
  const errorBanner = document.getElementById("formErrorBanner");

  const collectedValues = collectLocaleValues();
  const certLevel = document.getElementById("certLevel")?.value ?? "";
  const enrollmentPolicy = document.getElementById("enrollmentPolicy")?.value === "RESTRICTED" ? "RESTRICTED" : "OPEN";
  const discussionsEnabled = document.getElementById("discussionsEnabled")?.checked !== false;
  // #1093: tomt felt sendes som null (alfabetisk); et tall sendes som tall.
  // #1094: et tallfelt gir tom verdi for «1-» (validity.badInput), og «1e2» ble tolket som 1 — begge
  // lagret stille noe annet enn forfatteren skrev. Bare et helt tall 0–9999, ellers melding og stopp.
  const sortOrderInput = document.getElementById("sortOrder");
  const sortOrderRaw = (sortOrderInput?.value ?? "").trim();
  const sortOrderBad = Boolean(sortOrderInput?.validity?.badInput)
    || (sortOrderRaw !== "" && (!/^\d+$/.test(sortOrderRaw) || Number(sortOrderRaw) > 9999));
  if (sortOrderBad) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">${escapeHtml(t("courses.sortOrderInvalid"))}</div>`;
      errorBanner.hidden = false;
    }
    courseFormPage?.showTab?.("innstillinger");
    sortOrderInput?.focus();
    return false;
  }
  const sortOrder = sortOrderRaw === "" ? null : Number.parseInt(sortOrderRaw, 10);
  const sourceLocale = resolveCourseLocalizationSourceLocale(collectedValues, initialDetailLocaleValues);
  const effectiveValues = sourceLocale
    ? await localizeCourseCopyAcrossLocales({
        titleValues: collectedValues.title,
        descriptionValues: collectedValues.description,
        sourceLocale,
        preserveExisting: true,
      })
    : cloneCourseLocaleValues(collectedValues);
  meldFeiledeLokaler(effectiveValues.failedLocales);
  const normalizedTitle = normalizeLocalizedRequestValue(effectiveValues.title);
  const normalizedDescription = normalizeLocalizedRequestValue(effectiveValues.description);

  // Validation. #1046 (produkteier 12.09): bokmål er det påkrevde språket — navnet må finnes på
  // bokmål før kurset kan lagres. De andre språkene kan fylles etterpå; publiseringsgaten krever alle tre.
  if (!String(effectiveValues.title?.nb ?? "").trim()) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">${escapeHtml(t("courses.nameRequiredNb"))}</div>`;
      errorBanner.hidden = false;
    }
    // Feltet ligger i «Rediger», og i bokmålspanelet. Står forfatteren på «Innstillinger», eller er
    // et annet språkpanel valgt (det følger grensesnittspråket), havnet fokus i et skjult felt.
    courseFormPage?.showTab?.("rediger");
    if (activeDetailLocale !== "nb") {
      switchDetailLocale("nb");
      courseFormPage?.refreshHeader?.();
    }
    document.getElementById("title-nb")?.focus();
    return false;
  }
  if (!certLevel) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">${escapeHtml(t("courses.levelRequired"))}</div>`;
      errorBanner.hidden = false;
    }
    courseFormPage?.showTab?.("rediger");
    document.getElementById("certLevel")?.focus();
    return false;
  }

  if (errorBanner) errorBanner.hidden = true;
  if (saveBtn) saveBtn.disabled = true;
  applyCourseLocaleValuesToForm(effectiveValues);

  try {
    let savedCourseId = courseId;

    if (!courseId) {
      // Create
      const body = await apiFetch("/api/admin/content/courses", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription,
          certificationLevel: certLevel || undefined,
          enrollmentPolicy,
          discussionsEnabled,
          sortOrder,
        }),
      });
      savedCourseId = body.course?.id;
      if (!savedCourseId) throw new Error(t("courses.noIdReturned"));
    } else {
      // Update
      await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}`, getHeaders, {
        method: "PUT",
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription,
          certificationLevel: certLevel || undefined,
          enrollmentPolicy,
          discussionsEnabled,
          sortOrder,
        }),
      });
    }

    // Save the mixed module/section sequence (#490). PUT /items also re-syncs
    // CourseModule server-side (B2) so legacy read paths stay correct.
    const items = courseModules.map(m =>
      m.type === "SECTION"
        ? { type: "SECTION", sectionId: m.refId, discussionsEnabled: m.discussionsEnabled !== false }
        : { type: "MODULE", moduleId: m.refId, discussionsEnabled: m.discussionsEnabled !== false },
    );
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(savedCourseId)}/items`, getHeaders, {
      method: "PUT",
      body: JSON.stringify({ items }),
    });

    showToast(t("courses.saved"), "success");
    initialDetailLocaleValues = cloneCourseLocaleValues(effectiveValues);

    // If new, navigate to the saved course URL (skjemaet er lagret — ingen spørsmål ved navigering).
    if (!courseId) {
      getCourseFormPage().markClean();
      window.location.href = `/admin-content/courses/${encodeURIComponent(savedCourseId)}`;
    } else {
      await renderDetailView(courseId);
    }
    return true;
  } catch (err) {
    if (errorBanner) {
      errorBanner.innerHTML = `<div class="error-banner">${escapeHtml(apiErrorText(err))}</div>`;
      errorBanner.hidden = false;
    }
    if (saveBtn) saveBtn.disabled = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Workspace navigation
// ---------------------------------------------------------------------------

function renderWorkspaceNavigation() {
  if (!workspaceNav) return;
  const roles = resolveActiveWorkspaceRoles().join(",");
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

function renderContentAreaNav() {
  const calibrationRoles = new Set(participantRuntimeConfig.calibrationWorkspace?.accessRoles ?? []);
  const userRoles = new Set(resolveActiveWorkspaceRoles());
  const hasCalibrationRole = [...calibrationRoles].some(r => userRoles.has(r));
  if (navKalibrering) navKalibrering.hidden = !hasCalibrationRole;
}

// ---------------------------------------------------------------------------
// Locale selector
// ---------------------------------------------------------------------------

// #1095: statisk tekst i HTML-kilden (dialogtitler og -knapper) følger språket. Modulskallet gjør
// det samme i `translatePageStaticText`; kurssiden gjorde det ikke, så `data-i18n` her sto på
// bokmål uansett valgt språk. Kjøres ved oppstart og ved språkbytte.
function translateStaticText() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
}

function buildLocaleSelector() {
  if (!localeSelect) return;
  localeSelect.innerHTML = supportedLocales
    .map(l => `<option value="${l}"${l === currentLocale ? " selected" : ""}>${localeLabels[l] ?? l}</option>`)
    .join("");
  localeSelect.addEventListener("change", () => {
    currentLocale = localeSelect.value;
    localStorage.setItem("participant.locale", currentLocale);
    if (_headerValues && typeof _headerValues === "object") {
      _headerValues["x-locale"] = currentLocale;
    }
    translateStaticText();
    const route = detectRoute();
    if (route.view === "list") {
      renderListView();
    } else {
      renderDetailView(route.courseId);
    }
  });
}

// ---------------------------------------------------------------------------
// Delete dialog wiring
// ---------------------------------------------------------------------------

function initDeleteDialog() {
  deleteConfirmBtn?.addEventListener("click", confirmDelete);
  deleteCancelBtn?.addEventListener("click", () => {
    deleteDialog.close();
    pendingDeleteId = null;
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    const cfg = await getConsoleConfig();
    participantRuntimeConfig = cfg;
    const defaults = resolveContentAdminDefaults();
    _headerValues = buildConsoleHeaders({
      userId: defaults.userId,
      email: defaults.email,
      name: defaults.name,
      department: defaults.department,
      roles: Array.isArray(defaults.roles) ? defaults.roles.join(",") : defaults.roles,
      locale: currentLocale,
    });
  } catch {
    _headerValues = {};
  }

  try {
    const me = await apiFetch("/api/me", getHeaders);
    activeUserRoles = Array.isArray(me?.user?.roles) ? me.user.roles : [];
  } catch {
    activeUserRoles = [];
  }

  buildLocaleSelector();
  renderWorkspaceNavigation();
  renderContentAreaNav();

  await initConsentGuard(getHeaders, currentLocale);

  try {
    const body = await apiFetch("/version", { headers: {} });
    const version = body.version ?? "unknown";
    if (appVersionLabel) appVersionLabel.textContent = `v${version}`;
  } catch {
    if (appVersionLabel) appVersionLabel.textContent = "unknown";
  }

  if (workspaceNav) {
    fetchQueueCounts(getHeaders).then(counts => applyNavReviewBadge(workspaceNav, counts)).catch(() => {});
  }

  initDeleteDialog();
  initCascadePublishDialog();
  initPendingPublishDialog();
  initCascadeDeleteDialog();

  const route = detectRoute();
  translateStaticText();
  if (route.view === "list") {
    await renderListView();
  } else {
    await renderDetailView(route.courseId);
  }
  // #1095: en melding lagt i kø av siden som navigerte hit (importens oppsummering).
  flushQueuedToast();
}

init();
