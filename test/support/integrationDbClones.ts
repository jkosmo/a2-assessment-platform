import { PrismaClient } from "@prisma/client";
import { integrationWorkerCount, testDatabaseName } from "./integrationDbNames.js";

// globalSetup for integrasjonstestene (se integrationDbNames.ts): lager én kopi av testdatabasen per arbeidsprosess, med den
// nullstilte og seedede testdatabasen som mal. Kjører én gang, i hovedprosessen, før noen testfil. Gjør ingenting uten
// `INTEGRATION_WORKERS` > 1.
//
// Postgres kopierer en mal raskt, men bare når ingen er koblet til malen. Koblinger som henger igjen til testdatabasen (en
// dev-tjener, en avbrutt kjøring), avsluttes derfor først. Det er testdatabasen; den skal ikke ha andre brukere mens testene
// kjører (én prosess mot testdatabasen).

export default async function setup(): Promise<void> {
  const workers = integrationWorkerCount();
  if (workers <= 1) return;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL mangler: kjør via npm run test:integration:parallel.");
  const name = testDatabaseName(base);
  const admin = new URL(base);
  admin.pathname = "/postgres";
  const client = new PrismaClient({ datasourceUrl: admin.toString() });
  const started = Date.now();
  try {
    await client.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    );
    for (let index = 1; index <= workers; index += 1) {
      await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}_w${index}" WITH (FORCE)`);
      await client.$executeRawUnsafe(`CREATE DATABASE "${name}_w${index}" TEMPLATE "${name}"`);
    }
  } catch (error) {
    // 42501 = insufficient_privilege. Sjekk koden, ikke teksten: Postgres med norsk lc_messages skriver meldingen på norsk.
    const pgCode = (error as { meta?: { code?: string } }).meta?.code;
    if (pgCode === "42501" || String(error).includes("permission denied to create database")) {
      throw new Error(
        `Testbrukeren kan ikke lage databaser. Én gang, som superbruker i Postgres: ALTER ROLE ${decodeURIComponent(new URL(base).username)} CREATEDB;`,
      );
    }
    throw error;
  } finally {
    await client.$disconnect();
  }
  console.log(`[integrasjon] ${workers} kopier av ${name} laget på ${Math.round((Date.now() - started) / 100) / 10} s`);
}
