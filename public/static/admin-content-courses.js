import { createDateFormatter, createDateTimeFormatter } from "./format-display.js";
const formatDate = createDateFormatter(() => currentLocale);
const formatDateTime = createDateTimeFormatter(() => currentLocale, "");
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
import { runWithBusyButton } from "/static/busy-button.js";
import {
  resolveWorkspaceNavigationItems,
} from "/static/participant-console-state.js";
import { describeImportError } from "/static/import-error.js";
import { describeAltWarnings, describePackageCueWarnings, describeRubricWarnings } from "/static/mcq-cue-warnings.js";
import { apiErrorBody, apiErrorCode, apiErrorCodeText, apiErrorStatus, describeApiError } from "/static/api-error.js";
import { courseVersionLabel, createCourseVersionChoice, versionRequestBody } from "/static/course-version-choice.js";
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
const { courseVersionHoldersText, courseVersionAnswer, mountCourseVersionChoice, mountAffectedCourses } = createCourseVersionChoice({ t, tf });

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

// #1140 etappe 2 (skive 2c): et kurs med et nyere utkast er fortsatt publisert. Knappene som spør «er kurset ute?» (lista og
// handlingsraden), leser dette. Før sjekket de `=== "published"`, og et kurs med utkast fikk «Publiser» i stedet for «Avpubliser».
function isLiveLifecycle(lifecycle) {
  return lifecycle === "published" || lifecycle === "published_with_draft";
}

