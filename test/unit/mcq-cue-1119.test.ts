import { describe, expect, it } from "vitest";
import { checkMcqCues, collectMcqSets, ECHO_MIN_WORDS } from "../../skills/a2-authoring-api/scripts/mcq-cue-check.mjs";

// #1119: fire regler fra kursgjennomgangen 2026-10-26, målt mot de 15 kursene på stage før grensene
// ble satt. Én fil, brukt av skillet (stopper) og plattformen (varsler).

const L = (t: string) => ({ nb: t, nn: t, "en-GB": t });
const q = (stem: string, options: string[], correct: number) => ({ stem: L(stem), options: options.map(L), correctAnswer: L(options[correct]!) });
const kinds = (r: ReturnType<typeof checkMcqCues>) => r.issues.map((i) => i.kind);

describe("#1119 absolutte ord blant de gale", () => {
  const giveaway = [
    q("En kollega vil la KI sende tilbudet. Hva gjør du?", ["Leser gjennom og retter før det sendes", "Lar KI sende det automatisk", "Sender det uansett hva det står"], 0),
    q("Hvem eier innholdet i rapporten?", ["Den som leverer den til kunden", "KI-verktøyet, alltid", "Ingen, siden teksten er generert"], 0),
    q("Når kan du bruke kundedata i en chat?", ["Når avtalen og verktøyet tillater det", "Aldri, under noen omstendighet", "Når kunden har sagt ja muntlig"], 0),
  ];

  it("tre gale med «automatisk», «uansett», «alltid», «aldri» og ingen riktige → absolute_words, med eksempler", () => {
    const r = checkMcqCues(giveaway);
    const issue = r.issues.find((i) => i.kind === "absolute_words");
    expect(issue, JSON.stringify(r.issues)).toBeTruthy();
    expect(issue!.index).toBeNull();
    expect(issue!.detail).toMatch(/^4 of 6 wrong options/);
    expect(issue!.detail).toContain("q2 «KI-verktøyet, alltid»");
  });

  it("to gale med slike ord er under grensen — ett «aldri» kan være selve misforståelsen", () => {
    expect(kinds(checkMcqCues(giveaway.slice(1)))).not.toContain("absolute_words");
  });

  it("når de riktige har ordene like ofte, er ordene ikke et hint", () => {
    const fair = giveaway.map((x, i) => ({ ...x, correctAnswer: L(["Lar KI sende det automatisk", "KI-verktøyet, alltid", "Aldri, under noen omstendighet"][i]!) }));
    expect(kinds(checkMcqCues(fair))).not.toContain("absolute_words");
  });

  it("ordet må stå alene — «kunde» er ikke «kun», «aldrig» ikke «aldri»", () => {
    const words = [
      q("Hva gjør du først?", ["Spør kunden", "Spør kundens leder", "Spør kundesenteret"], 0),
      q("Hva gjør du så?", ["Les avtalen", "Les kundeavtalen", "Les kunngjøringen"], 0),
      q("Hva gjør du til slutt?", ["Send", "Send kundebrevet", "Send kunngjøringen"], 0),
    ];
    expect(kinds(checkMcqCues(words))).not.toContain("absolute_words");
  });
});

describe("#1119 stammen spør hva kurset sier", () => {
  it.each([
    "Hva anbefaler kurset når du skal levere tre dokumenter?",
    "Hvilken bestilling følger kursets råd?",
    "Hvilke fire ansvarstyper bruker seksjonen?",
    "What does the course recommend?",
  ])("«%s» → stem_about_course", (stem) => {
    expect(kinds(checkMcqCues([q(stem, ["Ett valg", "Et annet", "Et tredje"], 0)]))).toContain("stem_about_course");
  });

  it.each([
    "Hva skal skje med restrisikoen ifølge NVE?",
    "Notatet gjemmer beslutningspunktet langt nede i teksten. Hva gjør du?",
    "Hvilket kursted passer best for samlingen?",
  ])("«%s» → ikke et spørsmål om kurset", (stem) => {
    expect(kinds(checkMcqCues([q(stem, ["Ett valg", "Et annet", "Et tredje"], 0)]))).not.toContain("stem_about_course");
  });
});

describe("#1119 riktig svar gjentar lesestoffet", () => {
  const section = "Før møtet bør du legge bakgrunnsdokumentene i et prosjekt slik at kildene er tilgjengelige i alle samtalene hele tiden.";
  const echo = q("Hvorfor et prosjekt?", ["Kildene er tilgjengelige i alle samtalene hele tiden", "Prosjekter er raskere å åpne", "Det gir bedre formatering"], 0);

  it(`${ECHO_MIN_WORDS} ord på rad fra seksjonen og ingen gale gjør det → answer_echoes_text`, () => {
    expect(kinds(checkMcqCues([echo], { reading: [L(section)] }))).toContain("answer_echoes_text");
  });

  it("uten lesestoff hoppes regelen over", () => {
    expect(kinds(checkMcqCues([echo]))).not.toContain("answer_echoes_text");
  });

  it("deler et galt alternativ halvparten så mange ord, er gjenkjenning ikke et hint", () => {
    const both = { ...echo, options: [echo.options[0], L("Bakgrunnsdokumentene i et prosjekt blir slettet"), echo.options[2]] };
    expect(kinds(checkMcqCues([both], { reading: [L(section)] }))).not.toContain("answer_echoes_text");
  });

  it("med andre ord sagt → ingen funn", () => {
    const own = { ...echo, options: [L("Du slipper å laste opp de samme filene i hver ny chat"), echo.options[1], echo.options[2]], correctAnswer: L("Du slipper å laste opp de samme filene i hver ny chat") };
    expect(kinds(checkMcqCues([own], { reading: [L(section)] }))).not.toContain("answer_echoes_text");
  });

  it("collectMcqSets gir lesestoffet før hver test, både i pakke og eksport", () => {
    const pkg = {
      objects: [
        { clientRef: "c", type: "course", payload: { items: [{ ref: "s1" }, { ref: "m1" }, { ref: "s2" }, { ref: "m2" }] } },
        { clientRef: "s1", type: "section", payload: { bodyMarkdown: L("Først") } },
        { clientRef: "s2", type: "section", payload: { bodyMarkdown: L("Så") } },
        { clientRef: "m1", type: "module", payload: { activeVersion: { mcqSet: { questions: [echo] } } } },
        { clientRef: "m2", type: "module", payload: { activeVersion: { mcqSet: { questions: [echo] } } } },
      ],
    };
    expect(collectMcqSets(pkg).map((s) => s.reading)).toEqual([[L("Først")], [L("Først"), L("Så")]]);
    const env = { scope: "course", course: { course: { items: [{ type: "SECTION", section: { bodyMarkdown: L("Først") } }, { type: "MODULE", module: { module: { title: L("Test") }, activeVersion: { mcqSet: { questions: [echo] } } } }] } } };
    const [set] = collectMcqSets(env);
    expect(set!.reading).toEqual([L("Først")]);
    expect(set!.title).toEqual(L("Test"));
  });
});
