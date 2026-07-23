/**
 * Worker health contract tests (#274).
 *
 * These tests verify that all background-loop monitors expose a consistent
 * getStatus() contract so the unified worker health endpoint in src/index.ts
 * can surface last-cycle information for operational checks.
 */
import { describe, expect, it, vi } from "vitest";
import { PseudonymizationMonitor } from "../../src/modules/user/PseudonymizationMonitor.js";
import { AuditRetentionMonitor } from "../../src/modules/retention/AuditRetentionMonitor.js";
import { AssessmentWorker } from "../../src/modules/assessment/AssessmentWorker.js";
import {
  evaluateWorkerHealth,
  drainInFlightTicks,
  type MonitorHealthSnapshot,
} from "../../src/observability/workerHealth.js";

describe("PseudonymizationMonitor.getStatus", () => {
  it("returns null lastCycleAt before first tick", () => {
    const monitor = new PseudonymizationMonitor(10_000, vi.fn());
    expect(monitor.getStatus().lastCycleAt).toBeNull();
  });

  it("updates lastCycleAt after a successful tick", async () => {
    const monitor = new PseudonymizationMonitor(10_000, vi.fn().mockResolvedValue({ affected: 0 }));
    monitor.start();
    await Promise.resolve();
    monitor.stop();
    expect(monitor.getStatus().lastCycleAt).not.toBeNull();
  });
});

describe("AuditRetentionMonitor.getStatus", () => {
  it("returns null lastCycleAt before first tick", () => {
    const monitor = new AuditRetentionMonitor(10_000, vi.fn());
    expect(monitor.getStatus().lastCycleAt).toBeNull();
  });

  it("updates lastCycleAt after a successful tick", async () => {
    const monitor = new AuditRetentionMonitor(10_000, vi.fn().mockResolvedValue({ deleted: 0 }));
    monitor.start();
    await Promise.resolve();
    monitor.stop();
    expect(monitor.getStatus().lastCycleAt).not.toBeNull();
  });
});

// #809: readiness decision — worker health must report 503 when a loop is permanently stuck.
describe("evaluateWorkerHealth (#809)", () => {
  const NOW = new Date("2026-07-23T12:00:00.000Z");
  const nowMs = NOW.getTime();
  const START = new Date(nowMs - 60_000); // process started 1 min ago
  const iso = (msAgo: number) => new Date(nowMs - msAgo).toISOString();
  const snap = (o: Partial<MonitorHealthSnapshot>): MonitorHealthSnapshot => ({
    name: "m",
    enabled: true,
    intervalMs: 600_000, // 10 min
    running: false,
    tickStartedAt: null,
    lastCycleAt: null,
    lastError: null,
    ...o,
  });

  it("healthy when every enabled monitor completed a recent cycle", () => {
    const report = evaluateWorkerHealth([snap({ lastCycleAt: iso(60_000) })], NOW, START);
    expect(report.healthy).toBe(true);
    expect(report.monitors[0].reason).toBe("ok");
  });

  it("a disabled monitor is always healthy (never 'stuck'), even with no cycle ever", () => {
    const report = evaluateWorkerHealth([snap({ enabled: false, lastCycleAt: null })], NOW, START);
    expect(report.healthy).toBe(true);
    expect(report.monitors[0].reason).toBe("disabled");
  });

  it("WEDGED: an in-flight tick running past intervalMs × factor → unhealthy 503", () => {
    // intervalMs 10min → wedge window 30min; tick started 40min ago and still running.
    const report = evaluateWorkerHealth(
      [snap({ running: true, tickStartedAt: iso(40 * 60_000) })],
      NOW,
      START,
    );
    expect(report.healthy).toBe(false);
    expect(report.monitors[0].reason).toBe("wedged");
  });

  it("STALLED: no successful cycle within the staleness window → unhealthy 503", () => {
    // intervalMs 10min → stale window 30min; last success 40min ago.
    const report = evaluateWorkerHealth([snap({ lastCycleAt: iso(40 * 60_000) })], NOW, START);
    expect(report.healthy).toBe(false);
    expect(report.monitors[0].reason).toBe("stalled");
  });

  it("startup grace: a monitor with no cycle yet is healthy within the window from process start", () => {
    // Never ticked, but process only started 1 min ago and interval is 10 min → not stale.
    const report = evaluateWorkerHealth([snap({ lastCycleAt: null })], NOW, START);
    expect(report.healthy).toBe(true);
    expect(report.monitors[0].reason).toBe("ok");
  });

  it("a 24h monitor is not 'stalled' one hour after its last cycle", () => {
    const report = evaluateWorkerHealth(
      [snap({ intervalMs: 86_400_000, lastCycleAt: iso(60 * 60_000) })],
      NOW,
      START,
    );
    expect(report.healthy).toBe(true);
  });

  it("the absolute floor protects a 4s poller from a slow-but-fine 30s gap, but 90s is stalled", () => {
    const fresh = evaluateWorkerHealth([snap({ intervalMs: 4_000, lastCycleAt: iso(30_000) })], NOW, START);
    expect(fresh.healthy).toBe(true); // 30s < 60s floor
    const stalled = evaluateWorkerHealth([snap({ intervalMs: 4_000, lastCycleAt: iso(90_000) })], NOW, START);
    expect(stalled.healthy).toBe(false); // 90s > 60s floor
    expect(stalled.monitors[0].reason).toBe("stalled");
  });

  it("one unhealthy monitor makes the whole worker unhealthy (all must be ready)", () => {
    const report = evaluateWorkerHealth(
      [snap({ lastCycleAt: iso(60_000) }), snap({ name: "stuck", lastCycleAt: iso(40 * 60_000) })],
      NOW,
      START,
    );
    expect(report.healthy).toBe(false);
    expect(report.monitors.find((m) => m.name === "stuck")?.healthy).toBe(false);
  });
});

