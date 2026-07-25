import { prisma } from "../db/prisma.js";

// #809: the web `/healthz` used to be a static stub returning 200 as soon as Express bound the port —
// before/without DB connectivity. So Azure's health check (healthCheckPath=/healthz), the external
// availability pings, and the post-deploy smoke test couldn't tell a truly-ready web from a bound-but-
// broken one (e.g. DB unreachable). A readiness probe fixes that: /healthz reflects real DB reachability.
//
// Cached so Azure's frequent pings don't hammer the DB, and bounded so a hung DB can never hang the probe
// (which would itself make /healthz time out). A transient blip self-heals on the next check after the
// cache expires; a sustained outage is a real incident the honest 503 should surface, not mask.

const READY_CACHE_MS = 5_000;
const PROBE_TIMEOUT_MS = 2_000;

let lastCheckedAt = 0;
let lastResult = false;

/**
 * True when the DB answered a trivial query within the timeout. Result is cached for READY_CACHE_MS.
 * `now` is injectable for tests.
 */
export async function isWebReady(now: number = Date.now()): Promise<boolean> {
  if (lastCheckedAt !== 0 && now - lastCheckedAt < READY_CACHE_MS) {
    return lastResult;
  }
  lastCheckedAt = now;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("db_probe_timeout")), PROBE_TIMEOUT_MS)),
    ]);
    lastResult = true;
  } catch {
    lastResult = false;
  }
  return lastResult;
}

// Test seam: reset the cache between cases.
export function __resetWebReadinessCache() {
  lastCheckedAt = 0;
  lastResult = false;
}
