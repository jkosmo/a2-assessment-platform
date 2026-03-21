import type {
  DecisionType as DecisionTypeType,
  ReviewStatus as ReviewStatusType,
  SubmissionStatus as SubmissionStatusType,
} from "@prisma/client";
import { prisma } from "../db/prisma.js";

export type CreateAssessmentDecisionInput = {
  submissionId: string;
  moduleVersionId: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqScaledScore: number;
  practicalScaledScore: number;
  totalScore: number;
  redFlagsJson: string;
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
