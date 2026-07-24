import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { enqueueAssessmentJob } from "../src/modules/assessment/AssessmentJobRunner.js";

// #793: at most one ACTIVE (PENDING/RUNNING) assessment job per submission is a DB invariant (partial
// unique index). Two concurrent enqueues must not both create a job — the loser returns the winner's
// job, so there is never duplicate LLM spend / decisions / emails for one submission.
async function seedSubmission() {
  const mv = await prisma.moduleVersion.findFirstOrThrow({ select: { id: true, moduleId: true } });
  const user = await prisma.user.create({
    data: { externalId: `enq-${Date.now()}-${Math.random()}`, name: "S", email: `enq-${Date.now()}-${Math.random()}@x.test` },
    select: { id: true },
  });
  const submission = await prisma.submission.create({
    data: { userId: user.id, moduleId: mv.moduleId, moduleVersionId: mv.id, deliveryType: "text" },
    select: { id: true },
  });
  return submission.id;
}

describe("assessment enqueue concurrency (#793)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("two concurrent enqueues yield one active job; both callers get the same job", async () => {
    const submissionId = await seedSubmission();

    const [a, b] = await Promise.all([enqueueAssessmentJob(submissionId), enqueueAssessmentJob(submissionId)]);

    // Both resolve to a job, and to the SAME job (one created it, the other returned it).
    expect(a.id).toBe(b.id);

    const activeCount = await prisma.assessmentJob.count({
      where: { submissionId, status: { in: ["PENDING", "RUNNING"] } },
    });
    expect(activeCount).toBe(1);
  });

  it("the DB rejects a second active job for the same submission (invariant, not just app logic)", async () => {
    const submissionId = await seedSubmission();
    await prisma.assessmentJob.create({ data: { submissionId, status: "PENDING" } });

    await expect(
      prisma.assessmentJob.create({ data: { submissionId, status: "RUNNING" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
