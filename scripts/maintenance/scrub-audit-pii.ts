/**
 * #843 (#806 follow-up): one-time historical scrub of person-PII (email) from indefinitely-retained
 * audit metadata. Approach A (re-seal): removes the PII field, recomputes each row's payloadHash, and
 * records an auditable `audit_metadata_scrubbed` event. Idempotent — safe to re-run (a scrubbed row is
 * skipped).
 *
 * Runs against whatever DATABASE_URL is in the environment, so target the intended env explicitly:
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/scrub-audit-pii.ts
 * On Azure, run via the app's DATABASE_URL. Verify afterwards that no target action's metadata still
 * contains the field (the test m2-audit-pii-scrub covers the mechanics).
 */
import { scrubHistoricalAuditPii } from "../../src/services/auditPiiScrub.js";
import { prisma } from "../../src/db/prisma.js";

async function main() {
  const result = await scrubHistoricalAuditPii();
  // Structured, PII-free output for the operator log.
  console.log(JSON.stringify({ event: "audit_pii_scrub_complete", scrubbed: result.scrubbed }));
}

main()
  .catch((error) => {
    console.error("audit_pii_scrub_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
