// #809: liveness ≠ readiness for the worker process. The worker health endpoint used to return a
// hardcoded HTTP 200 with each monitor's status embedded in the body — so a permanently STUCK loop
// (a wedged in-flight tick that never completes, or a loop whose last successful cycle is long past)
// was invisible to Azure App Service's health probe, and the container was never restarted.
//
// This module is the pure, dependency-free decision: given each monitor's health snapshot and the
// current time, decide whether the worker is READY (all enabled loops are making progress) or STUCK.
// The endpoint turns an unhealthy verdict into a 503 so the platform restarts the container.
//
// Thresholds are per-monitor and derived from each monitor's own interval, because the six monitors
// span 4 s (assessment poller) to 24 h (Entra sync, course reminders): a single global threshold would
// either false-trip the fast poller or never catch the slow ones. Generous factors + absolute floors
// keep a transient error or a slow first cycle from flapping the container (cf. the #497 startup
// connection-storm incident — restarts are not free).

export interface MonitorHealthSnapshot {
  /** Stable key for logs/telemetry, e.g. "assessmentWorker". */
  name: string;
  /** A monitor that is not configured to run (e.g. Entra sync without a group id) is never "stuck". */
  enabled: boolean;
  /** The loop's scheduling interval in ms — the basis for its staleness/wedge windows. */
  intervalMs: number;
  /** True while a tick is in flight. */
  running: boolean;
  /** ISO timestamp of when the in-flight tick started (null when not running) — detects a wedged tick. */
  tickStartedAt: string | null;
  /** ISO timestamp of the last SUCCESSFUL cycle (null before the first success). */
  lastCycleAt: string | null;
  /** Last error message, if the most recent tick failed. Informational — does not by itself mark unhealthy. */
  lastError: string | null;
}

export type MonitorHealthReason = "ok" | "disabled" | "wedged" | "stalled";

export interface MonitorVerdict {
  name: string;
  enabled: boolean;
  healthy: boolean;
  reason: MonitorHealthReason;
  /** ms since the last successful cycle (or since process start if none yet); null when disabled. */
  staleMs: number | null;
  /** ms the current tick has been running; null when idle or disabled. */
  runningMs: number | null;
}

export interface WorkerHealthReport {
  healthy: boolean;
  checkedAt: string;
  monitors: MonitorVerdict[];
}

export interface WorkerHealthThresholds {
  /** A monitor is "stalled" if no successful cycle within intervalMs × this (floored). */
  staleFactor: number;
  /** A monitor is "wedged" if a single tick runs longer than intervalMs × this (floored). */
  wedgeFactor: number;
  /** Lower bound on the stale window, so short-interval monitors get a grace period. */
  minStaleFloorMs: number;
  /** Lower bound on the wedge window, so a brief-but-legitimate slow tick isn't called wedged. */
  minWedgeFloorMs: number;
  /**
   * #809-followup: grace for a monitor that has NEVER completed a cycle yet. On a B1 cold-start (cold
   * container + cold burstable Postgres + staggered worker starts) the first tick of a short-interval
   * monitor can legitimately take minutes — longer than its normal stale window — so during warm-up we
   * must NOT report the worker unhealthy (that fails the deploy smoke test and, worse, can make Azure's
   * runtime health check restart-loop the worker before it ever warms up). A never-completed monitor is
   * "starting" (healthy) until the process has been up longer than this; a HANGING first tick is still
   * caught by the wedge check.
   */
  startupGraceMs: number;
}

// Factor 3 + 60 s floors: the 4 s assessment poller tolerates ~60 s of no progress before "stalled"
// (a poller stuck for a minute is genuinely stuck); the 24 h monitors tolerate 72 h. A tick running
// past the same window is "wedged". These are deliberately forgiving — the goal is catching a
// PERMANENT stick, not policing latency.
export const DEFAULT_WORKER_HEALTH_THRESHOLDS: WorkerHealthThresholds = {
  staleFactor: 3,
  wedgeFactor: 3,
  minStaleFloorMs: 60_000,
  minWedgeFloorMs: 60_000,
  // 15 min: comfortably longer than an observed B1 cold-start worker warm-up (~10 min). A worker that
  // has not completed a SINGLE cycle of a monitor in 15 min is genuinely broken; until then it's warming.
  startupGraceMs: 900_000,
};

function parseIso(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Pure readiness decision. `processStartedAt` is the reference point for a monitor that has not yet
 * completed its first cycle — it gets a grace window measured from process start, not treated as
 * instantly stale. Disabled monitors are always healthy (they aren't supposed to be ticking).
 */
export function evaluateWorkerHealth(
  snapshots: MonitorHealthSnapshot[],
  now: Date,
  processStartedAt: Date,
  thresholds: WorkerHealthThresholds = DEFAULT_WORKER_HEALTH_THRESHOLDS,
): WorkerHealthReport {
  const nowMs = now.getTime();
  const startMs = processStartedAt.getTime();

  const monitors = snapshots.map((s): MonitorVerdict => {
    if (!s.enabled) {
      return { name: s.name, enabled: false, healthy: true, reason: "disabled", staleMs: null, runningMs: null };
    }

    const wedgeWindow = Math.max(s.intervalMs * thresholds.wedgeFactor, thresholds.minWedgeFloorMs);
    const staleWindow = Math.max(s.intervalMs * thresholds.staleFactor, thresholds.minStaleFloorMs);

    const tickStartedMs = parseIso(s.tickStartedAt);
    const runningMs = s.running && tickStartedMs !== null ? nowMs - tickStartedMs : null;
    if (runningMs !== null && runningMs > wedgeWindow) {
      return { name: s.name, enabled: true, healthy: false, reason: "wedged", staleMs: null, runningMs };
    }

    // No success yet → measure from process start, and give it the (larger) startup grace: a monitor
    // that has never completed a cycle is warming up, not stalled, until the process exceeds that grace.
    // Once it HAS completed a cycle, the normal (tight) stale window applies.
    const lastCycleMs = parseIso(s.lastCycleAt);
    const referenceMs = lastCycleMs ?? startMs;
    const effectiveStaleWindow = lastCycleMs === null ? Math.max(staleWindow, thresholds.startupGraceMs) : staleWindow;
    const staleMs = nowMs - referenceMs;
    if (staleMs > effectiveStaleWindow) {
      return { name: s.name, enabled: true, healthy: false, reason: "stalled", staleMs, runningMs };
    }

    return { name: s.name, enabled: true, healthy: true, reason: "ok", staleMs, runningMs };
  });

  return {
    healthy: monitors.every((m) => m.healthy),
    checkedAt: now.toISOString(),
    monitors,
  };
}

// #810: graceful shutdown must not kill an in-flight tick mid-work — a half-processed assessment job or
// a partial sync should be allowed to finish. After the timers are stopped (no new ticks), poll each
// monitor's `running` flag until every in-flight tick has settled, bounded by `timeoutMs` so a wedged
// loop (the #809 case) can't block shutdown forever. Returns true if fully drained, false if it timed out
// (the caller then force-exits, which is correct — a wedged tick is not going to finish).
export interface DrainableMonitor {
  health(): { running: boolean };
}

export async function drainInFlightTicks(
  monitors: Array<DrainableMonitor | null | undefined>,
  timeoutMs: number,
  nowMs: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs = 25,
): Promise<boolean> {
  const deadline = nowMs() + timeoutMs;
  const anyRunning = () => monitors.some((m) => m?.health().running === true);
  while (anyRunning() && nowMs() < deadline) {
    await sleep(pollMs);
  }
  return !anyRunning();
}
