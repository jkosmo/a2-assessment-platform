// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2»): tilbakefyllingen. Regner alt ut på nytt fra historikken, og kan kjøres flere
// ganger. Før regelen er slått på, er alt den skriver bestemt av historikken, så en ny kjøring retter det en tidligere
// kjøring, eller gammel kode under utrullingen, gjorde feil. Etter at regelen er slått på, nekter den å kjøre: da er kravene
// forfatterens valg per kurs, og de kan ikke regnes ut.
//
// Korte låser: én transaksjon per modul under den eksklusive innholdslåsen (nummer og krav), og én per deltaker under
// deltakerlåsen (beståtte). Ingen av dem holder en lås gjennom hele kjøringen.
import type { CertificationLifecycleStatus, DecisionType, SubmissionStatus } from "@prisma/client";
import { runContentWrite, runLearnerWrite } from "../../db/contentLock.js";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/AppError.js";
import { backfillModuleVersionsAndRequirements, findLatestRevisionAtByModule } from "../adminContent/moduleVersioning.js";

/** Bryteren i 5a-3 (doc/DESIGN_934.md, «5a-3»). Den finnes ikke ennå, men er raden tilbakefyllingen må respektere. */
export const MODULE_PASS_SWITCH_KEY = "module_pass_per_course";

export type PassDecision = {
  id: string;
  moduleVersionId: string;
  passFailTotal: boolean;
  decisionType: DecisionType;
  finalisedAt: Date;
  createdAt: Date;
  parentDecisionId: string | null;
};

export type PassSubmission = {
  id: string;
  moduleId: string;
  submissionStatus: SubmissionStatus;
  hasManualReview: boolean;
  decisions: PassDecision[];
};

export type ModulePassRow = {
  submissionId: string;
  moduleId: string;
  decisionId: string;
  moduleVersionId: string;
  passedAt: Date;
  invalidatedAt: Date | null;
};

/** Det siste vedtaket på en innlevering: det ingen andre bygger på, og ellers det nyeste. */
export function latestDecisionOf<T extends PassDecision>(decisions: T[]): T | null {
  const parents = new Set(decisions.flatMap((d) => (d.parentDecisionId ? [d.parentDecisionId] : [])));
  const leaves = decisions.filter((d) => !parents.has(d.id));
  const candidates = leaves.length > 0 ? leaves : decisions;
  return (
    [...candidates].sort(
      (a, b) => b.finalisedAt.getTime() - a.finalisedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    )[0] ?? null
  );
}

// Et forlatt forsøk (#951) er ikke et utfall, og REJECTED er aldri bestått.
const NOT_AN_OUTCOME: ReadonlySet<SubmissionStatus> = new Set<SubmissionStatus>(["SUPERSEDED", "REJECTED"]);

/**
 * Beståttene for én deltaker, regnet ut fra vedtakene. Ren funksjon.
 *
 * Hvilke vedtak teller, speiler hvilke som faktisk gikk gjennom `upsertCertificationStatusFromDecision`:
 *   - Et AUTOMATISK vedtak på en innlevering som ble sendt til manuell vurdering, skrev aldri status. Et menneske har ikke
 *     sagt noe ennå, så det teller ikke, selv om det sier bestått. Sensorens vedtak kommer som et nytt vedtak over det.
 *   - Innleveringens status kan IKKE brukes alene: en åpen anke setter en bestått innlevering til `UNDER_REVIEW`, og
 *     beståtten står til anken er avgjort.
 *
 * Ugyldiggjort (#997-historikken, bevart eksplisitt og ikke utledet av rekkefølgen): vedtaket ble fattet før modulens siste
 * revisjon ifølge revisjonssporet, eller statusraden står fortsatt som `SUPERSEDED`. Det gjelder også når revisjonen pekte
 * på samme versjon som vedtaket. Det spiller ingen rolle om status viste bestått eller ikke da revisjonen kom: den reviderte
 * modulen for alle, og en som alt hadde mistet statusen, skal ikke få den tilbake ved å telle fra nå av.
 */
export function computeModulePasses(input: {
  submissions: PassSubmission[];
  statusByModule: ReadonlyMap<string, { status: CertificationLifecycleStatus; updatedAt: Date }>;
  latestRevisionAtByModule: ReadonlyMap<string, Date>;
}): ModulePassRow[] {
  const rows: ModulePassRow[] = [];
  for (const submission of input.submissions) {
    if (NOT_AN_OUTCOME.has(submission.submissionStatus)) continue;
    const latest = latestDecisionOf(submission.decisions);
    if (!latest || !latest.passFailTotal) continue;
    if (latest.decisionType === "AUTOMATIC" && submission.hasManualReview) continue;
    const revisionAt = input.latestRevisionAtByModule.get(submission.moduleId);
    const status = input.statusByModule.get(submission.moduleId);
    let invalidatedAt: Date | null = null;
    if (revisionAt && latest.finalisedAt < revisionAt) invalidatedAt = revisionAt;
    else if (status?.status === "SUPERSEDED") invalidatedAt = status.updatedAt;
    rows.push({
      submissionId: submission.id,
      moduleId: submission.moduleId,
      decisionId: latest.id,
      moduleVersionId: latest.moduleVersionId,
      passedAt: latest.finalisedAt,
      invalidatedAt,
    });
  }
  return rows;
}

