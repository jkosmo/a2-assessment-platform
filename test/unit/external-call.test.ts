import { afterEach, describe, expect, it, vi } from "vitest";
import {
  withTimeout,
  fetchWithDeadlineAndRetry,
  ExternalCallTimeoutError,
} from "../../src/clients/externalCall.js";

// #812: external calls (ACS email, Microsoft Graph) must be bounded in time so a hung dependency can't
// wedge a worker loop. These tests pin the deadline + bounded-retry behaviour.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("withTimeout (#812)", () => {
  it("resolves with the value when the promise settles before the deadline", async () => {
    await expect(withTimeout(Promise.resolve(42), 1_000, "fast")).resolves.toBe(42);
  });

  it("rejects with ExternalCallTimeoutError when the deadline passes", async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const pending = withTimeout(never, 100, "slow");
    const assertion = expect(pending).rejects.toBeInstanceOf(ExternalCallTimeoutError);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
  });
});

describe("fetchWithDeadlineAndRetry (#812)", () => {
  it("returns immediately on a 2xx (single attempt)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithDeadlineAndRetry("https://x", {}, { timeoutMs: 1_000, label: "t" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a non-retryable 4xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithDeadlineAndRetry("https://x", {}, { timeoutMs: 1_000, label: "t" });
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 503 with backoff, then returns the eventual 200", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchWithDeadlineAndRetry("https://x", {}, { timeoutMs: 1_000, label: "t", maxAttempts: 3 });
    await vi.advanceTimersByTimeAsync(5_000); // let the backoff elapse
    const res = await pending;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a hung request at the deadline and surfaces a timeout on the final attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchWithDeadlineAndRetry("https://x", {}, { timeoutMs: 100, label: "hung", maxAttempts: 1 });
    const assertion = expect(pending).rejects.toBeInstanceOf(ExternalCallTimeoutError);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
