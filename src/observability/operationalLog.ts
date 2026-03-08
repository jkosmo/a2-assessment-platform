import crypto from "node:crypto";

type LogLevel = "info" | "error";

export function resolveCorrelationId(headerValue: string | undefined) {
  const trimmed = headerValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : crypto.randomUUID();
}

export function logOperationalEvent(
  event: string,
  metadata: Record<string, unknown> = {},
  level: LogLevel = "info",
) {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...metadata,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}
