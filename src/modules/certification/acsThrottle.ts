/**
 * #900: ACS struper parallelle sendinger — «Please try again after N seconds» (HTTP 429).
 *
 * 13.08.2026: sju tildelings-e-poster i samme sekund, alle sju strupet, ingen ny sending, sju
 * deltakere som aldri fikk vite om kurset. En 429 er per definisjon midlertidig og sier selv hvor
 * lenge man skal vente. Den er også TRYGG å prøve på nytt: ACS har avvist forespørselen, ingen e-post
 * er akseptert — i motsetning til et tidsavbrudd (#812), der en ny sending kan bli en dublett.
 *
 * Rene funksjoner så de kan testes uten ACS-klienten.
 */

export type ThrottleDecision = { throttled: true; waitMs: number } | { throttled: false };

const RETRY_AFTER_TEXT = /try again after (\d+) seconds?/i;

/** Er dette ACS-struping, og hvor lenge ber den oss vente? Aldri under 1 s, aldri over `maxWaitMs`. */
export function classifyAcsError(error: unknown, maxWaitMs = 30_000): ThrottleDecision {
  const e = (error ?? {}) as { statusCode?: unknown; status?: unknown; code?: unknown; message?: unknown; response?: { headers?: { get?: (n: string) => string | null | undefined } } };
  const status = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : null;
  const message = typeof e.message === "string" ? e.message : "";
  const headerRetry = e.response?.headers?.get?.("retry-after");
  const textMatch = RETRY_AFTER_TEXT.exec(message);

  const looksThrottled = status === 429 || e.code === "TooManyRequests" || textMatch !== null;
  if (!looksThrottled) return { throttled: false };

  const seconds = headerRetry && /^\d+$/.test(headerRetry) ? Number(headerRetry) : textMatch ? Number(textMatch[1]) : 1;
  const waitMs = Math.min(Math.max(seconds, 1) * 1000, maxWaitMs);
  return { throttled: true, waitMs };
}

/**
 * Feilgrunnen som logges. Før sto det `" - Please try again after 0 seconds."` — statuskoden foran
 * bindestreken var tom, så undersøkelsen måtte gjette. Koden skal med.
 */
export function describeAcsFailure(error: unknown): string {
  const e = (error ?? {}) as { statusCode?: unknown; code?: unknown; message?: unknown };
  const status = typeof e.statusCode === "number" ? String(e.statusCode) : null;
  const code = typeof e.code === "string" && e.code.length > 0 ? e.code : null;
  const message = typeof e.message === "string" && e.message.trim().length > 0 ? e.message.trim() : "acs_send_failed";
  const prefix = [status, code].filter(Boolean).join(" ");
  return prefix ? `${prefix}: ${message}` : message;
}

/** Ventetider for inntil `attempts` forsøk: det ACS ber om, med litt ekstra per runde. */
export function nextAttemptDelayMs(baseWaitMs: number, attemptIndex: number): number {
  return baseWaitMs * (attemptIndex + 1);
}
