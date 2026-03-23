import { logOperationalEvent } from "../observability/operationalLog.js";
import { operationalEvents } from "../observability/operationalEvents.js";

export type GracefulShutdown = (exitCode?: number) => void;

export function logUnhandledRejection(reason: unknown) {
  logOperationalEvent(
    operationalEvents.process.unhandledRejection,
    {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
    "error",
  );
}

export function logUncaughtException(error: unknown, gracefulShutdown: GracefulShutdown) {
  logOperationalEvent(
    operationalEvents.process.uncaughtException,
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "error",
  );
  gracefulShutdown(1);
}

export function registerProcessErrorHandlers(gracefulShutdown: GracefulShutdown) {
  const handleUnhandledRejection = (reason: unknown) => {
    logUnhandledRejection(reason);
  };
  const handleUncaughtException = (error: unknown) => {
    logUncaughtException(error, gracefulShutdown);
  };

  process.on("unhandledRejection", handleUnhandledRejection);
  process.on("uncaughtException", handleUncaughtException);

  return () => {
    process.off("unhandledRejection", handleUnhandledRejection);
    process.off("uncaughtException", handleUncaughtException);
  };
}
