import { prisma } from "../../db/prisma.js";
import { AppRole } from "../../db/prismaRuntime.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";

// #1099: «Aktivitet» under Deltakere — samlet aktivitet over tid og hvem som er aktive, for alle kurs.
//
// ⚠️ INGEN NY LAGRING. Alt regnes ut av fire tabeller som har tidspunkt fra første dag: lesinger
// (CourseSectionRead), innleveringer (Submission), beståtte vedtak (AssessmentDecision) og fullførte
// kurs (CourseCompletion). «Sist innlogget» er User.lastLoginAt, som oppdateres ved hver
// autentiserte forespørsel. Innlogginger PER UKE finnes ikke i dag, og vises derfor ikke.
//
// ⚠️ DAGER OG UKER ER NORSKE. Serveren går i UTC; en lesing kl. 00:30 norsk tid hører til den dagen
// deltakeren opplevde. Alle dag- og ukenøkler er kalenderdatoer i Europe/Oslo (YYYY-MM-DD), og
// kalenderregningen gjøres på datoene, ikke på millisekunder — så sommertid kan ikke flytte en dag.

export type ActivityType = "read" | "submitted" | "passed" | "completed";
export const ACTIVITY_TYPES: readonly ActivityType[] = ["read", "submitted", "passed", "completed"];
export type ActivityGrain = "day" | "week";
export type ActivityPeriod = "4" | "12" | "all";
export type ActivityStatus = "active" | "quiet" | "not_started";

export type ActivityPerson = {
  userId: string;
  name: string;
  email: string;
  department: string | null;
  lastLoginAt: Date | null;
};

export type ActivityEvent = { userId: string; at: Date; type: ActivityType };

export type ActivityCounts = Record<ActivityType, number>;

export type ActivityBucket = {
  /** Første dag i bøtta (mandag for uker). */
  from: string;
  /** Siste dag i bøtta, inkludert. */
  to: string;
  /** Bøtta er ikke ferdig ennå (inneholder i dag og dager etter). */
  partial: boolean;
  active: number;
  startedTotal: number;
  counts: ActivityCounts;
};

export type ActivityPersonRow = {
  userId: string;
  name: string;
  email: string;
  department: string | null;
  status: ActivityStatus;
  lastActivityAt: string | null;
  lastLoginAt: string | null;
  /** Aktive dager per uke, de tolv siste ukene, eldste først. */
  activeDaysByWeek: number[];
  /** Hendelser i valgt periode. */
  counts: ActivityCounts;
};

export type ActivityReport = {
  generatedAt: string;
  period: ActivityPeriod;
  grain: ActivityGrain;
  department: string | null;
  range: { from: string; to: string };
  departments: string[];
  population: number;
  kpis: {
    active7: number;
    active7Prev: number;
    active30: number;
    started: number;
    startedBefore7: number;
    events7: ActivityCounts;
  };
  buckets: ActivityBucket[];
  people: ActivityPersonRow[];
};

/** Hvor lenge siden siste hendelse en person regnes som aktiv. */
export const ACTIVE_WINDOW_DAYS = 14;
const SPARK_WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = "Europe/Oslo";

