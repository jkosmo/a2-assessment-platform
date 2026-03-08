import { env } from "./config/env.js";
import { app } from "./app.js";
import { startAssessmentWorker, stopAssessmentWorker } from "./services/assessmentJobService.js";
import { spawn } from "node:child_process";
import path from "node:path";

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`a2-assessment-platform listening on port ${env.PORT}`);
  startBootstrapSeed();
});

startAssessmentWorker();

function startBootstrapSeed() {
  const scriptPath = path.resolve(process.cwd(), "scripts", "runtime", "bootstrapSeed.mjs");
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("Bootstrap seed process failed to start.", error);
  });

  child.on("exit", (code) => {
    if (code === 0) {
      return;
    }
    // eslint-disable-next-line no-console
    console.error(`Bootstrap seed process exited with code ${code ?? "unknown"}.`);
  });
}

const gracefulShutdown = () => {
  stopAssessmentWorker();
  server.close(() => process.exit(0));
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
