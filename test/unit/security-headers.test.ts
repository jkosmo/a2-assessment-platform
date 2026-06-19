import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { securityHeadersMiddleware } from "../../src/middleware/securityHeaders.js";

// #393: verify defense-in-depth response headers are applied to every response.
function buildTestApp() {
  const app = express();
  app.use(securityHeadersMiddleware);
  app.get("/probe", (_request, response) => {
    response.status(200).send("ok");
  });
  return app;
}

describe("securityHeadersMiddleware", () => {
  it("sets a Content-Security-Policy with strict script-src 'self'", async () => {
    const response = await request(buildTestApp()).get("/probe");
    const csp = response.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    // blob: is required so authenticated course-asset images can render (#483/F4).
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("does NOT allow inline or external script execution", async () => {
    const response = await request(buildTestApp()).get("/probe");
    const csp = response.headers["content-security-policy"] ?? "";
    // The whole point of #393: script-src must not carry 'unsafe-inline' or a wildcard.
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
  });

  it("allows the Entra login origin for MSAL connect/frame/form", async () => {
    const response = await request(buildTestApp()).get("/probe");
    const csp = response.headers["content-security-policy"] ?? "";
    expect(csp).toContain("connect-src 'self' https://login.microsoftonline.com");
    expect(csp).toContain("frame-src https://login.microsoftonline.com");
    expect(csp).toContain("form-action 'self' https://login.microsoftonline.com");
  });

  it("sets the companion hardening headers", async () => {
    const response = await request(buildTestApp()).get("/probe");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
