import { describe, expect, it, vi } from "vitest";
import { stepTexts } from "#rubric-check";
import { buildCriterionScores, buildParticipantCriteria } from "../../src/modules/assessment/participantCriteria.js";
import { toSubmissionResultView } from "../../src/modules/submission/submissionReadModels.js";

// #1124: deltakeren ser kriteriene med trinnene før levering, og poengene per kriterium etter.
// Reglene prøves her; at rutene faktisk sender feltene, prøves gjennom supertest i
// test/participant-criteria-1124.test.ts (integrasjon).

const { queryModules, queryModuleById, findOwnedSubmission, queryRubricCriteriaJson } = vi.hoisted(() => ({
  queryModules: vi.fn(),
  queryModuleById: vi.fn(),
  findOwnedSubmission: vi.fn(),
  queryRubricCriteriaJson: vi.fn(),
}));
vi.mock("../../src/repositories/moduleRepository.js", () => ({
  queryModules,
  queryModuleById,
  queryModuleVersion: vi.fn(),
}));
vi.mock("../../src/modules/submission/submissionRepository.js", () => ({
  queryLatestSubmissionsForModules: vi.fn(async () => []),
  queryCompletedSubmissionsForUser: vi.fn(async () => []),
  submissionRepository: { findOwnedSubmission },
  createSubmissionRepository: () => ({ findOwnedSubmission }),
  getModuleWithActiveVersion: vi.fn(),
  queryRubricCriteriaJson,
}));

import { getModuleById, listModules } from "../../src/modules/module/moduleService.js";
import { getOwnedSubmissionResultView } from "../../src/modules/submission/submissionService.js";

const tre = (nb: string, nn: string, en: string) => ({ nb, nn, "en-GB": en });

const CRITERIA = JSON.stringify({
  vedtak: {
    label: tre("Vedtakene", "Vedtaka", "The decisions"),
    description: tre(
      "0 = vedtakene mangler; 1 = blandet med diskusjonen; 2 = står først, presist",
      "0 = vedtaka manglar; 1 = blanda med diskusjonen; 2 = står først, presist",
      "0 = decisions missing; 1 = mixed with the discussion; 2 = first, precise",
    ),
    maxScore: 2,
    weight: 0.5,
    candidateVisible: true,
  },
  // Uten flagg: synlig (produkteier: «standard: ja»).
  struktur: { label: "Struktur", description: "0–4: 0 = ingen; 2 = delvis; 4 = tydelig struktur" },
  // Holdt tilbake: teksten røper svaret.
  hemmelig: { label: "Nevner artikkel 6-1", description: "0 = nei; 2 = ja", maxScore: 2, candidateVisible: false },
  // Bare en vekt: ingenting å vise før levering.
  task_comprehension: { weight: 0.2 },
});

