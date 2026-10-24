import { describe, expect, it } from "vitest";
import {
  buildLocalizedCopyValue,
  carryMcqAnswerKey,
  mcqCorrectPositions,
  isPartialLocalizedMap,
  parseLocalizedMap,
  selectTranslatedDraftFields,
} from "../../public/static/admin-content-localized-copy.js";

const LOCALES = ["en-GB", "nb", "nn"];
const OPTS = { locales: LOCALES, suffix: "(kopi)", fallbackLabel: "Ny modul" };

describe("#982 — en kopi lyver ikke om oversettelsesstatus", () => {
  // ⚠️ DEN VIKTIGSTE. Originalen har én tekst uten språkmerke — den er ikke oversatt. Fyller
  // kopien alle tre lokaler, kan ingen etterpå skille «oversatt» fra «kildeteksten sto der».
  // `missingLocalesFor` finner ingenting å savne, publiseringsgaten slipper modulen gjennom, og en
  // nynorskdeltaker får bokmål uten at noe sier fra. Det er #892-invarianten brutt permanent.
  it("en uoversatt tittel gir en uoversatt kopi, ikke tre like", () => {
    const result = buildLocalizedCopyValue("Tryggleik i praksis", OPTS);

    expect(typeof result).toBe("string");
    expect(result).toBe("Tryggleik i praksis (kopi)");
  });

  it("en fullt oversatt tittel gir alle tre språk", () => {
    const result = buildLocalizedCopyValue(
      { "en-GB": "Safety", nb: "Sikkerhet", nn: "Tryggleik" },
      OPTS,
    );

    expect(result).toEqual({
      "en-GB": "Safety (kopi)",
      nb: "Sikkerhet (kopi)",
      nn: "Tryggleik (kopi)",
    });
  });

  // ⚠️ Den gamle koden falt tilbake på `en-GB` for et språk som manglet, så nynorsk ble fylt med
  // engelsk. Kopien så komplett ut mens den ikke var det.
  it("et delvis oversatt kart beholder NØYAKTIG de språkene som fantes", () => {
    const result = buildLocalizedCopyValue({ "en-GB": "Safety", nb: "Sikkerhet" }, OPTS);

    expect(result).toEqual({ "en-GB": "Safety (kopi)", nb: "Sikkerhet (kopi)" });
    expect(result).not.toHaveProperty("nn");
  });

  // ⚠️ Lokaliserte tekster lagres som TEKST i databasen. `typeof value === "object"` traff derfor
  // aldri et lagret språkkart, og hele objekt-grenen sto ubrukt mens streng-grenen gjorde skaden.
  it("leser et språkkart som er lagret som JSON-streng", () => {
    const stored = JSON.stringify({ "en-GB": "Safety", nb: "Sikkerhet", nn: "Tryggleik" });
    const result = buildLocalizedCopyValue(stored, OPTS);

    expect(result).toEqual({
      "en-GB": "Safety (kopi)",
      nb: "Sikkerhet (kopi)",
      nn: "Tryggleik (kopi)",
    });
  });

  it("et kart med bare tomme verdier faller tilbake til reservetittelen", () => {
    expect(buildLocalizedCopyValue({ "en-GB": "  ", nb: "", nn: "" }, OPTS)).toBe("Ny modul (kopi)");
    expect(buildLocalizedCopyValue(null, OPTS)).toBe("Ny modul (kopi)");
  });

  it("skiller ren tekst fra et lagret språkkart", () => {
    expect(parseLocalizedMap("bare en tittel")).toBeNull();
    expect(parseLocalizedMap('{"nb":"Tittel"}')).toEqual({ nb: "Tittel" });
    expect(parseLocalizedMap({ nb: "Tittel" })).toEqual({ nb: "Tittel" });
    // En JSON-liste er ikke et språkkart.
    expect(parseLocalizedMap("[1,2]")).toBeNull();
  });

  // Kalleren trenger dette fordi opprettelsen godtar EN STRENG eller ALLE TRE — ikke noe imellom.
  it("kjenner igjen et delvis kart, som må settes med en PATCH etterpå", () => {
    expect(isPartialLocalizedMap({ "en-GB": "a", nb: "b" }, LOCALES)).toBe(true);
    expect(isPartialLocalizedMap({ "en-GB": "a", nb: "b", nn: "c" }, LOCALES)).toBe(false);
    expect(isPartialLocalizedMap("bare tekst", LOCALES)).toBe(false);
  });
});

