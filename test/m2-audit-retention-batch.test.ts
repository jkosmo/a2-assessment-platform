import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { auditRetentionRepository } from "../src/modules/retention/auditRetentionRepository.js";

// #807: retention deletes in bounded keyset batches (not one unbounded transaction), driven by the new
// [action, timestamp] index. This verifies it purges old matching rows across multiple batches while
// leaving recent rows and other actions untouched.
describe("audit retention batched delete (#807)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deletes old matching events in batches, keeps recent + non-matching", async () => {
    const tag = `ret-${Date.now()}`;
    const OP = `op_${tag}`;
    const OTHER = `other_${tag}`;
    const old = new Date("2020-01-01T00:00:00.000Z");
    const recent = new Date();
    const cutoff = new Date("2021-01-01T00:00:00.000Z");

    const mk = (action: string, timestamp: Date, i: number) =>
      prisma.auditEvent.create({
        data: {
          entityType: "test",
          entityId: `${tag}-${action}-${i}`,
          action,
          timestamp,
          payloadHash: "x",
          metadataJson: "{}",
        },
      });

    // 5 old operational (to force >2 batches), 2 recent operational, 1 old non-operational.
    await Promise.all([0, 1, 2, 3, 4].map((i) => mk(OP, old, i)));
    await Promise.all([0, 1].map((i) => mk(OP, recent, i)));
    await mk(OTHER, old, 0);

    const result = await auditRetentionRepository.deleteOperationalAuditEventsOlderThan([OP], cutoff, 2);
    expect(result.count).toBe(5);

    expect(await prisma.auditEvent.count({ where: { action: OP, timestamp: { lt: cutoff } } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: OP, timestamp: { gte: cutoff } } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: OTHER } })).toBe(1);
  });

  it("is a no-op when the action list is empty", async () => {
    expect(await auditRetentionRepository.deleteOperationalAuditEventsOlderThan([], new Date())).toEqual({ count: 0 });
  });
});
