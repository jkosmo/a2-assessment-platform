import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils/hash.js";
import { recordAuditEvent } from "./auditService.js";
import { auditActions, auditEntityTypes } from "../observability/auditEvents.js";

// #843 (#806 follow-up): historical scrub of person-PII (email) from indefinitely-retained audit
// metadata. The #806 forward-fix stopped NEW rows from carrying email; this cleans the existing ones.
//
// Approach A (re-seal, chosen by product owner): remove the PII field from metadataJson, recompute
// payloadHash over the cleaned row so the tamper-evidence seal stays internally consistent (hash matches
// content), and record ONE auditable `audit_metadata_scrubbed` event (count only, no PII) as the trail.
// We lose the ability to cryptographically prove a scrubbed row's PRE-scrub content — deliberately,
// because that content was the PII being deleted.
//
// Idempotent: a scrubbed row no longer contains the field, so re-runs select nothing.

// The retained actions that embedded person-PII (the #806/#4b forward-fix sites) → the metadata key to
// remove. Keep in sync with any future field added to (then removed from) retained audit metadata.
const SCRUB_TARGETS: ReadonlyArray<{ action: string; field: string }> = [
  { action: auditActions.certification.recertificationReminderSent, field: "recipientEmail" },
  { action: auditActions.certification.recertificationReminderFailed, field: "recipientEmail" },
  { action: auditActions.orgSync.recordFailed, field: "email" },
];

export async function scrubHistoricalAuditPii(actorId?: string): Promise<{ scrubbed: number }> {
  let scrubbed = 0;

  for (const { action, field } of SCRUB_TARGETS) {
    // Only rows that still carry the field — makes the pass both efficient and idempotent.
    const rows = await prisma.auditEvent.findMany({
      where: { action, metadataJson: { contains: `"${field}"` } },
      select: { id: true, entityType: true, entityId: true, action: true, metadataJson: true },
    });

    for (const row of rows) {
      let metadata: Record<string, unknown>;
      try {
        metadata = JSON.parse(row.metadataJson) as Record<string, unknown>;
      } catch {
        continue; // unparseable metadata — leave it untouched rather than risk corrupting the row
      }
      if (!(field in metadata)) continue; // substring match false-positive (field inside a value)

      delete metadata[field];
      // Re-stringify preserves the remaining keys' original insertion order, so the recomputed hash
      // matches what a fresh recordAuditEvent would produce for the scrubbed metadata.
      const newMetadataJson = JSON.stringify(metadata);
      const payloadHash = sha256(`${row.entityType}:${row.entityId}:${row.action}:${newMetadataJson}`);
      await prisma.auditEvent.update({
        where: { id: row.id },
        data: { metadataJson: newMetadataJson, payloadHash },
      });
      scrubbed += 1;
    }
  }

  if (scrubbed > 0) {
    await recordAuditEvent({
      entityType: auditEntityTypes.audit,
      entityId: "audit-pii-scrub",
      action: auditActions.audit.metadataScrubbed,
      actorId,
      metadata: {
        scrubbedCount: scrubbed,
        actions: [...new Set(SCRUB_TARGETS.map((t) => t.action))],
        fields: [...new Set(SCRUB_TARGETS.map((t) => t.field))],
      },
    });
  }

  return { scrubbed };
}
