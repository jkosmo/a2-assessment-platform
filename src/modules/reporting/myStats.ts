import { prisma } from "../../db/prisma.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { boatMood, type BoatMood } from "../gamification/boatMood.js";
import {
  activityEventsFrom,
  addDaysToKey,
  loadActivitySources,
  mondayOfKey,
  osloDayKey,
  passedAt,
  type ActivitySources,
} from "./activityReport.js";

// #1138: «Min statistikk» på profilen. Bare for brukeren selv: ruta (`GET /api/me/stats`) tar aldri
// imot en bruker-ID, og ingen rapport, rolle eller eksport leser herfra (produkteier 2026-11-01:
// arbeidsgiver ser bare resultat).
//
// ⚠️ Hendelsene er de samme som i «Aktivitet» (`loadActivitySources` + `activityEventsFrom` i
// activityReport.ts), ikke en kopi. Det som er nytt her er bare hvordan de telles per uke:
//   - seksjoner lest: ulike seksjoner per uke. Samme seksjon lest i to kurs samme uke teller én
//     gang (Aktivitet teller to lesinger). Kopien «Oppdater kurs» lager (#1095) er alt borte i
//     `distinctReads`;
//   - moduler bestått: ulike moduler per uke, etter `passedAt` (avgjort, og siste vedtak bestått);
//   - kurs fullført: hvert kursbevis, også et nytt for en ny hovedversjon;
//   - anslått lesetid: antall ord i seksjonsversjonen som gjaldt da brukeren leste, på brukerens
//     språk, delt på 200 ord per minutt. Én gang per seksjon per uke. Tid brukt måles ikke.

export const STATS_WEEKS = 12;
export const RECENT_WEEKS = 4;
export const WORDS_PER_MINUTE = 200;

export type MyStatsWeek = {
  /** Mandag, YYYY-MM-DD (Oslo). */
  from: string;
  /** Søndag, inkludert. */
  to: string;
  /** Uka er ikke ferdig ennå. */
  partial: boolean;
  sectionsRead: number;
  modulesPassed: number;
  coursesCompleted: number;
  readingMinutes: number;
};

export type MyStatsCounts = Omit<MyStatsWeek, "from" | "to" | "partial">;

export type MyPassedModule = { moduleId: string; moduleTitle: string; passedAt: string; totalScore: number | null };

export type MyStats = {
  generatedAt: string;
  mood: BoatMood;
  lastActivityAt: string | null;
  /** De tolv siste kalenderukene, eldste først. Uker uten aktivitet står med nuller. */
  weeks: MyStatsWeek[];
  /** Summen av de fire siste ukene (inkludert denne). */
  recent: MyStatsCounts & { weeks: number };
  totals: { coursesCompleted: number; modulesPassed: number; sectionsRead: number };
  /** Hver modul brukeren har bestått, med det siste beståtte forsøket. Nyeste først. */
  passedModules: MyPassedModule[];
};

/**
 * Ord i en seksjonstekst (markdown). Et anslag: bilder, adresser og koder for blokkene telles ikke,
 * lenketekst gjør det.
 */
export function countReadingWords(markdown: string | null | undefined): number {
  if (!markdown) return 0;
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/:::[\p{L}-]*/gu, " ")
    .replace(/https?:\/\/\S+/g, " ");
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / (24 * 60 * 60 * 1000));
}

