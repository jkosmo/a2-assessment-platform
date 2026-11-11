import { describe, expect, it } from "vitest";
import {
  classifyWeeklyDigest,
  endOfPreviousWeek,
  osloMidnight,
  weeklyDigestWeekKey,
  type WeeklyDigestIndividualEnrollment,
} from "../../src/modules/weeklyDigest/weeklyDigestContent.js";
import { renderWeeklyDigestEmail, moodIllustration } from "../../src/modules/weeklyDigest/weeklyDigestEmail.js";
import { getWeeklyDigestMessage, WEEKLY_DIGEST_MAX_PER_GROUP, WEEKLY_EMAIL_TOGGLE_NAME } from "../../src/i18n/notificationMessages.js";
import { activeMascot } from "../../src/modules/mascot/mascotPack.js";
import { BOAT_MOODS } from "../../src/modules/gamification/boatMood.js";
import type { CourseListItem } from "../../src/modules/course/courseReadModels.js";

// #1139 skive 1 (doc/design/PLAN_1139.md, punkt 1, 2 og 12.2): hva den ukentlige e-posten sier, uten database.

/** Mandag 16. november 2026 kl. 07:05 i Oslo (UTC+1). */
const MONDAY = new Date("2026-11-16T06:05:00.000Z");

function course(id: string, status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED", done = 0, total = 5): CourseListItem {
  return {
    id,
    title: `Kurs ${id}`,
    description: null,
    sortOrder: null,
    slug: null,
    themes: [],
    moduleCount: 1,
    progress: { completed: done, total, courseStatus: status, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: done, sectionTotal: total - 1 },
  } as CourseListItem;
}

function classify(input: {
  progress: CourseListItem[];
  certified?: string[];
  individual?: WeeklyDigestIndividualEnrollment[];
  classDue?: Array<[string, Date | null]>;
  lastActivityAt?: Date | null;
  now?: Date;
}) {
  return classifyWeeklyDigest({
    now: input.now ?? MONDAY,
    progress: input.progress,
    certifiedCourseIds: new Set(input.certified ?? []),
    individual: input.individual ?? [],
    classCourseDue: new Map(input.classDue ?? []),
    lastActivityAt: input.lastActivityAt ?? null,
  });
}

const ids = (list: Array<{ courseId: string }> | undefined) => (list ?? []).map((c) => c.courseId);

describe("#1139: hva som er utestående", () => {
  it("hver gruppe for seg: forfalt (også eldre enn to uker), frist innen to uker, i gang, tildelt og ikke påbegynt", () => {
    const content = classify({
      progress: [course("old", "NOT_STARTED"), course("late", "IN_PROGRESS", 2), course("soon", "NOT_STARTED"), course("run", "IN_PROGRESS", 3), course("todo", "NOT_STARTED")],
      individual: [{ courseId: "old", source: "INDIVIDUAL", dueAt: new Date("2026-09-01T12:00:00Z") }],
      classDue: [
        ["late", new Date("2026-11-15T12:00:00Z")],
        ["soon", new Date("2026-11-30T12:00:00Z")],
        ["todo", null],
      ],
    });
    expect(ids(content?.overdue)).toEqual(["old", "late"]);
    expect(ids(content?.dueSoon)).toEqual(["soon"]);
    expect(ids(content?.inProgress)).toEqual(["run"]);
    expect(ids(content?.notStarted)).toEqual(["todo"]);
    expect(content?.overdue[1]).toMatchObject({ started: true, stepsLeft: 3 });
  });

  it("kursbevis for en hvilken som helst hovedversjon tar kurset ut, også forfalt og i gang (spørsmål 6)", () => {
    const content = classify({
      progress: [course("cert", "IN_PROGRESS", 1), course("other", "IN_PROGRESS", 1)],
      certified: ["cert"],
      classDue: [["cert", new Date("2026-10-01T12:00:00Z")]],
    });
    expect(ids(content?.overdue)).toEqual([]);
    expect(ids(content?.inProgress)).toEqual(["other"]);
  });

  it("ingenting igjen gir null: ikke påbegynt uten tildeling, selvpåmelding, alle steg gjort uten bevis", () => {
    expect(classify({ progress: [] })).toBeNull();
    expect(classify({
      progress: [course("open", "NOT_STARTED"), course("self", "NOT_STARTED"), course("done", "COMPLETED", 5)],
      individual: [{ courseId: "self", source: "SELF", dueAt: new Date("2026-11-20T12:00:00Z") }],
      classDue: [["done", new Date("2026-11-01T12:00:00Z")]],
    })).toBeNull();
  });

  it("individuell frist går foran klassens; uten individuell frist gjelder klassens", () => {
    const content = classify({
      progress: [course("a", "NOT_STARTED"), course("b", "NOT_STARTED")],
      individual: [
        { courseId: "a", source: "INDIVIDUAL", dueAt: new Date("2026-12-24T12:00:00Z") },
        { courseId: "b", source: "DEPARTMENT", dueAt: null },
      ],
      classDue: [
        ["a", new Date("2026-11-20T12:00:00Z")],
        ["b", new Date("2026-11-20T12:00:00Z")],
      ],
    });
    expect(ids(content?.notStarted)).toEqual(["a"]);
    expect(ids(content?.dueSoon)).toEqual(["b"]);
  });

  it("fristdager er Oslo-dager: frist kl. 00:30 Oslo i dag er ikke forfalt; dag 14 er «snart», dag 15 er ikke", () => {
    const content = classify({
      progress: [course("today", "NOT_STARTED"), course("d14", "NOT_STARTED"), course("d15", "NOT_STARTED")],
      classDue: [
        ["today", new Date("2026-11-15T23:30:00Z")],
        ["d14", new Date("2026-11-30T12:00:00Z")],
        ["d15", new Date("2026-12-01T12:00:00Z")],
      ],
    });
    expect(ids(content?.overdue)).toEqual([]);
    expect(ids(content?.dueSoon)).toEqual(["today", "d14"]);
    expect(ids(content?.notStarted)).toEqual(["d15"]);
  });
});

