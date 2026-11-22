import { describe, expect, it } from "vitest";
import { checkRubricScales, collectRubrics, describedSteps, scaleIsDescribed } from "../../skills/a2-authoring-api/scripts/rubric-check.mjs";
import { packageRubricWarnings, rubricWarnings } from "../../src/modules/adminContent/rubricWarnings.js";
import { buildModuleRubricPrompts } from "../../src/modules/adminContent/llmContentGenerationService.js";

// #1122: hvert kriterium beskriver skalaen — bunn, topp og minst ett trinn imellom. Målt på stage før
// grensen ble satt: 55 av 74 kriterier hadde én linje for hele skalaen.

describe("#1122 trinnene på skalaen", () => {
  it("én linje for hele skalaen → funn, med navnet og skalaen", () => {
    const [funn, ...flere] = checkRubricScales({ konkrete_regler: "0-4: Reglene er konkrete og relevante for prosjektarbeid." });
    expect(flere).toEqual([]);
    expect(funn).toMatchObject({ criterion: "konkrete_regler", kind: "scale_not_described" });
    expect(funn!.detail).toContain("one line for 0–4");
  });

  it("hvert trinn beskrevet (0 = …; 1 = …; 2 = …) → godkjent", () => {
    expect(checkRubricScales({ kontroll: "0–2: 0 = ingen kontroll; 1 = sier generelt at resultatet må sjekkes; 2 = sier at notatet må kontrolleres mot kildene" })).toEqual([]);
  });

  it("«Behov, 0–3 poeng. 0: … 1: … 2: … 3: …» → godkjent", () => {
    expect(checkRubricScales({ behov: "Behov, 0–3 poeng. 0: Gjentar løsningen. 1: Et relevant problem. 2: Relevante behov. 3: Tydelig skilt fra løsning." })).toEqual([]);
  });

  it("bunn, midt og topp (0 = …, 2 = …, 4 = …) i et objekt med maxScore → godkjent", () => {
    const kriterium = { label: "Oppgaver for agenten", description: "Punkt 1. 0–4: Peker på deler som passer. 0 = mangler, 2 = eksempel uten begrunnelse, 4 = godt begrunnet eksempel.", maxScore: 4 };
    expect(checkRubricScales({ egnede: kriterium })).toEqual([]);
  });

  it("uten bunnen, eller uten toppen → funn", () => {
    expect(scaleIsDescribed(describedSteps("0–4: 1 = lite; 2 = noe; 4 = alt"))).toBe(false);
    expect(scaleIsDescribed(describedSteps("0–4: 0 = ingenting; 2 = noe; 3 = mye"))).toBe(false);
  });

  it("bare bunn og topp på en skala med midte → funn", () => {
    expect(scaleIsDescribed(describedSteps("0–4: 0 = ingenting; 4 = alt"))).toBe(false);
  });

  it("«Fra overflatisk til presis» beskriver endene i ord, ikke trinnene → funn", () => {
    expect(checkRubricScales({ analyse: "0-4: Fra overflatisk omtale til presis vurdering." })).toHaveLength(1);
  });

  it("med maxScore leses ikke «artikkel 6-1» som skalaen", () => {
    expect(describedSteps({ description: "Viser til artikkel 6-1. 0 = mangler; 2 = nevner den; 4 = anvender den riktig.", maxScore: 4 })).toMatchObject({ min: 0, max: 4, described: [0, 2, 4] });
  });

  it("et kriterium uten skala i det hele tatt (bare vekt) → funn", () => {
    expect(checkRubricScales({ task_comprehension: { weight: 0.2 } })).toHaveLength(1);
  });

  it("språkkart: teksten leses på primærspråket", () => {
    expect(checkRubricScales({ k: { nb: "0–2: 0 = ingen; 1 = noe; 2 = alt", "en-GB": "0–2: nothing" } }, { primary: "nb" })).toEqual([]);
  });

  it("collectRubrics finner rubrikkene i pakke og kurseksport, med tittel", () => {
    const rubric = { criteria: { k: "0-4: x" } };
    expect(collectRubrics({ objects: [{ clientRef: "m1", type: "module", payload: { activeVersion: { rubric } } }] }).map((r) => r.path)).toEqual(["objects[m1]"]);
    const env = { scope: "course", course: { course: { items: [{ type: "MODULE", module: { module: { title: { nb: "Test" } }, activeVersion: { rubric } } }] } } };
    expect(collectRubrics(env)).toEqual([{ path: "course.items[0]", title: { nb: "Test" }, criteria: rubric.criteria }]);
  });
});

describe("#1122 på plattformen", () => {
  it("varselet bruker kriteriets etikett når den finnes, og tar lister med id (fra KI)", () => {
    expect(rubricWarnings([{ id: "scenario", label: "Bruk av scenarioet", description: "Bruker scenarioet.", maxScore: 4 }])).toEqual([{ code: "scale_not_described", criterion: "Bruk av scenarioet" }]);
    expect(rubricWarnings({ funn: "0-4: Komplette funn." })).toEqual([{ code: "scale_not_described", criterion: "funn" }]);
    // Uten etikett: id-en fra lista, ikke plassen i den.
    expect(rubricWarnings([{ id: "prioritering", description: "Prioriterer.", maxScore: 4 }])).toEqual([{ code: "scale_not_described", criterion: "prioritering" }]);
  });

  it("pakkevarslene er per modul, bare moduler med funn", () => {
    const env = { scope: "course", course: { course: { items: [
      { type: "MODULE", module: { module: { title: { nb: "God" } }, activeVersion: { rubric: { criteria: { k: "0–1: 0 = nei; 1 = ja" } } } } },
      { type: "MODULE", module: { module: { title: { nb: "Svak" } }, activeVersion: { rubric: { criteria: { k: "0-4: x" } } } } },
    ] } } };
    expect(packageRubricWarnings(env)).toEqual([{ title: { nb: "Svak" }, warnings: [{ code: "scale_not_described", criterion: "k" }] }]);
  });

  it("KI-instruksen ber om hvert trinn og om at kriteriet gjelder noe oppgaven ber om", () => {
    const { userPrompt } = buildModuleRubricPrompts({ taskText: "Oppgave", assessorExpectedContent: "Forventet", certificationLevel: "basic", locale: "nb" } as Parameters<typeof buildModuleRubricPrompts>[0]);
    expect(userPrompt).toContain("describes the scale step by step");
    expect(userPrompt).toContain("Each criterion assesses something the task text explicitly asks the candidate to do.");
  });
});
