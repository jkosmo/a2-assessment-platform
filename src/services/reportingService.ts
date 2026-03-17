import { ReviewStatus, AppealStatus, SubmissionStatus } from "../db/prismaRuntime.js";
import { getAssessmentRules } from "../config/assessmentRules.js";
import { localizeContentText } from "../i18n/content.js";
import { getReportingAnalyticsConfig } from "../config/reportingAnalytics.js";
import { reportingRepository } from "../repositories/reportingRepository.js";
import { buildAppealSlaSnapshot } from "./appealSla.js";
import { deriveRecertificationStatus } from "./recertificationService.js";
import type {
  SubmissionStatus as SubmissionStatusType,
  ReviewStatus as ReviewStatusType,
  AppealStatus as AppealStatusType,
} from "@prisma/client";

export type ReportFilters = {
  moduleId?: string;
  statuses?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  orgUnit?: string;
};

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

type ManualReviewQueueRow = {
  reviewId: string;
  reviewStatus: string;
  triggerReason: string;
  createdAt: Date;
  reviewedAt: Date | null;
  moduleId: string;
  moduleTitle: string;
  submissionId: string;
  submissionStatus: string;
  participantEmail: string;
  participantDepartment: string | null;
  latestDecisionType: string | null;
  latestDecisionPassFail: boolean | null;
};

type AppealRow = {
  appealId: string;
  appealStatus: string;
  createdAt: Date;
  claimedAt: Date | null;
  resolvedAt: Date | null;
  moduleId: string;
  moduleTitle: string;
  submissionId: string;
  participantEmail: string;
  participantDepartment: string | null;
  appealedByEmail: string;
  resolvedByEmail: string | null;
  ageHours: number;
  firstResponseDurationHours: number | null;
  resolutionDurationHours: number | null;
  firstResponseSlaHours: number;
  resolutionSlaHours: number;
  firstResponseOverdue: boolean;
  resolutionOverdue: boolean;
  atRisk: boolean;
  slaState: "ON_TRACK" | "AT_RISK" | "OVERDUE" | "RESOLVED";
};

type McqQualityRow = {
  moduleId: string;
  moduleTitle: string;
  questionId: string;
  questionStem: string;
  attemptCount: number;
  correctCount: number;
  difficulty: number | null;
  discrimination: number | null;
  flaggedLowQuality: boolean;
  qualityFlags: string;
};

type RecertificationStatusRow = {
  certificationId: string;
  userId: string;
  participantEmail: string;
  participantDepartment: string | null;
  moduleId: string;
  moduleTitle: string;
  latestDecisionId: string;
  status: string;
  passedAt: Date | null;
  recertificationDueDate: Date | null;
  expiryDate: Date | null;
  daysUntilDue: number | null;
  daysUntilExpiry: number | null;
  updatedAt: Date;
};

type AnalyticsTrendRow = {
  periodStart: string;
  submissions: number;
  completed: number;
  underReview: number;
  decisionCount: number;
  passCount: number;
  failCount: number;
  completionRate: number;
  passRate: number | null;
};

