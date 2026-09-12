// #1046 nivå to: ÉN skjemaside for det åpnede elementet (modul, kurs, seksjon, klasse).
//
// Skjermbildene viste fire ulike hoder (typen som tittel, navnet som tittel, ingen tittel), fem
// lagremodeller og tre språkvelgere. Produkteier avgjorde 12.09: lag nytt = åpne et tomt element;
// Lagre-knapp overalt med «Alt lagret / Ulagrede endringer» og spørsmål før man forlater.
//
// Denne modulen eier det som er likt (doc/UI_FORM_LEVEL.md):
// - B1  tilbake-lenke: grå «← Tilbake til [lista]»
// - B2  typemerke over NAVNET som tittel (ikke typen)
// - B3  tilstandslinje: statusmerke + «Alt lagret» / «Ulagrede endringer»
// - F1  handlingsrad i hodet, samme «maks fire + Mer»-regel som listene
// - C1  språkpiller med etiketten «Innholdsspråk:», bokmål først, «(påkrevd)» på det påkrevde språket
// - E1  lagrelinje: Avbryt som lenke, fylt «Lagre» ytterst til høyre
// - E3  spørsmål før man forlater med ulagrede endringer (lenker, tilbake, lukking av fanen)
//
// Sidens eget — feltene, dialogene, hva Lagre gjør — kommer inn som HTML og funksjoner.

import { escapeHtml } from "./html-escape.js";
import { rowActionsHtml, installRowMoreMenus } from "./row-actions.js";
import { lifecycleBadge } from "./content-status-badge.js";

const resolve = (x) => (typeof x === "function" ? x() : x);

/**
 * @typedef {object} FormPageConfig
 * @property {HTMLElement} host
 * @property {() => ({ back: string, typeLabel: string, untitled: string, savedAll: string, unsaved: string,
 *   save: string, cancel: string, leaveConfirm: string, contentLocale: string, required: string })} texts
 * @property {string} [backHref]         lenke tilbake til lista
 * @property {() => void} [onBack]       alternativ til backHref (sider uten egen URL)
 * @property {() => string} title        elementets navn (tom → texts.untitled)
 * @property {() => any} [item]          elementet, for statusmerket (lifecycleBadge leser `lifecycle`)
 * @property {(t: (k: string) => string) => string} [statusHtml]  egen status-HTML i stedet for lifecycleBadge
 * @property {() => Array<string|null|undefined|false>} [actions]  handlingsraden (ferdig HTML per knapp)
 * @property {{ locales: string[], labels: Record<string,string>, current: () => string, onChange: (l: string) => void, required?: string }} [languages]
 * @property {() => string} body         sidens eget skjema (HTML)
 * @property {{ onSave: () => Promise<boolean|void>, onCancel?: () => void, hidden?: boolean }} [save]
 * @property {(root: HTMLElement) => void} [afterRender]
 * @property {(k: string) => string} [t]  oversetter for lifecycleBadge
 */

