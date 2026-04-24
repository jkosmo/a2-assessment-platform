import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const startupLogPath = path.resolve(process.env.HOME ?? process.cwd(), "LogFiles", "parser-startup.log");
const appEntrypoint = path.resolve(process.cwd(), "dist", "src", "parserApp.js");

function writeStartupLog(level, message, error) {
  const suffix = error instanceof Error
    ? `\n${error.stack ?? error.message}`
    : error
      ? `\n${String(error)}`
      : "";
  const line = `${new Date().toISOString()} [${level}] ${message}${suffix}`;
  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, `${line}\n`);
  } catch {
    // Best-effort startup breadcrumbs only.
  }
}

process.on("unhandledRejection", (error) => {
  writeStartupLog("ERROR", "Unhandled promise rejection during parser startup/runtime.", error);
});

process.on("uncaughtException", (error) => {
  writeStartupLog("ERROR", "Uncaught exception during parser startup/runtime.", error);
  process.exit(1);
});

if (!fs.existsSync(appEntrypoint)) {
  throw new Error(`Parser worker entrypoint was not found at ${appEntrypoint}.`);
}

writeStartupLog("INFO", `Starting parser worker runtime from ${appEntrypoint}.`);

try {
  await import(pathToFileURL(appEntrypoint).href);
  writeStartupLog("INFO", "Parser worker runtime import completed.");
} catch (error) {
  writeStartupLog("ERROR", "Parser worker startup failed before the server began listening.", error);
  throw error;
}
