// Shared Azure OpenAI transient-failure retry (#479 authoring, #603 assessment).
//
// Azure OpenAI returns 429 ("too_many_requests") when a deployment's tokens-per-minute quota is
// exceeded, and 5xx on transient gateway errors. A single un-retried 429/5xx aborts the whole
// operation — for authoring that loses a generated module, for assessment it fails a participant's
// evaluation. Both call sites retry with backoff that honours the server's Retry-After.
//
// This module is the single source of truth for that retry policy; `llmContentGenerationService`
// (authoring) and `llmAssessmentService` (assessment) both build on `fetchAzureOpenAiWithRetry`.

export const LLM_MAX_ATTEMPTS = 4;
export const LLM_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const LLM_BACKOFF_BASE_MS = 1_000;
const LLM_BACKOFF_MAX_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Parses a Retry-After header (delta-seconds or HTTP-date). Returns null when absent/unparseable.
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// Backoff for attempt N (0-based): honour Retry-After if the server sent one, otherwise exponential
// (1s, 2s, 4s, …) capped, with jitter to avoid thundering-herd retries across concurrent calls.
export function computeLlmBackoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, LLM_BACKOFF_MAX_MS);
  const exponential = Math.min(LLM_BACKOFF_BASE_MS * 2 ** attempt, LLM_BACKOFF_MAX_MS);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

export interface LlmRetryNotice {
  status: number;
  waitMs: number;
  attempt: number; // 1-based for display
  maxAttempts: number;
}

/**
 * Performs `fetch(url, init)` and retries on transient 429/5xx with Retry-After-aware backoff.
 * Returns the final `Response` — including the last still-failing one after the attempt budget is
 * exhausted, so callers keep full control over non-OK handling (status, body parsing, fallbacks).
 * Non-retryable statuses (e.g. 400-class) return immediately on the first attempt.
 */
export async function fetchAzureOpenAiWithRetry(
  url: string,
  init: RequestInit,
  opts?: { maxAttempts?: number; onRetry?: (notice: LlmRetryNotice) => void },
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? LLM_MAX_ATTEMPTS;
  let response: Response | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    response = await fetch(url, init);

    if (response.ok || !LLM_RETRYABLE_STATUSES.has(response.status)) return response;

    // Retryable (429/5xx). Back off and retry unless this was the last attempt.
    if (attempt < maxAttempts - 1) {
      const waitMs = computeLlmBackoffMs(attempt, parseRetryAfterMs(response.headers.get("retry-after")));
      opts?.onRetry?.({ status: response.status, waitMs, attempt: attempt + 1, maxAttempts });
      await sleep(waitMs);
    }
  }

  return response as Response;
}
