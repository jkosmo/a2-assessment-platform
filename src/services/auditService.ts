import { ForbiddenError } from "../errors/AppError.js";
import { auditRepository } from "../repositories/auditRepository.js";
import { sha256 } from "../utils/hash.js";
import type { AppRole as AppRoleType } from "@prisma/client";
import { AppRole } from "../db/prismaRuntime.js";
import { hasAnyRole, SUBMISSION_AUDIT_READERS } from "../auth/roleSets.js";
import { auditActions, auditEntityTypes } from "../observability/auditEvents.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { operationalEvents } from "../observability/operationalEvents.js";
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

  // #1000: hvem leste dette sporet, og knyttet noe FORHOLD dem til innleveringen?
  //
  // ⚠️ Sporet bærer navn og e-post til både kandidaten og alle som har behandlet saken. At noen
  // leser det skal kunne etterprøves — og det kunne det ikke før nå.
  //
  // Fem roller kan lese ALT, men to av dem er begrunnet med et forhold («mine kandidater», «mine
  // mentees») som datamodellen ikke har. `roleOnly` teller nettopp de lesingene som hvilte på
  // rollen alene. Uten de tallene ville enhver innstramming vært en gjetning — og en innstramming
  // mot en relasjon som ikke finnes, gir null tilgang til alle.
  //
  // ⚠️ Loggingen får ALDRI velte lesingen. Den er et sidespor, ikke en del av svaret.
  const isOwnSubmission = submission.userId === input.requestorUserId;
  try {
    const relations = isOwnSubmission
      ? { isAssignedReviewer: false, isAssignedAppealHandler: false, ownsModuleContent: false }
      : await auditRepository.findReaderRelations({
          submissionId: submission.id,
          moduleId: submission.moduleId,
          readerUserId: input.requestorUserId,
        });

    await recordAuditEvent({
      entityType: auditEntityTypes.submissionAuditAccess,
      entityId: submission.id,
      action: auditActions.audit.submissionTrailRead,
      actorId: input.requestorUserId,
      metadata: {
        // ⚠️ `subjectSubmissionId`, ikke `submissionId` — den nøkkelen ville lagt denne hendelsen
        // inn i deltakerens eget spor, og skapt lesinger-av-lesinger.
        subjectSubmissionId: submission.id,
        readerRoles: input.roles,
        isOwnSubmission,
        ...relations,
        roleOnly:
          !isOwnSubmission
          && !relations.isAssignedReviewer
          && !relations.isAssignedAppealHandler
          && !relations.ownsModuleContent,
      },
    });
  } catch (error) {
    // Lesingen fortsetter. En manglende tilgangslogg er et hull i sporbarheten, ikke en grunn til
    // å nekte en lærer å se en sak.
    //
    // ⚠️ Men den skal ikke forsvinne i STILLHET. QA-porten: under backfill eller PII-skrubbing
    // holdes kjedelåsen i opptil 120 s, og skrivingen her feiler på Prismas 5 s tidsavbrudd. Uten
    // denne linja ville tilgangsloggen fått hull ingen visste om — og et hull i en tilgangslogg er
    // nettopp det man ikke oppdager før noen spør hvem som har lest hva.
    logOperationalEvent(
      operationalEvents.audit.trailAccessLogFailed,
      {
        subjectSubmissionId: submission.id,
        readerUserId: input.requestorUserId,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
  }

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
