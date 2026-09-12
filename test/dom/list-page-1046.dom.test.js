// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createListPage } from "/static/list-page.js";

// #1046: ÉN listeside for Moduler, Kurs, Seksjoner og Klasser. Testen måler regelen der den bor:
// hodet, søket, filterknappene, kursfilteret, sorteringen, «Mer»-menyen og at filtre og søk tegner
// bare tabellen på nytt (søkefeltet beholder fokus). Sidene måles av e2e-testene.

const ITEMS = [
  { id: "a", name: "Bravo", status: "published", courses: [{ id: "k1", title: "Kurs 1" }], updatedAt: "2026-09-01" },
  { id: "b", name: "Alfa", status: "draft", courses: [], updatedAt: "2026-09-03" },
  { id: "c", name: "Charlie", status: "archived", courses: [{ id: "k2", title: "Kurs 2" }], updatedAt: "2026-08-01" },
];

const btn = (t, action) => `<button class="row-action-btn" data-action="${action}">${t}</button>`;

function lag(overrides = {}) {
  document.body.innerHTML = `<div id="host"></div>`;
  const host = document.getElementById("host");
  const kalt = [];
  const page = createListPage({
    host,
    ids: { tbody: "tb", search: "sok", courseFilter: "kf" },
    texts: {
      title: "Ting", lead: "Forklaring.", searchPlaceholder: "Søk…", searchLabel: "Søk", filterGroupLabel: "Filtrer",
      empty: "Ingen ting ennå.", emptyFiltered: "Ingen ting i denne visningen.", loadError: "Kunne ikke laste.",
    },
    headerActions: [{ id: "importBtn", label: "Importer" }, { id: "newBtn", label: "Ny ting", kind: "primary" }],
    filters: {
      options: [["all", "Alle"], ["active", "Aktive"], ["archived", "Arkiverte"]],
      initial: "active",
      matches: (it, key) => key === "all" || (key === "archived" ? it.status === "archived" : it.status !== "archived"),
    },
    courseFilter: { coursesOf: (it) => it.courses },
    search: { matches: (it, q) => it.name.toLowerCase().includes(q) || it.id.includes(q) },
    sort: { key: "name", dir: "asc" },
    columns: [
      { key: "name", label: "Navn", className: "col-name", sortValue: (it) => it.name, render: (it) => it.name },
      { key: "updatedAt", label: "Sist endret", className: "col-updated", sortValue: (it) => it.updatedAt, render: (it) => it.updatedAt },
    ],
    rowId: (it) => it.id,
    actions: () => [btn("Åpne", "open"), btn("Dupliser", "dup"), btn("Eksporter", "exp"), btn("Publiser", "pub"), btn("Arkiver", "arch")],
    load: async () => ITEMS,
    onAction: (action, id) => kalt.push(`${action}:${id}`),
    ...overrides,
  });
  return { host, page, kalt };
}

const navn = (host) => [...host.querySelectorAll("#tb tr td.col-name")].map((td) => td.textContent);

afterEach(() => { document.body.innerHTML = ""; });

