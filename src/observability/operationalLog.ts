import crypto from "node:crypto";
import type { OperationalEventMetadataByName, OperationalEventName } from "./operationalEvents.js";

// «warn» er for det som er klientens forhold (et avbrutt kall, ugyldig JSON): verdt å se, men ikke
// en tjenerfeil, og ikke noe varslene på «error» skal utløse på.
type LogLevel = "info" | "warn" | "error";

export function resolveCorrelationId(headerValue: string | undefined) {
  const trimmed = headerValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : crypto.randomUUID();
}

export function logOperationalEvent<TEvent extends OperationalEventName>(
  event: TEvent,
  metadata: OperationalEventMetadataByName[TEvent],
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
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
