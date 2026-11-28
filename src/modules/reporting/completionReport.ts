import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { isSettledSubmission } from "../submission/submissionOutcome.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { reportingRepository } from "../../repositories/reportingRepository.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { normalizeFilters, round2 } from "./csvExport.js";
import type { ReportFilters } from "./types.js";
import { moduleIdClause } from "./scope.js";
import { prisma } from "../../db/prisma.js";
import { findModuleStanding, type ModuleLevelStanding, type ModuleStanding } from "../course/moduleCredit.js";

// ---------------------------------------------------------------------------
// #1192 punkt 1 (produkteier 2026-11-24): modulrapportene følger samme regel som kurset. En bestått står til modulen revideres,
// og et senere forsøk tar den ikke bort. Et pass bare på en eldre hovedversjon av modulen er IKKE bestått («Må ta ny versjon»),
// og et gammelt bestått-vedtak kan ikke gi det tilbake (planlesingen, Codex HØY 2). Ellers avgjør siste forsøk, som før.
// Datofilteret velger som før personer med en innlevering i perioden; utfallet er personens ståsted nå
// (doc/design/PLAN_1192_BESTATT_OG_FRIST.md, 1b). Med ett valgt kurs gjelder kursets krav.
// ---------------------------------------------------------------------------

/** Statusen for «må ta ny versjon», samme nøkkel som kursrapporten (`results.status.NEEDS_NEW_VERSION`). */
export const NEEDS_NEW_VERSION = "NEEDS_NEW_VERSION";

/** Ren funksjon: personens utfall på modulen, fra ståstedet (`ModulePass`) og det siste forsøket. */
export function personModuleOutcome(
  standing: ModuleStanding | null,
  submissionStatus: SubmissionStatusType,
  passFailTotal: boolean | null | undefined,
): string {
  if (standing === "PASSED") return "PASSED";
  const byAttempt = deriveLearnerSubmissionStatus(submissionStatus, passFailTotal);
  if (standing === "REVISED" && byAttempt === "PASSED") return NEEDS_NEW_VERSION;
  return byAttempt;
}

/** Ståstedet for personene og modulene i rapporten. */
async function standingsFor(filters: ReportFilters, rows: Array<{ userId: string; moduleId: string }>): Promise<ModuleLevelStanding> {
  return findModuleStanding(prisma, {
    moduleIds: [...new Set(rows.map((row) => row.moduleId))],
    userIds: [...new Set(rows.map((row) => row.userId))],
    courseId: filters.courseId,
  });
}

type CompletionRow = {
  moduleId: string;
  moduleTitle: string;
  /** Deltakere med minst ett forsøk (feltnavnet er beholdt for eksport og klient). */
  totalSubmissions: number;
  /** Deltakere der det siste forsøket er fullført. */
  completedSubmissions: number;
  /** Deltakere der det siste forsøket er til vurdering. */
  underReviewSubmissions: number;
  completionRate: number;
  /** Alle forsøk, også tidligere forsøk som er tatt på nytt. */
  attempts: number;
};

type PassRatesRow = {
  moduleId: string;
  moduleTitle: string;
  totalSubmissions: number;
  decisionCount: number;
  passCount: number;
  failCount: number;
  underReviewCount: number;
  /** #1192 punkt 1: bestått bare en eldre hovedversjon av modulen («Må ta ny versjon»). Ikke med i andelen. */
  revisedCount: number;
  passRate: number | null;
};

type CompletionLearnerRow = {
  participantId: string;
  participantName: string;
  participantEmail: string;
  participantDepartment: string | null;
  moduleId: string;
  moduleTitle: string;
  status: string;
  score: number | null;
  submittedAt: string;
  decidedAt: string | null;
};