/** @param {FormPageConfig} config */
export function createFormPage(config) {
  const { host } = config;
  const state = { dirty: false, saving: false };
  let guardInstalled = false;

  installRowMoreMenus();

  function texts() { return resolve(config.texts); }

  function headerHtml() {
    const T = texts();
    const title = (config.title() ?? "").trim();
    const status = config.statusHtml
      ? config.statusHtml(config.t ?? ((k) => k))
      : config.item ? lifecycleBadge(config.item(), config.t ?? ((k) => k)) : "";
    const actions = config.actions ? rowActionsHtml(config.actions(), { moreLabel: "Mer" }) : "";
    const back = config.backHref
      ? `<a href="${escapeHtml(config.backHref)}" class="back-link" id="formBackLink">${escapeHtml(T.back)}</a>`
      : `<a class="back-link" id="formBackLink" href="#">${escapeHtml(T.back)}</a>`;
    return `<div class="form-page-head">
      ${back}
      <div class="form-page-title-row">
        <div class="form-page-title">
          <span class="form-page-type">${escapeHtml(T.typeLabel)}</span>
          <h1 id="formPageTitle" class="${title ? "" : "is-untitled"}">${escapeHtml(title || T.untitled)}</h1>
          <div class="form-page-state">${status}<span id="formPageDirty" class="form-state-badge is-clean">${escapeHtml(T.savedAll)}</span></div>
        </div>
        ${actions ? `<div class="form-page-actions"><div class="row-actions">${actions}</div></div>` : ""}
      </div>
    </div>`;
  }

  function languagesHtml() {
    const L = config.languages;
    if (!L) return "";
    const T = texts();
    const current = L.current();
    return `<div class="form-page-languages" role="group" aria-label="${escapeHtml(T.contentLocale)}">
      <span class="content-locale-label">${escapeHtml(T.contentLocale)}</span>
      ${L.locales.map((loc) => `<button type="button" class="content-locale-pill${loc === current ? " active" : ""}" data-form-locale="${escapeHtml(loc)}" aria-pressed="${loc === current}">${escapeHtml(L.labels[loc] ?? loc)}${L.required === loc ? ` <span class="content-locale-required">${escapeHtml(T.required)}</span>` : ""}</button>`).join("")}
    </div>`;
  }

  function saveBarHtml() {
    if (!config.save || config.save.hidden) return "";
    const T = texts();
    return `<div class="form-save-bar">
      <span id="formSaveState" class="form-save-state"></span>
      ${config.save.onCancel || config.backHref || config.onBack ? `<a href="#" id="formCancelLink" class="form-cancel-link">${escapeHtml(T.cancel)}</a>` : ""}
      <button type="button" id="formSaveBtn" class="btn btn-primary" style="width:auto" disabled>${escapeHtml(T.save)}</button>
    </div>`;
  }

  function render() {
    host.innerHTML = `${headerHtml()}${languagesHtml()}<div class="form-page-body">${config.body()}</div>${saveBarHtml()}`;
    reflectDirty();
    config.afterRender?.(host);
  }

  function reflectDirty() {
    const T = texts();
    const badge = host.querySelector("#formPageDirty");
    if (badge) {
      badge.textContent = state.dirty ? T.unsaved : T.savedAll;
      badge.classList.toggle("is-dirty", state.dirty);
      badge.classList.toggle("is-clean", !state.dirty);
    }
    const btn = host.querySelector("#formSaveBtn");
    if (btn) btn.disabled = !state.dirty || state.saving;
  }

  function refreshTitle() {
    const T = texts();
    const h1 = host.querySelector("#formPageTitle");
    if (!h1) return;
    const title = (config.title() ?? "").trim();
    h1.textContent = title || T.untitled;
    h1.classList.toggle("is-untitled", !title);
  }

  function markDirty() { if (!state.dirty) { state.dirty = true; reflectDirty(); } }
  function markClean() { state.dirty = false; reflectDirty(); }

  function confirmLeave() {
    if (!state.dirty) return true;
    return window.confirm(texts().leaveConfirm);
  }

  async function save() {
    if (!config.save || state.saving) return;
    state.saving = true;
    reflectDirty();
    try {
      const ok = await config.save.onSave();
      if (ok !== false) markClean();
    } finally {
      state.saving = false;
      reflectDirty();
    }
  }

  function installGuards() {
    if (guardInstalled) return;
    guardInstalled = true;
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    // Lenker som forlater sida (toppmeny, nivå to, tilbake): spør først når noe er ulagret.
    document.addEventListener("click", (event) => {
      const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!a || a.target === "_blank" || a.getAttribute("href")?.startsWith("#")) return;
      if (!confirmLeave()) { event.preventDefault(); event.stopPropagation(); }
    }, true);
  }

  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const back = target.closest("#formBackLink");
    if (back && !config.backHref) {
      event.preventDefault();
      if (confirmLeave()) config.onBack?.();
      return;
    }
    const cancel = target.closest("#formCancelLink");
    if (cancel) {
      event.preventDefault();
      if (!confirmLeave()) return;
      if (config.save?.onCancel) config.save.onCancel();
      else if (config.backHref) window.location.href = config.backHref;
      else config.onBack?.();
      return;
    }
    if (target.closest("#formSaveBtn")) { save(); return; }
    const pill = target.closest("[data-form-locale]");
    if (pill && config.languages) {
      config.languages.onChange(pill.dataset.formLocale);
      for (const b of host.querySelectorAll("[data-form-locale]")) {
        const on = b === pill;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      }
    }
  });
  // Skriving i et felt gjør skjemaet ulagret. Sider som lagrer felt for felt (operasjoner) markerer
  // dem med data-form-untracked.
  host.addEventListener("input", (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el || el.closest("[data-form-untracked]")) return;
    if (el.matches("input, textarea, select")) { markDirty(); if (el.matches("[data-form-title]")) refreshTitle(); }
  });
  host.addEventListener("change", (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el || el.closest("[data-form-untracked]")) return;
    if (el.matches("input, textarea, select")) markDirty();
  });

  return {
    state,
    render,
    refreshTitle,
    refreshHeader() { const head = host.querySelector(".form-page-head"); if (head) head.outerHTML = headerHtml(); reflectDirty(); },
    markDirty,
    markClean,
    confirmLeave,
    save,
    installGuards,
  };
}
