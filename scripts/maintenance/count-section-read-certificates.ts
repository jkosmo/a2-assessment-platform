/**
 * #1156 (doc/design/PLAN_1156_LEST_PA_TVERS.md, «Utrulling» og «Etter gjennomlesingen»): hvor mange kursbevis lesing på tvers av
 * kurs vil utstede, per kurs. Kjøres mot prod FØR utrulling, så produkteier ser tallet.
 *
 * Per publisert, ikke-arkivert kurs med seksjoner, for alle deltakere som har lest en av seksjonene (i hvilket som helst kurs) eller
 * levert på en av modulene, og som ikke har kursbevis for kursets nåværende hovedversjon:
 *   - `today`: oppfyller kravet med dagens regel (bare lesinger gjort i kurset). Får beviset alt neste gang «Mine kurs» åpnes.
 *   - `newRule`: oppfyller kravet med den nye regelen (`findSectionReadCredit`: lesinger fra alle kurs, bare i kurs deltakeren ser).
 *     Dette er bevisene som utstedes etter utrullingen. `added` = newRule − today.
 *   - `notVisible`: ville oppfylt kravet hvis lesinger talte også i kurs deltakeren ikke ser. Bevisene produkteiers «bare i kurs
 *     deltakeren ser» (14.11.2026) holder tilbake.
 * Og kursene som går fra null til flere bevisinnehavere for nåværende hovedversjon: de får e-post ved neste hovedversjon, og «kurs
 * fullført» dateres utrullingsdagen i aktiviteten.
 *
 * Modulkravet regnes med `findModuleProgress`, som porten for kursbevis. Synligheten regnes fra rollene i databasen, som utboksen
 * gjør (`findLearnersSeeingCourses`); avstemmingen når «Mine kurs» åpnes, bruker innloggingen og kan i sjeldne tilfeller gi litt
 * flere (en rolle bare i tokenet). Tallene er en øvre grense for det som utstedes med en gang: hvert bevis måles på nytt.
 *
 * Bare lesing: tilkoblingen åpnes med `default_transaction_read_only=on`, så databasen nekter enhver skriving. Skriver kurs-id,
 * tittel, tilgang og antall. Ingen navn, e-postadresser eller bruker-id-er.
 *
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/count-section-read-certificates.ts
 *   npm run maint:count-section-read-certificates   (med DATABASE_URL satt i miljøet)
 *
 * Virker før migreringen (20261115120000_section_read_across_courses): den leser bare kolonner som finnes fra før.
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
  const { createCourseRepository, findSectionItemsForCourses } = await import("../../src/modules/course/courseRepository.js");
  const { findSectionReadCredit } = await import("../../src/modules/course/sectionReadCredit.js");
  const { loadSectionReadRules, readCountsForCurrentVersion } = await import("../../src/modules/course/courseVersioning.js");
  try {
    const readOnly = await prisma.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
    if (readOnly[0]?.transaction_read_only !== "on") throw new Error("The connection is not read-only; stopping.");

    const repo = createCourseRepository(prisma);
    const courses = await repo.findPublishedCourses();
    const rows: Array<{
      courseId: string;
      title: string;
      enrollmentPolicy: string;
      versionMajor: number;
      holdersNow: number;
      today: number;
      newRule: number;
      added: number;
      notVisible: number;
      goesFromZero: boolean;
    }> = [];

    for (const course of courses) {
      const sectionIds = (await findSectionItemsForCourses(prisma, [course.id], "participant")).map((item) => item.sectionId);
      // Uten seksjoner endrer ingenting seg: moduler telte på tvers fra før.
      if (sectionIds.length === 0) continue;
      const moduleIds = course.modules.filter((m) => m.module?.archivedAt == null).map((m) => m.moduleId);

      const [credit, creditIgnoringVisibility, ownReads, rules, submitters, current] = await Promise.all([
        findSectionReadCredit(prisma, { courseIds: [course.id], items: "participant" }),
        findSectionReadCredit(prisma, {
          courseIds: [course.id],
          items: "participant",
          lookupVisibility: async (asked, userIds) => new Map(asked.map((c) => [c.id, new Set(userIds)])),
        }),
        // Dagens regel: bare lesinger gjort i kurset.
        prisma.courseSectionRead.findMany({ where: { courseId: course.id, sectionId: { in: sectionIds } }, select: { userId: true, sectionId: true, readAt: true } }),
        loadSectionReadRules(prisma, [course.id]),
        moduleIds.length > 0
          ? prisma.submission.findMany({ where: { moduleId: { in: moduleIds } }, select: { userId: true }, distinct: ["userId"] })
          : Promise.resolve([] as Array<{ userId: string }>),
        prisma.courseCompletion.findMany({ where: { courseId: course.id, versionMajor: course.versionMajor }, select: { userId: true } }),
      ]);
      const holders = new Set(current.map((row) => row.userId));
      const rule = rules.get(course.id);
      const oldRead = new Map<string, Set<string>>();
      for (const read of ownReads) {
        if (!readCountsForCurrentVersion(rule, read.sectionId, read.readAt)) continue;
        oldRead.set(read.userId, (oldRead.get(read.userId) ?? new Set()).add(read.sectionId));
      }
      const candidates = [
        ...new Set([
          ...submitters.map((row) => row.userId),
          ...creditIgnoringVisibility.rows.map((row) => row.userId),
          ...ownReads.map((row) => row.userId),
        ]),
      ].filter((userId) => !holders.has(userId));
      if (candidates.length === 0) {
        rows.push({ courseId: course.id, title: titleOf(course.title), enrollmentPolicy: course.enrollmentPolicy, versionMajor: course.versionMajor, holdersNow: holders.size, today: 0, newRule: 0, added: 0, notVisible: 0, goesFromZero: false });
        continue;
      }
      const progress = moduleIds.length > 0 ? await repo.findModuleProgress({ userIds: candidates, courses: [{ courseId: course.id, moduleIds }] }) : null;

      let today = 0;
      let newRule = 0;
      let notVisible = 0;
      for (const userId of candidates) {
        const modulesDone = !progress || moduleIds.every((id) => progress.passedModuleIds(userId, course.id).has(id));
        if (!modulesDone) continue;
        const allIn = (read: Set<string>) => sectionIds.every((id) => read.has(id));
        const doneToday = allIn(oldRead.get(userId) ?? new Set());
        const doneNew = allIn(credit.readSectionIds(userId, course.id));
        const doneIgnoringVisibility = allIn(creditIgnoringVisibility.readSectionIds(userId, course.id));
        if (doneToday) today += 1;
        if (doneNew) newRule += 1;
        else if (doneIgnoringVisibility) notVisible += 1;
      }
      rows.push({
        courseId: course.id,
        title: titleOf(course.title),
        enrollmentPolicy: course.enrollmentPolicy,
        versionMajor: course.versionMajor,
        holdersNow: holders.size,
        today,
        newRule,
        added: newRule - today,
        notVisible,
        goesFromZero: holders.size === 0 && newRule > 0,
      });
    }

    const affected = rows.filter((row) => row.newRule > 0 || row.notVisible > 0 || row.today > 0).sort((a, b) => b.added - a.added || b.notVisible - a.notVisible);
    const sum = (pick: (row: (typeof rows)[number]) => number, filter: (row: (typeof rows)[number]) => boolean = () => true) =>
      rows.filter(filter).reduce((total, row) => total + pick(row), 0);
    console.log(
      JSON.stringify(
        {
          event: "section_read_certificates_1156",
          coursesWithSections: rows.length,
          totals: {
            today: sum((row) => row.today),
            newRule: sum((row) => row.newRule),
            added: sum((row) => row.added),
            addedInOpenCourses: sum((row) => row.added, (row) => row.enrollmentPolicy === "OPEN"),
            addedInRestrictedCourses: sum((row) => row.added, (row) => row.enrollmentPolicy !== "OPEN"),
            notVisible: sum((row) => row.notVisible),
          },
          coursesGoingFromZeroHolders: rows.filter((row) => row.goesFromZero).map((row) => ({ courseId: row.courseId, title: row.title, newRule: row.newRule })),
          courses: affected,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("section_read_certificates_1156_failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
