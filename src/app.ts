import express from "express";
import path from "node:path";
import { appName, appVersion } from "./config/appMetadata.js";
import { getParticipantConsoleRuntimeConfig } from "./config/participantConsole.js";
import { rolesFor } from "./config/capabilities.js";
import { authenticate } from "./auth/authenticate.js";
import { requireAnyRole } from "./auth/authorization.js";
import { attachCorrelationId, requestLoggingMiddleware } from "./middleware/requestObservability.js";
import { generalApiLimiter } from "./middleware/rateLimiting.js";
import { errorHandlingMiddleware } from "./middleware/errorHandling.js";
import { requireConsent } from "./middleware/consentMiddleware.js";
import { meRouter } from "./routes/me.js";
import { coursesRouter } from "./routes/courses.js";
import { modulesRouter } from "./routes/modules.js";
import { submissionsRouter } from "./routes/submissions.js";
import { assessmentsRouter } from "./routes/assessments.js";
import { auditRouter } from "./routes/audit.js";
import { reviewsRouter } from "./routes/reviews.js";
import { appealsRouter } from "./routes/appeals.js";
import { reportsRouter } from "./routes/reports.js";
import { adminContentRouter } from "./routes/adminContent.js";
import { adminModulesRouter } from "./routes/adminModules.js";
import { adminPlatformRouter } from "./routes/adminPlatform.js";
import { orgSyncRouter } from "./routes/orgSync.js";
import { calibrationRouter } from "./routes/calibration.js";

const app = express();
const participantConsoleRuntimeConfig = getParticipantConsoleRuntimeConfig();
const publicRootPath = path.resolve(process.cwd(), "public");
const publicStaticPath = path.resolve(publicRootPath, "static");

app.use(attachCorrelationId);
app.use(requestLoggingMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use("/static", express.static(publicStaticPath));
app.use("/static", express.static(publicRootPath));

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

app.get("/review", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "review.html"));
});

app.get("/calibration", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "calibration.html"));
});

app.get("/results", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "results.html"));
});

app.get("/participant/config", (_request, response) => {
  response.json(participantConsoleRuntimeConfig);
});

app.get("/profile", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "profile.html"));
});

app.get("/admin-platform", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-platform.html"));
});

app.use("/api", authenticate, generalApiLimiter, requireConsent);

app.use("/api/me", meRouter);
app.use("/api/courses", requireAnyRole(rolesFor("courses")), coursesRouter);
app.use("/api/modules", requireAnyRole(rolesFor("modules")), modulesRouter);
app.use("/api/submissions", requireAnyRole(rolesFor("submissions")), submissionsRouter);
app.use("/api/assessments", requireAnyRole(rolesFor("assessments")), assessmentsRouter);
app.use("/api/audit", requireAnyRole(rolesFor("audit")), auditRouter);
app.use("/api/reviews", requireAnyRole(rolesFor("reviews")), reviewsRouter);
app.use("/api/appeals", requireAnyRole(rolesFor("appeals")), appealsRouter);
app.use("/api/reports", requireAnyRole(rolesFor("reports")), reportsRouter);
// Calibration access is a runtime-configurable override — see CALIBRATION_ACCESS_OVERRIDE note in capabilities.ts.
// Roles come from calibrationWorkspace.accessRoles in participant-console.json, not from API_ROUTE_CAPABILITIES.
app.use(
  "/api/calibration",
  requireAnyRole(participantConsoleRuntimeConfig.calibrationWorkspace.accessRoles),
  calibrationRouter,
);
app.use("/api/admin/content", requireAnyRole(rolesFor("admin_content")), adminContentRouter);
app.use("/api/admin/modules", requireAnyRole(rolesFor("admin_modules")), adminModulesRouter);
app.use("/api/admin/platform", requireAnyRole(rolesFor("admin_platform")), adminPlatformRouter);
app.use("/api/admin/sync/org", requireAnyRole(rolesFor("admin_sync_org")), orgSyncRouter);

app.use(errorHandlingMiddleware);

export { app };
