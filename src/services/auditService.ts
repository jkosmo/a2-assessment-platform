import { ForbiddenError } from "../errors/AppError.js";
import { auditRepository } from "../repositories/auditRepository.js";
import { sha256 } from "../utils/hash.js";
import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../db/prismaRuntime.js";
import { hasAnyRole, SUBMISSION_AUDIT_READERS } from "../auth/roleSets.js";
import { prisma } from "../db/prisma.js";
import { runInTransaction, type DbTransactionClient } from "../db/transaction.js";
import type { AuditAction, AuditEventInput } from "../observability/auditEvents.js";

// #804: fixed key for the transaction-scoped advisory lock that serializes audit-chain appends.
const AUDIT_CHAIN_LOCK_KEY = 8_040_804;

// Callers narrow their tx to `Pick<typeof prisma, "auditEvent" | …>` for encapsulation; at runtime it is
// always a full interactive TransactionClient (from prisma.$transaction), so the advisory lock reaches
// $executeRaw via a widening cast rather than forcing every caller type to expose it.
type AuditTxClient = Pick<typeof prisma, "auditEvent">;

type AuditHashInput = {
  prevHash: string | null;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  timestamp: Date;
  metadataJson: string;
};

/**
 * #804: the payload hash now covers the prior event's hash (chain link), the actor, and the timestamp,
 * so tampering with any of those — or reordering/removing a row — is detectable by `verifyAuditChain`.
 * Fields are pipe-joined; only the LAST field (metadataJson) can contain a pipe, so no earlier field
 * boundary is forgeable. Write, verify, and backfill all go through this one function to stay in sync.
 */
export function computeAuditHash(e: AuditHashInput): string {
  return sha256(
    [
      e.prevHash ?? "",
      e.entityType,
      e.entityId,
      e.action,
      e.actorId ?? "",
      e.timestamp.toISOString(),
      e.metadataJson,
    ].join("|"),
  );
}

type AuditChainWriteData = {
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  timestamp: Date;
  metadataJson: string;
  submissionId: string | null;
};

