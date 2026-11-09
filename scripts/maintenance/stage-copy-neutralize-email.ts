/**
 * #1142: prod → stage-kopi. Kjøres mot KOPIEN, FØR stage startes på den (doc/design/PLAN_1142.md, punkt 2). En full kopi tar
 * med e-post som venter i prod — rader i `CourseAssignmentNotice` og `CourseVersionNotice`, og hendelser i outboxen — og uten
 * dette steget kunne stage sendt samme e-post en gang til, til ekte mottakere. I én transaksjon:
 *   1. ventende rader om nye kurs → `baseline` (`copied_from_prod`);
 *   2. par prod-jobben ennå ikke hadde sett → `baseline`;
 *   3. ventende rader om ny hovedversjon (4b) → `skipped`;
 *   4. outbox-hendelser som sender e-post og ikke er levert → `failed`.
 * Selve skrivingen bor i `neutralizeEmailStateAfterProdCopy` (courseAssignmentNotice.ts), den eneste fila som skriver
 * `CourseAssignmentNotice`; testen er test/m2-stage-copy-neutralize-email-1142.test.ts.
 *
 * Kjører mot DATABASE_URL i miljøet, så velg miljøet med vilje (aldri prod):
 *   dotenv -e .env.<stage-kopi> -- npm run stage-copy:neutralize-email
 */
import { prisma } from "../../src/db/prisma.js";
import { neutralizeEmailStateAfterProdCopy } from "../../src/modules/course/courseAssignmentNotice.js";

async function main() {
  const summary = await neutralizeEmailStateAfterProdCopy();
  console.log(JSON.stringify({ event: "stage_copy_email_neutralized", ...summary }));
}

main()
  .catch((error) => {
    console.error("stage_copy_email_neutralize_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
