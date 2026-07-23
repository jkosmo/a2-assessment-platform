import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

type AuditRetentionRepositoryClient = Pick<typeof prisma, "auditEvent" | "$executeRaw">;

// #807: purge in bounded batches rather than one unbounded DELETE. A single deleteMany over an
// indefinitely-growing table takes a long transaction (extended locks, WAL spike, blocks autovacuum);
// batching keeps each transaction short. Default batch size balances round-trips against lock time.
export const AUDIT_RETENTION_DELETE_BATCH_SIZE = 1_000;

export function createAuditRetentionRepository(client: AuditRetentionRepositoryClient = prisma) {
  return {
    async deleteOperationalAuditEventsOlderThan(
      actions: string[],
      cutoffDate: Date,
      batchSize = AUDIT_RETENTION_DELETE_BATCH_SIZE,
    ): Promise<{ count: number }> {
      if (actions.length === 0) return { count: 0 };

      let count = 0;
      // Delete the oldest matching rows in chunks until a chunk comes back short (nothing left). The inner
      // selection is an index range scan on [action, timestamp]; each DELETE is its own short transaction.
      for (;;) {
        const deleted = await client.$executeRaw(Prisma.sql`
          DELETE FROM "AuditEvent"
          WHERE "id" IN (
            SELECT "id" FROM "AuditEvent"
            WHERE "action" IN (${Prisma.join(actions)}) AND "timestamp" < ${cutoffDate}
            ORDER BY "timestamp" ASC
            LIMIT ${batchSize}
          )
        `);
        count += deleted;
        if (deleted < batchSize) break;
      }
      return { count };
    },
  };
}

export const auditRetentionRepository = createAuditRetentionRepository();
