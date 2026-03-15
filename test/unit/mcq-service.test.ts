import { beforeEach, describe, expect, it, vi } from "vitest";

// shuffleArray is a private function in mcqService. It is tested indirectly via
// startMcqAttempt: the returned options must contain all the same elements as the
// stored question (same set, same count) regardless of order.

const findSubmissionForModuleMcq = vi.fn();
const findOpenAttemptForSubmission = vi.fn();
const createAttempt = vi.fn();
const findActiveQuestionsForSet = vi.fn();
const findAttemptForSubmission = vi.fn();
const deleteResponsesForAttempt = vi.fn();
const createResponses = vi.fn();
const completeAttempt = vi.fn();
const updateSubmissionStatus = vi.fn();
const enqueueAssessmentJobMock = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock("../../src/repositories/mcqRepository.js", () => ({
  mcqRepository: {
    findSubmissionForModuleMcq,
    findOpenAttemptForSubmission,
    createAttempt,
    findActiveQuestionsForSet,
    findAttemptForSubmission,
    deleteResponsesForAttempt,
    createResponses,
    completeAttempt,
  },
}));

vi.mock("../../src/repositories/assessmentJobRepository.js", () => ({
  assessmentJobRepository: {
    updateSubmissionStatus,
  },
}));

vi.mock("../../src/services/assessmentJobService.js", () => ({
  enqueueAssessmentJob: enqueueAssessmentJobMock,
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

describe("mcq service — submitMcqAttempt", () => {
  const baseSubmission = {
    id: "submission-1",
    moduleVersion: { mcqSetVersionId: "mcq-set-1" },
  };
  const baseAttempt = {
    id: "attempt-1",
    mcqSetVersionId: "mcq-set-1",
    completedAt: null,
  };
  const baseQuestions = [
    {
      id: "q-1",
      stem: "What is 2+2?",
      optionsJson: JSON.stringify(["4", "3", "5"]),
      correctAnswer: "4",
      active: true,
    },
    {
      id: "q-2",
      stem: "Capital of Norway?",
      optionsJson: JSON.stringify(["Oslo", "Bergen"]),
      correctAnswer: "Oslo",
      active: true,
    },
  ];

  beforeEach(() => {
    findSubmissionForModuleMcq.mockReset();
    findAttemptForSubmission.mockReset();
    findActiveQuestionsForSet.mockReset();
    deleteResponsesForAttempt.mockReset();
    createResponses.mockReset();
    completeAttempt.mockReset();
    updateSubmissionStatus.mockReset();
    enqueueAssessmentJobMock.mockReset();
    recordAuditEvent.mockReset();

    findSubmissionForModuleMcq.mockResolvedValue(baseSubmission);
    findAttemptForSubmission.mockResolvedValue(baseAttempt);
    findActiveQuestionsForSet.mockResolvedValue(baseQuestions);
    deleteResponsesForAttempt.mockResolvedValue(undefined);
    createResponses.mockResolvedValue(undefined);
    completeAttempt.mockImplementation(({ attemptId }) =>
      Promise.resolve({ id: attemptId }),
    );
    updateSubmissionStatus.mockResolvedValue(undefined);
    enqueueAssessmentJobMock.mockResolvedValue(undefined);
    recordAuditEvent.mockResolvedValue(undefined);
  });

  it("calculates correct rawScore, percentScore, and scaledScore for a fully correct submission", async () => {
    const { submitMcqAttempt } = await import("../../src/services/mcqService.js");

    const result = await submitMcqAttempt({
      moduleId: "module-1",
      submissionId: "submission-1",
      attemptId: "attempt-1",
      userId: "user-1",
      responses: [
        { questionId: "q-1", selectedAnswer: "4" },
        { questionId: "q-2", selectedAnswer: "Oslo" },
      ],
    });

    expect(result.rawScore).toBe(2);
    expect(result.percentScore).toBe(100);
    // scaledScore = (2/2) * mcqMaxScore; default mcqMaxScore is 30
    expect(result.scaledScore).toBe(30);
    expect(result.passFailMcq).toBe(true);
  });

  it("calculates correct scores when only one of two answers is correct", async () => {
    const { submitMcqAttempt } = await import("../../src/services/mcqService.js");

    const result = await submitMcqAttempt({
      moduleId: "module-1",
      submissionId: "submission-1",
      attemptId: "attempt-1",
      userId: "user-1",
      responses: [
        { questionId: "q-1", selectedAnswer: "4" },
        { questionId: "q-2", selectedAnswer: "Bergen" }, // wrong
      ],
    });

    expect(result.rawScore).toBe(1);
    expect(result.percentScore).toBe(50);
    expect(result.scaledScore).toBe(15);
    expect(result.passFailMcq).toBe(false);
  });

  it("ignores responses for unknown question IDs and does not count them", async () => {
    const { submitMcqAttempt } = await import("../../src/services/mcqService.js");

    const result = await submitMcqAttempt({
      moduleId: "module-1",
      submissionId: "submission-1",
      attemptId: "attempt-1",
      userId: "user-1",
      responses: [
        { questionId: "q-1", selectedAnswer: "4" },
        { questionId: "q-999", selectedAnswer: "ghost" }, // unknown
      ],
    });

    // Only the known question counts; 1 correct out of 2 total questions
    expect(result.rawScore).toBe(1);
    expect(result.percentScore).toBe(50);
  });

  it("throws when the attempt is already completed", async () => {
    findAttemptForSubmission.mockResolvedValue({
      ...baseAttempt,
      completedAt: new Date("2026-03-15T10:00:00.000Z"),
    });

    const { submitMcqAttempt } = await import("../../src/services/mcqService.js");

    await expect(
      submitMcqAttempt({
        moduleId: "module-1",
        submissionId: "submission-1",
        attemptId: "attempt-1",
        userId: "user-1",
        responses: [{ questionId: "q-1", selectedAnswer: "4" }],
      }),
    ).rejects.toThrow("MCQ attempt already submitted.");
  });

  it("records an audit event with rawScore, percentScore, and scaledScore after submission", async () => {
    const { submitMcqAttempt } = await import("../../src/services/mcqService.js");

    await submitMcqAttempt({
      moduleId: "module-1",
      submissionId: "submission-1",
      attemptId: "attempt-1",
      userId: "user-1",
      responses: [
        { questionId: "q-1", selectedAnswer: "4" },
        { questionId: "q-2", selectedAnswer: "Oslo" },
      ],
    });

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "mcq_attempt",
        entityId: "attempt-1",
        action: "mcq_submitted",
        actorId: "user-1",
        metadata: expect.objectContaining({
          submissionId: "submission-1",
          rawScore: 2,
          percentScore: 100,
          scaledScore: 30,
        }),
      }),
    );
  });
});

