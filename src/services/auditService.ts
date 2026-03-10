import { prisma } from "../db/prisma.js";
import { ForbiddenError } from "../errors/AppError.js";
import { sha256 } from "../utils/hash.js";
import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../db/prismaRuntime.js";

type AuditInput = {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(input: AuditInput) {
  const metadataJson = JSON.stringify(input.metadata ?? {});

  await prisma.auditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actorId,
      metadataJson,
      payloadHash: sha256(`${input.entityType}:${input.entityId}:${input.action}:${metadataJson}`),
    },
  });
}

const ADMIN_AUDIT_ROLES: AppRoleType[] = [
  AppRole.ADMINISTRATOR,
  AppRole.SUBJECT_MATTER_OWNER,
  AppRole.REVIEWER,
  AppRole.APPEAL_HANDLER,
  AppRole.REPORT_READER,
];

function hasAuditReadAccess(roles: AppRoleType[]) {
  return roles.some((role) => ADMIN_AUDIT_ROLES.includes(role));
}

type SubmissionAuditTrailInput = {
  submissionId: string;
  requestorUserId: string;
  roles: AppRoleType[];
};

export async function getSubmissionAuditTrail(input: SubmissionAuditTrailInput) {
  const submission = await prisma.submission.findUnique({
    where: { id: input.submissionId },
    select: { id: true, userId: true },
  });

  if (!submission) {
    return null;
  }

  if (!hasAuditReadAccess(input.roles) && submission.userId !== input.requestorUserId) {
    throw new ForbiddenError("You do not have access to this submission audit trail.");
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      OR: [
        {
          entityType: "submission",
          entityId: input.submissionId,
        },
        {
          metadataJson: {
            contains: `"submissionId":"${input.submissionId}"`,
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

  return {
    submissionId: submission.id,
    events: events.map((event) => ({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      timestamp: event.timestamp,
      payloadHash: event.payloadHash,
      actor: event.actor
        ? {
            id: event.actor.id,
            name: event.actor.name,
            email: event.actor.email,
          }
        : null,
      metadata: parseMetadata(event.metadataJson),
    })),
  };
}

function parseMetadata(input: string) {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return { parseError: "invalid_metadata_json", raw: input };
  }
}
