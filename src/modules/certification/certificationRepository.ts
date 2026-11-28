import { prisma } from "../../db/prisma.js";
import type { LearnerTx } from "../../db/contentLock.js";

type CertificationRepositoryClient = Pick<typeof prisma, "certificationStatus">;

// #1192 (QA 2.181.7): funksjonen og lista som sa «bestått» = enhver modulstatus utenom NOT_CERTIFIED, er fjernet. Ingen flate leser lenger bestått fra `CertificationStatus`: kurset og kursbeviset bruker
// `findModuleProgress`, modulrapportene, profilen og resertifiseringsrapporten `findModuleStanding` (moduleCredit.ts).
// Vakta i test/content-lock-write-guard.test.js gir rødt om navnene kommer tilbake.

export function createCertificationRepository(client: CertificationRepositoryClient = prisma) {
  return {
    // #989: `expiryDate` og `recertificationDueDate` skrives ikke lenger. Kolonnene står igjen
    // (expand/contract, ingen destruktiv migrasjon nå) og beholder verdiene sine på gamle rader —
    // de sier hva regelen var da raden ble skrevet.
    // #934 skive 5a-1: `locked` holder deltakerlåsen. Kursbeviset leser denne raden under samme lås.
    upsertCertificationStatus(locked: LearnerTx, data: {
      userId: string;
      moduleId: string;
      latestDecisionId: string;
      status: "ACTIVE" | "NOT_CERTIFIED";
      passedAt: Date | null;
    }) {
      return locked.certificationStatus.upsert({
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

    // #1192 punkt 1 (2026-11-24): `findPassedCertificationsForModule` er fjernet. Tallet til publiseringsdialogene
    // (`GET …/passed-count` og `passedCount` i `pending-versions`) leses nå fra `ModulePass` (`countCurrentModulePasses`).

    // #997: funksjonen som skrev `SUPERSEDED` er fjernet 2026-11-08: den kunne bare nås med bryteren for #934
    // 5a-3 av, og den har vært på i prod siden 2026-11-06. Gamle `SUPERSEDED`-rader står og leses av nummereringen av historikken.

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
