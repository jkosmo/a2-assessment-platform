import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const findUnique = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: {
    userConsent: { findUnique },
  },
}));

vi.mock("../../src/config/consent.js", () => ({
  CURRENT_CONSENT_VERSION: "1.0",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(overrides: { userId?: string; path?: string } = {}) {
  return {
    context: overrides.userId ? { userId: overrides.userId } : {},
    path: overrides.path ?? "/api/submissions",
  };
}

function buildResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("consent middleware", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    findUnique.mockReset();
  });

  it("calls next() immediately when NODE_ENV is test", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { requireConsent } = await import("../../src/middleware/consentMiddleware.js");
    const request = buildRequest({ userId: "user-1" });
    const response = buildResponse();
    const next = vi.fn();

    await requireConsent(request as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("calls next() when there is no authenticated user", async () => {
    const { requireConsent } = await import("../../src/middleware/consentMiddleware.js");
    const request = buildRequest(); // no userId
    const response = buildResponse();
    const next = vi.fn();

    await requireConsent(request as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("calls next() for GET /me (exempt path, Express strips /api prefix at mount point)", async () => {
    const { requireConsent } = await import("../../src/middleware/consentMiddleware.js");
    const request = buildRequest({ userId: "user-1", path: "/me" });
    const response = buildResponse();
    const next = vi.fn();

    await requireConsent(request as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("calls next() for POST /me/consent (exempt path, Express strips /api prefix at mount point)", async () => {
    const { requireConsent } = await import("../../src/middleware/consentMiddleware.js");
    const request = buildRequest({ userId: "user-1", path: "/me/consent" });
    const response = buildResponse();
    const next = vi.fn();

    await requireConsent(request as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("calls next() when user has accepted the current consent version", async () => {
    findUnique.mockResolvedValue({ acceptedAt: new Date() });

    const { requireConsent } = await import("../../src/middleware/consentMiddleware.js");
    const request = buildRequest({ userId: "user-1", path: "/api/submissions" });
    const response = buildResponse();
    const next = vi.fn();

    await requireConsent(request as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_consentVersion: { userId: "user-1", consentVersion: "1.0" } },
      }),
    );
  });

  it("returns 403 consent_required when user has no consent record", async () => {
    findUnique.mockResolvedValue(null);

    const { requireConsent } = await import("../../src/middleware/consentMiddleware.js");
    const request = buildRequest({ userId: "user-1", path: "/api/submissions" });
    const response = buildResponse();
    const next = vi.fn();

    await requireConsent(request as never, response as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "consent_required",
        consentVersion: "1.0",
      }),
    );
  });

  it("forwards DB errors to next(error)", async () => {
    const dbError = new Error("connection refused");
    findUnique.mockRejectedValue(dbError);

    const { requireConsent } = await import("../../src/middleware/consentMiddleware.js");
    const request = buildRequest({ userId: "user-1", path: "/api/submissions" });
    const response = buildResponse();
    const next = vi.fn();

    await requireConsent(request as never, response as never, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(response.status).not.toHaveBeenCalled();
  });
});
