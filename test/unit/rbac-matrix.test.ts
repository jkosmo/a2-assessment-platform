/**
 * RBAC matrix tests - verify that each sensitive API route enforces role access correctly.
 *
 * Strategy (mock auth mode):
 * - No role assigned (no x-user-roles header, DB returns empty roles) -> 403
 * - Wrong role -> 403
 *
 * Only denial paths are tested here so the suite runs without a database.
 * "Passes auth" scenarios are covered by the integration test suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { AppRole } from "../../src/db/prismaRuntime.js";
import { rolesFor } from "../../src/config/capabilities.js";
import { getParticipantConsoleRuntimeConfig } from "../../src/config/participantConsole.js";

const mockUpsertUser = vi.fn().mockResolvedValue({ id: "mock-user-id" });
const mockSyncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
const mockGetActiveRoles = vi.fn().mockResolvedValue([]);

vi.mock("../../src/repositories/userRepository.js", () => ({
  upsertUserFromPrincipal: mockUpsertUser,
  syncEntraGroupRoles: mockSyncEntraGroupRoles,
  getActiveRoles: mockGetActiveRoles,
}));

const { app } = await import("../../src/app.js");

type Headers = Record<string, string>;

function asRole(role: string, id = `rbac-${role.toLowerCase()}`): Headers {
  return {
    "x-user-id": id,
    "x-user-email": `${role.toLowerCase()}@rbac-test.internal`,
    "x-user-name": `RBAC Test ${role}`,
    "x-user-roles": role,
  };
}

const NO_ROLE: Headers = {
  "x-user-id": "rbac-no-role",
  "x-user-email": "norole@test.internal",
  "x-user-name": "No Role",
};
const PARTICIPANT = asRole("PARTICIPANT");
const REVIEWER = asRole("REVIEWER");
const ADMINISTRATOR = asRole("ADMINISTRATOR");
const APPEAL_HANDLER = asRole("APPEAL_HANDLER");
const REPORT_READER = asRole("REPORT_READER");
const SUBJECT_MATTER_OWNER = asRole("SUBJECT_MATTER_OWNER");

const ALL_ROLES = [
  AppRole.PARTICIPANT,
  AppRole.REVIEWER,
  AppRole.ADMINISTRATOR,
  AppRole.APPEAL_HANDLER,
  AppRole.REPORT_READER,
  AppRole.SUBJECT_MATTER_OWNER,
] as const;

const HEADERS_BY_ROLE: Record<(typeof ALL_ROLES)[number], Headers> = {
  [AppRole.PARTICIPANT]: PARTICIPANT,
  [AppRole.REVIEWER]: REVIEWER,
  [AppRole.ADMINISTRATOR]: ADMINISTRATOR,
  [AppRole.APPEAL_HANDLER]: APPEAL_HANDLER,
  [AppRole.REPORT_READER]: REPORT_READER,
  [AppRole.SUBJECT_MATTER_OWNER]: SUBJECT_MATTER_OWNER,
};

function expect403(response: supertest.Response) {
  expect(response.status).toBe(403);
}

function deniedHeadersFor(allowedRoles: readonly string[]): [string, Headers][] {
  const allowed = new Set(allowedRoles);
  return ALL_ROLES
    .filter((role) => !allowed.has(role))
    .map((role) => [role, HEADERS_BY_ROLE[role]]);
}

beforeEach(() => {
  mockUpsertUser.mockResolvedValue({ id: "mock-user-id" });
  mockGetActiveRoles.mockResolvedValue([]);
});

describe("RBAC - /api/submissions", () => {
  it.each(deniedHeadersFor(rolesFor("submissions")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/submissions").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/submissions").set(NO_ROLE));
  });
});

describe("RBAC - /api/assessments", () => {
  it.each(deniedHeadersFor(rolesFor("assessments")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/assessments").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/assessments").set(NO_ROLE));
  });
});

describe("RBAC - /api/audit", () => {
  it("403 - no role assigned", async () => {
    expect403(await supertest(app).get("/api/audit/submissions/any-id").set(NO_ROLE));
  });
});

describe("RBAC - /api/reviews", () => {
  it.each(deniedHeadersFor(rolesFor("reviews")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/reviews").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/reviews").set(NO_ROLE));
  });

  it("403 - PARTICIPANT cannot claim a review", async () => {
    expect403(await supertest(app).post("/api/reviews/any-id/claim").set(PARTICIPANT));
  });

  it("403 - APPEAL_HANDLER cannot finalize a review override", async () => {
    expect403(
      await supertest(app)
        .post("/api/reviews/any-id/override")
        .set(APPEAL_HANDLER)
        .send({ outcome: "pass", overrideReason: "test" }),
    );
  });
});

describe("RBAC - /api/appeals", () => {
  it.each(deniedHeadersFor(rolesFor("appeals")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/appeals").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/appeals").set(NO_ROLE));
  });

  it("403 - PARTICIPANT cannot resolve an appeal", async () => {
    expect403(
      await supertest(app)
        .post("/api/appeals/any-id/resolve")
        .set(PARTICIPANT)
        .send({ outcome: "upheld", resolutionReason: "test" }),
    );
  });

  it("403 - REVIEWER cannot claim an appeal", async () => {
    expect403(await supertest(app).post("/api/appeals/any-id/claim").set(REVIEWER));
  });
});

describe("RBAC - /api/reports", () => {
  it.each(deniedHeadersFor(rolesFor("reports")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/reports").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/reports").set(NO_ROLE));
  });
});

describe("RBAC - /api/courses", () => {
  it.each(deniedHeadersFor(rolesFor("courses")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/courses").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/courses").set(NO_ROLE));
  });
});

describe("RBAC - /api/calibration", () => {
  const calibrationRoles = getParticipantConsoleRuntimeConfig().calibrationWorkspace.accessRoles;

  it.each(deniedHeadersFor(calibrationRoles))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/calibration/workspace").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/calibration/workspace").set(NO_ROLE));
  });
});

describe("RBAC - /api/admin/content", () => {
  it.each(deniedHeadersFor(rolesFor("admin_content")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).get("/api/admin/content/modules").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).get("/api/admin/content/modules").set(NO_ROLE));
  });

  it("403 - REVIEWER cannot create a module", async () => {
    expect403(
      await supertest(app)
        .post("/api/admin/content/modules")
        .set(REVIEWER)
        .send({ name: "Test Module" }),
    );
  });
});

describe("RBAC - /api/admin/sync/org", () => {
  it.each(deniedHeadersFor(rolesFor("admin_sync_org")))("403 - %s", async (_, headers) => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(headers));
  });

  it("403 - no role", async () => {
    expect403(await supertest(app).post("/api/admin/sync/org").set(NO_ROLE));
  });
});
