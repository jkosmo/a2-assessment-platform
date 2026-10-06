import type express from "express";
import { AppError } from "../errors/AppError.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { operationalEvents } from "../observability/operationalEvents.js";

// Feil fra body-parser/raw-body bærer en HTTP-status og en `type` (http-errors). De er klientens
// forhold, ikke tjenerens — men uten dette ble de logget som `unhandled_error` og svart med 500.
//
// Prod 2026-10-05 og -06: fire ganger «stream is not readable» — en forespørsel med innhold som
// klienten avbrøt (siden lastet på nytt) mens tjeneren ventet på innlogging. Ingen fikk et svar,
// ingen så en feil, men Sev1-varselet «Unhandled runtime errors detected» gikk til produkteier.
interface HttpLikeError {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
  expose?: unknown;
  message?: unknown;
}

/** Er klienten borte? Node setter `destroyed` på forespørselen når socketen er lukket. */
function requestIsGone(request: Pick<express.Request, "destroyed" | "socket"> | undefined): boolean {
  if (!request) return false;
  return request.destroyed === true || request.socket?.destroyed === true;
}

/**
 * Klienten gikk sin vei før innholdet var lest.
 *
 * «stream is not readable» betyr også «noe annet har alt lest innholdet» — en feil i vår egen kode
 * (QA-porten, 2.84.1). Den regnes derfor som avbrudd bare når klienten faktisk er borte; ellers er
 * den en tjenerfeil som skal varsles.
 */
export function isClientAbort(error: unknown, request?: Pick<express.Request, "destroyed" | "socket">): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as HttpLikeError;
  if (e.type === "request.aborted" || e.message === "request aborted") return true;
  if ((error as { code?: unknown }).code === "ECONNABORTED") return true;
  if (e.type === "stream.not.readable" || e.message === "stream is not readable") return requestIsGone(request);
  return false;
}

/** En klientfeil fra body-parseren: ugyldig JSON, for stort innhold, feil tegnsett. */
function clientBodyStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as HttpLikeError;
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : null;
  if (status === null || status < 400 || status >= 500) return null;
  // Bare feil som sier selv at de kan vises (http-errors setter `expose` for all 4xx — også `send`
  // sitt 416 ved et umulig Range-hode går hit) eller som har en `type`. En vilkårlig feil med et
  // status-felt er fortsatt en tjenerfeil.
  return e.expose === true || typeof e.type === "string" ? status : null;
}

export function errorHandlingMiddleware(
  error: unknown,
  request: express.Request,
  response: express.Response,
  _next: express.NextFunction,
) {
  if (error instanceof AppError) {
    const body: Record<string, unknown> = {
      error: error.code,
      message: error.message,
    };

    if (error.details !== undefined) {
      body.details = error.details;
    }

    response.status(error.httpStatus).json(body);
    return;
  }

  const correlationId = request.context?.correlationId ?? null;

  if (isClientAbort(error, request)) {
    logOperationalEvent(
      operationalEvents.http.requestAborted,
      { correlationId, method: request.method, path: request.path, reason: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    // Klienten er borte; svaret når ingen. Et 400 gjør at forespørselen likevel avsluttes ryddig.
    if (!response.headersSent) response.status(400).json({ error: "request_aborted", message: "The request was aborted before its body was read." });
    return;
  }

  const bodyStatus = clientBodyStatus(error);
  if (bodyStatus !== null) {
    const e = error as HttpLikeError;
    const reason = typeof e.message === "string" ? e.message : String(error);
    logOperationalEvent(
      operationalEvents.http.badRequestBody,
      { correlationId, method: request.method, path: request.path, status: bodyStatus, reason },
      "warn",
    );
    const code = typeof e.type === "string" ? e.type.replace(/\./g, "_") : "bad_request";
    response.status(bodyStatus).json({ error: code, message: reason });
    return;
  }

  logOperationalEvent(
    operationalEvents.process.unhandledError,
    {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "error",
  );

  response.status(500).json({ error: "internal_error", message: "An unexpected error occurred." });
}