// Append one event to the tamper-evident chain. Serialized by a transaction-scoped advisory lock so
// concurrent writers can never branch the chain (two rows sharing a prevHash); the lock releases at the
// commit/rollback of the caller's (or our own) transaction, keeping audit atomic with the domain
// mutation (#803) while the chain stays linear.
async function appendToAuditChain(client: AuditTxClient, data: AuditChainWriteData) {
  await (client as DbTransactionClient).$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY}::bigint)`;
  const head = await client.auditEvent.findFirst({
    orderBy: { chainSeq: "desc" },
    select: { payloadHash: true },
  });
  const prevHash = head?.payloadHash ?? null;
  const payloadHash = computeAuditHash({ prevHash, ...data });
  return client.auditEvent.create({ data: { ...data, prevHash, payloadHash } });
}

export async function recordAuditEvent<TAction extends AuditAction>(
  input: AuditEventInput<TAction>,
  tx?: AuditTxClient,
) {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  // #804: app-set so the exact value is covered by the hash (the DB @default(now()) would not be known
  // to the hasher). #803: still written inside the caller's transaction when one is passed.
  const timestamp = new Date();

  // #797: denormalize the related submission id so the audit-trail read is an indexed lookup. Derived
  // centrally here (not per call site): the entity id when this event is about a submission, else a
  // submissionId carried in metadata. Not part of payloadHash — it's derived from already-hashed fields.
  const metadataSubmissionId = (input.metadata as { submissionId?: unknown } | undefined)?.submissionId;
  const submissionId =
    input.entityType === "submission"
      ? input.entityId
      : typeof metadataSubmissionId === "string"
        ? metadataSubmissionId
        : null;

  const data: AuditChainWriteData = {
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actorId ?? null,
    timestamp,
    metadataJson,
    submissionId,
  };

  if (tx) {
    await appendToAuditChain(tx, data);
  } else {
    await runInTransaction((client) => appendToAuditChain(client, data));
  }
}

export type AuditChainVerification =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenChainSeq: string; reason: "hash_mismatch" | "chain_break" };

/**
 * #804 verification path: walk the chain in order and confirm each row's payloadHash recomputes from its
 * stored content (incl. prevHash/actor/timestamp) AND links to the prior row's hash. Detects an edited
 * field, a reordered/removed row, or a forged actor/timestamp. Runs against the full table (assumes the
 * one-time backfill has re-sealed pre-#804 rows into the chain; see scripts/maintenance/backfill-audit-chain.ts).
 */
export async function verifyAuditChain(
  client: Pick<typeof prisma, "auditEvent"> = prisma,
): Promise<AuditChainVerification> {
  const events = await client.auditEvent.findMany({
    orderBy: { chainSeq: "asc" },
    select: {
      chainSeq: true,
      prevHash: true,
      payloadHash: true,
      entityType: true,
      entityId: true,
      action: true,
      actorId: true,
      timestamp: true,
      metadataJson: true,
    },
  });

  let previousHash: string | null = null;
  let chainStarted = false;
  let checked = 0;

  for (const event of events) {
    const expected = computeAuditHash({
      prevHash: event.prevHash,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actorId: event.actorId,
      timestamp: event.timestamp,
      metadataJson: event.metadataJson,
    });
    if (expected !== event.payloadHash) {
      return { ok: false, checked, brokenChainSeq: event.chainSeq.toString(), reason: "hash_mismatch" };
    }
    if (!chainStarted) {
      // The first (genesis) row must have no predecessor; a non-null prevHash means leading rows were removed.
      if (event.prevHash !== null) {
        return { ok: false, checked, brokenChainSeq: event.chainSeq.toString(), reason: "chain_break" };
      }
      chainStarted = true;
    } else if (event.prevHash !== previousHash) {
      return { ok: false, checked, brokenChainSeq: event.chainSeq.toString(), reason: "chain_break" };
    }
    previousHash = event.payloadHash;
    checked++;
  }

  return { ok: true, checked };
}

/**
 * #804 one-time backfill: re-seal ALL existing rows into the chained format (in chainSeq order),
 * recomputing prevHash + payloadHash so pre-#804 rows join the chain and `verifyAuditChain` passes over
 * the whole table. Idempotent (hashes are deterministic from content) and serialized by the same advisory
 * lock, so no concurrent append can interleave. One transaction — fine for this app's audit volume; a
 * much larger table would want batching. Run once per environment after deploy.
 */
export async function backfillAuditChain(): Promise<{ resealed: number }> {
  return runInTransaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY}::bigint)`;
      const rows = await tx.auditEvent.findMany({
        orderBy: { chainSeq: "asc" },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          action: true,
          actorId: true,
          timestamp: true,
          metadataJson: true,
        },
      });
      let prevHash: string | null = null;
      let resealed = 0;
      for (const row of rows) {
        const payloadHash = computeAuditHash({
          prevHash,
          entityType: row.entityType,
          entityId: row.entityId,
          action: row.action,
          actorId: row.actorId,
          timestamp: row.timestamp,
          metadataJson: row.metadataJson,
        });
        await tx.auditEvent.update({ where: { id: row.id }, data: { prevHash, payloadHash } });
        prevHash = payloadHash;
        resealed++;
      }
      return { resealed };
    },
    { timeout: 120_000 },
  );
}

// ⚠️ #962: settet bor nå i `src/auth/roleSets.ts` som `SUBMISSION_AUDIT_READERS` — UENDRET, fem
// roller som før.
//
// Flyttingen er hele poenget: der står det rett over `REPORT_READERS`, som er TO roller for samme
// datakategori i aggregert form. En SMO leser altså enhver deltakers fulle revisjonsspor med navn
// og e-post, men får 403 på rapporten. Den uenigheten var usynlig så lenge settet lå her.
//
// Om den BØR innskrenkes er en produktbeslutning, ikke en opprydding. Den står åpen i #962.
function hasAuditReadAccess(roles: AppRoleType[]) {
  return hasAnyRole(roles, SUBMISSION_AUDIT_READERS);
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
  const includeActorEmail = hasAuditReadAccess(input.roles);

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
            ...(includeActorEmail ? { email: event.actor.email } : {}),
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
