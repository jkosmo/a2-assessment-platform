import { afterEach, describe, expect, it, vi } from "vitest";

function buildRequest(
  headers: Record<string, string> = {},
  options: { method?: string; path?: string; originalUrl?: string; url?: string } = {},
) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const path = options.path ?? "/";

  return {
    method: options.method ?? "GET",
    path,
    originalUrl: options.originalUrl ?? path,
    url: options.url ?? path,
    header(name: string) {
      return normalized[name.toLowerCase()];
    },
    context: {},
  };
}

function buildResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("authenticate middleware", () => {
  it("returns 401 for missing bearer token in entra mode", async () => {
    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "tenant-id",
        ENTRA_AUDIENCE: "api://assessment-api",
        DEFAULT_LOCALE: "nb",
        MOCK_DEFAULT_USER_ID: "unused",
        MOCK_DEFAULT_EMAIL: "unused@company.com",
        MOCK_DEFAULT_NAME: "Unused",
        MOCK_DEFAULT_DEPARTMENT: "Unused",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal: vi.fn(),
      syncEntraGroupRoles: vi.fn(),
      getActiveRoles: vi.fn(),
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest();
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      error: "unauthorized",
      message: "Mangler Bearer-token.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards repository/runtime failures as internal server errors", async () => {
    const upsertUserFromPrincipal = vi.fn().mockResolvedValue({ id: "user-1" });
    const syncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
    const getActiveRoles = vi.fn().mockRejectedValue(new Error("database disk image is malformed"));

    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "mock",
        ENTRA_TENANT_ID: undefined,
        ENTRA_AUDIENCE: undefined,
        DEFAULT_LOCALE: "en-GB",
        MOCK_DEFAULT_USER_ID: "participant-1",
        MOCK_DEFAULT_EMAIL: "participant@company.com",
        MOCK_DEFAULT_NAME: "Platform Participant",
        MOCK_DEFAULT_DEPARTMENT: "Consulting",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal,
      syncEntraGroupRoles,
      getActiveRoles,
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest({
      "x-user-id": "participant-1",
      "x-user-email": "participant@company.com",
      "x-user-name": "Platform Participant",
      "x-user-department": "Consulting",
      "x-user-roles": "PARTICIPANT",
    });
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toMatchObject({
      name: "AppError",
      code: "internal_error",
      httpStatus: 500,
      message: "Internal server error.",
    });
  });

  it("blocks inactive users before role evaluation", async () => {
    const upsertUserFromPrincipal = vi.fn().mockResolvedValue({ id: "user-1", activeStatus: false });
    const syncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
    const getActiveRoles = vi.fn().mockResolvedValue(["PARTICIPANT"]);

    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "mock",
        ENTRA_TENANT_ID: undefined,
        ENTRA_AUDIENCE: undefined,
        DEFAULT_LOCALE: "en-GB",
        MOCK_DEFAULT_USER_ID: "participant-1",
        MOCK_DEFAULT_EMAIL: "participant@company.com",
        MOCK_DEFAULT_NAME: "Platform Participant",
        MOCK_DEFAULT_DEPARTMENT: "Consulting",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal,
      syncEntraGroupRoles,
      getActiveRoles,
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest({
      "x-user-id": "participant-1",
      "x-user-email": "participant@company.com",
      "x-user-name": "Platform Participant",
      "x-user-department": "Consulting",
      "x-user-roles": "PARTICIPANT",
    });
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      error: "forbidden",
      message: "Your account has been deactivated.",
    });
    expect(syncEntraGroupRoles).not.toHaveBeenCalled();
    expect(getActiveRoles).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("allows pseudonymized users to reach the idempotent deletion endpoint", async () => {
    const upsertUserFromPrincipal = vi.fn().mockResolvedValue({
      id: "user-1",
      activeStatus: false,
      isAnonymized: true,
    });
    const syncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
    const getActiveRoles = vi.fn().mockResolvedValue(["PARTICIPANT"]);

    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "mock",
        ENTRA_TENANT_ID: undefined,
        ENTRA_AUDIENCE: undefined,
        DEFAULT_LOCALE: "en-GB",
        MOCK_DEFAULT_USER_ID: "participant-1",
        MOCK_DEFAULT_EMAIL: "participant@company.com",
        MOCK_DEFAULT_NAME: "Platform Participant",
        MOCK_DEFAULT_DEPARTMENT: "Consulting",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal,
      syncEntraGroupRoles,
      getActiveRoles,
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest(
      {
        "x-user-id": "participant-1",
        "x-user-email": "participant@company.com",
        "x-user-name": "Platform Participant",
        "x-user-department": "Consulting",
        "x-user-roles": "PARTICIPANT",
      },
      { method: "POST", path: "/me/deletion", originalUrl: "/api/me/deletion" },
    );
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(syncEntraGroupRoles).not.toHaveBeenCalled();
    expect(getActiveRoles).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(request.context).toMatchObject({
      userId: "user-1",
      roles: [],
    });
  });

  it("returns 403 when login email is linked to a different external identity", async () => {
    const conflict = Object.assign(new Error("Email is already linked."), {
      code: "identity_reconciliation_conflict",
    });
    const upsertUserFromPrincipal = vi.fn().mockRejectedValue(conflict);
    const syncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
    const getActiveRoles = vi.fn().mockResolvedValue(["PARTICIPANT"]);

    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "mock",
        ENTRA_TENANT_ID: undefined,
        ENTRA_AUDIENCE: undefined,
        DEFAULT_LOCALE: "en-GB",
        MOCK_DEFAULT_USER_ID: "participant-1",
        MOCK_DEFAULT_EMAIL: "participant@company.com",
        MOCK_DEFAULT_NAME: "Platform Participant",
        MOCK_DEFAULT_DEPARTMENT: "Consulting",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal,
      syncEntraGroupRoles,
      getActiveRoles,
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest({
      "x-user-id": "attacker-external-id",
      "x-user-email": "participant@company.com",
      "x-user-name": "Platform Participant",
      "x-user-department": "Consulting",
      "x-user-roles": "PARTICIPANT",
    });
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      error: "identity_conflict",
      message: "This email is already linked to a different identity.",
    });
    expect(syncEntraGroupRoles).not.toHaveBeenCalled();
    expect(getActiveRoles).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("merges Entra JWT token roles with DB-assigned roles in Entra mode", async () => {
    const upsertUserFromPrincipal = vi.fn().mockResolvedValue({ id: "user-1" });
    const syncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
    const getActiveRoles = vi.fn().mockResolvedValue(["PARTICIPANT"]);

    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "tenant-id",
        ENTRA_AUDIENCE: "api://assessment-api",
        DEFAULT_LOCALE: "nb",
        MOCK_DEFAULT_USER_ID: "unused",
        MOCK_DEFAULT_EMAIL: "unused@company.com",
        MOCK_DEFAULT_NAME: "Unused",
        MOCK_DEFAULT_DEPARTMENT: "Unused",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal,
      syncEntraGroupRoles,
      getActiveRoles,
    }));
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn().mockReturnValue({}),
      jwtVerify: vi.fn().mockResolvedValue({
        payload: {
          oid: "user-oid-1",
          preferred_username: "jko@a-2.no",
          name: "Joakim Kosmo",
          roles: ["ADMINISTRATOR"],
        },
      }),
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest({ authorization: "Bearer fake-token" });
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(next).toHaveBeenCalledWith();
    const roles = (request.context as { roles?: string[] }).roles ?? [];
    expect(roles).toContain("ADMINISTRATOR");
    expect(roles).toContain("PARTICIPANT");
  });

  it("filters out invalid role names from Entra JWT token", async () => {
    const upsertUserFromPrincipal = vi.fn().mockResolvedValue({ id: "user-1" });
    const syncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
    const getActiveRoles = vi.fn().mockResolvedValue([]);

    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "tenant-id",
        ENTRA_AUDIENCE: "api://assessment-api",
        DEFAULT_LOCALE: "nb",
        MOCK_DEFAULT_USER_ID: "unused",
        MOCK_DEFAULT_EMAIL: "unused@company.com",
        MOCK_DEFAULT_NAME: "Unused",
        MOCK_DEFAULT_DEPARTMENT: "Unused",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal,
      syncEntraGroupRoles,
      getActiveRoles,
    }));
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn().mockReturnValue({}),
      jwtVerify: vi.fn().mockResolvedValue({
        payload: {
          oid: "user-oid-1",
          preferred_username: "jko@a-2.no",
          name: "Joakim Kosmo",
          roles: ["ADMINISTRATORS", "INVALID_ROLE"],
        },
      }),
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest({ authorization: "Bearer fake-token" });
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(next).toHaveBeenCalledWith();
    expect((request.context as { roles?: string[] }).roles).toEqual([]);
  });

  it("uses explicit mock role hints instead of broader stored role assignments", async () => {
    const upsertUserFromPrincipal = vi.fn().mockResolvedValue({ id: "user-1" });
    const syncEntraGroupRoles = vi.fn().mockResolvedValue(undefined);
    const getActiveRoles = vi.fn().mockResolvedValue(["PARTICIPANT", "ADMINISTRATOR"]);

    vi.doMock("../src/config/env.js", () => ({
      env: {
        AUTH_MODE: "mock",
        ENTRA_TENANT_ID: undefined,
        ENTRA_AUDIENCE: undefined,
        DEFAULT_LOCALE: "en-GB",
        MOCK_DEFAULT_USER_ID: "participant-1",
        MOCK_DEFAULT_EMAIL: "participant@company.com",
        MOCK_DEFAULT_NAME: "Platform Participant",
        MOCK_DEFAULT_DEPARTMENT: "Consulting",
      },
    }));
    vi.doMock("../src/repositories/userRepository.js", () => ({
      upsertUserFromPrincipal,
      syncEntraGroupRoles,
      getActiveRoles,
    }));

    const { authenticate } = await import("../src/auth/authenticate.js");
    const request = buildRequest({
      "x-user-id": "participant-1",
      "x-user-email": "participant@company.com",
      "x-user-name": "Platform Participant",
      "x-user-department": "Consulting",
      "x-user-roles": "PARTICIPANT",
    });
    const response = buildResponse();
    const next = vi.fn();

    await authenticate(request as never, response as never, next);

    expect(next).toHaveBeenCalledWith();
    expect((request.context as { roles?: string[] }).roles).toEqual(["PARTICIPANT"]);
  });
});
