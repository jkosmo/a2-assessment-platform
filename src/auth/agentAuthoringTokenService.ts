// AA-3 (#651): short-lived Agent Authoring Session tokens.
//
// A logged-in SMO/ADMINISTRATOR issues a token (secret `aat_<48 hex>`, shown ONCE),
// hands it to an agent (env var A2_AUTH_BEARER), and the agent authenticates with
// `Authorization: Bearer aat_...`. The request is then scoped by
// enforceAgentTokenScope to draft-authoring operations only. Only the sha256 hash
// is stored; expiry is short (5–60 min) and revocation is immediate. Multitenant:
// tokens live in this installation's database and are meaningless anywhere else.

import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils/hash.js";
import { recordAuditEvent } from "../services/auditService.js";
import { auditActions, auditEntityTypes } from "../observability/auditEvents.js";

export const AGENT_TOKEN_PREFIX = "aat_";
export const AGENT_TOKEN_DEFAULT_TTL_MINUTES = 60;
export const AGENT_TOKEN_MAX_TTL_MINUTES = 60;
export const AGENT_TOKEN_MIN_TTL_MINUTES = 5;

export async function issueAgentAuthoringToken(input: {
  userId: string;
  label?: string;
  ttlMinutes?: number;
}) {
  const ttl = Math.min(
    AGENT_TOKEN_MAX_TTL_MINUTES,
    Math.max(AGENT_TOKEN_MIN_TTL_MINUTES, input.ttlMinutes ?? AGENT_TOKEN_DEFAULT_TTL_MINUTES),
  );
  const secret = `${AGENT_TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  const record = await prisma.agentAuthoringToken.create({
    data: {
      tokenHash: sha256(secret),
      label: input.label ?? null,
      userId: input.userId,
      expiresAt: new Date(Date.now() + ttl * 60_000),
    },
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.agentAuthoringToken,
    entityId: record.id,
    action: auditActions.agentAuthoring.tokenIssued,
    actorId: input.userId,
    metadata: { tokenId: record.id, expiresAt: record.expiresAt.toISOString() },
  });

  // The secret exists only in this return value — it is never persisted or logged.
  return { secret, record };
}

// Resolves a presented secret to its (active) token + user. Returns null for
// unknown, expired or revoked tokens — the caller answers 401 without detail.
export async function authenticateAgentToken(secret: string) {
  if (!secret.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const token = await prisma.agentAuthoringToken.findUnique({
    where: { tokenHash: sha256(secret) },
    include: { user: true },
  });
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) return null;
  await prisma.agentAuthoringToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });
  return token;
}

export function listAgentAuthoringTokens(userId: string) {
  return prisma.agentAuthoringToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });
}

// Owner (or ADMINISTRATOR) revokes. Returns null when the token does not exist
// or the actor is not allowed to touch it (both → 404 at the route layer).
export async function revokeAgentAuthoringToken(input: {
  tokenId: string;
  actorUserId: string;
  roles: string[];
}) {
  const token = await prisma.agentAuthoringToken.findUnique({ where: { id: input.tokenId } });
  if (!token) return null;
  if (token.userId !== input.actorUserId && !input.roles.includes("ADMINISTRATOR")) return null;
  if (token.revokedAt) return token;

  const revoked = await prisma.agentAuthoringToken.update({
    where: { id: token.id },
    data: { revokedAt: new Date() },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.agentAuthoringToken,
    entityId: token.id,
    action: auditActions.agentAuthoring.tokenRevoked,
    actorId: input.actorUserId,
    metadata: { tokenId: token.id },
  });
  return revoked;
}
