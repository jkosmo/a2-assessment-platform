import { ReviewStatus, AppealStatus } from "../../db/prismaRuntime.js";
import { localizeContentText } from "../../i18n/content.js";
import { reportingRepository } from "../../repositories/reportingRepository.js";
import { buildAppealSlaSnapshot } from "../../modules/appeal/index.js";
import { isCertificationPassed } from "../certification/index.js";
import type {
  ReviewStatus as ReviewStatusType,
  AppealStatus as AppealStatusType,
} from "@prisma/client";
import { normalizeFilters } from "./csvExport.js";
import type { ReportFilters } from "./types.js";

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

// #989: raden hadde `recertificationDueDate`, `expiryDate`, `daysUntilDue` og `daysUntilExpiry`.
// Alle fire kom fra en utløpsmekanikk som ikke lenger finnes, og `status` ble UTLEDET fra dem ved
// lesing. Nå rapporteres den lagrede tilstanden, normalisert til de to som betyr noe.
type CertificationStatusRow = {
  certificationId: string;
  userId: string;
  participantEmail: string;
  participantDepartment: string | null;
  moduleId: string;
  moduleTitle: string;
  latestDecisionId: string;
  status: "ACTIVE" | "NOT_CERTIFIED";
  passedAt: Date | null;
  updatedAt: Date;
};

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

export async function getCertificationStatusReport(filters: ReportFilters) {
  const statuses = new Set((filters.statuses ?? []).map((value) => value.toUpperCase()));

  const certifications = await reportingRepository.findCertificationsForStatusReport({
    moduleId: filters.moduleId,
    orgUnit: filters.orgUnit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  const rows = certifications
    .map((certification): CertificationStatusRow => {
      return {
        certificationId: certification.id,
        userId: certification.user.id,
        participantEmail: certification.user.email,
        participantDepartment: certification.user.department,
        moduleId: certification.module.id,
        moduleTitle: localizeContentText("en-GB", certification.module.title) ?? certification.module.title,
        latestDecisionId: certification.latestDecisionId,
        // Historiske rader kan stå med DUE_SOON/DUE/EXPIRED. De talte som bestått den gang og teller
        // som bestått nå — samme regel som kursbevisporten bruker, én kilde (`isCertificationPassed`).
        status: isCertificationPassed(certification.status) ? "ACTIVE" : "NOT_CERTIFIED",
        passedAt: certification.passedAt,
        updatedAt: certification.updatedAt,
      };
    })
    .filter((row) => statuses.size === 0 || statuses.has(row.status));

  const statusCounts = {
    ACTIVE: rows.filter((row) => row.status === "ACTIVE").length,
    NOT_CERTIFIED: rows.filter((row) => row.status === "NOT_CERTIFIED").length,
  };

  return {
    reportType: "certification-status",
    filters: normalizeFilters(filters),
    totals: {
      certificationCount: rows.length,
      ...statusCounts,
    },
    rows,
  };
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

