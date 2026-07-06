// AA-3 (#651): scope enforcement for agent authoring tokens.
//
// A request authenticated with an agent token (request.context.agentToken) may
// ONLY call the draft-authoring operations the skill orchestrates. Everything
// else — publish/unpublish/archive/delete, token management (no self-minting),
// the rest of the admin surface, participant APIs — is denied with 403.
// Routes add per-call hardening on top (no replaceExisting/autoPublish on
// import, draft-only sections, items only on unpublished courses).

import type { NextFunction, Request, Response } from "express";

const ALLOWED: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/admin\/content\/agent-authoring\/validate\/?$/ },
  { method: "POST", pattern: /^\/api\/admin\/content\/modules\/import\/?$/ },
  { method: "POST", pattern: /^\/api\/admin\/content\/sections\/?$/ },
  { method: "POST", pattern: /^\/api\/admin\/content\/courses\/?$/ },
  { method: "PUT", pattern: /^\/api\/admin\/content\/courses\/[^/]+\/items\/?$/ },
];

export function enforceAgentTokenScope(request: Request, response: Response, next: NextFunction) {
  if (!request.context?.agentToken) {
    next();
    return;
  }
  const path = (request.originalUrl ?? request.url).split("?")[0];
  if (ALLOWED.some((entry) => entry.method === request.method && entry.pattern.test(path))) {
    next();
    return;
  }
  response.status(403).json({
    error: "agent_token_scope",
    message:
      "Agent authoring tokens may only call draft authoring endpoints " +
      "(agent-authoring/validate, modules/import, sections, courses, courses/:id/items).",
  });
}
