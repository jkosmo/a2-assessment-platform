// #1046 (produkteier 12.09, «la oss se nærmere på underliggende skjema»): ÉN listeside for
// forfatterflaten. Moduler, Kurs, Seksjoner og Klasser var fire håndskrevne utgaver av samme side —
// sidehode, søk, filterknapper, kursfilter, tabell, rader, radhandlinger, klikk, tom-tilstand — og
// hver runde av #1046 rettet samme ting fire steder. Dybden varierte også: Moduler filtrerte i
// minnet, Kurs og Seksjoner hentet hele lista på nytt ved hvert filterklikk.
//
// Denne modulen eier alt som er likt. Hver side leverer en OPPSKRIFT (config): hvilke kolonner,
// hvordan lese status, hvilke handlinger, tekstene, og hvilket API-kall som henter lista.
//
// Regler som bor her (og bare her):
// - Hodet: tittel, én forklaringslinje, sekundære knapper til venstre, fylt hovedknapp ytterst
//   til høyre (A1–A3).
// - Søk over filterknappene, venstrejustert; treffer navn og ID (B1).
// - Filterknapper i rekkefølgen sida oppgir; kursfilter på samme linje, til høyre (B2, B4).
// - Alt filtreres i minnet. Lista hentes én gang, og på nytt bare når sida ber om det (B5).
// - Sortering på klikk i kolonneoverskriften, for kolonner som oppgir `sortValue` (C3).
// - Tabellen i det hvite kortet med felles overskrifter (`.list-table`, C1/C2).
// - Radhandlinger gjennom rowActionsHtml: maks fire i raden, resten under «Mer» (D5).
// - Søk og filtre tegner bare tabellen på nytt, så søkefeltet beholder fokus.
//
// Det som er sidens eget — dialoger, popovere, hva en handling gjør — blir værende på sida og
// nås gjennom `onAction`, `onClick` og `afterRender`.

import { escapeHtml } from "./html-escape.js";
import { rowActionsHtml, installRowMoreMenus } from "./row-actions.js";
import { matchesLifecycleFilter } from "./content-status-badge.js";

/**
 * @typedef {object} ListPageColumn
 * @property {string} key
 * @property {string} label            synlig overskrift ("" gir skjult overskrift + skjermlesertekst)
 * @property {string} [srLabel]        skjermlesertekst når label er tom
 * @property {string} [className]      klasse på th og td (col-name, col-status, …)
 * @property {string} [title]          title-attributt på th
 * @property {(item: any) => string} render  ferdig HTML for cellen
 * @property {(item: any) => string|number|null} [sortValue]  gjør kolonnen sorterbar
 */

/**
 * @typedef {object} ListPageConfig
 * @property {HTMLElement} host
 * @property {{ tbody: string, search?: string, courseFilter?: string, listBody?: string }} ids
 * @property {{ title: string, lead: string, searchPlaceholder?: string, searchLabel?: string,
 *   filterGroupLabel: string, courseFilterLabel?: string, courseFilterAll?: string, courseFilterNone?: string,
 *   empty: string, emptyFiltered?: string, more?: string, sortHint?: string, loadError: string }} texts
 * @property {Array<{ id: string, label: string, kind?: "primary"|"secondary", href?: string, title?: string, hidden?: boolean }>} headerActions
 * @property {string} [headerExtraHtml]   f.eks. skjulte filfelt
 * @property {{ options: Array<[string, string]>, initial: string, matches?: (item: any, key: string) => boolean }} filters
 * @property {{ coursesOf: (item: any) => Array<{ id: string, title: string }> }} [courseFilter]
 * @property {{ matches: (item: any, q: string) => boolean }} [search]
 * @property {{ key: string, dir: "asc"|"desc", locale?: () => string }} [sort]
 * @property {ListPageColumn[]} columns
 * @property {(item: any) => string} rowId
 * @property {(item: any) => string} [rowAttrs]
 * @property {(item: any) => Array<string|null|undefined|false>} actions
 * @property {() => Promise<any[]>} load
 * @property {(err: unknown) => string} [describeError]  sidens egen oversettelse av en lastefeil (api-error.js)
 * @property {(action: string, id: string, btn: HTMLElement, item: any, event: Event) => void} onAction
 * @property {(event: Event) => boolean} [onClick]   andre klikk i lista (returner true når håndtert)
 * @property {(items: any[]) => void} [afterRender]  kjøres etter at hodet er tegnet — bind hode-knapper her
 * @property {(items: any[]) => string} [emptyHtml]  egen tom-tilstand når det ikke finnes noen elementer i det hele tatt
 */

// Tekster, hodeknapper, filtervalg og kolonner kan gis som funksjoner, så en side med språkvelger
// får nye tekster ved neste tegning uten å bygge sida på nytt.
const resolve = (x) => (typeof x === "function" ? x() : x);

