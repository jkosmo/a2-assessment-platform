import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { WeeklyDigestMonitor } from "../../src/modules/weeklyDigest/WeeklyDigestMonitor.js";
import { evaluateWorkerHealth } from "../../src/observability/workerHealth.js";

// #1139 skive 3: overvåkeren. Av uten WEEKLY_EMAIL_ENABLED; de første 15 minuttene etter oppstart lages ingen hendelser (12.6), men
// ventetiden teller som en runde, så helsesjekken ikke kaller den stanset.

const mutableEnv = env as unknown as Record<string, unknown>;
const original = { enabled: env.WEEKLY_EMAIL_ENABLED, channel: env.PARTICIPANT_NOTIFICATION_CHANNEL };
afterEach(() => {
  mutableEnv.WEEKLY_EMAIL_ENABLED = original.enabled;
  mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = original.channel;
  vi.useRealTimers();
});

describe("#1139: WeeklyDigestMonitor", () => {
  it("av uten WEEKLY_EMAIL_ENABLED, og med kanalen av", () => {
    mutableEnv.WEEKLY_EMAIL_ENABLED = false;
    mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "log";
    expect(new WeeklyDigestMonitor().health().enabled).toBe(false);
    mutableEnv.WEEKLY_EMAIL_ENABLED = true;
    mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "disabled";
    expect(new WeeklyDigestMonitor().health().enabled).toBe(false);
  });

  it("i ventetiden kjøres ikke jobben, men runden teller; etter ventetiden kjøres den", async () => {
    mutableEnv.WEEKLY_EMAIL_ENABLED = true;
    mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "log";
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const run = vi.fn(async () => ({ queued: 0 }));
    const monitor = new WeeklyDigestMonitor(60_000, run, 15 * 60_000);
    monitor.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run).not.toHaveBeenCalled();
    expect(monitor.health()).toMatchObject({ lastSummary: { skipped: "startup_grace" } });
    expect(monitor.health().lastCycleAt).not.toBeNull();
    // Prosessen har gått lenger enn helsesjekkens nåde for en overvåker som aldri har fullført en runde: likevel frisk.
    const [snapshot] = evaluateWorkerHealth([monitor.health()], new Date(), new Date(Date.now() - 20 * 60_000)).monitors;
    expect(snapshot).toMatchObject({ healthy: true });
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(run).toHaveBeenCalled();
    monitor.stop();
  });
});
