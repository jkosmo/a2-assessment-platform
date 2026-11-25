// #1192 punkt 2 (produkteier 2026-11-24, doc/design/PLAN_1192_BESTATT_OG_FRIST.md del 2): en ny hovedversjon av et kurs er
// frivillig til noen setter en ny frist (DESIGN_934, avgjort 2026-11-01). Når fristen som gjelder for personen
// (`effectiveDeadline`) ble satt ETTER at kursets nåværende hovedversjon ble publisert, er kurset utestående igjen for den som
// bare har kursbevis for en eldre hovedversjon. Ellers står et oppfylt kurs som fullført.
//
// ⚠️ DET ENE STEDET for denne regelen. `deriveStatuses` (/enrollments, administratorens liste, Status, påminnelsene), den
// ukentlige e-posten og kursrapporten spør her. Tildelingse-posten har regelen i SQL (`courseAssignmentNotice.ts`, vilkår 8)
// fordi den lager rader i én spørring; testen sammenligner dem.
//
// `dueSetAt = null` er en frist satt før feltet fantes: den regnes som gammel (svar B). Samme tidspunkt som publiseringen
// regnes som «ikke etter».
import { prisma } from "../../db/prisma.js";
import { pairKey } from "./learnerVisibility.js";

export type CurrentMajor = { versionMajor: number; publishedAt: Date | null };

/** Kursets nåværende hovedversjon og når den ble publisert (`CourseVersion`; null for et kurs som alltid har vært 1.x). */
export async function findCurrentMajors(
  client: Pick<typeof prisma, "course" | "courseVersion">,
  courseIds: string[],
): Promise<Map<string, CurrentMajor>> {
  if (courseIds.length === 0) return new Map();
  const courses = await client.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, versionMajor: true } });
  const versions = await client.courseVersion.findMany({
    where: { courseId: { in: courseIds } },
    select: { courseId: true, versionMajor: true, publishedAt: true },
  });
  const publishedAt = new Map(versions.map((v) => [`${v.courseId}\n${v.versionMajor}`, v.publishedAt]));
  return new Map(courses.map((c) => [c.id, { versionMajor: c.versionMajor, publishedAt: publishedAt.get(`${c.id}\n${c.versionMajor}`) ?? null }]));
}

/** Gjør denne fristen kurset utestående for den som bare har et eldre kursbevis? */
export function deadlineReopensCourse(deadline: { dueAt: Date | null; dueSetAt: Date | null }, current: CurrentMajor | undefined): boolean {
  if (!deadline.dueAt || !deadline.dueSetAt || !current?.publishedAt) return false;
  return deadline.dueSetAt.getTime() > current.publishedAt.getTime();
}

/** Høyeste hovedversjon personen har kursbevis for, per (person, kurs). */
export async function findCertificateMajors(
  client: Pick<typeof prisma, "courseCompletion">,
  userIds: string[],
  courseIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0 || courseIds.length === 0) return new Map();
  const rows = await client.courseCompletion.findMany({
    where: { userId: { in: userIds }, courseId: { in: courseIds } },
    select: { userId: true, courseId: true, versionMajor: true },
  });
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = pairKey(row.userId, row.courseId);
    out.set(key, Math.max(out.get(key) ?? 0, row.versionMajor));
  }
  return out;
}

/**
 * Er kurset fullført for personen? Kursbevis for nåværende (eller nyere) hovedversjon: ja. Bare et eldre kursbevis: ja, med
 * mindre fristen som gjelder, ble satt etter den nye hovedversjonen. Intet kursbevis: nei.
 */
export function isCertifiedForDeadline(
  certificateMajor: number | undefined,
  current: CurrentMajor | undefined,
  deadline: { dueAt: Date | null; dueSetAt: Date | null },
): boolean {
  if (certificateMajor === undefined) return false;
  if (!current || certificateMajor >= current.versionMajor) return true;
  return !deadlineReopensCourse(deadline, current);
}