/** Kurset har et lagret utkast. Et avpublisert kurs kan ha et liggende igjen (`lifecycle: "draft"`, `hasDraft: true`). */
function courseHasDraft(course) {
  return course?.hasDraft === true || lifecycleOf(course) === "published_with_draft";
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
async function commitCoursePublish(courseId, publishItems, triggerButton = null, versionAnswer = undefined) {
  try {
    await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/publish`, getHeaders, {
      method: "POST",
      // #934 skive 3: svaret sendes bare når dialogen spurte (kursbevis finnes). Skive 4b: med tallet forfatteren
      // bekreftet når hovedversjonen sender e-post.
      body: JSON.stringify({ publishItems, ...versionRequestBody(versionAnswer, "courseVersion") }),
    });
    showToast(t("adminContent.courses.message.published") || t("courses.published"), "success");

    const route = detectRoute();
    if (route.view === "list") {
      await renderListView();
    } else {
      await renderDetailView(courseId);
    }
  } catch (err) {
    // #934 skive 5b: en modul som har vært ute før, skal ikke gå live uten at det er spurt per kurs. Serveren viser hit, så
    // teksten sier det og hvilke moduler, og «Publiser nye versjoner» åpnes. Ingenting skjer der uten et klikk.
    if (apiErrorCode(err) === "course_publish_has_republished_modules") {
      if (triggerButton) triggerButton.disabled = false;
      const modules = apiErrorBody(err)?.details?.modules;
      const names = Array.isArray(modules) ? modules.map((module) => localizedText(module?.title) || module?.moduleId).filter(Boolean).join(", ") : "";
      showToast(describeApiError(err, t).headline, "warning", names);
      await openPendingPublishDialog(courseId);
      return;
    }
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
  // #934 skive 3: nytt innhold går live i et kurs med kursbevis — samme valg som i skjemaet og «Publiser nye
  // versjoner» (én felles hjelper). Mindre er standard, så dialogen har alltid et svar.
  const versionHost = document.getElementById("cascadePublishVersion");
  const asksVersion = !blocked && Number(preview?.course?.certificateHolders) > 0;
  pendingCascadePublish.asksVersion = asksVersion;
  pendingCascadePublish.course = preview?.course ?? null;
  if (versionHost) {
    setHidden(versionHost, !asksVersion);
    if (asksVersion) {
      mountCourseVersionChoice(versionHost, "cascadeCourseVersion", preview.course);
      const heading = document.createElement("p");
      heading.className = "dialog-text";
      heading.innerHTML = `<strong>${escapeHtml(t("courses.version.pendingHeading"))}</strong><br>${escapeHtml(courseVersionHoldersText(preview.course))}`;
      versionHost.prepend(heading);
    } else {
      versionHost.innerHTML = "";
    }
  }

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
    const { courseId, triggerButton, asksVersion, course } = pendingCascadePublish;
    const versionAnswer = asksVersion ? courseVersionAnswer(document.getElementById("cascadePublishVersion"), "cascadeCourseVersion", course) : undefined;
    // #934 skive 4b: over 200 mottakere uten det ekstra «ja»: dialogen står åpen, og ingenting publiseres.
    if (asksVersion && !versionAnswer) return;
    pendingCascadePublish = null;
    confirmBtn.disabled = true;
    cascadePublishDialog.close();
    await commitCoursePublish(courseId, true, triggerButton, versionAnswer);
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

/**
 * #934 skive 5b: ett valg per berørt kurs, når serveren lister kursene. `affectedCourses` finnes bare når bryteren er på. Med den av, og
 * mot en gammel server, er dialogen den samme som før.
 */
function mountPendingCourses(host, target, affected, changed) {
  host.innerHTML = `${changed ? `<p class="course-version-notice" role="alert">${escapeHtml(t("courses.version.changedNotice"))}</p>` : ""}
    <p class="dialog-text"><strong>${escapeHtml(t("courses.version.pendingCoursesHeading"))}</strong><br>${escapeHtml(t("courses.version.pendingCoursesIntro"))}</p>
    <div data-affected-courses></div>`;
  target.affected = mountAffectedCourses(host.querySelector("[data-affected-courses]"), affected, {
    prefix: "pendingCourseVersion",
    currentCourseId: target.courseId,
  });
}

async function openPendingPublishDialog(courseId, { changed = false } = {}) {
  const dialog = document.getElementById("pendingPublishDialog");
  if (!dialog || typeof dialog.showModal !== "function") return;
  // Alltid ferskt: det forfatteren svarer på, skal være det som står i kurset nå.
  const pending = await loadPendingVersions(courseId);
  if (!pending) {
    // Lesingen feilet mens dialogen står: knappene ble slått av ved sending, og skal virke igjen.
    if (dialog.open) for (const button of Object.values(pendingPublishButtons())) if (button) button.disabled = false;
    return;
  }
  pendingVersions = pending;
  const items = pending.items ?? [];
  const notOwned = pending.notOwnedItems ?? [];
  if (items.length === 0) {
    // #934 skive 5b: noen andre har publisert alt mens dialogen sto. Det er ingenting å svare på lenger.
    if (dialog.open) {
      pendingPublishTarget = null;
      dialog.close();
      await refreshCourseView(courseId);
    }
    return;
  }

  const blocked = !pending.publishable;
  const versioned = Array.isArray(pending.affectedCourses);
  // #934 skive 5b: med svar per kurs faller #997-spørsmålet bort.
  const asksRevision = !versioned && !blocked && Number(pending.passedTotal) > 0;
  pendingPublishTarget = { courseId, versionIds: items.map((item) => item.versionId), versioned };
  dialog.classList.toggle("is-versioned", versioned);

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

  // #934 skive 3: mindre eller hovedversjon for kurset — bare når noen har kursbevis (da har kurset vært ute).
  const versionHost = document.getElementById("pendingPublishVersion");
  const asksVersion = !versioned && !blocked && Number(pending.course?.certificateHolders) > 0;
  pendingPublishTarget.asksVersion = asksVersion;
  pendingPublishTarget.course = pending.course ?? null;
  if (versioned) {
    const showCourses = !blocked && pending.affectedCourses.length > 0;
    setHidden(versionHost, !showCourses);
    if (showCourses) mountPendingCourses(versionHost, pendingPublishTarget, pending.affectedCourses, changed);
    else versionHost.innerHTML = "";
  } else if (versionHost) {
    setHidden(versionHost, !asksVersion);
    if (asksVersion) {
      mountCourseVersionChoice(versionHost, "pendingCourseVersion", pending.course);
      const heading = document.createElement("p");
      heading.className = "dialog-text";
      heading.innerHTML = `<strong>${escapeHtml(t("courses.version.pendingHeading"))}</strong><br>${escapeHtml(courseVersionHoldersText(pending.course))}`;
      versionHost.prepend(heading);
    } else {
      versionHost.innerHTML = "";
    }
  }

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

// #934 skive 5b: svarene gjelder ikke lenger det som står på serveren. Ingenting er skrevet. Dialogen tegnes på nytt med ferske tall, og
// forfatteren svarer igjen. 404 og `module_versioning_not_active` betyr at svar per kurs ikke gjelder her. Da gir den ferske lesingen den
// gamle dialogen.
const PENDING_ANSWERS_STALE = new Set([
  "pending_versions_changed",
  "affected_courses_changed",
  "course_version_required",
  "course_version_not_owner",
  "major_email_confirm_required",
  "module_versioning_not_active",
]);

function pendingAnswersAreStale(err) {
  const status = apiErrorStatus(err);
  return status === 404 || status === 422 || PENDING_ANSWERS_STALE.has(apiErrorCode(err));
}

async function commitPendingPublish(supersedesEarlierPasses) {
  const target = pendingPublishTarget;
  if (!target) return;
  const dialog = document.getElementById("pendingPublishDialog");
  const buttons = pendingPublishButtons();
  // #934 skive 4b: over 200 mottakere uten det ekstra «ja»: dialogen står, og ingenting publiseres.
  const versionAnswer = target.asksVersion
    ? courseVersionAnswer(document.getElementById("pendingPublishVersion"), "pendingCourseVersion", target.course)
    : undefined;
  if (target.asksVersion && !versionAnswer) return;
  // #934 skive 5b: det samme per kurs. Uten berørte kurs er det ingenting å lese, og settet er tomt.
  const courseAnswers = target.versioned ? (target.affected ? target.affected.read() : { expectedCourseIds: [] }) : null;
  if (target.versioned && !courseAnswers) return;
  for (const button of [buttons.confirm, buttons.keep, buttons.supersede]) button.disabled = true;
  try {
    const result = await runWithWorkDialog(t("adminContent.work.publishing"), () => apiFetch(`/api/admin/content/courses/${encodeURIComponent(target.courseId)}/${target.versioned ? "publish-pending-versioned" : "publish-pending"}`, getHeaders, {
      method: "POST",
      body: JSON.stringify(target.versioned ? { versionIds: target.versionIds, ...courseAnswers } : {
        versionIds: target.versionIds,
        ...(supersedesEarlierPasses === undefined ? {} : { supersedesEarlierPasses }),
        // #934 skive 3: svaret sendes bare når spørsmålet ble stilt; ellers bestemmer tjeneren (mindre).
        ...versionRequestBody(versionAnswer, "courseVersion"),
      }),
    }));
    pendingPublishTarget = null;
    dialog?.close();
    showToast(tf("adminContent.courses.pendingPublish.published", { count: result?.publishedItems?.length ?? 0 }), "success");
    await refreshCourseView(target.courseId);
  } catch (err) {
    if (target.versioned) {
      if (pendingAnswersAreStale(err)) {
        showToast(t("adminContent.courses.pendingPublish.changed"), "warning");
        await openPendingPublishDialog(target.courseId, { changed: true });
        return;
      }
      apiErrorToast(err);
      for (const button of [buttons.confirm, buttons.keep, buttons.supersede]) button.disabled = false;
      return;
    }
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
// #934 skive 3: mindre eller hovedversjon
// ---------------------------------------------------------------------------
//
// Produkteier 2026-11-01 (doc/DESIGN_934.md): når innholdet i et publisert kurs endres, velger
// forfatteren mindre versjon (rettelser — kursbevisene gjelder som før) eller hovedversjon (nytt innhold
// deltakerne må ta). Standard er mindre; hovedversjon krever et bevisst klikk. Har ingen kursbevis for
// kursets nåværende hovedversjon, stilles ikke spørsmålet. Tjeneren eier reglene (og gjør en hovedversjon
// uten kursbevis til mindre); dialogen viser konsekvensen.

function courseVersionChipHtml(course) {
  const label = courseVersionLabel(course);
  return label ? ` <span class="status-chip course-version-chip" title="${escapeHtml(t("courses.version.chipTitle"))}">${escapeHtml(label)}</span>` : "";
}

/** Kursets innhold er rekkefølgen av moduler og seksjoner (diskusjonsbryteren er ikke innhold). */
function courseItemsKey(list) {
  return (list ?? []).map((item) => `${item.type}:${item.refId}`).join("|");
}

/** Hva lagringen endrer: lagt til, tatt ut, og flyttet (det som må flyttes for å gå fra før til nå). */
function courseItemChanges(beforeKey, afterList) {
  const afterKey = courseItemsKey(afterList);
  const before = beforeKey ? beforeKey.split("|") : [];
  const after = afterKey ? afterKey.split("|") : [];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const a = before.filter((key) => afterSet.has(key));
  const b = after.filter((key) => beforeSet.has(key));
  // Lengste felles delsekvens: det som står i samme innbyrdes rekkefølge. Resten er flyttet.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      lcs[i][j] = a[i - 1] === b[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }
  return {
    added: after.filter((key) => !beforeSet.has(key)).length,
    removed: before.filter((key) => !afterSet.has(key)).length,
    moved: a.length - lcs[a.length][b.length],
  };
}

/**
 * Spør forfatteren før et publisert kurs med kursbevis lagres med endret innhold.
 * Gir svaret (`{ version: "major" | "minor", confirmEmailRecipients? }`, se `courseVersionAnswer`), eller null når
 * forfatteren avbryter (da lagres ingenting).
 *
 * #1140 etappe 2: «Publiser utkastet» bruker den samme dialogen, med knappen «Publiser som {x.y}» (`saveKey`).
 */
function askCourseVersion(course, changes, { saveKey = "courses.version.save" } = {}) {
  const dialog = document.getElementById("courseVersionDialog");
  const host = document.getElementById("courseVersionChoiceHost");
  const saveBtn = document.getElementById("courseVersionSaveBtn");
  const cancelBtn = document.getElementById("courseVersionCancelBtn");
  if (!dialog || !host || !saveBtn || !cancelBtn || typeof dialog.showModal !== "function") return Promise.resolve({ version: "minor" });

  const parts = [];
  if (changes.added > 0) parts.push(tf("courses.version.added", { n: changes.added }));
  if (changes.removed > 0) parts.push(tf("courses.version.removed", { n: changes.removed }));
  if (changes.moved > 0) parts.push(tf("courses.version.moved", { n: changes.moved }));
  document.getElementById("courseVersionTitle").textContent = t("courses.version.dialogTitle");
  document.getElementById("courseVersionText").textContent = [
    tf("courses.version.intro", { title: localizedText(course.title) || course.id, version: courseVersionLabel(course).slice(1) }),
    courseVersionHoldersText(course),
    parts.length > 0 ? tf("courses.version.changes", { list: parts.join(", ") }) : "",
  ].filter(Boolean).join(" ");
  cancelBtn.textContent = t("courses.version.cancel");
  const minor = Number.isInteger(course.versionMinor) ? course.versionMinor : 0;
  mountCourseVersionChoice(host, "courseVersionChoice", course, (choice) => {
    saveBtn.textContent = tf(saveKey, { next: choice === "major" ? `${course.versionMajor + 1}.0` : `${course.versionMajor}.${minor + 1}` });
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      saveBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onSave = () => {
      // #934 skive 4b: over 200 mottakere uten det ekstra «ja»: dialogen står, og ingenting lagres.
      const answer = courseVersionAnswer(host, "courseVersionChoice", course);
      if (answer) finish(answer);
    };
    const onCancel = () => finish(null);
    // Esc lukker dialogen: det er et nei, ikke et «mindre».
    const onClose = () => finish(null);
    saveBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    host.querySelector("input[value='minor']")?.focus();
  });
}

// ---------------------------------------------------------------------------
// ── LIST VIEW ─────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

// #1046: lista er den felles listesida (list-page.js). Her ligger bare oppskriften for kurs.
let listPage = null;

/** Temaene kursene i lista har, én gang hver, alfabetisk på leserens språk. */
function courseThemesInList(courses) {
  const seen = new Map();
  for (const course of courses) {
    for (const theme of course.themes ?? []) if (theme?.id && !seen.has(theme.id)) seen.set(theme.id, { id: theme.id, name: theme.name ?? theme.id });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, currentLocale, { numeric: true, sensitivity: "base" }));
}

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
      courseFilterLabel: t("courses.themeFilter.label"), courseFilterAll: t("courses.themeFilter.all"), courseFilterNone: t("courses.themeFilter.none"),
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
    // 2.102.0: filter på tema, med samme velger som kursfilteret på Moduler og Seksjoner.
    courseFilter: { coursesOf: (c) => (c.themes ?? []).map((theme) => ({ id: theme.id, title: theme.name })) },
    // 2.126.0: etter tema eller alfabetisk, som «Mine kurs» (produkteier 2026-11-01). Temaene står
    // alfabetisk på leserens språk; kurs uten tema samles sist.
    grouping: {
      groups: () => courseThemesInList(listPage?.items ?? []),
      groupsOf: (c) => c.themes ?? [],
      texts: () => ({
        label: t("courses.view.label"), byGroup: t("courses.view.byTheme"), alphabetical: t("courses.view.alphabetical"),
        other: t("courses.view.noTheme"),
        count: (n) => (n === 1 ? t("courses.view.countOne") : tf("courses.view.countMany", { n })),
      }),
    },
    columns: [
      // #1094: plasseringen i «Mine kurs» som merke ved navnet — forfatteren slipper å åpne hvert kurs
      // for å se den. Et merke, ikke en kolonne: lista skal ikke bli bredere enn ramma (#1084).
      { key: "title", label: t("ui.name"), className: "col-title", sortValue: (c) => courseRowModel(c).title, render: (c, { view }) => escapeHtml(courseRowModel(c).title)
        + (Number.isInteger(c.sortOrder) ? ` <span class="status-chip course-placement-chip" title="${escapeHtml(t("courses.sortOrder"))}">${escapeHtml(tf("courses.list.placement", { n: c.sortOrder }))}</span>` : "")
        // Alfabetisk står temaene under navnet; etter tema sier overskriften det.
        + (view === "alphabetical" && (c.themes ?? []).length > 0 ? `<span class="list-group-themes">${escapeHtml(c.themes.map((theme) => theme.name).join(" · "))}</span>` : "") },
      // #934 skive 3: versjonen ved statusen («v3.2») — et merke, ikke en kolonne (#1084).
      { key: "status", label: t("ui.status"), className: "col-status", render: (c) => lifecycleBadge(c, t) + courseVersionChipHtml(c) },
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
        : isLiveLifecycle(lifecycle)
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
// Pakka bygges på tjeneren og tar noen sekunder for et stort kurs; knappen viser at den jobber
// (produkteier 2026-11-01: «det går 2–3 sekunder før noe skjer»).
// Etter tema står et kurs med flere tema én gang per tema, med hver sin knapp. Låsen gjelder kurset,
// ikke knappen: alle kursets eksportknapper er opptatt til fila er lastet ned.
const exportingCourses = new Set();
function exportCoursePackage(courseId, courseTitle, btn) {
  if (exportingCourses.has(courseId)) return Promise.resolve();
  exportingCourses.add(courseId);
  const siblings = [...document.querySelectorAll(`[data-action="export"][data-course-id="${CSS.escape(courseId)}"]`)].filter((b) => b !== btn);
  for (const b of siblings) { b.disabled = true; b.setAttribute("aria-busy", "true"); }
  return runWithBusyButton(btn, () => downloadCoursePackage(courseId, courseTitle)).finally(() => {
    exportingCourses.delete(courseId);
    for (const b of siblings) { b.disabled = false; b.removeAttribute("aria-busy"); }
  });
}

async function downloadCoursePackage(courseId, courseTitle) {
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
    showToast(tf("courses.exported", { title: courseTitle }));
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
        importCueDetail(updated),
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
    // #1119: tester der svaret kan røpe seg følger med i samme melding — det er bare plass til én.
    const cueDetail = importCueDetail(result);
    if (result.heldBackByTranslationGate) {
      queueToast(tf("adminContent.courses.importedHeldBack", { count }), "warning", cueDetail);
    } else {
      queueToast(tf("adminContent.courses.imported", { count }), cueDetail ? "warning" : "success", cueDetail);
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

// #1119: «3 tester har spørsmål som … — Tittel: Spørsmål 2 … Tittel: …», eller "" når ingen har funn.
// #1122: og moduler med kriterier som ikke beskriver skalaen, i samme detalj.
// #1128: og seksjoner med bilder som bare har en tittel som alt-tekst.
function importCueDetail(result) {
  const titleOf = (title) => (typeof title === "string" ? title : pickLocalizedText(title, currentLocale));
  const cue = describePackageCueWarnings(result?.cueWarnings, t, tf, titleOf);
  const rubric = describePackageCueWarnings(result?.rubricWarnings, t, tf, titleOf, describeRubricWarnings);
  const alt = describePackageCueWarnings(result?.altWarnings, t, tf, titleOf, describeAltWarnings);
  return [
    cue.length > 0 ? `${tf("mcqCue.importedCourse", { count: cue.length })} ${cue.join(" ")}` : "",
    rubric.length > 0 ? `${tf("rubricCheck.importedCourse", { count: rubric.length })} ${rubric.join(" ")}` : "",
    alt.length > 0 ? `${tf("altCheck.importedCourse", { count: alt.length })} ${alt.join(" ")}` : "",
  ].filter(Boolean).join(" ");
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
    exportCoursePackage(btn.dataset.courseId, btn.dataset.courseTitle, btn);
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

// ---------------------------------------------------------------------------
// #1150 skive 2b: «Arkiver» og «Gjenopprett» (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Forløpet for forfatteren» og
// «Gjenoppretting»). Arkivering er alternativet til sletting når kurset har fullføringer som skal bevares (#660).
// ---------------------------------------------------------------------------
//
// Fra 2.159.0 tar arkiveringen med seg modulene og seksjonene som bare brukes i kurset, og gjenopprettingen setter dem tilbake.
// Dialogen viser forhåndsvisningen, og bekreftelsen sender det forfatteren så (`expected`). Tjeneren regner på nytt under
// innholdslåsen; er noe endret, svarer den 409 og har ikke skrevet noe, og dialogen tegnes på nytt med ferske tall. Samme form
// som «Publiser nye versjoner» over. Kalt fra kurslista og fra handlingsraden i det åpnede kurset (`handleListTableClick`).
//
// Under utrullingen kan en ny klient møte en gammel tjener: da svarer forhåndsvisningen 404, og klienten gjør det den gjorde før.

const courseApiPath = (courseId, suffix) => `/api/admin/content/courses/${encodeURIComponent(courseId)}/${suffix}`;

/** Ett element i en av dialogenes lister: typemerke, tittel, merker og en forklaring på egen linje. */
function courseLifecycleItemHtml(item, { chips = "", note = "" } = {}) {
  const title = escapeHtml(localizedText(item.title) || item.id);
  const badge = `<span class="item-type-badge">${escapeHtml(cascadeItemTypeLabel(item.type))}</span>`;
  const noteHtml = note ? `<span class="course-lifecycle-note">${escapeHtml(note)}</span>` : "";
  return `<li class="cascade-publish-item" data-item-id="${escapeHtml(item.id)}">${badge} <span class="cascade-publish-item-title">${title}</span>${chips}${noteHtml}</li>`;
}

/** Ett avsnitt: overskrift, eventuelt en liste, eventuelt en forklaring. `part` er kroken testene leser. */
function courseLifecyclePartHtml(part, heading, { listHtml = "", text = "" } = {}) {
  return `<section data-lifecycle-part="${part}">
    <h3 class="cascade-delete-heading">${escapeHtml(heading)}</h3>
    ${listHtml ? `<ul class="cascade-publish-list">${listHtml}</ul>` : ""}
    ${text ? `<p class="dialog-text">${escapeHtml(text)}</p>` : ""}
  </section>`;
}

function renderCourseArchivePreview(preview, { changedText = "" } = {}) {
  const follows = Array.isArray(preview?.follows) ? preview.follows : [];
  const stays = Array.isArray(preview?.stays) ? preview.stays : [];
  const inProgress = Number(preview?.inProgressCount) || 0;
  const pendingReview = Number(preview?.pendingReviewCount) || 0;
  const completedWithout = Number(preview?.completedWithoutCertificateCount) || 0;
  const parts = [];
  if (changedText) parts.push(`<p class="course-version-notice" role="alert" data-lifecycle-changed>${escapeHtml(changedText)}</p>`);
  if (follows.length > 0) {
    parts.push(courseLifecyclePartHtml("follows", tf("courses.archiveDialog.follows", { count: follows.length }), {
      listHtml: follows.map((item) => courseLifecycleItemHtml(item, {
        // Elementer forfatteren ikke eier, følger med likevel (produkteier 13.11.2026). Merket sier det.
        chips: item.owned === false ? ` <span class="status-chip" data-not-owned>${escapeHtml(t("courses.archiveDialog.notOwned"))}</span>` : "",
      })).join(""),
    }));
  } else {
    parts.push(courseLifecyclePartHtml("follows", tf("courses.archiveDialog.follows", { count: 0 }), { text: t("courses.archiveDialog.followsNone") }));
  }
  if (stays.length > 0) {
    parts.push(courseLifecyclePartHtml("stays", tf("courses.archiveDialog.stays", { count: stays.length }), {
      listHtml: stays.map((item) => {
        const courses = (Array.isArray(item.usedBy) ? item.usedBy : []).map((use) =>
          tf(use?.via === "draft" ? "courses.archiveDialog.usedInDraft" : "courses.archiveDialog.usedInCourse", { title: localizedText(use?.title) || use?.courseId || "" }));
        return courseLifecycleItemHtml(item, { note: courses.length > 0 ? tf("courses.archiveDialog.usedBy", { courses: courses.join(", ") }) : "" });
      }).join(""),
    }));
  }
  if (inProgress > 0) {
    parts.push(courseLifecyclePartHtml("inProgress", tf("courses.archiveDialog.inProgress", { count: inProgress }), { text: t("courses.archiveDialog.inProgressBody") }));
  }
  if (pendingReview > 0) {
    parts.push(courseLifecyclePartHtml("pendingReview", tf("courses.archiveDialog.pendingReview", { count: pendingReview }), { text: t("courses.archiveDialog.pendingReviewBody") }));
  }
  if (completedWithout > 0) {
    parts.push(courseLifecyclePartHtml("completedWithoutCertificate", tf("courses.archiveDialog.completedWithoutCertificate", { count: completedWithout }), {
      text: preview?.published === true ? t("courses.archiveDialog.completedIssued") : t("courses.archiveDialog.completedNotIssued"),
    }));
  }
  if (preview?.hasDraft === true) {
    parts.push(`<p class="dialog-text" data-lifecycle-part="draft">${escapeHtml(t("courses.archiveDialog.draftDiscarded"))}</p>`);
  }
  return parts.join("");
}

let pendingCourseArchive = null; // { courseId, courseTitle, triggerButton, expected }

/**
 * 404 fra en forhåndsvisning betyr «tjeneren har ikke ruta» (eldre enn 2.159.0) — men ikke når koden er `course_not_found`: da
 * har tjeneren ruta, og kurset finnes ikke (slettet imens). Det er en feil som skal vises, ikke en grunn til den gamle veien.
 */
function previewRouteMissing(err) {
  return apiErrorStatus(err) === 404 && apiErrorCode(err) !== "course_not_found";
}

// QA-porten 2b: én åpning av dialogen om gangen. Hver henting får et nummer; et svar som kommer etter en nyere henting, eller
// etter at dialogen er lukket (lukkingen teller opp), gjelder ikke lenger og vises ikke. Uten dette kunne to klikk mens
// forhåndsvisningen lastet vise kurs B og så kurs A, og «Arkiver kurset» arkiverte A; og Esc mens dialogen hentet på nytt
// etter 409 ble overstyrt av at dialogen åpnet seg igjen.
let courseArchiveSeq = 0;

/**
 * Henter forhåndsvisningen og viser dialogen. Svarer `"legacy"` når tjeneren ikke har forhåndsvisningen (404), `"done"` når
 * kurset allerede er arkivert eller dialogen står, `"stale"` når svaret ikke gjelder lenger, og `"failed"` ellers.
 * `changedText`: teksten etter en 409.
 */
async function openCourseArchiveDialog(courseId, courseTitle, triggerButton, { changedText = "" } = {}) {
  const dialog = document.getElementById("courseArchiveDialog");
  if (!dialog || typeof dialog.showModal !== "function") return "legacy";
  // Lukkes dialogen mens hentingen pågår (Esc under ny henting etter 409), teller lukkingen opp, og svaret er gammelt.
  const seq = ++courseArchiveSeq;
  const stale = () => seq !== courseArchiveSeq;
  let preview;
  try {
    preview = await apiFetch(courseApiPath(courseId, "archive-preview"), getHeaders);
  } catch (err) {
    if (stale()) return "stale";
    if (previewRouteMissing(err)) {
      if (dialog.open) dialog.close();
      return "legacy";
    }
    apiErrorToast(err);
    // Står dialogen (en ny lesing etter 409 feilet), kan forfatteren prøve igjen.
    const confirmBtn = document.getElementById("courseArchiveConfirmBtn");
    if (confirmBtn) confirmBtn.disabled = false;
    return "failed";
  }
  if (stale()) return "stale";
  if (preview?.archived === true) {
    // Arkivert av noen andre mens forfatteren så på lista.
    if (dialog.open) dialog.close();
    showToast(t("errors.api.course_already_archived"), "warning");
    await refreshCourseView(courseId);
    return "done";
  }
  const title = localizedText(preview?.courseTitle) || courseTitle || courseId;
  const follows = Array.isArray(preview?.follows) ? preview.follows : [];
  pendingCourseArchive = {
    courseId,
    courseTitle: title,
    triggerButton,
    // Nøyaktig det dialogen viser. Tjeneren sammenligner med sin egen utregning under låsen.
    expected: {
      follows: {
        moduleIds: follows.filter((item) => item.type === "MODULE").map((item) => item.id),
        sectionIds: follows.filter((item) => item.type === "SECTION").map((item) => item.id),
      },
      inProgressCount: Number(preview?.inProgressCount) || 0,
    },
  };
  document.getElementById("courseArchiveTitle").textContent = tf("courses.archiveDialog.title", { title });
  document.getElementById("courseArchiveText").textContent = t("courses.archiveDialog.intro");
  document.getElementById("courseArchiveBody").innerHTML = renderCourseArchivePreview(preview, { changedText });
  const confirmBtn = document.getElementById("courseArchiveConfirmBtn");
  confirmBtn.textContent = t("courses.archiveDialog.confirm");
  confirmBtn.disabled = false;
  document.getElementById("courseArchiveCancelBtn").textContent = t("ui.action.cancel");
  if (!dialog.open) dialog.showModal();
  return "done";
}

async function archiveCourseInAdmin(courseId, courseTitle, triggerButton = null) {
  if (triggerButton) triggerButton.disabled = true;
  const outcome = await openCourseArchiveDialog(courseId, courseTitle, triggerButton);
  // Et svar som ikke gjelder lenger: knappen virker igjen, med mindre den hører til dialogen som står nå.
  if ((outcome === "failed" || outcome === "stale") && triggerButton && pendingCourseArchive?.triggerButton !== triggerButton) triggerButton.disabled = false;
  if (outcome === "legacy") await archiveCourseWithoutPreview(courseId, courseTitle, triggerButton);
}

/** Etter at en dialog er lukket: knappen som åpnet den, virker igjen og får fokuset tilbake (den var slått av da dialogen åpnet). */
function returnFocusTo(triggerButton) {
  if (!triggerButton) return;
  triggerButton.disabled = false;
  if (triggerButton.isConnected) triggerButton.focus();
}

// En tjener uten forhåndsvisning (eldre enn 2.159.0): den enkle bekreftelsen og arkiveringen uten kropp, som før.
async function archiveCourseWithoutPreview(courseId, courseTitle, triggerButton) {
  if (!window.confirm(tf("courses.archiveDialog.legacyConfirm", { title: courseTitle }))) {
    if (triggerButton) triggerButton.disabled = false;
    return;
  }
  try {
    await apiFetch(courseApiPath(courseId, "archive"), getHeaders, { method: "POST" });
    showToast(t("courses.archived"), "success");
    await refreshCourseView(courseId);
  } catch (err) {
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
  }
}

/** «2 moduler og 1 seksjon», med entall og flertall, og uten den delen som er 0. Minst ett av tallene er over 0. */
function archivedItemsText(modules, sections) {
  const count = (n, kind) => tf(`courses.archiveDialog.${kind}${n === 1 ? "One" : "Many"}`, { n });
  if (modules > 0 && sections > 0) return tf("courses.archiveDialog.both", { modules: count(modules, "modules"), sections: count(sections, "sections") });
  return modules > 0 ? count(modules, "modules") : count(sections, "sections");
}

async function confirmCourseArchive() {
  const target = pendingCourseArchive;
  if (!target) return;
  const dialog = document.getElementById("courseArchiveDialog");
  const confirmBtn = document.getElementById("courseArchiveConfirmBtn");
  confirmBtn.disabled = true;
  try {
    const result = await apiFetch(courseApiPath(target.courseId, "archive"), getHeaders, {
      method: "POST",
      body: JSON.stringify({ expected: target.expected }),
    });
    pendingCourseArchive = null;
    dialog?.close();
    const modules = result?.followed?.moduleIds?.length ?? 0;
    const sections = result?.followed?.sectionIds?.length ?? 0;
    const certificates = Number(result?.certificatesIssued) || 0;
    showToast(
      modules + sections > 0 ? tf("courses.archiveDialog.done", { items: archivedItemsText(modules, sections) }) : t("courses.archived"),
      "success",
      certificates > 0 ? tf("courses.archiveDialog.certificatesIssued", { count: certificates }) : "",
    );
    await refreshCourseView(target.courseId);
  } catch (err) {
    const code = apiErrorCode(err);
    if (code === "course_archive_preview_changed") {
      // Ingenting er skrevet. Dialogen viser det som gjelder nå, og forfatteren bekrefter på nytt.
      await openCourseArchiveDialog(target.courseId, target.courseTitle, target.triggerButton, { changedText: apiErrorText(err) });
      return;
    }
    if (code === "course_already_archived") {
      pendingCourseArchive = null;
      dialog?.close();
      showToast(apiErrorText(err), "warning");
      await refreshCourseView(target.courseId);
      return;
    }
    apiErrorToast(err);
    confirmBtn.disabled = false;
  }
}

function initCourseArchiveDialog() {
  const dialog = document.getElementById("courseArchiveDialog");
  document.getElementById("courseArchiveConfirmBtn")?.addEventListener("click", () => { confirmCourseArchive(); });
  document.getElementById("courseArchiveCancelBtn")?.addEventListener("click", () => dialog?.close());
  // Avbryt, Esc og lukking etter arkiveringen ender her. En henting som pågår, gjelder ikke lenger (nummeret telles opp), og
  // knappen som åpnet dialogen virker igjen og får fokuset (står kurset der fortsatt).
  dialog?.addEventListener("close", () => {
    courseArchiveSeq += 1;
    const trigger = pendingCourseArchive?.triggerButton ?? null;
    pendingCourseArchive = null;
    returnFocusTo(trigger);
  });
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

// #673: gjenopprett et arkivert kurs. #1150 skive 2b: med en dialog som viser hva som kommer tilbake, og hva som blir arkivert.

/** Hva som skjer med et element som kommer tilbake (forhåndsvisningen og svaret har samme form). */
function courseRestoreReturnNote(item) {
  if (item?.asDraft === "was_unpublished") return t("courses.restoreDialog.wasUnpublished");
  if (item?.asDraft) return t(item.type === "SECTION" ? "courses.restoreDialog.versionMissing.section" : "courses.restoreDialog.versionMissing.module");
  return item?.versionLabel ? tf("courses.restoreDialog.publishedVersion", { version: item.versionLabel }) : t("courses.restoreDialog.published");
}

function courseRestoreStayNote(item) {
  return item?.reason === "archived_with_other_course"
    ? t("courses.restoreDialog.archivedWithOtherCourse")
    : t("courses.restoreDialog.archivedSeparately");
}

function renderCourseRestorePreview(preview) {
  const returns = Array.isArray(preview?.returns) ? preview.returns : [];
  const staysArchived = Array.isArray(preview?.staysArchived) ? preview.staysArchived : [];
  const parts = [];
  parts.push(returns.length > 0
    ? courseLifecyclePartHtml("returns", tf("courses.restoreDialog.returns", { count: returns.length }), {
      listHtml: returns.map((item) => courseLifecycleItemHtml(item, {
        chips: item.versionLabel && !item.asDraft ? ` <span class="status-chip" data-version-label>${escapeHtml(`v${item.versionLabel}`)}</span>` : "",
        note: courseRestoreReturnNote(item),
      })).join(""),
    })
    : courseLifecyclePartHtml("returns", tf("courses.restoreDialog.returns", { count: 0 }), { text: t("courses.restoreDialog.returnsNone") }));
  if (staysArchived.length > 0) {
    parts.push(courseLifecyclePartHtml("staysArchived", tf("courses.restoreDialog.staysArchived", { count: staysArchived.length }), {
      listHtml: staysArchived.map((item) => courseLifecycleItemHtml(item, { note: courseRestoreStayNote(item) })).join(""),
      text: t("courses.restoreDialog.staysArchivedBody"),
    }));
  }
  return parts.join("");
}

/** Meldingen etter gjenopprettingen, fra SVARET: forhåndsvisningen kan ikke nummerere eldre modulhistorikk, gjenopprettingen kan. */
function courseRestoreResultDetail(result) {
  const returns = Array.isArray(result?.returns) ? result.returns : [];
  const staysArchived = Array.isArray(result?.staysArchived) ? result.staysArchived : [];
  const name = (item) => localizedText(item?.title) || item?.id || "";
  const published = returns.filter((item) => !item.asDraft).map((item) => (item.versionLabel ? `${name(item)} (${item.versionLabel})` : name(item)));
  const asDraft = returns.filter((item) => item.asDraft).map(name);
  return [
    published.length > 0 ? tf("courses.restoreDialog.doneReturned", { items: published.join(", ") }) : "",
    asDraft.length > 0 ? tf("courses.restoreDialog.doneAsDraft", { items: asDraft.join(", ") }) : "",
    staysArchived.length > 0 ? tf("courses.restoreDialog.doneStays", { items: staysArchived.map(name).join(", ") }) : "",
  ].filter(Boolean).join(" ");
}

let pendingCourseRestore = null; // { courseId, courseTitle, triggerButton }
// Samme løpenummer som arkiveringen (`courseArchiveSeq`): bare den siste hentingen vises.
let courseRestoreSeq = 0;

async function restoreCourseInAdmin(courseId, courseTitle, triggerButton = null) {
  if (triggerButton) triggerButton.disabled = true;
  const dialog = document.getElementById("courseRestoreDialog");
  if (!dialog || typeof dialog.showModal !== "function") {
    await restoreCourseWithoutPreview(courseId, courseTitle, triggerButton);
    return;
  }
  const seq = ++courseRestoreSeq;
  // Et svar som ikke gjelder lenger: knappen virker igjen, med mindre den hører til dialogen som står nå.
  const dropStale = () => {
    if (seq === courseRestoreSeq) return false;
    if (triggerButton && pendingCourseRestore?.triggerButton !== triggerButton) triggerButton.disabled = false;
    return true;
  };
  let preview;
  try {
    preview = await apiFetch(courseApiPath(courseId, "restore-preview"), getHeaders);
  } catch (err) {
    if (dropStale()) return;
    // En tjener uten forhåndsvisning (eldre enn 2.159.0): som før, uten spørsmål.
    if (previewRouteMissing(err)) {
      await restoreCourseWithoutPreview(courseId, courseTitle, triggerButton);
      return;
    }
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
    return;
  }
  if (dropStale()) return;
  if (preview?.archived === false) {
    // Gjenopprettet av noen andre mens forfatteren så på lista.
    showToast(t("errors.api.course_not_archived"), "warning");
    await refreshCourseView(courseId);
    return;
  }
  const title = localizedText(preview?.courseTitle) || courseTitle || courseId;
  pendingCourseRestore = { courseId, courseTitle: title, triggerButton };
  document.getElementById("courseRestoreTitle").textContent = tf("courses.restoreDialog.title", { title });
  document.getElementById("courseRestoreText").textContent = t("courses.restoreDialog.intro");
  document.getElementById("courseRestoreBody").innerHTML = renderCourseRestorePreview(preview);
  const confirmBtn = document.getElementById("courseRestoreConfirmBtn");
  confirmBtn.textContent = t("courses.restoreDialog.confirm");
  confirmBtn.disabled = false;
  document.getElementById("courseRestoreCancelBtn").textContent = t("ui.action.cancel");
  if (!dialog.open) dialog.showModal();
}

async function restoreCourseWithoutPreview(courseId, courseTitle, triggerButton) {
  try {
    await apiFetch(courseApiPath(courseId, "restore"), getHeaders, { method: "POST" });
    showToast(tf("courses.restored", { title: courseTitle }), "success");
    await refreshCourseView(courseId);
  } catch (err) {
    apiErrorToast(err);
    if (triggerButton) triggerButton.disabled = false;
  }
}

async function confirmCourseRestore() {
  const target = pendingCourseRestore;
  if (!target) return;
  const dialog = document.getElementById("courseRestoreDialog");
  const confirmBtn = document.getElementById("courseRestoreConfirmBtn");
  confirmBtn.disabled = true;
  try {
    const result = await apiFetch(courseApiPath(target.courseId, "restore"), getHeaders, { method: "POST" });
    pendingCourseRestore = null;
    dialog?.close();
    const detail = courseRestoreResultDetail(result);
    const leftovers = (result?.returns ?? []).some((item) => item?.asDraft) || (result?.staysArchived ?? []).length > 0;
    showToast(tf("courses.restoreDialog.done", { title: target.courseTitle }), leftovers ? "warning" : "success", detail);
    await refreshCourseView(target.courseId);
  } catch (err) {
    if (apiErrorCode(err) === "course_not_archived") {
      pendingCourseRestore = null;
      dialog?.close();
      showToast(apiErrorText(err), "warning");
      await refreshCourseView(target.courseId);
      return;
    }
    apiErrorToast(err);
    confirmBtn.disabled = false;
  }
}

function initCourseRestoreDialog() {
  const dialog = document.getElementById("courseRestoreDialog");
  document.getElementById("courseRestoreConfirmBtn")?.addEventListener("click", () => { confirmCourseRestore(); });
  document.getElementById("courseRestoreCancelBtn")?.addEventListener("click", () => dialog?.close());
  // Ingen ny henting mens denne dialogen står (den har ingen 409-runde), så lukkingen trenger ikke telle opp løpenummeret.
  dialog?.addEventListener("close", () => {
    const trigger = pendingCourseRestore?.triggerButton ?? null;
    pendingCourseRestore = null;
    returnFocusTo(trigger);
  });
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
    if (pendingCascadeDelete && pendingCascadeDelete.courseId === courseId) {
      pendingCascadeDelete.expected = {
        expectedDeletedModuleIds: (preview?.deletableModules ?? []).map((entry) => entry.id),
        expectedDeletedSectionIds: (preview?.deletableSections ?? []).map((entry) => entry.id),
      };
    }
  } catch (err) {
    if (textEl) textEl.textContent = apiErrorText(err);
  }
}

function initCascadeDeleteDialog() {
  const confirmBtn = document.getElementById("cascadeDeleteConfirmBtn");
  const cancelBtn = document.getElementById("cascadeDeleteCancelBtn");
  confirmBtn?.addEventListener("click", async () => {
    if (!pendingCascadeDelete) return;
    const { courseId, expected } = pendingCascadeDelete;
    confirmBtn.disabled = true;
    try {
      // #934 skive 4a: det forhåndsvisningen sa ville bli slettet. Har det endret seg (en delt seksjon er tatt ut
      // av det andre kurset), svarer serveren 409 og sletter ingenting.
      const summary = await apiFetch(
        `/api/admin/content/courses/${encodeURIComponent(courseId)}/cascade-delete`,
        getHeaders,
        { method: "POST", ...(expected ? { body: JSON.stringify(expected) } : {}) },
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

  // Det søket i kursbyggeren kan tilby. Feiler hentingen ved åpning, står lista tom.
  try { allLibraryModules = await loadPickerModules(); } catch { allLibraryModules = []; }
  try { allLibrarySections = await loadPickerSections(); } catch { allLibrarySections = []; }
  bindPickerRefresh();

  // Init course item list from the mixed CourseItem sequence (#490).
  //
  // ⚠️ #934 skive 4a: INGEN RESERVELISTE. Feilet lastingen, brukte skjemaet en gammel liste med bare modulene
  // (`course.modules`). Skjemaet sender hele lista ved hver lagring, så en lagring tok da bort alle seksjonene
  // fra kurset. Nå står lista tom, skjemaet sier fra, og `saveCourse` nekter å lagre.
  courseItemsLoadFailed = false;
  courseDraft = null;
  courseDraftLoadError = null;
  publishedCourseItemsKey = null;
  let draft = null;
  if (course) {
    // Lista slik den er publisert. Uten utkast er det den skjemaet viser; med utkast sammenligner «Publiser utkastet» med den.
    let publishedItems = null;
    try {
      const itemsData = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/items`, getHeaders);
      publishedItems = (itemsData.items ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(it => ({ type: it.type, refId: it.type === "MODULE" ? it.moduleId : it.sectionId, title: localizedText(it.title) || it.moduleId || it.sectionId, discussionsEnabled: it.discussionsEnabled !== false }));
    } catch {
      publishedItems = null;
    }
    // #1140 etappe 2 (skive 2c): har kurset et utkast, viser skjemaet utkastet (feltene og lista), også når kurset er
    // avpublisert, og «Ulagrede endringer» måles mot det.
    if (courseHasDraft(course)) {
      try {
        draft = (await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/draft`, getHeaders))?.draft ?? null;
      } catch (err) {
        if (apiErrorStatus(err) === 404) {
          // Publisert eller forkastet mellom kursdetaljen og denne lesingen: kurset har ikke noe utkast lenger.
          course = { ...course, hasDraft: false, lifecycle: lifecycleOf(course) === "published_with_draft" ? "published" : lifecycleOf(course) };
        } else {
          // Skjemaet viser da det publiserte, og lagring er stengt: en lagring ville gått forbi utkastet som ligger.
          courseDraftLoadError = apiErrorText(err);
          // En lagret rad som ikke kan leses, kan forkastes med id-en og telleren serveren sender med.
          const details = apiErrorBody(err)?.details;
          if (apiErrorCode(err) === "course_draft_unreadable" && typeof details?.draftId === "string" && Number.isInteger(details?.revision)) {
            courseDraft = { draftId: details.draftId, revision: details.revision, unreadable: true };
          }
        }
      }
    }
    if (draft) {
      courseDraft = { draftId: draft.id, revision: draft.revision, updatedByName: draft.updatedByName ?? null, updatedAt: draft.updatedAt ?? null };
      courseModules = [...(draft.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(courseDraftItemToFormItem);
      publishedCourseItemsKey = publishedItems ? courseItemsKey(publishedItems) : null;
    } else if (publishedItems) {
      courseModules = publishedItems;
    } else {
      courseModules = [];
      courseItemsLoadFailed = true;
    }
  } else {
    courseModules = [];
  }
  // #934 skive 3: innholdet slik det står nå — lagringen sammenligner med dette. #1140: med utkast er det utkastets liste.
  initialCourseItemsKey = courseItemsKey(courseModules);

  // Feltene kommer fra utkastet når det finnes (serveren har fylt inn det utkastet lot stå «som publisert»).
  const formSource = draft?.course ?? course;

  // Init locale values from existing course or empty
  const titleValues = parseLocalizedFieldValues(formSource?.title);
  const descriptionValues = parseLocalizedFieldValues(formSource?.description);
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

  const certLevel = formSource?.certificationLevel ?? "";
  const enrollmentPolicy = formSource?.enrollmentPolicy ?? "OPEN";
  // #495/T-QA-4: default på for nye kurs og når feltet mangler (eldre detaljer).
  const discussionsEnabled = formSource?.discussionsEnabled !== false;
  // 2.119.0: e-post til kursets eiere om nye spørsmål; på når feltet mangler.
  const discussionOwnerNotifications = formSource?.discussionOwnerNotifications !== false;
  // #1093: plassering i «Mine kurs»; tomt = alfabetisk.
  const sortOrder = Number.isInteger(formSource?.sortOrder) ? String(formSource.sortOrder) : "";
  const pageTitle = course ? (localizedText(course.title) || t("ui.kind.course")) : t("courses.newCourse");
  const showPublishButton = canPublishCourse({
    ...course,
    moduleCount: courseModules.filter(it => it.type === "MODULE").length,
  });

  pendingVersions = course ? await loadPendingVersions(courseId) : null;
  // 2.102.0: temaene kurset kan velge blant. Kom ikke lista, vises ikke valget — og da sendes
  // heller ingen themeIds ved lagring, så kursets temaer ikke viskes ut av en feil.
  const availableThemes = await loadAvailableThemes();
  const themeIds = Array.isArray(formSource?.themeIds) ? formSource.themeIds : [];

  courseDetail = { courseId: courseId ?? null, course, localeValues, certLevel, enrollmentPolicy, discussionsEnabled, discussionOwnerNotifications, sortOrder, availableThemes, themeIds };
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
  const { courseId, localeValues, certLevel, enrollmentPolicy, discussionsEnabled, discussionOwnerNotifications, sortOrder, availableThemes, themeIds } = courseDetail;
  // #1150 skive 2b: et arkivert kurs kan ikke lagres (elementlista avvises med `course_item_archived` når innholdet fulgte kurset
  // inn). Feltene, elementlista og innstillingene står sperret til kurset er gjenopprettet; eierpanelet lagrer for seg og er åpent.
  const lockOpen = courseIsArchived() ? `<fieldset class="course-archived-lock" disabled data-course-archived-lock>` : "";
  const lockClose = lockOpen ? "</fieldset>" : "";
  return `<div class="detail-layout">
    <div data-form-tab="rediger">${lockOpen}
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

        ${courseThemesFieldHtml(availableThemes, themeIds)}
      </div>

      <div class="detail-section">
        <h2 class="detail-section-title">${escapeHtml(t("courses.contentTitle"))}</h2>
        <div id="moduleListContainer"></div>
        <!-- #935: ÉN velger for begge typene. Kurset er én ordnet liste av moduler og seksjoner, og
             forfatteren skal ikke lære to mønstre for én handling. Lista åpner ved fokus, så den
             kan blas i som nedtrekket kunne, og søkes i som kombiboksen kunne. -->
        <!-- data-form-untracked: å SØKE er ikke en endring i kurset. Uten merket sto kurset som «Ulagrede
             endringer» etter ett tastetrykk i søket. Å legge til et element merker selv (renderModuleList). -->
        <div class="form-add-row">
          <div class="combobox-wrap" id="comboboxWrap" data-form-untracked>
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
    ${lockClose}
    </div>
    <!-- #1094 (QA): utenfor fanepanelene, så meldingen ses fra «Innstillinger» også — en ugyldig plassering
         bytter dit, og feil fra tjeneren kan komme mens forfatteren står der. -->
    <div id="formErrorBanner" hidden></div>
    <div data-form-tab="innstillinger" hidden>
      ${courseId ? `<div class="detail-section" id="ownerPanelHost" data-form-untracked></div>` : ""}
      ${lockOpen}<div class="detail-section">
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
            ${escapeHtml(t("courses.discussionsEnabled"))}
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:6px;">
            <input type="checkbox" id="discussionOwnerNotifications"${discussionOwnerNotifications ? " checked" : ""} />
            ${escapeHtml(t("courses.discussionOwnerNotifications"))}
          </label>
          <p class="small" style="margin: 4px 0 0">${escapeHtml(t("courses.discussionOwnerNotificationsHelp"))}</p>
        </div>
        <div class="form-field" style="margin-top: var(--space-2)">
          <label for="courseShareLink">${escapeHtml(t("courses.shareLink"))}</label>
          ${courseShareLinkHtml(courseDetail.course?.slug)}
        </div>
        ${courseId ? "" : `<p class="small" style="margin:var(--space-2) 0 0">${escapeHtml(t("courses.saveFirstOwners"))}</p>`}
      </div>${lockClose}
    </div>
    </div>`;
}

// 2.121.0: delingslenka til kurset. Den settes første gang kurset publiseres og endres ikke etterpå,
// så før det finnes det ingen lenke å vise — bare hvorfor.
function courseShareLink(slug) {
  return `${window.location.origin}/kurs/${slug}`;
}

function courseShareLinkHtml(slug) {
  if (!slug) return `<p class="small" id="courseShareLink" style="margin: 4px 0 0">${escapeHtml(t("courses.shareLinkPending"))}</p>`;
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="text" id="courseShareLink" readonly value="${escapeHtml(courseShareLink(slug))}" style="flex:1;min-width:16rem" />
      <button type="button" class="btn-secondary" id="courseShareLinkCopy" style="width:auto">${escapeHtml(t("courses.shareLinkCopy"))}</button>
    </div>
    <p class="small" style="margin: 4px 0 0">${escapeHtml(t("courses.shareLinkHelp"))}</p>`;
}

async function copyCourseShareLink() {
  const input = document.getElementById("courseShareLink");
  if (!(input instanceof HTMLInputElement)) return;
  try {
    await navigator.clipboard.writeText(input.value);
    showToast(t("courses.shareLinkCopied"), "success");
  } catch {
    // Uten tilgang til utklippstavla: marker lenka, så den kan kopieres for hånd.
    input.select();
  }
}

function bindCourseDetail() {
  const { courseId } = courseDetail;
  renderModuleList();
  showCourseItemsLoadError();
  initDetailEventListeners(courseId);
  // #787 slice 5: content-owner management for this course (a new course has no id yet).
  const ownerHost = document.getElementById("ownerPanelHost");
  if (ownerHost && courseId) {
    renderOwnerPanel({ container: ownerHost, contentType: "COURSE", contentId: courseId, getHeaders, t }).catch(() => {});
  }
}

// #934 skive 4a: feilet lastingen av elementlista, står meldingen i skjemaets feilbanner, og lagring er stengt.
// #1140 etappe 2: det samme når kurset har et utkast som ikke kom (eller ikke kan leses).
function showCourseItemsLoadError() {
  if (courseItemsLoadFailed) {
    showCourseFormError(`<div class="error-banner" data-course-items-load-error>${escapeHtml(t("courses.itemsLoadError"))}</div>`);
    return true;
  }
  if (courseDraftLoadError) {
    showCourseFormError(`<div class="error-banner" data-course-draft-load-error>${escapeHtml(courseDraftLoadError)}</div>`);
    return true;
  }
  return false;
}

/** Skjemaets feilbanner, med ferdig HTML. */
function showCourseFormError(html) {
  const errorBanner = document.getElementById("formErrorBanner");
  if (!errorBanner) return;
  errorBanner.innerHTML = html;
  errorBanner.hidden = false;
}

// ---------------------------------------------------------------------------
// Skjemasida for kurs (form-page.js). #1046 nivå to.
// ---------------------------------------------------------------------------

let courseDetail = null; // { courseId, course, localeValues, certLevel, enrollmentPolicy, discussionsEnabled }
let initialCourseItemsKey = ""; // #934 skive 3: kursets innhold da det ble lastet
// #934 skive 4a: elementlista kom ikke. Da kan skjemaet ikke lagres — det ville sendt en tom (eller gammel) liste.
let courseItemsLoadFailed = false;
let courseFormPage = null;
// #1140 etappe 2 (skive 2c): utkastet skjemaet lastet, `{ draftId, revision, updatedByName, updatedAt }`, eller null. Lagring,
// publisering og forkasting sender id-en og telleren, så serveren kan se om noen andre har endret utkastet siden.
// `unreadable`: raden finnes, men kan ikke leses; den kan bare forkastes.
let courseDraft = null;
// Teksten når kurset har et utkast som ikke kom. Da er lagring stengt (feilbanneret).
let courseDraftLoadError = null;
// Lista slik den er publisert, når skjemaet viser et utkast (null når den ikke kom). «Publiser utkastet» sammenligner med den.
let publishedCourseItemsKey = null;
// Én handling på utkastet om gangen (publiser eller forkast).
let courseDraftActionRunning = false;

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
      // #1140 etappe 2: før feltet finnes (første tegning av hodet) er det skjemaets verdi som gjelder, og med et utkast er
      // det utkastets navn, ikke det publiserte. Ellers sto overskriften med ett navn og navnefeltet med et annet.
      const loaded = courseDetail?.localeValues?.nb?.title?.trim();
      if (loaded) return loaded;
      return courseDetail?.course ? (localizedText(courseDetail.course.title) || "") : "";
    },
    item: () => courseDetail?.course ?? null,
    // #934 skive 3: versjonen («v3.2») ved statusmerket. Et nytt kurs har ingen ennå.
    // #1140 etappe 2: med utkast «Publisert» + «Nyere utkast» (det felles merket), og linja om hvem som lagret det.
    statusHtml: () => {
      const course = courseDetail?.course ?? null;
      return course ? lifecycleBadge(course, t) + courseVersionChipHtml(course) + courseDraftStateHtml(course) + courseArchivedNoticeHtml() : "";
    },
    t,
    actions: () => courseDetailActions(),
    languages: {
      locales: DETAIL_LOCALES, labels: localeLabels, required: "nb",
      current: () => activeDetailLocale,
      onChange: (loc) => switchDetailLocale(loc),
    },
    tabs: { items: () => [{ id: "rediger", label: t("ui.tab.edit") }, { id: "innstillinger", label: t("ui.tab.settings") }], initial: "rediger" },
    body: () => courseDetailBodyHtml(),
    // #1150 skive 2b: et arkivert kurs har ingen Lagre/Avbryt (se `courseIsArchived`). Leses hver gang hodet tegnes.
    save: { onSave: () => saveCourse(courseDetail?.courseId ?? null), get hidden() { return courseIsArchived(); } },
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
  // #1140 etappe 2: rett etter Lagre og Avbryt, og bare når kurset har et lagret utkast. «Publiser utkastet» bare for et
  // publisert kurs (serveren avviser ellers); «Forkast utkast» alltid, så et utkast aldri står uten en vei ut.
  const draftLoaded = courseDraft != null && courseHasDraft(c);
  return [
    draftLoaded && isLiveLifecycle(lifecycle) && !courseDraft.unreadable
      ? `<button type="button" id="publishCourseDraftBtn" class="row-action-btn" data-action="publish-draft" data-course-id="${cid}">${escapeHtml(t("courses.draft.publishAction"))}</button>`
      : "",
    draftLoaded
      ? `<button type="button" id="discardCourseDraftBtn" class="row-action-btn" data-action="discard-draft" data-course-id="${cid}">${escapeHtml(t("courses.draft.discardAction"))}</button>`
      : "",
    pendingCount > 0
      ? `<button type="button" class="row-action-btn" data-action="publish-pending" data-course-id="${cid}">${escapeHtml(tf("adminContent.courses.pendingPublish.action", { count: pendingCount }))}</button>`
      : "",
    `<button type="button" class="row-action-btn" data-action="export" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.export"))}</button>`,
    lifecycle === "archived" ? ""
      : isLiveLifecycle(lifecycle)
        ? `<button type="button" class="row-action-btn" data-action="unpublish" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.unpublish"))}</button>`
        : (moduleCount > 0 ? `<button type="button" id="publishCourseBtn" class="row-action-btn" data-action="publish" data-course-id="${cid}">${escapeHtml(t("ui.action.publish"))}</button>` : ""),
    lifecycle === "archived"
      ? `<button type="button" class="row-action-btn" data-action="restore" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.restore"))}</button>`
      : `<button type="button" class="row-action-btn" data-action="archive" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.archive"))}</button>`,
    lifecycle === "archived" ? `<button type="button" class="row-action-btn destructive" data-action="delete" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("ui.action.delete"))}</button>` : "",
    isAdministrator() ? `<button type="button" class="row-action-btn destructive" data-action="cascade-delete" data-course-id="${cid}" data-course-title="${ctitle}">${escapeHtml(t("courses.deleteWithContent"))}</button>` : "",
  ];
}

/**
 * #1150 skive 2b: det åpnede kurset er arkivert. Da kan det ikke lagres: elementer som fulgte kurset inn i arkivet, gir
 * `course_item_archived` på hver lagring av elementlista, og skjemaet sender alltid hele lista. Skjemaet er sperret, Lagre og
 * Avbryt er borte, og linja under merket sier hvorfor. Tjeneren sperrer ikke (det er #1151); dette hindrer bare at forfatteren
 * skriver inn noe som garantert avvises.
 */
function courseIsArchived() {
  const course = courseDetail?.course;
  return Boolean(course) && lifecycleOf(course) === "archived";
}

function courseArchivedNoticeHtml() {
  if (!courseIsArchived()) return "";
  return `<p class="course-archived-notice" role="status" data-course-archived-notice>${escapeHtml(t("courses.archivedNotice"))}</p>`;
}

// Etter en livssyklushandling: bli på kurset når man står i det, ellers lista.
async function refreshCourseView(courseId) {
  const route = detectRoute();
  if (route.view === "list") await renderListView();
  else await renderDetailView(courseId ?? route.courseId);
}

// ---------------------------------------------------------------------------
// #1140 etappe 2 (skive 2c): utkastet til et publisert kurs. doc/design/PLAN_1140_E2.md, «Skive 2c: kursbyggeren», og
// doc/DECISIONS.md, «Ingen bryter, og mest mulig likt moduler».
// ---------------------------------------------------------------------------

/** Versjonen deltakerne ser, som «3.2» (uten «v»). */
function courseVersionNumber(course) {
  return courseVersionLabel(course).slice(1);
}

/** Hvorfor et element i utkastet ikke kan publiseres ut i kurset (fra `GET …/draft`), eller null. */
function courseDraftItemProblem(item) {
  if (item?.missing) return "missing";
  if (item?.archivedAt) return "archived";
  if (item?.unpublished) return "unpublished";
  return null;
}

function courseDraftItemToFormItem(item) {
  const refId = item.type === "MODULE" ? item.moduleId : item.sectionId;
  return {
    type: item.type,
    refId,
    title: localizedText(item.title) || refId,
    discussionsEnabled: item.discussionsEnabled !== false,
    problem: courseDraftItemProblem(item),
  };
}

/**
 * Under merket: hvem som lagret utkastet og hvilken versjon deltakerne ser. For et kurs som ikke er publisert, med et utkast
 * liggende igjen: veien ut i stedet (publiser kurset igjen, eller forkast utkastet).
 */
function courseDraftStateHtml(course) {
  if (!courseDraft || !courseHasDraft(course)) return "";
  // #1150 skive 2b: et arkivert kurs har sin egen linje (`courseArchivedNoticeHtml`), og rådet «publiser kurset igjen» gjelder
  // ikke før det er gjenopprettet. «Forkast utkast» står fortsatt i handlingsraden (kurs arkivert med utkast før 2.159.0).
  if (lifecycleOf(course) === "archived") return "";
  if (!isLiveLifecycle(lifecycleOf(course))) {
    return `<p class="course-draft-notice" role="status" data-course-draft-notice>${escapeHtml(t("courses.draft.notLiveNotice"))}</p>`;
  }
  if (courseDraft.unreadable) return "";
  const time = formatDateTime(courseDraft.updatedAt);
  const version = courseVersionNumber(course);
  const text = courseDraft.updatedByName
    ? tf("courses.draft.line", { name: courseDraft.updatedByName, time, version })
    : tf("courses.draft.lineNoName", { time, version });
  return `<p class="course-draft-line" data-course-draft-line>${escapeHtml(text)}</p>`;
}

/** `400 course_draft_item_unusable`: navnene og grunnene serveren sendte, som én setning. Tom når listen mangler. */
function courseDraftUnusableText(err) {
  const items = apiErrorBody(err)?.details?.items;
  if (!Array.isArray(items) || items.length === 0) return "";
  const known = new Set(["archived", "unpublished", "missing"]);
  const list = items
    .map((item) => {
      const name = `«${localizedText(item?.title) || item?.id || ""}»`;
      return known.has(item?.reason) ? `${name} (${t(`courses.draft.reason.${item.reason}`)})` : name;
    })
    .join(", ");
  return tf("courses.draft.unusableList", { items: list });
}

/** Feil fra publisering eller forkasting i skjemaets feilbanner, på brukerens språk. Skjemaet beholder det som står. */
function showCourseDraftError(err) {
  const extra = apiErrorCode(err) === "course_draft_item_unusable" ? courseDraftUnusableText(err) : "";
  showCourseFormError(`<div class="error-banner" data-course-draft-error>${escapeHtml(apiErrorText(err))}${extra ? ` ${escapeHtml(extra)}` : ""}</div>`);
  document.getElementById("formErrorBanner")?.scrollIntoView?.({ block: "nearest" });
}

/**
 * «Publiser utkastet». Ulagrede endringer lagres først (feiler det, publiseres ingenting). Er lista endret mot den publiserte og
 * noen har kursbevis, kommer «Hva slags endring er dette?» med knappen «Publiser som {x.y}»; ellers publiseres det direkte.
 * Ingen visning av hva som endres (produkteier 2026-11-12).
 */
async function publishCourseDraftFromForm() {
  const courseId = courseDetail?.courseId ?? null;
  const course = courseDetail?.course ?? null;
  if (courseDraftActionRunning || !courseId || !course || !courseDraft || courseDraft.unreadable) return;
  const page = getCourseFormPage();
  // En lagring som pågår («Lagre» rett før «Publiser utkastet»), må bli ferdig først: ellers sendes to lagringer med samme
  // teller, og den ene får «noen andre har endret utkastet».
  if (page.state.saving) return;
  courseDraftActionRunning = true;
  try {
    if (page.state.dirty) {
      page.setBusy(true);
      let saved = false;
      try {
        saved = await saveCourse(courseId, { beforePublish: true });
      } finally {
        page.setBusy(false);
      }
      if (!saved) return;
      page.markClean();
    }
    // Lista i utkastet (skjemaet er lagret nå) mot den publiserte. Kom ikke den publiserte lista, vet vi det ikke: da avgjør
    // serveren, og svarer `course_version_required` hvis spørsmålet trengs.
    const changes = publishedCourseItemsKey === null ? null : courseItemChanges(publishedCourseItemsKey, courseModules);
    const listChanged = publishedCourseItemsKey !== null && courseItemsKey(courseModules) !== publishedCourseItemsKey;
    let answer;
    if (listChanged && Number(course.certificateHolders) > 0) {
      answer = await askCourseVersion(course, changes, { saveKey: "courses.draft.publishAs" });
      if (answer === null) return;
    }
    await commitCourseDraftPublish(courseId, course, answer, changes);
  } finally {
    courseDraftActionRunning = false;
  }
}

async function commitCourseDraftPublish(courseId, course, answer, changes, retried = false) {
  const draft = courseDraft;
  try {
    const result = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/draft/publish`, getHeaders, {
      method: "POST",
      body: JSON.stringify({ loaded: { draftId: draft.draftId, revision: draft.revision }, ...versionRequestBody(answer, "version") }),
    });
    showToast(t("courses.draft.published"), "success", tf("courses.draft.publishedDetail", { version: courseVersionNumber(result?.course ?? course) }));
    await renderDetailView(courseId);
  } catch (err) {
    // Noen har fått kursbevis siden kurset ble åpnet, eller lista vi sammenlignet med kom ikke: spør, og prøv én gang til.
    if (!retried && answer === undefined && apiErrorCode(err) === "course_version_required") {
      const holders = Number(apiErrorBody(err)?.details?.certificateHolders);
      const asked = { ...course, certificateHolders: Number.isFinite(holders) && holders > 0 ? holders : course.certificateHolders };
      const again = await askCourseVersion(asked, changes ?? { added: 0, removed: 0, moved: 0 }, { saveKey: "courses.draft.publishAs" });
      if (again === null) return;
      await commitCourseDraftPublish(courseId, asked, again, changes, true);
      return;
    }
    showCourseDraftError(err);
  }
}

/** «Forkast utkast»: sletter det lagrede utkastet etter en bekreftelse. Kurset deltakerne ser, endres ikke. */
async function discardCourseDraftFromForm(button) {
  const courseId = courseDetail?.courseId ?? null;
  const course = courseDetail?.course ?? null;
  if (courseDraftActionRunning || getCourseFormPage().state.saving || !courseId || !course || !courseDraft) return;
  if (!window.confirm(tf("courses.draft.discardConfirm", { version: courseVersionNumber(course) }))) return;
  courseDraftActionRunning = true;
  if (button) button.disabled = true;
  const { draftId, revision } = courseDraft;
  try {
    await apiFetch(
      `/api/admin/content/courses/${encodeURIComponent(courseId)}/draft?draftId=${encodeURIComponent(draftId)}&revision=${encodeURIComponent(String(revision))}`,
      getHeaders,
      { method: "DELETE" },
    );
    // Det som var skrevet og ikke lagret, var en del av utkastet, og er forkastet med det.
    getCourseFormPage().markClean();
    showToast(t("courses.draft.discarded"), "success");
    await renderDetailView(courseId);
  } catch (err) {
    showCourseDraftError(err);
    if (button) button.disabled = false;
  } finally {
    courseDraftActionRunning = false;
  }
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
      // #1140 etappe 2: et element i utkastet som er arkivert, avpublisert eller slettet siden utkastet ble lagret, merkes med
      // grunnen. Publiseringen avvises av serveren til det er tatt ut.
      const problemNote = m.problem
        ? `<span class="form-row-note" data-item-problem="${escapeHtml(m.problem)}">${escapeHtml(t(`courses.draft.item.${m.problem}`))}</span>`
        : "";
      return `
      <li class="form-row${m.problem ? " is-blocked" : ""}" data-item-type="${m.type}" data-ref-id="${escapeHtml(m.refId)}">
        <span class="form-row-order">${i + 1}.</span>
        <span class="form-row-badge">${courseItemTypeBadge(m.type)}</span>
        <span class="form-row-title">${escapeHtml(m.title)}</span>
        <div class="form-row-actions">
          <button type="button" class="row-action-btn" data-move="up" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="${escapeHtml(t("courses.moveUp"))}">↑</button>
          <button type="button" class="row-action-btn" data-move="down" data-index="${i}" ${i === courseModules.length - 1 ? "disabled" : ""} aria-label="${escapeHtml(t("courses.moveDown"))}">↓</button>
          <a href="${openHref}" class="row-action-btn" target="_blank" rel="noopener">${escapeHtml(t("ui.action.open"))}</a>
          <button type="button" class="row-action-btn destructive" data-remove="${i}" aria-label="${escapeHtml(t("courses.removeModule"))}">${escapeHtml(t("ui.action.remove"))}</button>
        </div>
        ${problemNote}
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

// #440: only show PUBLISHED modules in the course picker. A course referring to an unpublished module
// creates latent failures (broken exports, broken course publish, broken participant view). Authors
// finalise modules first, then assemble courses.
//
// ⚠️ «Publisert» = har en live versjon, også når det ligger en nyere, upublisert lagring oppå
// (`published_with_draft`). Sjekken var `status === "published"`, og en live modul forsvant fra søket i
// det øyeblikket forfatteren lagret en endring i den (prod 13.11.2026).
async function loadPickerModules() {
  const libData = await apiFetch(`/api/admin/content/modules/library?locale=${encodeURIComponent(currentLocale)}`, getHeaders);
  return (libData.modules ?? []).filter(m => isLiveLifecycle(m.lifecycle));
}

// #490/#992: arkiverte seksjoner filtreres bort — samme grep som modul-søsteren over gjør med
// upubliserte. Uten det tilbød nedtrekkslista noe `/items` avviser med 400, og fordi ruta skriver HELE
// sekvensen, feilet da ikke bare den ene raden: forfatteren mistet alle endringene i lagringen.
//
// ⚠️ Dette er ikke sannheten om regelen, bare høfligheten. Backend eier avslaget
// (`assertContentUsableInCourse`), og skal fortsette å gjøre det — en klient som filtrerer er en klient
// som kan bli utdatert. Poenget er å ikke by fram noe vi vet blir avvist.
async function loadPickerSections() {
  const secData = await apiFetch("/api/admin/content/sections", getHeaders);
  return (secData.sections ?? []).filter(s => !s.archivedAt);
}

// Forfatteren publiserer en modul i én fane og vil sette den inn i kurset i en annen. Lista ble hentet
// da kurset ble åpnet, og kurset har gjerne ulagret arbeid — å laste sida på nytt er ikke en utvei.
// Derfor hentes lista på nytt hver gang forfatteren kommer tilbake til fanen eller vinduet. Feiler
// hentingen, står den forrige lista.
let pickerRefreshBound = false;
let pickerRefreshRunning = false;
function bindPickerRefresh() {
  if (pickerRefreshBound) return;
  pickerRefreshBound = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshPickerLibrary(); });
  window.addEventListener("focus", () => refreshPickerLibrary());
}

async function refreshPickerLibrary() {
  // Bare mens kursbyggeren vises, og én henting av gangen (fanebytte gir begge hendelsene over).
  if (pickerRefreshRunning || !document.getElementById("comboboxInput")) return;
  pickerRefreshRunning = true;
  try {
    const [modules, sections] = await Promise.allSettled([loadPickerModules(), loadPickerSections()]);
    if (modules.status === "fulfilled") allLibraryModules = modules.value;
    if (sections.status === "fulfilled") allLibrarySections = sections.value;
    updateComboboxDropdown();
  } finally {
    pickerRefreshRunning = false;
  }
}

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
    // 2.121.0: delingslenka står i skjemaet, som tegnes om — derfor her, delegert, og ikke på knappen.
    if (e.target.closest("#courseShareLinkCopy")) {
      copyCourseShareLink();
      return;
    }
    const btn = e.target.closest(".form-page-actions [data-action]");
    if (!btn) return;
    // #1140 etappe 2: utkastets to knapper forlater ikke skjemaet, og spør ikke om det. «Publiser utkastet» lagrer det som
    // er skrevet først; «Forkast utkast» har sin egen bekreftelse, som gjelder det ulagrede også.
    if (btn.dataset.action === "publish-draft") {
      publishCourseDraftFromForm();
      return;
    }
    if (btn.dataset.action === "discard-draft") {
      discardCourseDraftFromForm(btn);
      return;
    }
    if (!getCourseFormPage().confirmLeave()) return;
    handleListTableClick(e, btn);
  });
}

