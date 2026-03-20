import { env } from "./config/env.js";
import { app } from "./app.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { registerProcessErrorHandlers } from "./process/processErrorHandlers.js";
import { AssessmentWorker } from "./services/AssessmentWorker.js";
import { AppealSlaMonitor } from "./services/AppealSlaMonitor.js";

const role = env.PROCESS_ROLE;
const startWeb = role === "web" || role === "all";
const startWorkers = role === "worker" || role === "all";

let server: ReturnType<typeof app.listen> | null = null;
let shuttingDown = false;
const assessmentWorker = startWorkers ? new AssessmentWorker(env.ASSESSMENT_JOB_POLL_INTERVAL_MS) : null;
const appealSlaMonitor = startWorkers ? new AppealSlaMonitor(env.APPEAL_SLA_MONITOR_INTERVAL_MS) : null;

const gracefulShutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  appealSlaMonitor?.stop();
  assessmentWorker?.stop();

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
    await runBootstrapSeed();
    server = app.listen(env.PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`a2-assessment-platform listening on port ${env.PORT} [role=${role}]`);
    });
  }

  if (startWorkers) {
    assessmentWorker!.start();
    appealSlaMonitor!.start();
    if (!startWeb) {
      // eslint-disable-next-line no-console
      console.log(`a2-assessment-platform workers started [role=${role}]`);
    }
  }
}

function runBootstrapSeed() {
  const scriptPath = path.resolve(process.cwd(), "scripts", "runtime", "bootstrapSeed.mjs");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      // eslint-disable-next-line no-console
      console.error("Bootstrap seed process failed to start.", error);
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Bootstrap seed process exited with code ${code ?? "unknown"}.`));
    });
  });
}

process.on("SIGINT", () => gracefulShutdown(0));
process.on("SIGTERM", () => gracefulShutdown(0));
