import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAssessmentDecision = vi.fn();
const createMcqOnlyDecision = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();
const notifyAssessmentResult = vi.fn();
const localizeContentText = vi.fn((_, text) => text ?? null);
// #795: the decision path now enqueues the post-decision side effects to the durable outbox instead of
// firing them and forgetting.
const enqueueOutboxEvents = vi.fn();

vi.mock("../../src/modules/outbox/outboxService.js", () => ({
  enqueueOutboxEvents,
  OUTBOX_EVENT_TYPES: {
    assessmentNotification: "assessment_notification",
    courseCompletionCheck: "course_completion_check",
  },
}));

vi.mock("../../src/modules/assessment/decisionService.js", () => ({
  createAssessmentDecision,
  createMcqOnlyDecision,
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

vi.mock("../../src/modules/certification/index.js", () => ({
  notifyAssessmentResult,
}));

vi.mock("../../src/i18n/content.js", () => ({
  localizeContentText,
}));

function buildLlmResult(overrides = {}) {
  return {
    module_id: "module-1",
    rubric_scores: { crit_a: 3 },
    rubric_total: 3,
    practical_score_scaled: 52.5,
    pass_fail_practical: true,
    criterion_rationales: { crit_a: "ok" },
    improvement_advice: [],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "High confidence.",
    evidence_sufficiency: "sufficient" as const,
    recommended_outcome: "pass" as const,
    manual_review_reason_code: "none" as const,
    ...overrides,
  };
}

const BASE_INPUT = {
  jobId: "job-1",
  submissionId: "sub-1",
  userId: "user-1",
  moduleId: "module-1",
  moduleVersionId: "mv-1",
  rubricVersionId: "rv-1",
  promptTemplateVersionId: "pt-1",
  mcqScaledScore: 30,
  mcqPercentScore: 100,
  forceManualReviewReason: undefined,
  assessmentPolicy: null,
  rubricMaxTotal: 20,
  rubricCriteriaIds: ["crit_a"],
  moduleTitle: "Test Module",
  submissionLocale: "en-GB" as const,
  submittedAt: new Date("2026-03-20T10:00:00Z"),
  recipientEmail: "participant@example.com",
  recipientName: "Test User",
};

describe("AssessmentDecisionApplicationService — applyAssessmentDecision", () => {
  beforeEach(() => {
    vi.resetModules();
    createAssessmentDecision.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
    notifyAssessmentResult.mockReset();
    localizeContentText.mockReset();
    enqueueOutboxEvents.mockReset().mockResolvedValue({ count: 2 });

    recordAuditEvent.mockResolvedValue(undefined);
    localizeContentText.mockImplementation((_locale, text) => text ?? null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a decision and enqueues the notification + completion outbox events when no manual review", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-1", passFailTotal: true },
      needsManualReview: false,
    });

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    await applyAssessmentDecision({ ...BASE_INPUT, llmResult: buildLlmResult() });

    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "sub-1",
        userId: "user-1",
        mcqScaledScore: 30,
        mcqPercentScore: 100,
      }),
    );
    // #795: side effects go to the durable outbox (awaited), not fire-and-forget notification calls.
    expect(notifyAssessmentResult).not.toHaveBeenCalled();
    expect(enqueueOutboxEvents).toHaveBeenCalledTimes(1);
    const enqueued = enqueueOutboxEvents.mock.calls[0][0] as Array<{ type: string; payload: Record<string, unknown> }>;
    const notification = enqueued.find((e) => e.type === "assessment_notification");
    const completion = enqueued.find((e) => e.type === "course_completion_check");
    expect(notification?.payload).toEqual(
      expect.objectContaining({ submissionId: "sub-1", recipientEmail: "participant@example.com", passFailTotal: true, locale: "en-GB" }),
    );
    expect(completion?.payload).toEqual(expect.objectContaining({ userId: "user-1", moduleId: "module-1" }));
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_job",
        entityId: "job-1",
        action: "assessment_job_completed",
      }),
    );
  });

  it("skips notification when manual review is needed", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-2", passFailTotal: false },
      needsManualReview: true,
    });

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    await applyAssessmentDecision({
      ...BASE_INPUT,
      llmResult: buildLlmResult(),
      forceManualReviewReason: "Escalated for review.",
    });

    expect(enqueueOutboxEvents).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "assessment_job_completed" }),
    );
  });

  it("propagates when the outbox enqueue fails, so the job retries instead of losing the side effects", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-3", passFailTotal: true },
      needsManualReview: false,
    });
    // #795: the enqueue is awaited (not fire-and-forget). A failure must propagate so the runner fails/
    // retries the job — the side effects are then re-enqueued rather than silently lost.
    enqueueOutboxEvents.mockRejectedValue(new Error("DB unavailable"));

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");

    await expect(
      applyAssessmentDecision({ ...BASE_INPUT, llmResult: buildLlmResult() }),
    ).rejects.toThrow("DB unavailable");
    // The job-completed audit must NOT be written when the side effects weren't durably enqueued.
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("passes forceManualReviewReason through to createAssessmentDecision", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-4", passFailTotal: false },
      needsManualReview: true,
    });

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    await applyAssessmentDecision({
      ...BASE_INPUT,
      llmResult: buildLlmResult(),
      forceManualReviewReason: "Disagreement between primary and secondary assessments.",
    });

    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        forceManualReviewReason: "Disagreement between primary and secondary assessments.",
      }),
    );
  });
});

