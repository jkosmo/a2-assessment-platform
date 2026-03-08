import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveSqliteFilePath } from "./dbUrl.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const databasePath = resolveSqliteFilePath(databaseUrl);
const migrationsRoot = path.resolve(process.cwd(), "prisma", "migrations");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

if (!fs.existsSync(migrationsRoot)) {
  console.log("No migrations directory found; skipping.");
  process.exit(0);
}

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = OFF;");
db.exec(`
  CREATE TABLE IF NOT EXISTS "_manual_migrations" (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);

const applied = new Set();
for (const row of db.prepare('SELECT name FROM "_manual_migrations"').all()) {
  applied.add(row.name);
}

const migrationDirs = fs
  .readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

for (const migrationName of migrationDirs) {
  if (applied.has(migrationName)) {
    continue;
  }

  const migrationFile = path.join(migrationsRoot, migrationName, "migration.sql");
  if (!fs.existsSync(migrationFile)) {
    throw new Error(`Missing migration file: ${migrationFile}`);
  }

  const sql = fs.readFileSync(migrationFile, "utf8").replace(/^\uFEFF/, "");
  db.exec("BEGIN;");
  try {
    db.exec(sql);
    db.prepare('INSERT INTO "_manual_migrations"(name, applied_at) VALUES (?, ?)').run(
      migrationName,
      new Date().toISOString(),
    );
    db.exec("COMMIT;");
    console.log(`Applied migration: ${migrationName}`);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

db.exec("PRAGMA foreign_keys = ON;");
db.close();
