import { prisma } from "../db/prisma.js";
import { ReviewStatus, AppealStatus, SubmissionStatus } from "../db/prismaRuntime.js";
import { buildAppealSlaSnapshot } from "./appealSla.js";
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
  resolvedAt: Date | null;
  moduleId: string;
  moduleTitle: string;
  submissionId: string;
  participantEmail: string;
  participantDepartment: string | null;
  appealedByEmail: string;
  resolvedByEmail: string | null;
  ageHours: number;
  resolutionDurationHours: number | null;
  firstResponseSlaHours: number;
  resolutionSlaHours: number;
  firstResponseOverdue: boolean;
  resolutionOverdue: boolean;
  atRisk: boolean;
  slaState: "ON_TRACK" | "AT_RISK" | "OVERDUE" | "RESOLVED";
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

  const submissions = await prisma.submission.findMany({
    where,
    select: {
      moduleId: true,
      submissionStatus: true,
      module: { select: { id: true, title: true } },
    },
  });

  const rowsByModule = new Map<string, CompletionRow>();
  for (const submission of submissions) {
    const key = submission.module.id;
    const current = rowsByModule.get(key) ?? {
      moduleId: submission.module.id,
      moduleTitle: submission.module.title,
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

  const submissions = await prisma.submission.findMany({
    where,
    select: {
      id: true,
      submissionStatus: true,
      module: { select: { id: true, title: true } },
      decisions: {
        orderBy: { finalisedAt: "desc" },
        take: 1,
        select: {
          passFailTotal: true,
        },
      },
    },
  });

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
      moduleTitle: submission.module.title,
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
  const rows = await prisma.manualReview.findMany({
    where: {
      ...(statuses.length > 0 ? { reviewStatus: { in: statuses } } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            createdAt: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {}),
      submission: {
        ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
        ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
      },
    },
    orderBy: { createdAt: "asc" },
    include: {
      submission: {
        select: {
          id: true,
          submissionStatus: true,
          user: {
            select: {
              email: true,
              department: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
            },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: {
              decisionType: true,
              passFailTotal: true,
            },
          },
        },
      },
    },
  });

  const mappedRows: ManualReviewQueueRow[] = rows.map((review) => ({
    reviewId: review.id,
    reviewStatus: review.reviewStatus,
    triggerReason: review.triggerReason,
    createdAt: review.createdAt,
    reviewedAt: review.reviewedAt,
    moduleId: review.submission.module.id,
    moduleTitle: review.submission.module.title,
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
  const appeals = await prisma.appeal.findMany({
    where: {
      ...(statuses.length > 0 ? { appealStatus: { in: statuses } } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            createdAt: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {}),
      submission: {
        ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
        ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
      },
    },
    orderBy: { createdAt: "asc" },
    include: {
      appealedBy: {
        select: {
          email: true,
        },
      },
      resolvedBy: {
        select: {
          email: true,
        },
      },
      submission: {
        select: {
          id: true,
          user: {
            select: {
              email: true,
              department: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  });

  const rows: AppealRow[] = appeals.map((appeal) => ({
    ...buildAppealSlaSnapshot({
      createdAt: appeal.createdAt,
      resolvedAt: appeal.resolvedAt,
      appealStatus: appeal.appealStatus,
    }),
    appealId: appeal.id,
    appealStatus: appeal.appealStatus,
    createdAt: appeal.createdAt,
    resolvedAt: appeal.resolvedAt,
    moduleId: appeal.submission.module.id,
    moduleTitle: appeal.submission.module.title,
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
