import { prisma } from "../db/prisma.js";

type AuditRepositoryClient = Pick<typeof prisma, "auditEvent" | "submission">;

// #797: a single submission's trail is bounded by its lifecycle; cap the read so it can never return an
// unbounded set even if many events accrue.
export const AUDIT_TRAIL_MAX_EVENTS = 500;

export function createAuditRepository(client: AuditRepositoryClient = prisma) {
  return {
    createAuditEvent(data: {
      entityType: string;
      entityId: string;
      action: string;
      actorId?: string;
      metadataJson: string;
      payloadHash: string;
      submissionId?: string | null;
    }) {
      return client.auditEvent.create({ data });
    },

    findSubmissionAuditAccess(submissionId: string) {
      return client.submission.findUnique({
        where: { id: submissionId },
        select: { id: true, userId: true },
      });
    },

    // #797: indexed equality on the denormalized submissionId column (was an unindexable metadataJson LIKE
    // scan). Bounded with a take so a single trail can't return an unbounded result set.
    findSubmissionAuditEvents(submissionId: string, take = AUDIT_TRAIL_MAX_EVENTS) {
      return client.auditEvent.findMany({
        where: { submissionId },
        orderBy: { timestamp: "asc" },
        take,
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

    findAuditEventMetadataByEntityAndAction(entityType: string, entityId: string, action: string) {
      return client.auditEvent.findMany({
        where: {
          entityType,
          entityId,
          action,
        },
        select: { metadataJson: true },
      });
    },
  };
}

export const auditRepository = createAuditRepository();
