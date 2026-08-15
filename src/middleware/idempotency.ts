import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils/hash.js";

// #726: retry-safe idempotency for create/import POST endpoints. A request may carry an `Idempotency-Key`
// header. The first request for (userId, endpoint, key) RESERVES a row (status "pending"), runs the
// handler, and stores the response; a replay with the SAME key + SAME payload returns the stored response
// without re-running the handler; a SAME key + DIFFERENT payload is a 409. Rows expire after the TTL.
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

async function storeOrRelease(
  where: { userId: string; endpoint: string; key: string },
  statusCode: number,
  body: unknown,
): Promise<void> {
  // Only a success is worth replaying; a failed attempt releases its reservation so the client can retry.
  if (statusCode >= 200 && statusCode < 300) {
    await prisma.idempotencyKey.updateMany({
      where: { ...where, status: "pending" },
      data: { status: "completed", statusCode, responseJson: JSON.stringify(body ?? null) },
    });
  } else {
    await prisma.idempotencyKey.deleteMany({ where: { ...where, status: "pending" } });
  }
}

/**
 * `endpoint` may be a plain string, or a function of the request for routes where the same
 * endpoint addresses different resources. #906: a composed module-version save must key on the
 * module too — otherwise the same Idempotency-Key and body sent to two different modules replays
 * the first module's response for the second, before ownership is even checked, and the second
 * module is never written.
 */
export function idempotency(endpoint: string | ((req: Request) => string)) {
  return async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = req.header("Idempotency-Key");
    const userId = req.context?.userId;
    // No key, or no authenticated user yet → normal flow (the route enforces auth).
    if (!key || !userId) {
      next();
      return;
    }

    const resolvedEndpoint = typeof endpoint === "function" ? endpoint(req) : endpoint;
    const payloadHash = sha256(JSON.stringify(req.body ?? {}));
    const where = { userId, endpoint: resolvedEndpoint, key };

    // Reserve the key. Winning the insert means we own execution; a conflict means someone got there first.
    let owned = false;
    for (let attempt = 0; attempt < 2 && !owned; attempt += 1) {
      const now = new Date();
      try {
        await prisma.idempotencyKey.create({
          data: { userId, endpoint: resolvedEndpoint, key, payloadHash, status: "pending", expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) },
        });
        owned = true;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          next(error as Error);
          return;
        }
        const existing = await prisma.idempotencyKey.findUnique({
          where: { userId_endpoint_key: { userId, endpoint: resolvedEndpoint, key } },
        });
        if (!existing) {
          continue; // raced away (e.g. expiry cleanup) — retry the reserve
        }
        if (existing.expiresAt <= now) {
          // Expired → reclaim and retry the reserve as a fresh request.
          await prisma.idempotencyKey.deleteMany({ where: { id: existing.id, expiresAt: { lte: now } } });
          continue;
        }
        if (existing.payloadHash !== payloadHash) {
          res.status(409).json({
            error: "idempotency_key_reuse",
            message: "This Idempotency-Key was already used with a different request body.",
          });
          return;
        }
        if (existing.status === "completed" && existing.statusCode != null && existing.responseJson != null) {
          res.status(existing.statusCode).json(JSON.parse(existing.responseJson));
          return;
        }
        // Still pending — an identical request is in flight. Ask the client to retry.
        res.status(409).json({
          error: "idempotency_in_progress",
          message: "A request with this Idempotency-Key is still being processed.",
        });
        return;
      }
    }
    if (!owned) {
      // Could not reserve after retrying (persistent contention) — proceed without idempotency protection
      // rather than fail the request outright.
      next();
      return;
    }

    // We own the reservation: capture the response to store it (on 2xx) or release it (on failure).
    const originalJson = res.json.bind(res);
    let settled = false;
    res.json = (body: unknown) => {
      if (!settled) {
        settled = true;
        void storeOrRelease(where, res.statusCode, body).catch(() => {
          /* best-effort: a failed store just means the next replay re-runs the handler */
        });
      }
      return originalJson(body);
    };
    // Safety net: if the response finishes without res.json (e.g. res.end/send), release the reservation.
    res.on("finish", () => {
      if (!settled) {
        settled = true;
        void prisma.idempotencyKey.deleteMany({ where: { ...where, status: "pending" } }).catch(() => {});
      }
    });

    next();
  };
}
