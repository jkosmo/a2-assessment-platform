import express from "express";
import { AppRole } from "@prisma/client";
import { authenticate } from "./auth/authenticate.js";
import { requireAnyRole } from "./auth/authorization.js";
import { meRouter } from "./routes/me.js";
import { modulesRouter } from "./routes/modules.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok" });
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

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(500).json({ error: "internal_error", message });
});

export { app };
