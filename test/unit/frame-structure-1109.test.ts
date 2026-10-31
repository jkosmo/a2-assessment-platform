import { afterEach, describe, expect, it } from "vitest";
import {
  FRAME_KINDS,
  compareFrames,
  countHeadingLines,
  frameSignature,
  readFrames,
} from "../../skills/a2-authoring-api/scripts/frame-structure.mjs";
import {
  checkAnswerPatterns,
  checkLocalization,
  practiceBlockShapes,
  // @ts-expect-error — .mjs skill script consumed as a library
} from "../../skills/a2-authoring-api/scripts/localization-check.mjs";
import { renderSectionBlocks } from "../../src/modules/course/contentBlocks.js";
import { env } from "../../src/config/env.js";
import { AppError } from "../../src/errors/AppError.js";
import {
  localizeCourseCopy,
  localizeModuleDraft,
  localizeSectionContent,
} from "../../src/modules/adminContent/llmContentGenerationService.js";
import {
  TranslationStructureError,
  assertTranslationKeepsStructure,
  countTopLevelHeadings,
  translationStructureProblems,
} from "../../src/modules/adminContent/translationStructureGuard.js";

// #1109: plattformens oversetter sjekket ingenting etter oversettelse. Én delt tabell over rammene
// (frame-structure.mjs) leses av både skillet og tjeneren; tjeneren legger til markeds egen telling av
// overskrifter og en sammenligning av det som faktisk tegnes.

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const lines = (...rows: string[]) => rows.join(NL);

const check = (q: string, ...options: Array<[string, boolean]>) => lines(`:::sjekk ${q}`, ...options.map(([text, right]) => `- [${right ? "x" : " "}] ${text}`), "Forklaring.", ":::");
const steps = (...titles: string[]) => lines(":::steg Tittel", ...titles.flatMap((t) => [`### ${t}`, "Tekst."]), ":::");
const write = (...items: string[]) => lines(":::skriv Oppgave", "Eksempelsvaret.", "", ...items.map((i) => `- [ ] ${i}`), ":::");
const flash = (...terms: string[]) => lines(":::repetisjon", ...terms.flatMap((t) => [`### ${t}`, "Forklaring."]), ":::");
const cards = (...titles: string[]) => lines(":::kort", ...titles.flatMap((t) => [`### ${t}`, "Tekst."]), ":::");
const think = (q: string) => lines(`:::tenk ${q}`, "Svaret.", ":::");
const doc = (...blocks: string[]) => ["Innledning.", ...blocks].join(NL + NL);

const SOURCE = doc(think("Hva tror du?"), check("Hvilken?", ["A", false], ["B", true], ["C", false]), cards("En", "To"), steps("Les", "Skriv", "Send"), write("hva", "når"), flash("Vedtak", "Referent"));
// En riktig oversettelse: alt tekst er oversatt, engelske markørord der det passer, formen er lik.
const TRANSLATED = [
  "Introduction.",
  lines(":::think What do you think?", "The answer.", ":::"),
  lines(":::check Which one?", "- [ ] A2", "- [x] B2", "- [ ] C2", "Explanation.", ":::"),
  lines(":::cards", "### One", "Text.", "### Two", "Text.", ":::"),
  lines(":::steps Title", "### Read", "Text.", "### Write", "Text.", "### Send", "Text.", ":::"),
  lines(":::write Task", "The example answer.", "", "- [ ] what", "- [ ] when", ":::"),
  lines(":::flashcards", "### Decision", "Explanation.", "### Minute-taker", "Explanation.", ":::"),
].join(NL + NL);