describe("#1139: uka og humøret (spørsmål 8)", () => {
  it("midnatt i Oslo, også rundt sommertid", () => {
    expect(osloMidnight("2026-11-16").toISOString()).toBe("2026-11-15T23:00:00.000Z");
    expect(osloMidnight("2026-03-30").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(osloMidnight("2026-03-23").toISOString()).toBe("2026-03-22T23:00:00.000Z");
  });

  it("uka er mandagen i Oslo; slutten av forrige uke er søndag 23:59:59.999 Oslo", () => {
    expect(weeklyDigestWeekKey(MONDAY)).toBe("2026-11-16");
    expect(weeklyDigestWeekKey(new Date("2026-11-15T22:59:00Z"))).toBe("2026-11-09");
    expect(endOfPreviousWeek(MONDAY).toISOString()).toBe("2026-11-15T22:59:59.999Z");
  });

  it("aktivitet søndag kveld er forrige uke: «mett». Uka før: «sulten». Ingen aktivitet: «ny»", () => {
    const progress = [course("run", "IN_PROGRESS", 1)];
    expect(classify({ progress, lastActivityAt: new Date("2026-11-15T22:30:00Z") })?.mood).toBe("mett");
    expect(classify({ progress, lastActivityAt: new Date("2026-11-08T12:00:00Z") })?.mood).toBe("sulten");
    expect(classify({ progress, lastActivityAt: new Date("2026-11-01T12:00:00Z") })?.mood).toBe("sur");
    expect(classify({ progress, lastActivityAt: null })?.mood).toBe("ny");
  });
});

describe("#1139: teksten", () => {
  const sample = (title: string, extra: Partial<{ dueAt: Date | null; stepsLeft: number; started: boolean }> = {}) => ({ title, dueAt: null, stepsLeft: 0, started: false, ...extra });

  it("bokmål: emnet, hilsen, båtens linje, gruppene i rekkefølge, avslutningen; siste linje er avmeldingen med bryterens navn", () => {
    const message = getWeeklyDigestMessage("nb", {
      moodLine: "Flau vind her ute.",
      overdue: [sample("Gammel", { dueAt: new Date("2026-11-01T12:00:00Z"), started: true, stepsLeft: 1 })],
      dueSoon: [],
      inProgress: [sample("Pågår", { started: true, stepsLeft: 4 })],
      notStarted: [sample("Ny", { dueAt: new Date("2026-12-31T12:00:00Z") })],
    });
    expect(message.subject).toBe("Læringsplattformen, status på dine kurs");
    expect(message.paragraphs).toEqual([
      "Hei!",
      "Flau vind her ute.",
      "Fristen har gått ut:\n• «Gammel» – frist 1. november 2026, 1 steg igjen",
      "I gang:\n• «Pågår» – 4 steg igjen",
      "Tildelt, ikke påbegynt:\n• «Ny» – frist 31. desember 2026",
      "Logg inn på A-2 læringsplattform og åpne Mine kurs.",
    ]);
    expect(message.reason).toContain("«Ukentlig e-post fra båten»");
    expect(message.reason).toMatch(/logg inn, åpne Profil og slå av/);
  });

  it("alle tre språk: avmeldingen nevner bryteren med navnet fra profilen", () => {
    for (const locale of ["nb", "nn", "en-GB"] as const) {
      const message = getWeeklyDigestMessage(locale, { moodLine: "x", overdue: [], dueSoon: [], inProgress: [sample("A", { started: true, stepsLeft: 2 })], notStarted: [] });
      expect(message.reason).toContain(`«${WEEKLY_EMAIL_TOGGLE_NAME[locale]}»`);
    }
  });

  it(`høyst ${WEEKLY_DIGEST_MAX_PER_GROUP} kurs per gruppe, så «… og N til»; tom e-post er en feil`, () => {
    const many = Array.from({ length: WEEKLY_DIGEST_MAX_PER_GROUP + 2 }, (_, i) => sample(`K${i}`));
    const message = getWeeklyDigestMessage("nb", { moodLine: "x", overdue: [], dueSoon: [], inProgress: [], notStarted: many });
    const lines = message.paragraphs[2]!.split("\n");
    expect(lines).toHaveLength(1 + WEEKLY_DIGEST_MAX_PER_GROUP + 1);
    expect(lines.at(-1)).toBe("… og 2 til");
    expect(() => getWeeklyDigestMessage("nb", { moodLine: "x", overdue: [], dueSoon: [], inProgress: [], notStarted: [] })).toThrow();
  });
});

describe("#1139: bryternavnet i e-posten er det samme som på profilen (planen 12.10)", () => {
  it("nb, nn og en-GB: avmeldingen nevner bryteren nøyaktig slik profilen viser den", async () => {
    // @ts-expect-error — klientfila er ren JavaScript uten typer.
    const { translations } = await import("../../public/i18n/profile-translations.js");
    for (const locale of ["nb", "nn", "en-GB"] as const) {
      expect(translations[locale]["profile.weeklyEmail.label"], locale).toBe(WEEKLY_EMAIL_TOGGLE_NAME[locale]);
    }
  });
});

describe("#1139: e-posten", () => {
  it("bildet og linja fra SAMME humør i maskotpakken, med bildetekst; avmeldingen sist i ren tekst", () => {
    const content = classify({ progress: [course("run", "IN_PROGRESS", 1)], lastActivityAt: new Date("2026-11-08T12:00:00Z") })!;
    const email = renderWeeklyDigestEmail(content, "nb");
    const mood = activeMascot().moods.sulten;
    expect(email.attachments[0]!.name).toBe(mood.image);
    expect(email.html).toContain(`alt="${mood.alt.nb}"`);
    expect(email.plainText).toContain(mood.line.nb);
    expect(email.plainText.trim().endsWith("slå av «Ukentlig e-post fra båten».")).toBe(true);
  });

  it("hvert humør har bilde og bildetekst på alle tre språk", () => {
    for (const mood of BOAT_MOODS) {
      const illustration = moodIllustration(mood);
      expect(illustration.file).toMatch(/\.jpg$/);
      for (const locale of ["nb", "nn", "en-GB"] as const) expect(illustration.alt[locale].length).toBeGreaterThan(10);
    }
  });

  it("en kurstittel med en adresse blir ikke en lenke", () => {
    const content = classify({ progress: [{ ...course("x", "IN_PROGRESS", 1), title: "Kurs om github.com" }] })!;
    const email = renderWeeklyDigestEmail(content, "nb");
    expect(email.plainText).toContain("github[.]com");
  });
});
