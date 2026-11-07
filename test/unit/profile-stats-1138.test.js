import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOOD_VIEW, formatReadingTime, isoWeekNumber, moodView } from "../../public/static/profile-stats.js";
import { BOAT_MOODS } from "../../src/modules/gamification/boatMood.ts";

// #1138: klientdelen av «Statistikk» på profilen — bildet per humør, ukenummeret og lesetida.

const t = (key) => ({
  "profile.stats.minutes": "{m} min",
  "profile.stats.hours": "{h} t",
  "profile.stats.approx": "ca. {v}",
})[key] ?? key;

describe("båtbildene på profilen", () => {
  it("hvert humør serveren kan svare, har et bilde som finnes blant e-postbildene", () => {
    for (const mood of BOAT_MOODS) {
      const view = MOOD_VIEW[mood];
      expect(view, `humøret ${mood} mangler på profilen`).toBeDefined();
      expect(existsSync(join(process.cwd(), "src", "assets", "email", view.image)), view.image).toBe(true);
    }
  });

  it("et humør klienten ikke kjenner (for eksempel anker fra #1139) faller til mett", () => {
    expect(moodView("anker")).toBe(MOOD_VIEW.mett);
    expect(moodView(undefined)).toBe(MOOD_VIEW.mett);
  });
});

describe("ukenummer (ISO 8601)", () => {
  it("mandager gjennom året, også over årsskiftet", () => {
    expect(isoWeekNumber("2026-11-09")).toBe(46);
    expect(isoWeekNumber("2026-08-24")).toBe(35);
    expect(isoWeekNumber("2025-12-29")).toBe(1); // torsdag 1. januar 2026 hører til uka
    expect(isoWeekNumber("2026-12-28")).toBe(53);
    expect(isoWeekNumber("2027-01-04")).toBe(1);
  });
});

describe("anslått lesetid", () => {
  it("timer og minutter, «ca.» foran, og 0 min uten «ca.»", () => {
    expect(formatReadingTime(0, t)).toBe("0 min");
    expect(formatReadingTime(12, t)).toBe("ca. 12 min");
    expect(formatReadingTime(60, t)).toBe("ca. 1 t");
    expect(formatReadingTime(168, t)).toBe("ca. 2 t 48 min");
    expect(formatReadingTime(null, t)).toBe("0 min");
  });
});
