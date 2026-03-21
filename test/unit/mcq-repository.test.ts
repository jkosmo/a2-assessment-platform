import { describe, expect, it, vi } from "vitest";
import { createMcqRepository } from "../../src/modules/assessment/mcqRepository.js";

describe("mcq repository", () => {
  it("queries an owned submission for MCQ flow", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "submission-1" });
    const repository = createMcqRepository({
      submission: {
        findFirst,
      },
    } as never);

    await repository.findSubmissionForModuleMcq("submission-1", "user-1", "module-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "submission-1", userId: "user-1", moduleId: "module-1" },
      include: { moduleVersion: true },
    });
  });

  it("stores evaluated MCQ responses in bulk", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const repository = createMcqRepository({
      mCQResponse: {
        createMany,
      },
    } as never);

    await repository.createResponses([
      {
        mcqAttemptId: "attempt-1",
        questionId: "question-1",
        selectedAnswer: "A",
        isCorrect: true,
      },
      {
        mcqAttemptId: "attempt-1",
        questionId: "question-2",
        selectedAnswer: "B",
        isCorrect: false,
      },
    ]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          mcqAttemptId: "attempt-1",
          questionId: "question-1",
          selectedAnswer: "A",
          isCorrect: true,
        },
        {
          mcqAttemptId: "attempt-1",
          questionId: "question-2",
          selectedAnswer: "B",
          isCorrect: false,
        },
      ],
    });
  });
});