describe("#1046 — den felles listesida", () => {
  it("hodet: tittel, forklaringslinje, sekundær til venstre og fylt hovedknapp ytterst til høyre", async () => {
    const { host, page } = lag();
    await page.reload();
    expect(host.querySelector("h1").textContent).toBe("Ting");
    expect(host.querySelector(".page-lead").textContent).toBe("Forklaring.");
    const knapper = [...host.querySelectorAll(".page-header-actions > *")];
    expect(knapper.map((k) => k.textContent)).toEqual(["Importer", "Ny ting"]);
    expect(knapper[1].classList.contains("btn-primary")).toBe(true);
  });

  it("«Aktive» er forhåndsvalgt og sorteringen er på navn; filterklikk og søk tegner bare tabellen", async () => {
    const { host, page } = lag();
    await page.reload();
    expect(navn(host)).toEqual(["Alfa", "Bravo"]);
    expect(host.querySelector('.list-filter-btn[data-filter="active"]').classList.contains("active")).toBe(true);

    const sok = host.querySelector("#sok");
    sok.focus();
    sok.value = "brav";
    sok.dispatchEvent(new Event("input", { bubbles: true }));
    expect(navn(host)).toEqual(["Bravo"]);
    // ⚠️ Selve poenget med å tegne bare tabellen: feltet er det samme elementet og har fortsatt fokus.
    expect(document.activeElement).toBe(sok);
    expect(host.querySelector("#sok")).toBe(sok);

    sok.value = "";
    sok.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector('.list-filter-btn[data-filter="archived"]').click();
    expect(navn(host)).toEqual(["Charlie"]);
    expect(host.querySelector("#sok")).toBe(sok);
  });

  it("kursfilteret bygges av elementenes kurs og komponerer med filterknappene", async () => {
    const { host, page } = lag();
    await page.reload();
    const kf = host.querySelector("#kf");
    expect([...kf.options].map((o) => o.textContent)).toEqual(["Alle kurs", "Kurs 1", "Kurs 2", "Ikke i noe kurs"]);
    kf.value = "__none__";
    kf.dispatchEvent(new Event("change", { bubbles: true }));
    expect(navn(host)).toEqual(["Alfa"]);
    host.querySelector('.list-filter-btn[data-filter="all"]').click();
    kf.value = "k2";
    kf.dispatchEvent(new Event("change", { bubbles: true }));
    expect(navn(host)).toEqual(["Charlie"]);
  });

  it("klikk i overskriften sorterer, og klikk til snur retningen", async () => {
    const { host, page } = lag();
    await page.reload();
    host.querySelector('th[data-sort-key="updatedAt"]').click();
    expect(navn(host)).toEqual(["Bravo", "Alfa"]);
    expect(host.querySelector('th[data-sort-key="updatedAt"]').getAttribute("aria-sort")).toBe("ascending");
    host.querySelector('th[data-sort-key="updatedAt"]').click();
    expect(navn(host)).toEqual(["Alfa", "Bravo"]);
  });

  it("raden viser tre handlinger pluss «Mer»; handlinger meldes med id", async () => {
    const { host, page, kalt } = lag();
    await page.reload();
    const rad = host.querySelector('#tb tr[data-row-id="b"]');
    expect(rad.querySelectorAll(":scope .row-actions > .row-action-btn").length).toBe(3);
    expect(rad.querySelector("details.row-more summary").textContent).toBe("Mer");
    rad.querySelector('details.row-more [data-action="arch"]').click();
    expect(kalt).toEqual(["arch:b"]);
  });

  it("tom-tilstander: egen når ingenting finnes, filtrert tekst når filtrene skjuler alt", async () => {
    const tom = lag({ load: async () => [], emptyHtml: () => `<div class="empty-state" id="egen">Ingenting</div>` });
    await tom.page.reload();
    expect(tom.host.querySelector("#egen")).toBeTruthy();
    expect(tom.host.querySelector("#sok")).toBeNull();

    const { host, page } = lag();
    await page.reload();
    const sok = host.querySelector("#sok");
    sok.value = "finnes ikke";
    sok.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.querySelector(".empty-state").textContent).toBe("Ingen ting i denne visningen.");
  });
});

describe("#1046 — ingen side har sin egen listeside lenger", () => {
  const root = path.resolve(__dirname, "../..");
  const les = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

  it("alle fire listesidene bruker createListPage", () => {
    for (const fil of ["library", "courses", "sections", "classes"]) {
      const js = les(`public/static/admin-content-${fil}.js`);
      expect(js, `${fil}: skal bruke den felles listesida`).toContain("createListPage({");
      expect(js, `${fil}: skal ikke tegne egne filterknapper`).not.toMatch(/list-filter-btn|library-filter-btn/);
      expect(js, `${fil}: skal ikke tegne egen listetabell`).not.toMatch(/<table class="(library|courses|sections|classes)-table/);
    }
  });

  it("ingen av de fire sidene definerer sidehode, filterknapper, kursfilter eller tabelloverskrifter selv", () => {
    for (const fil of ["library", "courses", "sections", "classes"]) {
      const html = les(`public/admin-content-${fil}.html`);
      for (const regel of [/\.page-header\s*\{/, /\.page-lead\s*\{/, /filter-btn\s*\{/, /-table th\s*\{/, /-course-select\s*\{/, /\.list-search\s*\{/, /\.empty-state\s*\{/]) {
        expect(html, `${fil}: ${regel} skal bare finnes i shared.css`).not.toMatch(regel);
      }
    }
  });
});
