// #1156 (doc/design/PLAN_1156_LEST_PA_TVERS.md, doc/DECISIONS.md «Lest seksjon teller i alle kurs deltakeren ser»): hvilke
// seksjoner en deltaker har lest, gyldig for et kurs. Speiler `findModuleProgress` (moduleCredit.ts): en lest seksjon teller i
// alle kurs som inneholder den, slik en bestått modul gjør, og hvert kurs avgjør selv om lesingen gjelder dets hovedversjon.
//
// ⚠️ `findSectionReadCredit` er DEN ENE veien til «hvilke seksjoner har deltakeren lest i dette kurset». Porten for kursbevis,
// «Mine kurs», kursdetaljen, kursrapporten og CSV, «midt i kurset», #1152-vakta og importen spør bare den.
// `test/section-read-reader-guard.test.js` nekter andre lesere av `CourseSectionRead`, med navngitte unntak.
//
// REGELEN, for deltaker D, kurs K og seksjon S i kursets elementliste:
//   1. Kandidatene er D sine lesinger av S, uansett hvilket kurs de ble gjort i (også et slettet kurs, `courseId` tom).
//   2. En lesing gjort I K teller alltid i K. En lesing gjort et annet sted teller bare når D ser K: K er åpent, eller begrenset
//      og D er tildelt (individuelt eller gjennom en klasse) — samme regel som «Mine kurs» (`filterVisibleCourseIds`).
//      Produkteier 14.11.2026: et kursbevis kan ikke trekkes tilbake og holder kurset igjen fra sletting for alltid.
//   3. Er K arkivert, teller en lesing gjort et annet sted bare når den er gjort fram til `archivedAt`. Ellers kunne et arkivert
//      kurs bli «fullført uten kursbevis» av at noen leser en delt seksjon et annet sted, og da kan det ikke slettes (#1152). En
//      lesing gjort i K selv teller som før: lesestien slipper ikke inn i et arkivert kurs, så den er gjort før arkiveringen.
//   4. Den SENESTE av lesingene som er igjen, velges. Med den tidsbaserte regelen teller en senere lesing alltid i minst like
//      mange kurs som en tidligere, så «seneste» mister aldri noe.
//   5. Kursets regel for nåværende hovedversjon (`readCountsForCurrentVersion`, courseVersioning.ts) avgjør om den teller.
//   6. Rapportens vindu gjelder den seneste lesingen, valgt FØR vinduet (planen, «Etter gjennomlesingen»).
//
// Elementlista velges av kalleren (`items`), og står i kontrakten: `participant` (det deltakeren kan lese nå) for fremdrift og
// kursbevis, `all` (også seksjoner arkivert sammen med kurset) for #1152-vakta og rapportens «har lest i kurset».
//
// ⚠️ Hører til #1140 etappe 5: når hvert kurs kan velge sin egen hovedversjon av en seksjon, holder ikke den tidsbaserte regelen
// lenger. Da må lesingen huske hvilken versjon som ble lest (`doc/DESIGN_1140.md`).
import type { prisma } from "../../db/prisma.js";
import type { ReportFilters } from "../reporting/types.js";
import { findSectionItemsForCourses, type SectionItemList } from "./courseRepository.js";
import { loadSectionReadRules, readCountsForCurrentVersion, type SectionReadRule } from "./courseVersioning.js";
import { findLearnersSeeingCourses, type VisibilityClient } from "./learnerVisibility.js";

type ReadCreditClient = Pick<typeof prisma, "course" | "courseItem" | "courseSectionRead" | "courseVersion"> & VisibilityClient;

export type { SectionItemList };

/** For hvert kurs: hvem av deltakerne som ser det. Standard: `findLearnersSeeingCourses` (learnerVisibility.ts) på kallerens klient. */
export type CourseVisibilityLookup = (courses: Array<{ id: string; enrollmentPolicy: string }>, userIds: string[]) => Promise<Map<string, Set<string>>>;

