import "dotenv/config";
import fs from "node:fs";
import { resolveSqliteFilePath } from "./dbUrl.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const dbPath = resolveSqliteFilePath(databaseUrl);
const pathsToDelete = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];

for (const filePath of pathsToDelete) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

console.log(`Reset database file: ${dbPath}`);

