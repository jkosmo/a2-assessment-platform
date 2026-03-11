import { describe, expect, it, vi } from "vitest";
import { createDecisionRepository } from "../../src/repositories/decisionRepository.js";

describe("decision repository", () => {
  it("creates an assessment decision with the provided payload", async () => {
    const create = vi.fn().mockResolvedValue({ id: "decision-1" });
    const repository = createDecisionRepository({
      assessmentDecision: {
        create,
      },
    } as never);

    await repository.createAssessmentDecision({
      submissionId: "submission-1",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      mcqScaledScore: 30,
      practicalScaledScore: 45,
      totalScore: 75,
      redFlagsJson: "[]",
      passFailTotal: true,
      decisionType: "AUTOMATIC",
      decisionReason: "Automatic pass by threshold rules.",
      finalisedById: "user-1",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: "submission-1",
        totalScore: 75,
        decisionReason: "Automatic pass by threshold rules.",
      }),
    });
  });
});