// An MCQ_ONLY module is scored deterministically and — when the participant submits — synchronously
// (#546), so the verdict is already on screen when the request returns. The result e-mail is then
// only noise, so it is suppressed. The async worker path keeps sending it: that participant never
// saw a UI verdict.
describe("AssessmentDecisionApplicationService — applyMcqOnlyDecision", () => {
  const MCQ_INPUT = {
    jobId: "job-mcq-1",
    submissionId: "sub-mcq-1",
    userId: "user-1",
    moduleId: "module-mcq",
    moduleVersionId: "mv-mcq",
    mcqScaledScore: 45,
    mcqPercentScore: 90,
    assessmentPolicy: null,
    moduleTitle: "MCQ Module",
    submissionLocale: "en-GB" as const,
    submittedAt: new Date("2026-08-10T10:00:00Z"),
    recipientEmail: "participant@example.com",
    recipientName: "Test User",
  };

  beforeEach(() => {
    vi.resetModules();
    createMcqOnlyDecision.mockReset();
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReset();
    notifyAssessmentResult.mockReset();
    localizeContentText.mockReset().mockImplementation((_locale, text) => text ?? null);
    enqueueOutboxEvents.mockReset().mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function enqueuedTypes() {
    const enqueued = enqueueOutboxEvents.mock.calls[0][0] as Array<{ type: string }>;
    return enqueued.map((e) => e.type);
  }

  it.each([
    ["passed", true],
    ["failed", false],
  ])("skips the result e-mail for a synchronously graded MCQ_ONLY module that %s", async (_label, passFailTotal) => {
    createMcqOnlyDecision.mockResolvedValue({ decision: { id: "decision-mcq", passFailTotal } });

    const { applyMcqOnlyDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    await applyMcqOnlyDecision({ ...MCQ_INPUT, gradedSynchronously: true });

    expect(enqueueOutboxEvents).toHaveBeenCalledTimes(1);
    expect(enqueuedTypes()).toEqual(["course_completion_check"]);
    // The course-completion check must survive — a completed course still issues its own certificate.
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "job-mcq-1", action: "assessment_job_completed" }),
    );
  });

  it("still sends the result e-mail when the async worker grades the MCQ_ONLY submission", async () => {
    createMcqOnlyDecision.mockResolvedValue({ decision: { id: "decision-mcq", passFailTotal: true } });

    const { applyMcqOnlyDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    // No gradedSynchronously flag — this is the fallback after synchronous grading threw.
    await applyMcqOnlyDecision(MCQ_INPUT);

    expect(enqueuedTypes()).toEqual(["assessment_notification", "course_completion_check"]);
    const enqueued = enqueueOutboxEvents.mock.calls[0][0] as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(enqueued.find((e) => e.type === "assessment_notification")?.payload).toEqual(
      expect.objectContaining({ submissionId: "sub-mcq-1", recipientEmail: "participant@example.com", passFailTotal: true }),
    );
  });
});
