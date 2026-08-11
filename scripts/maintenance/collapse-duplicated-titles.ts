/**
 * #892 clean-up: collapse localized titles whose locales all hold the same string back into a plain
 * string, so «not translated yet» becomes detectable again on content written before v2.11.3.
 *
 * The change is display-neutral — see src/services/localizedTitleCleanup.ts for why — but it writes
 * to content tables, so it is a DRY RUN unless you pass --apply.
 *
 * Runs against whatever DATABASE_URL is in the environment, so target the intended env explicitly:
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/collapse-duplicated-titles.ts
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/collapse-duplicated-titles.ts --apply
 *
 * Against Azure, reach the DB the same way as the other maintenance scripts (temporary firewall
 * rule; see doc/OPERATIONS_RUNBOOK.md). Run the dry run first and read the id lists — they tell you
 * exactly which rows would change.
 *
 * Idempotent: re-running after --apply reports 0 collapsed.
 */
import { collapseDuplicatedLocalizedTitles } from "../../src/services/localizedTitleCleanup.js";
import { prisma } from "../../src/db/prisma.js";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await collapseDuplicatedLocalizedTitles({ dryRun: !apply });

  for (const [entity, stats] of Object.entries(result.byEntity)) {
    console.log(
      JSON.stringify({
        event: "collapse_duplicated_titles_entity",
        entity,
        scanned: stats.scanned,
        collapsed: stats.collapsed,
        ids: stats.ids,
      }),
    );
  }

  console.log(
    JSON.stringify({
      event: "collapse_duplicated_titles_complete",
      dryRun: result.dryRun,
      totalCollapsed: result.totalCollapsed,
    }),
  );

  if (result.dryRun && result.totalCollapsed > 0) {
    console.log("Dry run — re-run with --apply to write these changes.");
  }
}

main()
  .catch((error) => {
    console.error("collapse_duplicated_titles_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
