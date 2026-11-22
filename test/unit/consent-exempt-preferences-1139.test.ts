import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireConsent } from "../../src/middleware/consentMiddleware.js";

// #1139 (PLAN_1139 12.7): å melde seg av den ukentlige e-posten skal aldri sperres av samtykket. I testmiljøet er sperren slått av
// (NODE_ENV=test), så unntaket måles her med miljøet satt til produksjon. Unntaket slipper forespørselen videre FØR databasen spørres.

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

function call(path: string) {
  const next = vi.fn() as unknown as NextFunction;
  const status = vi.fn().mockReturnThis();
  const response = { status, json: vi.fn() } as unknown as Response;
  const request = { path, context: { userId: "u-1" } } as unknown as Request;
  return { next, status, run: () => requireConsent(request, response, next) };
}

describe("#1139: /me/preferences er unntatt fra samtykkesperren", () => {
  it("slipper gjennom uten samtykke, før databasen spørres", async () => {
    process.env.NODE_ENV = "production";
    const exempt = call("/me/preferences");
    await exempt.run();
    expect(exempt.next).toHaveBeenCalledWith();
    expect(exempt.status).not.toHaveBeenCalled();
  });
});
