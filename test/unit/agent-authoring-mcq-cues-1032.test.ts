import { describe, expect, it } from "vitest";
import { checkMcqCues, collectMcqSets, LENGTH_RATIO } from "../../skills/a2-authoring-api/scripts/mcq-cue-check.mjs";

// #1032: rett svar røper seg — lengst i 76 %, på plass 1 i 78 % av spørsmålene på stage. Sjekken
// fanger begge mønstrene deterministisk før noen leser settet.

const L = (t: string) => ({ nb: t, nn: t, "en-GB": t });
const q = (stem: string, options: string[], correct: number) => ({ stem: L(stem), options: options.map(L), correctAnswer: L(options[correct]) });

// Slik settene på stage så ut: fasiten er den eneste fullstendige setningen, og står øverst.
const stageLike = [
  q("Hva er formålet med en risikovurdering?", ["Å identifisere, analysere og evaluere risiko slik at tiltak kan prioriteres", "Å lage en rapport", "Å følge loven", "Å informere ledelsen"], 0),
  q("Hvem har ansvaret?", ["Virksomhetens øverste leder har det overordnede ansvaret for at vurderingen gjøres", "Verneombudet", "HMS-rådgiver", "Alle ansatte"], 0),
  q("Når skal den oppdateres?", ["Ved vesentlige endringer i virksomheten og minst årlig", "Hvert femte år", "Aldri", "Ved tilsyn"], 0),
  q("Hva er en fare?", ["En kilde eller situasjon som kan føre til skade på mennesker, miljø eller verdier", "En ulykke", "En risiko", "Et avvik"], 0),
  q("Hva er restrisiko?", ["Risikoen som gjenstår etter at planlagte tiltak er gjennomført", "Null risiko", "Ny risiko", "Total risiko"], 0),
];

// Samme stoff, skrevet slik spillboka nå krever: like lange alternativer, fasit spredt på plassene.
// (Første utkast av dette settet strøk selv på sjekken — fasiten i q5 var 1,30× distraktorene.)
const balanced = [
  q("En entreprenør skal grave nær en høyspentkabel. Hva er første steg?", ["Kartlegge farene ved gravingen før arbeidet starter", "Bestille gravemaskin med isolerte belter", "Varsle netteier etter at gravingen er i gang", "Sette opp sperringer rundt hele anleggsområdet"], 0),
  q("Ledelsen får en risikovurdering som er tre år gammel. Hva bør de gjøre?", ["Arkivere den som gyldig dokumentasjon", "Be om en oppdatert vurdering før nye tiltak", "Sende den til tilsynsmyndigheten uendret", "Fjerne tiltakene som allerede er gjennomført"], 1),
  q("Etter tiltak gjenstår en liten sannsynlighet for skade. Hva kalles dette?", ["Iboende risiko", "Akseptkriterium", "Restrisiko", "Farekilde"], 2),
  q("Verneombudet oppdager en ny fare. Hvem har ansvaret for at den vurderes?", ["Verneombudet selv, siden hen fant den", "HMS-rådgiveren, som skriver rapporten", "De ansatte som er utsatt for faren", "Øverste leder, som eier vurderingen"], 3),
  q("Hva skiller en fare fra en risiko?", ["En fare kan gi skade; risiko er sannsynlighet og konsekvens", "En fare er alvorlig; en risiko er mindre alvorlig", "En fare gjelder mennesker; en risiko gjelder verdier", "En fare er lovregulert; en risiko er frivillig å vurdere"], 0),
];

describe("mcq-cue-check (#1032)", () => {
  it("flags the stage pattern: every correct option longest and in position 1", () => {
    const r = checkMcqCues(stageLike);
    expect(r.ok).toBe(false);
    const kinds = r.issues.map((i) => i.kind);
    expect(kinds).toContain("position_bias");
    expect(kinds).toContain("length_bias");
    expect(kinds.filter((k) => k === "correct_is_longest").length).toBeGreaterThanOrEqual(4);
    expect(r.stats.correctPositionShare["0"]).toBe(1);
    expect(r.stats.correctLongestShare).toBe(1);
    const pos = r.issues.find((i) => i.kind === "position_bias")!;
    expect(pos.detail).toMatch(/5 of 5 correct answers sit in position 1/);
  });

  it("passes a set with balanced lengths and rotated positions", () => {
    const r = checkMcqCues(balanced);
    expect(r.issues, JSON.stringify(r.issues)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.stats.correctPositionShare).length).toBe(4);
  });

  it("the length rule is per question: one long correct option is reported with the ratio", () => {
    const r = checkMcqCues([q("Stem?", ["Kort", "Også kort", "Et mye lengre og mer utfyllende alternativ som er riktig"], 2)]);
    const issue = r.issues.find((i) => i.kind === "correct_is_longest");
    expect(issue).toBeTruthy();
    expect(issue!.index).toBe(0);
    expect(issue!.detail).toContain(`> ${LENGTH_RATIO}`);
  });

  it("set-level rules need at least four questions, so a two-question set is judged per question only", () => {
    const r = checkMcqCues(balanced.slice(0, 2).map((x) => ({ ...x, correctAnswer: x.options[0] })));
    expect(r.issues.map((i) => i.kind)).not.toContain("position_bias");
  });

  it("catch-all options and too few options are named", () => {
    const r = checkMcqCues([q("Stem?", ["A", "Alle de ovenfor"], 1)]);
    expect(r.issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["too_few_options", "catch_all_option"]));
  });

  it("collects sets from an authoring package and from a course envelope", () => {
    const pkg = { packageFormat: "a2-authoring-package/v1", objects: [{ clientRef: "m1", type: "module", payload: { module: {}, activeVersion: { mcqSet: { questions: balanced } } } }] };
    expect(collectMcqSets(pkg).map((s) => s.path)).toEqual(["objects[m1]"]);
    const env = { scope: "course", course: { course: { items: [{ type: "SECTION" }, { type: "MODULE", module: { activeVersion: { mcqSet: { questions: balanced } } } }] } } };
    expect(collectMcqSets(env).map((s) => s.path)).toEqual(["course.items[1]"]);
  });
});
