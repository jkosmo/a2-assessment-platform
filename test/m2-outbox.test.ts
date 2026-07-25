import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { enqueueOutboxEvents, processNextOutboxEvent, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";

// #795: the decision path enqueues post-decision side effects to a durable outbox; a delivery worker
// leases pending rows and delivers them with bounded retries. This proves that against a real Postgres:
// enqueue persists pending rows, a successful delivery marks the row delivered, and a failing delivery
// retries (attempts++/backoff) until maxAttempts flips it to failed.

const WORKER = "test-outbox-worker";
const LEASE_MS = 60_000;

describe("transactional outbox delivery (#795)", () => {
  beforeEach(async () => {
    // Isolate from any rows other suites may have enqueued, so processNextOutboxEvent claims ours.
    await prisma.outboxEvent.deleteMany({ where: { status: "pending" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("enqueue persists durable pending rows", async () => {
    await enqueueOutboxEvents([
      { type: OUTBOX_EVENT_TYPES.courseCompletionCheck, payload: { userId: "u1", moduleId: "m1" } },
    ]);
    const pending = await prisma.outboxEvent.count({ where: { status: "pending", type: OUTBOX_EVENT_TYPES.courseCompletionCheck } });
    expect(pending).toBeGreaterThanOrEqual(1);
  });

  it("delivers a course-completion-check event and marks it delivered", async () => {
    // A completion check for a user with no completable enrollment is a safe no-op (delivery succeeds).
    const user = await prisma.user.create({
      data: { externalId: `ob-${Date.now()}-${Math.random()}`, name: "OB", email: `ob-${Date.now()}-${Math.random()}@x.test` },
      select: { id: true },
    });
    const mv = await prisma.moduleVersion.findFirstOrThrow({ select: { moduleId: true } });
    const row = await prisma.outboxEvent.create({
      data: {
        type: OUTBOX_EVENT_TYPES.courseCompletionCheck,
        payloadJson: JSON.stringify({ userId: user.id, moduleId: mv.moduleId }),
        availableAt: new Date(Date.now() - 1000),
      },
      select: { id: true },
    });

    const processed = await processNextOutboxEvent(WORKER, LEASE_MS);
    expect(processed).toBe(true);

    const after = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("delivered");
    expect(after.deliveredAt).not.toBeNull();
    expect(after.lockedBy).toBeNull();
  });

  it("retries a failing delivery, then fails it after maxAttempts", async () => {
    // An unknown type makes deliverOutboxEvent throw — a clean, deterministic delivery failure.
    const row = await prisma.outboxEvent.create({
      data: { type: "bogus_unknown_type", payloadJson: "{}", maxAttempts: 2, availableAt: new Date(Date.now() - 1000) },
      select: { id: true },
    });

    // Attempt 1 → failure → retry (still pending, attempts 1, availableAt pushed into the future).
    expect(await processNextOutboxEvent(WORKER, LEASE_MS)).toBe(true);
    let after = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("pending");
    expect(after.attempts).toBe(1);
    expect(after.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(after.lastError).toContain("Unknown outbox event type");

    // Make it due again and process → attempt 2 reaches maxAttempts → failed.
    await prisma.outboxEvent.update({ where: { id: row.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    expect(await processNextOutboxEvent(WORKER, LEASE_MS)).toBe(true);
    after = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("failed");
    expect(after.attempts).toBe(2);
  });
});
