// #1156 (QA-porten): «ser deltakerne disse kursene?» og «har de gjort noe i kursene selv?», for MANGE deltakere på én gang, i et fast
// antall spørringer og på kallerens klient.
//
// Hvorfor: en lesing gjort i et annet kurs teller bare i kurs deltakeren ser (sectionReadCredit.ts). Synligheten ble først slått opp
// én deltaker om gangen (4–8 rundturer hver, på den globale klienten). Arkiveringen, slettingen og importen spør under den
// EKSKLUSIVE innholdslåsen; med et begrenset kurs som deler en seksjon med et åpent kurs 300 har lest, ble det 300 × 5 oppslag mens
// alle andre ventet. Her er det ett sett med spørringer per kall, uansett hvor mange deltakere, og de går gjennom transaksjonen når
// kalleren står i en.
//
// REGELEN er den «Mine kurs» bruker for én innlogget deltaker (`getUserClassIds` → `getClassAssignedCourseDueDates` →
// `filterVisibleCourseIds`), uten innlogging:
//   - et åpent kurs (`OPEN`) ser alle;
//   - et begrenset kurs ser den som har en aktiv påmelding (`revokedAt` tom), eller er i en klasse kurset er tildelt:
//     klasser hen er medlem av, og «Alle deltakere» for den som har deltakerrollen LAGRET (`RoleAssignment`, gyldig nå);
//   - et kurs deltakeren BARE har fra arkiverte klasser, ser hen bare når hen har påbegynt eller fullført det
//     (`findStartedOrCompletedPairs`, under; produkteier 2026-11-08).
// Entra-klasser telles ikke: gruppene står bare i innloggingen (kjent mangel, som den ukentlige e-posten; slike klasser kan ikke
// opprettes i dag, #1017). Når kalleren HAR innloggingen (ruta), brukes `findCoursesVisibleToLearner` (enrollmentService.ts).
import type { prisma } from "../../db/prisma.js";
import { PARTICIPANTS } from "../../auth/roleSets.js";
import { SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "./classRepository.js";
import { findModuleItemsForCourses } from "./courseRepository.js";

export type VisibilityClient = Pick<
  typeof prisma,
  | "courseEnrollment"
  | "courseGroupAssignment"
  | "classMember"
  | "roleAssignment"
  | "courseCompletion"
  | "courseSectionRead"
  | "discussionThread"
  | "discussionReply"
  | "discussionSubscription"
  | "submission"
  | "courseItem"
>;

/** Nøkkelen for et par (deltaker, kurs) i settene under. */
export function pairKey(userId: string, courseId: string): string {
  return `${userId}\n${courseId}`;
}

/**
 * Parene (deltaker, kurs) der deltakeren har lest noe I KURSET SELV (uansett seksjon og hovedversjon). Ikke fremdrift: produkteier
 * 14.11.2026, «e-post og synlighet krever aktivitet i kurset selv». Én spørring.
 */
export async function findOwnReadPairs(client: Pick<typeof prisma, "courseSectionRead">, userIds: string[], courseIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0 || courseIds.length === 0) return new Set();
  const rows = await client.courseSectionRead.findMany({
    where: { userId: { in: userIds }, courseId: { in: courseIds } },
    distinct: ["userId", "courseId"],
    select: { userId: true, courseId: true },
  });
  return new Set(rows.flatMap((row) => (row.courseId ? [pairKey(row.userId, row.courseId)] : [])));
}

/**
 * Kursene der deltakeren har lest noe I KURSET SELV. «I gang» i den ukentlige e-posten (`getMyCoursesProgress`) spør her. Vilkår 9
 * i tildelings-e-posten stiller det samme spørsmålet i rå SQL (courseAssignmentNotice.ts).
 */
export async function findCoursesWithOwnReads(client: Pick<typeof prisma, "courseSectionRead">, userId: string, courseIds: string[]): Promise<Set<string>> {
  const pairs = await findOwnReadPairs(client, [userId], courseIds);
  return new Set(courseIds.filter((courseId) => pairs.has(pairKey(userId, courseId))));
}

/**
 * Parene (deltaker, kurs) der deltakeren har påbegynt eller fullført kurset, minst én av (regelen for kurs fra arkiverte klasser,
 * `findStartedOrCompletedCourseIds` i classService.ts, som spør her):
 *   1. en lest seksjon i kurset, gjort I kurset (#1156: ikke en som teller på tvers);
 *   2. en innlevering på en modul i kurset, uansett status, også en arkivert modul;
 *   3. et kursbevis for kurset, uansett versjon;
 *   4. en tråd eller et svar i kursets diskusjoner, eller en tråd deltakeren følger.
 * Et fast antall spørringer, uansett hvor mange deltakere og kurs.
 */
