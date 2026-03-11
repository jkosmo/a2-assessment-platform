import { describe, expect, it, vi } from "vitest";
import { createAppealRepository } from "../../src/repositories/appealRepository.js";

describe("appeal repository", () => {
  it("queries the submission ownership and latest decision shape for appeal creation", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "submission-1" });
    const repository = createAppealRepository({
      submission: {
        findFirst,
      },
    } as never);

    await repository.findOwnedSubmissionWithLatestDecision("submission-1", "user-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "submission-1",
        userId: "user-1",
      },
      include: {
        decisions: {
          orderBy: { finalisedAt: "desc" },
          take: 1,
        },
      },
    });
  });

  it("updates an appeal to resolved state with the expected payload", async () => {
    const update = vi.fn().mockResolvedValue({ id: "appeal-1" });
    const repository = createAppealRepository({
      appeal: {
        update,
      },
    } as never);
    const resolvedAt = new Date("2026-03-11T07:00:00.000Z");

    await repository.markAppealResolved("appeal-1", "handler-1", resolvedAt, "Resolved after review.");

    expect(update).toHaveBeenCalledWith({
      where: { id: "appeal-1" },
      data: {
        appealStatus: "RESOLVED",
        resolvedAt,
        resolvedById: "handler-1",
        resolutionNote: "Resolved after review.",
      },
    });
  });
});
