// #1168: dialogene for «Arkiver» og «Slett» på en modul eller en seksjon, i kursets mønster (#1150): sjekk først, vis
// konsekvensene før forfatteren trykker, på brukerens språk, og fokus tilbake til knappen etterpå. Før arkiverte modulen uten
// spørsmål og fikk et avslag etterpå, seksjonen spurte med nettleserens spørreboks og fikk avslaget etterpå, og slettingen
// brukte nettleserens spørreboks med fast tekst.
//
// Brukes fra biblioteket (admin-content-library.js), modulsida (admin-content-shell.js) og seksjonssida
// (admin-content-sections.js). Dialogen lages første gang den trengs, så sidene ikke trenger hver sin markup. Stilene står i
// shared.css (.module-lifecycle-dialog). Navnet er fra første skive (moduler); dialogen er den samme for begge.
//
// Kursene som holder elementet igjen, kommer fra tjeneren (`GET …/archive-preview`), med den samme regelen som sperren i
// `POST …/archive`. Klienten regner ikke ut regelen selv. Arkiveringen sjekker på nytt; svarer den nei likevel (noen la
// elementet inn i et kurs i mellomtiden), viser kalleren tjenerens oversatte grunn som før.

import { escapeHtml } from "./html-escape.js";
import { setHidden } from "./dom-visibility.js";

const DIALOG_ID = "moduleLifecycleDialog";

// Hvor forhåndsvisningen hentes, og hvilke tekster dialogen bruker (`<keys>.archiveDialog.*`, `<keys>.deleteDialog.*`).
const ITEMS = {
  module: { previewUrl: (id) => `/api/admin/content/modules/${encodeURIComponent(id)}/archive-preview`, keys: "library" },
  section: { previewUrl: (id) => `/api/admin/content/sections/${encodeURIComponent(id)}/archive-preview`, keys: "sections" },
};

// Sant mens en forhåndsvisning hentes: et klikk på «Arkiver» i en annen rad i den tiden åpner ingenting (QA 2.178.0).
let dialogPending = false;

function ensureDialog() {
  const existing = document.getElementById(DIALOG_ID);
  if (existing) return existing;
  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = "module-lifecycle-dialog";
  dialog.setAttribute("aria-labelledby", `${DIALOG_ID}Title`);
  dialog.innerHTML = `
    <h2 class="dialog-title" id="${DIALOG_ID}Title"></h2>
    <p class="dialog-text" id="${DIALOG_ID}Text"></p>
    <div class="module-lifecycle-body" id="${DIALOG_ID}Body"></div>
    <div class="dialog-actions">
      <button type="button" class="btn" id="${DIALOG_ID}ConfirmBtn"></button>
      <button type="button" class="dialog-cancel" id="${DIALOG_ID}CancelBtn"></button>
    </div>`;
  document.body.append(dialog);
  return dialog;
}

/**
 * Viser dialogen og svarer `true` når forfatteren bekrefter, ellers `false` (Avbryt, Lukk, Esc). Uten `confirmLabel` er det en
 * sperret dialog med bare en lukkeknapp. Fokus står på Avbryt fra start: handlingene her kan ikke angres med et nytt klikk.
 */
function showModuleDialog({ kind, title, text, bodyHtml = "", confirmLabel = null, confirmClass = "btn-primary", cancelLabel, returnFocusTo = null }) {
  const dialog = ensureDialog();
  // Én dialog om gangen: står den alt åpen (et klikk på en annen rad mens forhåndsvisningen ble hentet), er svaret nei. Ellers
  // ville den andre fylt den samme dialogen, og ett «ja» kunne svart for begge.
  if (typeof dialog.showModal !== "function" || dialog.open || dialogPending) return Promise.resolve(false);
  const confirmBtn = document.getElementById(`${DIALOG_ID}ConfirmBtn`);
  const cancelBtn = document.getElementById(`${DIALOG_ID}CancelBtn`);
  dialog.dataset.moduleDialog = kind;
  document.getElementById(`${DIALOG_ID}Title`).textContent = title;
  document.getElementById(`${DIALOG_ID}Text`).textContent = text;
  document.getElementById(`${DIALOG_ID}Body`).innerHTML = bodyHtml;
  confirmBtn.className = `btn ${confirmClass}`;
  confirmBtn.textContent = confirmLabel ?? "";
  confirmBtn.disabled = false;
  setHidden(confirmBtn, !confirmLabel);
  cancelBtn.textContent = cancelLabel;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      focusBack(returnFocusTo);
      resolve(value);
    };
    const onConfirm = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    cancelBtn.focus();
  });
}

