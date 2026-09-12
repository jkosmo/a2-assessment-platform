// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormPage } from "/static/form-page.js";

// #1046 nivå to: ÉN skjemaside for det åpnede elementet. Testen måler regelen der den bor: navnet som
// tittel med typemerke over, «Alt lagret / Ulagrede endringer», Lagre som bare virker når noe er
// endret, handlingsraden, språkpillene med «(påkrevd)», og spørsmålet før man forlater.

const TEXTS = {
  back: "← Tilbake til ting", typeLabel: "Ting", untitled: "Ny ting", savedAll: "Alt lagret", unsaved: "Ulagrede endringer",
  save: "Lagre", cancel: "Avbryt", leaveConfirm: "Forlate uten å lagre?", contentLocale: "Innholdsspråk:", required: "(påkrevd)",
};

function lag(overrides = {}) {
  document.body.innerHTML = `<div id="host"></div><a id="ut" href="/annet">ut</a>`;
  const host = document.getElementById("host");
  const model = { name: "Bravo", lifecycle: "published", locale: "nb" };
  const onSave = vi.fn(async () => true);
  const page = createFormPage({
    host,
    texts: TEXTS,
    backHref: "/ting",
    title: () => document.getElementById("navn")?.value ?? model.name,
    item: () => model,
    t: (k) => ({ "adminContent.lifecycle.status.published": "Publisert" }[k] ?? k),
    actions: () => [`<button class="row-action-btn" data-action="a">A</button>`, `<button class="row-action-btn" data-action="b">B</button>`],
    languages: { locales: ["nb", "nn", "en-GB"], labels: { nb: "Bokmål", nn: "Nynorsk", "en-GB": "English" }, current: () => model.locale, onChange: (l) => { model.locale = l; }, required: "nb" },
    body: () => `<div class="card"><div class="form-field"><label for="navn">Navn</label><input id="navn" data-form-title value="${model.name}"></div>
      <div data-form-untracked><input id="sok"></div></div>`,
    save: { onSave },
    ...overrides,
  });
  page.render();
  return { host, page, model, onSave };
}

const skriv = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("#1046 nivå to — den felles skjemasida", () => {
  it("hodet: tilbake-lenke, typemerke over navnet, statusmerke, «Alt lagret», handlingsrad", () => {
    const { host } = lag();
    expect(host.querySelector("#formBackLink").textContent).toBe("← Tilbake til ting");
    expect(host.querySelector(".form-page-type").textContent).toBe("Ting");
    expect(host.querySelector("#formPageTitle").textContent).toBe("Bravo");
    expect(host.querySelector(".status-badge--published")).toBeTruthy();
    expect(host.querySelector("#formPageDirty").textContent).toBe("Alt lagret");
    expect(host.querySelectorAll(".form-page-actions .row-action-btn").length).toBe(2);
  });

  it("tomt navn viser «Ny ting» dempet; skriving i navnefeltet oppdaterer tittelen", () => {
    const { host } = lag({ title: () => document.getElementById("navn")?.value ?? "" });
    const navn = host.querySelector("#navn");
    skriv(navn, "");
    expect(host.querySelector("#formPageTitle").textContent).toBe("Ny ting");
    expect(host.querySelector("#formPageTitle").classList.contains("is-untitled")).toBe(true);
    skriv(navn, "Charlie");
    expect(host.querySelector("#formPageTitle").textContent).toBe("Charlie");
  });

  it("Lagre er av til noe er endret; endring gir «Ulagrede endringer»; lagring gir «Alt lagret» igjen", async () => {
    const { host, page, onSave } = lag();
    const btn = host.querySelector("#formSaveBtn");
    expect(btn.disabled).toBe(true);
    skriv(host.querySelector("#navn"), "Bravo 2");
    expect(host.querySelector("#formPageDirty").textContent).toBe("Ulagrede endringer");
    expect(btn.disabled).toBe(false);
    await page.save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(host.querySelector("#formPageDirty").textContent).toBe("Alt lagret");
    expect(btn.disabled).toBe(true);
  });

  it("felt merket data-form-untracked (søk, operasjoner) gjør ikke skjemaet ulagret", () => {
    const { host } = lag();
    skriv(host.querySelector("#sok"), "kari");
    expect(host.querySelector("#formPageDirty").textContent).toBe("Alt lagret");
  });

  it("mislykket lagring lar skjemaet stå som ulagret", async () => {
    const { host, page } = lag({ save: { onSave: async () => false } });
    skriv(host.querySelector("#navn"), "x");
    await page.save();
    expect(host.querySelector("#formPageDirty").textContent).toBe("Ulagrede endringer");
  });

  it("språkpiller: bokmål først med «(påkrevd)», klikk bytter språk", () => {
    const { host, model } = lag();
    const piller = [...host.querySelectorAll("[data-form-locale]")];
    expect(piller.map((p) => p.dataset.formLocale)).toEqual(["nb", "nn", "en-GB"]);
    expect(piller[0].textContent).toContain("(påkrevd)");
    piller[2].click();
    expect(model.locale).toBe("en-GB");
    expect(piller[2].classList.contains("active")).toBe(true);
    expect(piller[0].classList.contains("active")).toBe(false);
  });

  it("⚠️ spør før man forlater med ulagrede endringer — og lar en være når svaret er nei", () => {
    const { host, page } = lag();
    page.installGuards();
    skriv(host.querySelector("#navn"), "x");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("ut").dispatchEvent(ev);
    expect(confirm).toHaveBeenCalledWith("Forlate uten å lagre?");
    expect(ev.defaultPrevented).toBe(true);
    // Uten endringer: ingen spørsmål.
    page.markClean();
    const ev2 = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("ut").dispatchEvent(ev2);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
