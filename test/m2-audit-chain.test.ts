import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db/prisma.js";
import {
  recordAuditEvent,
  verifyAuditChain,
  backfillAuditChain,
  computeAuditHash,
} from "../src/services/auditService.js";

// #804 integration (real Postgres): the audit log is a tamper-evident hash chain. recordAuditEvent links
// each event to the prior one (serialized by a pg advisory lock so concurrent writers stay linear);
// verifyAuditChain recomputes + checks the chain; tampering is detected; backfill re-seals legacy rows.

// The typed AuditEventInput constrains action+metadata; these tests exercise the chain mechanics with a
// synthetic action, so cast at the boundary.
async function record(entityId: string, metadata: Record<string, unknown>): Promise<void> {
  await recordAuditEvent({
    entityType: "test_entity",
    entityId,
    action: "test_action",
    actorId: null,
    metadata,
  } as unknown as Parameters<typeof recordAuditEvent>[0]);
}

async function orderedEvents() {
  return prisma.auditEvent.findMany({
    orderBy: { chainSeq: "asc" },
    select: { chainSeq: true, prevHash: true, payloadHash: true, metadataJson: true },
  });
}

describe("audit hash chain (#804)", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({});
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({});
    await prisma.$disconnect();
  });

  it("links each event to the prior one; genesis has no predecessor", async () => {
    await record("a", { n: 1 });
    await record("b", { n: 2 });
    await record("c", { n: 3 });

    const events = await orderedEvents();
    expect(events).toHaveLength(3);
    expect(events[0].prevHash).toBeNull();
    expect(events[1].prevHash).toBe(events[0].payloadHash);
    expect(events[2].prevHash).toBe(events[1].payloadHash);

    const result = await verifyAuditChain();
    expect(result).toEqual({ ok: true, checked: 3 });
  });

  it("detects a tampered row (hash mismatch)", async () => {
    await record("a", { n: 1 });
    await record("b", { n: 2 });
    await record("c", { n: 3 });
    const events = await orderedEvents();

    // Tamper with the middle row's metadata without recomputing its hash.
    await prisma.auditEvent.update({
      where: { chainSeq: events[1].chainSeq },
      data: { metadataJson: JSON.stringify({ n: 999 }) },
    });

    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("hash_mismatch");
      expect(result.brokenChainSeq).toBe(events[1].chainSeq.toString());
    }
  });

  it("detects a removed row (chain break)", async () => {
    await record("a", { n: 1 });
    await record("b", { n: 2 });
    await record("c", { n: 3 });
    const events = await orderedEvents();

    // Remove the middle row: the third row's prevHash now points at a hash that isn't its predecessor.
    await prisma.auditEvent.delete({ where: { chainSeq: events[1].chainSeq } });

    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("chain_break");
  });

  it("keeps the chain linear under concurrent writes (advisory lock)", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => record(`row-${i}`, { i })));

    const events = await orderedEvents();
    expect(events).toHaveLength(12);
    // Every non-genesis row links to its immediate predecessor — no branch/duplicate prevHash.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(events[i - 1].payloadHash);
    }
    const result = await verifyAuditChain();
    expect(result).toEqual({ ok: true, checked: 12 });
  });

  it("backfill re-seals legacy (unchained) rows and is idempotent", async () => {
    // Simulate pre-#804 rows: old-format payloadHash, prevHash NULL.
    for (let i = 0; i < 4; i++) {
      await prisma.auditEvent.create({
        data: {
          entityType: "test_entity",
          entityId: `legacy-${i}`,
          action: "test_action",
          actorId: null,
          metadataJson: JSON.stringify({ i }),
          payloadHash: `legacy-hash-${i}`,
          submissionId: null,
        },
      });
    }
    // Before backfill the chain doesn't verify (legacy hashes don't match the new format).
    expect((await verifyAuditChain()).ok).toBe(false);

    const first = await backfillAuditChain();
    expect(first.resealed).toBe(4);
    expect((await verifyAuditChain()).ok).toBe(true);

    // Idempotent: a second run reseals to identical hashes and still verifies.
    const snapshotBefore = (await orderedEvents()).map((e) => e.payloadHash);
    const second = await backfillAuditChain();
    expect(second.resealed).toBe(4);
    const snapshotAfter = (await orderedEvents()).map((e) => e.payloadHash);
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("stored payloadHash matches an independent recompute (write path uses computeAuditHash)", async () => {
    await record("a", { n: 1 });
    const [event] = await prisma.auditEvent.findMany({
      orderBy: { chainSeq: "asc" },
      select: {
        prevHash: true,
        payloadHash: true,
        entityType: true,
        entityId: true,
        action: true,
        actorId: true,
        timestamp: true,
        metadataJson: true,
      },
    });
    expect(computeAuditHash(event)).toBe(event.payloadHash);
  });
});
