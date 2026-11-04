import { afterEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// #934 skive 4b: jobben som sender e-posten om ny hovedversjon, kjører bare når COURSE_MAJOR_EMAIL_ENABLED er på
// (og varselkanalen er på). Av: ingen hendelse av den nye typen legges i outboxen — en gammel worker uten behandleren
// møter den derfor aldri (doc/DESIGN_934.md, «Utrulling»). En feil i en runde velter ikke workeren.

const mockEnv = {
  COURSE_MAJOR_EMAIL_ENABLED: false,
  COURSE_MAJOR_EMAIL_INTERVAL_MS: 60_000,
  PARTICIPANT_NOTIFICATION_CHANNEL: "log" as string,
};

vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));
vi.mock("../../src/modules/course/courseMajorVersionEmail.js", () => ({
  runCourseMajorEmailSchedule: vi.fn().mockResolvedValue({ queued: 0 }),
}));

const { CourseMajorEmailMonitor } = await import("../../src/modules/course/CourseMajorEmailMonitor.js");

afterEach(() => {
  mockEnv.COURSE_MAJOR_EMAIL_ENABLED = false;
  mockEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "log";
  vi.clearAllMocks();
});

warmModuleGraph(() => import("../../src/modules/course/CourseMajorEmailMonitor.js"));

describe("CourseMajorEmailMonitor (#934 skive 4b)", () => {
  it("kjører ikke når innstillingen er av (standarden)", () => {
    const run = vi.fn().mockResolvedValue({});
    const monitor = new CourseMajorEmailMonitor(1000, run);
    monitor.start();
    expect(monitor.getStatus().enabled).toBe(false);
    expect(monitor.health()).toMatchObject({ name: "courseMajorEmailMonitor", enabled: false });
    expect(run).not.toHaveBeenCalled();
    monitor.stop();
  });

  it("kjører ikke når varselkanalen er av, selv med innstillingen på", () => {
    mockEnv.COURSE_MAJOR_EMAIL_ENABLED = true;
    mockEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "disabled";
    const run = vi.fn().mockResolvedValue({});
    const monitor = new CourseMajorEmailMonitor(1000, run);
    monitor.start();
    expect(monitor.getStatus().enabled).toBe(false);
    expect(run).not.toHaveBeenCalled();
    monitor.stop();
  });

  it("med innstillingen på: en runde med én gang, og oppsummeringen står i status", async () => {
    mockEnv.COURSE_MAJOR_EMAIL_ENABLED = true;
    const run = vi.fn().mockResolvedValue({ queued: 3 });
    const monitor = new CourseMajorEmailMonitor(1_000_000, run);
    monitor.start();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(monitor.getStatus()).toMatchObject({ enabled: true, lastError: null, lastSummary: { queued: 3 } });
    monitor.stop();
  });

  it("en feil i en runde svelges og står som lastError", async () => {
    mockEnv.COURSE_MAJOR_EMAIL_ENABLED = true;
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const monitor = new CourseMajorEmailMonitor(1_000_000, run);
    monitor.start();
    await vi.waitFor(() => expect(monitor.getStatus().lastError).toBe("boom"));
    monitor.stop();
    warn.mockRestore();
  });
});
