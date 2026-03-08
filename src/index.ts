import { env } from "./config/env.js";
import { app } from "./app.js";
import { startAssessmentWorker, stopAssessmentWorker } from "./services/assessmentJobService.js";

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`a2-assessment-platform listening on port ${env.PORT}`);
});

startAssessmentWorker();

const gracefulShutdown = () => {
  stopAssessmentWorker();
  server.close(() => process.exit(0));
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