describe("frame-structure.mjs — formen på hver rammetype (#1109)", () => {
  it("leser alle seks rammetypene i rekkefølge, med formen som skal være lik", () => {
    expect(frameSignature(SOURCE)).toEqual(["tenk", "sjekk:010", "kort:2", "steg:3", "skriv:2", "repetisjon:2"]);
  });

  it("kontroll: en riktig oversettelse — engelske markørord, oversatt tekst — har ingen avvik", () => {
    expect(frameSignature(TRANSLATED)).toEqual(frameSignature(SOURCE));
    expect(compareFrames(SOURCE, TRANSLATED)).toEqual([]);
  });

  it("tabellen har én oppføring per rammetype, og hver har ord, åpning og tegnemerke", () => {
    expect(FRAME_KINDS.map((entry) => entry.kind)).toEqual(["tenk", "sjekk", "kort", "steg", "skriv", "repetisjon", "par", "feil"]);
    for (const entry of FRAME_KINDS) {
      expect(entry.words.length).toBeGreaterThanOrEqual(2);
      expect(["text", "optional", "none"]).toContain(entry.opener);
      expect(entry.drawnAs).toMatch(/^class="content-[a-z]+"$/);
    }
  });

  it("flyttet [x] i «sjekk deg selv»: avvik i fasiten, med plass og mønster", () => {
    const moved = TRANSLATED.replace("- [ ] A2" + NL + "- [x] B2", "- [x] A2" + NL + "- [ ] B2");
    expect(compareFrames(SOURCE, moved)).toEqual([{ kind: "sjekk", problem: "shape", position: 1, expected: "010", actual: "100" }]);
  });

  it("en manglende overskrift i steg for steg: avvik i antall steg", () => {
    const lost = TRANSLATED.replace("### Write" + NL, "");
    expect(compareFrames(SOURCE, lost)).toEqual([{ kind: "steg", problem: "shape", position: 1, expected: "3", actual: "2" }]);
  });

  it("en manglende overskrift i repetisjonskort og i kort: avvik i antall kort", () => {
    expect(compareFrames(SOURCE, TRANSLATED.replace("### Minute-taker" + NL, ""))).toEqual([
      // Ett kort igjen er ikke en repetisjonsramme lenger (færre enn to tegnes ikke): rammen mangler.
      { kind: "repetisjon", problem: "count", expected: 1, actual: 0 },
    ]);
    expect(compareFrames(SOURCE, TRANSLATED.replace("### Two" + NL, ""))).toEqual([{ kind: "kort", problem: "shape", position: 1, expected: "2", actual: "1" }]);
  });

  it("sammenslåtte linjer: to alternativer på én linje, to sjekkpunkter på én linje", () => {
    const mergedOptions = TRANSLATED.replace("- [x] B2" + NL + "- [ ] C2", "- [x] B2 - [ ] C2");
    expect(compareFrames(SOURCE, mergedOptions)).toEqual([{ kind: "sjekk", problem: "shape", position: 1, expected: "010", actual: "01" }]);
    const mergedChecklist = TRANSLATED.replace("- [ ] what" + NL + "- [ ] when", "- [ ] what, when");
    expect(compareFrames(SOURCE, mergedChecklist)).toEqual([{ kind: "skriv", problem: "shape", position: 1, expected: "2", actual: "1" }]);
  });

  it("en ekstra ramme, og en ramme som forsvant: avvik i antall", () => {
    expect(compareFrames(SOURCE, TRANSLATED + NL + NL + lines(":::think Extra?", "Yes.", ":::"))).toEqual([{ kind: "tenk", problem: "count", expected: 1, actual: 2 }]);
    expect(compareFrames(SOURCE, TRANSLATED.replace(":::think What do you think?", "What do you think?"))).toEqual([{ kind: "tenk", problem: "count", expected: 1, actual: 0 }]);
  });

  it("et oversatt markørord er ingen ramme: avvik i antall", () => {
    expect(compareFrames(SOURCE, TRANSLATED.replace(":::check Which one?", ":::kontroller Which one?"))).toEqual([{ kind: "sjekk", problem: "count", expected: 1, actual: 0 }]);
  });

  it("Windows-linjeskift gir samme form — i kilden, i oversettelsen, eller begge", () => {
    const crlf = (text: string) => text.split(NL).join(CRLF);
    expect(frameSignature(crlf(SOURCE))).toEqual(frameSignature(SOURCE));
    expect(compareFrames(crlf(SOURCE), TRANSLATED)).toEqual([]);
    expect(compareFrames(SOURCE, crlf(TRANSLATED))).toEqual([]);
  });

  it("en ramme som ikke ville blitt tegnet, er ingen ramme: to riktige, ett steg, tomt eksempelsvar", () => {
    expect(readFrames(check("Q", ["A", true], ["B", true]))).toEqual([]);
    expect(readFrames(check("Q", ["A", true]))).toEqual([]);
    expect(readFrames(steps("Bare ett"))).toEqual([]);
    expect(readFrames(lines(":::skriv Oppgave", "- [ ] bare sjekkliste", ":::"))).toEqual([]);
    expect(readFrames(lines(":::tenk", "Uten spørsmål.", ":::"))).toEqual([]);
    expect(readFrames(lines(":::kort Tittel", "### A", ":::"))).toEqual([]);
  });

  it("en ramme i en kodeblokk er ingen ramme — og en oversettelse som fjerner kodeblokken, får en ramme", () => {
    const fenced = doc(lines("```markdown", think("Eksempel?"), "```"));
    expect(readFrames(fenced)).toEqual([]);
    expect(compareFrames(fenced, doc(think("Eksempel?")))).toEqual([{ kind: "tenk", problem: "count", expected: 0, actual: 1 }]);
  });

  it("en ugyldig ramme slipper ikke en gyldig ramme som står inni den (tegneren går videre linje for linje)", () => {
    const text = lines(":::sjekk Q", "- [x] a", "- [x] b", think("Inni?"));
    expect(frameSignature(text)).toEqual(["tenk"]);
  });

  it("skillets overskriftstelling: utenfor kodeblokker, også en tom overskrift", () => {
    expect(countHeadingLines(lines("### A", "```", "# kommentar", "```", "###", "tekst"))).toBe(2);
  });
});

