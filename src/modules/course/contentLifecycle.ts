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
