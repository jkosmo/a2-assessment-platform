import { logOperationalEvent } from "../observability/operationalLog.js";
import { operationalEvents } from "../observability/operationalEvents.js";

// #810: gracefulShutdown is async (it drains in-flight worker ticks before exiting). Error handlers
// fire-and-forget it — they don't await — so a void-or-Promise return type keeps both callers valid.
export type GracefulShutdown = (exitCode?: number) => void | Promise<void>;

// #813: an unhandled rejection means a defect escaped all handling — the process may have partially
// mutated state and can no longer be trusted to serve/schedule reliably. Log, then graceful-shutdown
// with a non-zero exit so App Service restarts a clean process (same treatment as an uncaught exception;
// handled domain failures never reach here). Node would otherwise leave the process running.
export function logUnhandledRejection(reason: unknown, gracefulShutdown: GracefulShutdown) {
  logOperationalEvent(
    operationalEvents.process.unhandledRejection,
    {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
    "error",
  );
  gracefulShutdown(1);
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
    logUnhandledRejection(reason, gracefulShutdown);
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
