import type { DecisionType as DecisionTypeType } from "@prisma/client";
import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { createDecisionRepository } from "../../repositories/decisionRepository.js";
import { upsertRecertificationStatusFromDecision } from "../certification/index.js";
import { recordAuditEvent } from "../../services/auditService.js";
import type { DbTransactionClient } from "../../db/transaction.js";

type LineageTxClient = Pick<
  DbTransactionClient,
  "assessmentDecision" | "manualReview" | "submission" | "certificationStatus" | "auditEvent"
>;

export type ParentDecisionSnapshot = {
  id: string;
  submissionId: string;
  moduleVersionId: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqScaledScore: number;
  practicalScaledScore: number;
  totalScore: number;
  redFlagsJson: string;
};

/**
 * Appends a new immutable decision that inherits all scoring fields from
 * `parentDecision`, sets `parentDecisionId` to establish the lineage chain,
 * advances the submission to COMPLETED, updates certification status, and
 * writes the decision audit event.
 *
 * Must be called inside a Prisma transaction. Workflow-specific side-effects
 * (resolving the review/appeal, workflow audit events, notifications) remain
 * the caller's responsibility.
 */
export async function appendDecisionWithLineage(
  input: {
    parentDecision: ParentDecisionSnapshot;
    passFailTotal: boolean;
    decisionType: DecisionTypeType;
    decisionReason: string;
    finalisedAt: Date;
    finalisedById: string;
    actorId: string;
    auditAction: string;
    auditMetadata: Record<string, unknown>;
  },
  tx: LineageTxClient,
) {
  const repo = createDecisionRepository(tx);

  const decision = await repo.createAssessmentDecision({
    submissionId: input.parentDecision.submissionId,
    moduleVersionId: input.parentDecision.moduleVersionId,
    rubricVersionId: input.parentDecision.rubricVersionId,
    promptTemplateVersionId: input.parentDecision.promptTemplateVersionId,
    mcqScaledScore: input.parentDecision.mcqScaledScore,
    practicalScaledScore: input.parentDecision.practicalScaledScore,
    totalScore: input.parentDecision.totalScore,
    redFlagsJson: input.parentDecision.redFlagsJson,
    passFailTotal: input.passFailTotal,
    decisionType: input.decisionType,
    decisionReason: input.decisionReason,
    finalisedAt: input.finalisedAt,
    finalisedById: input.finalisedById,
    parentDecisionId: input.parentDecision.id,
  });

  await repo.updateSubmissionStatus(input.parentDecision.submissionId, SubmissionStatus.COMPLETED);

  await upsertRecertificationStatusFromDecision(
    { decisionId: decision.id, actorId: input.actorId },
    tx,
  );

  await recordAuditEvent(
    {
      entityType: "assessment_decision",
      entityId: decision.id,
      action: input.auditAction,
      actorId: input.actorId,
      metadata: input.auditMetadata,
    },
    tx,
  );

  return decision;
}
