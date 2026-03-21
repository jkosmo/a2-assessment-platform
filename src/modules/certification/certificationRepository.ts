import { prisma } from "../../db/prisma.js";

type CertificationRepositoryClient = Pick<typeof prisma, "certificationStatus">;

export function createCertificationRepository(client: CertificationRepositoryClient = prisma) {
  return {
    upsertCertificationStatus(data: {
      userId: string;
      moduleId: string;
      latestDecisionId: string;
      status: "ACTIVE" | "DUE_SOON" | "DUE" | "EXPIRED" | "NOT_CERTIFIED";
      passedAt: Date | null;
      expiryDate: Date | null;
      recertificationDueDate: Date | null;
    }) {
      return client.certificationStatus.upsert({
        where: {
          userId_moduleId: {
            userId: data.userId,
            moduleId: data.moduleId,
          },
        },
        update: {
          latestDecisionId: data.latestDecisionId,
          status: data.status,
          passedAt: data.passedAt,
          expiryDate: data.expiryDate,
          recertificationDueDate: data.recertificationDueDate,
        },
        create: data,
      });
    },

    findByUserAndModule(userId: string, moduleId: string) {
      return client.certificationStatus.findUnique({
        where: {
          userId_moduleId: { userId, moduleId },
        },
      });
    },

    findCertificationsForReminderSchedule() {
      return client.certificationStatus.findMany({
        where: {
          expiryDate: { not: null },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
    },
  };
}

export const certificationRepository = createCertificationRepository();