type AnalyticsCohortRow = {
  cohort: string;
  participants: number;
  submissions: number;
  completed: number;
  underReview: number;
  passCount: number;
  failCount: number;
  completionRate: number;
  passRate: number | null;
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

export async function getManualReviewQueueReport(filters: ReportFilters) {
  const statuses = asReviewStatuses(filters.statuses);
  const rows = await reportingRepository.findManualReviewsForQueueReport({
    statuses,
    moduleId: filters.moduleId,
    orgUnit: filters.orgUnit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  const mappedRows: ManualReviewQueueRow[] = rows.map((review) => ({
    reviewId: review.id,
    reviewStatus: review.reviewStatus,
    triggerReason: review.triggerReason,
    createdAt: review.createdAt,
    reviewedAt: review.reviewedAt,
    moduleId: review.submission.module.id,
    moduleTitle: localizeContentText("en-GB", review.submission.module.title) ?? review.submission.module.title,
    submissionId: review.submission.id,
    submissionStatus: review.submission.submissionStatus,
    participantEmail: review.submission.user.email,
    participantDepartment: review.submission.user.department,
    latestDecisionType: review.submission.decisions[0]?.decisionType ?? null,
    latestDecisionPassFail: review.submission.decisions[0]?.passFailTotal ?? null,
  }));

  return {
    reportType: "manual-review-queue",
    filters: normalizeFilters(filters),
    totals: {
      totalReviews: mappedRows.length,
      openReviews: mappedRows.filter((row) => row.reviewStatus === ReviewStatus.OPEN).length,
      inReviewReviews: mappedRows.filter((row) => row.reviewStatus === ReviewStatus.IN_REVIEW).length,
      resolvedReviews: mappedRows.filter((row) => row.reviewStatus === ReviewStatus.RESOLVED).length,
    },
    rows: mappedRows,
  };
}

export async function getAppealsReport(filters: ReportFilters) {
  const statuses = asAppealStatuses(filters.statuses);
  const appeals = await reportingRepository.findAppealsForReport({
    statuses,
    moduleId: filters.moduleId,
    orgUnit: filters.orgUnit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  const rows: AppealRow[] = appeals.map((appeal) => ({
    ...buildAppealSlaSnapshot({
      createdAt: appeal.createdAt,
      claimedAt: appeal.claimedAt,
      resolvedAt: appeal.resolvedAt,
      appealStatus: appeal.appealStatus,
    }),
    appealId: appeal.id,
    appealStatus: appeal.appealStatus,
    createdAt: appeal.createdAt,
    claimedAt: appeal.claimedAt,
    resolvedAt: appeal.resolvedAt,
    moduleId: appeal.submission.module.id,
    moduleTitle: localizeContentText("en-GB", appeal.submission.module.title) ?? appeal.submission.module.title,
    submissionId: appeal.submission.id,
    participantEmail: appeal.submission.user.email,
    participantDepartment: appeal.submission.user.department,
    appealedByEmail: appeal.appealedBy.email,
    resolvedByEmail: appeal.resolvedBy?.email ?? null,
  }));

  return {
    reportType: "appeals",
    filters: normalizeFilters(filters),
    totals: {
      totalAppeals: rows.length,
      openAppeals: rows.filter((row) => row.appealStatus === AppealStatus.OPEN).length,
      inReviewAppeals: rows.filter((row) => row.appealStatus === AppealStatus.IN_REVIEW).length,
      resolvedAppeals: rows.filter((row) => row.appealStatus === AppealStatus.RESOLVED).length,
      rejectedAppeals: rows.filter((row) => row.appealStatus === AppealStatus.REJECTED).length,
      onTrackAppeals: rows.filter((row) => row.slaState === "ON_TRACK").length,
      atRiskAppeals: rows.filter((row) => row.slaState === "AT_RISK").length,
      overdueAppeals: rows.filter((row) => row.slaState === "OVERDUE").length,
    },
    rows,
  };
}

export async function getMcqQualityReport(filters: ReportFilters) {
  const rules = getAssessmentRules();
  const submissionWhere = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const where = {
    mcqAttempt: {
      completedAt: { not: null },
      submission: submissionWhere,
    },
  } as const;

  const responses = await reportingRepository.findMcqResponsesForQualityReport(where);

  const perQuestion = new Map<string, {
    moduleId: string;
    moduleTitle: string;
    questionId: string;
    questionStem: string;
    responses: Array<{ isCorrect: boolean; attemptScore: number | null }>;
  }>();

  for (const response of responses) {
    const existing = perQuestion.get(response.questionId) ?? {
      moduleId: response.question.module.id,
      moduleTitle: localizeContentText("en-GB", response.question.module.title) ?? response.question.module.title,
      questionId: response.question.id,
      questionStem: response.question.stem,
      responses: [],
    };

    existing.responses.push({
      isCorrect: response.isCorrect,
      attemptScore: typeof response.mcqAttempt.percentScore === "number" ? response.mcqAttempt.percentScore : null,
    });
    perQuestion.set(response.questionId, existing);
  }

  const rows: McqQualityRow[] = Array.from(perQuestion.values()).map((entry) => {
    const attemptCount = entry.responses.length;
    const correctCount = entry.responses.filter((value) => value.isCorrect).length;
    const difficulty = attemptCount > 0 ? round2(correctCount / attemptCount) : null;

    const scoresForDiscrimination = entry.responses
      .filter((value) => typeof value.attemptScore === "number")
      .map((value) => ({
        correct: value.isCorrect ? 1 : 0,
        score: value.attemptScore as number,
      }));

    const qualityFlags: string[] = [];
    if (difficulty !== null && difficulty < rules.mcqQuality.difficultyMin) {
      qualityFlags.push("TOO_DIFFICULT");
    }
    if (difficulty !== null && difficulty > rules.mcqQuality.difficultyMax) {
      qualityFlags.push("TOO_EASY");
    }

    let discrimination: number | null = null;
    if (scoresForDiscrimination.length >= rules.mcqQuality.minAttemptCount) {
      discrimination = round2(computePointBiserial(scoresForDiscrimination));
      if (discrimination < rules.mcqQuality.discriminationMin) {
        qualityFlags.push("LOW_DISCRIMINATION");
      }
    } else {
      qualityFlags.push("INSUFFICIENT_SAMPLE");
    }

    return {
      moduleId: entry.moduleId,
      moduleTitle: entry.moduleTitle,
      questionId: entry.questionId,
      questionStem: entry.questionStem,
      attemptCount,
      correctCount,
      difficulty,
      discrimination,
      flaggedLowQuality: qualityFlags.length > 0,
      qualityFlags: qualityFlags.join("|"),
    };
  });

  const statusFilter = new Set((filters.statuses ?? []).map((value) => value.toUpperCase()));
  const filteredRows = rows.filter((row) => {
    if (statusFilter.size === 0) {
      return true;
    }
    if (statusFilter.has("FLAGGED") && row.flaggedLowQuality) {
      return true;
    }
    if (statusFilter.has("OK") && !row.flaggedLowQuality) {
      return true;
    }
    return false;
  });

  return {
    reportType: "mcq-quality",
    filters: normalizeFilters(filters),
    thresholds: {
      minAttemptCount: rules.mcqQuality.minAttemptCount,
      difficultyMin: rules.mcqQuality.difficultyMin,
      difficultyMax: rules.mcqQuality.difficultyMax,
      discriminationMin: rules.mcqQuality.discriminationMin,
    },
    totals: {
      questionCount: filteredRows.length,
      flaggedCount: filteredRows.filter((row) => row.flaggedLowQuality).length,
      tooDifficultCount: filteredRows.filter((row) => row.qualityFlags.includes("TOO_DIFFICULT")).length,
      tooEasyCount: filteredRows.filter((row) => row.qualityFlags.includes("TOO_EASY")).length,
      lowDiscriminationCount: filteredRows.filter((row) => row.qualityFlags.includes("LOW_DISCRIMINATION")).length,
      insufficientSampleCount: filteredRows.filter((row) => row.qualityFlags.includes("INSUFFICIENT_SAMPLE")).length,
    },
    rows: filteredRows,
  };
}

export async function getRecertificationStatusReport(filters: ReportFilters) {
  const rules = getAssessmentRules().recertification;
  const now = new Date();
  const statuses = new Set((filters.statuses ?? []).map((value) => value.toUpperCase()));

  const certifications = await reportingRepository.findCertificationsForStatusReport({
    moduleId: filters.moduleId,
    orgUnit: filters.orgUnit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  const rows = certifications
    .map((certification): RecertificationStatusRow => {
      const derivedStatus = deriveRecertificationStatus({
        now,
        expiryDate: certification.expiryDate,
        recertificationDueDate: certification.recertificationDueDate,
        dueSoonDays: rules.dueSoonDays,
      });
      return {
        certificationId: certification.id,
        userId: certification.user.id,
        participantEmail: certification.user.email,
        participantDepartment: certification.user.department,
        moduleId: certification.module.id,
        moduleTitle: localizeContentText("en-GB", certification.module.title) ?? certification.module.title,
        latestDecisionId: certification.latestDecisionId,
        status: derivedStatus,
        passedAt: certification.passedAt,
        recertificationDueDate: certification.recertificationDueDate,
        expiryDate: certification.expiryDate,
        daysUntilDue: certification.recertificationDueDate
          ? diffUtcDays(now, certification.recertificationDueDate)
          : null,
        daysUntilExpiry: certification.expiryDate ? diffUtcDays(now, certification.expiryDate) : null,
        updatedAt: certification.updatedAt,
      };
    })
    .filter((row) => statuses.size === 0 || statuses.has(row.status));

  const statusCounts = {
    ACTIVE: rows.filter((row) => row.status === "ACTIVE").length,
    DUE_SOON: rows.filter((row) => row.status === "DUE_SOON").length,
    DUE: rows.filter((row) => row.status === "DUE").length,
    EXPIRED: rows.filter((row) => row.status === "EXPIRED").length,
    NOT_CERTIFIED: rows.filter((row) => row.status === "NOT_CERTIFIED").length,
  };

  return {
    reportType: "recertification-status",
    filters: normalizeFilters(filters),
    totals: {
      certificationCount: rows.length,
      ...statusCounts,
    },
    rows,
  };
}

export async function getAnalyticsSemanticModel(filters: ReportFilters) {
  const analyticsConfig = getReportingAnalyticsConfig();
  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForAnalyticsSemanticModel(where);

  const totalSubmissions = submissions.length;
  const completedSubmissions = submissions.filter((submission) => submission.submissionStatus === SubmissionStatus.COMPLETED).length;
  const underReviewSubmissions = submissions.filter((submission) => submission.submissionStatus === SubmissionStatus.UNDER_REVIEW).length;
  const decisionCount = submissions.filter((submission) => submission.decisions[0]).length;
  const passCount = submissions.filter((submission) => submission.decisions[0]?.passFailTotal === true).length;
  const failCount = submissions.filter((submission) => submission.decisions[0]?.passFailTotal === false).length;
  const appealCount = submissions.reduce((sum, submission) => sum + submission.appeals.length, 0);

  const kpiValues = {
    submissions_total: totalSubmissions,
    completion_rate: totalSubmissions > 0 ? round2(completedSubmissions / totalSubmissions) : 0,
    pass_rate: decisionCount > 0 ? round2(passCount / decisionCount) : null,
    manual_review_rate: totalSubmissions > 0 ? round2(underReviewSubmissions / totalSubmissions) : 0,
    appeal_rate: totalSubmissions > 0 ? round2(appealCount / totalSubmissions) : 0,
  } as Record<string, number | null>;

  return {
    reportType: "analytics-semantic-model",
    filters: normalizeFilters(filters),
    kpiDefinitions: analyticsConfig.kpiDefinitions,
    kpiValues,
    totals: {
      totalSubmissions,
      completedSubmissions,
      underReviewSubmissions,
      decisionCount,
      passCount,
      failCount,
      appealCount,
    },
  };
}

export async function getAnalyticsTrendsReport(
  filters: ReportFilters,
  input?: { granularity?: "day" | "week" | "month" },
) {
  const analyticsConfig = getReportingAnalyticsConfig();
  const granularity = input?.granularity ?? analyticsConfig.trends.defaultGranularity;

  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForAnalyticsTrends(where);

  const buckets = new Map<string, AnalyticsTrendRow>();
  for (const submission of submissions) {
    const periodStart = periodKey(submission.submittedAt, granularity);
    const current = buckets.get(periodStart) ?? {
      periodStart,
      submissions: 0,
      completed: 0,
      underReview: 0,
      decisionCount: 0,
      passCount: 0,
      failCount: 0,
      completionRate: 0,
      passRate: null,
    };

    current.submissions += 1;
    if (submission.submissionStatus === SubmissionStatus.COMPLETED) {
      current.completed += 1;
    }
    if (submission.submissionStatus === SubmissionStatus.UNDER_REVIEW) {
      current.underReview += 1;
    }
    if (submission.decisions[0]) {
      current.decisionCount += 1;
      if (submission.decisions[0].passFailTotal) {
        current.passCount += 1;
      } else {
        current.failCount += 1;
      }
    }
    buckets.set(periodStart, current);
  }

  const rows = Array.from(buckets.values())
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map((row) => ({
      ...row,
      completionRate: row.submissions > 0 ? round2(row.completed / row.submissions) : 0,
      passRate: row.decisionCount > 0 ? round2(row.passCount / row.decisionCount) : null,
    }));

  return {
    reportType: "analytics-trends",
    filters: normalizeFilters(filters),
    granularity,
    rows,
  };
}

export async function getAnalyticsCohortsReport(
  filters: ReportFilters,
  input?: { cohortBy?: "month" | "department" },
) {
  const analyticsConfig = getReportingAnalyticsConfig();
  const cohortBy = input?.cohortBy ?? analyticsConfig.cohorts.defaultCohortBy;

  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForAnalyticsCohorts(where);

  const cohorts = new Map<string, AnalyticsCohortRow>();
  const cohortParticipantSets = new Map<string, Set<string>>();

  for (const submission of submissions) {
    const cohort =
      cohortBy === "department"
        ? submission.user.department ?? "UNSPECIFIED"
        : submission.submittedAt.toISOString().slice(0, 7);

    const current = cohorts.get(cohort) ?? {
      cohort,
      participants: 0,
      submissions: 0,
      completed: 0,
      underReview: 0,
      passCount: 0,
      failCount: 0,
      completionRate: 0,
      passRate: null,
    };

    current.submissions += 1;
    if (submission.submissionStatus === SubmissionStatus.COMPLETED) {
      current.completed += 1;
    }
    if (submission.submissionStatus === SubmissionStatus.UNDER_REVIEW) {
      current.underReview += 1;
    }
    if (submission.decisions[0]?.passFailTotal === true) {
      current.passCount += 1;
    }
    if (submission.decisions[0]?.passFailTotal === false) {
      current.failCount += 1;
    }

    const participants = cohortParticipantSets.get(cohort) ?? new Set<string>();
    participants.add(submission.userId);
    cohortParticipantSets.set(cohort, participants);

    cohorts.set(cohort, current);
  }

  const rows = Array.from(cohorts.values())
    .sort((a, b) => a.cohort.localeCompare(b.cohort))
    .map((row) => {
      const decisionCount = row.passCount + row.failCount;
      return {
        ...row,
        participants: cohortParticipantSets.get(row.cohort)?.size ?? 0,
        completionRate: row.submissions > 0 ? round2(row.completed / row.submissions) : 0,
        passRate: decisionCount > 0 ? round2(row.passCount / decisionCount) : null,
      };
    });

  return {
    reportType: "analytics-cohorts",
    filters: normalizeFilters(filters),
    cohortBy,
    rows,
  };
}

export async function getReportingDataQualityReport(filters: ReportFilters) {
  const analyticsConfig = getReportingAnalyticsConfig();
  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForDataQuality(where);

  const completedSubmissions = submissions.filter((submission) => submission.submissionStatus === SubmissionStatus.COMPLETED);
  const missingDecisionCount = completedSubmissions.filter((submission) => !submission.decisions[0]).length;
  const decisionWithoutEvaluationCount = submissions.filter(
    (submission) => submission.decisions[0] && !submission.llmEvaluations[0],
  ).length;

  const missingDecisionRate =
    completedSubmissions.length > 0 ? round2(missingDecisionCount / completedSubmissions.length) : 0;
  const decisionWithoutEvaluationRate =
    submissions.length > 0 ? round2(decisionWithoutEvaluationCount / submissions.length) : 0;

  const checks = [
    {
      id: "missing_decision_on_completed_submission",
      severity: missingDecisionRate > analyticsConfig.dataQuality.maxMissingDecisionRate ? "error" : "ok",
      value: missingDecisionRate,
      threshold: analyticsConfig.dataQuality.maxMissingDecisionRate,
      count: missingDecisionCount,
    },
    {
      id: "decision_without_llm_evaluation",
      severity:
        decisionWithoutEvaluationRate > analyticsConfig.dataQuality.maxDecisionWithoutEvaluationRate ? "error" : "ok",
      value: decisionWithoutEvaluationRate,
      threshold: analyticsConfig.dataQuality.maxDecisionWithoutEvaluationRate,
      count: decisionWithoutEvaluationCount,
    },
  ];

  return {
    reportType: "analytics-data-quality",
    filters: normalizeFilters(filters),
    checks,
    totals: {
      submissionCount: submissions.length,
      completedSubmissionCount: completedSubmissions.length,
      failedCheckCount: checks.filter((check) => check.severity === "error").length,
    },
  };
}

export function toCsv(
  rows: Array<Record<string, unknown>>,
  columnOrder?: string[],
) {
  const columns =
    columnOrder && columnOrder.length > 0
      ? columnOrder
      : Array.from(rows.reduce((set, row) => {
          for (const key of Object.keys(row)) {
            set.add(key);
          }
          return set;
        }, new Set<string>()));

  const header = columns.join(",");
  const dataLines = rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(","));
  return [header, ...dataLines].join("\n");
}

function escapeCsvValue(value: unknown) {
  if (value == null) {
    return "";
  }
  const asString = value instanceof Date ? value.toISOString() : String(value);
  const escaped = asString.replaceAll('"', '""');
  if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
    return `"${escaped}"`;
  }
  return escaped;
}

function asSubmissionStatuses(input?: string[]) {
  if (!input || input.length === 0) {
    return [];
  }
  const valid = new Set<string>(Object.values(SubmissionStatus));
  return input.filter((item) => valid.has(item)) as SubmissionStatusType[];
}

function asReviewStatuses(input?: string[]) {
  if (!input || input.length === 0) {
    return [];
  }
  const valid = new Set<string>(Object.values(ReviewStatus));
  return input.filter((item) => valid.has(item)) as ReviewStatusType[];
}

function asAppealStatuses(input?: string[]) {
  if (!input || input.length === 0) {
    return [];
  }
  const valid = new Set<string>(Object.values(AppealStatus));
  return input.filter((item) => valid.has(item)) as AppealStatusType[];
}

function normalizeFilters(filters: ReportFilters) {
  return {
    moduleId: filters.moduleId ?? null,
    statuses: filters.statuses ?? [],
    dateFrom: filters.dateFrom?.toISOString() ?? null,
    dateTo: filters.dateTo?.toISOString() ?? null,
    orgUnit: filters.orgUnit ?? null,
  };
}

function round2(input: number) {
  return Number(input.toFixed(4));
}

function computePointBiserial(values: Array<{ correct: number; score: number }>) {
  if (values.length < 2) {
    return 0;
  }

  const meanScore = values.reduce((sum, value) => sum + value.score, 0) / values.length;
  const variance =
    values.reduce((sum, value) => {
      const delta = value.score - meanScore;
      return sum + delta * delta;
    }, 0) / values.length;

  if (variance <= 0) {
    return 0;
  }

  const stdDev = Math.sqrt(variance);
  const correctGroup = values.filter((value) => value.correct === 1).map((value) => value.score);
  const incorrectGroup = values.filter((value) => value.correct === 0).map((value) => value.score);

  if (correctGroup.length === 0 || incorrectGroup.length === 0) {
    return 0;
  }

  const meanCorrect = correctGroup.reduce((sum, score) => sum + score, 0) / correctGroup.length;
  const meanIncorrect = incorrectGroup.reduce((sum, score) => sum + score, 0) / incorrectGroup.length;
  const p = correctGroup.length / values.length;
  const q = 1 - p;

  return ((meanCorrect - meanIncorrect) / stdDev) * Math.sqrt(p * q);
}

function periodKey(input: Date, granularity: "day" | "week" | "month") {
  if (granularity === "day") {
    return input.toISOString().slice(0, 10);
  }
  if (granularity === "month") {
    return input.toISOString().slice(0, 7);
  }

  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay();
  const isoWeekDay = day === 0 ? 7 : day;
  date.setUTCDate(date.getUTCDate() - (isoWeekDay - 1));
  return date.toISOString().slice(0, 10);
}

function diffUtcDays(from: Date, to: Date) {
  const fromDate = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toDate = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((toDate - fromDate) / (24 * 60 * 60 * 1000));
}
