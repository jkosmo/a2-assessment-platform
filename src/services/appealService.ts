import { AppealStatus, DecisionType, SubmissionStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import { recordAuditEvent } from "./auditService.js";
import { buildAppealSlaSnapshot } from "./appealSla.js";

export async function createSubmissionAppeal(input: {
  submissionId: string;
  appealedById: string;
  appealReason: string;
}) {
  const submission = await prisma.submission.findFirst({
    where: {
      id: input.submissionId,
      userId: input.appealedById,
    },
    include: {
      decisions: {
        orderBy: { finalisedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!submission) {
    throw new Error("not_found");
  }
  if (!submission.decisions[0]) {
    throw new Error("missing_decision");
  }

  const activeAppeal = await prisma.appeal.findFirst({
    where: {
      submissionId: submission.id,
      appealStatus: { in: [AppealStatus.OPEN, AppealStatus.IN_REVIEW] },
    },
    select: { id: true },
  });

  if (activeAppeal) {
    throw new Error("already_open");
  }

  const appeal = await prisma.appeal.create({
    data: {
      submissionId: submission.id,
      appealedById: input.appealedById,
      appealReason: input.appealReason,
      appealStatus: AppealStatus.OPEN,
    },
  });

  await prisma.submission.update({
    where: { id: submission.id },
    data: { submissionStatus: SubmissionStatus.UNDER_REVIEW },
  });

  await recordAuditEvent({
    entityType: "appeal",
    entityId: appeal.id,
    action: "appeal_created",
    actorId: input.appealedById,
    metadata: {
      submissionId: submission.id,
      appealStatus: appeal.appealStatus,
    },
  });

  return appeal;
}

export async function listAppealQueue(input: {
  statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED">;
  limit: number;
}) {
  const appeals = await prisma.appeal.findMany({
    where: { appealStatus: { in: input.statuses } },
    orderBy: { createdAt: "asc" },
    take: input.limit,
    include: {
      appealedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      resolvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      submission: {
        select: {
          id: true,
          submittedAt: true,
          submissionStatus: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
            },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: {
              id: true,
              decisionType: true,
              passFailTotal: true,
              totalScore: true,
              finalisedAt: true,
            },
          },
        },
      },
    },
  });

  return appeals.map((appeal) => ({
    sla: buildAppealSlaSnapshot({
      createdAt: appeal.createdAt,
      claimedAt: appeal.claimedAt,
      resolvedAt: appeal.resolvedAt,
      appealStatus: appeal.appealStatus,
    }),
    id: appeal.id,
    appealStatus: appeal.appealStatus,
    appealReason: appeal.appealReason,
    createdAt: appeal.createdAt,
    claimedAt: appeal.claimedAt,
    resolvedAt: appeal.resolvedAt,
    appealedBy: appeal.appealedBy,
    resolvedBy: appeal.resolvedBy,
    submission: {
      id: appeal.submission.id,
      submittedAt: appeal.submission.submittedAt,
      submissionStatus: appeal.submission.submissionStatus,
      user: appeal.submission.user,
      module: appeal.submission.module,
      latestDecision: appeal.submission.decisions[0] ?? null,
    },
  }));
}

export async function getAppealWorkspace(appealId: string) {
  return prisma.appeal.findUnique({
    where: { id: appealId },
    include: {
      appealedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          department: true,
        },
      },
      resolvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      submission: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
              description: true,
            },
          },
          moduleVersion: true,
          mcqAttempts: {
            orderBy: { completedAt: "desc" },
            include: {
              responses: {
                include: {
                  question: {
                    select: {
                      id: true,
                      stem: true,
                    },
                  },
                },
              },
            },
          },
          llmEvaluations: { orderBy: { createdAt: "desc" } },
          decisions: { orderBy: { finalisedAt: "desc" } },
          manualReviews: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
}

export async function claimAppeal(appealId: string, handlerId: string) {
  const appeal = await prisma.appeal.findUnique({
    where: { id: appealId },
    select: {
      id: true,
      submissionId: true,
      appealStatus: true,
      claimedAt: true,
      resolvedById: true,
    },
  });

  if (!appeal) {
    throw new Error("not_found");
  }
  if (appeal.appealStatus === AppealStatus.RESOLVED || appeal.appealStatus === AppealStatus.REJECTED) {
    throw new Error("already_resolved");
  }
  if (
    appeal.appealStatus === AppealStatus.IN_REVIEW &&
    appeal.resolvedById &&
    appeal.resolvedById !== handlerId
  ) {
    throw new Error("already_assigned");
  }

  const claimed = await prisma.appeal.update({
    where: { id: appealId },
    data: {
      appealStatus: AppealStatus.IN_REVIEW,
      resolvedById: handlerId,
      ...(appeal.claimedAt ? {} : { claimedAt: new Date() }),
    },
  });

  await recordAuditEvent({
    entityType: "appeal",
    entityId: claimed.id,
    action: "appeal_claimed",
    actorId: handlerId,
    metadata: {
      submissionId: appeal.submissionId,
      appealStatus: claimed.appealStatus,
      claimedAt: claimed.claimedAt?.toISOString() ?? null,
    },
  });

  return claimed;
}

export async function resolveAppeal(input: {
  appealId: string;
  handlerId: string;
  passFailTotal: boolean;
  decisionReason: string;
  resolutionNote: string;
}) {
  const appeal = await prisma.appeal.findUnique({
    where: { id: input.appealId },
    include: {
      submission: {
        include: {
          decisions: {
            orderBy: { finalisedAt: "desc" },
          },
        },
      },
    },
  });

  if (!appeal) {
    throw new Error("not_found");
  }
  if (appeal.appealStatus === AppealStatus.RESOLVED || appeal.appealStatus === AppealStatus.REJECTED) {
    throw new Error("already_resolved");
  }
  if (
    appeal.appealStatus === AppealStatus.IN_REVIEW &&
    appeal.resolvedById &&
    appeal.resolvedById !== input.handlerId
  ) {
    throw new Error("already_assigned");
  }

  const latestDecision = appeal.submission.decisions[0];
  if (!latestDecision) {
    throw new Error("missing_decision");
  }

  const finalisedAt = new Date();
  const resolutionDecision = await prisma.assessmentDecision.create({
    data: {
      submissionId: latestDecision.submissionId,
      moduleVersionId: latestDecision.moduleVersionId,
      rubricVersionId: latestDecision.rubricVersionId,
      promptTemplateVersionId: latestDecision.promptTemplateVersionId,
      mcqScaledScore: latestDecision.mcqScaledScore,
      practicalScaledScore: latestDecision.practicalScaledScore,
      totalScore: latestDecision.totalScore,
      redFlagsJson: latestDecision.redFlagsJson,
      passFailTotal: input.passFailTotal,
      decisionType: DecisionType.APPEAL_RESOLUTION,
      decisionReason: input.decisionReason,
      finalisedAt,
      finalisedById: input.handlerId,
      parentDecisionId: latestDecision.id,
    },
  });

  const resolvedAppeal = await prisma.appeal.update({
    where: { id: appeal.id },
    data: {
      appealStatus: AppealStatus.RESOLVED,
      resolvedAt: finalisedAt,
      resolvedById: input.handlerId,
      resolutionNote: input.resolutionNote,
    },
  });

  await prisma.submission.update({
    where: { id: latestDecision.submissionId },
    data: { submissionStatus: SubmissionStatus.COMPLETED },
  });

  await recordAuditEvent({
    entityType: "assessment_decision",
    entityId: resolutionDecision.id,
    action: "appeal_resolution_decision_created",
    actorId: input.handlerId,
    metadata: {
      submissionId: latestDecision.submissionId,
      appealId: appeal.id,
      parentDecisionId: latestDecision.id,
      passFailTotal: resolutionDecision.passFailTotal,
    },
  });

  await recordAuditEvent({
    entityType: "appeal",
    entityId: resolvedAppeal.id,
    action: "appeal_resolved",
    actorId: input.handlerId,
    metadata: {
      submissionId: latestDecision.submissionId,
      resolutionDecisionId: resolutionDecision.id,
      appealStatus: resolvedAppeal.appealStatus,
    },
  });

  return { appeal: resolvedAppeal, resolutionDecision };
}