/** Bygger beståttene for én deltaker på nytt. Radene slettes og lages igjen, i én transaksjon under deltakerlåsen. */
async function rebuildModulePassesForUser(userId: string, moduleIds: string[] | undefined) {
  return runLearnerWrite(
    userId,
    async (tx) => {
      const moduleFilter = moduleIds ? { moduleId: { in: moduleIds } } : {};
      const submissions = await tx.submission.findMany({
        where: { userId, ...moduleFilter, decisions: { some: {} } },
        select: {
          id: true,
          moduleId: true,
          submissionStatus: true,
          manualReviews: { select: { id: true }, take: 1 },
          decisions: {
            select: { id: true, moduleVersionId: true, passFailTotal: true, decisionType: true, finalisedAt: true, createdAt: true, parentDecisionId: true },
          },
        },
      });
      const statuses = await tx.certificationStatus.findMany({
        where: { userId, ...moduleFilter },
        select: { moduleId: true, status: true, updatedAt: true },
      });
      const rows = computeModulePasses({
        submissions: submissions.map(({ manualReviews, ...submission }) => ({ ...submission, hasManualReview: manualReviews.length > 0 })),
        statusByModule: new Map(statuses.map((row) => [row.moduleId, { status: row.status, updatedAt: row.updatedAt }])),
        latestRevisionAtByModule: await findLatestRevisionAtByModule(tx, [...new Set(submissions.map((s) => s.moduleId))]),
      });
      await tx.modulePass.deleteMany({ where: { userId, ...moduleFilter } });
      if (rows.length > 0) await tx.modulePass.createMany({ data: rows.map((row) => ({ ...row, userId })) });
      return { passes: rows.length, invalidated: rows.filter((row) => row.invalidatedAt !== null).length };
    },
    { timeout: 30_000 },
  );
}

export type ModuleCreditBackfillResult = {
  modules: number;
  versionsNumbered: number;
  requirements: number;
  users: number;
  passes: number;
  invalidated: number;
  /** Det som ikke ble gjort fordi noen holdt låsen. Kjør på nytt. */
  busy: { modules: string[]; users: string[] };
};

/**
 * Kjører tilbakefyllingen. `scope` er for testene, som deler database med andre: uten det gjelder den alle moduler og
 * deltakere. En modul eller deltaker som ikke får låsen, hoppes over og listes, og neste kjøring tar dem.
 */
export async function backfillModuleCredit(scope?: { moduleIds?: string[]; userIds?: string[] }): Promise<ModuleCreditBackfillResult> {
  const switchRow = await prisma.platformConfig.findUnique({ where: { key: MODULE_PASS_SWITCH_KEY }, select: { value: true } });
  if (switchRow?.value === "on") {
    throw new AppError("module_credit_backfill_refused", 409, "The per-course rule is switched on. The backfill would overwrite the authors' choices, so it does not run.");
  }

  const result: ModuleCreditBackfillResult = { modules: 0, versionsNumbered: 0, requirements: 0, users: 0, passes: 0, invalidated: 0, busy: { modules: [], users: [] } };

  const moduleIds = scope?.moduleIds ?? (await prisma.module.findMany({ select: { id: true } })).map((row) => row.id);
  for (const moduleId of moduleIds) {
    try {
      const done = await runContentWrite((tx) => backfillModuleVersionsAndRequirements(tx, moduleId));
      result.modules += 1;
      result.versionsNumbered += done.numbered;
      result.requirements += done.requirements;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "content_busy") throw error;
      result.busy.modules.push(moduleId);
    }
  }

  const userIds =
    scope?.userIds ??
    (await prisma.submission.findMany({
      where: { ...(scope?.moduleIds ? { moduleId: { in: scope.moduleIds } } : {}), decisions: { some: {} } },
      distinct: ["userId"],
      select: { userId: true },
    })).map((row) => row.userId);
  for (const userId of userIds) {
    try {
      const done = await rebuildModulePassesForUser(userId, scope?.moduleIds);
      result.users += 1;
      result.passes += done.passes;
      result.invalidated += done.invalidated;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "content_busy") throw error;
      result.busy.users.push(userId);
    }
  }
  return result;
}