// #809: the monitor's health() snapshot must expose the in-flight tick so a wedge is detectable.
describe("monitor.health() exposes in-flight tick state (#809)", () => {
  it("reports running + tickStartedAt while a tick is in progress, cleared after", async () => {
    let release!: () => void;
    const gate = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
    const worker = new AssessmentWorker(10_000, () => gate);
    worker.start(); // fires the first tick synchronously up to the awaited runJob
    await Promise.resolve();

    const inflight = worker.health();
    expect(inflight.running).toBe(true);
    expect(inflight.tickStartedAt).not.toBeNull();
    expect(inflight.name).toBe("assessmentWorker");

    release();
    await gate;
    await Promise.resolve(); // let the finally block run
    worker.stop();

    const settled = worker.health();
    expect(settled.running).toBe(false);
    expect(settled.tickStartedAt).toBeNull();
    expect(settled.lastCycleAt).not.toBeNull();
  });
});

// #810: graceful shutdown drains in-flight ticks (bounded) before exiting.
describe("drainInFlightTicks (#810)", () => {
  it("resolves drained=true immediately when nothing is running", async () => {
    const idle = { health: () => ({ running: false }) };
    expect(await drainInFlightTicks([idle, null], 1_000)).toBe(true);
  });

  it("waits while a tick is running, then reports drained once it settles", async () => {
    let running = true;
    const monitor = { health: () => ({ running }) };
    let clock = 0;
    const nowMs = () => clock;
    const sleep = async (ms: number) => {
      clock += ms;
      if (clock >= 60) running = false; // the in-flight tick finishes after ~60ms
    };
    expect(await drainInFlightTicks([monitor], 1_000, nowMs, sleep, 20)).toBe(true);
    expect(running).toBe(false);
  });

  it("returns drained=false when a tick stays wedged past the timeout", async () => {
    const wedged = { health: () => ({ running: true }) }; // never settles
    let clock = 0;
    const drained = await drainInFlightTicks([wedged], 100, () => clock, async (ms) => { clock += ms; }, 20);
    expect(drained).toBe(false);
  });
});
