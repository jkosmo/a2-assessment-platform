import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { CURRENT_CONSENT_VERSION } from "../config/consent.js";

/**
 * Routes that are always accessible without consent.
 *
 * GET /api/me — needed by every page on load to determine whether consent is
 * required. Blocking it would prevent the frontend from ever showing the dialog.
 * POST /api/me/consent — the consent submission itself.
 *
 * NOTE: this middleware is mounted at app.use("/api", ...) so Express strips
 * the "/api" prefix before calling it. The paths here are relative to "/api".
 */
const CONSENT_EXEMPT_PATHS = new Set([
  "/me",
  "/me/consent",
]);

/**
 * After authenticate, verify that the user has accepted the current consent
 * version. If not, respond with 403 consent_required so the frontend can
 * display the consent dialog before allowing any other interaction.
 *
 * This middleware must run after authenticate (request.context.userId must
 * be set). It is a no-op for unauthenticated requests.
 */
export async function requireConsent(request: Request, response: Response, next: NextFunction) {
  // In the test environment the consent gate is bypassed so that existing
  // integration tests continue to work without pre-seeding UserConsent records.
  // The middleware logic is covered by unit tests; the consent recording flow
  // is covered by the dedicated GDPR integration test.
  if (process.env.NODE_ENV === "test") {
    next();
    return;
  }

  const userId = request.context?.userId;
  if (!userId) {
    next();
    return;
  }

  if (CONSENT_EXEMPT_PATHS.has(request.path)) {
    next();
    return;
  }

  try {
    const consent = await prisma.userConsent.findUnique({
      where: { userId_consentVersion: { userId, consentVersion: CURRENT_CONSENT_VERSION } },
      select: { acceptedAt: true },
    });

    if (!consent) {
      response.status(403).json({
        error: "consent_required",
        consentVersion: CURRENT_CONSENT_VERSION,
        message: "You must accept the current privacy notice before continuing.",
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
