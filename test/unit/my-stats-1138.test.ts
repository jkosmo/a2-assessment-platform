import { describe, expect, it } from "vitest";
import { boatMood, calendarWeeksAgo } from "../../src/modules/gamification/boatMood.js";
import { buildMyStats, countReadingWords, STATS_WEEKS } from "../../src/modules/reporting/myStats.js";
import type { ActivitySources } from "../../src/modules/reporting/activityReport.js";

// #1138: humørregelen og utregningen bak «Min statistikk». Ren kode, ingen database.

// Onsdag 11. november 2026 kl. 11:30 norsk tid (vintertid, UTC+1). Uka er man. 9. – søn. 15. november.
const NOW = new Date("2026-11-11T10:30:00Z");

describe("humørregelen (produkteier 2026-11-01)", () => {
  it("ingen aktivitet noen gang: ny", () => {
    expect(boatMood(null, NOW)).toBe("ny");
  });

  it("denne uka: mett — også mandag kl. 00:10 norsk tid", () => {
    expect(boatMood(new Date("2026-11-11T09:00:00Z"), NOW)).toBe("mett");
    // Mandag 9. november 00:10 Oslo = søndag 8. november 23:10 UTC.
    expect(boatMood(new Date("2026-11-08T23:10:00Z"), NOW)).toBe("mett");
  });

  it("forrige uke: sulten — søndag kl. 23:50 norsk tid er forrige uke", () => {
    // Søndag 8. november 23:50 Oslo = 22:50 UTC.
    expect(boatMood(new Date("2026-11-08T22:50:00Z"), NOW)).toBe("sulten");
    expect(boatMood(new Date("2026-11-02T08:00:00Z"), NOW)).toBe("sulten");
  });

  it("for to uker siden: sur", () => {
    expect(boatMood(new Date("2026-11-01T12:00:00Z"), NOW)).toBe("sur");
    expect(boatMood(new Date("2026-10-26T08:00:00Z"), NOW)).toBe("sur");
  });

  it("tre uker eller mer: dramatisk", () => {
    expect(boatMood(new Date("2026-10-25T12:00:00Z"), NOW)).toBe("dramatisk");
    expect(boatMood(new Date("2025-01-01T12:00:00Z"), NOW)).toBe("dramatisk");
  });

  it("over sommertidsskiftet (25. oktober 2026) teller uker, ikke 168 timer", () => {
    // Mandag 26. oktober 00:30 Oslo (vintertid) = søndag 25. oktober 23:30 UTC. Tre uker før uka til
    // mandag 16. november.
    const monday = new Date("2026-11-16T07:00:00Z");
    expect(calendarWeeksAgo(new Date("2026-10-25T23:30:00Z"), monday)).toBe(3);
    // Søndag 25. oktober 23:30 Oslo = 22:30 UTC: uka før.
    expect(calendarWeeksAgo(new Date("2026-10-25T22:30:00Z"), monday)).toBe(4);
  });
});

function sources(partial: Partial<ActivitySources>): ActivitySources {
  return { reads: [], submissions: [], completions: [], ...partial };
}

const read = (sectionId: string, iso: string, courseId = "c1") => ({ userId: "u", courseId, sectionId, readAt: new Date(iso) });
const decided = (moduleId: string, submittedIso: string, decisions: Array<[boolean, string, number]>, status: "COMPLETED" | "SUPERSEDED" | "UNDER_REVIEW" = "COMPLETED") => ({
  userId: "u",
  moduleId,
  submittedAt: new Date(submittedIso),
  submissionStatus: status,
  // Som i databasen: nyeste vedtak først.
  decisions: decisions.map(([passFailTotal, finalisedIso, totalScore]) => ({ passFailTotal, finalisedAt: new Date(finalisedIso), totalScore })),
});

function build(src: ActivitySources, words: Record<string, number> = {}, now = NOW) {
  return buildMyStats({
    now,
    sources: src,
    wordsForRead: (r) => words[r.sectionId] ?? 0,
    moduleTitle: (id) => `Tittel ${id}`,
  });
}

