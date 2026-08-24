import type { CertificationLifecycleStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

type CertificationRepositoryClient = Pick<typeof prisma, "certificationStatus">;

// #820: "passed a module" = any certification lifecycle state except NOT_CERTIFIED.
//
// #989: resertifisering er fjernet — bare ACTIVE og NOT_CERTIFIED skrives nå. Lista beholder likevel
// DUE_SOON/DUE/EXPIRED, og det er nettopp DET som gjør fjerningen konsekvensfri: eksisterende rader
// står med de verdiene (kolonnene er ikke migrert bort), og de talte som bestått før. Krymper du
// lista til ["ACTIVE"], mister historiske rader kursbeviset sitt — en bestått-avgjørelse endres, og
// det er akkurat det #989 ikke skal gjøre. Pinnet av
// `test/unit/course-certificate-gate-invariant.test.ts`.
export const CERTIFICATION_PASSED_STATUSES: CertificationLifecycleStatus[] = [
  "ACTIVE",
  "DUE_SOON",
  "DUE",
  "EXPIRED",
];

export function isCertificationPassed(status: CertificationLifecycleStatus | null | undefined): boolean {
  return status != null && (CERTIFICATION_PASSED_STATUSES as string[]).includes(status);
}

export function createCertificationRepository(client: CertificationRepositoryClient = prisma) {
  return {
    // #989: `expiryDate` og `recertificationDueDate` skrives ikke lenger. Kolonnene står igjen
    // (expand/contract, ingen destruktiv migrasjon nå) og beholder verdiene sine på gamle rader —
    // de sier hva regelen var da raden ble skrevet.
    upsertCertificationStatus(data: {
      userId: string;
      moduleId: string;
      latestDecisionId: string;
      status: "ACTIVE" | "NOT_CERTIFIED";
      passedAt: Date | null;
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
  };
}

export const certificationRepository = createCertificationRepository();
