import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LLM_MAX_ATTEMPTS,
  computeLlmBackoffMs,
  fetchAzureOpenAiWithRetry,
  parseRetryAfterMs,
} from "../../src/modules/llm/azureOpenAiRetry.js";

// #603: shared Azure OpenAI transient-failure retry, used by both the authoring (#479) and
// assessment LLM clients. The assessment client previously had no retry — a transient 429 failed a
// participant evaluation outright.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });
  it("parses an HTTP-date into a non-negative delay", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThanOrEqual(0);
  });
  it("returns null for absent/unparseable values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });
});

describe("computeLlmBackoffMs", () => {
  it("honours Retry-After, capped at the max", () => {
    expect(computeLlmBackoffMs(0, 3000)).toBe(3000);
    expect(computeLlmBackoffMs(0, 999_999)).toBe(20_000);
  });
  it("uses capped exponential backoff with jitter when no Retry-After", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ms = computeLlmBackoffMs(attempt, null);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(20_000);
    }
  });
});

describe("fetchAzureOpenAiWithRetry", () => {
  const url = "https://example.test/openai";
  const init = { method: "POST", body: "{}" };

  it("returns immediately on a successful response (no retry)", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchAzureOpenAiWithRetry(url, init);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a non-retryable status (e.g. 400)", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchAzureOpenAiWithRetry(url, init);
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 429 then returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const onRetry = vi.fn();
    const res = await fetchAzureOpenAiWithRetry(url, init, { onRetry });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ status: 429, attempt: 1, maxAttempts: LLM_MAX_ATTEMPTS }));
  });

  it("exhausts the attempt budget on persistent 5xx and returns the last failing response", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchAzureOpenAiWithRetry(url, init, { maxAttempts: 3 });
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
