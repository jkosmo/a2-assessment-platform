import { describe, expect, it } from "vitest";
import {
  toSubmissionHistoryResponseView,
  toSubmissionResultView,
} from "../../src/modules/submission/submissionReadModels.js";
import { toManualReviewWorkspaceView } from "../../src/modules/review/manualReviewReadModels.js";
import { toAppealWorkspaceView } from "../../src/modules/appeal/appealReadModels.js";

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
        } as never,
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
            rubric_scores: { evidence: 8 },
            pass_fail_practical: false,
            practical_score_scaled: 40,
            rubric_total: 8,
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
    } as never);

    expect(result.status).toBe("UNDER_REVIEW");
    expect(result.statusExplanation).toContain("manual review");
    expect(result.scoreComponents.totalScore).toBe(65);
    expect(result.participantGuidance.improvementAdvice).toEqual(["Add more evidence"]);
    expect(result.participantGuidance.decisionMetadata).toEqual({
      evidenceSufficiency: "insufficient",
      recommendedOutcome: "manual_review",
      manualReviewReasonCode: "low_confidence",
    });
  });

  it("builds a localized manual review workspace view with parsed response excerpts", () => {
    const review = toManualReviewWorkspaceView({
      id: "review-1",
      reviewStatus: "OPEN",
      triggerReason: "manual_review",
      createdAt: new Date("2026-03-23T10:00:00.000Z"),
      reviewedAt: null,
      reviewer: null,
      submission: {
        id: "submission-1",
        responseJson: JSON.stringify({
          response: "Raw text",
          reflection: "Reflection text",
          promptExcerpt: "Prompt excerpt",
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
    } as never, "nb");

    expect(review.review.submission.module.title).toBe("Norsk tittel");
    expect(review.review.submission.module.description).toBe("Norsk beskrivelse");
    expect(review.review.submission.rawText).toBe("Raw text");
    expect(review.review.submission.reflectionText).toBe("Reflection text");
    expect(review.review.submission.promptExcerpt).toBe("Prompt excerpt");
  });

  it("builds an appeal workspace view with localized module text and SLA", () => {
    const view = toAppealWorkspaceView({
      id: "appeal-1",
      appealStatus: "RESOLVED",
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
    } as never, "nb");

    expect(view.appeal.submission.module.title).toBe("Norsk tittel");
    expect(view.appeal.submission.module.description).toBe("Norsk beskrivelse");
    expect(view.sla.slaState).toBe("RESOLVED");
  });
});
