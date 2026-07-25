import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { mcqRepository } from "../src/modules/assessment/mcqRepository.js";

// #794: MCQ finalization is guarded (completeAttemptGuarded only completes an OPEN attempt) and responses
// are unique per (attempt, question). This proves the DB invariants under real concurrency.
async function seedOpenAttempt() {
  const mv = await prisma.moduleVersion.findFirstOrThrow({ select: { id: true, moduleId: true } });
  const setVersion = await prisma.mCQSetVersion.findFirstOrThrow({ select: { id: true } });
  const user = await prisma.user.create({
    data: { externalId: `mcq-${Date.now()}-${Math.random()}`, name: "S", email: `mcq-${Date.now()}-${Math.random()}@x.test` },
    select: { id: true },
  });
  const submission = await prisma.submission.create({
    data: { userId: user.id, moduleId: mv.moduleId, moduleVersionId: mv.id, deliveryType: "text" },
    select: { id: true },
  });
  const attempt = await prisma.mCQAttempt.create({
    data: { submissionId: submission.id, mcqSetVersionId: setVersion.id, startedAt: new Date() },
    select: { id: true },
  });
  return attempt.id;
}

const scores = { completedAt: new Date(), rawScore: 1, percentScore: 50, scaledScore: 5, passFailMcq: true };

describe("MCQ finalization concurrency (#794)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("two concurrent finalizations: exactly one completes the attempt", async () => {
    const attemptId = await seedOpenAttempt();

    const results = await Promise.all([
      mcqRepository.completeAttemptGuarded({ attemptId, ...scores }),
      mcqRepository.completeAttemptGuarded({ attemptId, ...scores }),
    ]);

    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
    expect(results.filter((r) => r.count === 0)).toHaveLength(1);
    expect((await prisma.mCQAttempt.findUniqueOrThrow({ where: { id: attemptId } })).completedAt).not.toBeNull();
  });

  it("the DB rejects a duplicate response for the same (attempt, question)", async () => {
    const attemptId = await seedOpenAttempt();
    const question = await prisma.mCQQuestion.findFirstOrThrow({ select: { id: true } });
    await prisma.mCQResponse.create({ data: { mcqAttemptId: attemptId, questionId: question.id, selectedAnswer: "a", isCorrect: true } });

    await expect(
      prisma.mCQResponse.create({ data: { mcqAttemptId: attemptId, questionId: question.id, selectedAnswer: "b", isCorrect: false } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
