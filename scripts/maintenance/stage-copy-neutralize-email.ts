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
 * ⚠️ Mot prod ville skriptet slette ekte e-post for godt. Sperren (`checkStageCopyTarget`, stageCopyGuard.ts) kjører FØR noe
 * skrives: den nekter alltid et vertsnavn som ser ut som prod, og krever at CONFIRM_STAGE_COPY er lik databasenavnet i
 * DATABASE_URL:
 *   CONFIRM_STAGE_COPY=<databasenavnet> dotenv -e .env.<stage-kopi> -- npm run stage-copy:neutralize-email
 * Oppskriften står i doc/OPERATIONS_RUNBOOK.md («Prod → stage-kopi»).
 */
import { checkStageCopyTarget } from "./stageCopyGuard.js";

async function main() {
  const guard = checkStageCopyTarget(process.env.DATABASE_URL, process.env.CONFIRM_STAGE_COPY);
  if (!guard.ok) {
    console.error(JSON.stringify({ event: "stage_copy_email_neutralize_refused", reason: guard.reason, message: guard.message }));
    process.exitCode = 1;
    return;
  }

  // Først etter sperren: databasen og koden som skriver.
  const { prisma } = await import("../../src/db/prisma.js");
  const { neutralizeEmailStateAfterProdCopy } = await import("../../src/modules/course/courseAssignmentNotice.js");
  try {
    const summary = await neutralizeEmailStateAfterProdCopy();
    console.log(JSON.stringify({ event: "stage_copy_email_neutralized", database: guard.databaseName, ...summary }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("stage_copy_email_neutralize_failed", error);
  process.exitCode = 1;
});
