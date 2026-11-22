import { mondayOfKey, osloDayKey } from "../reporting/activityReport.js";
import type { BoatMood } from "./moods.js";

// #1138: humørregelen for seilbåten (produkteier 2026-11-01, doc/design/GAMIFISERING_DESIGN.md).
//
//   aktivitet denne uka        → mett
//   sist aktiv forrige uke     → sulten
//   for to uker siden          → sur
//   tre uker eller mer         → dramatisk
//   aldri gjort noe            → ny (klar til å kaste loss)
//
// ⚠️ ÉN funksjon. Profilen bruker den nå; den ukentlige e-posten (#1139) og maskoten skal bruke den
// samme, så båten aldri har to humør samtidig.
//
// ⚠️ Ukene er kalenderuker, mandag–søndag i Europe/Oslo, som i «Aktivitet». «Denne uka» er ikke «de
// siste sju dagene»: en lesing søndag kveld er forrige uke på mandag morgen.
//
// Ikke bygget ennå (#1139): har brukeren meldt seg av den ukentlige e-posten, ligger båten for anker,
// uansett aktivitet. Det blir en overstyring FØR regelen under, i denne fila, ikke en ny regel et
// annet sted.

// Humørene står i moods.ts, så maskotpakken kan lese dem uten resten av appen.
export { BOAT_MOODS, type BoatMood } from "./moods.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Hele kalenderuker (Oslo) mellom uka `at` hører til og uka `now` hører til. */
export function calendarWeeksAgo(at: Date, now: Date): number {
  const thisMonday = Date.parse(`${mondayOfKey(osloDayKey(now))}T00:00:00Z`);
  const thenMonday = Date.parse(`${mondayOfKey(osloDayKey(at))}T00:00:00Z`);
  return Math.round((thisMonday - thenMonday) / WEEK_MS);
}

export function boatMood(lastActivityAt: Date | null, now: Date): BoatMood {
  if (!lastActivityAt) return "ny";
  const weeks = calendarWeeksAgo(lastActivityAt, now);
  if (weeks <= 0) return "mett";
  if (weeks === 1) return "sulten";
  if (weeks === 2) return "sur";
  return "dramatisk";
}