export async function findStartedOrCompletedPairs(client: VisibilityClient, userIds: string[], courseIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (userIds.length === 0 || courseIds.length === 0) return found;
  const [completions, ownReads, threads, replies, follows, moduleItems] = await Promise.all([
    client.courseCompletion.findMany({ where: { userId: { in: userIds }, courseId: { in: courseIds } }, select: { userId: true, courseId: true } }),
    findOwnReadPairs(client, userIds, courseIds),
    client.discussionThread.findMany({ where: { authorId: { in: userIds }, courseId: { in: courseIds } }, select: { authorId: true, courseId: true } }),
    client.discussionReply.findMany({
      where: { authorId: { in: userIds }, thread: { courseId: { in: courseIds } } },
      select: { authorId: true, thread: { select: { courseId: true } } },
    }),
    client.discussionSubscription.findMany({
      where: { userId: { in: userIds }, thread: { courseId: { in: courseIds } } },
      select: { userId: true, thread: { select: { courseId: true } } },
    }),
    findModuleItemsForCourses(client, courseIds),
  ]);
  for (const key of ownReads) found.add(key);
  for (const row of completions) found.add(pairKey(row.userId, row.courseId));
  for (const row of threads) found.add(pairKey(row.authorId, row.courseId));
  for (const row of replies) found.add(pairKey(row.authorId, row.thread.courseId));
  for (const row of follows) found.add(pairKey(row.userId, row.thread.courseId));

  const coursesByModule = new Map<string, string[]>();
  for (const item of moduleItems) {
    if (!item.moduleId) continue;
    coursesByModule.set(item.moduleId, [...(coursesByModule.get(item.moduleId) ?? []), item.courseId]);
  }
  if (coursesByModule.size === 0) return found;
  const submitted = await client.submission.findMany({
    where: { userId: { in: userIds }, moduleId: { in: [...coursesByModule.keys()] } },
    distinct: ["userId", "moduleId"],
    select: { userId: true, moduleId: true },
  });
  for (const row of submitted) {
    for (const courseId of coursesByModule.get(row.moduleId) ?? []) found.add(pairKey(row.userId, courseId));
  }
  return found;
}

/**
 * For hvert kurs: hvem av `userIds` som ser det (regelen øverst). Et fast antall spørringer (påmeldinger, tildelinger, medlemskap,
 * roller, og for kurs bare fra arkiverte klasser `findStartedOrCompletedPairs`), uansett hvor mange deltakere.
 */
export async function findLearnersSeeingCourses(
  client: VisibilityClient,
  courses: Array<{ id: string; enrollmentPolicy: string }>,
  userIds: string[],
  now: Date = new Date(),
): Promise<Map<string, Set<string>>> {
  const users = [...new Set(userIds)];
  const seeing = new Map<string, Set<string>>(courses.map((course) => [course.id, new Set<string>()]));
  if (users.length === 0) return seeing;
  const restricted: string[] = [];
  for (const course of courses) {
    if (course.enrollmentPolicy === "OPEN") seeing.set(course.id, new Set(users));
    else restricted.push(course.id);
  }
  if (restricted.length === 0) return seeing;

  const [enrolled, assignments] = await Promise.all([
    client.courseEnrollment.findMany({
      where: { courseId: { in: restricted }, userId: { in: users }, revokedAt: null },
      select: { userId: true, courseId: true },
    }),
    client.courseGroupAssignment.findMany({
      where: { courseId: { in: restricted } },
      select: { courseId: true, classId: true, class: { select: { archivedAt: true } } },
    }),
  ]);
  for (const row of enrolled) seeing.get(row.courseId)?.add(row.userId);
  if (assignments.length === 0) return seeing;

  const classIds = [...new Set(assignments.map((row) => row.classId))];
  const [members, participants] = await Promise.all([
    client.classMember.findMany({ where: { classId: { in: classIds }, userId: { in: users } }, select: { classId: true, userId: true } }),
    classIds.includes(SYSTEM_ALL_PARTICIPANTS_CLASS_ID)
      ? client.roleAssignment.findMany({
          where: {
            userId: { in: users },
            appRole: { in: [...PARTICIPANTS] },
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gte: now } }],
          },
          distinct: ["userId"],
          select: { userId: true },
        })
      : Promise.resolve([] as Array<{ userId: string }>),
  ]);
  const classesOf = new Map<string, Set<string>>();
  const addClass = (userId: string, classId: string) => classesOf.set(userId, (classesOf.get(userId) ?? new Set()).add(classId));
  for (const row of members) addClass(row.userId, row.classId);
  for (const row of participants) addClass(row.userId, SYSTEM_ALL_PARTICIPANTS_CLASS_ID);

  // Per (deltaker, kurs): fra minst én aktiv klasse → ser det; bare fra arkiverte → avgjøres av «påbegynt eller fullført».
  const onlyArchived: Array<{ userId: string; courseId: string }> = [];
  for (const userId of users) {
    const own = classesOf.get(userId);
    if (!own) continue;
    const viaClass = new Map<string, boolean>();
    for (const row of assignments) {
      if (!own.has(row.classId)) continue;
      viaClass.set(row.courseId, (viaClass.get(row.courseId) ?? false) || row.class.archivedAt === null);
    }
    for (const [courseId, fromActive] of viaClass) {
      if (fromActive) seeing.get(courseId)?.add(userId);
      else onlyArchived.push({ userId, courseId });
    }
  }
  if (onlyArchived.length > 0) {
    const started = await findStartedOrCompletedPairs(
      client,
      [...new Set(onlyArchived.map((pair) => pair.userId))],
      [...new Set(onlyArchived.map((pair) => pair.courseId))],
    );
    for (const pair of onlyArchived) if (started.has(pairKey(pair.userId, pair.courseId))) seeing.get(pair.courseId)?.add(pair.userId);
  }
  return seeing;
}
