// #812: external calls (ACS email, Microsoft Graph) had no deadlines. Node's global fetch has NO
// default timeout, and the ACS SDK's pollUntilDone() polls until the service responds — so a slow or
// unresponsive dependency could block a worker tick indefinitely, wedging the loop (the failure #809
// makes visible and #810 has to force past on shutdown). This module bounds those calls in time.

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ExternalCallTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`External call '${label}' exceeded its ${ms}ms deadline`);
    this.name = "ExternalCallTimeoutError";
  }
}

/**
 * Bound a promise that offers no native cancellation (e.g. an SDK poller). On timeout we stop awaiting
 * and reject; the underlying operation may still complete server-side, so this must only wrap
 * operations that are IDEMPOTENT or dedup-guarded by the caller (a retry/re-run must not double-effect).
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ExternalCallTimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DEFAULT_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MAX_MS = 8_000;

function backoffMs(attempt: number): number {
  // attempt is 1-based; exponential (1s, 2s, 4s…) capped, with jitter to avoid synchronized retries.
  const exponential = Math.min(1_000 * 2 ** (attempt - 1), BACKOFF_MAX_MS);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

export interface FetchWithDeadlineOptions {
  timeoutMs: number;
  label: string;
  maxAttempts?: number;
  retryableStatuses?: Set<number>;
  onRetry?: (info: { attempt: number; maxAttempts: number; reason: string }) => void;
}

/**
 * fetch() with an abort-based per-attempt deadline plus bounded retry with backoff. A hung request is
 * aborted at `timeoutMs` (turning into an ExternalCallTimeoutError on the final attempt); transient
 * failures (network error / 429 / 5xx) are retried. ONLY for IDEMPOTENT requests (typically GET): a
 * retry re-issues the request, so running it more than once must be safe.
 */
export async function fetchWithDeadlineAndRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithDeadlineOptions,
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryable = opts.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || !retryable.has(response.status)) return response;
      if (attempt === maxAttempts) return response; // out of budget — hand the last failing response back
      opts.onRetry?.({ attempt, maxAttempts, reason: `status ${response.status}` });
    } catch (error) {
      // An abort surfaces as an AbortError — normalize it to a clear deadline error on the last attempt.
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastError = isAbort ? new ExternalCallTimeoutError(opts.label, opts.timeoutMs) : error;
      if (attempt === maxAttempts) throw lastError;
      opts.onRetry?.({ attempt, maxAttempts, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
    }
    await sleep(backoffMs(attempt));
  }

  // Unreachable in practice (the loop returns/throws on the final attempt), but keeps the type total.
  throw lastError instanceof Error ? lastError : new Error(`fetch '${opts.label}' failed`);
}
