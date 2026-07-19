import express from "express";
import path from "node:path";
import { appName, appVersion } from "./config/appMetadata.js";
import { getParticipantConsoleRuntimeConfig } from "./config/participantConsole.js";
import { SOURCE_MATERIAL_UPLOAD_BODY_LIMIT_BYTES } from "./modules/adminContent/sourceMaterialExtractionService.js";
import { COURSE_IMPORT_BODY_LIMIT_BYTES } from "./modules/adminContent/contentImportService.js";
import { SECTION_CREATE_BODY_LIMIT_BYTES } from "./modules/course/sectionCommands.js";
import { rolesFor } from "./config/capabilities.js";
import { authenticate } from "./auth/authenticate.js";
import { enforceAgentTokenScope } from "./auth/agentTokenScope.js";
import { requireAnyRole } from "./auth/authorization.js";
import { attachCorrelationId, requestLoggingMiddleware } from "./middleware/requestObservability.js";
import { securityHeadersMiddleware } from "./middleware/securityHeaders.js";
import { generalApiLimiter } from "./middleware/rateLimiting.js";
import { errorHandlingMiddleware } from "./middleware/errorHandling.js";
import { requireConsent } from "./middleware/consentMiddleware.js";
import { meRouter } from "./routes/me.js";
import { coursesRouter } from "./routes/courses.js";
import { contentAssetsRouter } from "./routes/contentAssets.js";
import { modulesRouter } from "./routes/modules.js";
import { submissionsRouter } from "./routes/submissions.js";
import { assessmentsRouter } from "./routes/assessments.js";
import { auditRouter } from "./routes/audit.js";
import { reviewsRouter } from "./routes/reviews.js";
import { appealsRouter } from "./routes/appeals.js";
import { reportsRouter } from "./routes/reports.js";
import { cohortStatusRouter } from "./routes/cohortStatus.js";
import { adminContentRouter } from "./routes/adminContent.js";
import { adminModulesRouter } from "./routes/adminModules.js";
import { adminPlatformRouter } from "./routes/adminPlatform.js";
import { orgSyncRouter } from "./routes/orgSync.js";
import { calibrationRouter } from "./routes/calibration.js";
import { queueCountsRouter } from "./routes/queueCounts.js";

const app = express();
// Azure App Service terminates TLS at a single front-end hop and forwards the real client IP in
// X-Forwarded-For. Trust exactly that one hop so req.ip resolves to the client instead of the proxy.
// Without this, every anonymous request shares one proxy-side req.ip, collapsing the IP-keyed rate
// limiters (rateLimiting.ts resolveRateLimitKey falls back to req.ip for unauthenticated callers)
// into a single shared bucket — one noisy client 429s all other anonymous participants. Trust 1 hop
// (not `true`) so a client cannot spoof X-Forwarded-For to forge its key.
app.set("trust proxy", 1);
const participantConsoleRuntimeConfig = getParticipantConsoleRuntimeConfig();
const publicRootPath = path.resolve(process.cwd(), "public");
const publicStaticPath = path.resolve(publicRootPath, "static");

app.use(attachCorrelationId);
app.use(requestLoggingMiddleware);
app.use(securityHeadersMiddleware);
// #479 (Slice A): source-material upload sends files as base64 in JSON (10 MB max → ~13.3 MB
// encoded). Give just that route a larger body limit, derived from the shared single-source-of-
// truth constant so it can never be smaller than a max-size file's base64. Registered before the
// global parser so it parses first (express.json skips once req._body is set), keeping every other
// endpoint at 5 MB. The parser worker (parserApp.ts) uses the SAME constant.
app.use(
  "/api/admin/content/source-material/extract",
  express.json({ limit: SOURCE_MATERIAL_UPLOAD_BODY_LIMIT_BYTES }),
);
// #749 (Layer A): course import inlines section figures/images (base64) → bodies exceed 5 MB.
// Registered before the global parser (express.json skips once req._body is set) so ONLY this
// route gets the larger limit; module import stays at 5 MB (modules carry no assets).
app.use(
  "/api/admin/content/courses/import",
  express.json({ limit: COURSE_IMPORT_BODY_LIMIT_BYTES }),
);
// #763 (Layer B): section create (POST /sections) may inline figures/images (base64) → bodies
// exceed 5 MB. Registered before the global parser so ONLY the /sections routes get the larger
// limit; the express.json parser skips non-JSON (multipart asset uploads) and already-parsed bodies.
app.use(
  "/api/admin/content/sections",
  express.json({ limit: SECTION_CREATE_BODY_LIMIT_BYTES }),
);
app.use(express.json({ limit: "5mb" }));
app.use("/static", express.static(publicStaticPath));
app.use("/static", express.static(publicRootPath));

app.get("/", (_request, response) => {
  response.status(200).send("a2-assessment-platform");
});

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/version", generalApiLimiter, (_request, response) => {
  response.json({ app: appName, version: appVersion });
});

