import { afterEach, describe, expect, it, vi } from "vitest";

// #497 — CourseReminderMonitor is env-gated on PARTICIPANT_NOTIFICATION_CHANNEL and must never crash
// the worker when a schedule run throws. We toggle the channel via a mutable mock env object.

const mockEnv = {
  PARTICIPANT_NOTIFICATION_CHANNEL: "log" as string,
  COURSE_REMINDER_INTERVAL_MS: 86_400_000,
};

vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));
vi.mock("../../src/modules/course/courseReminderService.js", () => ({
  runCourseReminderSchedule: vi.fn().mockResolvedValue({ sent: 0 }),
}));

const { CourseReminderMonitor } = await import("../../src/modules/course/CourseReminderMonitor.js");

afterEach(() => {
  mockEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "log";
  vi.clearAllMocks();
});

describe("CourseReminderMonitor (#497)", () => {
  it("does not schedule when the notification channel is disabled", () => {
    mockEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "disabled";
    const run = vi.fn().mockResolvedValue({});
    const monitor = new CourseReminderMonitor(1000, run);
    monitor.start();
    expect(monitor.getStatus().enabled).toBe(false);
    expect(run).not.toHaveBeenCalled();
    monitor.stop();
  });

  it("runs an immediate tick on start when enabled", async () => {
    const run = vi.fn().mockResolvedValue({ sent: 2 });
    const monitor = new CourseReminderMonitor(1_000_000, run);
    monitor.start();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const status = monitor.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.lastError).toBeNull();
    expect(status.lastSummary).toEqual({ sent: 2 });
    monitor.stop();
  });

  it("swallows a schedule error without crashing and records lastError", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const monitor = new CourseReminderMonitor(1_000_000, run);
    monitor.start();
    await vi.waitFor(() => expect(monitor.getStatus().lastError).toBe("boom"));
    monitor.stop();
    warn.mockRestore();
  });

  it("stop() is safe when never started", () => {
    const monitor = new CourseReminderMonitor(1000, vi.fn());
    expect(() => monitor.stop()).not.toThrow();
  });
});
