import type {
  DecisionType as DecisionTypeType,
  ReviewStatus as ReviewStatusType,
  SubmissionStatus as SubmissionStatusType,
} from "@prisma/client";
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
  // #950: koden for en maskinskrevet grunn, og tallene setningen trenger. Begge null når et
  // menneske skrev grunnen selv (sensor eller klagebehandler) — da vises teksten ordrett.
  decisionReasonCode?: string | null;
  decisionReasonParams?: string | null;
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

    updateSubmissionStatus(submissionId: string, submissionStatus: SubmissionStatusType) {
      return client.submission.update({
        where: { id: submissionId },
        data: { submissionStatus },
      });
    },
  };
}

export const decisionRepository = createDecisionRepository();
