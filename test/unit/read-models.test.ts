import { describe, expect, it } from "vitest";
import {
  toSubmissionHistoryResponseView,
  toSubmissionResultView,
} from "../../src/modules/submission/submissionReadModels.js";
import { toManualReviewWorkspaceView } from "../../src/modules/review/manualReviewReadModels.js";
import { toAppealWorkspaceView } from "../../src/modules/appeal/appealReadModels.js";
import { getAssessmentRules } from "../../src/config/assessmentRules.js";
import { resolveMcqMinPercent } from "../../src/modules/assessment/mcqPassRule.js";

describe("module-owned read models", () => {
  it("builds a localized submission history response", () => {
    const history = toSubmissionHistoryResponseView(
      [
        {
          id: "submission-1",
          submittedAt: new Date("2026-03-23T10:00:00.000Z"),
          submissionStatus: "COMPLETED",
          module: {
            id: "module-1",
            title: JSON.stringify({ "en-GB": "English title", nb: "Norsk tittel" }),
          },
          decisions: [
            {
              id: "decision-1",
              decisionType: "ASSESSMENT",
              passFailTotal: true,
              totalScore: 88,
              decisionReason: "Pass",
              finalisedAt: new Date("2026-03-23T10:05:00.000Z"),
            },
          ],
          mcqAttempts: [
            {
              id: "mcq-1",
              scaledScore: 30,
              percentScore: 100,
              passFailMcq: true,
              completedAt: new Date("2026-03-23T10:02:00.000Z"),
            },
          ],
          llmEvaluations: [
            {
              id: "llm-1",
              practicalScoreScaled: 58,
              passFailPractical: true,
              manualReviewRecommended: false,
              createdAt: new Date("2026-03-23T10:03:00.000Z"),
            },
          ],
        },
      ],
      "nb",
    );

    expect(history.history).toHaveLength(1);
    expect(history.history[0].module.title).toBe("Norsk tittel");
    expect(history.history[0].latestDecision?.totalScore).toBe(88);
  });

  it("builds submission result guidance from structured LLM output", () => {
    const result = toSubmissionResultView({
      id: "submission-1",
      submissionStatus: "UNDER_REVIEW",
      decisions: [
        {
          id: "decision-1",
          decisionReason: "Manual review required.",
          mcqScaledScore: 25,
          practicalScaledScore: 40,
          totalScore: 65,
        },
      ],
      appeals: [
        {
          id: "appeal-1",
          appealStatus: "OPEN",
          createdAt: new Date("2026-03-23T10:06:00.000Z"),
          resolvedAt: null,
        },
      ],
      mcqAttempts: [
        {
          id: "mcq-1",
          scaledScore: 25,
          percentScore: 83.33,
          completedAt: new Date("2026-03-23T10:01:00.000Z"),
        },
      ],
      llmEvaluations: [
        {
          id: "llm-1",
          practicalScoreScaled: 40,
          confidenceNote: "Low confidence",
          responseJson: JSON.stringify({
            module_id: "module-1",
            rubric_scores: { evidence: 2 },
            pass_fail_practical: false,
            practical_score_scaled: 40,
            rubric_total: 2,
            red_flags: [],
            manual_review_recommended: true,
            confidence_note: "Low confidence",
            criterion_rationales: { evidence: "Too thin" },
            improvement_advice: ["Add more evidence"],
            evidence_sufficiency: "insufficient",
            recommended_outcome: "manual_review",
            manual_review_reason_code: "low_confidence",
          }),
        },
      ],
    });

    expect(result.status).toBe("UNDER_REVIEW");
    expect(result.statusExplanation).toContain("manual review");
    expect(result.scoreComponents.totalScore).toBe(65);
    expect(result.participantGuidance.improvementAdvice).toEqual(["Add more evidence"]);
    expect(result.participantGuidance.decisionMetadata).toEqual({
      evidenceSufficiency: "insufficient",
      recommendedOutcome: "manual_review",
      manualReviewReasonCode: "low_confidence",
    });
    // Raw evaluation signals must not appear in participant-facing payload
    expect("llmEvaluation" in result).toBe(false);
    expect("mcqAttempt" in result).toBe(false);
  });

  it("builds a localized manual review workspace view with parsed response excerpts", () => {
    const review = toManualReviewWorkspaceView({
      id: "review-1",
      submissionId: "submission-1",
      reviewStatus: "OPEN",
      triggerReason: "manual_review",
      reviewerId: null,
      reviewedAt: null,
      overrideDecision: null,
      overrideReason: null,
      createdAt: new Date("2026-03-23T10:00:00.000Z"),
      reviewer: null,
      submission: {
        id: "submission-1",
        submittedAt: new Date("2026-03-23T10:00:00.000Z"),
        deliveryType: "text",
        responseJson: JSON.stringify({
          response: "Raw text",
          reflection: "Reflection text",
          promptExcerpt: "Prompt excerpt",
        }),
        processSignalsJson: JSON.stringify({
          declaration: "autonomous",
          declarationText: "I asked the AI to write the whole answer.",
          insistedAfterPrompt: true,
        }),
        user: {
          id: "user-1",
          name: "User",
          email: "user@example.com",
          department: "Ops",
        },
        module: {
          id: "module-1",
          title: JSON.stringify({ "en-GB": "English title", nb: "Norsk tittel" }),
          description: JSON.stringify({ "en-GB": "English description", nb: "Norsk beskrivelse" }),
        },
        moduleVersion: { id: "version-1" },
        mcqAttempts: [],
        llmEvaluations: [],
        decisions: [],
        appeals: [],
      },
    }, "nb");

    expect(review.review.submission.module.title).toBe("Norsk tittel");
    expect(review.review.submission.module.description).toBe("Norsk beskrivelse");
    expect(review.review.submission.rawText).toBe("Raw text");
    expect(review.review.submission.reflectionText).toBe("Reflection text");
    expect(review.review.submission.promptExcerpt).toBe("Prompt excerpt");
    // #475: the AI-use declaration + the participant's free-text description are exposed to the reviewer.
    expect(review.review.submission.aiDeclaration).toBe("autonomous");
    expect(review.review.submission.aiDeclarationText).toBe("I asked the AI to write the whole answer.");
  });

  it("builds an appeal workspace view with localized module text and SLA", () => {
    const view = toAppealWorkspaceView({
      id: "appeal-1",
      submissionId: "submission-1",
      appealStatus: "RESOLVED" as const,
      appealReason: "I disagree with the assessment.",
      resolutionNote: "Reviewed and upheld.",
      resolvedById: "handler-1",
      createdAt: new Date("2026-03-23T10:00:00.000Z"),
      claimedAt: new Date("2026-03-23T10:15:00.000Z"),
      resolvedAt: new Date("2026-03-23T11:00:00.000Z"),
      appealedBy: {
        id: "user-1",
        name: "User",
        email: "user@example.com",
        department: "Ops",
      },
      resolvedBy: {
        id: "handler-1",
        name: "Handler",
        email: "handler@example.com",
      },
      submission: {
        id: "submission-1",
        submittedAt: new Date("2026-03-23T10:00:00.000Z"),
        user: {
          id: "user-1",
          name: "User",
          email: "user@example.com",
          department: "Ops",
        },
        module: {
          id: "module-1",
          title: JSON.stringify({ "en-GB": "English title", nb: "Norsk tittel" }),
          description: JSON.stringify({ "en-GB": "English description", nb: "Norsk beskrivelse" }),
        },
        moduleVersion: { id: "version-1" },
        mcqAttempts: [],
        llmEvaluations: [],
        decisions: [],
        manualReviews: [],
      },
    }, "nb");

    expect(view.appeal.submission.module.title).toBe("Norsk tittel");
    expect(view.appeal.submission.module.description).toBe("Norsk beskrivelse");
    expect(view.sla.slaState).toBe("RESOLVED");
  });
});

