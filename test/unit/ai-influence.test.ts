import { describe, it, expect } from "vitest";
import {
  parseAiInfluenceSignals,
  evaluateAiInfluence,
  evaluateContentSimilarity,
  buildAiInfluenceOutcome,
  AUTONOMOUS_REVIEW_REASON,
  CONTENT_SIMILARITY_REVIEW_REASON_PREFIX,
  type AiInfluenceRules,
  type AiInfluenceContentRules,
} from "../../src/modules/assessment/aiInfluence.js";
import { resolveAssessmentDecision } from "../../src/modules/assessment/decisionService.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";
import type { ModuleAssessmentPolicy } from "../../src/codecs/assessmentPolicyCodec.js";
import { decisionReasonCodes } from "../../src/modules/assessment/decisionReason.js";
import type { AiInfluenceDecision } from "../../src/modules/assessment/aiInfluence.js";

// #950: et KI-utløst review bærer koden sin ved siden av teksten, slik at deltakerens grensesnitt
// kan formulere setningen på hens eget språk i stedet for å vise serverens norske prosa rått.
function aiDeclarationDecision(): AiInfluenceDecision {
  return {
    forcesReview: true,
    reason: AUTONOMOUS_REVIEW_REASON,
    code: decisionReasonCodes.manualReviewAiDeclaration,
    params: { description: "" },
  };
}

// #475: AI-influence flagging is a REVIEW TRIGGER, never a verdict. These tests pin the two guarantees
// that matter: (1) evaluateAiInfluence only fires under the exact enabled+live+autonomous+insisted
// conditions, and (2) once it fires it can only route a submission to review — never turn a pass into
// a fail.

const RULES_LIVE: AiInfluenceRules = { enabled: true, shadowMode: false };
const RULES_SHADOW: AiInfluenceRules = { enabled: true, shadowMode: true };
const RULES_OFF: AiInfluenceRules = { enabled: false, shadowMode: false };

describe("parseAiInfluenceSignals", () => {
  it("returns null for empty / malformed input", () => {
    expect(parseAiInfluenceSignals(null)).toBeNull();
    expect(parseAiInfluenceSignals("")).toBeNull();
    expect(parseAiInfluenceSignals("not json")).toBeNull();
    expect(parseAiInfluenceSignals("{}")).toBeNull();
  });

  it("drops an unrecognised declaration value but keeps free text", () => {
    expect(parseAiInfluenceSignals(JSON.stringify({ declaration: "wat" }))).toBeNull();
    const parsed = parseAiInfluenceSignals(JSON.stringify({ declaration: "wat", declarationText: "hi" }));
    expect(parsed).toEqual({ declaration: undefined, declarationText: "hi", insistedAfterPrompt: false });
  });

  it("parses a valid autonomous declaration with the insisted flag", () => {
    const parsed = parseAiInfluenceSignals(
      JSON.stringify({ declaration: "autonomous", declarationText: "asked it to write it", insistedAfterPrompt: true }),
    );
    expect(parsed).toEqual({
      declaration: "autonomous",
      declarationText: "asked it to write it",
      insistedAfterPrompt: true,
    });
  });
});

describe("evaluateAiInfluence", () => {
  const autonomousInsisted = { declaration: "autonomous" as const, insistedAfterPrompt: true };

  it("does not fire when the feature is disabled", () => {
    expect(evaluateAiInfluence({ signals: autonomousInsisted, policy: null, rules: RULES_OFF })).toBeNull();
  });

  it("does not fire in shadow mode (collects the declaration, routes no one)", () => {
    expect(evaluateAiInfluence({ signals: autonomousInsisted, policy: null, rules: RULES_SHADOW })).toBeNull();
  });

  it("does not fire for non-autonomous declarations", () => {
    for (const declaration of ["none", "ideas", "improve"] as const) {
      expect(
        evaluateAiInfluence({ signals: { declaration, insistedAfterPrompt: true }, policy: null, rules: RULES_LIVE }),
      ).toBeNull();
    }
  });

  it("does not fire when the participant did NOT insist after the nudge", () => {
    expect(
      evaluateAiInfluence({
        signals: { declaration: "autonomous", insistedAfterPrompt: false },
        policy: null,
        rules: RULES_LIVE,
      }),
    ).toBeNull();
  });

  it("fires only on enabled + live + autonomous + insisted", () => {
    const result = evaluateAiInfluence({ signals: autonomousInsisted, policy: null, rules: RULES_LIVE });
    expect(result).toEqual(aiDeclarationDecision());
  });

  it("carries the participant's free-text description into the reason for the reviewer", () => {
    const result = evaluateAiInfluence({
      signals: { declaration: "autonomous", insistedAfterPrompt: true, declarationText: "ChatGPT wrote it all" },
      policy: null,
      rules: RULES_LIVE,
    });
    expect(result?.forcesReview).toBe(true);
    expect(result?.reason).toContain(AUTONOMOUS_REVIEW_REASON);
    expect(result?.reason).toContain("Deltakerens beskrivelse");
    expect(result?.reason).toContain("ChatGPT wrote it all");
  });

  it("lets a per-module policy enable flagging when the global default is off", () => {
    const policy: ModuleAssessmentPolicy = { aiInfluence: { enabled: true, shadowMode: false } };
    const result = evaluateAiInfluence({ signals: autonomousInsisted, policy, rules: RULES_OFF });
    expect(result).toEqual(aiDeclarationDecision());
  });

  it("lets a per-module policy force shadow mode even when the global default is live", () => {
    const policy: ModuleAssessmentPolicy = { aiInfluence: { shadowMode: true } };
    expect(evaluateAiInfluence({ signals: autonomousInsisted, policy, rules: RULES_LIVE })).toBeNull();
  });
});

