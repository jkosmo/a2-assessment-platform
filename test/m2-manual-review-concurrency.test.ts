import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { manualReviewRepository } from "../src/modules/review/manualReviewRepository.js";

// #791: manual-review claim + override transitions are guarded updateMany calls, so under real concurrency
// exactly one of two racing operations affects a row (the loser gets count 0 → ConflictError). This
// prevents the duplicate owner / duplicate MANUAL_OVERRIDE decisions the check-then-act version allowed.
async function seedReview(reviewerId: string | null) {
  const mv = await prisma.moduleVersion.findFirstOrThrow({ select: { id: true, moduleId: true } });
  const user = await prisma.user.create({
    data: { externalId: `mr-conc-${Date.now()}-${Math.random()}`, name: "S", email: `mr-${Date.now()}-${Math.random()}@x.test` },
    select: { id: true },
  });
  const submission = await prisma.submission.create({
    data: { userId: user.id, moduleId: mv.moduleId, moduleVersionId: mv.id, deliveryType: "text" },
    select: { id: true },
  });
  const review = await prisma.manualReview.create({
    data: { submissionId: submission.id, triggerReason: "concurrency test", reviewStatus: "IN_REVIEW", reviewerId },
    select: { id: true },
  });
  return review.id;
}

async function makeReviewer(tag: string) {
  const u = await prisma.user.create({
    data: { externalId: `mr-r-${tag}-${Date.now()}-${Math.random()}`, name: tag, email: `r-${tag}-${Date.now()}-${Math.random()}@x.test` },
    select: { id: true },
  });
  return u.id;
}

describe("manual review transition concurrency (#791)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("two concurrent claims: exactly one wins", async () => {
    const reviewId = await seedReview(null);
    const a = await makeReviewer("A");
    const b = await makeReviewer("B");

    const results = await Promise.all([
      manualReviewRepository.markManualReviewClaimedGuarded(reviewId, a, "IN_REVIEW", false),
      manualReviewRepository.markManualReviewClaimedGuarded(reviewId, b, "IN_REVIEW", false),
    ]);

    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
    expect(results.filter((r) => r.count === 0)).toHaveLength(1);
    const review = await prisma.manualReview.findUniqueOrThrow({ where: { id: reviewId }, select: { reviewerId: true } });
    expect([a, b]).toContain(review.reviewerId);
  });

  it("two concurrent overrides: exactly one wins, resolved once", async () => {
    const reviewer = await makeReviewer("R");
    const reviewId = await seedReview(reviewer);
    const now = new Date();

    const results = await Promise.all([
      manualReviewRepository.resolveManualReviewGuarded({ reviewId, reviewerId: reviewer, reviewStatus: "RESOLVED", reviewedAt: now, overrideDecision: "PASS", overrideReason: "a", allowTakeover: false }),
      manualReviewRepository.resolveManualReviewGuarded({ reviewId, reviewerId: reviewer, reviewStatus: "RESOLVED", reviewedAt: now, overrideDecision: "FAIL", overrideReason: "b", allowTakeover: false }),
    ]);

    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
    expect(results.filter((r) => r.count === 0)).toHaveLength(1);
    const review = await prisma.manualReview.findUniqueOrThrow({ where: { id: reviewId }, select: { reviewStatus: true } });
    expect(review.reviewStatus).toBe("RESOLVED");
  });
});