describe("#1124 stepTexts — trinnene med kriteriets egne ord", () => {
  it("deler «k = …» i trinn og tar bort skilletegnene mellom dem", () => {
    expect(stepTexts({ maxScore: 2, description: "0 = mangler; 1 = blandet; 2 = presist." }, "nb")).toEqual({
      min: 0, max: 2, intro: null,
      steps: [{ step: 0, text: "mangler" }, { step: 1, text: "blandet" }, { step: 2, text: "presist" }],
    });
  });

  it("innledningen er det som står før første trinn, uten skalaen", () => {
    const parts = stepTexts("Behov, 0–3 poeng. 0: ingen. 1: noe. 2: mer. 3: alt.", "nb");
    expect(parts.intro).toBe("Behov");
    expect(parts.steps.map((s) => s.step)).toEqual([0, 1, 2, 3]);
    expect(parts.steps[3]).toEqual({ step: 3, text: "alt" });
  });

  it("én linje for skalaen: ingen trinn, og teksten står igjen uten «0–4:»", () => {
    expect(stepTexts("0–4: Reglene er konkrete", "nb")).toEqual({ min: 0, max: 4, intro: "Reglene er konkrete", steps: [] });
  });

  it("uten skala leses trinnene på standardskalaen når den er gitt — og ikke ellers", () => {
    expect(stepTexts("0 = ingen; 2 = delvis; 4 = full", "nb", { defaultMax: 4 }).steps.map((s) => s.step)).toEqual([0, 2, 4]);
    expect(stepTexts("0 = ingen; 2 = delvis; 4 = full", "nb").steps).toEqual([]);
  });

  it("trinnene leses i rekkefølge: «2» i trinn 0 sin tekst er ikke trinn 2", () => {
    const parts = stepTexts({ maxScore: 2, description: "0 = færre enn 2) punkter; 1 = noen; 2 = alle" }, "nb");
    // Trinn 1 letes etter ETTER trinn 0. «2)» står før «1 =», så det ville vært trinn 2 bare om
    // letingen begynte forfra.
    expect(parts.steps.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(parts.steps[2].text).toBe("alle");
  });
});

describe("#1124 kriteriene før levering", () => {
  it("bare synlige kriterier med noe å vise, på deltakerens språk, med skala og trinn", () => {
    const criteria = buildParticipantCriteria(CRITERIA, "nn");
    expect(criteria.map((c) => c.id)).toEqual(["vedtak", "struktur"]);
    expect(criteria[0]).toEqual({
      id: "vedtak",
      label: "Vedtaka",
      scaleMax: 2,
      intro: null,
      steps: [
        { score: 0, text: "vedtaka manglar" },
        { score: 1, text: "blanda med diskusjonen" },
        { score: 2, text: "står først, presist" },
      ],
    });
    expect(criteria[1]).toMatchObject({ id: "struktur", scaleMax: 4, steps: [{ score: 0 }, { score: 2 }, { score: 4 }] });
  });

  it("ALDRI et skjult kriterium — heller ikke teksten fra det", () => {
    const sent = JSON.stringify(buildParticipantCriteria(CRITERIA, "nb"));
    expect(sent).not.toContain("hemmelig");
    expect(sent).not.toContain("artikkel 6-1");
  });

  it("et flagg som ikke er `true` holder kriteriet tilbake (en skadet rad lukker)", () => {
    const json = JSON.stringify({ a: { label: "A", description: "0 = x; 4 = y", candidateVisible: null }, b: { label: "B", candidateVisible: "ja" } });
    expect(buildParticipantCriteria(json, "nb")).toEqual([]);
  });

  it("strengform og listeform", () => {
    expect(buildParticipantCriteria(JSON.stringify({ vurdering: "0–4: 0 = ingen; 2 = delvis; 4 = full" }), "nb")).toEqual([
      { id: "vurdering", label: null, scaleMax: 4, intro: null, steps: [{ score: 0, text: "ingen" }, { score: 2, text: "delvis" }, { score: 4, text: "full" }] },
    ]);
    expect(buildParticipantCriteria(JSON.stringify([{ id: "x", label: "X", candidateVisible: false }, { id: "y", label: "Y" }]), "nb").map((c) => c.id)).toEqual(["y"]);
  });

  it("ingen rubrikk, eller bare vekter: ingen kriterier", () => {
    expect(buildParticipantCriteria(null, "nb")).toEqual([]);
    expect(buildParticipantCriteria(JSON.stringify({ a: { weight: 0.5 }, b: { weight: 0.5 } }), "nb")).toEqual([]);
  });
});

describe("#1124 poengene per kriterium", () => {
  it("vurdererens 0–4 regnes tilbake til kriteriets egen skala", () => {
    const scores = buildCriterionScores(CRITERIA, { vedtak: 2, struktur: 3, hemmelig: 4, task_comprehension: 4 }, "nb");
    expect(scores).toEqual([
      { id: "vedtak", label: "Vedtakene", score: 1, maxScore: 2, topStep: "står først, presist" },
      { id: "struktur", label: "Struktur", score: 3, maxScore: 4, topStep: "tydelig struktur" },
      { id: "task_comprehension", label: null, score: 4, maxScore: 4, topStep: null },
    ]);
  });

  it("fullt på kriteriet: ingen linje om toppnivået", () => {
    expect(buildCriterionScores(CRITERIA, { vedtak: 4 }, "nb")[0]).toMatchObject({ score: 2, maxScore: 2, topStep: null });
  });

  it("avrunding: 3 av 4 på en 0–2-skala er 2", () => {
    expect(buildCriterionScores(CRITERIA, { vedtak: 3 }, "nb")[0]).toMatchObject({ score: 2, topStep: null });
  });

  it("et kriterium uten poeng teller 0, og et poeng utenfor 0–4 klemmes", () => {
    const scores = buildCriterionScores(CRITERIA, { struktur: 9 }, "nb");
    expect(scores.find((s) => s.id === "vedtak")).toMatchObject({ score: 0, maxScore: 2 });
    expect(scores.find((s) => s.id === "struktur")).toMatchObject({ score: 4, maxScore: 4 });
  });

  it("skjulte kriterier er ikke med", () => {
    expect(JSON.stringify(buildCriterionScores(CRITERIA, { hemmelig: 2 }, "nb"))).not.toContain("hemmelig");
  });
});

describe("#1124 resultatvisningen bærer poengene", () => {
  const submission = {
    id: "s1",
    submissionStatus: "COMPLETED",
    decisions: [],
    appeals: [],
    mcqAttempts: [],
    moduleVersion: { assessmentMode: "FREETEXT_ONLY", assessmentPolicyJson: null, rubricVersionId: "r1" },
    llmEvaluations: [{
      id: "llm-1",
      practicalScoreScaled: 50,
      confidenceNote: null,
      responseJson: JSON.stringify({
        module_id: "m1", rubric_scores: { vedtak: 2, struktur: 4 }, rubric_total: 6, practical_score_scaled: 50,
        pass_fail_practical: true, criterion_rationales: { vedtak: "Blandet." }, improvement_advice: [],
        red_flags: [], manual_review_recommended: false, confidence_note: "",
      }),
    }],
  };

  it("criterionScores i deltakerveiledningen", () => {
    const view = toSubmissionResultView(submission, { criteriaJson: CRITERIA, locale: "en-GB" });
    expect(view.participantGuidance.criterionScores[0]).toEqual({
      id: "vedtak", label: "The decisions", score: 1, maxScore: 2, topStep: "first, precise",
    });
  });

  it("tjenesten henter rubrikken til innleveringens modulversjon og leser den på deltakerens språk", async () => {
    findOwnedSubmission.mockResolvedValue(submission);
    queryRubricCriteriaJson.mockResolvedValue(CRITERIA);
    const view = await getOwnedSubmissionResultView("s1", "u1", "nb");
    expect(queryRubricCriteriaJson).toHaveBeenCalledWith("r1");
    expect(view?.participantGuidance.criterionScores[0]).toMatchObject({ label: "Vedtakene", score: 1, maxScore: 2 });
  });

  it("uten vurdering: tom liste", () => {
    expect(toSubmissionResultView({ ...submission, llmEvaluations: [] }, { criteriaJson: CRITERIA, locale: "nb" }).participantGuidance.criterionScores).toEqual([]);
  });
});

describe("#1124 modulen deltakeren får", () => {
  const dbModule = {
    id: "m1",
    title: "Modul",
    description: null,
    certificationLevel: null,
    validFrom: null,
    validTo: null,
    activeVersion: {
      id: "v1",
      versionNo: 1,
      taskText: "Skriv referatet",
      assessorExpectedContent: "FASIT: budsjettet ble godkjent",
      candidateTaskConstraints: null,
      submissionSchemaJson: null,
      assessmentPolicyJson: null,
      assessmentMode: "FREETEXT_ONLY",
      publishedAt: new Date(),
      rubricVersionId: "r1",
      promptTemplateVersionId: "p1",
      mcqSetVersionId: null,
      rubricVersion: { criteriaJson: CRITERIA },
    },
  };

  it("har assessmentCriteria, og verken fasiten, råkriteriene eller det skjulte kriteriet — noe sted", async () => {
    queryModules.mockResolvedValue([dbModule]);
    queryModuleById.mockResolvedValue(dbModule);
    const [listed] = await listModules([], undefined, "nb", { participantFacing: true });
    const single = await getModuleById("m1", [], "nb", { participantFacing: true });
    for (const module of [listed, single]) {
      expect(module?.assessmentCriteria.map((c) => c.id)).toEqual(["vedtak", "struktur"]);
      const sent = JSON.stringify(module);
      expect(sent).not.toContain("assessorExpectedContent");
      expect(sent).not.toContain("FASIT");
      expect(sent).not.toContain("criteriaJson");
      expect(sent).not.toContain("hemmelig");
      expect(sent).not.toContain("artikkel 6-1");
    }
  });

  it("forfattersiden beholder fasiten i modulversjonen, men får heller ikke råkriteriene", async () => {
    queryModuleById.mockResolvedValue(dbModule);
    const admin = await getModuleById("m1", ["ADMINISTRATOR"], "nb", { participantFacing: false });
    expect(admin?.activeVersion).toHaveProperty("assessorExpectedContent", "FASIT: budsjettet ble godkjent");
    expect(JSON.stringify(admin)).not.toContain("criteriaJson");
  });
});
