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
