import { describe, expect, it } from "vitest";
import {
  applyMcqTranslation,
  dropMcqQuestionLocale,
  mcqCorrectAnswerIndexes,
} from "/static/admin-content-localized-copy.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1014: en MCQ-oversettelse som ikke kom, skal se ut som en oversettelse som ikke kom.
//
// ⚠️ HVORFOR DENNE FINNES. Da kildefyllingen ble fjernet sto alle fire suitene grønne — 1321 enhet,
// 6 DOM, 312 e2e, 621 integrasjon — over DELTAKERVENDT innhold som nettopp var endret. Ingen test
// rørte regelen. Den var en modul-lokal funksjon bak et `apiFetch`, og alt som kunne nå den måtte
// laste et helt modulbunt.
//
// ⚠️ INVARIANTEN SOM KOSTER MEST. `localizedTextIdentity` bygger identiteten av HELE språkkartet,
// og `correctAnswer` må være identisk med ett av `options`. Slippes et språk fra svaret mens
// alternativet beholder det, matcher svaret ingen — og spørsmålet blir stille ubesvarbart for
// ALLE, ikke bare for det språket. Derfor flytter de to sammen, og svaret bygges FRA alternativet.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ Kartet starter KILDEFYLT på alle tre språk, slik `buildLocalizedTextMap` faktisk bygger det.
// Det er ikke pynt: den forhåndsfyllingen ER kildefyllingen saken handler om, og `delete` er det
// eneste som fjerner den. En fikstur som startet med bare `nb` gjorde testene blinde for et glemt
// `delete` — mutasjonen «slipp alternativene, men ikke svaret» sto grønn til dette ble rettet.
const kart = (tekst) => ({ "en-GB": tekst, nb: tekst, nn: tekst });

function spørsmål(stem, options, correctAnswer, rationale) {
  return {
    stem: kart(stem),
    options: options.map(kart),
    correctAnswer: kart(correctAnswer),
    rationale: kart(rationale),
  };
}

const KILDE = [{ stem: "Hva?", options: ["Oslo", "Bergen"], correctAnswer: "Oslo", rationale: "Fordi" }];
const lagLokalisert = () => [spørsmål("Hva?", ["Oslo", "Bergen"], "Oslo", "Fordi")];