describe("ukene i statistikken", () => {
  it("tolv uker, mandag–søndag, eldste først, den siste er denne uka", () => {
    const stats = build(sources({}));
    expect(stats.weeks).toHaveLength(STATS_WEEKS);
    expect(stats.weeks[11]).toMatchObject({ from: "2026-11-09", to: "2026-11-15", partial: true });
    expect(stats.weeks[0]).toMatchObject({ from: "2026-08-24", to: "2026-08-30", partial: false });
    expect(stats.mood).toBe("ny");
    expect(stats.weeks.every((w) => w.sectionsRead === 0 && w.readingMinutes === 0)).toBe(true);
  });

  it("ukegrensen følger norsk tid: søndag 23:30 og mandag 00:30 havner i hver sin uke", () => {
    const stats = build(sources({
      reads: [
        read("s-sondag", "2026-11-08T22:30:00Z"), // søndag 23:30 Oslo
        read("s-mandag", "2026-11-08T23:30:00Z"), // mandag 00:30 Oslo
      ],
    }));
    expect(stats.weeks[10]!.sectionsRead).toBe(1);
    expect(stats.weeks[11]!.sectionsRead).toBe(1);
  });

  it("over sommertidsskiftet: lesinger mandag 26. oktober kl. 00:30 hører til uka som starter den dagen", () => {
    const stats = build(sources({
      reads: [
        read("a", "2026-10-25T22:30:00Z"), // søndag 25.10 23:30 Oslo (vintertid fra 03:00 samme natt)
        read("b", "2026-10-25T23:30:00Z"), // mandag 26.10 00:30 Oslo
      ],
    }));
    const week = (from: string) => stats.weeks.find((w) => w.from === from)!;
    expect(week("2026-10-19").sectionsRead).toBe(1);
    expect(week("2026-10-26").sectionsRead).toBe(1);
  });

  it("samme seksjon lest to ganger i samme uke (to kurs) teller én gang, også for lesetida", () => {
    const stats = build(sources({
      reads: [read("s1", "2026-11-09T08:00:00Z", "c1"), read("s1", "2026-11-10T08:00:00Z", "c2"), read("s2", "2026-11-10T09:00:00Z")],
    }), { s1: 400, s2: 200 });
    expect(stats.weeks[11]).toMatchObject({ sectionsRead: 2, readingMinutes: 3 });
    expect(stats.totals.sectionsRead).toBe(2);
  });

  it("samme seksjon lest i to ulike uker teller i begge ukene", () => {
    const stats = build(sources({
      reads: [read("s1", "2026-11-02T08:00:00Z", "c1"), read("s1", "2026-11-10T08:00:00Z", "c2")],
    }), { s1: 200 });
    expect(stats.weeks[10]).toMatchObject({ sectionsRead: 1, readingMinutes: 1 });
    expect(stats.weeks[11]).toMatchObject({ sectionsRead: 1, readingMinutes: 1 });
  });

  it("lesetid: ord delt på 200 per minutt, avrundet per uke", () => {
    const stats = build(sources({ reads: [read("s1", "2026-11-09T08:00:00Z"), read("s2", "2026-11-09T09:00:00Z")] }), { s1: 250, s2: 250 });
    expect(stats.weeks[11]!.readingMinutes).toBe(3); // 2,5 → 3
  });

  // QA: summen for de fire siste ukene er summen av ukene som VISES. Fire uker à 100 ord (0,5 min → «1 min»)
  // skal gi 4, ikke 2 (som en avrunding av den urundede summen ga).
  it("lesetida for de fire siste ukene er summen av de avrundede ukene", () => {
    const stats = build(sources({
      reads: [
        read("a", "2026-10-20T08:00:00Z"),
        read("b", "2026-10-27T08:00:00Z"),
        read("c", "2026-11-03T08:00:00Z"),
        read("d", "2026-11-10T08:00:00Z"),
      ],
    }), { a: 100, b: 100, c: 100, d: 100 });
    expect(stats.weeks.slice(8).map((w) => w.readingMinutes)).toEqual([1, 1, 1, 1]);
    expect(stats.recent.readingMinutes).toBe(4);
  });

  it("bestått: avgjort og siste vedtak bestått; et anket stryk og et forsøk hos sensor teller ikke", () => {
    const stats = build(sources({
      submissions: [
        decided("m-ok", "2026-11-09T08:00:00Z", [[true, "2026-11-09T09:00:00Z", 88]]),
        decided("m-anket", "2026-11-02T08:00:00Z", [[false, "2026-11-10T09:00:00Z", 40], [true, "2026-11-02T09:00:00Z", 70]]),
        decided("m-sensor", "2026-11-10T08:00:00Z", [[true, "2026-11-10T09:00:00Z", 90]], "UNDER_REVIEW"),
      ],
    }));
    expect(stats.weeks[11]!.modulesPassed).toBe(1);
    expect(stats.weeks[10]!.modulesPassed).toBe(0);
    expect(stats.totals.modulesPassed).toBe(1);
    expect(stats.passedModules).toEqual([{ moduleId: "m-ok", moduleTitle: "Tittel m-ok", passedAt: "2026-11-09T09:00:00.000Z", totalScore: 88 }]);
  });

  it("en modul bestått to ganger står én gang i lista, med det siste beståtte forsøket", () => {
    const stats = build(sources({
      submissions: [
        decided("m1", "2026-09-01T08:00:00Z", [[true, "2026-09-01T09:00:00Z", 70]]),
        decided("m1", "2026-11-09T08:00:00Z", [[true, "2026-11-09T09:00:00Z", 95]]),
      ],
    }));
    expect(stats.passedModules).toHaveLength(1);
    expect(stats.passedModules[0]).toMatchObject({ totalScore: 95, passedAt: "2026-11-09T09:00:00.000Z" });
    expect(stats.totals.modulesPassed).toBe(1);
  });

  it("de fire siste ukene og totalene; uker utenfor vinduet telles bare i totalene", () => {
    const stats = build(sources({
      reads: [read("s-gammel", "2026-05-01T08:00:00Z"), read("s-ny", "2026-10-20T08:00:00Z"), read("s-utenfor", "2026-10-13T08:00:00Z")],
      completions: [
        { userId: "u", courseId: "c1", completedAt: new Date("2026-11-10T08:00:00Z"), source: "platform" },
        { userId: "u", courseId: "c2", completedAt: new Date("2026-03-01T08:00:00Z"), source: "platform" },
      ],
    }), { "s-ny": 600, "s-utenfor": 600 });
    // Fire siste uker: fra mandag 19. oktober.
    expect(stats.recent).toEqual({ weeks: 4, sectionsRead: 1, modulesPassed: 0, coursesCompleted: 1, readingMinutes: 3 });
    expect(stats.totals).toEqual({ coursesCompleted: 2, modulesPassed: 0, sectionsRead: 3 });
    expect(stats.weeks[11]!.coursesCompleted).toBe(1);
  });

  it("#1145: et bevis registrert for et kurs tatt utenfor plattformen telles i totalen, men ikke i ukene eller humøret", () => {
    const stats = build(sources({
      reads: [read("s1", "2026-10-01T08:00:00Z")],
      completions: [{ userId: "u", courseId: "c-ute", completedAt: new Date("2026-11-10T08:00:00Z"), source: "external" }],
    }));
    expect(stats.totals.coursesCompleted).toBe(1);
    expect(stats.weeks.every((week) => week.coursesCompleted === 0)).toBe(true);
    expect(stats.recent.coursesCompleted).toBe(0);
    // Siste aktivitet er lesingen 1. oktober, ikke registreringen.
    expect(stats.lastActivityAt).toBe("2026-10-01T08:00:00.000Z");
  });

  it("humøret følger siste hendelse av alle typer, også en innlevering", () => {
    const stats = build(sources({
      reads: [read("s1", "2026-10-01T08:00:00Z")],
      submissions: [decided("m1", "2026-11-03T08:00:00Z", [[false, "2026-11-03T09:00:00Z", 10]])],
    }));
    expect(stats.mood).toBe("sulten");
    // Et stryk er ingen «bestått»-hendelse; innleveringen er den siste.
    expect(stats.lastActivityAt).toBe("2026-11-03T08:00:00.000Z");
  });
});

describe("ord i en seksjonstekst", () => {
  it("teller ord, ikke bilder, adresser eller blokkmerker; lenketekst teller", () => {
    expect(countReadingWords("Hei på deg, verden!")).toBe(4);
    expect(countReadingWords("![et bilde](asset:abc) Tekst [lenke her](https://x.no) og https://y.no slutt")).toBe(5);
    expect(countReadingWords(":::kort\n### Tittel\nTo ord\n:::")).toBe(3);
    expect(countReadingWords("- punkt **fet** — 42")).toBe(3);
    expect(countReadingWords("")).toBe(0);
    expect(countReadingWords(null)).toBe(0);
  });
});