/** @param {ListPageConfig} config */
export function createListPage(config) {
  const { host, ids } = config;
  let texts = resolve(config.texts);
  let columns = resolve(config.columns);
  const state = {
    filter: config.filters.initial,
    search: "",
    course: "__all__",
    sortKey: config.sort?.key ?? null,
    sortDir: config.sort?.dir ?? "asc",
    items: /** @type {any[]} */ ([]),
    loaded: false,
  };
  const listBodyId = ids.listBody ?? `${ids.tbody}Host`;
  const locale = () => config.sort?.locale?.() ?? undefined;

  installRowMoreMenus();

  function visibleItems() {
    let result = state.items;
    const q = state.search.trim().toLowerCase();
    if (q && config.search) result = result.filter((item) => config.search.matches(item, q));
    if (config.courseFilter) {
      if (state.course === "__none__") result = result.filter((item) => config.courseFilter.coursesOf(item).length === 0);
      else if (state.course !== "__all__") result = result.filter((item) => config.courseFilter.coursesOf(item).some((c) => c && c.id === state.course));
    }
    // #1046 steg B: filterknappene leser tjenerens `lifecycle` — én regel for alle listene. En side
    // oppgir bare `matches` når den har et filter som ikke er en tilstand.
    const matches = config.filters.matches ?? matchesLifecycleFilter;
    result = result.filter((item) => matches(item, state.filter));
    const col = state.sortKey ? columns.find((c) => c.key === state.sortKey && c.sortValue) : null;
    if (col) {
      const dir = state.sortDir === "desc" ? -1 : 1;
      result = [...result].sort((a, b) => {
        const va = col.sortValue(a);
        const vb = col.sortValue(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), locale());
        return cmp * dir;
      });
    }
    return result;
  }

  function courseFilterOptions() {
    const seen = new Map();
    for (const item of state.items) {
      for (const c of config.courseFilter.coursesOf(item)) {
        if (c && c.id && !seen.has(c.id)) seen.set(c.id, c.title ?? c.id);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], locale()));
  }

  function headerHtml() {
    const headerActions = resolve(config.headerActions);
    const secondary = headerActions.filter((a) => (a.kind ?? "secondary") !== "primary" && !a.hidden);
    const primary = headerActions.filter((a) => a.kind === "primary" && !a.hidden);
    const btn = (a) => {
      const cls = `btn ${a.kind === "primary" ? "btn-primary" : "btn-secondary"}`;
      const title = a.title ? ` title="${escapeHtml(a.title)}"` : "";
      return a.href
        ? `<a id="${escapeHtml(a.id)}" href="${escapeHtml(a.href)}" class="${cls}"${title}>${escapeHtml(a.label)}</a>`
        : `<button type="button" id="${escapeHtml(a.id)}" class="${cls}" style="width:auto"${title}>${escapeHtml(a.label)}</button>`;
    };
    return `<div class="page-header">
      <div>
        <h1>${escapeHtml(texts.title)}</h1>
        <p class="page-lead">${escapeHtml(texts.lead)}</p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">${[...secondary, ...primary].map(btn).join("")}${config.headerExtraHtml ?? ""}</div>
    </div>`;
  }

  function toolbarHtml() {
    const search = config.search
      ? `<input id="${escapeHtml(ids.search ?? `${ids.tbody}Search`)}" type="search" class="list-search" value="${escapeHtml(state.search)}" placeholder="${escapeHtml(texts.searchPlaceholder ?? "")}" aria-label="${escapeHtml(texts.searchLabel ?? texts.searchPlaceholder ?? "")}" />`
      : "";
    const pills = `<div class="list-filters" role="group" aria-label="${escapeHtml(texts.filterGroupLabel)}">${resolve(config.filters.options)
      .map(([key, label]) => `<button type="button" class="list-filter-btn${state.filter === key ? " active" : ""}" data-filter="${escapeHtml(key)}">${escapeHtml(label)}</button>`)
      .join("")}</div>`;
    let course = "";
    if (config.courseFilter) {
      const opts = courseFilterOptions();
      const valid = new Set(["__all__", "__none__", ...opts.map(([id]) => id)]);
      if (!valid.has(state.course)) state.course = "__all__";
      const cfId = ids.courseFilter ?? `${ids.tbody}CourseFilter`;
      course = `<div class="list-course-filter"><label for="${escapeHtml(cfId)}">${escapeHtml(texts.courseFilterLabel ?? "Kurs:")}</label><select id="${escapeHtml(cfId)}" class="list-course-select">
        <option value="__all__"${state.course === "__all__" ? " selected" : ""}>${escapeHtml(texts.courseFilterAll ?? "Alle kurs")}</option>
        ${opts.map(([id, title]) => `<option value="${escapeHtml(id)}"${id === state.course ? " selected" : ""}>${escapeHtml(title)}</option>`).join("")}
        <option value="__none__"${state.course === "__none__" ? " selected" : ""}>${escapeHtml(texts.courseFilterNone ?? "Ikke i noe kurs")}</option>
      </select></div>`;
    }
    return `${search}<div class="list-filters-row">${pills}${course}</div>`;
  }

  function tableHtml(visible) {
    if (visible.length === 0) {
      const text = state.items.length === 0 ? texts.empty : (texts.emptyFiltered ?? texts.empty);
      return `<div class="empty-state"><p class="empty-state-text">${escapeHtml(text)}</p></div>`;
    }
    const ths = columns.map((col) => {
      const sortable = Boolean(col.sortValue);
      const active = sortable && state.sortKey === col.key;
      const cls = [col.className ?? "", sortable ? "sortable" : "", active ? `sort-${state.sortDir}` : ""].filter(Boolean).join(" ");
      const label = col.label
        ? escapeHtml(col.label)
        : `<span class="sr-only">${escapeHtml(col.srLabel ?? "")}</span>`;
      const indicator = sortable ? ` <span class="sort-indicator" aria-hidden="true">${active ? (state.sortDir === "asc" ? "↑" : "↓") : "↕"}</span>` : "";
      const aria = sortable ? ` aria-sort="${active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none"}"` : "";
      const title = col.title ? ` title="${escapeHtml(col.title)}"` : sortable && texts.sortHint ? ` title="${escapeHtml(texts.sortHint)}"` : "";
      const data = sortable ? ` data-sort-key="${escapeHtml(col.key)}"` : "";
      return `<th scope="col"${cls ? ` class="${cls}"` : ""}${aria}${title}${data}>${label}${indicator}</th>`;
    }).join("");
    const rows = visible.map((item) => {
      const tds = columns.map((col) => `<td${col.className ? ` class="${col.className}"` : ""}>${col.render(item)}</td>`).join("");
      const actions = rowActionsHtml(config.actions(item), { moreLabel: texts.more ?? "Mer" });
      return `<tr data-row-id="${escapeHtml(config.rowId(item))}"${config.rowAttrs ? ` ${config.rowAttrs(item)}` : ""}>${tds}<td class="col-actions"><div class="row-actions">${actions}</div></td></tr>`;
    }).join("");
    return `<div class="list-table-wrap"><table class="list-table" aria-label="${escapeHtml(texts.title)}">
      <thead><tr>${ths}<th scope="col" class="col-actions"><span class="sr-only">Handlinger</span></th></tr></thead>
      <tbody id="${escapeHtml(ids.tbody)}">${rows}</tbody></table></div>`;
  }

  function renderTable() {
    const body = document.getElementById(listBodyId);
    if (body) body.innerHTML = tableHtml(visibleItems());
  }

  function renderAll() {
    texts = resolve(config.texts);
    columns = resolve(config.columns);
    if (state.items.length === 0 && config.emptyHtml) {
      host.innerHTML = headerHtml() + config.emptyHtml(state.items);
      config.afterRender?.(state.items);
      return;
    }
    host.innerHTML = `${headerHtml()}${toolbarHtml()}<div id="${escapeHtml(listBodyId)}">${tableHtml(visibleItems())}</div>`;
    config.afterRender?.(state.items);
  }

  // Én lytter på verten. Den overlever at tabellen (og hele sida) tegnes på nytt.
  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const pill = target.closest(".list-filters [data-filter]");
    if (pill && host.contains(pill)) {
      state.filter = pill.dataset.filter;
      for (const b of host.querySelectorAll(".list-filters [data-filter]")) b.classList.toggle("active", b === pill);
      renderTable();
      return;
    }
    const th = target.closest("th[data-sort-key]");
    if (th && host.contains(th)) {
      const key = th.dataset.sortKey;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = "asc"; }
      renderTable();
      return;
    }
    if (config.onClick?.(event)) return;
    const btn = target.closest("[data-action]");
    if (btn && host.contains(btn) && btn.closest("tbody")?.id === ids.tbody) {
      const row = btn.closest("tr[data-row-id]");
      const id = row?.dataset.rowId ?? "";
      const item = state.items.find((it) => config.rowId(it) === id) ?? null;
      config.onAction(btn.dataset.action, id, btn, item, event);
    }
  });
  host.addEventListener("input", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.id === (ids.search ?? `${ids.tbody}Search`)) {
      state.search = /** @type {HTMLInputElement} */ (target).value;
      renderTable();
    }
  });
  host.addEventListener("change", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.id === (ids.courseFilter ?? `${ids.tbody}CourseFilter`)) {
      state.course = /** @type {HTMLSelectElement} */ (target).value;
      renderTable();
    }
  });

  return {
    state,
    get items() { return state.items; },
    /** Hent lista på nytt og tegn hele sida. */
    async reload() {
      try {
        state.items = await config.load();
        state.loaded = true;
      } catch (err) {
        // Serverens tekst vises aldri rått: sida oversetter den (describeApiError) gjennom `describeError`.
        const detalj = config.describeError ? config.describeError(err) : "";
        host.innerHTML = `<div class="empty-state"><p class="empty-state-title">${escapeHtml(texts.loadError)}</p>${detalj ? `<p class="empty-state-text">${escapeHtml(detalj)}</p>` : ""}</div>`;
        throw err;
      }
      renderAll();
      return state.items;
    },
    /** Tegn hele sida på nytt med det som alt er hentet (f.eks. etter språkbytte). */
    rerender() { renderAll(); },
    /** Tegn bare tabellen på nytt. */
    renderTable,
    /** Erstatt lista uten å hente (etter en handling som alt vet svaret). */
    setItems(items) { state.items = items; renderTable(); },
    visibleItems,
  };
}
