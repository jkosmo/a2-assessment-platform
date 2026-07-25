import { describe, expect, it, vi } from "vitest";
import { createManualReviewRepository } from "../../src/modules/review/manualReviewRepository.js";

describe("manual review repository", () => {
  it("queries the claim shape for a manual review", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "review-1" });
    const repository = createManualReviewRepository({
      manualReview: {
        findUnique,
      },
    } as never);

    await repository.findManualReviewForClaim("review-1");

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "review-1" },
      select: {
        id: true,
        submissionId: true,
        reviewStatus: true,
        reviewerId: true,
      },
    });
  });

  it("resolves a manual review with reviewer decision metadata", async () => {
    const update = vi.fn().mockResolvedValue({ id: "review-1" });
    const repository = createManualReviewRepository({
      manualReview: {
        updateMany: update,
      },
    } as never);
    const reviewedAt = new Date("2026-03-11T09:00:00.000Z");

    await repository.resolveManualReviewGuarded({
      reviewId: "review-1",
      reviewerId: "reviewer-1",
      reviewStatus: "RESOLVED",
      reviewedAt,
      overrideDecision: "PASS",
      overrideReason: "Validated against rubric.",
      allowTakeover: false,
    });

    // #791: guarded updateMany with the precondition WHERE.
    expect(update).toHaveBeenCalledWith({
      where: {
        id: "review-1",
        reviewStatus: { notIn: ["RESOLVED", "SUPERSEDED"] },
        OR: [{ reviewerId: null }, { reviewerId: "reviewer-1" }],
      },
      data: {
        reviewerId: "reviewer-1",
        reviewStatus: "RESOLVED",
        reviewedAt,
        overrideDecision: "PASS",
        overrideReason: "Validated against rubric.",
      },
    });
  });
});
