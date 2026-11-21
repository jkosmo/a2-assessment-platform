/**
 * #1152 skive 4c (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Byggenotat for 4c», «Tørrkjøringen»): HVA SLETTEJOBBEN VILLE GJORT
 * en tenkt natt. Kjøres mot stage og prod før 14.05.2027, den første natten jobben kan slette noe.
 *
 * For hvert arkivert kurs, hver modul og hver seksjon: «deletes» (fristen er nådd innen datoen), «not_due» (fristen kommer senere),
 * «kept» med grunnen, eller «unknown» (overgangsraden mangler). Samme vurdering som lista over arkiverte og jobben, med kursene som
 * slettes først (`previewArchivedRetention`, content/archivedRetentionJob.ts). Den vurderer dagens historikk: det som skjer mellom nå
 * og datoen (nye besvarelser, gjenoppretting), er ikke med.
 *
 * Bare lesing: tilkoblingen åpnes med `default_transaction_read_only=on`, så databasen nekter enhver skriving. Skriver id, tittel,
 * type, arkiveringsdato og svaret. Ingen navn, e-postadresser eller bruker-id-er.
 *
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/archived-retention-preview.ts --as-of 2027-05-20
 *   npm run maint:archived-retention-preview -- --as-of 2027-05-20   (med DATABASE_URL satt i miljøet)
 *
 * `--as-of` er en norsk dato; natten regnes som kl. 03:00 norsk tid den dagen. Uten `--as-of`: i dag. `--json` skriver radene som JSON.
 */

function readOnlyUrl(url: string | undefined): string {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}options=${encodeURIComponent("-c default_transaction_read_only=on")}`;
}

process.env.DATABASE_URL = readOnlyUrl(process.env.DATABASE_URL);

/** Kl. 03:00 norsk tid den dagen (01:00 eller 02:00 UTC). */
function nightOf(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--as-of must be YYYY-MM-DD, got "${date}".`);
  for (const utcHour of [1, 2]) {
    const at = new Date(`${date}T0${utcHour}:00:00.000Z`);
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", hour: "2-digit", hourCycle: "h23" }).format(at);
    if (hour === "03") return at;
  }
  throw new Error(`Could not place 03:00 Oslo time on ${date}.`);
}

async function main() {
  const args = process.argv.slice(2);
  const asOfIndex = args.indexOf("--as-of");
  const asOfArg = asOfIndex >= 0 ? args[asOfIndex + 1] : undefined;
  const asJson = args.includes("--json");

  const { prisma } = await import("../../src/db/prisma.js");
  const { previewArchivedRetention } = await import("../../src/modules/content/archivedRetentionJob.js");
  const { osloDateString } = await import("../../src/modules/content/retentionDeadline.js");
  try {
    const readOnly = await prisma.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
    if (readOnly[0]?.transaction_read_only !== "on") throw new Error("The connection is not read-only; stopping.");

    const asOf = nightOf(asOfArg ?? osloDateString(new Date()));
    const rows = await previewArchivedRetention(asOf, prisma);
    if (asJson) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log(`Slettejobben natten ${osloDateString(asOf)} (kl. 03 norsk tid), vurdert mot dagens historikk:`);
    for (const kind of ["COURSE", "MODULE", "SECTION"] as const) {
      const mine = rows.filter((row) => row.kind === kind);
      const count = (verdict: string) => mine.filter((row) => row.verdict === verdict).length;
      console.log(`\n${kind}: ${mine.length} arkiverte — slettes ${count("deletes")}, ikke ennå ${count("not_due")}, beholdes ${count("kept")}, ukjent ${count("unknown")}`);
      const reasons = new Map<string, number>();
      for (const row of mine.filter((r) => r.verdict === "kept")) reasons.set(row.detail, (reasons.get(row.detail) ?? 0) + 1);
      for (const [reason, n] of reasons) console.log(`   beholdes ${n}x ${reason}`);
      for (const row of mine.filter((r) => r.verdict === "deletes")) console.log(`   slettes: ${row.id}  arkivert ${row.archivedAt.slice(0, 10)}  ${row.title.slice(0, 70)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
