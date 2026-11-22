import type { CertificationLifecycleStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { LearnerTx } from "../../db/contentLock.js";

type CertificationRepositoryClient = Pick<typeof prisma, "certificationStatus">;

// #820: "passed a module" = any certification lifecycle state except NOT_CERTIFIED.
//
// #989: resertifisering er fjernet — bare ACTIVE og NOT_CERTIFIED skrives nå. Lista beholder likevel
// DUE_SOON/DUE/EXPIRED, og det er nettopp DET som gjør fjerningen konsekvensfri: eksisterende rader
// står med de verdiene (kolonnene er ikke migrert bort), og de talte som bestått før. Krymper du
// lista til ["ACTIVE"], mister historiske rader kursbeviset sitt — en bestått-avgjørelse endres, og
// det er akkurat det #989 ikke skal gjøre.
//
// 2026-11-08: fremdrift i kurs og kursbevis leser ikke lenger denne statusen (#934 5a-3, regelen om beståtte per kurs). Lista
// brukes av tallet til den gamle publiseringsdialogen og statusrapporten per modul.
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

    /**
     * #997: hvem har bestått denne modulen akkurat nå? Tallet til den gamle publiseringsdialogen
     * (`GET …/passed-count` og `passedCount` i `pending-versions`). Klienten fra 2.136.0 bruker det bare
     * når de nye endepunktene svarer 404 eller 409. Varslene fra #997 sendes ikke lenger (2026-11-08).
     *
     * ⚠️ `CERTIFICATION_PASSED_STATUSES`, ikke bare ACTIVE: gamle rader står med DUE/EXPIRED og
     * telte som bestått før #989. De skal behandles likt her — ellers ville en revisjon latt dem
     * stå som bestått for alltid, som er nettopp hullet #997 handler om.
     */
    findPassedCertificationsForModule(moduleId: string) {
      return client.certificationStatus.findMany({
        where: { moduleId, status: { in: CERTIFICATION_PASSED_STATUSES } },
        select: {
          id: true,
          userId: true,
          user: { select: { email: true, name: true, preferredLocale: true } },
        },
      });
    },

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
