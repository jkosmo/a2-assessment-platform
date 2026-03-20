/**
 * RBAC matrix tests — verify that each sensitive API route enforces role access correctly.
 *
 * Strategy (mock auth mode):
 *  - No role assigned (no x-user-roles header, DB returns empty roles) → 403
 *  - Wrong role → 403  (requireAnyRole rejects)
 *
 * Only denial paths are tested here so the suite runs without a database.
 * "Passes auth" scenarios are covered by the integration test suite (requires DB).
 * The user repository is mocked so these tests never hit Prisma.
 * getActiveRoles returns [] so mock mode role-hint headers are always authoritative.
 *
 * Related issues: #211
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";

// ---------------------------------------------------------------------------
// Mock user repository — must be defined before app is imported
// ---------------------------------------------------------------------------

const mockUpsertUser = vi.fn().mockResolvedValue({ id: "mock-user-id" });
const mockSyncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
const mockGetActiveRoles = vi.fn().mockResolvedValue([]);

vi.mock("../../src/repositories/userRepository.js", () => ({
  upsertUserFromPrincipal: mockUpsertUser,
  syncEntraGroupRoles: mockSyncEntraGroupRoles,
  getActiveRoles: mockGetActiveRoles,
}));

const { app } = await import("../../src/app.js");

// ---------------------------------------------------------------------------
// Role header factories
// ---------------------------------------------------------------------------

function asRole(role: string, id = `rbac-${role.toLowerCase()}`) {
  return {
    "x-user-id": id,
    "x-user-email": `${role.toLowerCase()}@rbac-test.internal`,
    "x-user-name": `RBAC Test ${role}`,
    "x-user-roles": role,
  };
}

const NO_ROLE = { "x-user-id": "rbac-no-role", "x-user-email": "norole@test.internal", "x-user-name": "No Role" };
const PARTICIPANT = asRole("PARTICIPANT");
const REVIEWER = asRole("REVIEWER");
const ADMINISTRATOR = asRole("ADMINISTRATOR");
const APPEAL_HANDLER = asRole("APPEAL_HANDLER");
const REPORT_READER = asRole("REPORT_READER");
const SUBJECT_MATTER_OWNER = asRole("SUBJECT_MATTER_OWNER");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expect403(response: supertest.Response) {
  expect(response.status).toBe(403);
}

beforeEach(() => {
  mockUpsertUser.mockResolvedValue({ id: "mock-user-id" });
  mockGetActiveRoles.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// /api/reviews — ADMINISTRATOR, REVIEWER
// ---------------------------------------------------------------------------

describe("RBAC — /api/reviews (allowed: ADMINISTRATOR, REVIEWER)", () => {
  it("403 — no role assigned", async () => {
    expect403(await supertest(app).get("/api/reviews").set(NO_ROLE));
  });

  it("403 — PARTICIPANT", async () => {
    expect403(await supertest(app).get("/api/reviews").set(PARTICIPANT));
  });

  it("403 — APPEAL_HANDLER", async () => {
    expect403(await supertest(app).get("/api/reviews").set(APPEAL_HANDLER));
  });

  it("403 — REPORT_READER", async () => {
    expect403(await supertest(app).get("/api/reviews").set(REPORT_READER));
  });

  it("403 — SUBJECT_MATTER_OWNER", async () => {
    expect403(await supertest(app).get("/api/reviews").set(SUBJECT_MATTER_OWNER));
  });

  it("403 — PARTICIPANT cannot claim a review", async () => {
    expect403(await supertest(app).post("/api/reviews/any-id/claim").set(PARTICIPANT));
  });

  it("403 — APPEAL_HANDLER cannot finalize a review override", async () => {
    expect403(
      await supertest(app)
        .post("/api/reviews/any-id/override")
        .set(APPEAL_HANDLER)
        .send({ outcome: "pass", overrideReason: "test" }),
    );
  });
});

// ---------------------------------------------------------------------------
// /api/appeals — ADMINISTRATOR, APPEAL_HANDLER
// ---------------------------------------------------------------------------

describe("RBAC — /api/appeals (allowed: ADMINISTRATOR, APPEAL_HANDLER)", () => {
  it("403 — no role assigned", async () => {
    expect403(await supertest(app).get("/api/appeals").set(NO_ROLE));
  });

  it("403 — PARTICIPANT", async () => {
    expect403(await supertest(app).get("/api/appeals").set(PARTICIPANT));
  });

  it("403 — REVIEWER", async () => {
    expect403(await supertest(app).get("/api/appeals").set(REVIEWER));
  });

  it("403 — REPORT_READER", async () => {
    expect403(await supertest(app).get("/api/appeals").set(REPORT_READER));
  });

  it("403 — SUBJECT_MATTER_OWNER", async () => {
    expect403(await supertest(app).get("/api/appeals").set(SUBJECT_MATTER_OWNER));
  });

  it("403 — PARTICIPANT cannot resolve an appeal", async () => {
    expect403(
      await supertest(app)
        .post("/api/appeals/any-id/resolve")
        .set(PARTICIPANT)
        .send({ outcome: "upheld", resolutionReason: "test" }),
    );
  });

  it("403 — REVIEWER cannot claim an appeal", async () => {
    expect403(await supertest(app).post("/api/appeals/any-id/claim").set(REVIEWER));
  });
});

// ---------------------------------------------------------------------------
// /api/admin/content — ADMINISTRATOR, SUBJECT_MATTER_OWNER
// ---------------------------------------------------------------------------

describe("RBAC — /api/admin/content (allowed: ADMINISTRATOR, SUBJECT_MATTER_OWNER)", () => {
  it("403 — no role assigned", async () => {
    expect403(await supertest(app).get("/api/admin/content/modules").set(NO_ROLE));
  });

  it("403 — PARTICIPANT", async () => {
    expect403(await supertest(app).get("/api/admin/content/modules").set(PARTICIPANT));
  });

  it("403 — REVIEWER", async () => {
    expect403(await supertest(app).get("/api/admin/content/modules").set(REVIEWER));
  });

  it("403 — APPEAL_HANDLER", async () => {
    expect403(await supertest(app).get("/api/admin/content/modules").set(APPEAL_HANDLER));
  });

  it("403 — REPORT_READER", async () => {
    expect403(await supertest(app).get("/api/admin/content/modules").set(REPORT_READER));
  });

  it("403 — REVIEWER cannot create a module", async () => {
    expect403(
      await supertest(app)
        .post("/api/admin/content/modules")
        .set(REVIEWER)
        .send({ name: "Test Module" }),
    );
  });
});

// ---------------------------------------------------------------------------
// /api/admin/sync/org — ADMINISTRATOR only
// ---------------------------------------------------------------------------

describe("RBAC — /api/admin/sync/org (allowed: ADMINISTRATOR only)", () => {
  it("403 — no role assigned", async () => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(NO_ROLE));
  });

  it("403 — REVIEWER", async () => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(REVIEWER));
  });

  it("403 — PARTICIPANT", async () => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(PARTICIPANT));
  });

  it("403 — APPEAL_HANDLER", async () => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(APPEAL_HANDLER));
  });

  it("403 — REPORT_READER", async () => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(REPORT_READER));
  });

  it("403 — SUBJECT_MATTER_OWNER", async () => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(SUBJECT_MATTER_OWNER));
  });

});

// ---------------------------------------------------------------------------
// /api/reports — ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER
// ---------------------------------------------------------------------------

describe("RBAC — /api/reports (allowed: ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER)", () => {
  it("403 — no role assigned", async () => {
    expect403(await supertest(app).get("/api/reports").set(NO_ROLE));
  });

  it("403 — PARTICIPANT", async () => {
    expect403(await supertest(app).get("/api/reports").set(PARTICIPANT));
  });

  it("403 — REVIEWER", async () => {
    expect403(await supertest(app).get("/api/reports").set(REVIEWER));
  });

  it("403 — APPEAL_HANDLER", async () => {
    expect403(await supertest(app).get("/api/reports").set(APPEAL_HANDLER));
  });

});

// ---------------------------------------------------------------------------
// /api/submissions — PARTICIPANT, ADMINISTRATOR, REVIEWER
// ---------------------------------------------------------------------------

describe("RBAC — /api/submissions (allowed: PARTICIPANT, ADMINISTRATOR, REVIEWER)", () => {
  it("403 — no role assigned", async () => {
    expect403(await supertest(app).get("/api/submissions").set(NO_ROLE));
  });

  it("403 — APPEAL_HANDLER", async () => {
    expect403(await supertest(app).get("/api/submissions").set(APPEAL_HANDLER));
  });

  it("403 — REPORT_READER", async () => {
    expect403(await supertest(app).get("/api/submissions").set(REPORT_READER));
  });

  it("403 — SUBJECT_MATTER_OWNER", async () => {
    expect403(await supertest(app).get("/api/submissions").set(SUBJECT_MATTER_OWNER));
  });

});
