import { env } from "./config/env.js";
import { app } from "./app.js";
import http from "node:http";
import { registerProcessErrorHandlers } from "./process/processErrorHandlers.js";
import { AssessmentWorker } from "./modules/assessment/index.js";
import { AppealSlaMonitor } from "./modules/appeal/index.js";
import { PseudonymizationMonitor } from "./modules/user/PseudonymizationMonitor.js";
import { AuditRetentionMonitor } from "./modules/retention/AuditRetentionMonitor.js";

export function resolveProcessRoleFlags(role: string) {
  return {
    startWeb: role === "web" || role === "all",
    startWorkers: role === "worker" || role === "all",
  };
}

const { startWeb, startWorkers } = resolveProcessRoleFlags(env.PROCESS_ROLE);
const startedAt = new Date();

let server: ReturnType<typeof app.listen> | null = null;
let shuttingDown = false;
const assessmentWorker = startWorkers ? new AssessmentWorker(env.ASSESSMENT_JOB_POLL_INTERVAL_MS) : null;
const appealSlaMonitor = startWorkers ? new AppealSlaMonitor(env.APPEAL_SLA_MONITOR_INTERVAL_MS) : null;
const pseudonymizationMonitor = startWorkers ? new PseudonymizationMonitor() : null;
const auditRetentionMonitor = startWorkers ? new AuditRetentionMonitor() : null;

const gracefulShutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  appealSlaMonitor?.stop();
  assessmentWorker?.stop();
  pseudonymizationMonitor?.stop();
  auditRetentionMonitor?.stop();

  if (!server) {
    process.exit(exitCode);
    return;
  }

  server.close(() => process.exit(exitCode));
};

registerProcessErrorHandlers(gracefulShutdown);

void startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Application startup failed.", error);
  gracefulShutdown(1);
});

async function startServer() {
  if (startWeb) {
    server = app.listen(env.PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`a2-assessment-platform listening on port ${env.PORT} [role=${env.PROCESS_ROLE}]`);
    });
  } else {
    // Worker-only mode: bind health endpoint so Azure App Service keeps the process alive
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        role: env.PROCESS_ROLE,
        startedAt: startedAt.toISOString(),
        worker: assessmentWorker?.getStatus() ?? null,
      }));
    }).listen(env.PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`a2-assessment-platform workers started [role=${env.PROCESS_ROLE}]`);
    });
  }

  if (startWorkers) {
    assessmentWorker!.start();
    appealSlaMonitor!.start();
    pseudonymizationMonitor!.start();
    auditRetentionMonitor!.start();
  }
}

process.on("SIGINT", () => gracefulShutdown(0));
process.on("SIGTERM", () => gracefulShutdown(0));
