/**
 * Focused tests for process role flag resolution.
 *
 * These tests verify that the PROCESS_ROLE environment variable maps correctly
 * to the web/worker startup flags without involving database or server setup.
 */
import { describe, expect, it } from "vitest";
import { resolveProcessRoleFlags } from "../../src/index.js";

describe("resolveProcessRoleFlags", () => {
  it("role=web starts web only", () => {
    const flags = resolveProcessRoleFlags("web");
    expect(flags.startWeb).toBe(true);
    expect(flags.startWorkers).toBe(false);
  });

  it("role=worker starts workers only", () => {
    const flags = resolveProcessRoleFlags("worker");
    expect(flags.startWeb).toBe(false);
    expect(flags.startWorkers).toBe(true);
  });

  it("role=all starts both web and workers", () => {
    const flags = resolveProcessRoleFlags("all");
    expect(flags.startWeb).toBe(true);
    expect(flags.startWorkers).toBe(true);
  });

  it("unknown role starts neither", () => {
    const flags = resolveProcessRoleFlags("unknown");
    expect(flags.startWeb).toBe(false);
    expect(flags.startWorkers).toBe(false);
  });
});
