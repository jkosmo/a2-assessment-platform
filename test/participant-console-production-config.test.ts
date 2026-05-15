import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("participant console runtime config in production mode", () => {
  it("returns debugMode false when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "entra");
    vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("ENTRA_TENANT_ID", "tenant-id");
    vi.stubEnv("ENTRA_CLIENT_ID", "client-id");
    vi.stubEnv("ENTRA_AUDIENCE", "api://assessment-api");
    vi.resetModules();

    const { getParticipantConsoleRuntimeConfig } = await import("../src/config/participantConsole.js");
    const config = getParticipantConsoleRuntimeConfig();

    expect(config.debugMode).toBe(false);
  });

  it("allows Azure-style env override to force debugMode on in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "entra");
    vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("ENTRA_TENANT_ID", "tenant-id");
    vi.stubEnv("ENTRA_CLIENT_ID", "client-id");
    vi.stubEnv("ENTRA_AUDIENCE", "api://assessment-api");
    vi.stubEnv("PARTICIPANT_CONSOLE_DEBUG_MODE", "true");
    vi.resetModules();

    const { getParticipantConsoleRuntimeConfig } = await import("../src/config/participantConsole.js");
    const config = getParticipantConsoleRuntimeConfig();

    expect(config.debugMode).toBe(true);
  });
});
