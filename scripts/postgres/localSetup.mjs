import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const composeFile = "docker-compose.postgres.yml";
const serviceName = "postgres";

const postgresConfig = {
  host: "127.0.0.1",
  port: 54329,
  user: "a2_app",
  password: "a2_local_dev_password",
  devDatabase: "a2_assessment_dev",
  testDatabase: "a2_assessment_test",
};

const commands = new Set(["setup", "start", "stop", "destroy", "recreate", "status", "verify", "write-env"]);
const command = commands.has(process.argv[2] ?? "") ? process.argv[2] : "setup";

main();

function main() {
  switch (command) {
    case "setup":
      ensureDockerAvailable();
      startPostgres();
      waitForHealthyPostgres();
      writeEnvFiles();
      verifyDatabasesExist();
      log(
        `PostgreSQL prep environment is ready. Generated .env.postgres.local and .env.postgres.test against ${postgresConfig.host}:${postgresConfig.port}.`,
      );
      break;
    case "start":
      ensureDockerAvailable();
      startPostgres();
      waitForHealthyPostgres();
      log("PostgreSQL container is running.");
      break;
    case "stop":
      ensureDockerAvailable();
      runDockerCompose(["stop", serviceName]);
      log("PostgreSQL container stopped.");
      break;
    case "destroy":
      ensureDockerAvailable();
      runDockerCompose(["down", "--volumes", "--remove-orphans"]);
      log("PostgreSQL container and volume removed.");
      break;
    case "recreate":
      ensureDockerAvailable();
      runDockerCompose(["down", "--volumes", "--remove-orphans"]);
      startPostgres();
      waitForHealthyPostgres();
      writeEnvFiles();
      verifyDatabasesExist();
      log("PostgreSQL container recreated from scratch and env files regenerated.");
      break;
    case "status":
      ensureDockerAvailable();
      runDockerCompose(["ps"]);
      break;
    case "verify":
      ensureDockerAvailable();
      waitForHealthyPostgres();
      verifyDatabasesExist();
      verifyEnvFiles();
      log("PostgreSQL prep environment verified.");
      break;
    case "write-env":
      writeEnvFiles();
      log("Generated .env.postgres.local and .env.postgres.test.");
      break;
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

function ensureDockerAvailable() {
  const versionResult = spawnSync("docker", ["--version"], {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (versionResult.error || versionResult.status !== 0) {
    throw new Error("Docker is required for the local PostgreSQL prep setup. Install Docker Desktop or another Docker runtime first.");
  }

  const composeResult = spawnSync("docker", ["compose", "version"], {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (composeResult.error || composeResult.status !== 0) {
    throw new Error("Docker Compose v2 is required. Ensure `docker compose` is available.");
  }
}

function startPostgres() {
  runDockerCompose(["up", "-d", serviceName]);
}

function waitForHealthyPostgres() {
  const attempts = 24;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "-f",
        composeFile,
        "exec",
        "-T",
        serviceName,
        "pg_isready",
        "-U",
        postgresConfig.user,
        "-d",
        postgresConfig.devDatabase,
      ],
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );

    if (result.status === 0) {
      return;
    }

    sleep(2000);
  }

  throw new Error("PostgreSQL container did not become healthy within 48 seconds.");
}

function writeEnvFiles() {
  writeDerivedEnvFile(".env.example", ".env.postgres.local", buildDatabaseUrl(postgresConfig.devDatabase));
  writeDerivedEnvFile(".env.test", ".env.postgres.test", buildDatabaseUrl(postgresConfig.testDatabase));
}

function writeDerivedEnvFile(sourceName, outputName, databaseUrl) {
  const sourcePath = path.join(repoRoot, sourceName);
  const outputPath = path.join(repoRoot, outputName);
  const sourceContent = fs.readFileSync(sourcePath, "utf8");
  const updatedContent = replaceDatabaseUrl(sourceContent, databaseUrl);

  fs.writeFileSync(outputPath, updatedContent, "utf8");
}

function replaceDatabaseUrl(content, databaseUrl) {
  if (!content.includes("DATABASE_URL=")) {
    throw new Error("Could not find DATABASE_URL in env template.");
  }

  return content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`);
}

function buildDatabaseUrl(databaseName) {
  return `postgresql://${postgresConfig.user}:${postgresConfig.password}@${postgresConfig.host}:${postgresConfig.port}/${databaseName}?schema=public`;
}

function verifyDatabasesExist() {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      serviceName,
      "psql",
      "-U",
      postgresConfig.user,
      "-d",
      "postgres",
      "-At",
      "-c",
      "SELECT datname FROM pg_database WHERE datname IN ('a2_assessment_dev', 'a2_assessment_test') ORDER BY datname;",
    ],
    {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(`Could not verify PostgreSQL databases. ${result.stderr?.trim() ?? ""}`.trim());
  }

  const databases = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  );

  for (const databaseName of [postgresConfig.devDatabase, postgresConfig.testDatabase]) {
    if (!databases.has(databaseName)) {
      throw new Error(`Expected PostgreSQL database \`${databaseName}\` was not found.`);
    }
  }
}

function verifyEnvFiles() {
  verifyEnvFile(".env.postgres.local", buildDatabaseUrl(postgresConfig.devDatabase));
  verifyEnvFile(".env.postgres.test", buildDatabaseUrl(postgresConfig.testDatabase));
}

function verifyEnvFile(fileName, expectedDatabaseUrl) {
  const filePath = path.join(repoRoot, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected generated env file \`${fileName}\` was not found. Run \`npm run postgres:write-env\` or \`npm run postgres:setup\`.`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  const expectedLine = `DATABASE_URL=${expectedDatabaseUrl}`;

  if (!content.includes(expectedLine)) {
    throw new Error(`Env file \`${fileName}\` is out of date. Re-run \`npm run postgres:write-env\`.`);
  }
}

function runDockerCompose(args) {
  const result = spawnSync("docker", ["compose", "-f", composeFile, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sleep(milliseconds) {
  const end = Date.now() + milliseconds;

  while (Date.now() < end) {
    // Busy-wait is acceptable here because the script is a short-lived setup helper.
  }
}

function log(message) {
  console.log(message);
}
