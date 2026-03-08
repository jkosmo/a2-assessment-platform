import { PrismaClient } from "./prismaRuntime.js";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClientType | undefined;
}

const prisma: PrismaClientType =
  global.__prisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}

export { prisma };
