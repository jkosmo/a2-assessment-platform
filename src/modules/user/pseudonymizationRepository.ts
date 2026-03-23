import type { DeletionTrigger as DeletionTriggerType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

type PseudonymizationRepositoryClient = Pick<
  typeof prisma,
  "user" | "deletionRequest" | "assessmentJob"
>;

export function createPseudonymizationRepository(client: PseudonymizationRepositoryClient = prisma) {
  return {
    findUserAnonymizationState(userId: string) {
      return client.user.findUnique({
        where: { id: userId },
        select: { isAnonymized: true },
      });
    },

    cancelAssessmentJobsForUser(userId: string) {
      return client.assessmentJob.updateMany({
        where: { submission: { userId }, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "FAILED", errorMessage: "Cancelled: user pseudonymisation." },
      });
    },

    pseudonymizeUser(userId: string, email: string, anonymizedAt: Date) {
      return client.user.update({
        where: { id: userId },
        data: {
          name: "Pseudonymisert bruker",
          email,
          department: null,
          manager: null,
          isAnonymized: true,
          anonymizedAt,
          activeStatus: false,
        },
      });
    },

    completeDeletionRequest(requestId: string, anonymizedAt: Date) {
      return client.deletionRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", anonymizedAt },
      });
    },

    completePendingDeletionRequestsForUser(userId: string, anonymizedAt: Date) {
      return client.deletionRequest.updateMany({
        where: { userId, status: "PENDING" },
        data: { status: "COMPLETED", anonymizedAt },
      });
    },

    findPendingDeletionRequestForUser(userId: string) {
      return client.deletionRequest.findFirst({
        where: { userId, status: "PENDING" },
        select: { id: true },
      });
    },

    createDeletionRequest(data: {
      userId: string;
      trigger: DeletionTriggerType;
      effectiveAt: Date | null;
    }) {
      return client.deletionRequest.create({ data });
    },

    findCancellableUserDeletionRequest(userId: string, trigger: DeletionTriggerType) {
      return client.deletionRequest.findFirst({
        where: { userId, status: "PENDING", trigger },
        select: { id: true },
      });
    },

    cancelDeletionRequest(requestId: string, cancelledAt: Date) {
      return client.deletionRequest.update({
        where: { id: requestId },
        data: { status: "CANCELLED", cancelledAt },
      });
    },
  };
}

export const pseudonymizationRepository = createPseudonymizationRepository();
