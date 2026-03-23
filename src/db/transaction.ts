import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export type DbTransactionClient = Prisma.TransactionClient;

export function runInTransaction<T>(callback: (tx: DbTransactionClient) => Promise<T>) {
  return prisma.$transaction(callback);
}
