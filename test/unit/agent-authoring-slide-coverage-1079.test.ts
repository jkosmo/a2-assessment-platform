import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSlideCoverage, countForms, formatCoverage } from "../../skills/a2-authoring-api/scripts/slide-coverage.mjs";

// #1079: lysarklista forfatteren godkjenner ved port 3 er et løfte per lysark. Uten en kontroll
// holdes løftet bare av modellens hukommelse — og målingen 2026-10-05 viste hva det gir: begge
// produktene leverte tre figurer av samme type, og kort, striper og ikoner forsvant uten at noen
// sa fra. Skriptet leser lista ved siden av pakken og melder hvert lysark som ikke fikk det lista sier.

const EKSEMPEL = "skills/a2-authoring-api/examples/course-from-slides";
const FENCE = "```";
const b64 = (tekst: string) => Buffer.from(tekst, "utf8").toString("base64");
const FIGUR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="10" y="20">Motta saken</text></svg>`;
const IKON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path d="M0 0h10"/></svg>`;

function seksjon(clientRef: string, markdown: string, assets: unknown[] = []) {
  return { clientRef, type: "section", payload: { title: { nb: "Tittel" }, bodyMarkdown: { nb: markdown, nn: "nn", "en-GB": "en" }, assets } };
}
const modul = (clientRef: string, stem: string) => ({
  clientRef,
  type: "module",
  payload: { module: { title: "Test" }, activeVersion: { assessmentMode: "MCQ_ONLY", mcqSet: { questions: [{ stem, options: ["a", "b", "c"], correctAnswer: "a" }] } } },
});
const pakke = (...objects: unknown[]) => ({ packageFormat: "a2-authoring-package/v1", locale: "nb", objects });
const feil = (liste: unknown, pkg: unknown, valg?: Parameters<typeof checkSlideCoverage>[2]) => {
  const r = checkSlideCoverage(liste, pkg, valg);
  return [...r.rows.flatMap((rad) => rad.problems), ...r.problems];
};