export type SectionReadCreditInput = {
  /** Utelatt: alle deltakere (kursrapporten, #1152-vakta, «midt i kurset»). Tom liste: ingenting. */
  userIds?: string[];
  courseIds: string[];
  /** Hvilken elementliste kursene spør for (se `SectionItemList`). */
  items: SectionItemList;
  /** Avgrens til disse seksjonene i lista (importen: seksjonen som byttes ut). */
  onlySectionIds?: string[];
  /** Kursrapportens vindu og avdeling. Vinduet gjelder den seneste lesingen, valgt først. */
  filters?: Pick<ReportFilters, "dateFrom" | "dateTo" | "orgUnit">;
  /**
   * Bare med én deltaker: kurs kalleren alt har slått fast at hen ser, med innloggingen («Mine kurs», kursdetaljen, lesingen,
   * avstemmingen). Ingenting slås opp for dem.
   */
  knownVisibleCourseIds?: Iterable<string>;
  /** Bare med `knownVisibleCourseIds`: lista er hele svaret, og et kurs som ikke står der, ser deltakeren ikke (avstemmingen). */
  visibilityComplete?: boolean;
  /** For tester og telleskriptet. Standard: `findLearnersSeeingCourses` på `client`. */
  lookupVisibility?: CourseVisibilityLookup;
};

/**
 * Én rad per deltaker, kurs og seksjon: den seneste lesingen som gjelder i kurset (punkt 1–4), i vinduet. `courseId` er kurset
 * det spørres for; `readInCourseId` er kurset lesingen ble gjort i (tom når det er slettet).
 */
export type SectionReadRow = { userId: string; courseId: string; sectionId: string; readAt: Date; readInCourseId: string | null; counts: boolean };

export type SectionReadCredit = {
  /** Seksjonene som teller for deltakeren i kurset: for kursets nåværende hovedversjon, og i vinduet. */
  readSectionIds(userId: string, courseId: string): Set<string>;
  /** Deltakerne som har lest en av kursets seksjoner i vinduet, også en lesing som ikke teller for hovedversjonen. */
  readerIds(courseId: string): Set<string>;
  rows: SectionReadRow[];
};

/** Det regelen trenger om ett kurs. */
export type CourseForReadCredit = {
  id: string;
  archivedAt: Date | null;
  sectionIds: string[];
  rule: SectionReadRule | null | undefined;
};

export type ReadForCredit = { userId: string; courseId: string | null; sectionId: string; readAt: Date };

/**
 * Regelen, uten database. `sees(userId, courseId)` svarer for kurs og deltakere med en lesing gjort et annet sted; den spørres
 * ikke for lesinger gjort i kurset selv.
 */
export function creditSectionReads(input: {
  courses: CourseForReadCredit[];
  reads: ReadForCredit[];
  sees: (userId: string, courseId: string) => boolean;
  filters?: Pick<ReportFilters, "dateFrom" | "dateTo">;
}): SectionReadCredit {
  const readsBySection = new Map<string, ReadForCredit[]>();
  for (const read of input.reads) {
    const list = readsBySection.get(read.sectionId);
    if (list) list.push(read);
    else readsBySection.set(read.sectionId, [read]);
  }
  const inWindow = (at: Date) =>
    (!input.filters?.dateFrom || at.getTime() >= input.filters.dateFrom.getTime())
    && (!input.filters?.dateTo || at.getTime() <= input.filters.dateTo.getTime());

  const rows: SectionReadRow[] = [];
  const counted = new Map<string, Set<string>>();
  const readers = new Map<string, Set<string>>();
  for (const course of input.courses) {
    for (const sectionId of new Set(course.sectionIds)) {
      const latest = new Map<string, ReadForCredit>();
      for (const read of readsBySection.get(sectionId) ?? []) {
        if (read.courseId !== course.id) {
          // Punkt 3: et arkivert kurs teller bare lesinger gjort et annet sted fram til arkiveringen.
          if (course.archivedAt && read.readAt.getTime() > course.archivedAt.getTime()) continue;
          // Punkt 2: gjort et annet sted teller bare i et kurs deltakeren ser.
          if (!input.sees(read.userId, course.id)) continue;
        }
        // Punkt 4: den seneste.
        const seen = latest.get(read.userId);
        if (!seen || read.readAt.getTime() > seen.readAt.getTime()) latest.set(read.userId, read);
      }
      for (const [userId, { readAt, courseId: readInCourseId }] of latest) {
        // Punkt 6: vinduet etter at den seneste er valgt.
        if (!inWindow(readAt)) continue;
        // Punkt 5: kursets regel for nåværende hovedversjon.
        const counts = readCountsForCurrentVersion(course.rule, sectionId, readAt);
        rows.push({ userId, courseId: course.id, sectionId, readAt, readInCourseId, counts });
        readers.set(course.id, (readers.get(course.id) ?? new Set()).add(userId));
        if (counts) {
          const key = `${userId}\n${course.id}`;
          counted.set(key, (counted.get(key) ?? new Set()).add(sectionId));
        }
      }
    }
  }
  return {
    readSectionIds: (userId, courseId) => counted.get(`${userId}\n${courseId}`) ?? new Set(),
    readerIds: (courseId) => readers.get(courseId) ?? new Set(),
    rows,
  };
}

