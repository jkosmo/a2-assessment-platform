import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export type DbTransactionClient = Prisma.TransactionClient;

/**
 * Options for an interactive transaction. `timeout` bounds how long the callback may run before Prisma
 * aborts it (default 5s); `maxWait` bounds how long to wait for a pooled connection. #796: a content
 * import builds a whole module/course graph in one transaction, which can exceed the 5s default — such
 * callers pass a larger timeout explicitly.
 */
export type RunInTransactionOptions = { timeout?: number; maxWait?: number };

export function runInTransaction<T>(
  callback: (tx: DbTransactionClient) => Promise<T>,
  options?: RunInTransactionOptions,
) {
  return prisma.$transaction(callback, options);
}
