import type { NextFunction, Request, Response } from "express";
import { logOperationalEvent, resolveCorrelationId } from "../observability/operationalLog.js";
import { operationalEvents } from "../observability/operationalEvents.js";

const CORRELATION_ID_HEADER = "x-correlation-id";

export function attachCorrelationId(request: Request, response: Response, next: NextFunction) {
  const correlationId = resolveCorrelationId(request.header(CORRELATION_ID_HEADER));
  request.context = {
    ...(request.context ?? {}),
    correlationId,
  };
  response.setHeader(CORRELATION_ID_HEADER, correlationId);
  next();
}

export function requestLoggingMiddleware(request: Request, response: Response, next: NextFunction) {
  const start = Date.now();
  response.on("finish", () => {
    logOperationalEvent(operationalEvents.http.request, {
      correlationId: request.context?.correlationId ?? null,
      method: request.method,
      path: request.originalUrl,
      statusCode: response.statusCode,
      durationMs: Date.now() - start,
      userId: request.context?.userId ?? null,
    });
  });
  next();
}
