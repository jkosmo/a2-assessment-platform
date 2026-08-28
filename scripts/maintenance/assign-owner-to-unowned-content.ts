/**
 * #943 oppfølging: gi et menneske eierskap til innhold som ikke har noen eier.
 *
 * Bakgrunnen er konkret. Eierskapsvakta (#787) behandler innhold UTEN en `ContentOwner`-rad som
 * administrator-eid: `decideOwnershipAccess` svarer «unowned», og alle andre får 403. Da #916 og
 * #943 utvidet vakta fra skriving til lesing, sluttet den regelen å være teoretisk — en telling mot
 * stage 2026-08-28 fant 20 av 48 seksjoner uten eier, sist endret så sent som 18. august. De er
 * uåpnelige for enhver som ikke er administrator.
 *
 * ⚠️ Og de kan ikke repareres automatisk: `CourseSection` har ingen `createdById`. Det finnes ingen
 * data å utlede den rettmessige eieren fra. Bare et menneske kan bestemme hvem det skal være — som
 * er nettopp derfor dette er et skript med en navngitt bruker, og ikke en migrasjon.
 *
 * Skriver til ContentOwner, så det er en TØRRKJØRING med mindre du sender --apply.
 *
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/assign-owner-to-unowned-content.ts --owner <e-post>
 *   dotenv -e .env.<env> -- tsx scripts/maintenance/assign-owner-to-unowned-content.ts --owner <e-post> --apply
 *
 * Mot Azure: midlertidig brannmurregel, se doc/OPERATIONS_RUNBOOK.md. Kjør tørrkjøringen først og
 * les listene — de sier nøyaktig hva som ville fått eier.
 *
 * Idempotent: `addContentOwner` er en no-op om raden finnes, så en ny kjøring rapporterer 0.
 * Hver tildeling revisjonslogges (`content_owner_added`) med den nye eieren som aktør.
 *
 * ⚠️ SYSTEMKLASSER holdes UTENFOR med vilje. At «Alle deltakere» er eierløs er en bevisst
 * invariant (#645/#787): den forvaltes bare av administratorer. Å gi den en eier ville gjort en
 * ikke-administrator i stand til å styre hvem som er med i alle-klassen. Send
 * --include-system-classes hvis det likevel er det du vil.
 */
import type { ContentOwnerType } from "@prisma/client";
import { prisma } from "../../src/db/prisma.js";
import { addContentOwner } from "../../src/modules/content/contentOwnershipService.js";

interface Candidate {
  contentType: ContentOwnerType;
  id: string;
  label: string;
}

/** Titler er lokalisert JSON. Vi vil bare ha noe lesbart i loggen, ikke en oversettelse. */
function readableTitle(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, string> | string;
    if (typeof parsed === "string") return parsed;
    return parsed.nb ?? parsed["en-GB"] ?? Object.values(parsed)[0] ?? "(uten tittel)";
  } catch {
    return raw;
  }
}

async function unownedOf(
  contentType: ContentOwnerType,
  rows: Array<{ id: string; label: string }>,
): Promise<Candidate[]> {
  if (rows.length === 0) return [];
  const owned = new Set(
    (
      await prisma.contentOwner.findMany({
        where: { contentType, contentId: { in: rows.map((r) => r.id) } },
        select: { contentId: true },
      })
    ).map((o) => o.contentId),
  );
  return rows.filter((r) => !owned.has(r.id)).map((r) => ({ contentType, id: r.id, label: r.label }));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const includeSystemClasses = process.argv.includes("--include-system-classes");
  const ownerFlag = process.argv.indexOf("--owner");
  const ownerEmail = ownerFlag >= 0 ? process.argv[ownerFlag + 1] : undefined;

  if (!ownerEmail) {
    console.error("Mangler --owner <e-post>. Eieren må navngis; den kan ikke utledes fra dataene.");
    process.exitCode = 1;
    return;
  }

  const owner = await prisma.user.findFirst({
    where: { email: { equals: ownerEmail, mode: "insensitive" } },
    select: { id: true, email: true, name: true },
  });
  if (!owner) {
    // ⚠️ Viktig at dette stopper. Et skript som stille hopper over en ukjent bruker ville
    // rapportert «0 tildelt» og sett ut som om alt allerede var i orden.
    console.error(`Fant ingen bruker med e-post ${ownerEmail} i denne databasen.`);
    process.exitCode = 1;
    return;
  }

  const [courses, sections, modules, classes] = await Promise.all([
    prisma.course.findMany({ select: { id: true, title: true } }),
    prisma.courseSection.findMany({ select: { id: true, title: true } }),
    prisma.module.findMany({ select: { id: true, title: true } }),
    prisma.class.findMany({ select: { id: true, name: true, isSystem: true } }),
  ]);

  const candidates = [
    ...(await unownedOf("COURSE", courses.map((c) => ({ id: c.id, label: readableTitle(c.title) })))),
    ...(await unownedOf("SECTION", sections.map((s) => ({ id: s.id, label: readableTitle(s.title) })))),
    ...(await unownedOf("MODULE", modules.map((m) => ({ id: m.id, label: readableTitle(m.title) })))),
    ...(await unownedOf(
      "CLASS",
      classes
        .filter((k) => includeSystemClasses || !k.isSystem)
        .map((k) => ({ id: k.id, label: `${k.name}${k.isSystem ? " [SYSTEM]" : ""}` })),
    )),
  ];

  const skippedSystemClasses = includeSystemClasses ? 0 : classes.filter((k) => k.isSystem).length;

  for (const c of candidates) {
    console.log(JSON.stringify({ event: "unowned_content", contentType: c.contentType, id: c.id, title: c.label }));
  }

  let assigned = 0;
  if (apply) {
    for (const c of candidates) {
      await addContentOwner({
        contentType: c.contentType,
        contentId: c.id,
        ownerUserId: owner.id,
        actorUserId: owner.id,
      });
      assigned += 1;
    }
  }

  console.log(
    JSON.stringify({
      event: "assign_owner_to_unowned_complete",
      dryRun: !apply,
      owner: owner.email,
      unownedFound: candidates.length,
      assigned,
      skippedSystemClasses,
      byType: candidates.reduce<Record<string, number>>((acc, c) => {
        acc[c.contentType] = (acc[c.contentType] ?? 0) + 1;
        return acc;
      }, {}),
    }),
  );

  if (!apply && candidates.length > 0) {
    console.log("Tørrkjøring. Kjør på nytt med --apply for å skrive eierradene.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
