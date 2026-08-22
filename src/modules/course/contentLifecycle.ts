import { prisma } from "../../db/prisma.js";
import { ValidationError } from "../../errors/AppError.js";
import { localizeContentText } from "../../i18n/content.js";

// Enhetlig innholds-livssyklus — delte vakter for kurs/modul/seksjon.
// Se doc/design/CONTENT_LIFECYCLE.md. G2 = bruk-lås (modul/seksjon i ETHVERT kurs kan ikke
// avpubliseres/arkiveres/slettes). G3 = aktivitets-lås (kurs med påbegynt-ufullført deltaker
// kan ikke avpubliseres/arkiveres). Feilmeldinger navngir kursene/teller deltakerne på norsk.

const MSG_LOCALE = "nb" as const;

function courseDisplayTitle(rawTitle: string): string {
  return localizeContentText(MSG_LOCALE, rawTitle) ?? rawTitle;
}

async function coursesContaining(
  itemWhere: { moduleId: string } | { sectionId: string },
): Promise<Array<{ id: string; title: string }>> {
  const rows = await prisma.course.findMany({
    where: { items: { some: itemWhere } },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({ id: row.id, title: courseDisplayTitle(row.title) }));
}

export function findCoursesContainingModule(moduleId: string) {
  return coursesContaining({ moduleId });
}

export function findCoursesContainingSection(sectionId: string) {
  return coursesContaining({ sectionId });
}

// #705-UX(G): batch — hvilke kurs bruker hver av disse seksjonene (for «Brukt i kurs»-kolonnen i
// seksjonslista, med samme popover som modul-biblioteket). Ett spørsmål for alle seksjonene.
export async function findCoursesForSections(
  sectionIds: string[],
): Promise<Map<string, Array<{ id: string; title: string }>>> {
  const result = new Map<string, Array<{ id: string; title: string }>>();
  if (sectionIds.length === 0) return result;
  const items = await prisma.courseItem.findMany({
    where: { sectionId: { in: sectionIds }, itemType: "SECTION" },
    select: { sectionId: true, course: { select: { id: true, title: true } } },
  });
  for (const item of items) {
    if (!item.sectionId || !item.course) continue;
    const list = result.get(item.sectionId) ?? [];
    // Unngå duplikater hvis en seksjon skulle forekomme flere ganger.
    if (!list.some((c) => c.id === item.course.id)) {
      list.push({ id: item.course.id, title: courseDisplayTitle(item.course.title) });
    }
    result.set(item.sectionId, list);
  }
  return result;
}

// #705: exported so the module-delete route can reuse the exact G2 named-courses message
// (keeping its own 409 status) instead of a divergent count-only message.
export function inUseMessage(
  subject: "Modulen" | "Seksjonen",
  verb: string,
  courses: Array<{ title: string }>,
): string {
  const names = courses.map((c) => `«${c.title}»`).join(", ");
  const plural = courses.length === 1 ? "kurs" : "kurs";
  return (
    `${subject} kan ikke ${verb} fordi den er i bruk i ${courses.length} ${plural}: ${names}. ` +
    `Fjern den fra kursene først (eller avpubliser kursene).`
  );
}

// G2: en modul som ligger i ethvert kurs (publisert eller utkast) kan ikke avpubliseres/
// arkiveres/slettes. `verb` brukes i feilmeldingen, f.eks. "avpubliseres" | "arkiveres" | "slettes".
export async function assertModuleNotInAnyCourse(moduleId: string, verb: string): Promise<void> {
  const courses = await findCoursesContainingModule(moduleId);
  if (courses.length > 0) {
    throw new ValidationError(inUseMessage("Modulen", verb, courses));
  }
}

// G2 for seksjoner — samme regel.
export async function assertSectionNotInAnyCourse(sectionId: string, verb: string): Promise<void> {
  const courses = await findCoursesContainingSection(sectionId);
  if (courses.length > 0) {
    throw new ValidationError(inUseMessage("Seksjonen", verb, courses));
  }
}

// #938: innhold som står i et UTSTEDT kursbevis kan aldri slettes.
//
// Produkteier 2026-08-21: «Arkivert materiale var naturligvis del av pensum når diplom ble utdelt
// og må bevares som grunnlag for diplom, men ellers ikke.»
//
// G2 over nekter sletting mens innholdet ligger i et kurs — men når det er FJERNET derfra, var
// sletting tillatt, og ingenting sjekket om et kursbevis pekte på det. Snapshotet ville da bære en
// død id, og et utstedt diplom kunne ikke lenger begrunnes.
//
// ⚠️ Arkivering er fortsatt tillatt. Skillet er med vilje:
//   arkivere = ut av sirkulasjon, raden består, diplomet tåler det
//   slette    = borte, og da mister diplomet grunnlaget sitt
//
// ⚠️ Bevisst bivirkning: innhold noen har fått diplom på blir permanent uslettbart. Det er prisen
// for at et kursbevis skal kunne etterprøves, og den er godtatt.
//
// Implementasjonsnote: snapshotene er JSON-arrayer av id-er lagret som TEXT, så vi kan ikke joine.
// `contains` på id-en er derfor riktig verktøy — id-ene er cuid-er, så en delstreng-kollisjon med
// en ANNEN id er praktisk talt umulig. Skulle snapshot-formatet en dag bli en relasjon, bør denne
// sjekken bli en join.
async function assertNotInIssuedCertificate(
  id: string,
  column: "moduleSnapshotJson" | "sectionSnapshotJson",
  noun: string,
  verb: string,
): Promise<void> {
  const count = await prisma.courseCompletion.count({ where: { [column]: { contains: id } } });
  if (count > 0) {
    throw new ValidationError(
      `${noun} kan ikke ${verb} fordi den inngår i ${count} utstedt${count === 1 ? "" : "e"} kursbevis. `
      + "Arkiver den i stedet — et kursbevis må kunne vise hva det dekket.",
    );
  }
}

export function assertModuleNotInIssuedCertificate(moduleId: string, verb: string): Promise<void> {
  return assertNotInIssuedCertificate(moduleId, "moduleSnapshotJson", "Modulen", verb);
}

/**
 * Samme regel som `assertSectionNotInIssuedCertificate`, men RETURNERER grunnen i stedet for å
 * kaste — for kaskadeanalysen, som samler blokkeringer og viser dem i en forhåndsvisning.
 *
 * ⚠️ Regelen bor ett sted. To kopier — én som kaster og én som rapporterer — ville drevet fra
 * hverandre, og det er nettopp det #938 handlet om.
 */
export async function describeIssuedCertificateBlock(sectionId: string): Promise<string | null> {
  try {
    await assertSectionNotInIssuedCertificate(sectionId, "slettes");
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return error.message;
    throw error;
  }
}

export async function assertSectionNotInIssuedCertificate(sectionId: string, verb: string): Promise<void> {
  await assertNotInIssuedCertificate(sectionId, "sectionSnapshotJson", "Seksjonen", verb);

  // ⚠️ Kursbevis utstedt FØR v2.23.0 har `sectionSnapshotJson = NULL` — kolonnen er nullbar og med
  // vilje ikke bakfylt (`doc/DECISIONS.md`: NULL betyr ærlig «utstedt før vi registrerte dette»).
  // Et `contains`-oppslag treffer aldri NULL, så sjekken over beskyttet ingen av dem.
  //
  // Vi kan ikke vite hvilke seksjoner et slikt bevis dekket — dataene finnes ikke. Men vi har en
  // ærlig stedfortreder: leste deltakeren seksjonen i det kurset hen fikk beviset for, var den en
  // del av grunnlaget. Det er konservativt i riktig retning, og det er alt dataene tillater.
  const legacy = await prisma.courseCompletion.findMany({
    where: { sectionSnapshotJson: null },
    select: { userId: true, courseId: true },
  });
  if (legacy.length === 0) return;

  const covered = await prisma.courseSectionRead.count({
    where: {
      sectionId,
      OR: legacy.map((c) => ({ userId: c.userId, courseId: c.courseId })),
    },
  });
  if (covered > 0) {
    throw new ValidationError(
      `Seksjonen kan ikke ${verb} fordi den inngår i ${covered} kursbevis utstedt før `
      + "øyeblikksbildet ble innført. Arkiver den i stedet — et kursbevis må kunne vise hva det dekket.",
    );
  }
}

// Antall deltakere som har PÅBEGYNT (lest en seksjon eller levert et forsøk på en kurs-modul)
// men IKKE fullført (ingen CourseCompletion). Brukt av G3-vakta for kurs.
export async function countCourseInProgressParticipants(courseId: string): Promise<number> {
  const [reads, submissions, completions] = await Promise.all([
    prisma.courseSectionRead.findMany({
      where: { courseId },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.submission.findMany({
      where: { module: { courseItems: { some: { courseId } } } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.courseCompletion.findMany({ where: { courseId }, select: { userId: true } }),
  ]);

  const completed = new Set(completions.map((c) => c.userId));
  const started = new Set<string>();
  for (const r of reads) started.add(r.userId);
  for (const s of submissions) started.add(s.userId);

  let inProgress = 0;
  for (const userId of started) {
    if (!completed.has(userId)) inProgress += 1;
  }
  return inProgress;
}

// G3: et kurs med minst én påbegynt-ufullført deltaker kan ikke arkiveres (pensjoneres). Avpublisering
// er bevisst unntatt (reversibel «myk» nedtaking) — derfor peker meldingen på Avpubliser som alternativ.
export async function assertCourseHasNoInProgressParticipants(courseId: string, verb: string): Promise<void> {
  const count = await countCourseInProgressParticipants(courseId);
  if (count > 0) {
    const deltaker = count === 1 ? "1 deltaker er" : `${count} deltakere er`;
    throw new ValidationError(
      `Kurset kan ikke ${verb} fordi ${deltaker} midt i en gjennomføring. ` +
        `Avpubliser kurset i stedet (skjuler det uten å pensjonere det), eller vent til de er ferdige.`,
    );
  }
}