function emptyCredit(): SectionReadCredit {
  return { readSectionIds: () => new Set(), readerIds: () => new Set(), rows: [] };
}

/**
 * ⚠️ DEN ENE VEIEN til «hvilke seksjoner har deltakeren lest i dette kurset». Leses på samme klient som dataene: i en låst
 * transaksjon (utstedelsen, arkiveringen, slettingen, importen) er lesingene, elementlista, regelen og synligheten lest i den
 * transaksjonen. Synligheten slås opp i ett sett med spørringer for alle deltakerne og kursene som trenger den
 * (`findLearnersSeeingCourses`), aldri én deltaker om gangen.
 */
export async function findSectionReadCredit(client: ReadCreditClient, input: SectionReadCreditInput): Promise<SectionReadCredit> {
  if (input.courseIds.length === 0 || input.userIds?.length === 0) return emptyCredit();
  const single = input.userIds?.length === 1 ? input.userIds[0] : null;
  if ((input.knownVisibleCourseIds || input.visibilityComplete) && !single) {
    throw new Error("findSectionReadCredit: knownVisibleCourseIds and visibilityComplete apply to exactly one participant.");
  }
  const courseIds = [...new Set(input.courseIds)];
  const [courses, items, rules] = await Promise.all([
    client.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, enrollmentPolicy: true, archivedAt: true } }),
    findSectionItemsForCourses(client, courseIds, input.items),
    loadSectionReadRules(client, courseIds),
  ]);
  const only = input.onlySectionIds ? new Set(input.onlySectionIds) : null;
  const sectionsByCourse = new Map<string, string[]>();
  for (const item of items) {
    if (only && !only.has(item.sectionId)) continue;
    sectionsByCourse.set(item.courseId, [...(sectionsByCourse.get(item.courseId) ?? []), item.sectionId]);
  }
  const sectionIds = [...new Set([...sectionsByCourse.values()].flat())];
  if (sectionIds.length === 0) return emptyCredit();

  const reads = await client.courseSectionRead.findMany({
    where: {
      sectionId: { in: sectionIds },
      ...(input.userIds ? { userId: { in: input.userIds } } : {}),
      ...(input.filters?.orgUnit ? { user: { department: input.filters.orgUnit } } : {}),
    },
    select: { userId: true, courseId: true, sectionId: true, readAt: true },
  });

  // Synligheten slås bare opp der den kan endre svaret: et begrenset kurs, en lesing gjort et annet sted, og (i et arkivert kurs)
  // gjort før arkiveringen. Alle kursene og deltakerne som trenger det, i ÉN omgang (et fast antall spørringer).
  const policyOf = new Map(courses.map((course) => [course.id, course.enrollmentPolicy]));
  const archivedAtOf = new Map(courses.map((course) => [course.id, course.archivedAt]));
  const known = new Set(input.knownVisibleCourseIds ?? []);
  const neededCourses = new Set<string>();
  const neededUsers = new Set<string>();
  if (!input.visibilityComplete) {
    for (const [courseId, ids] of sectionsByCourse) {
      if (policyOf.get(courseId) === "OPEN" || known.has(courseId)) continue;
      const inCourse = new Set(ids);
      const archivedAt = archivedAtOf.get(courseId);
      for (const read of reads) {
        if (read.courseId === courseId || !inCourse.has(read.sectionId)) continue;
        if (archivedAt && read.readAt.getTime() > archivedAt.getTime()) continue;
        neededCourses.add(courseId);
        neededUsers.add(read.userId);
      }
    }
  }
  const lookup = input.lookupVisibility ?? ((asked, userIds) => findLearnersSeeingCourses(client, asked, userIds));
  const seeing = neededCourses.size > 0
    ? await lookup([...neededCourses].map((id) => ({ id, enrollmentPolicy: policyOf.get(id) ?? "RESTRICTED" })), [...neededUsers])
    : new Map<string, Set<string>>();

  return creditSectionReads({
    courses: courses.map((course) => ({
      id: course.id,
      archivedAt: course.archivedAt,
      sectionIds: sectionsByCourse.get(course.id) ?? [],
      rule: rules.get(course.id),
    })),
    reads,
    sees: (userId, courseId) =>
      known.has(courseId)
      || (!input.visibilityComplete && (policyOf.get(courseId) === "OPEN" || (seeing.get(courseId)?.has(userId) ?? false))),
    filters: input.filters,
  });
}