const dayParts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Kalenderdatoen i Norge for et tidspunkt, som YYYY-MM-DD. */
export function osloDayKey(at: Date): string {
  const parts = dayParts.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function addDaysToKey(key: string, days: number): string {
  const t = keyToUtc(key);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Mandagen i uka datoen hører til. */
export function mondayOfKey(key: string): string {
  const weekday = (keyToUtc(key).getUTCDay() + 6) % 7;
  return addDaysToKey(key, -weekday);
}

function emptyCounts(): ActivityCounts {
  return { read: 0, submitted: 0, passed: 0, completed: 0 };
}

export function buildActivityReport(input: {
  now: Date;
  period: ActivityPeriod;
  grain: ActivityGrain;
  department: string | null;
  people: ActivityPerson[];
  events: ActivityEvent[];
}): ActivityReport {
  const { now, period, grain } = input;
  const department = input.department && input.department.trim() ? input.department.trim() : null;
  const todayKey = osloDayKey(now);
  const departments = Array.from(
    new Set(input.people.map((p) => p.department).filter((d): d is string => typeof d === "string" && d.trim() !== "")),
  ).sort((a, b) => a.localeCompare(b, "nb"));

  const people = department ? input.people.filter((p) => p.department === department) : input.people;
  const included = new Set(people.map((p) => p.userId));

  // Hendelser per person, eldste først, uten noe fra fremtiden.
  const byUser = new Map<string, Array<ActivityEvent & { key: string }>>();
  for (const event of input.events) {
    if (!included.has(event.userId) || event.at > now) continue;
    const list = byUser.get(event.userId) ?? [];
    list.push({ ...event, key: osloDayKey(event.at) });
    byUser.set(event.userId, list);
  }
  for (const list of byUser.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Perioden. «Hele perioden» begynner der den første hendelsen er.
  let fromKey: string;
  if (period === "all") {
    let earliest = todayKey;
    for (const list of byUser.values()) if (list[0] && list[0].key < earliest) earliest = list[0].key;
    fromKey = grain === "week" ? mondayOfKey(earliest) : earliest;
  } else {
    const weeks = Number(period);
    fromKey = addDaysToKey(mondayOfKey(todayKey), -7 * (weeks - 1));
  }

  // Bøttene, fra første til den som inneholder i dag.
  const step = grain === "week" ? 7 : 1;
  const buckets: ActivityBucket[] = [];
  const bucketIndex = new Map<string, number>();
  for (let key = grain === "week" ? mondayOfKey(fromKey) : fromKey; key <= todayKey; key = addDaysToKey(key, step)) {
    const to = addDaysToKey(key, step - 1);
    bucketIndex.set(key, buckets.length);
    buckets.push({ from: key, to, partial: to > todayKey, active: 0, startedTotal: 0, counts: emptyCounts() });
  }
  const activeSets = buckets.map(() => new Set<string>());
  for (const [userId, list] of byUser) {
    for (const event of list) {
      const index = bucketIndex.get(grain === "week" ? mondayOfKey(event.key) : event.key);
      if (index === undefined) continue;
      buckets[index]!.counts[event.type] += 1;
      activeSets[index]!.add(userId);
    }
  }
  const firstKeys = Array.from(byUser.values()).map((list) => list[0]!.key);
  buckets.forEach((bucket, i) => {
    bucket.active = activeSets[i]!.size;
    bucket.startedTotal = firstKeys.filter((k) => k <= bucket.to).length;
  });

  // Nøkkeltall: glidende vinduer på tidspunkt, ikke kalenderuker.
  const t7 = now.getTime() - 7 * DAY_MS;
  const t14 = now.getTime() - 14 * DAY_MS;
  const t30 = now.getTime() - 30 * DAY_MS;
  const tActive = now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS;
  const anyBetween = (list: ActivityEvent[] | undefined, from: number, to: number) =>
    (list ?? []).some((e) => e.at.getTime() > from && e.at.getTime() <= to);
  const events7 = emptyCounts();
  let active7 = 0;
  let active7Prev = 0;
  let active30 = 0;
  let startedBefore7 = 0;
  for (const list of byUser.values()) {
    if (anyBetween(list, t7, now.getTime())) active7 += 1;
    if (anyBetween(list, t14, t7)) active7Prev += 1;
    if (anyBetween(list, t30, now.getTime())) active30 += 1;
    if (list[0]!.at.getTime() <= t7) startedBefore7 += 1;
    for (const e of list) if (e.at.getTime() > t7) events7[e.type] += 1;
  }

  // Personene.
  const sparkStart = addDaysToKey(mondayOfKey(todayKey), -7 * (SPARK_WEEKS - 1));
  const rows: ActivityPersonRow[] = people.map((person) => {
    const list = byUser.get(person.userId) ?? [];
    const last = list[list.length - 1];
    const status: ActivityStatus = !last ? "not_started" : last.at.getTime() >= tActive ? "active" : "quiet";
    const weekDays = Array.from({ length: SPARK_WEEKS }, () => new Set<string>());
    const counts = emptyCounts();
    for (const e of list) {
      if (e.key >= sparkStart) {
        const week = Math.floor((keyToUtc(e.key).getTime() - keyToUtc(sparkStart).getTime()) / (7 * DAY_MS));
        if (week >= 0 && week < SPARK_WEEKS) weekDays[week]!.add(e.key);
      }
      if (e.key >= fromKey) counts[e.type] += 1;
    }
    return {
      userId: person.userId,
      name: person.name,
      email: person.email,
      department: person.department,
      status,
      lastActivityAt: last ? last.at.toISOString() : null,
      lastLoginAt: person.lastLoginAt ? person.lastLoginAt.toISOString() : null,
      activeDaysByWeek: weekDays.map((s) => s.size),
      counts,
    };
  });
  rows.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || a.name.localeCompare(b.name, "nb"));

  return {
    generatedAt: now.toISOString(),
    period,
    grain,
    department,
    range: { from: buckets[0]?.from ?? fromKey, to: todayKey },
    departments,
    population: people.length,
    kpis: { active7, active7Prev, active30, started: byUser.size, startedBefore7, events7 },
    buckets,
    people: rows,
  };
}

/** Deltakerne: aktive brukere med gyldig deltakerrolle, ikke anonymisert (samme regel som «Alle deltakere»). */
async function findReportParticipants(now: Date): Promise<ActivityPerson[]> {
  const users = await prisma.user.findMany({
    where: {
      activeStatus: true,
      isAnonymized: false,
      roleAssignments: {
        some: {
          appRole: AppRole.PARTICIPANT,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
      },
    },
    select: { id: true, name: true, email: true, department: true, lastLoginAt: true },
  });
  return users.map((u) => ({ userId: u.id, name: u.name, email: u.email, department: u.department, lastLoginAt: u.lastLoginAt }));
}

/**
 * Et vedtak kan komme i flere runder (ny vurdering, anke). Et bestått forsøk telles én gang, på
 * tidspunktet for det FØRSTE beståtte vedtaket — ellers ville en anke som opprettholder et bestått
 * gitt to «bestått» for samme innlevering.
 */
function firstPassPerSubmission(rows: Array<{ submissionId: string; finalisedAt: Date; userId: string }>) {
  const first = new Map<string, { userId: string; at: Date }>();
  for (const row of rows) {
    const seen = first.get(row.submissionId);
    if (!seen || row.finalisedAt < seen.at) first.set(row.submissionId, { userId: row.userId, at: row.finalisedAt });
  }
  return Array.from(first.values());
}

export async function getActivityReport(options: {
  period: ActivityPeriod;
  grain: ActivityGrain;
  department?: string | null;
  now?: Date;
}): Promise<ActivityReport> {
  const now = options.now ?? new Date();
  const people = await findReportParticipants(now);
  const ids = people.map((p) => p.userId);
  if (ids.length === 0) {
    return buildActivityReport({ now, period: options.period, grain: options.grain, department: options.department ?? null, people, events: [] });
  }

  // ⚠️ Hele historikken lastes: «har kommet i gang» og «sist aktiv» trenger første og siste hendelse
  // uansett periode. Radene er små (bruker + tidspunkt), og antallet følger antall deltakere ganger
  // seksjoner — titusener, ikke millioner. Blir det for mye, er neste steg å la databasen gruppere.
  const [reads, submissions, passes, completions] = await Promise.all([
    prisma.courseSectionRead.findMany({ where: { userId: { in: ids }, readAt: { lte: now } }, select: { userId: true, readAt: true } }),
    prisma.submission.findMany({ where: { userId: { in: ids }, submittedAt: { lte: now } }, select: { userId: true, submittedAt: true } }),
    prisma.assessmentDecision.findMany({
      where: { passFailTotal: true, finalisedAt: { lte: now }, submission: { userId: { in: ids } } },
      select: { submissionId: true, finalisedAt: true, submission: { select: { userId: true } } },
    }),
    prisma.courseCompletion.findMany({ where: { userId: { in: ids }, completedAt: { lte: now } }, select: { userId: true, completedAt: true } }),
  ]);

  const events: ActivityEvent[] = [
    ...reads.map((r) => ({ userId: r.userId, at: r.readAt, type: "read" as const })),
    ...submissions.map((s) => ({ userId: s.userId, at: s.submittedAt, type: "submitted" as const })),
    ...firstPassPerSubmission(passes.map((p) => ({ submissionId: p.submissionId, finalisedAt: p.finalisedAt, userId: p.submission.userId })))
      .map((p) => ({ userId: p.userId, at: p.at, type: "passed" as const })),
    ...completions.map((c) => ({ userId: c.userId, at: c.completedAt, type: "completed" as const })),
  ];

  return buildActivityReport({ now, period: options.period, grain: options.grain, department: options.department ?? null, people, events });
}

export type ActivityRecentEvent = {
  type: ActivityType;
  at: string;
  /** Kurset hendelsen hører til, når det er entydig (lesing og fullføring). */
  courseTitle: string | null;
  /** Seksjonen, modulen eller kurset. */
  itemTitle: string;
};

export type ActivityRecent = { userId: string; name: string; events: ActivityRecentEvent[] };

/** Det siste én person har gjort, på tvers av kurs. null når personen ikke finnes eller er anonymisert. */
export async function getActivityRecent(userId: string, locale: SupportedLocale, limit = 15): Promise<ActivityRecent | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isAnonymized: true } });
  if (!user || user.isAnonymized) return null;
  const title = (text: string | null | undefined) => (text ? localizeContentText(locale, text) ?? text : "");

  const [reads, submissions, passes, completions] = await Promise.all([
    prisma.courseSectionRead.findMany({
      where: { userId },
      orderBy: { readAt: "desc" },
      take: limit,
      select: { readAt: true, section: { select: { title: true } }, course: { select: { title: true } } },
    }),
    prisma.submission.findMany({
      where: { userId },
      orderBy: { submittedAt: "desc" },
      take: limit,
      select: { submittedAt: true, module: { select: { title: true } } },
    }),
    prisma.assessmentDecision.findMany({
      where: { passFailTotal: true, submission: { userId } },
      select: { submissionId: true, finalisedAt: true, submission: { select: { module: { select: { title: true } } } } },
    }),
    prisma.courseCompletion.findMany({
      where: { userId },
      orderBy: { completedAt: "desc" },
      take: limit,
      select: { completedAt: true, course: { select: { title: true } } },
    }),
  ]);

  // Samme regel som i rapporten: første beståtte vedtak per innlevering.
  const firstPass = new Map<string, { at: Date; title: string }>();
  for (const p of passes) {
    const seen = firstPass.get(p.submissionId);
    if (!seen || p.finalisedAt < seen.at) firstPass.set(p.submissionId, { at: p.finalisedAt, title: p.submission.module.title });
  }

  const events: Array<ActivityRecentEvent & { t: number }> = [
    ...reads.map((r) => ({ type: "read" as const, t: r.readAt.getTime(), at: r.readAt.toISOString(), courseTitle: title(r.course.title), itemTitle: title(r.section.title) })),
    ...submissions.map((s) => ({ type: "submitted" as const, t: s.submittedAt.getTime(), at: s.submittedAt.toISOString(), courseTitle: null, itemTitle: title(s.module.title) })),
    ...Array.from(firstPass.values()).map((p) => ({ type: "passed" as const, t: p.at.getTime(), at: p.at.toISOString(), courseTitle: null, itemTitle: title(p.title) })),
    ...completions.map((c) => ({ type: "completed" as const, t: c.completedAt.getTime(), at: c.completedAt.toISOString(), courseTitle: title(c.course.title), itemTitle: title(c.course.title) })),
  ];
  events.sort((a, b) => b.t - a.t);
  return {
    userId: user.id,
    name: user.name,
    events: events.slice(0, limit).map(({ t: _t, ...rest }) => rest),
  };
}
