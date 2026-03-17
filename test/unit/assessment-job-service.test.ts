import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findNextRunnableJob = vi.fn();
const tryLockPendingJob = vi.fn();
const findAssessmentJobWithSubmissionOrThrow = vi.fn();
const updateSubmissionStatus = vi.fn();
const createLlmEvaluation = vi.fn();
const markJobSucceeded = vi.fn();
const countJobsByStatus = vi.fn();
const markJobForRetryOrFailure = vi.fn();
const findAssessmentJobOrThrow = vi.fn();
const createAssessmentDecision = vi.fn();
const evaluatePracticalWithLlm = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/repositories/assessmentJobRepository.js", () => ({
  assessmentJobRepository: {
    findNextRunnableJob,
    tryLockPendingJob,
    findAssessmentJobWithSubmissionOrThrow,
    updateSubmissionStatus,
    createLlmEvaluation,
    markJobSucceeded,
    countJobsByStatus,
    markJobForRetryOrFailure,
    findAssessmentJobOrThrow,
  },
}));

vi.mock("../../src/services/decisionService.js", () => ({
  createAssessmentDecision,
}));

vi.mock("../../src/services/llmAssessmentService.js", () => ({
  evaluatePracticalWithLlm,
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

vi.mock("../../src/services/sensitiveDataMaskingService.js", () => ({
  preprocessSensitiveDataForLlm: vi.fn((input) => ({
    payload: {
      responseJson: input.responseJson,
    },
    maskingEnabled: false,
    maskingApplied: false,
    totalMatches: 0,
    ruleHits: [],
    fieldsMasked: [],
  })),
}));

vi.mock("../../src/utils/hash.js", () => ({
  sha256: vi.fn(() => "hash"),
}));

vi.mock("../../src/services/participantNotificationService.js", () => ({
  notifyAssessmentResult: vi.fn().mockResolvedValue(undefined),
}));

function buildSubmissionFixture() {
  return {
    id: "submission-1",
    userId: "user-1",
    moduleId: "module-1",
    moduleVersionId: "module-version-1",
    locale: "nb",
    responseJson: JSON.stringify({ response: "raw text", reflection: "reflection text", promptExcerpt: "prompt excerpt" }),
    user: {
      email: "participant@company.com",
      name: "Test Participant",
    },
    moduleVersion: {
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      taskText: "Task text",
      guidanceText: "Guidance text",
      assessmentPolicyJson: null,
      submissionSchemaJson: null,
      module: {
        title: "Test Module",
      },
      promptTemplateVersion: {
        systemPrompt: "system",
        userPromptTemplate: "template",
        examplesJson: "[]",
      },
      rubricVersion: {
        criteriaJson: JSON.stringify({
          relevance_for_case: "0-4",
          quality_and_utility: "0-4",
          iteration_and_improvement: "0-4",
          human_quality_assurance: "0-4",
          responsible_use: "0-4",
        }),
        scalingRuleJson: JSON.stringify({ practical_weight: 70, max_total: 20 }),
        passRuleJson: JSON.stringify({ total_min: 70 }),
      },
    },
    mcqAttempts: [
      {
        id: "attempt-1",
        scaledScore: 0,
        percentScore: 0,
        completedAt: new Date("2026-03-13T22:42:23.669Z"),
      },
    ],
  };
}

function buildLlmResult(overrides: Record<string, unknown> = {}) {
  return {
    module_id: "module-1",
    rubric_scores: {
      relevance_for_case: 0,
      quality_and_utility: 0,
      iteration_and_improvement: 0,
      human_quality_assurance: 0,
      responsible_use: 0,
    },
    rubric_total: 0,
    practical_score_scaled: 0,
    pass_fail_practical: false,
    criterion_rationales: {
      relevance_for_case: "Submission lacks required practical reflection and MCQ completion; content is largely unrelated.",
      quality_and_utility: "Response is incoherent, not actionable, and provides no evaluative insights.",
      iteration_and_improvement: "No iteration steps, revisions, or QA notes are documented.",
      human_quality_assurance: "No QA process described; cannot verify correctness or reliability.",
      responsible_use: "No discussion of responsible AI use or data handling evident.",
    },
    improvement_advice: [
      "Provide structured reflection addressing the MCQ and explicitly note iteration steps.",
    ],
    red_flags: [],
    manual_review_recommended: true,
    confidence_note:
      "Very low confidence in assessment due to minimal and non-specific submission; requires resubmission.",
    evidence_sufficiency: "insufficient",
    recommended_outcome: "fail",
    manual_review_reason_code: "insufficient_evidence",
    ...overrides,
  };
}

describe("assessment job service traffic-light policy", () => {
  beforeEach(() => {
    vi.resetModules();
    findNextRunnableJob.mockReset();
    tryLockPendingJob.mockReset();
    findAssessmentJobWithSubmissionOrThrow.mockReset();
    updateSubmissionStatus.mockReset();
    createLlmEvaluation.mockReset();
    markJobSucceeded.mockReset();
    countJobsByStatus.mockReset();
    markJobForRetryOrFailure.mockReset();
    findAssessmentJobOrThrow.mockReset();
    createAssessmentDecision.mockReset();
    evaluatePracticalWithLlm.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();

    findNextRunnableJob.mockResolvedValue({
      id: "job-1",
      submissionId: "submission-1",
    });
    tryLockPendingJob.mockResolvedValue({ count: 1 });
    findAssessmentJobWithSubmissionOrThrow.mockResolvedValue({
      id: "job-1",
      submission: buildSubmissionFixture(),
    });
    createLlmEvaluation.mockResolvedValue({ id: "llm-eval-1" });
    markJobSucceeded.mockResolvedValue(undefined);
    countJobsByStatus.mockResolvedValue(0);
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-1" },
      needsManualReview: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps clearly insufficient submissions red even when primary and secondary disagree", async () => {
    evaluatePracticalWithLlm
      .mockResolvedValueOnce(
        buildLlmResult({
          rubric_total: 0,
          practical_score_scaled: 0,
        }),
      )
      .mockResolvedValueOnce(
        buildLlmResult({
          rubric_total: 3,
          practical_score_scaled: 10.5,
          confidence_note:
            "Low confidence due to minimal content and missing assessment artifacts; requires request for expanded submission to reassess.",
        }),
      );

    const { processNextJob } = await import("../../src/services/assessmentJobService.js");

    const processed = await processNextJob();

    expect(processed).toBe(true);
    expect(evaluatePracticalWithLlm).toHaveBeenCalledTimes(1);
    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission-1",
        forceManualReviewReason: undefined,
        llmResult: expect.objectContaining({
          practical_score_scaled: 0,
          pass_fail_practical: false,
        }),
      }),
    );
  });

  it("keeps clearly insufficient submissions red for the exact staging phrase 'additional material required for a reliable assessment'", async () => {
    evaluatePracticalWithLlm
      .mockResolvedValueOnce(
        buildLlmResult({
          confidence_note:
            "Low confidence in scoring due to minimal content; additional material required for a reliable assessment.",
        }),
      )
      .mockResolvedValueOnce(
        buildLlmResult({
          rubric_total: 0,
          practical_score_scaled: 0,
          confidence_note:
            "Low confidence in scoring due to minimal content; additional material required for a reliable assessment.",
        }),
      );

    const { processNextJob } = await import("../../src/services/assessmentJobService.js");

    const processed = await processNextJob();

    expect(processed).toBe(true);
    expect(evaluatePracticalWithLlm).toHaveBeenCalledTimes(1);
    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission-1",
        forceManualReviewReason: undefined,
        llmResult: expect.objectContaining({
          practical_score_scaled: 0,
          pass_fail_practical: false,
        }),
      }),
    );
  });

  it("skips secondary assessment and stays red when Azure returns only insufficiency/completeness red flags", async () => {
    evaluatePracticalWithLlm.mockResolvedValueOnce(
      buildLlmResult({
        red_flags: [
          {
            code: "incomplete_submission",
            severity: "high",
            description: "Submission lacks MCQ answers, reflection depth, and QA notes.",
          },
          {
            code: "extremely_low_content",
            severity: "high",
            description: "Minimal content provided; insufficient basis for evaluation.",
          },
        ],
        recommended_outcome: "manual_review",
        manual_review_reason_code: "insufficient_evidence",
        confidence_note:
          "Very low confidence in automated scoring due to lack of content; human review required.",
      }),
    );

    const { processNextJob } = await import("../../src/services/assessmentJobService.js");

    const processed = await processNextJob();

    expect(processed).toBe(true);
    expect(evaluatePracticalWithLlm).toHaveBeenCalledTimes(1);
    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission-1",
        forceManualReviewReason: undefined,
        llmResult: expect.objectContaining({
          red_flags: expect.arrayContaining([
            expect.objectContaining({
              code: "incomplete_submission",
              severity: "high",
            }),
            expect.objectContaining({
              code: "extremely_low_content",
              severity: "high",
            }),
          ]),
          recommended_outcome: "manual_review",
          manual_review_reason_code: "insufficient_evidence",
        }),
      }),
    );
  });

  it("keeps legitimately ambiguous submissions yellow when primary and secondary disagree materially", async () => {
    evaluatePracticalWithLlm
      .mockResolvedValueOnce(
        buildLlmResult({
          rubric_total: 8,
          practical_score_scaled: 28,
          pass_fail_practical: false,
          evidence_sufficiency: "uncertain",
          recommended_outcome: "manual_review",
          manual_review_reason_code: "low_confidence",
          confidence_note: "Low confidence due to ambiguous evidence and inconsistent quality signals.",
          criterion_rationales: {
            relevance_for_case: "Some relevant evidence exists, but alignment is incomplete.",
            quality_and_utility: "Useful content exists, but practical value is inconsistent.",
            iteration_and_improvement: "Some iteration is visible, but not enough to be reliable.",
            human_quality_assurance: "QA is mentioned but only partially evidenced.",
            responsible_use: "No strong safety concerns evident.",
          },
        }),
      )
      .mockResolvedValueOnce(
        buildLlmResult({
          rubric_total: 13,
          practical_score_scaled: 45.5,
          pass_fail_practical: true,
          evidence_sufficiency: "uncertain",
          recommended_outcome: "manual_review",
          manual_review_reason_code: "low_confidence",
          manual_review_recommended: false,
          confidence_note: "Medium confidence due to mixed but substantive evidence.",
          criterion_rationales: {
            relevance_for_case: "Response is mostly aligned to the task.",
            quality_and_utility: "Submission has practical utility with several omissions.",
            iteration_and_improvement: "Iteration exists but remains incomplete.",
            human_quality_assurance: "QA signals are present but inconsistent.",
            responsible_use: "Responsible-use handling appears acceptable.",
          },
          improvement_advice: ["Clarify evidence gaps and provide stronger QA notes."],
        }),
      );

    const { processNextJob } = await import("../../src/services/assessmentJobService.js");

    const processed = await processNextJob();

    expect(processed).toBe(true);
    expect(evaluatePracticalWithLlm).toHaveBeenCalledTimes(2);
    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission-1",
        forceManualReviewReason:
          "Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.",
        llmResult: expect.objectContaining({
          practical_score_scaled: 45.5,
          pass_fail_practical: true,
        }),
      }),
    );
  });
});
