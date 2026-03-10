import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.resetModules();
});

describe("participant console runtime config in production mode", () => {
  it("returns debugMode false when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();

    const { getParticipantConsoleRuntimeConfig } = await import("../src/config/participantConsole.js");
    const config = getParticipantConsoleRuntimeConfig();

    expect(config.debugMode).toBe(false);
  });

  it("allows Azure-style env override to force debugMode on in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.PARTICIPANT_CONSOLE_DEBUG_MODE = "true";
    vi.resetModules();

    const { getParticipantConsoleRuntimeConfig } = await import("../src/config/participantConsole.js");
    const config = getParticipantConsoleRuntimeConfig();

    expect(config.debugMode).toBe(true);
  });
});
