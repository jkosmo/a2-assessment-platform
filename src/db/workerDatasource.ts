/**
 * #866: build the WORKER's Postgres connection string with `statement_timeout` + `lock_timeout`.
 *
 * A worker's first tick query (assessment stale-lock scan / outbox claim) can block indefinitely on a
 * row lock held by a zombie `idle in transaction` connection left by an abruptly-killed pre-deploy
 * worker container — wedging `/healthz` for ~10–20 min until Postgres reaps the dead connection.
 * Setting `lock_timeout` (abort a query waiting too long for a lock) + `statement_timeout` (outer cap on
 * any single statement) makes the blocked query ABORT, so the tick fails+retries and the worker
 * self-heals without a manual `az webapp restart`.
 *
 * Pure function (no client/env side effects) so it is unit-testable in isolation. Scoped to the worker
 * container by its single caller in `prisma.ts` (only when `PROCESS_ROLE=worker`).
 */
export function buildWorkerDatasourceUrl(
  baseUrl: string,
  opts: { statementTimeoutMs: number; lockTimeoutMs: number },
): string {
  if (!baseUrl) return baseUrl;
  // libpq startup options: space-separated `-c key=value` pairs passed via the URL `options` param.
  // Encode with encodeURIComponent so a space becomes %20 (NOT the `+` that URLSearchParams emits,
  // which libpq would not decode back to a space).
  const optionsValue = `-c statement_timeout=${opts.statementTimeoutMs} -c lock_timeout=${opts.lockTimeoutMs}`;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}options=${encodeURIComponent(optionsValue)}`;
}
