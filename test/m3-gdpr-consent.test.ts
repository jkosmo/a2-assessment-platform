/**
 * Integration tests for the GDPR consent and data-rights API.
 *
 * Uses a dedicated test user ("gdpr-test-user-1") to avoid polluting shared
 * test fixtures. All consent and deletion state is isolated to this user.
 *
 * NOTE: The consent middleware bypasses enforcement in NODE_ENV=test
 * (same pattern as logOperationalEvent). These tests validate the recording
 * flow — that /api/me correctly reports consent state, that POST /api/me/consent
 * records acceptance, and that the deletion API works end-to-end.
 */
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { CURRENT_CONSENT_VERSION } from "../src/config/consent.js";

const gdprUserHeaders = {
  "x-user-id": "gdpr-test-user-1",
  "x-user-email": "gdpr.test@company.com",
  "x-user-name": "GDPR Test User",
  "x-user-department": "Legal",
};

describe("GDPR consent and data-rights API", () => {
  afterAll(async () => {
    // Clean up: delete the test user and all related records
    const user = await prisma.user.findUnique({ where: { externalId: "gdpr-test-user-1" } });
    if (user) {
      await prisma.userConsent.deleteMany({ where: { userId: user.id } });
      await prisma.deletionRequest.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  // ── GET /api/me ───────────────────────────────────────────────────────────

  describe("GET /api/me", () => {
    it("returns user profile and consent.accepted=false on first call", async () => {
      const response = await request(app).get("/api/me").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe("gdpr.test@company.com");
      expect(response.body.user.name).toBe("GDPR Test User");
      expect(response.body.consent.accepted).toBe(false);
      expect(response.body.consent.currentVersion).toBe(CURRENT_CONSENT_VERSION);
      expect(response.body.consent.acceptedAt).toBeNull();
      expect(response.body.pendingDeletion).toBeNull();
    });

    it("includes roles array in user object", async () => {
      const response = await request(app).get("/api/me").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.user.roles)).toBe(true);
    });
  });

  // ── GET /api/me/consent ───────────────────────────────────────────────────

  describe("GET /api/me/consent", () => {
    it("returns consent config with body and version", async () => {
      const response = await request(app).get("/api/me/consent").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(response.body.version).toBe(CURRENT_CONSENT_VERSION);
      expect(typeof response.body.body).toBe("string");
      expect(response.body.body.length).toBeGreaterThan(50);
      expect(typeof response.body.platformName).toBe("string");
    });
  });

  // ── POST /api/me/consent ──────────────────────────────────────────────────

  describe("POST /api/me/consent", () => {
    it("rejects an unknown consent version with 409", async () => {
      const response = await request(app)
        .post("/api/me/consent")
        .set(gdprUserHeaders)
        .send({ consentVersion: "99.0" });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("consent_version_mismatch");
    });

    it("rejects missing body with 400", async () => {
      const response = await request(app)
        .post("/api/me/consent")
        .set(gdprUserHeaders)
        .send({});

      expect(response.status).toBe(400);
    });

    it("accepts the current consent version and records it", async () => {
      const response = await request(app)
        .post("/api/me/consent")
        .set(gdprUserHeaders)
        .send({ consentVersion: CURRENT_CONSENT_VERSION });

      expect(response.status).toBe(200);
      expect(response.body.accepted).toBe(true);
    });

    it("GET /api/me returns consent.accepted=true after acceptance", async () => {
      const response = await request(app).get("/api/me").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(response.body.consent.accepted).toBe(true);
      expect(response.body.consent.acceptedAt).not.toBeNull();
    });

    it("is idempotent — re-accepting the same version returns 200", async () => {
      const response = await request(app)
        .post("/api/me/consent")
        .set(gdprUserHeaders)
        .send({ consentVersion: CURRENT_CONSENT_VERSION });

      expect(response.status).toBe(200);
      expect(response.body.accepted).toBe(true);
    });
  });

  // ── GET /api/me/data ──────────────────────────────────────────────────────

  describe("GET /api/me/data", () => {
    it("returns full data export with expected top-level keys", async () => {
      const response = await request(app).get("/api/me/data").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(typeof response.body.exportedAt).toBe("string");
      expect(response.body.profile).toBeTruthy();
      expect(Array.isArray(response.body.submissions)).toBe(true);
      expect(Array.isArray(response.body.appeals)).toBe(true);
      expect(Array.isArray(response.body.consentHistory)).toBe(true);
      expect(Array.isArray(response.body.deletionHistory)).toBe(true);
      expect(Array.isArray(response.body.accessLog)).toBe(true);
    });

    it("includes the accepted consent record in consentHistory", async () => {
      const response = await request(app).get("/api/me/data").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      const consentRecord = response.body.consentHistory.find(
        (c: { consentVersion: string }) => c.consentVersion === CURRENT_CONSENT_VERSION,
      );
      expect(consentRecord).toBeDefined();
      expect(consentRecord.acceptedAt).not.toBeNull();
    });
  });

  // ── POST /api/me/deletion (grace period) ─────────────────────────────────

  describe("grace-period deletion flow", () => {
    it("POST /api/me/deletion with immediate=false returns PENDING", async () => {
      const response = await request(app)
        .post("/api/me/deletion")
        .set(gdprUserHeaders)
        .send({ immediate: false });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("PENDING");
      expect(response.body.effectiveAt).not.toBeNull();
    });

    it("GET /api/me shows pendingDeletion.effectiveAt after grace request", async () => {
      const response = await request(app).get("/api/me").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(response.body.pendingDeletion).not.toBeNull();
      expect(response.body.pendingDeletion.effectiveAt).not.toBeNull();
      expect(response.body.pendingDeletion.trigger).toBe("USER_REQUEST");
    });

    it("second POST /api/me/deletion returns 409 — already has a pending request", async () => {
      const response = await request(app)
        .post("/api/me/deletion")
        .set(gdprUserHeaders)
        .send({ immediate: false });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("deletion_request_exists");
    });

    it("DELETE /api/me/deletion cancels the pending request", async () => {
      const response = await request(app)
        .delete("/api/me/deletion")
        .set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(response.body.cancelled).toBe(true);
    });

    it("GET /api/me shows pendingDeletion=null after cancellation", async () => {
      const response = await request(app).get("/api/me").set(gdprUserHeaders);

      expect(response.status).toBe(200);
      expect(response.body.pendingDeletion).toBeNull();
    });

    it("DELETE /api/me/deletion returns 404 when nothing to cancel", async () => {
      const response = await request(app)
        .delete("/api/me/deletion")
        .set(gdprUserHeaders);

      expect(response.status).toBe(404);
    });
  });

  // ── POST /api/me/deletion (immediate) ────────────────────────────────────

  describe("immediate pseudonymisation", () => {
    it("POST /api/me/deletion with immediate=true returns COMPLETED and scrubs user", async () => {
      const response = await request(app)
        .post("/api/me/deletion")
        .set(gdprUserHeaders)
        .send({ immediate: true });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("COMPLETED");
      expect(response.body.effectiveAt).toBeNull();
    });

    it("user is now pseudonymised in the database", async () => {
      const user = await prisma.user.findUnique({ where: { externalId: "gdpr-test-user-1" } });

      expect(user).toBeTruthy();
      expect(user!.isAnonymized).toBe(true);
      expect(user!.email).toMatch(/^pseudo-[0-9a-f]{16}@deleted\.invalid$/);
      expect(user!.name).not.toBe("GDPR Test User");
    });

    it("POST /api/me/deletion again returns 409 — already pseudonymised", async () => {
      const response = await request(app)
        .post("/api/me/deletion")
        .set(gdprUserHeaders)
        .send({ immediate: true });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("already_pseudonymized");
    });
  });
});
