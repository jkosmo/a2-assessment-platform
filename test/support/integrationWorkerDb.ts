import { integrationWorkerCount, workerDatabaseUrl } from "./integrationDbNames.js";

// setupFile for integrasjonstestene (se integrationDbNames.ts): i parallell kobler hver arbeidsprosess seg til sitt eget skjema i
// testdatabasen. Kjører i prosessen før hver testfil, og FØR testfila laster appen og Prisma-klienten (som leser DATABASE_URL
// når den lages). Den opprinnelige adressen huskes i INTEGRATION_BASE_DATABASE_URL, så neste fil i samme prosess regner fra
// den. Uten `INTEGRATION_WORKERS` > 1 gjør den ingenting.

const workers = integrationWorkerCount();
if (workers > 1) {
  const base = (process.env.INTEGRATION_BASE_DATABASE_URL ??= process.env.DATABASE_URL);
  if (!base) throw new Error("DATABASE_URL mangler i arbeidsprosessen.");
  const poolId = Number.parseInt(process.env.VITEST_POOL_ID ?? "1", 10) || 1;
  process.env.DATABASE_URL = workerDatabaseUrl(base, ((poolId - 1) % workers) + 1);
}
