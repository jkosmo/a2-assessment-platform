import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { assessmentJobRepository } from "../src/modules/assessment/assessmentJobRepository.js";

// #792: a job's terminal writes and lease renewals are fenced on (status RUNNING, lockedBy, lockedAt).
// If a slow worker A's lease expires, gets reset, and worker B re-locks the job, A's late terminal write
// must NO-OP (count 0) instead of overwriting B's result — otherwise both would finalize the same job.
async function seedRunningJob(lockedBy: string, lockedAt: Date) {
  const mv = await prisma.moduleVersion.findFirstOrThrow({ select: { id: true, moduleId: true } });
  const user = await prisma.user.create({
    data: { externalId: `lease-${Date.now()}-${Math.random()}`, name: "S", email: `lease-${Date.now()}-${Math.random()}@x.test` },
    select: { id: true },
  });
  const submission = await prisma.submission.create({
    data: { userId: user.id, moduleId: mv.moduleId, moduleVersionId: mv.id, deliveryType: "text" },
    select: { id: true },
  });
  const job = await prisma.assessmentJob.create({
    data: { submissionId: submission.id, status: "RUNNING", lockedBy, lockedAt, leaseExpiresAt: new Date(Date.now() + 300_000) },
    select: { id: true },
  });
  return job.id;
}

describe("assessment job lease fencing (#792)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a stale-fence terminal write no-ops; only the current lease holder finalizes", async () => {
    const t1 = new Date("2026-01-01T00:00:00.000Z");
    const jobId = await seedRunningJob("worker-A", t1);

    // A's lease expired → the scanner reset it and worker B re-locked it (fresh lockedAt).
    const t2 = new Date("2026-01-01T00:10:00.000Z");
    await prisma.assessmentJob.update({ where: { id: jobId }, data: { lockedBy: "worker-B", lockedAt: t2 } });

    // A finishes late and tries to finalize with its STALE fence → must not touch the row.
    const stale = await assessmentJobRepository.markJobSucceeded(jobId, "worker-A", t1);
    expect(stale.count).toBe(0);
    expect((await prisma.assessmentJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("RUNNING");

    // B (the current holder) finalizes with its fence → wins.
    const current = await assessmentJobRepository.markJobSucceeded(jobId, "worker-B", t2);
    expect(current.count).toBe(1);
    expect((await prisma.assessmentJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("SUCCEEDED");
  });

  it("lease renewal is fenced too — a stale holder cannot extend the lease", async () => {
    const t1 = new Date("2026-02-01T00:00:00.000Z");
    const jobId = await seedRunningJob("worker-A", t1);
    const t2 = new Date("2026-02-01T00:10:00.000Z");
    await prisma.assessmentJob.update({ where: { id: jobId }, data: { lockedBy: "worker-B", lockedAt: t2 } });

    const stale = await assessmentJobRepository.renewLease(jobId, "worker-A", t1, new Date(Date.now() + 300_000));
    expect(stale.count).toBe(0);

    const current = await assessmentJobRepository.renewLease(jobId, "worker-B", t2, new Date(Date.now() + 300_000));
    expect(current.count).toBe(1);
  });
});
