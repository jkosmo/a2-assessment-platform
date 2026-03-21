import { AppealStatus } from "../../db/prismaRuntime.js";
import { env } from "../../config/env.js";
import type { AppealStatus as AppealStatusType } from "@prisma/client";

export type AppealSlaSnapshot = {
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

export function buildAppealSlaSnapshot(input: {
  createdAt: Date;
  claimedAt: Date | null;
  resolvedAt: Date | null;
  appealStatus: AppealStatusType;
  now?: Date;
}): AppealSlaSnapshot {
  const now = input.now ?? new Date();
  const firstResponseSlaHours = env.APPEAL_FIRST_RESPONSE_SLA_HOURS;
  const resolutionSlaHours = env.APPEAL_RESOLUTION_SLA_HOURS;
  const atRiskRatio = env.APPEAL_AT_RISK_RATIO;

  const ageHours = hoursBetween(input.createdAt, now);
  const firstResponseDurationHours = input.claimedAt
    ? hoursBetween(input.createdAt, input.claimedAt)
    : input.resolvedAt
      ? hoursBetween(input.createdAt, input.resolvedAt)
      : null;
  const resolutionDurationHours = input.resolvedAt
    ? hoursBetween(input.createdAt, input.resolvedAt)
    : null;

  const unresolved =
    input.appealStatus === AppealStatus.OPEN || input.appealStatus === AppealStatus.IN_REVIEW;

  const firstResponseOverdue = firstResponseDurationHours != null
    ? firstResponseDurationHours > firstResponseSlaHours
    : unresolved && ageHours > firstResponseSlaHours;
  const resolutionOverdue = unresolved && ageHours > resolutionSlaHours;
  const atRisk =
    unresolved &&
    !firstResponseOverdue &&
    !resolutionOverdue &&
    (
      (input.claimedAt == null && ageHours >= firstResponseSlaHours * atRiskRatio) ||
      ageHours >= resolutionSlaHours * atRiskRatio
    );

  const slaState: AppealSlaSnapshot["slaState"] = input.resolvedAt
    ? "RESOLVED"
    : firstResponseOverdue || resolutionOverdue
      ? "OVERDUE"
      : atRisk
        ? "AT_RISK"
        : "ON_TRACK";

  return {
    ageHours: round2(ageHours),
    firstResponseDurationHours:
      firstResponseDurationHours == null ? null : round2(firstResponseDurationHours),
    resolutionDurationHours: resolutionDurationHours == null ? null : round2(resolutionDurationHours),
    firstResponseSlaHours,
    resolutionSlaHours,
    firstResponseOverdue,
    resolutionOverdue,
    atRisk,
    slaState,
  };
}

function hoursBetween(from: Date, to: Date) {
  return Math.max(0, (to.getTime() - from.getTime()) / (1000 * 60 * 60));
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
