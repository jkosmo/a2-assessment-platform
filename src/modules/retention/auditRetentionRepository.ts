import { prisma } from "../../db/prisma.js";

type AuditRetentionRepositoryClient = Pick<typeof prisma, "auditEvent">;

export function createAuditRetentionRepository(client: AuditRetentionRepositoryClient = prisma) {
  return {
    deleteOperationalAuditEventsOlderThan(actions: string[], cutoffDate: Date) {
      return client.auditEvent.deleteMany({
        where: {
          action: { in: actions },
          timestamp: { lt: cutoffDate },
        },
      });
    },
  };
}

export const auditRetentionRepository = createAuditRetentionRepository();
