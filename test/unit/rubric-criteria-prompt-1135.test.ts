import { describe, expect, it } from "vitest";
import { buildAssessmentInputContext, parseRubricCriteriaForPrompt } from "../../src/modules/assessment/AssessmentInputFactory.js";
import { buildAzureOpenAiMessages, buildRequiredResponseContract, buildRubricCriteriaSection, normalizeRubricScoresToContract } from "../../src/modules/assessment/llmAssessmentService.js";

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
    expect(section).toContain("- vedtak — Vedtakene [score 0–2]: 0 = mangler; 1 = blandet; 2 = først og presist");
    expect(section).toContain("- oppfolging: 0–4: 0 = ingen; 2 = uten frist; 4 = med ansvarlig og frist");
    expect(section).toContain("- generell");
  });

  // Målt på stage: uten disse linjene trakk modellen et fullgodt svar for ting trinnet ikke nevner.
  it("ber om toppnivået når trinnet er oppfylt, og ingen trekk for det trinnet ikke nevner", () => {
    const section = buildRubricCriteriaSection(kriterier)!;
    expect(section).toContain("Give the highest step when the submission does what that step describes.");
    expect(section).toContain("Do not deduct for anything the step does not name");
    expect(section).toContain("give the higher one only if it meets everything the higher step names");
  });

  it("ingen kriterier med noe å si → ingen seksjon (som før)", () => {
    expect(buildRubricCriteriaSection([{ id: "a", label: null, description: null, scaleMax: null }])).toBeNull();
    expect(buildRubricCriteriaSection(undefined)).toBeNull();
  });

  it("seksjonen står i meldingen til modellen, og står etter svarkontrakten", () => {
    const [, user] = buildAzureOpenAiMessages({
      moduleId: "m1",
      responseJson: { response: "Svar" },
      rubricCriteriaIds: ["vedtak", "oppfolging", "generell"],
      rubricCriteria: kriterier,
    } as Parameters<typeof buildAzureOpenAiMessages>[0]);
    expect(user!.content).toContain("- vedtak — Vedtakene [score 0–2]");
    expect(user!.content).toContain("rubric_scores: object with integer values for each rubric criterion");
    expect(user!.content.indexOf("Rubric criteria")).toBeGreaterThan(user!.content.indexOf("rubric_scores"));
  });
});

// #1135, målt på stage: modellen regnet ikke om selv — et perfekt 0–2-svar ble 50 %. Nå gir den poeng
// på kriteriets egen skala, kontrakten sier hvilken, og plattformen regner om til 0–4.
describe("#1135 omregningen til 0–4 skjer i koden", () => {
  const svar = (rubric_scores: Record<string, number>) => ({ rubric_scores, rubric_total: Object.values(rubric_scores).reduce((a, b) => a + b, 0) }) as never;
  const kriterier = [
    { id: "vedtak", label: "Vedtakene", description: "0 = …; 1 = …; 2 = …", scaleMax: 2 },
    { id: "behov", label: null, description: "0–3: …", scaleMax: 3 },
    { id: "vanlig", label: null, description: "0–4: …", scaleMax: null },
  ];

  it("2 av 2 blir 4, 1 av 2 blir 2, 2 av 3 blir 3 (avrundet), 0–4 står urørt; totalen følger", () => {
    const r = normalizeRubricScoresToContract(svar({ vedtak: 2, behov: 2, vanlig: 3 }), kriterier) as { rubric_scores: Record<string, number>; rubric_total: number };
    expect(r.rubric_scores).toEqual({ vedtak: 4, behov: 3, vanlig: 3 });
    expect(r.rubric_total).toBe(10);
    expect((normalizeRubricScoresToContract(svar({ vedtak: 1, behov: 0, vanlig: 0 }), kriterier) as { rubric_scores: Record<string, number> }).rubric_scores.vedtak).toBe(2);
  });

  it("et poeng over kriteriets skala (modellen regnet om likevel) blir ikke mer enn 4", () => {
    expect((normalizeRubricScoresToContract(svar({ vedtak: 4, behov: 3, vanlig: 4 }), kriterier) as { rubric_scores: Record<string, number> }).rubric_scores).toEqual({ vedtak: 4, behov: 4, vanlig: 4 });
  });

  it("uten kriterier med egen skala er svaret uendret", () => {
    const input = svar({ a: 3 });
    expect(normalizeRubricScoresToContract(input, [{ id: "a", label: null, description: null, scaleMax: null }])).toBe(input);
  });

  it("kontrakten oppgir kriteriets egen skala", () => {
    const kontrakt = buildRequiredResponseContract(["vedtak", "vanlig"], { vedtak: 2 });
    expect(kontrakt).toContain("  - vedtak (0..2)");
    expect(kontrakt).toContain("  - vanlig\n");
    expect(kontrakt).toContain("0..4, or 0..N where a criterion below says (0..N)");
  });

  it("prompten bygger kontrakten med skalaene fra kriteriene", () => {
    const [, user] = buildAzureOpenAiMessages({
      moduleId: "m1",
      responseJson: { response: "Svar" },
      rubricCriteriaIds: ["vedtak", "vanlig"],
      rubricCriteria: [kriterier[0]!, kriterier[2]!],
    } as Parameters<typeof buildAzureOpenAiMessages>[0]);
    expect(user!.content).toContain("  - vedtak (0..2)");
  });
});

