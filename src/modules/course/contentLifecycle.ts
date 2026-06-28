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

function inUseMessage(
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

// G3: et kurs med minst én påbegynt-ufullført deltaker kan ikke avpubliseres/arkiveres.
export async function assertCourseHasNoInProgressParticipants(courseId: string, verb: string): Promise<void> {
  const count = await countCourseInProgressParticipants(courseId);
  if (count > 0) {
    const deltaker = count === 1 ? "1 deltaker har" : `${count} deltakere har`;
    throw new ValidationError(
      `Kurset kan ikke ${verb} fordi ${deltaker} en påbegynt, ufullført gjennomføring. ` +
        `Vent til de er ferdige, eller fjern påmeldingene først.`,
    );
  }
}