export function buildMyStats(input: {
  now: Date;
  sources: ActivitySources;
  /** Ord i seksjonsversjonen som gjaldt for denne lesingen, på brukerens språk. */
  wordsForRead: (read: { sectionId: string; readAt: Date }) => number;
  moduleTitle: (moduleId: string) => string;
}): MyStats {
  const { now, sources } = input;
  const todayKey = osloDayKey(now);
  const startKey = addDaysToKey(mondayOfKey(todayKey), -7 * (STATS_WEEKS - 1));
  const weekOf = (at: Date): number | null => {
    const key = osloDayKey(at);
    if (key < startKey || key > todayKey) return null;
    const index = Math.floor(daysBetweenKeys(startKey, mondayOfKey(key)) / 7);
    return index >= 0 && index < STATS_WEEKS ? index : null;
  };

  const sectionSets = Array.from({ length: STATS_WEEKS }, () => new Set<string>());
  const moduleSets = Array.from({ length: STATS_WEEKS }, () => new Set<string>());
  const courses = Array.from({ length: STATS_WEEKS }, () => 0);
  const minutes = Array.from({ length: STATS_WEEKS }, () => 0);

  for (const read of sources.reads) {
    const week = weekOf(read.readAt);
    if (week === null || sectionSets[week]!.has(read.sectionId)) continue;
    sectionSets[week]!.add(read.sectionId);
    minutes[week]! += input.wordsForRead(read) / WORDS_PER_MINUTE;
  }

  const latestPass = new Map<string, { at: Date; totalScore: number | null }>();
  for (const submission of sources.submissions) {
    const at = passedAt(submission);
    if (!at || at > now) continue;
    const week = weekOf(at);
    if (week !== null) moduleSets[week]!.add(submission.moduleId);
    const known = latestPass.get(submission.moduleId);
    if (!known || at > known.at) latestPass.set(submission.moduleId, { at, totalScore: submission.decisions[0]?.totalScore ?? null });
  }

  for (const completion of sources.completions) {
    const week = weekOf(completion.completedAt);
    if (week !== null) courses[week]! += 1;
  }

  const weeks: MyStatsWeek[] = Array.from({ length: STATS_WEEKS }, (_, i) => {
    const from = addDaysToKey(startKey, 7 * i);
    const to = addDaysToKey(from, 6);
    return {
      from,
      to,
      partial: to > todayKey,
      sectionsRead: sectionSets[i]!.size,
      modulesPassed: moduleSets[i]!.size,
      coursesCompleted: courses[i]!,
      readingMinutes: Math.round(minutes[i]!),
    };
  });

  const recentFrom = STATS_WEEKS - RECENT_WEEKS;
  const recentSlice = (list: number[]) => list.slice(recentFrom).reduce((sum, value) => sum + value, 0);
  const recent = {
    weeks: RECENT_WEEKS,
    sectionsRead: recentSlice(sectionSets.map((s) => s.size)),
    modulesPassed: recentSlice(moduleSets.map((s) => s.size)),
    coursesCompleted: recentSlice(courses),
    readingMinutes: Math.round(recentSlice(minutes)),
  };

  let last: Date | null = null;
  for (const event of activityEventsFrom(sources, now)) {
    if (event.at <= now && (!last || event.at > last)) last = event.at;
  }

  const passedModules = Array.from(latestPass, ([moduleId, pass]) => ({
    moduleId,
    moduleTitle: input.moduleTitle(moduleId),
    passedAt: pass.at.toISOString(),
    totalScore: pass.totalScore,
  })).sort((a, b) => b.passedAt.localeCompare(a.passedAt));

  return {
    generatedAt: now.toISOString(),
    mood: boatMood(last, now),
    lastActivityAt: last ? last.toISOString() : null,
    weeks,
    recent,
    totals: {
      coursesCompleted: sources.completions.length,
      modulesPassed: latestPass.size,
      sectionsRead: new Set(sources.reads.map((r) => r.sectionId)).size,
    },
    passedModules,
  };
}

/** Statistikken for ÉN bruker: den innloggede. Kalleren sender `request.context.userId`, aldri noe fra forespørselen. */
export async function getMyStats(userId: string, locale: SupportedLocale, now = new Date()): Promise<MyStats> {
  const sources = await loadActivitySources([userId], now);

  // Ordene trengs bare for lesinger i de tolv ukene.
  const startKey = addDaysToKey(mondayOfKey(osloDayKey(now)), -7 * (STATS_WEEKS - 1));
  const sectionIds = Array.from(new Set(sources.reads.filter((r) => osloDayKey(r.readAt) >= startKey).map((r) => r.sectionId)));
  const passedModuleIds = Array.from(new Set(sources.submissions.filter((s) => passedAt(s)).map((s) => s.moduleId)));

  const [versions, modules] = await Promise.all([
    sectionIds.length === 0
      ? Promise.resolve([])
      : prisma.courseSectionVersion.findMany({
          where: { sectionId: { in: sectionIds }, publishedAt: { not: null } },
          orderBy: { publishedAt: "asc" },
          select: { id: true, sectionId: true, publishedAt: true, bodyMarkdown: true },
        }),
    passedModuleIds.length === 0
      ? Promise.resolve([])
      : prisma.module.findMany({ where: { id: { in: passedModuleIds } }, select: { id: true, title: true } }),
  ]);

  const versionsBySection = new Map<string, typeof versions>();
  for (const version of versions) {
    const list = versionsBySection.get(version.sectionId) ?? [];
    list.push(version);
    versionsBySection.set(version.sectionId, list);
  }
  const wordsByVersion = new Map<string, number>();
  const wordsForRead = ({ sectionId, readAt }: { sectionId: string; readAt: Date }) => {
    const list = versionsBySection.get(sectionId) ?? [];
    // Versjonen som gjaldt da brukeren leste: den siste publisert før lesingen. En lesing fra før
    // første publiserte versjon (importerte lesinger) får den første.
    let chosen = list[0];
    for (const version of list) if (version.publishedAt && version.publishedAt <= readAt) chosen = version;
    if (!chosen) return 0;
    let words = wordsByVersion.get(chosen.id);
    if (words === undefined) {
      words = countReadingWords(localizeContentText(locale, chosen.bodyMarkdown) ?? chosen.bodyMarkdown);
      wordsByVersion.set(chosen.id, words);
    }
    return words;
  };

  const titles = new Map(modules.map((m) => [m.id, localizeContentText(locale, m.title) ?? m.title]));
  return buildMyStats({ now, sources, wordsForRead, moduleTitle: (id) => titles.get(id) ?? id });
}