/**
 * Fokus tilbake dit forfatteren var. Ligger knappen i radens «Mer»-meny (row-actions.js), får menyknappen fokus: klikket i
 * dialogen er et klikk utenfor menyen, så menyen lukkes like etter, og en knapp inne i den ville mistet fokuset igjen.
 * En knapp som er borte (lista er tegnet på nytt), får ingenting.
 */
function focusBack(button) {
  if (!button || !document.contains(button)) return;
  const menuToggle = button.closest("details.row-more")?.querySelector("summary");
  (menuToggle ?? button).focus();
}

function usesListHtml(uses, t, keys) {
  const items = uses.map((use) => {
    const href = `/admin-content/courses/${encodeURIComponent(use.courseId)}`;
    const note = use.via === "draft" ? ` <span class="module-lifecycle-note">${escapeHtml(t(`${keys}.archiveDialog.viaDraft`))}</span>` : "";
    return `<li data-course-id="${escapeHtml(use.courseId)}"><a href="${href}">${escapeHtml(use.title || use.courseId)}</a>${note}</li>`;
  });
  return `<section data-lifecycle-part="usedIn"><ul>${items.join("")}</ul></section>`;
}

/**
 * «Arkiver»: spør tjeneren først. Holder et aktivt kurs (eller et lagret kursutkast) elementet igjen, vises kursene med lenker og
 * ingen bekreftknapp. Ellers sier dialogen hva som skjer, og svaret er om forfatteren bekreftet.
 * Svar: `{ confirmed: boolean }`, eller `{ error }` når forhåndsvisningen ikke kom (kalleren viser feilen som før).
 */
async function confirmItemArchive(item, { id, title, t, tf, apiFetch, getHeaders, returnFocusTo = null }) {
  const { previewUrl, keys } = ITEMS[item];
  // Knappen er opptatt mens forhåndsvisningen hentes (et dobbeltklikk skal ikke åpne to), men ikke mens dialogen står: da må
  // fokus kunne gå tilbake til den.
  // Står dialogen åpen, eller hentes en annen forhåndsvisning, skjer ingenting (én om gangen).
  if (dialogPending || document.getElementById(DIALOG_ID)?.open) return { confirmed: false };
  dialogPending = true;
  if (returnFocusTo) returnFocusTo.disabled = true;
  let preview;
  try {
    preview = await apiFetch(previewUrl(id), getHeaders);
  } catch (error) {
    return { error };
  } finally {
    dialogPending = false;
    if (returnFocusTo) returnFocusTo.disabled = false;
  }
  const uses = Array.isArray(preview?.uses) ? preview.uses : [];
  const heading = tf(`${keys}.archiveDialog.title`, { title });
  if (uses.length > 0) {
    await showModuleDialog({
      kind: "archive-blocked",
      title: heading,
      text: tf(uses.length === 1 ? `${keys}.archiveDialog.blockedOne` : `${keys}.archiveDialog.blockedMany`, { count: uses.length }),
      bodyHtml: usesListHtml(uses, t, keys),
      cancelLabel: t("ui.action.close"),
      returnFocusTo,
    });
    return { confirmed: false };
  }
  const bodyHtml = preview?.published === true
    ? `<p class="dialog-text" data-lifecycle-part="unpublishes">${escapeHtml(t(`${keys}.archiveDialog.published`))}</p>`
    : "";
  const confirmed = await showModuleDialog({
    kind: "archive",
    title: heading,
    text: t(`${keys}.archiveDialog.intro`),
    bodyHtml,
    confirmLabel: t(`${keys}.archiveDialog.confirm`),
    cancelLabel: t("ui.action.cancel"),
    returnFocusTo,
  });
  return { confirmed };
}

/** «Slett» for et arkivert element. Tjeneren avgjør om det kan slettes; avslaget vises av kalleren som før. */
function confirmItemDelete(item, { title, t, tf, returnFocusTo = null }) {
  const { keys } = ITEMS[item];
  return showModuleDialog({
    kind: "delete",
    title: tf(`${keys}.deleteDialog.title`, { title }),
    text: t(`${keys}.deleteDialog.text`),
    confirmLabel: t(`${keys}.deleteDialog.confirm`),
    confirmClass: "btn-danger",
    cancelLabel: t("ui.action.cancel"),
    returnFocusTo,
  });
}

export function confirmModuleArchive({ moduleId, ...rest }) {
  return confirmItemArchive("module", { id: moduleId, ...rest });
}

export function confirmModuleDelete(options) {
  return confirmItemDelete("module", options);
}

export function confirmSectionArchive({ sectionId, ...rest }) {
  return confirmItemArchive("section", { id: sectionId, ...rest });
}

export function confirmSectionDelete(options) {
  return confirmItemDelete("section", options);
}
