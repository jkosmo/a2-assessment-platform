/**
 * #804: one-time backfill that re-seals all existing AuditEvent rows into the tamper-evident hash chain
 * (recomputes prevHash + payloadHash in chainSeq order). Run once per environment AFTER deploying the
 * #804 change; then `verify-audit-chain` passes over the whole table. Idempotent — safe to re-run.
 *
 * Runs against whatever DATABASE_URL is in the environment, so target the intended env explicitly:
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/backfill-audit-chain.ts
 */
import { backfillAuditChain } from "../../src/services/auditService.js";
import { prisma } from "../../src/db/prisma.js";

async function main() {
  const result = await backfillAuditChain();
  console.log(JSON.stringify({ event: "audit_chain_backfill_complete", resealed: result.resealed }));
}

main()
  .catch((error) => {
    console.error("audit_chain_backfill_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