// ---------------------------------------------------------------------------
// 2.102.0: tema i «Mine kurs». Kurset står under hvert tema som er valgt her.
// ---------------------------------------------------------------------------

/** Temaene kurset kan velge blant, alfabetisk på leserens språk; null når lista ikke kom. */
async function loadAvailableThemes() {
  try {
    const body = await apiFetch("/api/admin/content/themes", getHeaders);
    const themes = (body.themes ?? []).map((theme) => ({ id: theme.id, name: localizedText(theme.name) || theme.name }));
    return themes.sort((a, b) => a.name.localeCompare(b.name, currentLocale, { numeric: true, sensitivity: "base" }));
  } catch {
    return null;
  }
}

function courseThemesSummary(names) {
  return names.length > 0 ? tf("courses.themes.summary", { themes: names.join(", ") }) : t("courses.themes.summaryNone");
}

function courseThemesFieldHtml(availableThemes, themeIds) {
  if (!Array.isArray(availableThemes)) return "";
  const picked = new Set(themeIds);
  const options = availableThemes.length > 0
    ? `<div class="course-theme-options">${availableThemes.map((theme) => `
        <label class="course-theme-option">
          <input type="checkbox" name="courseTheme" value="${escapeHtml(theme.id)}"${picked.has(theme.id) ? " checked" : ""} />
          ${escapeHtml(theme.name)}
        </label>`).join("")}</div>`
    : `<p class="small" style="margin:0">${escapeHtml(t("courses.themes.none"))}</p>`;
  const names = availableThemes.filter((theme) => picked.has(theme.id)).map((theme) => theme.name);
  return `<fieldset class="course-theme-field" id="courseThemesField">
    <legend>${escapeHtml(t("courses.themes.title"))}</legend>
    <p class="small" style="margin: 0 0 var(--space-1)">${escapeHtml(t("courses.themes.help"))}</p>
    ${options}
    <p class="small" id="courseThemesSummary" style="margin: var(--space-1) 0 0">${escapeHtml(courseThemesSummary(names))}</p>
  </fieldset>`;
}

