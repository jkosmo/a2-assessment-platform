import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { sha256 } from "../src/utils/hash.js";
import { scrubHistoricalAuditPii } from "../src/services/auditPiiScrub.js";

// #843 (#806 follow-up): historical audit-PII scrub, approach A (re-seal). Verifies a legacy row with an
// embedded email is cleaned, the payloadHash is recomputed to stay consistent, an auditable scrub event
// is recorded, non-PII rows are untouched, and the pass is idempotent.

function seedAudit(entityType: string, entityId: string, action: string, metadata: Record<string, unknown>) {
  const metadataJson = JSON.stringify(metadata);
  return prisma.auditEvent.create({
    data: { entityType, entityId, action, metadataJson, payloadHash: sha256(`${entityType}:${entityId}:${action}:${metadataJson}`) },
    select: { id: true },
  });
}

describe("historical audit-PII scrub (#843, re-seal)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("removes email, re-seals the hash, records a scrub event, and is idempotent", async () => {
    const tag = `scrub-${Date.now()}`;
    // Two legacy rows carrying person-PII, plus one clean row that must be left untouched.
    const recert = await seedAudit("certification_status", `${tag}-cert`, "recertification_reminder_sent", {
      certificationId: `${tag}-cert`, userId: `${tag}-u`, recipientEmail: "leak@x.test",
    });
    const orgFail = await seedAudit("org_sync", `${tag}-run`, "org_sync_record_failed", {
      source: "entra", externalId: `${tag}-ext`, email: "leak2@x.test", reason: "conflict",
    });
    const clean = await seedAudit("certification_status", `${tag}-clean`, "recertification_reminder_sent", {
      certificationId: `${tag}-clean`, userId: `${tag}-u2`,
    });
    const cleanBefore = await prisma.auditEvent.findUniqueOrThrow({ where: { id: clean.id } });

    const result = await scrubHistoricalAuditPii();
    expect(result.scrubbed).toBeGreaterThanOrEqual(2);

    const recertAfter = await prisma.auditEvent.findUniqueOrThrow({ where: { id: recert.id } });
    expect(recertAfter.metadataJson).not.toContain("recipientEmail");
    expect(recertAfter.metadataJson).not.toContain("leak@x.test");
    expect(recertAfter.metadataJson).toContain("userId");
    // Re-sealed: the stored hash matches a fresh hash of the scrubbed content.
    expect(recertAfter.payloadHash).toBe(sha256(`${recertAfter.entityType}:${recertAfter.entityId}:${recertAfter.action}:${recertAfter.metadataJson}`));

    const orgAfter = await prisma.auditEvent.findUniqueOrThrow({ where: { id: orgFail.id } });
    expect(orgAfter.metadataJson).not.toContain("leak2@x.test");
    expect(orgAfter.metadataJson).toContain("externalId");

    // The clean row is byte-for-byte untouched.
    const cleanAfter = await prisma.auditEvent.findUniqueOrThrow({ where: { id: clean.id } });
    expect(cleanAfter.metadataJson).toBe(cleanBefore.metadataJson);
    expect(cleanAfter.payloadHash).toBe(cleanBefore.payloadHash);

    // An auditable scrub event was recorded (no PII).
    const scrubEvent = await prisma.auditEvent.findFirst({ where: { action: "audit_metadata_scrubbed" }, orderBy: { timestamp: "desc" } });
    expect(scrubEvent).toBeTruthy();
    const scrubMeta = JSON.parse(scrubEvent!.metadataJson) as { scrubbedCount: number };
    expect(scrubMeta.scrubbedCount).toBeGreaterThanOrEqual(2);
    expect(scrubEvent!.metadataJson).not.toContain("leak");

    // Idempotent: a second pass finds nothing left to scrub.
    expect((await scrubHistoricalAuditPii()).scrubbed).toBe(0);
  });
});
