import { describe, expect, it } from "vitest";
import { buildPreviewHtml, hydratePreviewMarkdown } from "../../public/static/admin-content-preview.js";

// ⚠️ Ligger i test/dom/ fordi hydratoren rører `document`. Enhetskonfigen kjører i node.

// ─────────────────────────────────────────────────────────────────────────────
// #1051: forfatteren skal se det samme som kandidaten — rendret markdown, ikke rå tegn.
//
// ⚠️ HVORFOR DET ER MER ENN KOSMETIKK. Deltakeren får nå server-rendret HTML. Ser forfatteren rå
// `## Oppgave` i sin forhåndsvisning, «retter» hen det ved å fjerne markdownen — og undergraver
// fiksen fra den andre siden. De to flatene må vise det samme, ellers lærer forfatteren feil.
//
// ⚠️ OG RENDRINGEN SKJER PÅ SERVEREN. Hydratoren poster til samme endepunkt som seksjonenes
// forhåndsvisning, så det er ett sanitiseringsregime. Testene under bruker en falsk apiFetch og
// måler bare det hydratoren selv er ansvarlig for.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1051 — hydratePreviewMarkdown", () => {
  const t = (k) => k;
  const tf = (k) => k;

  function monter(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  }

  it("⚠️ merker oppgavetekst og veiledning som markdown-kilder — det er kroken hydratoren trenger", () => {
    // Feltene ligger flatt på `data` — jeg gjettet en nøstet form først, og fikk null kilder.
    const html = buildPreviewHtml(
      { title: "T", taskText: "## A", candidateTaskConstraints: "- b", assessorExpectedContent: "c" },
      { locale: "nb", t, tf },
    );
    const el = monter(html);
    const kilder = el.querySelectorAll("[data-markdown-source]");
    expect(kilder.length, "oppgavetekst OG veiledning").toBe(2);
    // ⚠️ Teksten er ESCAPET før hydrering — så `textContent` gir råmarkdownen tilbake, og en
    // forfatter som skriver `<script>` ser den som tekst, ikke som kjørt kode.
    expect(kilder[0].textContent).toBe("## A");
  });

  it("⚠️ bytter til server-HTML, sanerer på nytt, og markerer blokka", async () => {
    const el = monter('<div class="preview-text-block" data-markdown-source>## A</div>');
    const kall = [];
    const apiFetch = async (sti, _h, opts) => {
      kall.push({ sti, body: JSON.parse(opts.body) });
      return { html: "<h2>A</h2><script>x()</script>" };
    };
    const sanert = [];
    const sanitize = (h) => { sanert.push(h); return h.replace(/<script>.*?<\/script>/g, ""); };

    await hydratePreviewMarkdown(el, { apiFetch, getHeaders: () => ({}), locale: "nb", sanitize });

    expect(kall[0].sti, "samme endepunkt som seksjonene — ett regime").toBe("/api/admin/content/sections/preview");
    expect(kall[0].body).toEqual({ markdown: "## A", locale: "nb" });
    expect(sanert.length, "klienten skal sanere selv om serveren svarte").toBe(1);
    const blokk = el.querySelector("[data-markdown-source]");
    expect(blokk.innerHTML).toBe("<h2>A</h2>");
    expect(blokk.classList.contains("is-rendered")).toBe(true);
  });

  it("⚠️ feiler kallet, står den escapede teksten igjen — aldri tom, aldri farlig", async () => {
    // Kontrollcase for det farlige utfallet: en hydrator som tømmer blokka ved feil ville gitt
    // forfatteren en blank forhåndsvisning hver gang nettet hikket.
    const el = monter('<div class="preview-text-block" data-markdown-source>## A</div>');
    const apiFetch = async () => { throw new Error("nede"); };
    await hydratePreviewMarkdown(el, { apiFetch, getHeaders: () => ({}), locale: "nb", sanitize: (h) => h });
    const blokk = el.querySelector("[data-markdown-source]");
    expect(blokk.textContent).toBe("## A");
    expect(blokk.classList.contains("is-rendered")).toBe(false);
  });

  it("⚠️ et sent svar fra en forrige render overskriver ikke en nyere", async () => {
    // To renders rett etter hverandre. Den første serveren er treg; den andre rask. Uten
    // løpenummeret ville den trege til slutt lagt GAMMEL HTML oppå den nye teksten.
    const el = monter('<div class="preview-text-block" data-markdown-source>gammel</div>');
    let slippTreg;
    const treg = new Promise((r) => { slippTreg = r; });
    const apiTreg = async () => { await treg; return { html: "<p>GAMMEL</p>" }; };
    const p1 = hydratePreviewMarkdown(el, { apiFetch: apiTreg, getHeaders: () => ({}), locale: "nb", sanitize: (h) => h });

    el.querySelector("[data-markdown-source]").textContent = "ny";
    await hydratePreviewMarkdown(el, { apiFetch: async () => ({ html: "<p>NY</p>" }), getHeaders: () => ({}), locale: "nb", sanitize: (h) => h });
    expect(el.querySelector("[data-markdown-source]").innerHTML).toBe("<p>NY</p>");

    slippTreg();
    await p1;
    expect(el.querySelector("[data-markdown-source]").innerHTML, "den trege skal ikke vinne").toBe("<p>NY</p>");
  });
});
