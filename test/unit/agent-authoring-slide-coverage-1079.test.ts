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

  it("seksjonstekst som står i en fil ved siden av pakken, leses — og en fil som mangler, meldes", () => {
    const iFil = pakke({ clientRef: "sec-kilder", type: "section", payload: { title: { nb: "Kilder" }, bodyFiles: { nb: "sections/sec-kilder.nb.md" } } });
    const liste = { slides: [{ slide: 5, becomes: ["table", "prompt"], in: "sec-kilder", phrases: ["Hvem som gjør hva, og når"] }] };
    // Bildene i den teksten er ikke i denne lille pakken; det er tabellen, prompten og uttrykket som sjekkes.
    expect(checkSlideCoverage(liste, iFil, { baseDir: EKSEMPEL }).rows[0]!.problems).toEqual([]);
    const borte = checkSlideCoverage(liste, iFil, { baseDir: "finnes-ikke" });
    expect(borte.problems.join(" | ")).toContain(`sec-kilder.bodyFiles: cannot read the file "sections/sec-kilder.nb.md"`);
    expect(borte.ok).toBe(false);
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
    // Hvert bilde på lysarket har en art (2.86.1): det som vises, er «click»; pynten er «decoration».
    const arter = { pictures: { "slide-04-1.png": "click", "slide-02-2.png": "decoration" } };

    it("et lysark lista ikke nevner, meldes — ingenting utelates ved ikke å bli nevnt", () => {
      const r = checkSlideCoverage({ slides: [tittel, { ...alt, ...arter }] }, pakke(helSeksjon), { deck });
      expect(r.problems).toEqual(["slide 3 has no row in the slide list"]);
    });

    it("hvert bilde på lysarket har en art, og er enten tatt med, utelatt med en grunn, eller utelatt fordi arten sier det", () => {
      const uten = checkSlideCoverage({ slides: [tittel, alt, siste] }, pakke(helSeksjon), { deck });
      expect(uten.problems).toEqual([
        "slide 2: say what the picture slide-04-1.png is under `pictures`: prompt, click, content, infographic, decoration",
        "slide 2: say what the picture slide-02-2.png is under `pictures`: prompt, click, content, infographic, decoration",
        "slide 2: the picture slide-02-2.png is neither in `images` nor in `imagesLeftOut` with a reason",
      ]);
      const tomGrunn = checkSlideCoverage({ slides: [tittel, { ...alt, pictures: { "slide-04-1.png": "click", "slide-02-2.png": "content" }, imagesLeftOut: { "slide-02-2.png": " " } }, siste] }, pakke(helSeksjon), { deck });
      expect(tomGrunn.ok).toBe(false);
      const med = checkSlideCoverage({ slides: [tittel, { ...alt, ...arter }, siste] }, pakke(helSeksjon), { deck });
      expect([...med.problems, ...med.rows.flatMap((r) => r.problems)]).toEqual([]);
      expect(med.ok).toBe(true);
    });

    // Milepæl 1 i prod (Tilbudsarbeid): tre prompt-skjermbilder ble beholdt som bilde, og to
    // listelysark ble bilde. Reglene sto i teksten; nå står de i kontrollen.
    it("et prompt-skjermbilde skrives ut som prompt-boks og tas ikke med som bilde", () => {
      const somBilde = { ...alt, pictures: { "slide-04-1.png": "prompt", "slide-02-2.png": "decoration" } };
      const r = checkSlideCoverage({ slides: [tittel, somBilde, siste] }, pakke(helSeksjon), { deck });
      expect(r.rows[1]!.problems).toEqual(["the picture slide-04-1.png is a prompt — write it out as a prompt box; the screenshot itself is not included"]);
      const utenPrompt = { ...alt, becomes: ["image", "text"], images: ["slide-02-2.png"], pictures: { "slide-04-1.png": "prompt", "slide-02-2.png": "click" } };
      const r2 = checkSlideCoverage({ slides: [tittel, utenPrompt, siste] }, pakke(helSeksjon), { deck });
      expect(r2.rows[1]!.problems).toContain("the picture slide-04-1.png is a prompt — the slide must become prompt, written out as a prompt box");
    });

    it("et skjermbilde som viser hvor en klikker, tas med; en infografikk bygges om og tas ikke med", () => {
      const klikkUtelatt = { ...alt, images: [], becomes: ["text"], pictures: { "slide-04-1.png": "click", "slide-02-2.png": "decoration" } };
      expect(checkSlideCoverage({ slides: [tittel, klikkUtelatt, siste] }, pakke(helSeksjon), { deck }).rows[1]!.problems).toContain("the picture slide-04-1.png is a screenshot that shows where to click — include it under `images`, or leave it out with a reason under `imagesLeftOut`");
      // QA-porten: forfatteren kan si nei til et bilde, eller det viser et passord — en grunn under imagesLeftOut er nok.
      const klikkMedGrunn = { ...klikkUtelatt, imagesLeftOut: { "slide-04-1.png": "viser et passord — forfatteren sa nei" } };
      // Pakken har da heller ikke bildet: det ble utelatt.
      const ok = checkSlideCoverage({ slides: [tittel, klikkMedGrunn, siste] }, pakke(seksjon("sec-a", "Tekst uten bilde.")), { deck });
      expect([...ok.problems, ...ok.rows.flatMap((r) => r.problems)]).toEqual([]);
      const infografikkMed = { ...alt, pictures: { "slide-04-1.png": "infographic", "slide-02-2.png": "decoration" } };
      expect(checkSlideCoverage({ slides: [tittel, infografikkMed, siste] }, pakke(helSeksjon), { deck }).rows[1]!.problems).toContain("the picture slide-04-1.png is an infographic — rebuild its content (figure, table, cards or text); the picture itself is not included");
      const ukjentArt = { ...alt, pictures: { "slide-04-1.png": "photo", "slide-02-2.png": "decoration" } };
      expect(checkSlideCoverage({ slides: [tittel, ukjentArt, siste] }, pakke(helSeksjon), { deck }).rows[1]!.problems.join()).toContain('has the kind "photo"');
    });

    // QA-porten: et lysark som brukes to steder har to rader; bildet står på én av dem, og en
    // oppgaverad for et prompt-lysark blir ikke selv prompt. Arten dømmes per lysark, ikke per rad.
    it("arten dømmes per lysark: to rader for samme lysark regnes sammen", () => {
      const seksjonsrad = { ...alt, pictures: { "slide-04-1.png": "click", "slide-02-2.png": "decoration" } };
      const oppgaverad = { slide: 2, becomes: ["task"], in: "mod-a", pictures: { "slide-04-1.png": "click", "slide-02-2.png": "decoration" } };
      const r = checkSlideCoverage({ slides: [tittel, seksjonsrad, oppgaverad, siste] }, pakke(helSeksjon, modul("mod-a", "Hva kommer først?")), { deck });
      expect([...r.problems, ...r.rows.flatMap((x) => x.problems)]).toEqual([]);
      const promptSeksjon = { ...alt, images: [], becomes: ["prompt", "text"], pictures: { "slide-04-1.png": "prompt", "slide-02-2.png": "decoration" } };
      const promptOppgave = { slide: 2, becomes: ["task"], in: "mod-a" };
      // Seksjonen har prompt-boksen, men ikke skjermbildet av den.
      const utenBilde = seksjon("sec-a", ["```prompt", "Du skal skrive et referat.", "```", "", "Tekst."].join(String.fromCharCode(10)));
      const r2 = checkSlideCoverage({ slides: [tittel, promptSeksjon, promptOppgave, siste] }, pakke(utenBilde, modul("mod-a", "Hva kommer først?")), { deck });
      expect([...r2.problems, ...r2.rows.flatMap((x) => x.problems)]).toEqual([]);
      const uenige = { slide: 2, becomes: ["task"], in: "mod-a", pictures: { "slide-04-1.png": "prompt" } };
      expect(checkSlideCoverage({ slides: [tittel, seksjonsrad, uenige, siste] }, pakke(helSeksjon, modul("mod-a", "Hva kommer først?")), { deck }).rows[1]!.problems.join()).toContain("one kind per picture");
    });

    // QA-porten, runde 2: et lysark forfatteren har valgt bort, dømmes ikke på hva bildene skulle blitt;
    // og en null-rad krasjer ikke kontrollen.
    it("et utelatt lysark med et prompt-skjermbilde går, og en null-rad gir en vanlig feil", () => {
      const valgtBort = { slide: 2, becomes: ["omitted"], why: "forfatteren tok det ut", pictures: { "slide-04-1.png": "prompt", "slide-02-2.png": "click" }, imagesLeftOut: { "slide-02-2.png": "lysarket er tatt ut" } };
      const r = checkSlideCoverage({ slides: [tittel, valgtBort, siste] }, pakke(seksjon("sec-a", "Tekst.")), { deck });
      expect([...r.problems, ...r.rows.flatMap((x) => x.problems)]).toEqual([]);
      const ukjent = { ...valgtBort, pictures: { "slide-04-1.png": "photo", "slide-02-2.png": "click" } };
      expect(checkSlideCoverage({ slides: [tittel, ukjent, siste] }, pakke(seksjon("sec-a", "Tekst.")), { deck }).rows[1]!.problems.join()).toContain('has the kind "photo"');
      // Bare et lysark der ALLE radene er utelatt, slipper dommen: en seksjonsrad med prompt-bildet tatt med
      // faller selv om en annen del av lysarket er valgt bort.
      const delvis = [{ ...alt, pictures: { "slide-04-1.png": "prompt", "slide-02-2.png": "decoration" } }, { slide: 2, becomes: ["omitted"], why: "resten er valgt bort" }];
      expect(checkSlideCoverage({ slides: [tittel, ...delvis, siste] }, pakke(helSeksjon), { deck }).rows[1]!.problems.join()).toContain("write it out as a prompt box");
      const medNull = checkSlideCoverage({ slides: [tittel, null, { ...alt, ...arter }, siste] }, pakke(helSeksjon), { deck });
      expect(medNull.ok).toBe(false);
      expect(medNull.rows[1]!.problems.length).toBeGreaterThan(0);
    });

    it("et lysark med tekst som bare blir et bilde, meldes; med teksten skrevet ut går det", () => {
      const tekstDeck = { slides: [{ number: 1, pictures: [] }, { number: 2, words: 48, pictures: [{ file: "slide-04-1.png" }, { file: "slide-02-2.png" }] }, { number: 3 }] };
      const bareBilde = { slide: 2, becomes: ["image"], in: "sec-a", images: ["slide-04-1.png"], pictures: { "slide-04-1.png": "content", "slide-02-2.png": "decoration" } };
      const r = checkSlideCoverage({ slides: [tittel, bareBilde, siste] }, pakke(helSeksjon), { deck: tekstDeck });
      expect(r.problems).toEqual(["slide 2 has 48 words of text and becomes only a picture — a text slide is written out (text, cards, table or figure); a picture of text cannot be read on a phone or searched"]);
      const medTekst = checkSlideCoverage({ slides: [tittel, { ...alt, ...arter }, siste] }, pakke(helSeksjon), { deck: tekstDeck });
      expect(medTekst.problems).toEqual([]);
      const fåOrd = checkSlideCoverage({ slides: [tittel, bareBilde, siste] }, pakke(helSeksjon), { deck: { ...tekstDeck, slides: tekstDeck.slides.map((s) => (s.number === 2 ? { ...s, words: 6 } : s)) } });
      expect(fåOrd.problems).toEqual([]);
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