// A passing LLM assessment (rubric 14/20 → practical 49, no red flags, LLM recommends pass).
function passingAssessment(overrides: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment {
  return {
    module_id: "unit_module",
    rubric_scores: {
      c1: 3,
      c2: 3,
      c3: 2,
      c4: 3,
      c5: 3,
    },
    rubric_total: 14,
    practical_score_scaled: 49,
    pass_fail_practical: true,
    criterion_rationales: {},
    improvement_advice: [],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "High confidence.",
    evidence_sufficiency: "sufficient",
    recommended_outcome: "pass",
    manual_review_reason_code: "none",
    ...overrides,
  };
}

const passingInput = {
  mcqScaledScore: 30,
  mcqPercentScore: 100,
  llmResult: passingAssessment(),
  rubricMaxTotal: 20,
  rubricCriteriaIds: ["c1", "c2", "c3", "c4", "c5"],
  freetextOnly: false,
};

describe("resolveAssessmentDecision + aiInfluence (review trigger, never fail)", () => {
  it("auto-passes a strong submission when there is no AI-influence trigger", () => {
    const resolved = resolveAssessmentDecision({ ...passingInput });
    expect(resolved.needsManualReview).toBe(false);
    expect(resolved.passFailTotal).toBe(true);
  });

  it("routes the SAME strong submission to review (not fail) when AI-influence forces review", () => {
    const resolved = resolveAssessmentDecision({
      ...passingInput,
      aiInfluence: aiDeclarationDecision(),
    });
    // It becomes a review, never a fail: needsManualReview flips on, passFailTotal is withheld, and
    // the auto-fail path is NOT taken.
    expect(resolved.needsManualReview).toBe(true);
    expect(resolved.autoFailForInsufficientEvidence).toBe(false);
    expect(resolved.passFailTotal).toBe(false);
    expect(resolved.decisionReason).toBe(AUTONOMOUS_REVIEW_REASON);
  });

  it("does not change the outcome when forcesReview is false", () => {
    const resolved = resolveAssessmentDecision({
      ...passingInput,
      // ⚠️ Typen sier at et beslutningsobjekt ALLTID utløser gjennomgang — buildAiInfluenceOutcome
      // lager det bare når det gjør det. Testen holder likevel på at decisionService leser flagget
      // og ikke bare tilstedeværelsen av objektet, så en fremtidig kaller ikke kan rute ved uhell.
      aiInfluence: { ...aiDeclarationDecision(), forcesReview: false } as unknown as AiInfluenceDecision,
    });
    expect(resolved.needsManualReview).toBe(false);
    expect(resolved.passFailTotal).toBe(true);
  });

  it("keeps a red-flag reason as primary when both a red flag and AI-influence fire", () => {
    const resolved = resolveAssessmentDecision({
      ...passingInput,
      llmResult: passingAssessment({
        red_flags: [{ code: "POTENTIAL_SENSITIVE_DATA", severity: "high", description: "x" }],
      }),
      aiInfluence: aiDeclarationDecision(),
    });
    expect(resolved.needsManualReview).toBe(true);
    expect(resolved.decisionReason).toContain("red flag");
  });
});

// ── #475 Phase 2: content-similarity signal ─────────────────────────────────────────────────────

const CONTENT_LIVE: AiInfluenceContentRules = { enabled: true, shadowMode: false, similarityThreshold: 0.8 };
const CONTENT_SHADOW: AiInfluenceContentRules = { enabled: true, shadowMode: true, similarityThreshold: 0.8 };
const CONTENT_OFF: AiInfluenceContentRules = { enabled: false, shadowMode: true, similarityThreshold: 0.8 };

const draftEqualTo = (text: string) => async () => text;
const draftDisjoint = async () => "completely unrelated vocabulary here";

describe("evaluateContentSimilarity", () => {
  const answer = "kvalitetssikring av konsept og styringsunderlag i statens prosjektmodell";

  it("returns null when disabled", async () => {
    const r = await evaluateContentSimilarity({ taskText: "task", studentAnswer: answer, generateDraft: draftEqualTo(answer), rules: CONTENT_OFF });
    expect(r).toBeNull();
  });

  it("returns null when there is no task text or an empty answer", async () => {
    expect(await evaluateContentSimilarity({ taskText: undefined, studentAnswer: answer, generateDraft: draftEqualTo(answer), rules: CONTENT_LIVE })).toBeNull();
    expect(await evaluateContentSimilarity({ taskText: "task", studentAnswer: "   ", generateDraft: draftEqualTo(answer), rules: CONTENT_LIVE })).toBeNull();
  });

  it("skips the signal (null) when draft generation throws — never breaks assessment", async () => {
    const r = await evaluateContentSimilarity({ taskText: "task", studentAnswer: answer, generateDraft: async () => { throw new Error("llm down"); }, rules: CONTENT_LIVE });
    expect(r).toBeNull();
  });

  it("in shadow mode computes similarity but never forces review", async () => {
    const r = await evaluateContentSimilarity({ taskText: "task", studentAnswer: answer, generateDraft: draftEqualTo(answer), rules: CONTENT_SHADOW });
    expect(r).not.toBeNull();
    expect(r!.similarity).toBe(1);
    expect(r!.exceeded).toBe(true);
    expect(r!.forcesReview).toBe(false);
  });

  it("live + high similarity → forcesReview true", async () => {
    const r = await evaluateContentSimilarity({ taskText: "task", studentAnswer: answer, generateDraft: draftEqualTo(answer), rules: CONTENT_LIVE });
    expect(r!.exceeded).toBe(true);
    expect(r!.forcesReview).toBe(true);
  });

  it("live + low similarity → not exceeded, does not force review", async () => {
    const r = await evaluateContentSimilarity({ taskText: "task", studentAnswer: answer, generateDraft: draftDisjoint, rules: CONTENT_LIVE });
    expect(r!.similarity).toBe(0);
    expect(r!.exceeded).toBe(false);
    expect(r!.forcesReview).toBe(false);
  });
});

describe("buildAiInfluenceOutcome", () => {
  const contentForcing = { similarity: 0.95, threshold: 0.8, exceeded: true, forcesReview: true };
  const contentShadow = { similarity: 0.95, threshold: 0.8, exceeded: true, forcesReview: false };

  it("no signals → nothing to persist, no decision", () => {
    expect(buildAiInfluenceOutcome({ declaration: undefined, declarationResult: null, contentSignal: null })).toEqual({
      signalsJson: null,
      decision: undefined,
    });
  });

  it("declaration forces review → decision is the declaration result; persisted forcesReview true", () => {
    const declarationResult = aiDeclarationDecision();
    const out = buildAiInfluenceOutcome({ declaration: "autonomous", declarationResult, contentSignal: contentShadow });
    expect(out.decision).toBe(declarationResult);
    const persisted = JSON.parse(out.signalsJson!);
    expect(persisted.declaration).toBe("autonomous");
    expect(persisted.declarationForcesReview).toBe(true);
    expect(persisted.forcesReview).toBe(true);
    expect(persisted.contentSimilarity.similarity).toBe(0.95);
  });

  it("only content forces review → decision uses the content-similarity reason", () => {
    const out = buildAiInfluenceOutcome({ declaration: undefined, declarationResult: null, contentSignal: contentForcing });
    expect(out.decision?.forcesReview).toBe(true);
    expect(out.decision?.reason).toContain(CONTENT_SIMILARITY_REVIEW_REASON_PREFIX);
    expect(JSON.parse(out.signalsJson!).forcesReview).toBe(true);
  });

  it("shadow content signal alone → persisted but no decision (routes no one)", () => {
    const out = buildAiInfluenceOutcome({ declaration: undefined, declarationResult: null, contentSignal: contentShadow });
    expect(out.decision).toBeUndefined();
    const persisted = JSON.parse(out.signalsJson!);
    expect(persisted.forcesReview).toBe(false);
    expect(persisted.contentSimilarity.exceeded).toBe(true);
  });
});