// #580: platform-wide diploma background image, served UNAUTHENTICATED (non-sensitive branding) so
// the certificate page's CSS background and the admin preview <img> can load it without auth
// headers — which a CSS url()/<img> cannot send. 404 when none is configured.
app.get("/certificate-background", generalApiLimiter, async (_request, response, next) => {
  try {
    const { getCertificateBackgroundContent } = await import(
      "./modules/platformConfig/certificateBackgroundService.js"
    );
    const background = await getCertificateBackgroundContent();
    if (!background) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.setHeader("Content-Type", background.mimeType);
    response.setHeader("Cache-Control", "public, max-age=300");
    response.send(background.buffer);
  } catch (error) {
    next(error);
  }
});

app.get("/participant", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "participant.html"));
});

app.get("/participant/completed", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "participant-completed.html"));
});

// #550: printable course certificate view (reads ?id=<certificateId>).
app.get("/certificate", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "certificate.html"));
});

// v1.2.18 (#352): retire transitional routes.
// - GET /admin-content?moduleId=X → 301 to canonical /admin-content/module/X/conversation
// - GET /admin-content/advanced (no module context) → 301 to /admin-content (library)
//
// Canonical routes (still served below):
// - /admin-content                              → library (module picker)
// - /admin-content/module/:moduleId/conversation → Samtale-shell
// - /admin-content/module/:moduleId/advanced     → Avansert editor
app.get("/admin-content", (request, response) => {
  const legacyModuleId = typeof request.query.moduleId === "string" ? request.query.moduleId.trim() : "";
  if (legacyModuleId) {
    response.redirect(301, `/admin-content/module/${encodeURIComponent(legacyModuleId)}/conversation`);
    return;
  }
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-library.html"));
});

app.get("/admin-content/advanced", (_request, response) => {
  // Bare entry to Avansert (no module context) is no longer supported — users must
  // pick a module in the library first, then use the row action "Åpne i Avansert".
  response.redirect(301, "/admin-content");
});

// Module workspace target routes (Issue #322 — active after unified workspace is built)
app.get("/admin-content/module/:moduleId/conversation", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content.html"));
});

app.get("/admin-content/module/:moduleId/advanced", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-advanced.html"));
});

// Courses workspace (Issue #325)
app.get("/admin-content/courses", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-courses.html"));
});

app.get("/admin-content/courses/new", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-courses.html"));
});

app.get("/admin-content/courses/:courseId", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-courses.html"));
});

// Sections workspace (#476 / U1)
app.get("/admin-content/sections", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-sections.html"));
});

// Classes workspace (#645 / CL-3) — #765: moved under the new «Deltakere» area at /deltakere/klasser.
app.get("/deltakere/klasser", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-classes.html"));
});
// #765: 301 the old classes URL to its new home (same redirect pattern as the other moved routes).
app.get("/admin-content/classes", (_request, response) => {
  response.redirect(301, "/deltakere/klasser");
});

// Calibration workspace (Issue #326)
app.get("/admin-content/calibration", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-content-calibration.html"));
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

// #498: teacher/SMO cohort-status dashboard — a «Deltakere»-area sub-tab.
app.get("/deltakere/status", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "cohort-status.html"));
});

app.get("/participant/config", generalApiLimiter, (_request, response) => {
  response.json(participantConsoleRuntimeConfig);
});

app.get("/profile", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "profile.html"));
});

app.get("/admin-platform", (_request, response) => {
  response.sendFile(path.resolve(process.cwd(), "public", "admin-platform.html"));
});

// AA-3 (#651): agent-token-autentiserte requests scopes til draft-authoring-
// endepunktene rett etter autentisering — før noe annet får kjøre.
app.use("/api", authenticate, enforceAgentTokenScope, generalApiLimiter, requireConsent);

app.use("/api/me", meRouter);
app.use("/api/courses", requireAnyRole(rolesFor("courses")), coursesRouter);
app.use("/api/content-assets", requireAnyRole(rolesFor("content_assets")), contentAssetsRouter);
app.use("/api/modules", requireAnyRole(rolesFor("modules")), modulesRouter);
app.use("/api/submissions", requireAnyRole(rolesFor("submissions")), submissionsRouter);
app.use("/api/assessments", requireAnyRole(rolesFor("assessments")), assessmentsRouter);
app.use("/api/audit", requireAnyRole(rolesFor("audit")), auditRouter);
app.use("/api/reviews", requireAnyRole(rolesFor("reviews")), reviewsRouter);
app.use("/api/appeals", requireAnyRole(rolesFor("appeals")), appealsRouter);
app.use("/api/queue-counts", requireAnyRole(rolesFor("queue_counts")), queueCountsRouter);
app.use("/api/reports", requireAnyRole(rolesFor("reports")), reportsRouter);
app.use("/api/cohort-status", requireAnyRole(rolesFor("cohort_dashboard")), cohortStatusRouter);
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
