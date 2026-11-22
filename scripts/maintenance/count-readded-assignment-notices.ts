/**
 * #1146 (doc/design/PLAN_1146.md, punkt 6.2 og 9 R6): hvor mange får e-post om et kurs som er lagt inn igjen, første gang
 * workeren kjører den nye jobben etter utrulling. Kjøres mot prod FØR utrulling, så produkteier ser tallet.
 *
 * Bruker NØYAKTIG spørringen jobbens steg 2b bruker (`readdedPairsQuery`), med migreringens utfylling av `settledAt`
 * (`COALESCE("sendingAt", "updatedAt")`): kolonnen finnes ikke før migreringen har kjørt. Etter migreringen: `--after-migration`.
 *
 * Bare lesing (transaksjonen er `READ ONLY`). Skriver kurs og antall, ingen navn eller e-postadresser.
 *
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/count-readded-assignment-notices.ts [--after-migration]
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/db/prisma.js";
import { readdedPairsQuery } from "../../src/modules/course/courseAssignmentNotice.js";

const afterMigration = process.argv.includes("--after-migration");

async function main() {
  const query = afterMigration
    ? readdedPairsQuery()
    : readdedPairsQuery(undefined, { settledAt: (alias) => Prisma.raw(`COALESCE(${alias}."sendingAt", ${alias}."updatedAt")`) });

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.$queryRaw<Array<{ userId: string; courseId: string; title: string; status: string }>>`
      SELECT r."userId", r."courseId", co.title, n.status
      FROM (${query}) r
      JOIN "Course" co ON co.id = r."courseId"
      JOIN "CourseAssignmentNotice" n ON n.id = r.id
    `;
  });

  const byCourse = new Map<string, { title: string; people: number; statuses: Record<string, number> }>();
  for (const row of rows) {
    let title = row.title;
    try {
      title = (JSON.parse(row.title) as Record<string, string>).nb ?? row.title;
    } catch {
      // Tittelen er ren tekst.
    }
    const entry = byCourse.get(row.courseId) ?? { title, people: 0, statuses: {} };
    entry.people += 1;
    entry.statuses[row.status] = (entry.statuses[row.status] ?? 0) + 1;
    byCourse.set(row.courseId, entry);
  }
  console.log(JSON.stringify({
    event: "readded_assignment_notices",
    mode: afterMigration ? "after_migration" : "before_migration",
    rows: rows.length,
    people: new Set(rows.map((r) => r.userId)).size,
    courses: [...byCourse.values()].sort((a, b) => b.people - a.people),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("readded_assignment_notices_failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
