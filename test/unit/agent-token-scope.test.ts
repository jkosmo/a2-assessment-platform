import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { enforceAgentTokenScope } from "../../src/auth/agentTokenScope.js";

// #778/#819: agent-authoring token scope is a hand-maintained method+path allowlist that must stay in
// sync with the routes. Nothing enforces the linkage, so a carelessly-broadened pattern could let an
// AI-issued credential reach publish/delete/participant surfaces. This pins the boundary: every
// intended draft-authoring route passes, and a representative set of dangerous routes stays 403.

function run(method: string, url: string, opts: { agent?: boolean } = {}) {
  const agent = opts.agent ?? true;
  const request = {
    method,
    originalUrl: url,
    url,
    context: agent ? { agentToken: { id: "aat" } } : {},
  } as unknown as Request;
  let status = 0;
  let body: unknown;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  let nexted = false;
  enforceAgentTokenScope(request, response, () => {
    nexted = true;
  });
  return { nexted, status, body };
}

const ALLOWED: Array<[string, string]> = [
  ["POST", "/api/admin/content/agent-authoring/validate"],
  ["POST", "/api/admin/content/modules/import"],
  ["POST", "/api/admin/content/sections"],
  ["POST", "/api/admin/content/courses"],
  ["PUT", "/api/admin/content/courses/course_abc123/items"],
];

// Anything that mutates lifecycle state, manages tokens, reads content, or touches participant/admin
// surfaces must NOT be reachable by an agent token.
const FORBIDDEN: Array<[string, string]> = [
  ["POST", "/api/admin/content/courses/course_abc/publish"],
  ["POST", "/api/admin/content/courses/course_abc/archive"],
  ["DELETE", "/api/admin/content/courses/course_abc"],
  ["DELETE", "/api/admin/content/modules/mod_abc"],
  ["POST", "/api/admin/content/modules/mod_abc/publish"],
  ["POST", "/api/admin/content/agent-authoring/tokens"], // no self-minting
  ["POST", "/api/admin/content/agent-authoring/tokens/tok_1/revoke"],
  ["GET", "/api/admin/content/sections"], // read is not in scope (only POST create)
  ["GET", "/api/admin/content/courses/course_abc"],
  ["PUT", "/api/admin/content/courses/course_abc"], // course update (not the /items subpath)
  ["POST", "/api/admin/content/courses/course_abc/items"], // wrong method (only PUT allowed)
  ["POST", "/api/submissions"],
  ["GET", "/api/admin/platform/config"],
];

describe("enforceAgentTokenScope (#819)", () => {
  it("passes every intended draft-authoring route", () => {
    for (const [method, url] of ALLOWED) {
      const r = run(method, url);
      expect(r.nexted, `${method} ${url} should be allowed`).toBe(true);
      expect(r.status).toBe(0);
    }
  });

  it("allows an intended route even with a query string", () => {
    const r = run("POST", "/api/admin/content/sections?dryRun=1");
    expect(r.nexted).toBe(true);
  });

  it("blocks every dangerous route with 403 agent_token_scope", () => {
    for (const [method, url] of FORBIDDEN) {
      const r = run(method, url);
      expect(r.nexted, `${method} ${url} must NOT be next()'d`).toBe(false);
      expect(r.status, `${method} ${url} should be 403`).toBe(403);
      expect((r.body as { error?: string })?.error).toBe("agent_token_scope");
    }
  });

  it("does not constrain non-agent requests (no agentToken → always passes through)", () => {
    // A normal user session hitting a forbidden-for-agents route is the middleware's concern of
    // OTHER guards, not this one — this middleware only gates agent tokens.
    for (const [method, url] of FORBIDDEN) {
      const r = run(method, url, { agent: false });
      expect(r.nexted, `${method} ${url} (no agent token) should pass this middleware`).toBe(true);
    }
  });
});
