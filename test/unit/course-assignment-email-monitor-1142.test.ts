import { afterEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";
import { evaluateWorkerHealth } from "../../src/observability/workerHealth.js";

// #1142 skive 3: jobben som lager radene for e-posten om nye kurs, kjører hvert minutt når varselkanalen er på. Ingen egen
// bryter (spørsmål 3): kanalen `disabled` på workeren er nødstoppen. En feil i en runde velter ikke workeren, og siste
// sammendrag står i helsesvaret (`courseAssignmentEmailMonitor`), så utrullingen kan se at jobben går (planen, punkt 7).

const mockEnv = { PARTICIPANT_NOTIFICATION_CHANNEL: "log" as string };

vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));
vi.mock("../../src/modules/course/courseAssignmentNotice.js", () => ({
  runCourseAssignmentEmailSchedule: vi.fn().mockResolvedValue({ queued: 0 }),
}));

const { CourseAssignmentEmailMonitor, COURSE_ASSIGNMENT_EMAIL_INTERVAL_MS } = await import("../../src/modules/course/CourseAssignmentEmailMonitor.js");

afterEach(() => {
  mockEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "log";
  vi.clearAllMocks();
});

warmModuleGraph(() => import("../../src/modules/course/CourseAssignmentEmailMonitor.js"));

describe("CourseAssignmentEmailMonitor (#1142 skive 3)", () => {
  it("hvert minutt, uten egen innstilling", () => {
    expect(COURSE_ASSIGNMENT_EMAIL_INTERVAL_MS).toBe(60_000);
    expect(new CourseAssignmentEmailMonitor().health()).toMatchObject({ name: "courseAssignmentEmailMonitor", intervalMs: 60_000 });
  });

  it("kjører ikke når varselkanalen er av", () => {
    mockEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "disabled";
    const run = vi.fn().mockResolvedValue({});
    const monitor = new CourseAssignmentEmailMonitor(1000, run);
    monitor.start();
    expect(monitor.getStatus().enabled).toBe(false);
    expect(monitor.health()).toMatchObject({ name: "courseAssignmentEmailMonitor", enabled: false });
    expect(run).not.toHaveBeenCalled();
    monitor.stop();
  });

  it.each(["log", "acs_email", "webhook"])("kanalen %s: en runde med én gang, og sammendraget står i status og i helsesvaret", async (channel) => {
    mockEnv.PARTICIPANT_NOTIFICATION_CHANNEL = channel;
    const run = vi.fn().mockResolvedValue({ queued: 3, created: 5 });
    const monitor = new CourseAssignmentEmailMonitor(1_000_000, run);
    monitor.start();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(monitor.getStatus()).toMatchObject({ enabled: true, lastError: null, lastSummary: { queued: 3, created: 5 } });
    const report = evaluateWorkerHealth([monitor.health()], new Date(), new Date());
    expect(report.monitors[0]).toMatchObject({ name: "courseAssignmentEmailMonitor", healthy: true, lastSummary: { queued: 3, created: 5 } });
    // De andre jobbene har ikke feltet, og helsesvaret deres er som før.
    const { lastSummary: _ignored, ...withoutSummary } = monitor.health();
    expect(evaluateWorkerHealth([withoutSummary], new Date(), new Date()).monitors[0]).not.toHaveProperty("lastSummary");
    monitor.stop();
  });

  it("en feil i en runde svelges og står som lastError", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const monitor = new CourseAssignmentEmailMonitor(1_000_000, run);
    monitor.start();
    await vi.waitFor(() => expect(monitor.getStatus().lastError).toBe("boom"));
    monitor.stop();
    warn.mockRestore();
  });
});