describe("skillets språkkontroll leser den samme tabellen (#1109)", () => {
  const sectionPackage = (nb: string, nn: string, en: string) => ({
    packageFormat: "a2-authoring-package/v1",
    objects: [{ clientRef: "sec", type: "section", payload: { title: { nb: "Kilder", nn: "Kjelder", "en-GB": "Sources" }, bodyMarkdown: { nb, nn, "en-GB": en } } }],
  });
  const NN = SOURCE.replace("Innledning.", "Innleiing.");

  it("checkAnswerPatterns og practiceBlockShapes gir det samme som tabellen", () => {
    expect(checkAnswerPatterns(SOURCE)).toEqual(["010"]);
    expect(practiceBlockShapes(SOURCE)).toEqual(["steg:3", "skriv:2", "repetisjon:2"]);
  });

  it("kontroll: samme rammer på alle språk gir ingen merknad", () => {
    const result = checkLocalization(sectionPackage(SOURCE, NN, TRANSLATED));
    expect(result.answerKeyChanges).toEqual([]);
    expect(result.blockShapeChanges).toEqual([]);
  });

  it("nytt: en «tenk først» eller en kortramme som forsvant i engelsk, stopper også", () => {
    const noThink = TRANSLATED.replace(":::think What do you think?", "What do you think?");
    const result = checkLocalization(sectionPackage(SOURCE, NN, noThink));
    expect(result.blockShapeChanges).toHaveLength(1);
    expect(result.blockShapeChanges[0].detail).toContain("in: en-GB (nb has tenk)");
    const noCards = TRANSLATED.replace(":::cards", "");
    expect(checkLocalization(sectionPackage(SOURCE, NN, noCards)).blockShapeChanges[0].detail).toContain("nb has kort:2");
  });

  it("nytt: en ramme som dukker opp i en oversettelse der hovedspråket ikke har noen, stopper", () => {
    const result = checkLocalization(sectionPackage("Bare tekst her.", "Berre tekst her.", "Only text here." + NL + NL + think("Extra?")));
    expect(result.blockShapeChanges).toHaveLength(1);
    expect(result.blockShapeChanges[0].detail).toContain("no such frame");
  });
});

