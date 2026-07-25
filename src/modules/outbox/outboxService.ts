import { prisma } from "../../db/prisma.js";
import type { DbTransactionClient } from "../../db/transaction.js";
import { notifyAssessmentResult } from "../certification/index.js";
import { checkAndIssueCourseCompletions } from "../course/index.js";
import type { SupportedLocale } from "../../i18n/locale.js";

// #795: a durable outbox for the post-decision side effects that used to be fire-and-forget. The decision
// path enqueues these rows (ideally in the same transaction as the decision), and the delivery worker
// leases pending rows and delivers them with bounded retries. The handlers are idempotent, so a
// re-delivery after a crash or lost lease is safe.

export const OUTBOX_EVENT_TYPES = {
  assessmentNotification: "assessment_notification",
  courseCompletionCheck: "course_completion_check",
} as const;

type AssessmentNotificationPayload = {
  submissionId: string;
  submittedAt: string; // ISO
  recipientEmail: string;
  recipientName: string;
  moduleTitle: string;
  moduleId: string;
  passFailTotal: boolean;
  locale: SupportedLocale;
};

type CourseCompletionCheckPayload = {
  userId: string;
  moduleId: string;
};

export type OutboxEnqueueInput =
  | { type: typeof OUTBOX_EVENT_TYPES.assessmentNotification; payload: AssessmentNotificationPayload }
  | { type: typeof OUTBOX_EVENT_TYPES.courseCompletionCheck; payload: CourseCompletionCheckPayload };

// Retry backoff: 30s, 60s, 120s, … capped at 15 min. Small enough that a transient failure recovers
// quickly, large enough that a persistently-failing handler doesn't hot-loop.
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 900_000;
function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_CAP_MS);
}

// #795: enqueue durable outbox rows. Accepts an optional tx client so the enqueue commits atomically with
// the domain write (e.g. the assessment decision) — a crash then either has both or neither.
export function enqueueOutboxEvents(events: OutboxEnqueueInput[], tx?: DbTransactionClient) {
  if (events.length === 0) return Promise.resolve({ count: 0 });
  const client = tx ?? prisma;
  return client.outboxEvent.createMany({
    data: events.map((e) => ({ type: e.type, payloadJson: JSON.stringify(e.payload) })),
  });
}

export type ClaimedOutboxEvent = {
  id: string;
  type: string;
  payloadJson: string;
  attempts: number;
  maxAttempts: number;
  lockedBy: string;
  lockedAt: Date;
};

// Lease the next due pending row. Fenced on `availableAt` (compare-and-set): two workers that select the
// same candidate can't both win. On claim we push `availableAt` out by the lease so the row isn't
// re-selected until the lease expires (a dead worker's row becomes claimable again then).
export async function claimNextOutboxEvent(
  workerId: string,
  now: Date,
  leaseMs: number,
): Promise<ClaimedOutboxEvent | null> {
  const candidate = await prisma.outboxEvent.findFirst({
    where: { status: "pending", availableAt: { lte: now } },
    orderBy: { availableAt: "asc" },
    select: { id: true, type: true, payloadJson: true, attempts: true, maxAttempts: true, availableAt: true },
  });
  if (!candidate) return null;

  const leaseUntil = new Date(now.getTime() + leaseMs);
  const res = await prisma.outboxEvent.updateMany({
    where: { id: candidate.id, status: "pending", availableAt: candidate.availableAt },
    data: { lockedBy: workerId, lockedAt: now, availableAt: leaseUntil },
  });
  if (res.count === 0) return null; // another worker claimed it first

  return {
    id: candidate.id,
    type: candidate.type,
    payloadJson: candidate.payloadJson,
    attempts: candidate.attempts,
    maxAttempts: candidate.maxAttempts,
    lockedBy: workerId,
    lockedAt: now,
  };
}

// Deliver one event by dispatching on its type. Both handlers are idempotent (completion checks whether
// the certificate already exists; the notification pipeline dedupes on its own audit trail).
export async function deliverOutboxEvent(event: { type: string; payloadJson: string }): Promise<void> {
  if (event.type === OUTBOX_EVENT_TYPES.assessmentNotification) {
    const p = JSON.parse(event.payloadJson) as AssessmentNotificationPayload;
    await notifyAssessmentResult({
      submissionId: p.submissionId,
      submittedAt: new Date(p.submittedAt),
      recipientEmail: p.recipientEmail,
      recipientName: p.recipientName,
      moduleTitle: p.moduleTitle,
      moduleId: p.moduleId,
      passFailTotal: p.passFailTotal,
      locale: p.locale,
    });
    return;
  }
  if (event.type === OUTBOX_EVENT_TYPES.courseCompletionCheck) {
    const p = JSON.parse(event.payloadJson) as CourseCompletionCheckPayload;
    await checkAndIssueCourseCompletions({ userId: p.userId, moduleId: p.moduleId });
    return;
  }
  throw new Error(`Unknown outbox event type: ${event.type}`);
}

// Fenced terminal writes: only the lease holder (lockedBy + lockedAt) may settle the row, so a row
// re-leased by another worker after a lost lease is never clobbered.
export function markOutboxDelivered(id: string, lockedBy: string, lockedAt: Date, deliveredAt: Date) {
  return prisma.outboxEvent.updateMany({
    where: { id, lockedBy, lockedAt },
    data: { status: "delivered", deliveredAt, lockedBy: null, lockedAt: null, lastError: null },
  });
}

export function markOutboxRetryOrFailed(
  id: string,
  lockedBy: string,
  lockedAt: Date,
  now: Date,
  attempts: number,
  maxAttempts: number,
  errorMessage: string,
) {
  const willRetry = attempts < maxAttempts;
  return prisma.outboxEvent.updateMany({
    where: { id, lockedBy, lockedAt },
    data: {
      attempts,
      status: willRetry ? "pending" : "failed",
      availableAt: willRetry ? new Date(now.getTime() + backoffMs(attempts)) : now,
      lockedBy: null,
      lockedAt: null,
      lastError: errorMessage.slice(0, 1000),
    },
  });
}

// Process at most one due event. Returns true if an event was handled (so a caller can loop until empty).
export async function processNextOutboxEvent(workerId: string, leaseMs: number): Promise<boolean> {
  const now = new Date();
  const claimed = await claimNextOutboxEvent(workerId, now, leaseMs);
  if (!claimed) return false;

  try {
    await deliverOutboxEvent(claimed);
    await markOutboxDelivered(claimed.id, claimed.lockedBy, claimed.lockedAt, new Date());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown outbox delivery error";
    await markOutboxRetryOrFailed(
      claimed.id,
      claimed.lockedBy,
      claimed.lockedAt,
      new Date(),
      claimed.attempts + 1,
      claimed.maxAttempts,
      message,
    );
  }
  return true;
}
