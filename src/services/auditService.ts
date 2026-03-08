import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils/hash.js";

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

