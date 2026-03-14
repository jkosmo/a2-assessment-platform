import { describe, expect, it, vi } from "vitest";
import { createSubmissionRepository } from "../../src/repositories/submissionRepository.js";

describe("submission repository", () => {
  it("creates a submission through the Prisma client", async () => {
    const create = vi.fn().mockResolvedValue({ id: "submission-1" });
    const repository = createSubmissionRepository({
      submission: {
        create,
      },
    } as never);

    const result = await repository.create({
      userId: "user-1",
      moduleId: "module-1",
      moduleVersionId: "module-version-1",
      locale: "en-GB",
      deliveryType: "text",
      responseJson: JSON.stringify({ response: "content", reflection: "reflection", promptExcerpt: "prompt" }),
      attachmentUri: "file://submission.txt",
      submissionStatus: "SUBMITTED",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        moduleId: "module-1",
        moduleVersionId: "module-version-1",
      }),
    });
    expect(result).toEqual({ id: "submission-1" });
  });

  it("queries an owned submission with the service include shape", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "submission-2" });
    const repository = createSubmissionRepository({
      submission: {
        findFirst,
      },
    } as never);

    await repository.findOwnedSubmission("submission-2", "user-2");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "submission-2", userId: "user-2" },
        include: expect.objectContaining({
          moduleVersion: true,
          appeals: expect.any(Object),
          mcqAttempts: expect.any(Object),
          llmEvaluations: expect.any(Object),
          decisions: expect.any(Object),
        }),
      }),
    );
  });
});
