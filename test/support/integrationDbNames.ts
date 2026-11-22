// Integrasjonstestene i parallell: én kopi av testdatabasen per arbeidsprosess (2026-11-22).
//
// Integrasjonstestene deler én Postgres-database, så de har kjørt én fil om gangen (`fileParallelism: false`, #1021: parallelt
// mot ÉN database feilet tilfeldig) — rundt 20 av de 27 minuttene en full runde tar. Med `INTEGRATION_WORKERS=N`
// (npm run test:integration:parallel) lager globalSetup (integrationDbClones.ts) N kopier av den nullstilte og seedede
// testdatabasen (`CREATE DATABASE … TEMPLATE`, noen sekunder), og hver arbeidsprosess kobler seg til sin egen
// (integrationWorkerDb.ts). Uten variabelen, eller med 1, er alt som før.
//
// ⚠️ Egne DATABASER, ikke skjemaer i samme database. Prøvd med skjemaer 2026-11-22: innholdslåsen er en rådgivende lås med fast
// nøkkel (`pg_advisory_xact_lock`, src/db/contentLock.ts), og den gjelder hele databasen. Fire prosesser i samme database
// sperret hverandre (`503 content_busy`, tidsavbrudd). Krever at testbrukeren har `CREATEDB`.
//
// Her bor bare navnene, uten Prisma, så oppsettfila i hver prosess ikke laster klienten før adressen er satt.

/** Antall arbeidsprosesser (og kopier). 1 = som før: én database, én fil om gangen. */
export function integrationWorkerCount(): number {
  const parsed = Number.parseInt(process.env.INTEGRATION_WORKERS ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 1 ? Math.min(parsed, 16) : 1;
}

/** Navnet på testdatabasen i adressen. Bare små bokstaver, tall og _, og det må inneholde «test»: dette lager og sletter databaser. */
export function testDatabaseName(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("test")) {
    throw new Error(`Integrasjonstestene i parallell kopierer bare en testdatabase (navnet må inneholde «test»), ikke «${name}».`);
  }
  return name;
}

/** Adressen til kopi nummer `index` (1-basert): samme tjener, bruker og parametre, databasenavnet med `_w<index>`. */
export function workerDatabaseUrl(databaseUrl: string, index: number): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${testDatabaseName(databaseUrl)}_w${index}`;
  return url.toString();
}