describe("#1014 — MCQ-oversettelse fyller aldri med kildeteksten", () => {
  it("finner svarets plass blant alternativene — kontrollcase", () => {
    // Uten denne er hele koblingen grønn hvis `mcqCorrectAnswerIndexes` slutter å finne noe:
    // «fant ikke svaret» og «alt er i orden» ender begge med at språket slippes.
    expect(mcqCorrectAnswerIndexes(KILDE)).toEqual([0]);
    expect(mcqCorrectAnswerIndexes([{ options: ["A"], correctAnswer: "B" }])).toEqual([-1]);
  });

  it("legger inn oversettelsen når alt kom tilbake", () => {
    const lokalisert = lagLokalisert();
    applyMcqTranslation(
      lokalisert,
      [{ stem: "What?", options: ["Oslo city", "Bergen city"], correctAnswer: "Oslo city", rationale: "Because" }],
      { targetLocale: "en-GB", correctIndexes: [0] },
    );
    expect(lokalisert[0].stem["en-GB"]).toBe("What?");
    expect(lokalisert[0].options.map((o) => o["en-GB"])).toEqual(["Oslo city", "Bergen city"]);
    expect(lokalisert[0].rationale["en-GB"]).toBe("Because");
  });

  it("bygger svaret FRA alternativet, ikke fra modellens egen oversettelse av svaret", () => {
    // ⚠️ Modellen oversatte svaret annerledes enn alternativet — «Oslo by» mot «Oslo city». Tas
    // svaret ordrett, matcher det ingen av alternativene, og spørsmålet kan aldri scores riktig.
    const lokalisert = lagLokalisert();
    applyMcqTranslation(
      lokalisert,
      [{ stem: "What?", options: ["Oslo city", "Bergen city"], correctAnswer: "Oslo by", rationale: "Because" }],
      { targetLocale: "en-GB", correctIndexes: [0] },
    );
    expect(lokalisert[0].correctAnswer["en-GB"]).toBe("Oslo city");
    expect(lokalisert[0].options.map((o) => o["en-GB"])).toContain(lokalisert[0].correctAnswer["en-GB"]);
  });

  it("slipper språket for alternativer OG svar når ett alternativ mangler", () => {
    const lokalisert = lagLokalisert();
    applyMcqTranslation(
      lokalisert,
      [{ stem: "What?", options: ["Oslo city"], correctAnswer: "Oslo city", rationale: "Because" }],
      { targetLocale: "en-GB", correctIndexes: [0] },
    );
    // Stem og rasjonale er ikke koblet til noe og overlever.
    expect(lokalisert[0].stem["en-GB"]).toBe("What?");
    expect(lokalisert[0].rationale["en-GB"]).toBe("Because");
    // Koblingen holdes: begge sider slippes, ingen av dem står igjen med bokmål.
    expect(lokalisert[0].correctAnswer["en-GB"]).toBeUndefined();
    expect(lokalisert[0].options.every((o) => o["en-GB"] === undefined)).toBe(true);
  });

  it("fyller ALDRI et manglende felt med kildeteksten", () => {
    // Selve feilen saken handler om: `?? …[sourceLocale]` gjorde at kartet så komplett ut,
    // publiseringsgaten fant ingenting å savne, og en nynorskdeltaker fikk bokmål.
    const lokalisert = lagLokalisert();
    applyMcqTranslation(lokalisert, [{ stem: "", options: [], correctAnswer: "", rationale: "" }], {
      targetLocale: "nn",
      correctIndexes: [0],
    });
    const verdier = [
      lokalisert[0].stem.nn,
      lokalisert[0].correctAnswer.nn,
      lokalisert[0].rationale.nn,
      ...lokalisert[0].options.map((o) => o.nn),
    ];
    expect(verdier.every((v) => v === undefined), "ingen mållokale skal peke på bokmålsteksten").toBe(true);
    // Kildespråket er urørt — det er ikke det som mangler.
    expect(lokalisert[0].stem.nb).toBe("Hva?");
  });

  it("slipper språket for et spørsmål svaret ikke dekker", () => {
    const lokalisert = [...lagLokalisert(), spørsmål("Og?", ["Ja", "Nei"], "Ja", "Derfor")];
    applyMcqTranslation(
      lokalisert,
      [{ stem: "What?", options: ["Oslo city", "Bergen city"], correctAnswer: "Oslo city", rationale: "Because" }],
      { targetLocale: "en-GB", correctIndexes: [0, 0] },
    );
    expect(lokalisert[1].stem["en-GB"]).toBeUndefined();
    expect(lokalisert[1].options.every((o) => o["en-GB"] === undefined)).toBe(true);
  });

  it("slipper språket når svaret ikke er ett av alternativene i kilden", () => {
    // `correctIndexes` er -1. Da kan svaret ikke bygges, og å ta modellens versjon ville laget
    // nettopp det ubesvarbare spørsmålet identiteten skal hindre.
    const lokalisert = lagLokalisert();
    applyMcqTranslation(
      lokalisert,
      [{ stem: "What?", options: ["Oslo city", "Bergen city"], correctAnswer: "Oslo city", rationale: "Because" }],
      { targetLocale: "en-GB", correctIndexes: [-1] },
    );
    expect(lokalisert[0].correctAnswer["en-GB"]).toBeUndefined();
    expect(lokalisert[0].options.every((o) => o["en-GB"] === undefined)).toBe(true);
  });

  it("dropMcqQuestionLocale tar alle fire feltene", () => {
    const q = spørsmål("Hva?", ["Oslo", "Bergen"], "Oslo", "Fordi");
    q.stem["en-GB"] = "What?";
    q.options.forEach((o, i) => { o["en-GB"] = `alt ${i}`; });
    q.correctAnswer["en-GB"] = "alt 0";
    q.rationale["en-GB"] = "Because";
    dropMcqQuestionLocale(q, "en-GB");
    expect(q.stem["en-GB"]).toBeUndefined();
    expect(q.correctAnswer["en-GB"]).toBeUndefined();
    expect(q.rationale["en-GB"]).toBeUndefined();
    expect(q.options.every((o) => o["en-GB"] === undefined)).toBe(true);
    expect(q.stem.nb, "kildespråket skal ikke røres").toBe("Hva?");
  });
});
