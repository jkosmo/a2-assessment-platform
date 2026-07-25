import { PrismaClient } from "./prismaRuntime.js";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { env } from "../config/env.js";
import { buildWorkerDatasourceUrl } from "./workerDatasource.js";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClientType | undefined;
}

// #866: scope the statement/lock timeouts to the dedicated worker container only (PROCESS_ROLE=worker).
// Web (=web) and all-in-one dev/test (=all) keep the unmodified connection so their longer/legitimate
// queries and lock waits are never aborted. See workerDatasource.ts for the rationale.
const workerDatasourceUrl =
  env.PROCESS_ROLE === "worker"
    ? buildWorkerDatasourceUrl(env.DATABASE_URL, {
        statementTimeoutMs: env.WORKER_STATEMENT_TIMEOUT_MS,
        lockTimeoutMs: env.WORKER_LOCK_TIMEOUT_MS,
      })
    : undefined;

const prisma: PrismaClientType =
  global.__prisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(workerDatasourceUrl ? { datasourceUrl: workerDatasourceUrl } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}

export { prisma };
