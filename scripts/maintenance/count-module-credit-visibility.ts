/**
 * 2.192.0 (doc/design/PLAN_MODULER_TELLER_DER_DELTAKEREN_SER.md, «Utrulling»): hva regelen «et bestått teller bare i kurs deltakeren
 * ser» endrer, per begrenset kurs. Kjøres mot prod (eller stage-kopien) FØR utrulling, så produkteier ser tallene.
 *
 * Per publisert, ikke-arkivert, BEGRENSET kurs med moduler (i et åpent kurs ser alle det, og ingenting endres):
 *   - `passersBefore`: deltakere med minst én modul som teller i kurset med dagens regel (synligheten ses bort fra);
 *   - `passersAfter`: det samme med den nye regelen. `lost` = før − etter: radene i kursrapporten som får færre beståtte;
 *   - `allModulesBefore` / `allModulesAfter`: deltakere uten kursbevis for nåværende hovedversjon som har bestått ALLE modulene.
 *     Med dagens regel utstedes et bevis til dem når kravet ellers er oppfylt (seksjonene lest); med den nye ikke. Tallet er en
 *     øvre grense for bevisene den nye regelen holder tilbake: seksjonene telles ikke her.
 * Utrullingen utsteder ingenting og trekker ingenting tilbake; utstedte kursbevis står.
 *
 * Synligheten regnes fra rollene i databasen (`findLearnersSeeingCourses`), som workeren. Dagens regel regnes med
 * `visibility: "ignore"` (det eneste andre stedet valget brukes, er modulrapportene).
 *
 * Bare lesing: tilkoblingen åpnes med `default_transaction_read_only=on`. Skriver kurs-id, tittel og antall. Ingen navn,
 * e-postadresser eller bruker-id-er.
 *
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/count-module-credit-visibility.ts
 *   npm run maint:count-module-credit-visibility   (med DATABASE_URL satt i miljøet)
 */

function readOnlyUrl(url: string | undefined): string {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}options=${encodeURIComponent("-c default_transaction_read_only=on")}`;
}

process.env.DATABASE_URL = readOnlyUrl(process.env.DATABASE_URL);

function titleOf(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.nb ?? parsed["en-GB"] ?? parsed.nn ?? raw;
  } catch {
    return raw;
  }
}

async function main() {
  const { prisma } = await import("../../src/db/prisma.js");
  const { createCourseRepository } = await import("../../src/modules/course/courseRepository.js");
  try {
    const readOnly = await prisma.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
    if (readOnly[0]?.transaction_read_only !== "on") throw new Error("The connection is not read-only; stopping.");

    const repo = createCourseRepository(prisma);
    const courses = (await repo.findPublishedCourses()).filter((course) => course.enrollmentPolicy === "RESTRICTED");
    const rows: Array<{ courseId: string; title: string; passersBefore: number; passersAfter: number; lost: number; allModulesBefore: number; allModulesAfter: number }> = [];

    for (const course of courses) {
      const moduleIds = course.modules.filter((m) => m.module?.archivedAt == null).map((m) => m.moduleId);
      if (moduleIds.length === 0) continue;
      const input = { courses: [{ courseId: course.id, moduleIds }] };
      const [before, after, holders] = await Promise.all([
        repo.findModuleProgress({ ...input, visibility: "ignore" }),
        repo.findModuleProgress(input),
        prisma.courseCompletion.findMany({ where: { courseId: course.id, versionMajor: course.versionMajor }, select: { userId: true } }),
      ]);
      const certified = new Set(holders.map((row) => row.userId));
      const passers = (progress: typeof before) => new Set(moduleIds.flatMap((id) => [...progress.passedUserIds(course.id, id)]));
      const allModules = (progress: typeof before) =>
        [...passers(progress)].filter((userId) => !certified.has(userId) && moduleIds.every((id) => progress.passedModuleIds(userId, course.id).has(id))).length;
      const passersBefore = passers(before).size;
      const passersAfter = passers(after).size;
      if (passersBefore === 0) continue;
      rows.push({
        courseId: course.id,
        title: titleOf(course.title),
        passersBefore,
        passersAfter,
        lost: passersBefore - passersAfter,
        allModulesBefore: allModules(before),
        allModulesAfter: allModules(after),
      });
    }

    rows.sort((a, b) => b.lost - a.lost);
    console.table(rows);
    const total = (key: "lost" | "allModulesBefore" | "allModulesAfter") => rows.reduce((sum, row) => sum + row[key], 0);
    console.log(`Begrensede kurs med beståtte: ${rows.length}. Rader med færre beståtte: ${total("lost")}. ` +
      `Uten kursbevis, alle moduler bestått: før ${total("allModulesBefore")}, etter ${total("allModulesAfter")}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
