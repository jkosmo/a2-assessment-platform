import "dotenv/config";
import express from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  extractSourceMaterialText,
  type SourceMaterialExtractionResult,
  UnsupportedSourceMaterialFormatError,
  SourceMaterialTooLargeError,
} from "./modules/adminContent/sourceMaterialExtractionService.js";

const parserEnvSchema = z.object({
  PARSER_WORKER_AUTH_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsedEnv = parserEnvSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error("Invalid parser worker environment", parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

const parserEnv = parsedEnv.data;

type ParserJob = {
  id: string;
  status: "pending" | "done" | "failed";
  result?: SourceMaterialExtractionResult;
  error?: string;
  createdAt: Date;
};

const jobs = new Map<string, ParserJob>();
const JOB_TTL_MS = 10 * 60 * 1000;
const REPLAY_WINDOW_SECONDS = 60;

function purgeExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt.getTime() > JOB_TTL_MS) jobs.delete(id);
  }
}

function hmacAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const authHeader = req.headers["x-parser-auth"];
  const timestampHeader = req.headers["x-parser-timestamp"];

  if (
    typeof authHeader !== "string" ||
    typeof timestampHeader !== "string" ||
    !authHeader ||
    !timestampHeader
  ) {
    res.status(401).json({ error: "missing_auth_headers" });
    return;
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    res.status(401).json({ error: "invalid_timestamp" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
    res.status(401).json({ error: "timestamp_expired" });
    return;
  }

  const spaceIdx = authHeader.indexOf(" ");
  if (spaceIdx === -1 || authHeader.slice(0, spaceIdx) !== "hmac-sha256") {
    res.status(401).json({ error: "invalid_auth_scheme" });
    return;
  }
  const signature = authHeader.slice(spaceIdx + 1);

  const message = `${timestamp}:${req.method.toUpperCase()}:${req.path}`;
  const expected = createHmac("sha256", parserEnv.PARSER_WORKER_AUTH_KEY).update(message).digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  next();
}

const parseRequestSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  contentBase64: z.string().min(1),
});

const parserApp = express();
parserApp.use(express.json({ limit: "4mb" }));

// Health endpoint — no auth (used by Azure App Service probes)
parserApp.get("/health", (_req, res) => {
  res.json({ status: "ok", role: "parser", jobs: jobs.size });
});

parserApp.use(hmacAuthMiddleware);

parserApp.post("/parse", (req, res) => {
  purgeExpiredJobs();
  const parseResult = parseRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "validation_error", issues: parseResult.error.flatten().fieldErrors });
    return;
  }

  const jobId = randomUUID();
  const job: ParserJob = { id: jobId, status: "pending", createdAt: new Date() };
  jobs.set(jobId, job);

  void (async () => {
    try {
      const result = await extractSourceMaterialText(parseResult.data);
      job.status = "done";
      job.result = result;
    } catch (err) {
      job.status = "failed";
      if (err instanceof UnsupportedSourceMaterialFormatError) {
        job.error = "unsupported_file_type";
      } else if (err instanceof SourceMaterialTooLargeError) {
        job.error = "file_too_large";
      } else {
        job.error = err instanceof Error ? err.message : "extraction_failed";
      }
    }
  })();

  res.status(202).json({ jobId });
});

parserApp.get("/parse/:jobId", (req, res) => {
  purgeExpiredJobs();
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }

  if (job.status === "pending") {
    res.json({ status: "pending" });
    return;
  }

  if (job.status === "failed") {
    res.json({ status: "failed", error: job.error });
    return;
  }

  res.json({
    status: "done",
    extractedText: job.result!.extractedText,
    fileName: job.result!.fileName,
    format: job.result!.format,
    extractedChars: job.result!.extractedChars,
  });
});

parserApp.listen(parserEnv.PORT, () => {
  console.log(`a2-assessment-platform parser worker listening on port ${parserEnv.PORT}`);
});
