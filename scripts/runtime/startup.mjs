import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPrismaCommand } from "./prismaCommand.mjs";

const appEntrypoint = path.resolve(process.cwd(), "dist", "src", "index.js");
const allowDbPushFallback = (process.env.PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK ?? "false").toLowerCase() === "true";
const skipMigrate = (process.env.SKIP_MIGRATE ?? "false").toLowerCase() === "true";

if (!fs.existsSync(appEntrypoint)) {
  throw new Error(`Built application entrypoint was not found at ${appEntrypoint}.`);
}

if (skipMigrate) {
  console.log("Skipping Prisma migrations (SKIP_MIGRATE=true).");
} else {
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
}

const bootstrapSeedScript = path.resolve(process.cwd(), "scripts", "runtime", "bootstrapSeed.mjs");
if (fs.existsSync(bootstrapSeedScript)) {
  // bootstrapSeed.mjs gates itself on BOOTSTRAP_SEED=true — safe to always import
  await import(pathToFileURL(bootstrapSeedScript).href);
}

console.log("Starting application runtime...");
await import(pathToFileURL(appEntrypoint).href);
