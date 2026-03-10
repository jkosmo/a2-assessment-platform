import express from "express";
import path from "node:path";
import { AppRole } from "./db/prismaRuntime.js";
import { appName, appVersion } from "./config/appMetadata.js";
import { getParticipantConsoleRuntimeConfig } from "./config/participantConsole.js";
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
import { reportsRouter } from "./routes/reports.js";
import { adminContentRouter } from "./routes/adminContent.js";
import { orgSyncRouter } from "./routes/orgSync.js";
import { calibrationRouter } from "./routes/calibration.js";

const app = express();
const participantConsoleRuntimeConfig = getParticipantConsoleRuntimeConfig();

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

app.get("/participant/completed", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "participant-completed.html"));
});

app.get("/admin-content", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content.html"));
});

app.get("/appeal-handler", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "appeal-handler.html"));
});

app.get("/calibration", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "calibration.html"));
});

app.get("/participant/config", (_request, response) => {
  response.json(participantConsoleRuntimeConfig);
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
app.use(
  "/api/reports",
  requireAnyRole([AppRole.ADMINISTRATOR, AppRole.REPORT_READER, AppRole.SUBJECT_MATTER_OWNER]),
  reportsRouter,
);
app.use(
  "/api/calibration",
  requireAnyRole(participantConsoleRuntimeConfig.calibrationWorkspace.accessRoles),
  calibrationRouter,
);
app.use(
  "/api/admin/content",
  requireAnyRole([AppRole.ADMINISTRATOR, AppRole.SUBJECT_MATTER_OWNER]),
  adminContentRouter,
);
app.use("/api/admin/sync/org", requireAnyRole([AppRole.ADMINISTRATOR]), orgSyncRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(500).json({ error: "internal_error", message });
});

export { app };
