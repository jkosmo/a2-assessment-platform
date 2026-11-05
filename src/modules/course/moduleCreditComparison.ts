// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2»): sammenligningsrapporten. Regner ut gammel og ny regel side om side for alle
// deltakere og kurs, og lister forskjellene med årsak. Den leser bare. Rapporten er beviset for at bryteren i 5a-3 kan
// slås på: to årsaker er forventet, og alle andre er feil.
import type { CertificationLifecycleStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { findLatestRevisionAtByModule } from "../adminContent/moduleVersioning.js";
import { isCertificationPassed } from "../certification/certificationRepository.js";
import { findCreditedModules } from "./moduleCredit.js";
import { latestDecisionOf, type PassDecision } from "./moduleCreditBackfill.js";

export type CreditDifferenceReason =
  // Forventet: et nytt forsøk strøk etter en bestått (svar f). Gammel regel: ikke bestått. Ny: bestått.
  | "retake_failed_after_pass"
  // Forventet: en innlevering på en gammel versjon ble vurdert etter en #997-revisjon («Kjente mangler» nr. 30).
  | "pass_on_old_version_after_revision"
  // Ikke forventet. En anke eller overprøving snudde en bestått til stryk på samme innlevering, og gammel regel lar
  // statusen stå (`existing.passedAt > submittedAt` i `upsertCertificationStatusFromDecision`). Se «Kjente mangler» nr. 41.
  | "overturned_pass_kept_by_old_rule"
  // Feil: en bestått #997 tok bort, teller igjen.
  | "superseded_pass_counts_again"
  // Feil: raden er ugyldiggjort, men statusen sier bestått.
  | "invalidated_but_old_rule_counts"
  // Feil, eller tilbakefyllingen er ikke kjørt.
  | "missing_requirement"
  | "pass_on_unnumbered_version"
  | "unexplained";

export const EXPECTED_REASONS: ReadonlySet<CreditDifferenceReason> = new Set<CreditDifferenceReason>([
  "retake_failed_after_pass",
  "pass_on_old_version_after_revision",
]);

export type CreditFacts = {
  oldCredit: boolean;
  status: CertificationLifecycleStatus | null;
  requirement: number | undefined;
  latestRevisionAt: Date | undefined;
  /** Siste vedtak statusraden peker på, strøk, og er på en annen innlevering enn den beståtte. */
  latestDecisionFailedOnOtherSubmission: boolean;
  /** Innleveringen statusraden peker på, har et senere stryk. */
  overturnedOnSameSubmission: boolean;
  passes: Array<{ versionMajor: number | null; invalidatedAt: Date | null; passedAt: Date }>;
};

/** Hvorfor er gammel og ny regel uenige? Ren funksjon. Kalles bare når de er det. */
export function classifyCreditDifference(facts: CreditFacts): CreditDifferenceReason {
  const { requirement, latestRevisionAt } = facts;
  if (facts.oldCredit) {
    if (requirement === undefined) return "missing_requirement";
    if (facts.overturnedOnSameSubmission) return "overturned_pass_kept_by_old_rule";
    const valid = facts.passes.filter((pass) => pass.invalidatedAt === null);
    if (valid.some((pass) => pass.versionMajor === null)) return "pass_on_unnumbered_version";
    const onOldVersionAfterRevision = valid.some(
      (pass) => pass.versionMajor !== null && pass.versionMajor < requirement && latestRevisionAt !== undefined && pass.passedAt > latestRevisionAt,
    );
    if (onOldVersionAfterRevision) return "pass_on_old_version_after_revision";
    if (facts.passes.some((pass) => pass.invalidatedAt !== null)) return "invalidated_but_old_rule_counts";
    return "unexplained";
  }
  if (facts.status === "SUPERSEDED") return "superseded_pass_counts_again";
  if (facts.status === "NOT_CERTIFIED" && facts.latestDecisionFailedOnOtherSubmission) return "retake_failed_after_pass";
  return "unexplained";
}

export type CreditDifference = {
  userId: string;
  courseId: string;
  moduleId: string;
  oldCredit: boolean;
  newCredit: boolean;
  status: CertificationLifecycleStatus | null;
  requirement: number | null;
  reason: CreditDifferenceReason;
  expected: boolean;
};

export type ModuleCreditReport = {
  /** Hvor mange (deltaker, kurs, modul) som ble sammenlignet. */
  compared: number;
  differences: CreditDifference[];
  byReason: Partial<Record<CreditDifferenceReason, number>>;
  /** Forskjeller som ikke er forventet. Skal være 0 før bryteren slås på. */
  unexplained: number;
  /** Det som mangler i dataene, uavhengig av deltakerne. Skal være tomt etter tilbakefyllingen. */
  structure: {
    unnumberedLiveVersions: string[];
    missingRequirements: Array<{ courseId: string; moduleId: string }>;
    orphanRequirements: Array<{ courseId: string; moduleId: string }>;
    requirementsNotAtCurrentMajor: Array<{ courseId: string; moduleId: string; minModuleMajor: number; currentMajor: number }>;
    /**
     * Den aktive versjonen er lavere enn kravet: gammel kode kunne aktivere en eldre versjon på nytt etter en revisjon. Med den
     * nye regelen kan ingen bestå modulen slik at det teller, før forfatteren publiserer en ny versjon («Kjente mangler» nr. 45).
     */
    activeVersionBelowRequirement: Array<{ courseId: string; moduleId: string; activeMajor: number; minModuleMajor: number }>;
  };
  ok: boolean;
};

const key = (...parts: string[]) => parts.join("\n");

/** `scope` er for testene, som deler database med andre. Uten det gjelder rapporten alt. */
export async function compareModuleCredit(scope?: { moduleIds?: string[]; userIds?: string[] }): Promise<ModuleCreditReport> {
  const moduleFilter = scope?.moduleIds ? { in: scope.moduleIds } : undefined;
  const userFilter = scope?.userIds ? { in: scope.userIds } : undefined;

  const items = await prisma.courseItem.findMany({
    where: { itemType: "MODULE", moduleId: moduleFilter ?? { not: null } },
    select: { courseId: true, moduleId: true },
  });
  const courseModules = items.flatMap((item) => (item.moduleId ? [{ courseId: item.courseId, moduleId: item.moduleId }] : []));
  const moduleIds = [...new Set(courseModules.map((item) => item.moduleId))];
  const courseIds = [...new Set(courseModules.map((item) => item.courseId))];

  const [statuses, passes, requirements, versions, latestRevisionAtByModule] = await Promise.all([
    prisma.certificationStatus.findMany({
      where: { moduleId: { in: moduleIds }, ...(userFilter ? { userId: userFilter } : {}) },
      select: { userId: true, moduleId: true, status: true, latestDecision: { select: { passFailTotal: true, submissionId: true } } },
    }),
    prisma.modulePass.findMany({
      where: { moduleId: { in: moduleIds }, ...(userFilter ? { userId: userFilter } : {}) },
      select: { userId: true, moduleId: true, submissionId: true, passedAt: true, invalidatedAt: true, moduleVersion: { select: { versionMajor: true } } },
    }),
    prisma.courseModuleRequirement.findMany({
      where: moduleFilter ? { moduleId: moduleFilter } : {},
      select: { courseId: true, moduleId: true, minModuleMajor: true },
    }),
    prisma.moduleVersion.findMany({
      where: moduleFilter ? { moduleId: moduleFilter } : {},
      select: { id: true, moduleId: true, versionMajor: true, publishedAt: true, activeForModules: { select: { id: true } }, _count: { select: { submissions: true } } },
    }),
    findLatestRevisionAtByModule(prisma, moduleIds),
  ]);

  const usersByModule = new Map<string, Set<string>>();
  const addUser = (moduleId: string, userId: string) => {
    const users = usersByModule.get(moduleId);
    if (users) users.add(userId);
    else usersByModule.set(moduleId, new Set([userId]));
  };
  for (const row of statuses) addUser(row.moduleId, row.userId);
  for (const row of passes) addUser(row.moduleId, row.userId);

  const statusOf = new Map(statuses.map((row) => [key(row.userId, row.moduleId), row]));
  const passesOf = new Map<string, typeof passes>();
  for (const pass of passes) {
    const k = key(pass.userId, pass.moduleId);
    const list = passesOf.get(k);
    if (list) list.push(pass);
    else passesOf.set(k, [pass]);
  }
  const requirementOf = new Map(requirements.map((row) => [key(row.courseId, row.moduleId), row.minModuleMajor]));

  // Samme funksjon som 5a-3 skal bruke. Hadde rapporten regnet den nye regelen selv, ville den målt en annen regel.
  const allUserIds = [...new Set([...statuses.map((row) => row.userId), ...passes.map((row) => row.userId)])];
  const credited = new Set(
    (await findCreditedModules(prisma, { userIds: allUserIds, courseIds })).map((row) => key(row.userId, row.courseId, row.moduleId)),
  );

  // Var det en anke eller overprøving som snudde en bestått, står statusraden urørt og peker på det beståtte vedtaket.
  const pointedAt = statuses.filter((row) => row.latestDecision.passFailTotal).map((row) => row.latestDecision.submissionId);
  const decisionsOnPointedAt = pointedAt.length === 0 ? [] : await prisma.assessmentDecision.findMany({
    where: { submissionId: { in: pointedAt } },
    select: { id: true, submissionId: true, moduleVersionId: true, passFailTotal: true, decisionType: true, finalisedAt: true, createdAt: true, parentDecisionId: true },
  });
  const decisionsBySubmission = new Map<string, PassDecision[]>();
  for (const decision of decisionsOnPointedAt) {
    const list = decisionsBySubmission.get(decision.submissionId);
    if (list) list.push(decision);
    else decisionsBySubmission.set(decision.submissionId, [decision]);
  }

  const differences: CreditDifference[] = [];
  let compared = 0;
  for (const { courseId, moduleId } of courseModules) {
    for (const userId of usersByModule.get(moduleId) ?? []) {
      compared += 1;
      const status = statusOf.get(key(userId, moduleId));
      const oldCredit = isCertificationPassed(status?.status);
      const newCredit = credited.has(key(userId, courseId, moduleId));
      if (oldCredit === newCredit) continue;
      const own = passesOf.get(key(userId, moduleId)) ?? [];
      const requirement = requirementOf.get(key(courseId, moduleId));
      const latestOnPointedAt = status ? latestDecisionOf(decisionsBySubmission.get(status.latestDecision.submissionId) ?? []) : null;
      const reason = classifyCreditDifference({
        oldCredit,
        status: status?.status ?? null,
        requirement,
        latestRevisionAt: latestRevisionAtByModule.get(moduleId),
        latestDecisionFailedOnOtherSubmission:
          status !== undefined && !status.latestDecision.passFailTotal && !own.some((pass) => pass.submissionId === status.latestDecision.submissionId),
        overturnedOnSameSubmission: latestOnPointedAt !== null && !latestOnPointedAt.passFailTotal,
        passes: own.map((pass) => ({ versionMajor: pass.moduleVersion.versionMajor, invalidatedAt: pass.invalidatedAt, passedAt: pass.passedAt })),
      });
      differences.push({
        userId,
        courseId,
        moduleId,
        oldCredit,
        newCredit,
        status: status?.status ?? null,
        requirement: requirement ?? null,
        reason,
        expected: EXPECTED_REASONS.has(reason),
      });
    }
  }

  const byReason: ModuleCreditReport["byReason"] = {};
  for (const difference of differences) byReason[difference.reason] = (byReason[difference.reason] ?? 0) + 1;
  const unexplained = differences.filter((difference) => !difference.expected).length;

  const currentMajor = new Map<string, number>();
  for (const version of versions) {
    if (version.versionMajor !== null && version.versionMajor > (currentMajor.get(version.moduleId) ?? 0)) currentMajor.set(version.moduleId, version.versionMajor);
  }
  const activeMajor = new Map(
    versions.flatMap((version) => (version.activeForModules.length > 0 && version.versionMajor !== null ? [[version.moduleId, version.versionMajor] as const] : [])),
  );
  const itemKeys = new Set(courseModules.map((item) => key(item.courseId, item.moduleId)));
  const structure: ModuleCreditReport["structure"] = {
    unnumberedLiveVersions: versions
      .filter((version) => version.versionMajor === null && (version.publishedAt !== null || version.activeForModules.length > 0 || version._count.submissions > 0))
      .map((version) => version.id),
    missingRequirements: courseModules.filter((item) => !requirementOf.has(key(item.courseId, item.moduleId))),
    orphanRequirements: requirements
      .filter((row) => !itemKeys.has(key(row.courseId, row.moduleId)))
      .map((row) => ({ courseId: row.courseId, moduleId: row.moduleId })),
    requirementsNotAtCurrentMajor: requirements.flatMap((row) => {
      const current = currentMajor.get(row.moduleId) ?? 1;
      return row.minModuleMajor === current ? [] : [{ courseId: row.courseId, moduleId: row.moduleId, minModuleMajor: row.minModuleMajor, currentMajor: current }];
    }),
    activeVersionBelowRequirement: requirements.flatMap((row) => {
      const active = activeMajor.get(row.moduleId);
      return active !== undefined && active < row.minModuleMajor
        ? [{ courseId: row.courseId, moduleId: row.moduleId, activeMajor: active, minModuleMajor: row.minModuleMajor }]
        : [];
    }),
  };

  const structureClean = Object.values(structure).every((list) => list.length === 0);
  return { compared, differences, byReason, unexplained, structure, ok: unexplained === 0 && structureClean };
}
