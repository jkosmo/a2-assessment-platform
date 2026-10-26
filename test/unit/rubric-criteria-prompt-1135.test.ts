import { describe, expect, it } from "vitest";
import { parseRubricCriteriaForPrompt } from "../../src/modules/assessment/AssessmentInputFactory.js";
import { buildAzureOpenAiMessages, buildRubricCriteriaSection } from "../../src/modules/assessment/llmAssessmentService.js";

// #1135: KI-vurdereren fikk bare kriterienes ID-er. Nå får den det kriteriet sier — etikett og
// beskrivelse med trinnene, på deltakerens språk — og poengene skal følge trinnene.

const tre = (nb: string, nn: string, en: string) => ({ nb, nn, "en-GB": en });

describe("#1135 kriteriene slik vurdereren leser dem", () => {
  it("objektform med etikett og beskrivelse, på deltakerens språk, og skalaen fra maxScore", () => {
    const json = JSON.stringify({
      kontroll: { label: tre("Kontroll mot notatene", "Kontroll mot notata", "Check against the notes"), description: tre("0 = feil står igjen; 1 = noen rettet; 2 = alt stemmer", "0 = feil står att; 1 = nokre retta; 2 = alt stemmer", "0 = errors remain; 1 = some fixed; 2 = all correct"), maxScore: 2 },
    });
    expect(parseRubricCriteriaForPrompt(json, "nn")).toEqual([
      { id: "kontroll", label: "Kontroll mot notata", description: "0 = feil står att; 1 = nokre retta; 2 = alt stemmer", scaleMax: 2 },
    ]);
    expect(parseRubricCriteriaForPrompt(json, "en-GB")[0]).toMatchObject({ label: "Check against the notes", description: "0 = errors remain; 1 = some fixed; 2 = all correct" });
  });

  it("strengform («0–4: …»): beskrivelsen er strengen; en 0–4-skala trenger ingen omregning", () => {
    expect(parseRubricCriteriaForPrompt(JSON.stringify({ vurdering: "0–4: 0 = ingen; 2 = delvis; 4 = full" }), "nb")).toEqual([
      { id: "vurdering", label: null, description: "0–4: 0 = ingen; 2 = delvis; 4 = full", scaleMax: null },
    ]);
  });

  it("strengform som språkkart, og en 0–3-skala", () => {
    const [k] = parseRubricCriteriaForPrompt(JSON.stringify({ behov: tre("Behov, 0–3 poeng. 0: … 3: …", "Behov, 0–3 poeng. 0: … 3: …", "Needs, 0–3 points. 0: … 3: …") }), "en-GB");
    expect(k).toEqual({ id: "behov", label: null, description: "Needs, 0–3 points. 0: … 3: …", scaleMax: 3 });
  });

  it("bare en vekt (standardrubrikken), og en liste med id (fra KI)", () => {
    expect(parseRubricCriteriaForPrompt(JSON.stringify({ task_comprehension: { weight: 0.2 } }), "nb")).toEqual([
      { id: "task_comprehension", label: null, description: null, scaleMax: null },
    ]);
    expect(parseRubricCriteriaForPrompt(JSON.stringify([{ id: "scenario", label: "Bruk av scenarioet", description: "0 = …; 2 = …; 4 = …", maxScore: 4 }]), "nb")).toEqual([
      { id: "scenario", label: "Bruk av scenarioet", description: "0 = …; 2 = …; 4 = …", scaleMax: null },
    ]);
  });

  it("ugyldig JSON gir ingen kriterier", () => {
    expect(parseRubricCriteriaForPrompt("ikke json", "nb")).toEqual([]);
  });
});

describe("#1135 i prompten", () => {
  const kriterier = [
    { id: "vedtak", label: "Vedtakene", description: "0 = mangler; 1 = blandet; 2 = først og presist", scaleMax: 2 },
    { id: "oppfolging", label: null, description: "0–4: 0 = ingen; 2 = uten frist; 4 = med ansvarlig og frist", scaleMax: null },
    { id: "generell", label: null, description: null, scaleMax: null },
  ];

  it("hvert kriterium med etikett, beskrivelse og omregning fra egen skala; uten beskrivelse bare ID-en", () => {
    const section = buildRubricCriteriaSection(kriterier)!;
    expect(section).toContain("score each criterion by its own description");
    expect(section).toContain("- vedtak — Vedtakene [described on 0–2; report on 0–4 as level × 2, rounded]: 0 = mangler; 1 = blandet; 2 = først og presist");
    expect(section).toContain("- oppfolging: 0–4: 0 = ingen; 2 = uten frist; 4 = med ansvarlig og frist");
    expect(section).toContain("- generell");
  });

  it("ingen kriterier med noe å si → ingen seksjon (som før)", () => {
    expect(buildRubricCriteriaSection([{ id: "a", label: null, description: null, scaleMax: null }])).toBeNull();
    expect(buildRubricCriteriaSection(undefined)).toBeNull();
  });

  it("seksjonen står i meldingen til modellen, og svarkontrakten er uendret", () => {
    const [, user] = buildAzureOpenAiMessages({
      moduleId: "m1",
      responseJson: { response: "Svar" },
      rubricCriteriaIds: ["vedtak", "oppfolging", "generell"],
      rubricCriteria: kriterier,
    } as Parameters<typeof buildAzureOpenAiMessages>[0]);
    expect(user!.content).toContain("- vedtak — Vedtakene [described on 0–2");
    expect(user!.content).toContain("rubric_scores: object with integer values 0..4 for each rubric criterion:");
    expect(user!.content.indexOf("Rubric criteria")).toBeGreaterThan(user!.content.indexOf("rubric_scores"));
  });
});
