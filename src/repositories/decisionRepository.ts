import type {
  DecisionType as DecisionTypeType,
  ReviewStatus as ReviewStatusType,
  SubmissionStatus as SubmissionStatusType,
} from "@prisma/client";
import { ReviewStatus, SubmissionStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";

export type CreateAssessmentDecisionInput = {
  submissionId: string;
  moduleVersionId: string;
  // null for MCQ_ONLY decisions (no rubric/prompt-based LLM evaluation) — #525.
  rubricVersionId: string | null;
  promptTemplateVersionId: string | null;
  mcqScaledScore: number;
  practicalScaledScore: number;
  totalScore: number;
  redFlagsJson: string;
  // #475 Phase 2: computed AI-influence signals JSON (declaration + content-similarity). Nullable;
  // review-signal-only, never affects pass/fail.
  aiInfluenceJson?: string | null;
  passFailTotal: boolean;
  decisionType: DecisionTypeType;
  decisionReason: string;
  finalisedById?: string;
  finalisedAt?: Date;
  parentDecisionId?: string;
};

type DecisionRepositoryClient = Pick<typeof prisma, "assessmentDecision" | "manualReview" | "submission">;

export function createDecisionRepository(client: DecisionRepositoryClient = prisma) {
  return {
    findDecisionWithSubmissionIdentifiers(decisionId: string) {
      return client.assessmentDecision.findUnique({
        where: { id: decisionId },
        include: {
          submission: {
            select: {
              userId: true,
              moduleId: true,
              submittedAt: true,
            },
          },
        },
      });
    },

    createAssessmentDecision(data: CreateAssessmentDecisionInput) {
      return client.assessmentDecision.create({ data });
    },

    createManualReview(data: {
      submissionId: string;
      triggerReason: string;
      reviewStatus: ReviewStatusType;
    }) {
      return client.manualReview.create({ data });
    },

    /** #953: brukes til å unngå to køsaker for samme innlevering når en jobb feiler endelig. */
    findOpenManualReviewForSubmission(submissionId: string) {
      return client.manualReview.findFirst({
        where: { submissionId, reviewStatus: ReviewStatus.OPEN },
        select: { id: true },
      });
    },

    /**
     * #953: slipper en innlevering tilbake fra PROCESSING slik at kandidaten kan forsøke igjen.
     *
     * ⚠️ Betinget med vilje. Er vedtaket allerede lagret og feilen kom i en sideeffekt etterpå,
     * ville en ubetinget skriving overskrevet et gyldig COMPLETED.
     */
    releaseProcessingSubmission(submissionId: string) {
      return client.submission.updateMany({
        where: { id: submissionId, submissionStatus: SubmissionStatus.PROCESSING },
        data: { submissionStatus: SubmissionStatus.SUBMITTED },
      });
    },

    updateSubmissionStatus(submissionId: string, submissionStatus: SubmissionStatusType) {
      return client.submission.update({
        where: { id: submissionId },
        data: { submissionStatus },
      });
    },
  };
}

export const decisionRepository = createDecisionRepository();
