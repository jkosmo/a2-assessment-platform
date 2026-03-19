import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const tsxCommand = process.platform === "win32" ? "tsx.cmd" : "tsx";
const command = process.argv[2] ?? "bootstrap";

const supportedCommands = new Set([
  "bootstrap",
  "generate-client",
  "reset-dev",
  "reset-test",
  "seed-dev",
  "seed-test",
  "smoke-dev",
  "smoke-test",
]);

if (!supportedCommands.has(command)) {
  throw new Error(`Unsupported PostgreSQL app bootstrap command: ${command}`);
}

main();

function main() {
  switch (command) {
    case "bootstrap":
      runNodeScript("scripts/postgres/localSetup.mjs", ["setup"]);
      generateClient();
      resetDatabase(".env.postgres.local");
      seedDatabase(".env.postgres.local");
      smokeDatabase(".env.postgres.local", "dev");
      resetDatabase(".env.postgres.test");
      seedDatabase(".env.postgres.test");
      smokeDatabase(".env.postgres.test", "test");
      console.log("Parallel PostgreSQL app bootstrap completed for dev and test prep databases.");
      break;
    case "generate-client":
      generateClient();
      break;
    case "reset-dev":
      generateClient();
      resetDatabase(".env.postgres.local");
      break;
    case "reset-test":
      generateClient();
      resetDatabase(".env.postgres.test");
      break;
    case "seed-dev":
      generateClient();
      seedDatabase(".env.postgres.local");
      break;
    case "seed-test":
      generateClient();
      seedDatabase(".env.postgres.test");
      break;
    case "smoke-dev":
      generateClient();
      smokeDatabase(".env.postgres.local", "dev");
      break;
    case "smoke-test":
      generateClient();
      smokeDatabase(".env.postgres.test", "test");
      break;
    default:
      throw new Error(`Unhandled PostgreSQL app bootstrap command: ${command}`);
  }
}

function generateClient() {
  runCommand(npxCommand, ["prisma", "generate"]);
}

function resetDatabase(envFile) {
  runCommand(npxCommand, [
    "dotenv",
    "-e",
    envFile,
    "--",
    "prisma",
    "db",
    "push",
    "--force-reset",
    "--accept-data-loss",
    "--skip-generate",
  ]);
}

function seedDatabase(envFile) {
  runCommand(npxCommand, ["dotenv", "-e", envFile, "--", tsxCommand, "scripts/postgres/seedPostgres.mts"]);
}

function smokeDatabase(envFile, profile) {
  runCommand(npxCommand, ["dotenv", "-e", envFile, "--", tsxCommand, "scripts/postgres/smokePostgres.mts", profile]);
}

function runNodeScript(scriptPath, args = []) {
  runCommand(process.execPath, [scriptPath, ...args]);
}

function runCommand(commandName, args) {
  const result = spawnSync(commandName, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
