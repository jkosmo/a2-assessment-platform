import type {
  Prisma,
  ReviewStatus as ReviewStatusType,
  SubmissionStatus as SubmissionStatusType,
} from "@prisma/client";
import { prisma } from "../db/prisma.js";

type DecisionRepositoryClient = Pick<typeof prisma, "assessmentDecision" | "manualReview" | "submission">;

export function createDecisionRepository(client: DecisionRepositoryClient = prisma) {
  return {
    createAssessmentDecision(data: Prisma.AssessmentDecisionUncheckedCreateInput) {
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
