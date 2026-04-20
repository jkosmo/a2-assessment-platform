import { createHmac, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import {
  extractSourceMaterialText,
  type SourceMaterialExtractionInput,
  type SourceMaterialExtractionResult,
  UnsupportedSourceMaterialFormatError,
  SourceMaterialTooLargeError,
} from "../modules/adminContent/sourceMaterialExtractionService.js";

export type ParseJobStatus = {
  status: "pending" | "done" | "failed";
  extractedText?: string;
  fileName?: string;
  format?: string;
  extractedChars?: number;
  error?: string;
};

// Local fallback job store (used when PARSER_WORKER_URL is not configured)
type LocalJob = {
  status: "pending" | "done" | "failed";
  result?: SourceMaterialExtractionResult;
  error?: string;
  createdAt: number;
};

const localJobs = new Map<string, LocalJob>();
const LOCAL_JOB_TTL_MS = 10 * 60 * 1000;

function purgeLocalJobs(): void {
  const now = Date.now();
  for (const [id, job] of localJobs) {
    if (now - job.createdAt > LOCAL_JOB_TTL_MS) localJobs.delete(id);
  }
}

function signRequest(method: string, path: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp}:${method.toUpperCase()}:${path}`;
  const signature = createHmac("sha256", env.PARSER_WORKER_AUTH_KEY!).update(message).digest("hex");
  return {
    "X-Parser-Auth": `hmac-sha256 ${signature}`,
    "X-Parser-Timestamp": String(timestamp),
    "Content-Type": "application/json",
  };
}

export async function submitParseJob(input: SourceMaterialExtractionInput): Promise<string> {
  if (!env.PARSER_WORKER_URL) {
    return submitLocalJob(input);
  }

  const path = "/parse";
  const response = await fetch(`${env.PARSER_WORKER_URL}${path}`, {
    method: "POST",
    headers: signRequest("POST", path),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Parser worker error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}

export async function getParsedResult(jobId: string): Promise<ParseJobStatus | null> {
  if (!env.PARSER_WORKER_URL) {
    return getLocalJobStatus(jobId);
  }

  const path = `/parse/${encodeURIComponent(jobId)}`;
  const response = await fetch(`${env.PARSER_WORKER_URL}${path}`, {
    method: "GET",
    headers: signRequest("GET", path),
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Parser worker error: ${response.status} ${body}`);
  }

  return response.json() as Promise<ParseJobStatus>;
}

function submitLocalJob(input: SourceMaterialExtractionInput): string {
  purgeLocalJobs();
  const jobId = randomUUID();
  const job: LocalJob = { status: "pending", createdAt: Date.now() };
  localJobs.set(jobId, job);

  void extractSourceMaterialText(input).then(
    (result) => {
      job.status = "done";
      job.result = result;
    },
    (err: unknown) => {
      job.status = "failed";
      if (err instanceof UnsupportedSourceMaterialFormatError) {
        job.error = "unsupported_file_type";
      } else if (err instanceof SourceMaterialTooLargeError) {
        job.error = "file_too_large";
      } else {
        job.error = err instanceof Error ? err.message : "extraction_failed";
      }
    },
  );

  return jobId;
}

function getLocalJobStatus(jobId: string): ParseJobStatus | null {
  purgeLocalJobs();
  const job = localJobs.get(jobId);
  if (!job) return null;

  if (job.status === "pending") return { status: "pending" };
  if (job.status === "failed") return { status: "failed", error: job.error };

  return {
    status: "done",
    extractedText: job.result!.extractedText,
    fileName: job.result!.fileName,
    format: job.result!.format,
    extractedChars: job.result!.extractedChars,
  };
}
