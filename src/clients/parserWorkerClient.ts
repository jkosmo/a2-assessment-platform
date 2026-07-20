import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { signParserRequest } from "../parser/parserHmac.js";
import {
  extractSourceMaterialText,
  type SourceMaterialExtractionInput,
  type SourceMaterialExtractionResult,
  UnsupportedSourceMaterialFormatError,
  SourceMaterialTooLargeError,
  SourceMaterialPolicyError,
  SourceMaterialTimeoutError,
} from "../modules/adminContent/sourceMaterialExtractionService.js";

export type ParseJobStatus = {
  status: "pending" | "done" | "failed";
  extractedText?: string;
  fileName?: string;
  format?: string;
  extractedChars?: number;
  // #601 Fase 1: surfaced to the author so an image-heavy / low-text upload is flagged.
  lowTextDensity?: boolean;
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

// #816: sign the body digest + a per-request nonce (not just timestamp:method:path), so an observed
// signature can't be replayed with a different body, and the worker can reject repeated nonces.
function signRequest(method: string, path: string, body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const signature = signParserRequest(env.PARSER_WORKER_AUTH_KEY!, { timestamp, method, path, body, nonce });
  return {
    "X-Parser-Auth": `hmac-sha256 ${signature}`,
    "X-Parser-Timestamp": String(timestamp),
    "X-Parser-Nonce": nonce,
    "Content-Type": "application/json",
  };
}

export async function submitParseJob(input: SourceMaterialExtractionInput): Promise<string> {
  if (!env.PARSER_WORKER_URL) {
    return submitLocalJob(input);
  }

  const path = "/parse";
  const body = JSON.stringify(input);
  const response = await fetch(`${env.PARSER_WORKER_URL}${path}`, {
    method: "POST",
    headers: signRequest("POST", path, body),
    body,
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
    headers: signRequest("GET", path, ""),
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
      } else if (err instanceof SourceMaterialPolicyError) {
        job.error = err.message;
      } else if (err instanceof SourceMaterialTimeoutError) {
        job.error = "timeout";
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
    lowTextDensity: job.result!.lowTextDensity,
  };
}
