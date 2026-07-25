import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { appealRepository } from "../src/modules/appeal/appealRepository.js";

// #790: the appeal claim + resolve transitions are guarded updateMany calls whose WHERE encodes the
// preconditions, so under real concurrency exactly ONE of two racing operations affects a row (count 1)
// and the loser gets count 0 → ConflictError. This exercises that against a real Postgres — two claims /
// two resolves fired together must not both "win" (which is what produced duplicate resolution decisions).
async function seedClaimableAppeal(resolvedById: string | null) {
  const mv = await prisma.moduleVersion.findFirstOrThrow({ select: { id: true, moduleId: true } });
  const user = await prisma.user.create({
    data: { externalId: `appeal-conc-${Date.now()}-${Math.random()}`, name: "Appellant", email: `ac-${Date.now()}-${Math.random()}@x.test` },
    select: { id: true },
  });
  const submission = await prisma.submission.create({
    data: { userId: user.id, moduleId: mv.moduleId, moduleVersionId: mv.id, deliveryType: "text" },
    select: { id: true },
  });
  const appeal = await prisma.appeal.create({
    data: {
      submissionId: submission.id,
      appealedById: user.id,
      appealReason: "concurrency test",
      appealStatus: "IN_REVIEW",
      resolvedById,
    },
    select: { id: true },
  });
  return appeal.id;
}

async function makeHandler(tag: string) {
  const u = await prisma.user.create({
    data: { externalId: `appeal-h-${tag}-${Date.now()}-${Math.random()}`, name: tag, email: `h-${tag}-${Date.now()}-${Math.random()}@x.test` },
    select: { id: true },
  });
  return u.id;
}

describe("appeal transition concurrency (#790)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("two concurrent claims: exactly one wins (count 1), the other loses (count 0)", async () => {
    const appealId = await seedClaimableAppeal(null);
    const handlerA = await makeHandler("A");
    const handlerB = await makeHandler("B");

    const results = await Promise.all([
      appealRepository.markAppealInReviewGuarded(appealId, handlerA, false, false),
      appealRepository.markAppealInReviewGuarded(appealId, handlerB, false, false),
    ]);

    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
    expect(results.filter((r) => r.count === 0)).toHaveLength(1);

    const appeal = await prisma.appeal.findUniqueOrThrow({ where: { id: appealId }, select: { appealStatus: true, resolvedById: true } });
    expect(appeal.appealStatus).toBe("IN_REVIEW");
    expect([handlerA, handlerB]).toContain(appeal.resolvedById);
  });

  it("two concurrent resolves: exactly one wins, the appeal ends terminal once", async () => {
    const handlerA = await makeHandler("R");
    // Claimed by handlerA; two resolves race (e.g. a double-submit).
    const appealId = await seedClaimableAppeal(handlerA);
    const finalisedAt = new Date();

    const results = await Promise.all([
      appealRepository.markAppealResolvedGuarded(appealId, handlerA, finalisedAt, "note-1", false),
      appealRepository.markAppealResolvedGuarded(appealId, handlerA, finalisedAt, "note-2", false),
    ]);

    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
    expect(results.filter((r) => r.count === 0)).toHaveLength(1);

    const appeal = await prisma.appeal.findUniqueOrThrow({ where: { id: appealId }, select: { appealStatus: true } });
    expect(appeal.appealStatus).toBe("RESOLVED");
  });
});
