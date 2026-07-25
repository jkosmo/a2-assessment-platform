import { describe, expect, it, vi } from "vitest";
import { createAppealRepository } from "../../src/modules/appeal/appealRepository.js";

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
        module: {
          select: { title: true },
        },
        decisions: {
          orderBy: { finalisedAt: "desc" },
          take: 1,
        },
      },
    });
  });

  it("#790: resolves via a guarded updateMany that encodes the preconditions (non-admin)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createAppealRepository({
      appeal: { updateMany },
    } as never);
    const resolvedAt = new Date("2026-03-11T07:00:00.000Z");

    await repository.markAppealResolvedGuarded("appeal-1", "handler-1", resolvedAt, "Resolved after review.", false);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "appeal-1",
        appealStatus: { notIn: ["RESOLVED", "REJECTED", "SUPERSEDED"] },
        OR: [{ resolvedById: null }, { resolvedById: "handler-1" }],
      },
      data: {
        appealStatus: "RESOLVED",
        resolvedAt,
        resolvedById: "handler-1",
        resolutionNote: "Resolved after review.",
      },
    });
  });

  it("#790: admin takeover drops the ownership precondition from the guard", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createAppealRepository({ appeal: { updateMany } } as never);

    await repository.markAppealResolvedGuarded("appeal-1", "admin-1", new Date(), "note", true);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "appeal-1", appealStatus: { notIn: ["RESOLVED", "REJECTED", "SUPERSEDED"] } },
      }),
    );
  });
});
