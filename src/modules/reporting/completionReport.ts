import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { reportingRepository } from "../../repositories/reportingRepository.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { normalizeFilters, round2 } from "./csvExport.js";
import type { ReportFilters } from "./types.js";

type CompletionRow = {
  moduleId: string;
  moduleTitle: string;
  totalSubmissions: number;
  completedSubmissions: number;
  underReviewSubmissions: number;
  completionRate: number;
};

type PassRatesRow = {
  moduleId: string;
  moduleTitle: string;
  totalSubmissions: number;
  decisionCount: number;
  passCount: number;
  failCount: number;
  underReviewCount: number;
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

export async function getCompletionReport(filters: ReportFilters) {
  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.statuses && filters.statuses.length > 0
      ? { submissionStatus: { in: asSubmissionStatuses(filters.statuses) } }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForCompletionReport(where);

  const rowsByModule = new Map<string, CompletionRow>();
  for (const submission of submissions) {
    const key = submission.module.id;
    const current = rowsByModule.get(key) ?? {
      moduleId: submission.module.id,
      moduleTitle: localizeContentText("en-GB", submission.module.title) ?? submission.module.title,
      totalSubmissions: 0,
      completedSubmissions: 0,
      underReviewSubmissions: 0,
      completionRate: 0,
    };
    current.totalSubmissions += 1;
    if (submission.submissionStatus === SubmissionStatus.COMPLETED) {
      current.completedSubmissions += 1;
    }
    if (submission.submissionStatus === SubmissionStatus.UNDER_REVIEW) {
      current.underReviewSubmissions += 1;
    }
    rowsByModule.set(key, current);
  }

  const rows = Array.from(rowsByModule.values()).map((row) => ({
    ...row,
    completionRate: row.totalSubmissions > 0 ? round2(row.completedSubmissions / row.totalSubmissions) : 0,
  }));

  const totals = {
    totalSubmissions: rows.reduce((sum, row) => sum + row.totalSubmissions, 0),
    completedSubmissions: rows.reduce((sum, row) => sum + row.completedSubmissions, 0),
    underReviewSubmissions: rows.reduce((sum, row) => sum + row.underReviewSubmissions, 0),
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

export async function getPassRatesReport(filters: ReportFilters) {
  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
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

  const submissions = await reportingRepository.findSubmissionsForPassRatesReport(where);

  const outcomeFilter = new Set((filters.statuses ?? []).map((value) => value.toUpperCase()));
  const rowsByModule = new Map<string, PassRatesRow>();
  for (const submission of submissions) {
    const latestDecision = submission.decisions[0];
    const outcome =
      submission.submissionStatus === SubmissionStatus.UNDER_REVIEW || !latestDecision
        ? "UNDER_REVIEW"
        : latestDecision.passFailTotal
          ? "PASS"
          : "FAIL";

    if (outcomeFilter.size > 0 && !outcomeFilter.has(outcome)) {
      continue;
    }

    const key = submission.module.id;
    const current = rowsByModule.get(key) ?? {
      moduleId: submission.module.id,
      moduleTitle: localizeContentText("en-GB", submission.module.title) ?? submission.module.title,
      totalSubmissions: 0,
      decisionCount: 0,
      passCount: 0,
      failCount: 0,
      underReviewCount: 0,
      passRate: null,
    };
    current.totalSubmissions += 1;
    if (outcome === "PASS") {
      current.passCount += 1;
      current.decisionCount += 1;
    } else if (outcome === "FAIL") {
      current.failCount += 1;
      current.decisionCount += 1;
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
  const where = {
    moduleId,
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

  const submissions = await reportingRepository.findSubmissionLearnersForModuleReport(where);
  const latestByUser = new Map<string, (typeof submissions)[number]>();

  for (const submission of submissions) {
    if (!latestByUser.has(submission.user.id)) {
      latestByUser.set(submission.user.id, submission);
    }
  }

  const rows: CompletionLearnerRow[] = Array.from(latestByUser.values()).map((submission) => {
    const latestDecision = submission.decisions[0] ?? null;
    return {
      participantId: submission.user.id,
      participantName: submission.user.name,
      participantEmail: submission.user.email,
      participantDepartment: submission.user.department,
      moduleId: submission.module.id,
      moduleTitle: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      status: deriveLearnerSubmissionStatus(submission.submissionStatus, latestDecision?.passFailTotal),
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
  if (passFailTotal === true) {
    return "PASSED";
  }
  if (passFailTotal === false) {
    return "FAILED";
  }
  if (submissionStatus === SubmissionStatus.UNDER_REVIEW) {
    return "UNDER_REVIEW";
  }
  return submissionStatus;
}
