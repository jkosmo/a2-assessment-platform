import { describe, expect, it, vi } from "vitest";
import { classifyAcsError, describeAcsFailure, nextAttemptDelayMs } from "../../src/modules/certification/acsThrottle.js";
import { sendWithThrottleRetry } from "../../src/modules/certification/participantNotificationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// #900: 13.08.2026 kl. 08:01 — sju tildelings-e-poster i samme sekund, sju ganger
// «Please try again after 0 seconds», ingen ny sending, sju deltakere som aldri fikk vite om kurset.
//
// ⚠️ Retry BARE på struping. Et tidsavbrudd (#812) kan bety at e-posten ble akseptert; en ny sending
// der er en dublett. En 429 er en avvisning før aksept, og er trygg.
// ─────────────────────────────────────────────────────────────────────────────

function restError(statusCode: number, message: string, code?: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

describe("#900 — classifyAcsError", () => {
  it("⚠️ 429 med «try again after N seconds» er struping, og ventetiden er det ACS ber om", () => {
    expect(classifyAcsError(restError(429, "Please try again after 7 seconds."))).toEqual({ throttled: true, waitMs: 7000 });
  });

  it("«after 0 seconds» (det ekte tilfellet) gir minst ett sekund — ikke en tett løkke", () => {
    expect(classifyAcsError(restError(429, " - Please try again after 0 seconds."))).toEqual({ throttled: true, waitMs: 1000 });
  });

  it("⚠️ tidsavbrudd og andre feil er IKKE struping — de skal ikke prøves på nytt", () => {
    expect(classifyAcsError(new Error("acs_email_send timed out after 30000ms"))).toEqual({ throttled: false });
    expect(classifyAcsError(restError(500, "Internal error"))).toEqual({ throttled: false });
    expect(classifyAcsError(restError(401, "Unauthorized"))).toEqual({ throttled: false });
  });

  it("ventetiden har et tak", () => {
    expect(classifyAcsError(restError(429, "try again after 900 seconds"))).toEqual({ throttled: true, waitMs: 30_000 });
  });
});

describe("#900 — describeAcsFailure tar med koden", () => {
  it("⚠️ statuskoden står foran meldingen — før var den tom", () => {
    expect(describeAcsFailure(restError(429, "Please try again after 0 seconds.", "TooManyRequests"))).toBe("429 TooManyRequests: Please try again after 0 seconds.");
    expect(describeAcsFailure(new Error("boom"))).toBe("boom");
    expect(describeAcsFailure(undefined)).toBe("acs_send_failed");
  });
});

describe("#900 — sendWithThrottleRetry", () => {
  it("⚠️ strupet to ganger, lykkes på tredje — og venter det ACS ba om", async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(restError(429, "try again after 2 seconds"))
      .mockRejectedValueOnce(restError(429, "try again after 3 seconds"))
      .mockResolvedValueOnce({ status: "Succeeded" });
    const waits: number[] = [];
    const result = await sendWithThrottleRetry(attempt, { wait: async (ms) => { waits.push(ms); } });
    expect(result).toEqual({ status: "Succeeded" });
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([nextAttemptDelayMs(2000, 0), nextAttemptDelayMs(3000, 1)]);
  });

  it("⚠️ kontrollcase: et tidsavbrudd prøves IKKE på nytt", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("acs_email_send timed out after 30000ms"));
    await expect(sendWithThrottleRetry(attempt, { wait: async () => {} })).rejects.toThrow("timed out");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("gir opp etter siste forsøk og kaster den siste strupefeilen", async () => {
    const attempt = vi.fn().mockRejectedValue(restError(429, "try again after 1 seconds"));
    await expect(sendWithThrottleRetry(attempt, { attempts: 3, wait: async () => {} })).rejects.toMatchObject({ statusCode: 429 });
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
