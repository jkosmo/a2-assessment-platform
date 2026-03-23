import type express from "express";
import { AppError } from "../errors/AppError.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { operationalEvents } from "../observability/operationalEvents.js";

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

  logOperationalEvent(
    operationalEvents.process.unhandledError,
    {
      correlationId: request.context?.correlationId ?? null,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "error",
  );

  response.status(500).json({ error: "internal_error", message: "An unexpected error occurred." });
}
