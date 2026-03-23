import { OPERATIONAL_LOG_RETENTION_DAYS } from "../../config/retention.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditRetentionRepository } from "./auditRetentionRepository.js";

/**
 * Audit event action types that are purely operational and carry no compliance
 * value. These are high-frequency system events that do not represent user
 * data access or changes, and are safe to purge after OPERATIONAL_LOG_RETENTION_DAYS.
 *
 * All other action types (submission_viewed, user_pseudonymized, decision_created,
 * appeal_*, submission_created, etc.) are considered compliance-critical and are
 * retained indefinitely.
 */
const OPERATIONAL_ACTION_TYPES = new Set([
  "org_sync_completed",
  "org_sync_record_failed",
  "assessment_job_enqueued",
  "recertification_status_upserted",
]);

export type AuditRetentionResult = {
  deletedCount: number;
  cutoffDate: Date;
};

/**
 * Deletes operational-category audit events older than OPERATIONAL_LOG_RETENTION_DAYS.
 * Compliance-critical events (access logs, pseudonymisation records, etc.) are not
 * affected.
 */
export async function runAuditRetentionScan(): Promise<AuditRetentionResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - OPERATIONAL_LOG_RETENTION_DAYS);

  const result = await auditRetentionRepository.deleteOperationalAuditEventsOlderThan(
    Array.from(OPERATIONAL_ACTION_TYPES),
    cutoffDate,
  );

  logOperationalEvent("audit_retention_scan_completed", {
    deletedCount: result.count,
    cutoffDate: cutoffDate.toISOString(),
    retentionDays: OPERATIONAL_LOG_RETENTION_DAYS,
  });

  return { deletedCount: result.count, cutoffDate };
}
