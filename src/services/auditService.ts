import { ForbiddenError } from "../errors/AppError.js";
import { auditRepository, createAuditRepository } from "../repositories/auditRepository.js";
import { sha256 } from "../utils/hash.js";
import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import type { AuditAction, AuditEventInput } from "../observability/auditEvents.js";

type AuditTxClient = Pick<typeof prisma, "auditEvent" | "submission">;

export async function recordAuditEvent<TAction extends AuditAction>(
  input: AuditEventInput<TAction>,
  tx?: AuditTxClient,
) {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const repo = tx ? createAuditRepository(tx) : auditRepository;

  await repo.createAuditEvent({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actorId,
    metadataJson,
    payloadHash: sha256(`${input.entityType}:${input.entityId}:${input.action}:${metadataJson}`),
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
  const submission = await auditRepository.findSubmissionAuditAccess(input.submissionId);

  if (!submission) {
    return null;
  }

  if (!hasAuditReadAccess(input.roles) && submission.userId !== input.requestorUserId) {
    throw new ForbiddenError("You do not have access to this submission audit trail.");
  }

  const events = await auditRepository.findSubmissionAuditEvents(input.submissionId);

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