// #1135, målt mot stage-modellen: malene ble sendt som hele språkkartet, og vedtaket fikk «ikke
// plassert først» i halvparten av forsøkene. Med malen på deltakerens språk: fullt hver gang.
describe("#1135 malene på deltakerens språk", () => {
  const rad = (systemPrompt: string, userPromptTemplate: string, examplesJson = "[]") => ({
    moduleId: "m1",
    responseJson: JSON.stringify({ response: "Svar" }),
    moduleVersion: {
      taskText: "Oppgave",
      assessmentPolicyJson: null,
      rubricVersion: { criteriaJson: JSON.stringify({ vedtak: { weight: 1 } }), scalingRuleJson: "{}" },
      promptTemplateVersion: { systemPrompt, userPromptTemplate, examplesJson },
    },
  });
  const kart = (nb: string, nn: string, en: string) => JSON.stringify({ "en-GB": en, nb, nn });

  it("et språkkart gir teksten på deltakerens språk, ikke kartet", () => {
    const ctx = buildAssessmentInputContext(rad(kart("Du er sensor.", "Du er sensor (nn).", "You are an assessor."), kart("Vurder.", "Vurder (nn).", "Assess.")), "nn");
    expect(ctx.promptTemplateSystem).toBe("Du er sensor (nn).");
    expect(ctx.promptTemplateUserTemplate).toBe("Vurder (nn).");
    const [system, user] = buildAzureOpenAiMessages({ moduleId: "m1", responseJson: {}, promptTemplateSystem: ctx.promptTemplateSystem, promptTemplateUserTemplate: ctx.promptTemplateUserTemplate } as Parameters<typeof buildAzureOpenAiMessages>[0]);
    expect(system!.content).toBe("Du er sensor (nn).");
    expect(user!.content).not.toContain("en-GB");
  });

  it("vanlig tekst står urørt", () => {
    const ctx = buildAssessmentInputContext(rad("Du er sensor.", "Vurder."), "nb");
    expect(ctx.promptTemplateSystem).toBe("Du er sensor.");
    expect(ctx.promptTemplateUserTemplate).toBe("Vurder.");
  });

  it("en tom eksempelliste gir ingen eksempellinje; en med innhold står der", () => {
    const melding = (examplesJson: string) => buildAzureOpenAiMessages({ moduleId: "m1", responseJson: {}, promptTemplateExamplesJson: examplesJson } as Parameters<typeof buildAzureOpenAiMessages>[0])[1]!.content;
    expect(melding("[]")).not.toContain("Prompt examples context");
    expect(melding(" [ ] ")).not.toContain("Prompt examples context");
    expect(melding('[{"svar":"x"}]')).toContain('Prompt examples context (JSON):\n[{"svar":"x"}]');
  });
});
