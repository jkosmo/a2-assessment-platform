import express from "express";
import path from "node:path";
import { AppRole } from "./db/prismaRuntime.js";
import { appName, appVersion } from "./config/appMetadata.js";
import { authenticate } from "./auth/authenticate.js";
import { requireAnyRole } from "./auth/authorization.js";
import { attachCorrelationId, requestLoggingMiddleware } from "./middleware/requestObservability.js";
import { meRouter } from "./routes/me.js";
import { modulesRouter } from "./routes/modules.js";
import { submissionsRouter } from "./routes/submissions.js";
import { assessmentsRouter } from "./routes/assessments.js";
import { auditRouter } from "./routes/audit.js";
import { reviewsRouter } from "./routes/reviews.js";
import { appealsRouter } from "./routes/appeals.js";

const app = express();

app.use(attachCorrelationId);
app.use(requestLoggingMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use("/static", express.static(path.resolve(process.cwd(), "public")));

app.get("/", (_request, response) => {
  response.status(200).send("a2-assessment-platform");
});

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok", version: appVersion });
});

app.get("/version", (_request, response) => {
  response.json({ app: appName, version: appVersion });
});

app.get("/participant", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "participant.html"));
});

app.use("/api", authenticate);

app.use("/api/me", meRouter);
app.use(
  "/api/modules",
  requireAnyRole([
    AppRole.PARTICIPANT,
    AppRole.SUBJECT_MATTER_OWNER,
    AppRole.ADMINISTRATOR,
    AppRole.APPEAL_HANDLER,
    AppRole.REPORT_READER,
    AppRole.REVIEWER,
  ]),
  modulesRouter,
);
app.use(
  "/api/submissions",
  requireAnyRole([AppRole.PARTICIPANT, AppRole.ADMINISTRATOR, AppRole.REVIEWER]),
  submissionsRouter,
);
app.use(
  "/api/assessments",
  requireAnyRole([AppRole.PARTICIPANT, AppRole.ADMINISTRATOR, AppRole.REVIEWER]),
  assessmentsRouter,
);
app.use(
  "/api/audit",
  requireAnyRole([
    AppRole.PARTICIPANT,
    AppRole.SUBJECT_MATTER_OWNER,
    AppRole.ADMINISTRATOR,
    AppRole.APPEAL_HANDLER,
    AppRole.REPORT_READER,
    AppRole.REVIEWER,
  ]),
  auditRouter,
);
app.use("/api/reviews", requireAnyRole([AppRole.ADMINISTRATOR, AppRole.REVIEWER]), reviewsRouter);
app.use("/api/appeals", requireAnyRole([AppRole.ADMINISTRATOR, AppRole.APPEAL_HANDLER]), appealsRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(500).json({ error: "internal_error", message });
});

export { app };
