import { prisma } from "../db/prisma.js";

type AuditRepositoryClient = Pick<typeof prisma, "auditEvent" | "submission">;

export function createAuditRepository(client: AuditRepositoryClient = prisma) {
  return {
    createAuditEvent(data: {
      entityType: string;
      entityId: string;
      action: string;
      actorId?: string;
      metadataJson: string;
      payloadHash: string;
    }) {
      return client.auditEvent.create({ data });
    },

    findSubmissionAuditAccess(submissionId: string) {
      return client.submission.findUnique({
        where: { id: submissionId },
        select: { id: true, userId: true },
      });
    },

    findSubmissionAuditEvents(submissionId: string) {
      return client.auditEvent.findMany({
        where: {
          OR: [
            {
              entityType: "submission",
              entityId: submissionId,
            },
            {
              metadataJson: {
                contains: `"submissionId":"${submissionId}"`,
              },
            },
          ],
        },
        orderBy: { timestamp: "asc" },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
    },
  };
}

export const auditRepository = createAuditRepository();
