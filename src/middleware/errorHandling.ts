import type express from "express";
import { AppError } from "../errors/AppError.js";

export function errorHandlingMiddleware(
  error: unknown,
  _request: express.Request,
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

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(500).json({ error: "internal_error", message });
}