describe("countForms — hva en seksjonstekst inneholder (#1079)", () => {
  it("teller prompt-bokser, tabeller, uthevede bokser og kortoverskrifter", () => {
    const tekst = [
      "## Del",
      "### Kort 1",
      "- punkt",
      "### Kort 2",
      "> **Husk:** én ting.",
      "> fortsetter her",
      "",
      `${FENCE}prompt`,
      "Skriv et referat.",
      FENCE,
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    expect(countForms(tekst)).toEqual({ prompt: 1, table: 1, callout: 1, cards: 2 });
  });

  it("en tabell skrevet inni en prompt hører til prompten", () => {
    const tekst = [`${FENCE}prompt`, "| A | B |", "|---|---|", "### ikke et kort", "> **Husk:** ikke en boks", FENCE].join("\n");
    expect(countForms(tekst)).toEqual({ prompt: 1, table: 0, callout: 0, cards: 0 });
  });

  it("ett sitat er én boks, også når en senere linje i det åpner med fet skrift", () => {
    expect(countForms(["> **Husk:** a", "> **Og** b"].join("\n")).callout).toBe(1);
  });

  it("et sitat uten fet merkelapp er ikke en uthevet boks, og to sitater er to bokser", () => {
    expect(countForms("> bare et sitat").callout).toBe(0);
    expect(countForms("> **Husk:** a\n\n> **Tips:** b").callout).toBe(2);
  });

  it("tilde-gjerder teller, og et gjerde av den andre typen inni en blokk lukker den ikke", () => {
    expect(countForms(["~~~", FENCE, "tekst", FENCE, "~~~"].join("\n")).prompt).toBe(1);
  });

  it("en overskrift på nivå to er en del, ikke et kort", () => {
    expect(countForms("## Del\n\n#### Kort").cards).toBe(1);
  });
});

describe("checkSlideCoverage — fikk hvert lysark det lista sier? (#1079)", () => {
  const helSeksjon = seksjon(
    "sec-a",
    ["![Flyt](asset:fig)", "### ![](asset:ikon) Kort 1", "### Kort 2", "> **Husk:** Du står ansvarlig.", `${FENCE}prompt`, "Skriv et referat.", FENCE, "| A | B |", "|---|---|", "![Innstillinger](asset:img)"].join("\n"),
    [
      { sourceId: "fig", filename: "flyt.svg", mimeType: "image/svg+xml", contentBase64: b64(FIGUR) },
      { sourceId: "ikon", filename: "image7.svg", mimeType: "image/svg+xml", contentBase64: b64(IKON) },
      { sourceId: "img", filename: "slide-04-1.png", mimeType: "image/png", contentBase64: "AAAA" },
    ],
  );
  const alt = { slide: 2, becomes: ["figure", "cards", "callout", "prompt", "table", "image", "text"], in: "sec-a", images: ["slide-04-1.png"] };

  it("eksempelkurset i skillet går gjennom — eksempelet kan ikke lære bort noe skriptet avviser", () => {
    const liste = JSON.parse(readFileSync(`${EKSEMPEL}/treatment.json`, "utf8"));
    const pkg = JSON.parse(readFileSync(`${EKSEMPEL}/package.json`, "utf8"));
    const r = checkSlideCoverage(liste, pkg, { baseDir: EKSEMPEL });
    expect(feil(liste, pkg, { baseDir: EKSEMPEL })).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(7);
  });

  it("en seksjon som har alle formene, dekker et lysark som skulle bli alle", () => {
    expect(feil({ slides: [alt] }, pakke(helSeksjon))).toEqual([]);
  });

  it("en tom liste er ikke en godkjent liste", () => {
    expect(checkSlideCoverage({ slides: [] }, pakke(helSeksjon)).ok).toBe(false);
    expect(checkSlideCoverage({}, pakke()).ok).toBe(false);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["lysarknummer mangler", { becomes: ["text"], in: "sec-a" }, "`slide` must be the slide's number"],
    ["ingenting sagt om hva det blir", { slide: 3, becomes: [] }, "`becomes` is empty"],
    ["en form som ikke finnes", { slide: 3, becomes: ["infographic"], in: "sec-a" }, "unknown form: infographic"],
    ["utelatt uten grunn", { slide: 3, becomes: ["omitted"] }, "an omitted slide needs `why`"],
    ["utelatt med tom grunn", { slide: 3, becomes: ["omitted"], why: "  " }, "an omitted slide needs `why`"],
    ["utelatt og samtidig noe annet", { slide: 3, becomes: ["omitted", "text"], why: "pynt" }, "`omitted` stands alone"],
    ["sier ikke hvor det havnet", { slide: 3, becomes: ["text"] }, "`in` is missing"],
    ["peker på noe som ikke er i pakken", { slide: 3, becomes: ["text"], in: "sec-finnes-ikke" }, `"sec-finnes-ikke" is not in the package`],
    ["kort i en modul", { slide: 3, becomes: ["cards"], in: "mod-a" }, `cards can only stand in a section, and "mod-a" is a module`],
    ["oppgave i en seksjon", { slide: 3, becomes: ["task"], in: "sec-a" }, `a task belongs in a module, and "sec-a" is a section`],
    ["bilde uten filnavn", { slide: 3, becomes: ["image"], in: "sec-a" }, "`images` lists no file"],
    ["filnavn uten at lysarket skulle bli bilde", { slide: 3, becomes: ["text"], in: "sec-a", images: ["slide-04-1.png"] }, "`becomes` does not include image"],
    ["bildet er ikke i seksjonen", { slide: 3, becomes: ["image"], in: "sec-a", images: ["slide-09-1.png"] }, `the picture slide-09-1.png is not in "sec-a"`],
    ["uttrykket står ikke i teksten", { slide: 3, becomes: ["text"], in: "sec-a", phrases: ["kontekstvinduet"] }, `not found in "sec-a": «kontekstvinduet»`],
  ])("%s", (_navn, rad, ventet) => {
    const alle = feil({ slides: [alt, rad] }, pakke(helSeksjon, modul("mod-a", "Hva kommer først?")));
    expect(alle.filter((f) => f.includes(ventet)), alle.join(" | ")).toHaveLength(1);
  });

  it("læringsmål-lysarket trenger ikke noe sted — det ble port 2", () => {
    expect(feil({ slides: [alt, { slide: 3, becomes: ["objectives"] }] }, pakke(helSeksjon))).toEqual([]);
  });

  describe("formen må faktisk være der", () => {
    const bare = (markdown: string, assets: unknown[] = []) => pakke(seksjon("sec-a", markdown, assets));
    const rad = (form: string) => ({ slides: [{ slide: 5, becomes: [form], in: "sec-a" }] });

    it.each<[string, string, string]>([
      ["cards", "### Bare ett kort", "has 1 card heading (### …) — a group of cards is at least two"],
      ["callout", "> et vanlig sitat", "has 0 highlighted box (> **Label:** …)s"],
      ["prompt", "Skriv et referat.", "has 0 prompt box (a fenced block)s"],
      ["table", "- en liste", "has 0 tables"],
      ["figure", "Bare tekst.", "has 0 figure with labels shown in the texts"],
    ])("%s som ble til noe annet, meldes", (form, markdown, ventet) => {
      expect(feil(rad(form), bare(markdown)).join(" | ")).toContain(ventet);
    });

    it("et ikon er ikke en figur: SVG uten etiketter dekker ikke et lysark som skulle bli figur", () => {
      const pkg = bare("![](asset:ikon)", [{ sourceId: "ikon", filename: "image7.svg", mimeType: "image/svg+xml", contentBase64: b64(IKON) }]);
      expect(feil(rad("figure"), pkg).join(" | ")).toContain("has 0 figure");
    });

    it("en figur som ligger i seksjonen uten å vises i teksten, teller ikke", () => {
      const pkg = bare("Bare tekst.", [{ sourceId: "fig", filename: "flyt.svg", mimeType: "image/svg+xml", contentBase64: b64(FIGUR) }]);
      expect(feil(rad("figure"), pkg).join(" | ")).toContain("has 0 figure");
    });

    it("to lysark som skulle bli figur i samme seksjon, trenger to figurer", () => {
      const liste = { slides: [{ slide: 4, becomes: ["figure"], in: "sec-a" }, { slide: 7, becomes: ["figure"], in: "sec-a" }] };
      const r = checkSlideCoverage(liste, pakke(helSeksjon));
      expect(r.rows[0]!.problems).toEqual([]);
      expect(r.rows[1]!.problems.join(" ")).toContain(`is slide number 2 that was to become figure in "sec-a", which has 1`);
    });

    it("to lysark med kort trenger fire kortoverskrifter", () => {
      const liste = { slides: [{ slide: 4, becomes: ["cards"], in: "sec-a" }, { slide: 5, becomes: ["cards"], in: "sec-a" }] };
      expect(checkSlideCoverage(liste, bare("### A\n### B\n### C")).rows[1]!.problems).toHaveLength(1);
      expect(checkSlideCoverage(liste, bare("### A\n### B\n### C\n### D")).ok).toBe(true);
    });
  });

  describe("uttrykk fra lysarket", () => {
    const pkg = pakke(
      seksjon("sec-a", "Bruk **Grundig   tenkemodus** når «Lerret» ikke holder – ellers chat.", [
        { sourceId: "fig", filename: "flyt.svg", mimeType: "image/svg+xml", contentBase64: b64(FIGUR) },
      ]),
      modul("mod-a", "Hva kommer først i formen prompten ber om?"),
    );
    const med = (inn: string, ...phrases: string[]) => ({ slides: [{ slide: 5, becomes: [inn === "mod-a" ? "task" : "text"], in: inn, phrases }] });

    it("finnes uavhengig av utheving, store bokstaver, mellomrom, anførselstegn og tankestrek", () => {
      expect(feil(med("sec-a", "grundig tenkemodus", "Lerret", "holder - ellers"), pkg)).toEqual([]);
    });

    it("finnes når uthevingen står midt i uttrykket, og når anførselstegnene er av en annen type", () => {
      const tekst = pakke(seksjon("sec-a", '**Bruk når** møtet fulgte en plan. Skriv "uklart" der notatene tier.'));
      expect(feil(med("sec-a", "Bruk når møtet fulgte", "Skriv «uklart» der"), tekst)).toEqual([]);
    });

    it("finnes også når det bare står som etikett i en figur", () => {
      expect(feil(med("sec-a", "Motta saken"), pkg)).toEqual([]);
    });

    it("leses fra figurfila når pakken ennå peker på filer", () => {
      const liste = { slides: [{ slide: 2, becomes: ["figure"], in: "sec-arbeidsgang", phrases: ["Samle", "Etter"] }] };
      const eksempel = JSON.parse(readFileSync(`${EKSEMPEL}/package.json`, "utf8"));
      eksempel.objects = eksempel.objects.filter((o: { clientRef: string }) => o.clientRef === "sec-arbeidsgang");
      expect(feil(liste, eksempel, { baseDir: EKSEMPEL })).toEqual([]);
      // Uten riktig mappe finnes ikke fila: da er det ingen figur med etiketter, og det meldes.
      expect(feil(liste, eksempel, { baseDir: "finnes-ikke" }).join(" | ")).toContain("has 0 figure");
    });

    it("letes etter i modulen når lysarket ble en oppgave", () => {
      expect(feil(med("mod-a", "Hva kommer først"), pkg)).toEqual([]);
      expect(feil(med("mod-a", "Grundig tenkemodus"), pkg)).toHaveLength(1);
    });

    it("filnavn og base64 er ikke tekst: et uttrykk finnes ikke fordi en fil heter det", () => {
      expect(feil(med("sec-a", "flyt.svg"), pkg)).toHaveLength(1);
    });
  });

  describe("bilder", () => {
    it("et bilde som er i seksjonen uten å vises i teksten, meldes", () => {
      const pkg = pakke(seksjon("sec-a", "Tekst.", [{ sourceId: "img", filename: "slide-04-1.png", mimeType: "image/png", contentBase64: "AAAA" }]));
      const liste = { slides: [{ slide: 4, becomes: ["image"], in: "sec-a", images: ["slide-04-1.png"] }] };
      expect(feil(liste, pkg).join(" | ")).toContain("is not shown in the text");
    });

    it("den andre veien: et bilde i kurset som ingen lysark lister, er aldri vist for forfatteren", () => {
      const pkg = pakke(seksjon("sec-a", "![x](asset:img)", [{ sourceId: "img", file: "deck/images/slide-09-2.png" }]));
      const r = checkSlideCoverage({ slides: [{ slide: 9, becomes: ["text"], in: "sec-a" }] }, pkg);
      expect(r.problems).toEqual([`the picture slide-09-2.png is in "sec-a" and no slide lists it under \`images\``]);
      expect(r.ok).toBe(false);
    });

    it("et bilde kjennes på filnavnet også mens pakken peker på fila", () => {
      const pkg = pakke(seksjon("sec-a", "![x](asset:img)", [{ sourceId: "img", file: "deck/images/slide-09-2.png" }]));
      expect(feil({ slides: [{ slide: 9, becomes: ["image"], in: "sec-a", images: ["slide-09-2.png"] }] }, pkg)).toEqual([]);
    });
  });

  describe("lest mot presentasjonen (slides.json)", () => {
    const deck = { slides: [{ number: 1, pictures: [] }, { number: 2, pictures: [{ file: "slide-04-1.png" }, { file: "slide-02-2.png" }] }, { number: 3 }] };
    const tittel = { slide: 1, becomes: ["omitted"], why: "title slide" };
    const siste = { slide: 3, becomes: ["omitted"], why: "practical information" };

    it("et lysark lista ikke nevner, meldes — ingenting utelates ved ikke å bli nevnt", () => {
      const r = checkSlideCoverage({ slides: [tittel, { ...alt, imagesLeftOut: { "slide-02-2.png": "pynt fra malen" } }] }, pakke(helSeksjon), { deck });
      expect(r.problems).toEqual(["slide 3 has no row in the slide list"]);
    });

    it("hvert bilde på lysarket er enten tatt med eller utelatt med en grunn", () => {
      const uten = checkSlideCoverage({ slides: [tittel, alt, siste] }, pakke(helSeksjon), { deck });
      expect(uten.problems).toEqual(["slide 2: the picture slide-02-2.png is neither in `images` nor in `imagesLeftOut` with a reason"]);
      const tomGrunn = checkSlideCoverage({ slides: [tittel, { ...alt, imagesLeftOut: { "slide-02-2.png": " " } }, siste] }, pakke(helSeksjon), { deck });
      expect(tomGrunn.ok).toBe(false);
      const med = checkSlideCoverage({ slides: [tittel, { ...alt, imagesLeftOut: { "slide-02-2.png": "pynt fra malen" } }, siste] }, pakke(helSeksjon), { deck });
      expect([...med.problems, ...med.rows.flatMap((r) => r.problems)]).toEqual([]);
      expect(med.ok).toBe(true);
    });

    it("en rad for et lysark presentasjonen ikke har, meldes", () => {
      const r = checkSlideCoverage({ slides: [tittel, { ...alt, imagesLeftOut: { "slide-02-2.png": "pynt" } }, siste, { slide: 9, becomes: ["omitted"], why: "x" }] }, pakke(helSeksjon), { deck });
      expect(r.rows[3]!.problems).toEqual(["the presentation has 3 slides"]);
    });

    it("uten presentasjonen kontrolleres bare lysarkene lista nevner", () => {
      expect(checkSlideCoverage({ slides: [alt] }, pakke(helSeksjon)).ok).toBe(true);
    });
  });

  it("rapporten har én linje per lysark, funnene under, og sier til slutt om alt er på plass", () => {
    const god = formatCoverage(checkSlideCoverage({ slides: [alt] }, pakke(helSeksjon)));
    expect(god.split("\n")).toEqual([
      "OK   slide 2: figure, cards, callout, prompt, table, image, text → sec-a",
      "OK   1 rows, every slide has what the list says",
    ]);
    const dårlig = formatCoverage(checkSlideCoverage({ slides: [{ ...alt, phrases: ["mangler"] }, { slide: 3, becomes: ["omitted"] }] }, pakke(helSeksjon)));
    expect(dårlig.split("\n")).toEqual([
      "FAIL slide 2: figure, cards, callout, prompt, table, image, text → sec-a",
      `  - not found in "sec-a": «mangler»`,
      "FAIL slide 3: omitted",
      "  - an omitted slide needs `why`",
      "FAIL 2 thing(s) to fix — or change the list with the author's consent",
    ]);
  });
});