describe("#982 — en oversettelse som ikke kom, fylles ikke med kildetekst", () => {
  // ⚠️ DEN VIKTIGSTE. Koden skrev tidligere `draft?.taskText ?? taskText` — kildeteksten — inn i
  // mållokalen når svaret var tomt. Kartet så komplett ut, `missingLocalesFor` fant ingenting å
  // savne, og en oversettelse som aldri kom ble umulig å skille fra en ekte.
  it("et tomt svar er INGEN oversettelse — lokalen skal slippes", () => {
    expect(selectTranslatedDraftFields(undefined)).toBeNull();
    expect(selectTranslatedDraftFields({})).toBeNull();
    expect(selectTranslatedDraftFields({ taskText: "" })).toBeNull();
    // Et svar med alt UNNTATT oppgaveteksten er heller ingen oversettelse.
    expect(selectTranslatedDraftFields({ assessorExpectedContent: "noe" })).toBeNull();
  });

  it("beholder bare de feltene som faktisk har innhold", () => {
    expect(selectTranslatedDraftFields({ taskText: "Oppgave" })).toEqual({ taskText: "Oppgave" });

    expect(selectTranslatedDraftFields({ taskText: "Oppgave", assessorExpectedContent: "" }))
      .toEqual({ taskText: "Oppgave" });

    expect(selectTranslatedDraftFields({
      taskText: "Oppgave",
      assessorExpectedContent: "Forventet",
      candidateTaskConstraints: "Rammer",
    })).toEqual({
      taskText: "Oppgave",
      assessorExpectedContent: "Forventet",
      candidateTaskConstraints: "Rammer",
    });
  });
});

// #1077: typen og fasiten bæres over når et spørsmål bygges på nytt (oversettelse, utfylling ved
// publisering, skjemaet lest tilbake). Uten dette ble et «velg alle som stemmer» et vanlig spørsmål.
describe("#1077 — mcqCorrectPositions og carryMcqAnswerKey", () => {
  const A = { "en-GB": "Purpose", nb: "Formål" };
  const B = { "en-GB": "Colour", nb: "Farge" };
  const C = { "en-GB": "Legal basis", nb: "Behandlingsgrunnlag" };
  const multiple = { questionType: "multiple", options: [A, B, C], correctAnswers: [C, A], correctAnswer: A };

  it("posisjonene til de riktige — sortert, sammenlignet som verdier (ikke objekter)", () => {
    expect(mcqCorrectPositions(JSON.parse(JSON.stringify(multiple)))).toEqual([0, 2]);
    expect(mcqCorrectPositions({ options: ["x", "y"], correctAnswer: "y" })).toEqual([1]);
    expect(mcqCorrectPositions({ options: ["x", "y"], correctAnswer: "z" })).toEqual([]);
  });

  it("et spørsmål bygget på nytt, oversatt, får typen og de riktige på de samme plassene", () => {
    const translated = { stem: { nn: "Kva?" }, options: [{ nn: "Føremål" }, { nn: "Farge" }, { nn: "Rettsgrunnlag" }], correctAnswer: { nn: "Føremål" } };
    expect(carryMcqAnswerKey(translated, multiple)).toMatchObject({
      questionType: "multiple",
      correctAnswers: [{ nn: "Føremål" }, { nn: "Rettsgrunnlag" }],
      correctAnswer: { nn: "Føremål" },
    });
  });

  it("kontroll: et vanlig spørsmål røres ikke", () => {
    const target = { options: ["x", "y"], correctAnswer: "y" };
    expect(carryMcqAnswerKey(target, { options: ["x", "y"], correctAnswer: "y" })).toBe(target);
  });
});