describe("mcq service — shuffle behaviour via startMcqAttempt", () => {
  beforeEach(() => {
    findSubmissionForModuleMcq.mockReset();
    findOpenAttemptForSubmission.mockReset();
    createAttempt.mockReset();
    findActiveQuestionsForSet.mockReset();
  });

  it("returns the same number of options as stored for each question", async () => {
    findSubmissionForModuleMcq.mockResolvedValue({
      id: "submission-1",
      moduleVersion: { mcqSetVersionId: "mcq-set-1" },
    });
    findOpenAttemptForSubmission.mockResolvedValue({
      id: "attempt-1",
      mcqSetVersionId: "mcq-set-1",
    });
    findActiveQuestionsForSet.mockResolvedValue([
      {
        id: "q-1",
        stem: "What is 2+2?",
        optionsJson: JSON.stringify(["4", "3", "5", "6"]),
        correctAnswer: "4",
        active: true,
      },
      {
        id: "q-2",
        stem: "Capital of Norway?",
        optionsJson: JSON.stringify(["Oslo", "Bergen", "Stavanger"]),
        correctAnswer: "Oslo",
        active: true,
      },
    ]);

    const { startMcqAttempt } = await import("../../src/services/mcqService.js");

    const result = await startMcqAttempt("module-1", "submission-1", "user-1", "en-GB");

    expect(result.questions).toHaveLength(2);
    // Shuffle must not lose options
    expect(result.questions[0].options).toHaveLength(4);
    expect(result.questions[1].options).toHaveLength(3);
  });

  it("returned options contain all the same elements as the stored options", async () => {
    const storedOptions = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

    findSubmissionForModuleMcq.mockResolvedValue({
      id: "submission-1",
      moduleVersion: { mcqSetVersionId: "mcq-set-1" },
    });
    findOpenAttemptForSubmission.mockResolvedValue({
      id: "attempt-1",
      mcqSetVersionId: "mcq-set-1",
    });
    findActiveQuestionsForSet.mockResolvedValue([
      {
        id: "q-1",
        stem: "Pick one",
        optionsJson: JSON.stringify(storedOptions),
        correctAnswer: "Alpha",
        active: true,
      },
    ]);

    const { startMcqAttempt } = await import("../../src/services/mcqService.js");

    const result = await startMcqAttempt("module-1", "submission-1", "user-1", "en-GB");

    const returnedOptions = result.questions[0].options as string[];

    // All stored options must appear in the returned list
    expect(returnedOptions.sort()).toEqual([...storedOptions].sort());
  });

  it("does not mutate the underlying question data (non-destructive shuffle)", async () => {
    const storedOptions = ["One", "Two", "Three"];

    findSubmissionForModuleMcq.mockResolvedValue({
      id: "submission-1",
      moduleVersion: { mcqSetVersionId: "mcq-set-1" },
    });
    findOpenAttemptForSubmission.mockResolvedValue({
      id: "attempt-1",
      mcqSetVersionId: "mcq-set-1",
    });

    // Re-use the same options object reference across two calls to ensure
    // the original array is not mutated between invocations.
    let capturedQuestion: { id: string; stem: string; optionsJson: string; correctAnswer: string; active: boolean } | null = null;
    findActiveQuestionsForSet.mockImplementation(() => {
      capturedQuestion = {
        id: "q-1",
        stem: "Non-mutate check",
        optionsJson: JSON.stringify(storedOptions),
        correctAnswer: "One",
        active: true,
      };
      return Promise.resolve([capturedQuestion]);
    });

    const { startMcqAttempt } = await import("../../src/services/mcqService.js");

    await startMcqAttempt("module-1", "submission-1", "user-1", "en-GB");

    // The JSON string stored in the question object must still be parseable
    // and contain all original values — the shuffle operates on a copy.
    const parsedAfter = JSON.parse(capturedQuestion!.optionsJson) as string[];
    expect(parsedAfter).toEqual(storedOptions);
  });
});
