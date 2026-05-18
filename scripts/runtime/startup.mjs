import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPrismaCommand } from "./prismaCommand.mjs";

// Bundled-secrets unpacking: must run BEFORE spawning prisma subprocess (#431).
// Mirrors src/config/env.ts logic, but earlier in the lifecycle. Prisma migrate is
// spawned as a child process that inherits process.env from startup.mjs — so any
// env vars that come from the APP_RUNTIME_SECRETS bundle must be populated here,
// not in env.ts (which only runs inside the app's main process after Prisma).
const bundledSecretsRaw = process.env.APP_RUNTIME_SECRETS;
if (bundledSecretsRaw && bundledSecretsRaw.trim().length > 0) {
  try {
    const parsed = JSON.parse(bundledSecretsRaw);
    let appliedCount = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0 && !process.env[key]) {
        process.env[key] = value;
        appliedCount += 1;
      }
    }
    console.log(`startup.mjs: loaded ${appliedCount} secrets from APP_RUNTIME_SECRETS bundle before spawning Prisma.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`startup.mjs: failed to parse APP_RUNTIME_SECRETS JSON: ${message}. Subprocess will inherit existing env only.`);
  }
}

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

// Bootstrap seeding is NOT part of the normal startup path.
// Run explicitly with: node scripts/runtime/bootstrapSeed.mjs (requires BOOTSTRAP_SEED=true)
// or via the npm script: npm run bootstrap:seed

console.log("Starting application runtime...");
await import(pathToFileURL(appEntrypoint).href);
