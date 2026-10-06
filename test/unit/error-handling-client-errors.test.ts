import express from "express";
import createError from "http-errors";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Prod 2026-10-05/06: fire ganger «stream is not readable» — en forespørsel med innhold som klienten
// avbrøt mens tjeneren ventet på innlogging. Ingen fikk et svar og ingen så en feil, men feilen ble
// logget som `unhandled_error`, og Sev1-varselet «Unhandled runtime errors detected» gikk til
// produkteier. Det samme gjaldt ugyldig JSON fra en klient: 500 og Sev1 for noe klienten gjorde.

const logOperationalEvent = vi.fn();
vi.mock("../../src/observability/operationalLog.js", () => ({ logOperationalEvent }));

const { errorHandlingMiddleware, isClientAbort } = await import("../../src/middleware/errorHandling.js");

function appThatFailsWith(error: unknown) {
  const app = express();
  app.post("/api/ting", (_request, _response, next) => next(error));
  app.use(errorHandlingMiddleware);
  return app;
}

const hendelser = () => logOperationalEvent.mock.calls.map((c) => ({ event: c[0], level: c[2], ...(c[1] as object) }));

describe("errorHandlingMiddleware — klientens forhold er ikke tjenerens feil", () => {
  beforeEach(() => logOperationalEvent.mockReset());

  it("et avbrutt kall (raw-body: stream is not readable) logges som request_aborted på warn, ikke som unhandled_error", async () => {
    const feil = createError(500, "stream is not readable", { type: "stream.not.readable" });
    const svar = await request(appThatFailsWith(feil)).post("/api/ting").send({ a: 1 });
    expect(svar.status).toBe(400);
    expect(svar.body.error).toBe("request_aborted");
    expect(hendelser()).toEqual([
      expect.objectContaining({ event: "request_aborted", level: "warn", method: "POST", path: "/api/ting", reason: "stream is not readable" }),
    ]);
  });

  it("«request aborted» fra body-parser behandles likt", async () => {
    const svar = await request(appThatFailsWith(createError(400, "request aborted", { type: "request.aborted" }))).post("/api/ting").send({});
    expect(svar.status).toBe(400);
    expect(hendelser().map((h) => h.event)).toEqual(["request_aborted"]);
  });

  it("ugyldig JSON fra klienten gir 400 med årsak, logget som bad_request_body på warn", async () => {
    const feil = createError(400, "Unexpected token } in JSON at position 3", { type: "entity.parse.failed" });
    const svar = await request(appThatFailsWith(feil)).post("/api/ting").send({});
    expect(svar.status).toBe(400);
    expect(svar.body).toEqual({ error: "entity_parse_failed", message: "Unexpected token } in JSON at position 3" });
    expect(hendelser()).toEqual([expect.objectContaining({ event: "bad_request_body", level: "warn", status: 400 })]);
  });

  it("for stort innhold gir 413, ikke 500", async () => {
    const feil = createError(413, "request entity too large", { type: "entity.too.large" });
    const svar = await request(appThatFailsWith(feil)).post("/api/ting").send({});
    expect(svar.status).toBe(413);
    expect(svar.body.error).toBe("entity_too_large");
  });

  it("en vilkårlig feil med et status-felt er fortsatt en tjenerfeil: 500 og unhandled_error", async () => {
    const feil = Object.assign(new Error("Databasen svarer ikke"), { status: 404 });
    const svar = await request(appThatFailsWith(feil)).post("/api/ting").send({});
    expect(svar.status).toBe(500);
    expect(svar.body).toEqual({ error: "internal_error", message: "An unexpected error occurred." });
    expect(hendelser()).toEqual([expect.objectContaining({ event: "unhandled_error", level: "error", error: "Databasen svarer ikke" })]);
  });

  it("en vanlig feil er som før: 500, unhandled_error, meldingen lekker ikke", async () => {
    const svar = await request(appThatFailsWith(new Error("hemmelig"))).post("/api/ting").send({});
    expect(svar.status).toBe(500);
    expect(JSON.stringify(svar.body)).not.toContain("hemmelig");
    expect(hendelser().map((h) => h.event)).toEqual(["unhandled_error"]);
  });

  it("isClientAbort kjenner igjen typene og meldingene, og ikke annet", () => {
    expect(isClientAbort(createError(500, "stream is not readable", { type: "stream.not.readable" }))).toBe(true);
    expect(isClientAbort(new Error("request aborted"))).toBe(true);
    expect(isClientAbort(Object.assign(new Error("socket hang up"), { code: "ECONNABORTED" }))).toBe(true);
    expect(isClientAbort(new Error("stream is not readable, said nobody"))).toBe(false);
    expect(isClientAbort(null)).toBe(false);
    expect(isClientAbort("stream is not readable")).toBe(false);
  });
});
