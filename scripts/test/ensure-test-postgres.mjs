// Starter en lokal test-Postgres før integrasjonstestene, hvis den er satt opp og ikke kjører (2026-11-22).
//
// Valgfritt: uten `A2_TEST_PG_DATA` i miljøet (typisk satt i den gitignorerte .env.test.local) gjør skriptet ingenting, og
// testene bruker den Postgres-en DATABASE_URL peker på, som før. Oppsettet står i doc/LOCAL_DEV_NO_DOCKER.md.
//
//   A2_TEST_PG_DATA  datamappa til test-Postgres (initdb), f.eks. C:\Dev\pg-test\data
//   A2_TEST_PG_BIN   valgfri mappe med pg_ctl; ellers pg_ctl på PATH, og på Windows den nyeste under C:\Program Files\PostgreSQL
//
// Loggen havner ved siden av datamappa (postgres.log). Skriptet stopper aldri tjeneren; den kan stå og gå.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.A2_TEST_PG_DATA?.trim();
if (!dataDir) process.exit(0);

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.error(`[test-postgres] ${dataDir} er ikke en Postgres-datamappe. Se doc/LOCAL_DEV_NO_DOCKER.md.`);
  process.exit(1);
}

function findPgCtl() {
  const exe = process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl";
  const fromEnv = process.env.A2_TEST_PG_BIN?.trim();
  if (fromEnv) return path.join(fromEnv, exe);
  if (process.platform === "win32") {
    const root = "C:\\Program Files\\PostgreSQL";
    if (existsSync(root)) {
      const versions = readdirSync(root)
        .filter((name) => /^\d+$/.test(name) && existsSync(path.join(root, name, "bin", exe)))
        .sort((a, b) => Number(b) - Number(a));
      if (versions.length > 0) return path.join(root, versions[0], "bin", exe);
    }
  }
  return exe;
}

const pgCtl = findPgCtl();
const status = spawnSync(pgCtl, ["status", "-D", dataDir], { encoding: "utf8" });
if (status.error) {
  console.error(`[test-postgres] fant ikke pg_ctl (${pgCtl}): ${status.error.message}. Sett A2_TEST_PG_BIN.`);
  process.exit(1);
}
// pg_ctl status: 0 = kjører, 3 = kjører ikke, 4 = ingen datamappe.
if (status.status === 0) process.exit(0);
if (status.status !== 3) {
  console.error(`[test-postgres] pg_ctl status svarte ${status.status}: ${status.stdout}${status.stderr}`);
  process.exit(1);
}

const logFile = path.join(path.dirname(path.resolve(dataDir)), "postgres.log");
console.log(`[test-postgres] starter test-Postgres i ${dataDir}`);
// stdio "ignore": tjeneren arver ellers npm sine utdatahåndtak og holder kjøringen åpen etter at testene er ferdige.
const start = spawnSync(pgCtl, ["start", "-D", dataDir, "-l", logFile, "-w", "-t", "60"], { stdio: "ignore" });
if (start.status !== 0) {
  console.error(`[test-postgres] kunne ikke starte (pg_ctl ${start.status}). Se ${logFile}.`);
  process.exit(1);
}
