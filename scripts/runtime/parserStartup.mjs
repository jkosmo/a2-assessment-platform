import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const appEntrypoint = path.resolve(process.cwd(), "dist", "src", "parserApp.js");

if (!fs.existsSync(appEntrypoint)) {
  throw new Error(`Parser worker entrypoint was not found at ${appEntrypoint}.`);
}

console.log("Starting parser worker runtime...");
await import(pathToFileURL(appEntrypoint).href);
