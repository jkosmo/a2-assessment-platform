/**
 * #934 skive 5a-2: gammel og ny regel side om side (doc/DESIGN_934.md, «5a-2 — bygget»). Leser bare. Skriver et sammendrag
 * til skjermen, og hele rapporten til fila i `--out` om den er oppgitt. Rapporten har id-er, ingen navn eller e-post.
 *
 * Koden er 0 når det ikke finnes uforklarte forskjeller eller hull i dataene, og 1 ellers.
 *
 * Kjører mot DATABASE_URL i miljøet, så velg miljøet med vilje:
 *   dotenv -e .env.<miljø> -- npm run module-credit:compare -- --out rapport.json
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../../src/db/prisma.js";
import { compareModuleCredit } from "../../src/modules/course/moduleCreditComparison.js";

async function main() {
  const report = await compareModuleCredit();
  const outAt = process.argv.indexOf("--out");
  if (outAt >= 0 && process.argv[outAt + 1]) writeFileSync(process.argv[outAt + 1], JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify({
      event: "module_credit_compare_complete",
      ok: report.ok,
      compared: report.compared,
      differences: report.differences.length,
      unexplained: report.unexplained,
      byReason: report.byReason,
      structure: Object.fromEntries(Object.entries(report.structure).map(([name, list]) => [name, list.length])),
    }),
  );
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("module_credit_compare_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
