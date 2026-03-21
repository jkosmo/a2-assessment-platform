import { describe, expect, it, vi } from "vitest";
import { createAssessmentJobRepository } from "../../src/repositories/assessmentJobRepository.js";

describe("assessment job repository", () => {
  it("queries the next runnable pending job with the expected filter", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "job-1" });
    const repository = createAssessmentJobRepository({
      assessmentJob: {
        findFirst,
      },
    } as never);
    const now = new Date("2026-03-11T08:00:00.000Z");

    await repository.findNextRunnableJob(now, 3);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        status: "PENDING",
        availableAt: { lte: now },
        attempts: { lt: 3 },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("can scope the next runnable job query to a specific submission", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "job-2" });
    const repository = createAssessmentJobRepository({
      assessmentJob: {
        findFirst,
      },
    } as never);
    const now = new Date("2026-03-11T08:10:00.000Z");

    await repository.findNextRunnableJob(now, 3, "submission-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        submissionId: "submission-1",
        status: "PENDING",
        availableAt: { lte: now },
        attempts: { lt: 3 },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("locks a pending job with running metadata", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createAssessmentJobRepository({
      assessmentJob: {
        updateMany,
      },
    } as never);
    const now = new Date("2026-03-11T08:05:00.000Z");
    const leaseExpiresAt = new Date("2026-03-11T08:10:00.000Z");

    await repository.tryLockPendingJob("job-1", now, "default-worker", leaseExpiresAt);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        status: "PENDING",
      },
      data: {
        status: "RUNNING",
        lockedAt: now,
        lockedBy: "default-worker",
        leaseExpiresAt,
        attempts: { increment: 1 },
      },
    });
  });
});