describe("translationStructureGuard — det tjeneren faktisk tegner (#1109)", () => {
  it("overskriftene telles av marked: en overskrift i en liste eller en kodeblokk begynner ikke et steg", () => {
    const inner = lines("### A", "en", "- liste", "  ### ikke et steg", "```", "# heller ikke", "```", "### B", "to");
    expect(countTopLevelHeadings(inner)).toBe(2);
    // Skillets linjetelling ser tre — derfor sender tjeneren inn markeds telling.
    expect(countHeadingLines(inner)).toBe(3);
  });

  it("en setext-overskrift er et steg for tjeneren: en oversettelse som gjør den om til ###, er lik", () => {
    const setext = lines(":::steg T", "A", "---", "en", "", "B", "===", "to", ":::");
    const atx = lines(":::steps T", "### A", "one", "### B", "two", ":::");
    expect(translationStructureProblems(setext, atx)).toEqual([]);
  });

  it("den blanke linja over «sjekk deg selv» fjernet: formen er lik, men rammen tegnes ikke — avvik", () => {
    const source = lines("- et punkt", "", check("Hvilken?", ["A", false], ["B", true]));
    const merged = lines("- a point", check("Which?", ["A", false], ["B", true]));
    expect(compareFrames(source, merged)).toEqual([]);
    expect(translationStructureProblems(source, merged)).toEqual([{ kind: "sjekk", problem: "drawn", expected: 1, actual: 0 }]);
  });

  it("kontroll: en riktig oversettelse har ingen avvik, heller ikke i tegningen", () => {
    expect(translationStructureProblems(SOURCE, TRANSLATED)).toEqual([]);
    expect(translationStructureProblems("Bare tekst.", "Just text.")).toEqual([]);
  });

  it("assertTranslationKeepsStructure kaster 422 translation_structure_changed med språk og felt", () => {
    let caught: unknown;
    try {
      assertTranslationKeepsStructure("en-GB", [
        { field: "title", source: "Tittel", translated: "Title" },
        { field: "bodyMarkdown", source: SOURCE, translated: TRANSLATED.replace("### Write" + NL, "") },
      ]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TranslationStructureError);
    const error = caught as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("translation_structure_changed");
    expect(error.httpStatus).toBe(422);
    expect(error.details).toEqual({
      locale: "en-GB",
      fields: [{ field: "bodyMarkdown", problems: [{ kind: "steg", problem: "shape", position: 1, expected: "3", actual: "2" }] }],
    });
    expect(error.message).toContain(":::steg no. 1");
  });

  it("et felt som mangler i oversettelsen, hoppes over (det er ikke oversatt — det håndteres der det leses)", () => {
    expect(() => assertTranslationKeepsStructure("nn", [{ field: "bodyMarkdown", source: SOURCE, translated: undefined }])).not.toThrow();
  });

  it("#1112: en TOM oversettelse er ikke oversatt — den gir ingen melding om endrede rammer", () => {
    expect(() => assertTranslationKeepsStructure("nn", [{ field: "bodyMarkdown", source: SOURCE, translated: "" }])).not.toThrow();
    expect(() => assertTranslationKeepsStructure("nn", [{ field: "bodyMarkdown", source: SOURCE, translated: "  " + NL }])).not.toThrow();
    // Kontroll: en oversettelse med tekst, men uten rammene, avvises fortsatt.
    expect(() => assertTranslationKeepsStructure("nn", [{ field: "bodyMarkdown", source: SOURCE, translated: "Berre tekst." }])).toThrow(TranslationStructureError);
  });

  it("#1112: kilden har en ramme som ikke tegnes, og oversettelsen tegner den — det er KILDEN som må rettes", () => {
    // Ingen blank linje over «sjekk deg selv», rett under en liste: plattformen tegner ikke rammen.
    const source = lines("- et punkt", check("Hvilken?", ["A", false], ["B", true]));
    const fixed = lines("- a point", "", check("Which?", ["A", false], ["B", true]));
    expect(translationStructureProblems(source, fixed)).toEqual([{ kind: "sjekk", problem: "sourceNotDrawn", expected: 0, actual: 1 }]);
    // Kontroll: står rammen utegnet i begge, er de like — ingenting å melde.
    expect(translationStructureProblems(source, lines("- a point", check("Which?", ["A", false], ["B", true])))).toEqual([]);
    // Kontroll: kilden er riktig og oversettelsen mistet linja — fortsatt «drawn», oversettelsen er feil.
    expect(translationStructureProblems(fixed, source)).toEqual([{ kind: "sjekk", problem: "drawn", expected: 1, actual: 0 }]);
    let caught: unknown;
    try {
      assertTranslationKeepsStructure("nn", [{ field: "bodyMarkdown", source, translated: fixed }]);
    } catch (error) {
      caught = error;
    }
    expect((caught as AppError).message).toContain("add a blank line above it in the source");
  });
});

describe("oversetterens tre funksjoner kaster når rammene endres (#1109)", () => {
  const original = {
    mode: env.LLM_MODE,
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    key: env.AZURE_OPENAI_API_KEY,
    deployment: env.AZURE_OPENAI_DEPLOYMENT,
    fetch: global.fetch,
  };
  afterEach(() => {
    env.LLM_MODE = original.mode;
    env.AZURE_OPENAI_ENDPOINT = original.endpoint;
    env.AZURE_OPENAI_API_KEY = original.key;
    env.AZURE_OPENAI_DEPLOYMENT = original.deployment;
    global.fetch = original.fetch;
  });

  /** Modellen svarer med `answer` (som JSON). */
  function modelAnswers(answer: Record<string, unknown>) {
    env.LLM_MODE = "azure_openai";
    env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    env.AZURE_OPENAI_API_KEY = "test-key";
    env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
    global.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  }

  const moved = TRANSLATED.replace("- [ ] A2" + NL + "- [x] B2", "- [x] A2" + NL + "- [ ] B2");

  it("seksjon: flyttet fasit kaster; riktig oversettelse kommer tilbake som før", async () => {
    modelAnswers({ title: "Title", bodyMarkdown: moved });
    await expect(localizeSectionContent({ title: "Tittel", bodyMarkdown: SOURCE, sourceLocale: "nb", targetLocale: "en-GB" })).rejects.toBeInstanceOf(TranslationStructureError);
    modelAnswers({ title: "Title", bodyMarkdown: TRANSLATED });
    await expect(localizeSectionContent({ title: "Tittel", bodyMarkdown: SOURCE, sourceLocale: "nb", targetLocale: "en-GB" })).resolves.toEqual({ title: "Title", bodyMarkdown: TRANSLATED });
  });

  it("seksjon: bokstavelige \\n fra modellen gjøres om til linjeskift FØR kontrollen (ellers falsk avvisning)", async () => {
    modelAnswers({ title: "Title", bodyMarkdown: TRANSLATED.split(NL).join("\\n") });
    await expect(localizeSectionContent({ title: "Tittel", bodyMarkdown: SOURCE, sourceLocale: "nb", targetLocale: "en-GB" })).resolves.toMatchObject({ bodyMarkdown: TRANSLATED });
  });

  it("modul: en manglende overskrift i oppgaveteksten kaster; riktig oversettelse kommer tilbake", async () => {
    const draft = { taskText: SOURCE, assessorExpectedContent: "Forventet.", candidateTaskConstraints: check("Hvilken?", ["A", true], ["B", false]), title: "Modul", sourceLocale: "nb" as const, targetLocale: "nn" as const };
    modelAnswers({ title: "Modul", taskText: TRANSLATED.replace("### Write" + NL, ""), assessorExpectedContent: "Forventa.", candidateTaskConstraints: check("Kva?", ["A", true], ["B", false]), includesScenario: false });
    await expect(localizeModuleDraft(draft)).rejects.toMatchObject({ code: "translation_structure_changed", details: { locale: "nn", fields: [{ field: "taskText" }] } });
    modelAnswers({ title: "Modul", taskText: TRANSLATED, assessorExpectedContent: "Forventa.", candidateTaskConstraints: check("Kva?", ["A", false], ["B", true]), includesScenario: false });
    await expect(localizeModuleDraft(draft)).rejects.toMatchObject({ details: { fields: [{ field: "candidateTaskConstraints" }] } });
    modelAnswers({ title: "Modul", taskText: TRANSLATED, assessorExpectedContent: "Forventa.", candidateTaskConstraints: check("Kva?", ["A", true], ["B", false]), includesScenario: false });
    await expect(localizeModuleDraft(draft)).resolves.toMatchObject({ taskText: TRANSLATED });
  });

  it("modul: også den skjulte veiledningen til vurdereren (assessorExpectedContent) holdes til samme form", async () => {
    const draft = { taskText: "Oppgave.", assessorExpectedContent: steps("A", "B"), sourceLocale: "nb" as const, targetLocale: "en-GB" as const };
    modelAnswers({ taskText: "Task.", assessorExpectedContent: "### A" + NL + "### B", candidateTaskConstraints: "", includesScenario: false });
    await expect(localizeModuleDraft(draft)).rejects.toMatchObject({ details: { fields: [{ field: "assessorExpectedContent" }] } });
  });

  it("kurs: en ramme som dukker opp i beskrivelsen, kaster; vanlig tekst kommer tilbake", async () => {
    modelAnswers({ title: "Course", description: think("Why?") });
    await expect(localizeCourseCopy({ title: "Kurs", description: "Hvorfor dette kurset.", sourceLocale: "nb", targetLocale: "en-GB" })).rejects.toBeInstanceOf(TranslationStructureError);
    modelAnswers({ title: "Course", description: "Why this course." });
    await expect(localizeCourseCopy({ title: "Kurs", description: "Hvorfor dette kurset.", sourceLocale: "nb", targetLocale: "en-GB" })).resolves.toEqual({ title: "Course", description: "Why this course." });
  });

  it("stubben (lokalt, uten KI) oversetter en tekst som BEGYNNER med en ramme uten å miste rammen", async () => {
    env.LLM_MODE = "stub";
    const body = check("Hvilken?", ["A", false], ["B", true]);
    const result = await localizeSectionContent({ title: "Tittel", bodyMarkdown: body, sourceLocale: "nb", targetLocale: "nn" });
    expect(result.bodyMarkdown).toContain("[nn]");
    expect(frameSignature(result.bodyMarkdown)).toEqual(["sjekk:01"]);
  });
});

// #1110 (følge per alternativ) og #1107 («finn parene»), lagt til i tabellen ved fletting med #1109.
describe("frame-structure.mjs — følger og par (#1110, #1107)", () => {
  const caseFrame = (feedbackOn: number[]) => lines(
    ":::sjekk Hva gjør du?",
    ...["Avslår", "Sladder", "Sender"].flatMap((t, i) => [`- [${i === 1 ? "x" : " "}] ${t}`, ...(feedbackOn.includes(i) ? [`  Følge ${i}.`] : [])]),
    ":::",
  );
  const pairs = (...rows: string[]) => lines(":::par Koble", ...rows.map((r) => `- ${r}`), ":::");

  it("en følge gir «f» etter alternativet; uten følger er formen som før", () => {
    expect(frameSignature(caseFrame([0, 1]))).toEqual(["sjekk:0f1f0"]);
    expect(frameSignature(caseFrame([]))).toEqual(["sjekk:010"]);
  });

  it("en følge som forsvant eller flyttet seg i oversettelsen, er et avvik i fasiten", () => {
    expect(compareFrames(caseFrame([0]), caseFrame([]))).toEqual([{ kind: "sjekk", problem: "shape", position: 1, expected: "0f10", actual: "010" }]);
    expect(compareFrames(caseFrame([0]), caseFrame([2]))).toHaveLength(1);
    expect(compareFrames(caseFrame([0, 2]), caseFrame([0, 2]))).toEqual([]);
  });

  it("«finn parene» telles i par; en ugyldig ramme (to par, like par, en linje som ikke er et par) er ingen ramme", () => {
    expect(frameSignature(pairs("A = a", "B = b", "C = c"))).toEqual(["par:3"]);
    expect(frameSignature(lines(":::pairs", "- A = a", "- B = b", "- C = c", "- D = d", ":::"))).toEqual(["par:4"]);
    expect(frameSignature(pairs("A = a", "B = b"))).toEqual([]);
    expect(frameSignature(pairs("**A** = a", "A = b", "C = c"))).toEqual([]);
    expect(frameSignature(lines(":::par", "- A = a", "- B = b", "- C = c", "En setning.", ":::"))).toEqual([]);
    expect(frameSignature(pairs("`a = b` = Formelen", "B = b", "C = c"))).toEqual(["par:3"]);
  });

  it("et par som forsvant i oversettelsen, er et avvik i formen; en riktig oversettelse er det ikke", () => {
    expect(compareFrames(pairs("A = a", "B = b", "C = c", "D = d"), pairs("A2 = a2", "B2 = b2", "C2 = c2"))).toEqual([{ kind: "par", problem: "shape", position: 1, expected: "4", actual: "3" }]);
    expect(compareFrames(pairs("A = a", "B = b", "C = c"), pairs("A2 = a2", "B2 = b2", "C2 = c2"))).toEqual([]);
  });
});

// #1123: «finn feilene» — en feil som flytter seg, eller en forklaring som forsvinner, i en oversettelse.
describe("finn feilene", () => {
  const errors = (...rows: string[]) => lines(":::feil Finn feilene", ...rows, ":::");
  it("formen er feilene og forklaringene; en flyttet feil eller tapt forklaring er et avvik", () => {
    const source = errors("- [ ] A.", "- [x] B.", "  Fordi.", "- [ ] C.");
    expect(frameSignature(source)).toEqual(["feil:01f0"]);
    expect(compareFrames(source, errors("- [ ] A2.", "- [x] B2.", "  Fordi2.", "- [ ] C2."))).toEqual([]);
    expect(compareFrames(source, errors("- [x] A2.", "  Fordi2.", "- [ ] B2.", "- [ ] C2."))).toEqual([{ kind: "feil", problem: "shape", position: 1, expected: "01f0", actual: "1f00" }]);
    expect(compareFrames(source, errors("- [ ] A2.", "- [x] B2.", "- [ ] C2."))).toEqual([{ kind: "feil", problem: "shape", position: 1, expected: "01f0", actual: "010" }]);
  });
});
// ⚠️ Vakt mot at tabellen og tegneren glir fra hverandre (QA-porten, 2.98.0: markørordene stod fem steder).
// Hver rammetype i tabellen, skrevet på minste gyldige måte med hvert markørord, skal tegnes av plattformen
// med klassen tabellen sier — og tabellen skal lese den som én ramme.
describe("FRAME_KINDS stemmer med plattformens tegner", () => {
  const minimal: Record<string, (word: string) => string> = {
    tenk: (w) => lines(`:::${w} Spørsmål?`, "Svar.", ":::"),
    sjekk: (w) => lines(`:::${w} Spørsmål?`, "- [x] Ja", "- [ ] Nei", ":::"),
    kort: (w) => lines(`:::${w}`, "### En", "Tekst.", ":::"),
    steg: (w) => lines(`:::${w}`, "### En", "a", "### To", "b", ":::"),
    skriv: (w) => lines(`:::${w} Oppgave`, "Svaret.", ":::"),
    repetisjon: (w) => lines(`:::${w}`, "### En", "a", "### To", "b", ":::"),
    par: (w) => lines(`:::${w}`, "- A = a", "- B = b", "- C = c", ":::"),
    feil: (w) => lines(`:::${w} Oppgave`, "- [ ] A.", "- [x] B.", "- [ ] C.", ":::"),
  };
  it("hver type og hvert markørord tegnes med tabellens klasse, og leses som én ramme", () => {
    for (const entry of FRAME_KINDS) {
      const make = minimal[entry.kind];
      expect(make, `mangler eksempel for ${entry.kind} i vakta`).toBeTypeOf("function");
      for (const word of entry.words) {
        const md = make!(word);
        expect(renderSectionBlocks(md, "nb"), `${entry.kind} / :::${word}`).toContain(entry.drawnAs);
        expect(readFrames(md).map((f: { kind: string }) => f.kind), `${entry.kind} / :::${word}`).toEqual([entry.kind]);
      }
    }
  });
});
