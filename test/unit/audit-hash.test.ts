import { describe, it, expect } from "vitest";
import { computeAuditHash } from "../../src/services/auditService.js";

// #804: the audit payload hash must cover prevHash (chain), actor, and timestamp so tampering with any
// of them is detectable.
describe("computeAuditHash (#804)", () => {
  const base = {
    prevHash: null as string | null,
    entityType: "submission",
    entityId: "sub-1",
    action: "submission_created",
    actorId: "user-1" as string | null,
    timestamp: new Date("2026-07-25T10:00:00.000Z"),
    metadataJson: "{}",
  };

  it("is deterministic for identical input", () => {
    expect(computeAuditHash(base)).toBe(computeAuditHash({ ...base }));
  });

  it("is a 64-char hex sha256", () => {
    expect(computeAuditHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the prior hash changes (chain link)", () => {
    expect(computeAuditHash({ ...base, prevHash: "deadbeef" })).not.toBe(computeAuditHash(base));
  });

  it("changes when the actor changes", () => {
    expect(computeAuditHash({ ...base, actorId: "user-2" })).not.toBe(computeAuditHash(base));
    expect(computeAuditHash({ ...base, actorId: null })).not.toBe(computeAuditHash(base));
  });

  it("changes when the timestamp changes", () => {
    expect(computeAuditHash({ ...base, timestamp: new Date("2026-07-25T10:00:01.000Z") })).not.toBe(
      computeAuditHash(base),
    );
  });

  it("changes when the metadata changes", () => {
    expect(computeAuditHash({ ...base, metadataJson: '{"a":1}' })).not.toBe(computeAuditHash(base));
  });

  it("does not let a field value forge a boundary (entityType|entityId vs concatenation)", () => {
    // "a" + "bc" must not collide with "ab" + "c" — the separator prevents this.
    const left = computeAuditHash({ ...base, entityType: "a", entityId: "bc" });
    const right = computeAuditHash({ ...base, entityType: "ab", entityId: "c" });
    expect(left).not.toBe(right);
  });
});
