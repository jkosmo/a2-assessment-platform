/**
 * #934 skive 5a-2: tilbakefylling av versjonsnummer, krav per kurs og beståtte per innlevering (doc/DESIGN_934.md,
 * «5a-2 — bygget»). Kan kjøres flere ganger. Korte låser: én transaksjon per modul, og én per deltaker. Får noe ikke låsen,
 * listes det under `busy`, og koden blir 2: kjør på nytt. Nekter å kjøre når regelen i 5a-3 er slått på.
 *
 * Kjører mot DATABASE_URL i miljøet, så velg miljøet med vilje:
 *   dotenv -e .env.<miljø> -- npm run module-credit:backfill
 */
import { prisma } from "../../src/db/prisma.js";
import { backfillModuleCredit } from "../../src/modules/course/moduleCreditBackfill.js";

async function main() {
  const result = await backfillModuleCredit();
  console.log(JSON.stringify({ event: "module_credit_backfill_complete", ...result }));
  if (result.busy.modules.length + result.busy.users.length > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error("module_credit_backfill_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
