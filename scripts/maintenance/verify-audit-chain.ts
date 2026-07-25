/**
 * #804: verification path for the tamper-evident audit chain. Walks the chain and confirms every row's
 * payloadHash recomputes from its stored content (incl. prevHash/actor/timestamp) and links to the prior
 * row. Exits non-zero if the chain is broken (a tampered/removed/reordered row), so it can gate an alert.
 *
 * Target the intended env explicitly:
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/verify-audit-chain.ts
 */
import { verifyAuditChain } from "../../src/services/auditService.js";
import { prisma } from "../../src/db/prisma.js";

async function main() {
  const result = await verifyAuditChain();
  console.log(JSON.stringify({ event: "audit_chain_verify", ...result }));
  if (!result.ok) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error("audit_chain_verify_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