function bindCourseThemesField() {
  const field = document.getElementById("courseThemesField");
  field?.addEventListener("change", () => {
    const names = [...field.querySelectorAll('input[name="courseTheme"]:checked')]
      .map((input) => input.closest("label")?.textContent?.trim() ?? "");
    const summary = document.getElementById("courseThemesSummary");
    if (summary) summary.textContent = courseThemesSummary(names);
  });
}

/** De valgte temaene, eller undefined når valget ikke vises (lista kom ikke) — da røres de ikke. */
function collectCourseThemeIds() {
  const field = document.getElementById("courseThemesField");
  if (!field) return undefined;
  return [...field.querySelectorAll('input[name="courseTheme"]:checked')].map((input) => input.value);
}

function initDetailEventListeners(courseId) {
  bindHeaderActions();
  bindCourseThemesField();

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

/**
 * Lagre. Et nytt kurs og et kurs som ikke er publisert, lagres direkte som før. #1140 etappe 2: et PUBLISERT kurs lagres til
 * utkastet (`PUT …/draft`), uten spørsmål om versjon; ingenting deltakerne ser, endres.
 * `beforePublish`: kalt av «Publiser utkastet». Da vises ingen melding, og visningen lastes ikke på nytt (publiseringen gjør det);
 * id-en og telleren til det lagrede utkastet huskes, så publiseringen sender dem.
 */
async function saveCourse(courseId, { beforePublish = false } = {}) {
  const saveBtn = document.getElementById("formSaveBtn");
  const errorBanner = document.getElementById("formErrorBanner");

  // #934 skive 4a: uten elementlista lagres ingenting — en lagring ville tatt bort det som ikke ble lastet.
  if (courseId && showCourseItemsLoadError()) return false;

  const collectedValues = collectLocaleValues();
  const certLevel = document.getElementById("certLevel")?.value ?? "";
  const enrollmentPolicy = document.getElementById("enrollmentPolicy")?.value === "RESTRICTED" ? "RESTRICTED" : "OPEN";
  const discussionsEnabled = document.getElementById("discussionsEnabled")?.checked !== false;
  const discussionOwnerNotifications = document.getElementById("discussionOwnerNotifications")?.checked !== false;
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
  const themeIds = collectCourseThemeIds();
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

  // #934 skive 3: endres innholdet i et kurs som noen har kursbevis for, spør først — også når kurset er
  // avpublisert (kursbevis betyr at det har vært ute). Avbryter forfatteren, lagres ingenting. Uten
  // kursbevis spørres det ikke — tjeneren gir en mindre versjon.
  const loadedCourse = courseId ? courseDetail?.course ?? null : null;
  // #1140 etappe 2: et publisert kurs (med eller uten utkast) lagres til utkastet. Versjonen avgjøres når utkastet publiseres.
  const savesToDraft = Boolean(courseId) && isLiveLifecycle(lifecycleOf(loadedCourse));
  const itemsChanged = Boolean(courseId) && courseItemsKey(courseModules) !== initialCourseItemsKey;
  let versionAnswer;
  if (!savesToDraft && itemsChanged && Number(loadedCourse?.certificateHolders) > 0) {
    versionAnswer = await askCourseVersion(loadedCourse, courseItemChanges(initialCourseItemsKey, courseModules));
    if (versionAnswer === null) return false;
  }

  if (saveBtn) saveBtn.disabled = true;
  applyCourseLocaleValuesToForm(effectiveValues);

  // Save the mixed module/section sequence (#490). PUT /items also re-syncs
  // CourseModule server-side (B2) so legacy read paths stay correct.
  const items = courseModules.map(m =>
    m.type === "SECTION"
      ? { type: "SECTION", sectionId: m.refId, discussionsEnabled: m.discussionsEnabled !== false }
      : { type: "MODULE", moduleId: m.refId, discussionsEnabled: m.discussionsEnabled !== false },
  );
  // Et NYTT kurs har aldri vært ute: elementene lagres etter at kurset er opprettet, uten teller (#934 skive 4a).
  const saveNewCourseItems = (id) => apiFetch(`/api/admin/content/courses/${encodeURIComponent(id)}/items`, getHeaders, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });

  try {
    let savedCourseId = courseId;
    let savedDraft = null;

    if (savesToDraft) {
      // #1140 etappe 2: de samme feltene som direkte lagring sender, og `loaded`: hva skjemaet lastet. Uten utkast kursets
      // teller (`expectedRevision`), med utkast utkastets id og teller. Har noen andre lagret, publisert eller forkastet
      // siden, svarer serveren 409 og har ikke skrevet noe; skjemaet beholder det forfatteren skrev (feilbanneret under).
      const loaded = courseDraft && !courseDraft.unreadable
        ? { draftId: courseDraft.draftId, revision: courseDraft.revision }
        : { expectedRevision: Number.isInteger(loadedCourse?.contentRevision) ? loadedCourse.contentRevision : 0 };
      const body = await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/draft`, getHeaders, {
        method: "PUT",
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription,
          certificationLevel: certLevel || undefined,
          enrollmentPolicy,
          discussionsEnabled,
          discussionOwnerNotifications,
          sortOrder,
          themeIds,
          items,
          loaded,
        }),
      });
      savedDraft = body?.draft ?? null;
    } else if (!courseId) {
      // Create
      const body = await apiFetch("/api/admin/content/courses", getHeaders, {
        method: "POST",
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription,
          certificationLevel: certLevel || undefined,
          enrollmentPolicy,
          discussionsEnabled,
          discussionOwnerNotifications,
          sortOrder,
          themeIds,
        }),
      });
      savedCourseId = body.course?.id;
      if (!savedCourseId) throw new Error(t("courses.noIdReturned"));
      await saveNewCourseItems(savedCourseId);
    } else {
      // Update. #934 skive 4a: ALLTID ett kall til `…/content` — navn, innstillinger, elementene (alltid med) og
      // forfatterens svar, i én transaksjon. `expectedRevision` er telleren skjemaet lastet: har noen andre lagret
      // kurset siden, svarer serveren 409 `course_changed` og har ikke skrevet noe. Skjemaet beholder det
      // forfatteren skrev (feilbanneret under), og forfatteren laster siden på nytt.
      await apiFetch(`/api/admin/content/courses/${encodeURIComponent(courseId)}/content`, getHeaders, {
        method: "PUT",
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription,
          certificationLevel: certLevel || undefined,
          enrollmentPolicy,
          discussionsEnabled,
          discussionOwnerNotifications,
          sortOrder,
          themeIds,
          items,
          // #934 skive 4b: med tallet forfatteren bekreftet når hovedversjonen sender e-post (se `courseVersionAnswer`).
          ...versionRequestBody(versionAnswer, "version"),
          expectedRevision: Number.isInteger(loadedCourse?.contentRevision) ? loadedCourse.contentRevision : 0,
        }),
      });
    }

    initialDetailLocaleValues = cloneCourseLocaleValues(effectiveValues);

    if (savesToDraft) {
      if (beforePublish) {
        // Publiseringen kommer rett etter, og sender utkastet slik det nå er lagret.
        if (savedDraft?.id && Number.isInteger(savedDraft.revision)) {
          courseDraft = { draftId: savedDraft.id, revision: savedDraft.revision, updatedByName: savedDraft.updatedByName ?? null, updatedAt: savedDraft.updatedAt ?? null };
        }
        initialCourseItemsKey = courseItemsKey(courseModules);
        if (saveBtn) saveBtn.disabled = false;
        return true;
      }
      showToast(t("courses.draft.savedToast"), "success", tf("courses.draft.savedDetail", { version: courseVersionNumber(loadedCourse) }));
      await renderDetailView(courseId);
      return true;
    }

    showToast(t("courses.saved"), "success");

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
      // Banneret står under innholdslista. På et langt kurs havnet «Noen andre har endret utkastet …» under kanten, og
      // «Lagre» så ut til å ikke gjøre noe (QA-porten, skive 2c).
      errorBanner.scrollIntoView?.({ block: "nearest" });
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
  initCourseArchiveDialog();
  initCourseRestoreDialog();

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
