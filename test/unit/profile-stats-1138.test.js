import { describe, expect, it } from "vitest";
import { formatReadingTime, isoWeekNumber, moodView } from "../../public/static/profile-stats.js";
import { BOAT_MOODS } from "../../src/modules/gamification/boatMood.ts";
import { loadMascotPack, mascotMoodsJson, resolveMascotRequest } from "../../src/modules/mascot/mascotPack.ts";

// #1138: klientdelen av «Statistikk» på profilen — bildet per humør, ukenummeret og lesetida.
// Bildet og linja per humør kommer fra maskotpakken (doc/design/MASKOTPAKKE.md), som serveren gjør til
// /static/mascot/moods.json.

const t = (key) => ({
  "profile.stats.minutes": "{m} min",
  "profile.stats.hours": "{h} t",
  "profile.stats.approx": "ca. {v}",
})[key] ?? key;

const pack = loadMascotPack();
const mascot = JSON.parse(mascotMoodsJson(pack));

describe("båtbildene på profilen", () => {
  it("hvert humør serveren kan svare, har et bilde i pakken som serveres", () => {
    for (const mood of BOAT_MOODS) {
      const view = moodView(mood, mascot);
      expect(view, `humøret ${mood} mangler på profilen`).toBeDefined();
      expect(view.image).toMatch(new RegExp(`^/static/mascot/${pack.id}/images/`));
      expect(resolveMascotRequest(pack, view.image)?.kind, view.image).toBe("file");
    }
  });

  it("et humør klienten ikke kjenner (for eksempel anker fra #1139) faller til mett", () => {
    expect(moodView("anker", mascot)).toBe(mascot.moods.mett);
    expect(moodView(undefined, mascot)).toBe(mascot.moods.mett);
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