// ── #940: kravene resultatskjermen viser ────────────────────────────────────────────────────────
//
// ⚠️ QA-porten 2026-08-27: hele servertillegget sto UTEN påstander. Alle e2e-ene mocker
// `/result`, så de ville vært grønne uansett hva serveren sendte — og skjermen sier «Kravet var
// 80 %» på grunnlag av nettopp disse feltene.
describe("#940 — resultatsvaret bærer kravene, ikke bare poengsummene", () => {
  const base = {
    id: "submission-1",
    submissionStatus: "COMPLETED",
    decisions: [{ id: "d1", decisionReason: "x", decisionReasonCode: null, decisionReasonParams: null,
      mcqScaledScore: 30, practicalScaledScore: 0, totalScore: 30 }],
    appeals: [],
    mcqAttempts: [{ id: "a1", scaledScore: 30, percentScore: 100, completedAt: new Date("2026-08-27T10:00:00.000Z") }],
    llmEvaluations: [],
  };

  it("en ren flervalgsmodul får sin egen terskel, ikke plattformens standard", () => {
    const view = toSubmissionResultView({
      ...base,
      moduleVersion: { assessmentMode: "MCQ_ONLY", assessmentPolicyJson: JSON.stringify({ passRules: { mcqMinPercent: 80 } }) },
    });

    expect(view.assessmentMode).toBe("MCQ_ONLY");
    expect(view.requirement.mcqMinPercent).toBe(80);
    // Prosenten er det skjermen viser; poengsummen alene sier ingenting uten en nevner.
    expect(view.scoreComponents.mcqPercentScore).toBe(100);
  });

  // ⚠️ DEN VIKTIGSTE. En modul UTEN eksplisitt grense avgjøres mot standarden. Sendte visningen
  // `null` her, ville vedtaket vært fattet mot 70 mens skjermen ikke viste noe krav i det hele
  // tatt — #949-feilen i utelatelsesform.
  it("uten eksplisitt grense sendes SAMME standard som vedtaket bruker", () => {
    const view = toSubmissionResultView({
      ...base,
      moduleVersion: { assessmentMode: "FREETEXT_PLUS_MCQ", assessmentPolicyJson: null },
    });

    expect(view.requirement.totalMin).toBe(getAssessmentRules().thresholds.totalMin);
    // En ren flervalgsterskel er derimot IKKE aktuell for en blandet modul uten eksplisitt grense.
    expect(view.requirement.mcqMinPercent).toBeNull();
  });

  it("en ren flervalgsmodul uten policy får standarden for modultypen", () => {
    const view = toSubmissionResultView({
      ...base,
      moduleVersion: { assessmentMode: "MCQ_ONLY", assessmentPolicyJson: null },
    });

    // ⚠️ `toBeGreaterThan(0)` pinner ingenting — enhver terskel ville bestått. Påstanden må være
    // på DEN VERDIEN vedtaket faktisk bruker, ellers kan de to skli fra hverandre uten at noe sier
    // fra. Det er hele poenget med å dele oppslaget.
    expect(view.requirement.mcqMinPercent).toBe(
      resolveMcqMinPercent("MCQ_ONLY", null),
    );
  });

  // ⚠️ En ødelagt policy-JSON skal gi en resultatside uten krav-tall, ikke en 500. Deltakeren har
  // bestått eller ikke uansett hva som står i det feltet.
  it("en ødelagt policy velter ikke resultatsiden, og gir standardene", () => {
    const view = toSubmissionResultView({
      ...base,
      moduleVersion: { assessmentMode: "MCQ_ONLY", assessmentPolicyJson: "{ikke json" },
    });

    // ⚠️ `not.toThrow()` alene sier bare at det ikke smalt. Det som betyr noe er at svaret er
    // BRUKBART: en ødelagt policy skal lese som «ingen egen grense», altså standardene — ikke som
    // manglende tall, og ikke som en halv side.
    expect(view.requirement.mcqMinPercent).toBe(resolveMcqMinPercent("MCQ_ONLY", null));
    expect(view.requirement.totalMin).toBe(getAssessmentRules().thresholds.totalMin);
    expect(view.scoreComponents.mcqPercentScore).toBe(100);
  });

  it("uten modulversjon i det hele tatt svarer den fortsatt", () => {
    const view = toSubmissionResultView({ ...base, moduleVersion: null });
    expect(view.assessmentMode).toBeNull();
    expect(view.requirement.mcqMinPercent).toBeNull();
  });
});
