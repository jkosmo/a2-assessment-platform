import { AppealStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { buildAppealSlaSnapshot } from "./appealSla.js";
import { logOperationalEvent } from "../observability/operationalLog.js";

type SlaState = "ON_TRACK" | "AT_RISK" | "OVERDUE" | "RESOLVED";

export type AppealSlaMonitorSnapshot = {
  checkedAt: string;
  openAppeals: number;
  inReviewAppeals: number;
  onTrackAppeals: number;
  atRiskAppeals: number;
  overdueAppeals: number;
  overdueThreshold: number;
  thresholdBreached: boolean;
  oldestOverdueHours: number | null;
};

let monitorTimer: NodeJS.Timeout | null = null;
let monitorRunning = false;

export async function collectAppealSlaMonitorSnapshot(now = new Date()): Promise<AppealSlaMonitorSnapshot> {
  const appeals = await prisma.appeal.findMany({
    where: {
      appealStatus: { in: [AppealStatus.OPEN, AppealStatus.IN_REVIEW] },
    },
    select: {
      createdAt: true,
      claimedAt: true,
      resolvedAt: true,
      appealStatus: true,
    },
  });

  let openAppeals = 0;
  let inReviewAppeals = 0;
  let onTrackAppeals = 0;
  let atRiskAppeals = 0;
  let overdueAppeals = 0;
  let oldestOverdueHours: number | null = null;

  for (const appeal of appeals) {
    if (appeal.appealStatus === AppealStatus.OPEN) {
      openAppeals += 1;
    } else if (appeal.appealStatus === AppealStatus.IN_REVIEW) {
      inReviewAppeals += 1;
    }

    const sla = buildAppealSlaSnapshot({
      createdAt: appeal.createdAt,
      claimedAt: appeal.claimedAt,
      resolvedAt: appeal.resolvedAt,
      appealStatus: appeal.appealStatus,
      now,
    });

    incrementSlaCounter(sla.slaState, {
      onTrack: () => {
        onTrackAppeals += 1;
      },
      atRisk: () => {
        atRiskAppeals += 1;
      },
      overdue: () => {
        overdueAppeals += 1;
        oldestOverdueHours = oldestOverdueHours == null
          ? sla.ageHours
          : Math.max(oldestOverdueHours, sla.ageHours);
      },
    });
  }

  const overdueThreshold = env.APPEAL_OVERDUE_ALERT_THRESHOLD;
  return {
    checkedAt: now.toISOString(),
    openAppeals,
    inReviewAppeals,
    onTrackAppeals,
    atRiskAppeals,
    overdueAppeals,
    overdueThreshold,
    thresholdBreached: overdueAppeals >= overdueThreshold,
    oldestOverdueHours,
  };
}

export async function runAppealSlaMonitorNow(now = new Date()) {
  const snapshot = await collectAppealSlaMonitorSnapshot(now);
  logOperationalEvent("appeal_sla_backlog", snapshot);

  if (snapshot.thresholdBreached) {
    logOperationalEvent(
      "appeal_overdue_detected",
      {
        overdueAppeals: snapshot.overdueAppeals,
        overdueThreshold: snapshot.overdueThreshold,
        oldestOverdueHours: snapshot.oldestOverdueHours,
        openAppeals: snapshot.openAppeals,
        inReviewAppeals: snapshot.inReviewAppeals,
      },
      "error",
    );
  }

  return snapshot;
}

export function startAppealSlaMonitor() {
  if (monitorTimer || process.env.NODE_ENV === "test") {
    return;
  }

  const runMonitor = async () => {
    if (monitorRunning) {
      return;
    }
    monitorRunning = true;
    try {
      await runAppealSlaMonitorNow();
    } catch (error) {
      logOperationalEvent(
        "appeal_sla_monitor_failed",
        {
          errorMessage: error instanceof Error ? error.message : "Unknown monitor error",
        },
        "error",
      );
    } finally {
      monitorRunning = false;
    }
  };

  void runMonitor();
  monitorTimer = setInterval(runMonitor, env.APPEAL_SLA_MONITOR_INTERVAL_MS);
}

export function stopAppealSlaMonitor() {
  if (!monitorTimer) {
    return;
  }
  clearInterval(monitorTimer);
  monitorTimer = null;
}

function incrementSlaCounter(
  state: SlaState,
  handlers: {
    onTrack: () => void;
    atRisk: () => void;
    overdue: () => void;
  },
) {
  if (state === "ON_TRACK") {
    handlers.onTrack();
    return;
  }
  if (state === "AT_RISK") {
    handlers.atRisk();
    return;
  }
  if (state === "OVERDUE") {
    handlers.overdue();
  }
}