export async function getCompletionReport(filters: ReportFilters, locale: SupportedLocale = "en-GB") {
  // #1058: valgt kurs og tillatte kurs (SMO ser egne) avgjør hvilke moduler som er med — ett sted.
  const scope = await moduleIdClause(filters);
  const where = {
    ...(scope ?? {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  } as const;

  const submissions = scope === null ? [] : await reportingRepository.findSubmissionsForCompletionReport(where);
  // Statusfilteret gjelder personens SISTE forsøk, ikke hvert forsøk — ellers ville en som strøk og
  // så besto, telt med under «ikke fullført» på det gamle forsøket.
  const statusFilter = filters.statuses && filters.statuses.length > 0 ? new Set<string>(asSubmissionStatuses(filters.statuses)) : null;

  // ⚠️ PER PERSON, ikke per forsøk (produkteier 2026-10-19). En deltaker som strøk og tok modulen
  // på nytt, ble telt to ganger — én gang som «ikke bestått» — selv om det siste forsøket besto.
  // Det siste forsøket er det som gjelder, som i deltakerdetaljene (getCompletionLearnerReport).
  //
  // Spørringen sorterer nyeste først per bruker, så det første forsøket vi ser per (modul, person) er
  // det siste. Forsøkene telles per person, så en person som er filtrert bort, heller ikke teller med
  // i forsøkene.
  const latestByPerson = new Map<string, { submission: (typeof submissions)[number]; attempts: number }>();
  for (const submission of submissions) {
    const personKey = `${submission.module.id}|${submission.userId}`;
    const seen = latestByPerson.get(personKey);
    if (seen) seen.attempts += 1;
    else latestByPerson.set(personKey, { submission, attempts: 1 });
  }

  // #1192 punkt 1: en gjeldende bestått er fullført, også når et senere forsøk er under vurdering; bare et pass på en eldre
  // hovedversjon er verken fullført eller under vurdering («Må ta ny versjon»).
  const standings = await standingsFor(filters, [...latestByPerson.values()].map(({ submission }) => ({ userId: submission.userId, moduleId: submission.module.id })));
  const rowsByModule = new Map<string, CompletionRow>();
  for (const { submission, attempts } of latestByPerson.values()) {
    const outcome = personModuleOutcome(
      standings.standing(submission.userId, submission.module.id),
      submission.submissionStatus,
      submission.decisions[0]?.passFailTotal,
    );
    const status: string =
      outcome === "PASSED" ? SubmissionStatus.COMPLETED : outcome === NEEDS_NEW_VERSION ? NEEDS_NEW_VERSION : submission.submissionStatus;
    if (statusFilter && !statusFilter.has(status)) continue;
    const key = submission.module.id;
    const current = rowsByModule.get(key) ?? {
      moduleId: submission.module.id,
      // #1027: leserens spraak, ikke engelsk.
      //
      // ⚠️ Sto som `localizeContentText("en-GB", …)`. En norsk rapportleser fikk engelske modultitler i
      // sin egen rapport — og for en modul som bare er oversatt til norsk, fikk hen den norske teksten
      // likevel, gjennom reservekjeden. Resultatet var en rapport der spraaket varierte med hva som
      // tilfeldigvis fantes.
      //
      // Detaljrapportene under tok allerede imot `locale`. Disse to var de eneste som ikke gjorde det.
      moduleTitle: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      totalSubmissions: 0,
      completedSubmissions: 0,
      underReviewSubmissions: 0,
      completionRate: 0,
      attempts: 0,
    };
    current.attempts += attempts;
    rowsByModule.set(key, current);
    current.totalSubmissions += 1;
    if (status === SubmissionStatus.COMPLETED) {
      current.completedSubmissions += 1;
    }
    if (status === SubmissionStatus.UNDER_REVIEW) {
      current.underReviewSubmissions += 1;
    }
  }

  const rows = Array.from(rowsByModule.values())
    .map((row) => ({
      ...row,
      completionRate: row.totalSubmissions > 0 ? round2(row.completedSubmissions / row.totalSubmissions) : 0,
    }))
    // Fast rekkefølge: spørringen sorterer på bruker (siste forsøk per person), og uten dette ville
    // radene byttet plass hver gang en ny deltaker leverte.
    .sort((a, b) => a.moduleTitle.localeCompare(b.moduleTitle, locale));

  const totals = {
    totalSubmissions: rows.reduce((sum, row) => sum + row.totalSubmissions, 0),
    completedSubmissions: rows.reduce((sum, row) => sum + row.completedSubmissions, 0),
    underReviewSubmissions: rows.reduce((sum, row) => sum + row.underReviewSubmissions, 0),
    attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
  };

  return {
    reportType: "completion",
    filters: normalizeFilters(filters),
    totals: {
      ...totals,
      completionRate: totals.totalSubmissions > 0 ? round2(totals.completedSubmissions / totals.totalSubmissions) : 0,
    },
    rows,
  };
}

export async function getPassRatesReport(filters: ReportFilters, locale: SupportedLocale = "en-GB") {
  const scope = await moduleIdClause(filters);
  const where = {
    ...(scope ?? {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  } as const;

  const submissions = scope === null ? [] : await reportingRepository.findSubmissionsForPassRatesReport(where);

  const outcomeFilter = new Set((filters.statuses ?? []).map((value) => value.toUpperCase()));
  // ⚠️ Per person — se getCompletionReport. Et strøket forsøk som er tatt på nytt og bestått, er ikke en «ikke bestått», og
  // (#1192 punkt 1) et senere stryk tar ikke bort en gjeldende bestått.
  const rowsByModule = new Map<string, PassRatesRow>();
  const latestPerPerson: Array<(typeof submissions)[number]> = [];
  const counted = new Set<string>();
  for (const submission of submissions) {
    const personKey = `${submission.module.id}|${submission.userId}`;
    if (counted.has(personKey)) continue;
    counted.add(personKey);
    latestPerPerson.push(submission);
  }
  const standings = await standingsFor(filters, latestPerPerson.map((s) => ({ userId: s.userId, moduleId: s.module.id })));
  for (const submission of latestPerPerson) {
    const latestDecision = submission.decisions[0];
    // ⚠️ Spør om STATUSEN er avgjort, ikke om det finnes et vedtak (#951): `deriveLearnerSubmissionStatus` gir en erstattet
    // innlevering sin egen status, ikke det gamle automatiske vedtaket den bærer.
    const personOutcome = personModuleOutcome(standings.standing(submission.userId, submission.module.id), submission.submissionStatus, latestDecision?.passFailTotal);
    const outcome =
      personOutcome === "PASSED" ? "PASS" : personOutcome === "FAILED" ? "FAIL" : personOutcome === NEEDS_NEW_VERSION ? "REVISED" : "UNDER_REVIEW";

    if (outcomeFilter.size > 0 && !outcomeFilter.has(outcome)) {
      continue;
    }

    const key = submission.module.id;
    const current = rowsByModule.get(key) ?? {
      moduleId: submission.module.id,
      // #1027: se kommentaren i getCompletionReport.
      moduleTitle: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      totalSubmissions: 0,
      decisionCount: 0,
      passCount: 0,
      failCount: 0,
      underReviewCount: 0,
      passRate: null,
      // Sist: CSV-kolonnene følger nøkkelrekkefølgen, og et regneark som leser etter posisjon skal ikke få flyttet «passRate».
      revisedCount: 0,
    };
    current.totalSubmissions += 1;
    if (outcome === "PASS") {
      current.passCount += 1;
      current.decisionCount += 1;
    } else if (outcome === "FAIL") {
      current.failCount += 1;
      current.decisionCount += 1;
    } else if (outcome === "REVISED") {
      // Bestått en eldre hovedversjon: verken bestått eller strøket, og ikke med i andelen.
      current.revisedCount += 1;
    } else {
      current.underReviewCount += 1;
    }
    rowsByModule.set(key, current);
  }

  const rows = Array.from(rowsByModule.values()).map((row) => ({
    ...row,
    passRate: row.decisionCount > 0 ? round2(row.passCount / row.decisionCount) : null,
  }));

  const totals = {
    totalSubmissions: rows.reduce((sum, row) => sum + row.totalSubmissions, 0),
    decisionCount: rows.reduce((sum, row) => sum + row.decisionCount, 0),
    passCount: rows.reduce((sum, row) => sum + row.passCount, 0),
    failCount: rows.reduce((sum, row) => sum + row.failCount, 0),
    underReviewCount: rows.reduce((sum, row) => sum + row.underReviewCount, 0),
    revisedCount: rows.reduce((sum, row) => sum + row.revisedCount, 0),
  };

  return {
    reportType: "pass-rates",
    filters: normalizeFilters(filters),
    totals: {
      ...totals,
      passRate: totals.decisionCount > 0 ? round2(totals.passCount / totals.decisionCount) : null,
    },
    rows,
  };
}

export async function getCompletionLearnerReport(
  filters: ReportFilters,
  moduleId: string,
  locale: SupportedLocale = "en-GB",
) {
  // #1058: modulen må ligge i et kurs kalleren kan se; ellers tom rapport (ikke 403).
  const scope = await moduleIdClause(filters, moduleId);
  const where = {
    ...(scope ?? { moduleId }),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  } as const;

  const submissions = scope === null ? [] : await reportingRepository.findSubmissionLearnersForModuleReport(where);
  const latestByUser = new Map<string, (typeof submissions)[number]>();

  for (const submission of submissions) {
    if (!latestByUser.has(submission.user.id)) {
      latestByUser.set(submission.user.id, submission);
    }
  }

  const standings = await standingsFor(filters, [...latestByUser.values()].map((s) => ({ userId: s.user.id, moduleId: s.module.id })));
  const rows: CompletionLearnerRow[] = Array.from(latestByUser.values()).map((submission) => {
    const latestDecision = submission.decisions[0] ?? null;
    return {
      participantId: submission.user.id,
      participantName: submission.user.name,
      participantEmail: submission.user.email,
      participantDepartment: submission.user.department,
      moduleId: submission.module.id,
      moduleTitle: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      status: personModuleOutcome(standings.standing(submission.user.id, submission.module.id), submission.submissionStatus, latestDecision?.passFailTotal),
      score: latestDecision?.totalScore ?? null,
      submittedAt: submission.submittedAt.toISOString(),
      decidedAt: latestDecision?.finalisedAt?.toISOString() ?? null,
    };
  });

  return {
    reportType: "completion-learners",
    filters: normalizeFilters(filters),
    selectedModuleId: moduleId,
    totals: {
      learners: rows.length,
      passed: rows.filter((row) => row.status === "PASSED").length,
      failed: rows.filter((row) => row.status === "FAILED").length,
      underReview: rows.filter((row) => row.status === "UNDER_REVIEW").length,
      needsNewVersion: rows.filter((row) => row.status === NEEDS_NEW_VERSION).length,
    },
    rows,
  };
}

// v1.2.24 (#358): learner-level eksport på tvers av moduler innen aktive filters. Skiller
// seg fra getCompletionLearnerReport ved at moduleId er optional — uten den returneres
// learners for alle matching modules. Én rad per (user, module) — latest submission per
// kombinasjon.
export async function getModuleLearnersReport(
  filters: ReportFilters,
  locale: SupportedLocale = "en-GB",
) {
  const scope = await moduleIdClause(filters);
  const where = {
    ...(scope ?? {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
  } as const;

  const submissions = scope === null ? [] : await reportingRepository.findSubmissionLearnersForModuleReport(where);
  const latestByUserModule = new Map<string, (typeof submissions)[number]>();

  for (const submission of submissions) {
    const key = `${submission.user.id}::${submission.moduleId}`;
    if (!latestByUserModule.has(key)) {
      latestByUserModule.set(key, submission);
    }
  }

  const standings = await standingsFor(filters, [...latestByUserModule.values()].map((s) => ({ userId: s.user.id, moduleId: s.module.id })));
  const rows: Array<CompletionLearnerRow & { scopeType: "module" }> = Array.from(latestByUserModule.values()).map((submission) => {
    const latestDecision = submission.decisions[0] ?? null;
    return {
      scopeType: "module",
      participantId: submission.user.id,
      participantName: submission.user.name,
      participantEmail: submission.user.email,
      participantDepartment: submission.user.department,
      moduleId: submission.module.id,
      moduleTitle: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      status: personModuleOutcome(standings.standing(submission.user.id, submission.module.id), submission.submissionStatus, latestDecision?.passFailTotal),
      score: latestDecision?.totalScore ?? null,
      submittedAt: submission.submittedAt.toISOString(),
      decidedAt: latestDecision?.finalisedAt?.toISOString() ?? null,
    };
  });

  return {
    reportType: "module-learners",
    filters: normalizeFilters(filters),
    totals: {
      learners: rows.length,
      passed: rows.filter((row) => row.status === "PASSED").length,
      failed: rows.filter((row) => row.status === "FAILED").length,
      underReview: rows.filter((row) => row.status === "UNDER_REVIEW").length,
      needsNewVersion: rows.filter((row) => row.status === NEEDS_NEW_VERSION).length,
    },
    rows,
  };
}

function asSubmissionStatuses(input?: string[]) {
  if (!input || input.length === 0) {
    return [];
  }
  const valid = new Set<string>(Object.values(SubmissionStatus));
  return input.filter((item) => valid.has(item)) as SubmissionStatusType[];
}

function deriveLearnerSubmissionStatus(
  submissionStatus: SubmissionStatusType,
  passFailTotal: boolean | null | undefined,
) {
  // ⚠️ #951: en ikke-avgjort innlevering skal vise sin egen tilstand, ikke arve et gammelt
  // vedtak. Sto det her `=== UNDER_REVIEW`, ville en SUPERSEDED innlevering med `passFailTotal:
  // true` blitt vist som «PASSED» — et bestått deltakeren aldri fikk.
  if (!isSettledSubmission(submissionStatus)) {
    return submissionStatus;
  }
  if (passFailTotal === true) {
    return "PASSED";
  }
  if (passFailTotal === false) {
    return "FAILED";
  }
  return submissionStatus;
}
