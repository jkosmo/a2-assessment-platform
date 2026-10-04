/**
 * #1083: finn — og eventuelt reparer — SVG-figurer som er lagret i en form nettleseren ikke kan lese.
 *
 * Før 2.78.2 skrev `sanitizeSvg` figuren ut som HTML. Et hardt mellomrom i en etikett («§ 12»,
 * «10 %») ble da til `&nbsp;`, som ikke finnes i XML, og fila kunne ikke vises som bilde. Deltakeren
 * så ingen figur, og ingenting sa fra. Rettingen i rensingen gjelder det som lagres fra nå av; dette
 * skriptet gjelder det som alt ligger der. Se `repairUnreadableSvgAssets` i
 * src/modules/course/assetCommands.ts.
 *
 * TØRRKJØRING er standard: skriptet teller og lister, og endrer ingenting. `--apply` skriver.
 *
 * Kjører mot databasen OG fillageret miljøet peker på (DATABASE_URL og COURSE_ASSETS_BLOB_ENDPOINT),
 * så velg miljø eksplisitt:
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/repair-unreadable-svg-assets.ts
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/repair-unreadable-svg-assets.ts --apply
 *
 * ⚠️ Uten COURSE_ASSETS_BLOB_ENDPOINT leser skriptet fra den LOKALE mappa (.course-assets-local), og
 * hver rad fra en Azure-database meldes da som «mangler». Skriptet nekter derfor å kjøre mot en
 * database som ikke er lokal uten at endepunktet er satt.
 *
 * Mot Azure når du databasen som de andre vedlikeholdsskriptene (midlertidig brannmurregel, se
 * doc/OPERATIONS_RUNBOOK.md), og kontoen din må ha lesetilgang — og for `--apply` skrivetilgang —
 * til lagringskontoen.
 *
 * Idempotent: en ny kjøring etter `--apply` melder 0 uleselige.
 */
import { repairUnreadableSvgAssets } from "../../src/modules/course/assetCommands.js";
import { assetStorageMode } from "../../src/modules/course/assetStorage.js";
import { prisma } from "../../src/db/prisma.js";

function databaseIsLocal(): boolean {
  try {
    const host = new URL(process.env.DATABASE_URL ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function main() {
  if (assetStorageMode === "local" && !databaseIsLocal()) {
    console.error(
      "repair_unreadable_svg_assets_refused: databasen er ikke lokal, men COURSE_ASSETS_BLOB_ENDPOINT er ikke satt. " +
        "Skriptet ville lest fra den lokale mappa og meldt hver figur som manglende.",
    );
    process.exitCode = 1;
    return;
  }

  const apply = process.argv.includes("--apply");
  const result = await repairUnreadableSvgAssets({ dryRun: !apply });

  for (const funn of result.unreadable) {
    console.log(JSON.stringify({ event: "unreadable_svg_asset", ...funn }));
  }
  console.log(
    JSON.stringify({
      event: "repair_unreadable_svg_assets_complete",
      dryRun: result.dryRun,
      storage: assetStorageMode,
      scanned: result.scanned,
      unreadable: result.unreadable.length,
      repaired: result.unreadable.filter((f) => f.repaired).length,
      notRepairable: result.unreadable.filter((f) => !f.repairable).length,
    }),
  );

  if (result.dryRun && result.unreadable.some((f) => f.repairable)) {
    console.log("Tørrkjøring — kjør på nytt med --apply for å reparere dem som kan reddes.");
  }
}

main()
  .catch((error) => {
    console.error("repair_unreadable_svg_assets_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
