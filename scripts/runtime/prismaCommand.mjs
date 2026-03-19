import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function resolvePrismaCliPath() {
  const packageJsonPath = require.resolve("prisma/package.json");
  const packageRoot = path.dirname(packageJsonPath);
  const cliPath = path.join(packageRoot, "build", "index.js");

  if (!fs.existsSync(cliPath)) {
    throw new Error(`Prisma CLI entrypoint was not found at ${cliPath}.`);
  }

  return cliPath;
}

function runPrismaCommand(args) {
  const cliPath = resolvePrismaCliPath();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Prisma command failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const args = process.argv.slice(2);
  await runPrismaCommand(args);
}

export { resolvePrismaCliPath, runPrismaCommand };
