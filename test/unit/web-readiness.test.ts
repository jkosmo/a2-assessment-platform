import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #809: web /healthz readiness probe — 200 only when the DB answers, cached + bounded.
const queryRaw = vi.fn();
vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

import { isWebReady, __resetWebReadinessCache } from "../../src/observability/webReadiness.js";

describe("isWebReady (#809)", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    __resetWebReadinessCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is ready when the DB answers", async () => {
    queryRaw.mockResolvedValue([{ ok: 1 }]);
    expect(await isWebReady(1_000)).toBe(true);
  });

  it("is not ready when the DB query rejects", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"));
    expect(await isWebReady(1_000)).toBe(false);
  });

  it("caches within the window, then re-checks after it", async () => {
    queryRaw.mockResolvedValue([{ ok: 1 }]);
    expect(await isWebReady(1_000)).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    // within 5s cache window → served from cache, no new probe
    expect(await isWebReady(3_000)).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    // after the window → re-probes, and reflects the new (failing) state
    queryRaw.mockRejectedValue(new Error("down"));
    expect(await isWebReady(7_000)).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("is not ready when the DB probe exceeds the timeout (never hangs /healthz)", async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => {})); // never resolves
    const pending = isWebReady(1_000);
    await vi.advanceTimersByTimeAsync(2_001); // fire the 2s probe timeout
    expect(await pending).toBe(false);
  });
});
