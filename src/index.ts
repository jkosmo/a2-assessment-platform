import { env } from "./config/env.js";
import { app } from "./app.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { registerProcessErrorHandlers } from "./process/processErrorHandlers.js";
import { AssessmentWorker } from "./services/AssessmentWorker.js";
import { AppealSlaMonitor } from "./services/AppealSlaMonitor.js";

let server: ReturnType<typeof app.listen> | null = null;
let shuttingDown = false;
const assessmentWorker = new AssessmentWorker(env.ASSESSMENT_JOB_POLL_INTERVAL_MS);
const appealSlaMonitor = new AppealSlaMonitor(env.APPEAL_SLA_MONITOR_INTERVAL_MS);

const gracefulShutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  appealSlaMonitor.stop();
  assessmentWorker.stop();

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
  await runBootstrapSeed();

  server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`a2-assessment-platform listening on port ${env.PORT}`);
  });

  assessmentWorker.start();
  appealSlaMonitor.start();
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
