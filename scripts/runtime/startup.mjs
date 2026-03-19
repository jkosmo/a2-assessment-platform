import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPrismaCommand } from "./prismaCommand.mjs";

const appEntrypoint = path.resolve(process.cwd(), "dist", "src", "index.js");
const allowDbPushFallback = (process.env.PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK ?? "false").toLowerCase() === "true";

if (!fs.existsSync(appEntrypoint)) {
  throw new Error(`Built application entrypoint was not found at ${appEntrypoint}.`);
}

console.log("Applying runtime Prisma migrations...");
try {
  await runPrismaCommand(["migrate", "deploy"]);
} catch (error) {
  if (!allowDbPushFallback) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Prisma migrate deploy failed; falling back to prisma db push for compatibility: ${message}`);
  await runPrismaCommand(["db", "push", "--skip-generate"]);
}

console.log("Starting application runtime...");
await import(pathToFileURL(appEntrypoint).href);
