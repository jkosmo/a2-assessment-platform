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
