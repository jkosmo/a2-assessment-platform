import { prisma } from "../db/prisma.js";

// #1000: forholdsoppslaget trenger de tre tabellene som faktisk UTTRYKKER et forhold mellom en
// leser og en innlevering — tildelt vurdering, behandlet anke, og eierskap til modulinnholdet.
type AuditRepositoryClient = Pick<
  typeof prisma,
  "auditEvent" | "submission" | "manualReview" | "appeal" | "contentOwner"
>;

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
        select: { id: true, userId: true, moduleId: true },
      });
    },

    /**
     * #1000: hvilke FORHOLD knytter denne leseren til denne innleveringen?
     *
     * ⚠️ Brukes bare til måling — ingenting avvises på grunnlag av svaret. Poenget er å finne ut
     * hvor ofte et spor leses UTEN at noe forhold finnes, før noen bestemmer om tilgangen skal
     * strammes inn. Uten de tallene ville en innstramming vært en gjetning.
     */
    async findReaderRelations(input: { submissionId: string; moduleId: string; readerUserId: string }) {
      const [assignedReview, handledAppeal, contentOwnership] = await Promise.all([
        client.manualReview.count({
          where: { submissionId: input.submissionId, reviewerId: input.readerUserId },
        }),
        client.appeal.count({
          where: { submissionId: input.submissionId, resolvedById: input.readerUserId },
        }),
        client.contentOwner.count({
          where: { contentType: "MODULE", contentId: input.moduleId, userId: input.readerUserId },
        }),
      ]);
      return {
        isAssignedReviewer: assignedReview > 0,
        isAssignedAppealHandler: handledAppeal > 0,
        ownsModuleContent: contentOwnership > 0,
      };
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
