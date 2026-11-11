// #1139 skive 1 (doc/design/PLAN_1139.md, punkt 1, 2, 5 og 12.2): hva den ukentlige e-posten sier til én person.
//
// «Utestående» har tre kilder (planen 12.2):
//   (a) framdriften i «Mine kurs» (`getMyCoursesProgress`, skive 0): hvilke kurs personen ser, og hvilke som er i gang;
//   (b) kursbevis for en hvilken som helst hovedversjon tar kurset ut (spørsmål 6: ny versjon er frivillig);
//   (c) tildelinger: individuelle (`CourseEnrollment`, ikke `SELF`) og fra klasser. Individuell frist går foran klassens; klassen
//       gir den tidligste fristen.
//
// Hvert kurs står én gang, i den første gruppen det passer i: frist som har gått ut (også eldre enn to uker, spørsmål 2), frist
// innen to uker, i gang, tildelt og ikke påbegynt. Fristdager regnes i Oslo-dager (planen 12.11). Står ingenting igjen: `null`, og
// ingen e-post.
//
// Humøret regnes ved slutten av forrige uke, søndag 23:59:59 Oslo (spørsmål 8), med den samme regelen som profilen
// (`boatMood`), så båten aldri har to humør.
import { prisma } from "../../db/prisma.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { boatMood, type BoatMood } from "../gamification/boatMood.js";
import { getMyCoursesProgress } from "../course/myCoursesProgress.js";
import type { CourseListItem } from "../course/courseReadModels.js";
import { activityEventsFrom, addDaysToKey, loadActivitySources, mondayOfKey, osloDayKey } from "../reporting/activityReport.js";

/** Så mange dager fram regnes en frist som «snart» (produkteier: «frist innen to uker»). */
export const WEEKLY_DIGEST_DUE_SOON_DAYS = 14;

export type WeeklyDigestCourse = {
  courseId: string;
  title: string;
  dueAt: Date | null;
  /** Steg igjen (moduler og seksjoner), som i «Mine kurs». */
  stepsLeft: number;
  started: boolean;
};

export type WeeklyDigestContent = {
  /** Mandagen i uka e-posten gjelder (Oslo), `YYYY-MM-DD`. */
  weekKey: string;
  mood: BoatMood;
  overdue: WeeklyDigestCourse[];
  dueSoon: WeeklyDigestCourse[];
  inProgress: WeeklyDigestCourse[];
  notStarted: WeeklyDigestCourse[];
};

export type WeeklyDigestIndividualEnrollment = { courseId: string; source: string; dueAt: Date | null };

/** Midnatt i Oslo for en Oslo-dag, som et tidspunkt. Oslo er UTC+1 eller UTC+2; den riktige er den som gir samme dag. */
export function osloMidnight(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(Date.UTC(y!, m! - 1, d!, -offsetHours));
    if (osloDayKey(candidate) === dayKey && osloDayKey(new Date(candidate.getTime() - 1)) !== dayKey) return candidate;
  }
  throw new Error(`No Oslo midnight found for ${dayKey}`);
}

/** Uka e-posten gjelder: mandagen (Oslo) i uka `now` hører til. */
export function weeklyDigestWeekKey(now: Date): string {
  return mondayOfKey(osloDayKey(now));
}

/** Slutten av forrige uke: siste millisekund før mandag 00:00 Oslo i uka `now` hører til (spørsmål 8). */
export function endOfPreviousWeek(now: Date): Date {
  return new Date(osloMidnight(weeklyDigestWeekKey(now)).getTime() - 1);
}

/** Den rene regelen, uten database: hvilke kurs som står igjen, og i hvilken gruppe. `null` når ingenting står igjen. */
export function classifyWeeklyDigest(input: {
  now: Date;
  progress: CourseListItem[];
  certifiedCourseIds: Set<string>;
  individual: WeeklyDigestIndividualEnrollment[];
  classCourseDue: Map<string, Date | null>;
  lastActivityAt: Date | null;
}): WeeklyDigestContent | null {
  const todayKey = osloDayKey(input.now);
  const soonKey = addDaysToKey(todayKey, WEEKLY_DIGEST_DUE_SOON_DAYS);
  const individual = new Map(input.individual.filter((e) => e.source !== "SELF").map((e) => [e.courseId, e]));

  const content: WeeklyDigestContent = {
    weekKey: weeklyDigestWeekKey(input.now),
    mood: boatMood(input.lastActivityAt, endOfPreviousWeek(input.now)),
    overdue: [],
    dueSoon: [],
    inProgress: [],
    notStarted: [],
  };

  for (const course of input.progress) {
    if (input.certifiedCourseIds.has(course.id)) continue;
    const status = course.progress.courseStatus;
    // Alle steg gjort, men kursbeviset mangler (det utstedes like etter): ingenting å gjøre for deltakeren.
    if (status === "COMPLETED") continue;
    const assigned = individual.has(course.id) || input.classCourseDue.has(course.id);
    const dueAt = individual.get(course.id)?.dueAt ?? input.classCourseDue.get(course.id) ?? null;
    const started = status === "IN_PROGRESS";
    const item: WeeklyDigestCourse = {
      courseId: course.id,
      title: course.title,
      dueAt,
      stepsLeft: Math.max(0, course.progress.total - course.progress.completed),
      started,
    };
    const dueKey = dueAt ? osloDayKey(dueAt) : null;
    if (dueKey && dueKey < todayKey) content.overdue.push(item);
    else if (dueKey && dueKey <= soonKey) content.dueSoon.push(item);
    else if (started) content.inProgress.push(item);
    else if (assigned) content.notStarted.push(item);
  }

  if (content.overdue.length + content.dueSoon.length + content.inProgress.length + content.notStarted.length === 0) return null;
  const byDue = (a: WeeklyDigestCourse, b: WeeklyDigestCourse) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  content.overdue.sort(byDue);
  content.dueSoon.sort(byDue);
  content.notStarted.sort(byDue);
  return content;
}

/**
 * Innholdet for én person nå, eller `null` når ingenting står igjen. `roles` og `locale` er parametre (planen 12.2): ruta har dem fra
 * innloggingen, workeren fra databasen (`getActiveRoles`, `recipientLocale`). Ingen Entra-grupper i workeren (kjent mangel).
 */
export async function getWeeklyDigestContent(input: { userId: string; roles: string[]; locale: SupportedLocale; now: Date }): Promise<WeeklyDigestContent | null> {
  const { userId, roles, locale, now } = input;
  const weekEnd = endOfPreviousWeek(now);
  const [{ items, classCourseDue }, completions, enrollments, activity] = await Promise.all([
    getMyCoursesProgress({ userId, roles, locale }),
    prisma.courseCompletion.findMany({ where: { userId }, select: { courseId: true } }),
    prisma.courseEnrollment.findMany({ where: { userId, revokedAt: null }, select: { courseId: true, source: true, dueAt: true } }),
    loadActivitySources([userId], weekEnd),
  ]);
  let lastActivityAt: Date | null = null;
  for (const event of activityEventsFrom(activity, weekEnd)) {
    if (event.at <= weekEnd && (!lastActivityAt || event.at > lastActivityAt)) lastActivityAt = event.at;
  }
  return classifyWeeklyDigest({
    now,
    progress: items,
    certifiedCourseIds: new Set(completions.map((c) => c.courseId)),
    individual: enrollments,
    classCourseDue,
    lastActivityAt,
  });
}
