// #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Fristen»): NÅR et arkivert element kan slettes.
//
// Regelen, i sin helhet:
//   - Starten er det SENESTE av `archivedAt` og overgangstidspunktet (`PlatformConfig`-raden fra migreringen).
//   - Starten gjøres om til en kalenderdato i Norge (Europe/Oslo), ikke UTC: arkivert 00:30 norsk tid 14. november er arkivert
//     14. november, også om klokka i UTC var 23:30 dagen før. Sommer- og vintertid følger av tidssonen.
//   - Datoen flyttes ARCHIVED_CONTENT_RETENTION_MONTHS kalendermåneder fram. Finnes ikke dagen i målmåneden, blir det siste dag i
//     måneden: 31. august + 6 måneder = 28. februar (29. i et skuddår). Aldri «3. mars».
//   - Svaret er en DATO (YYYY-MM-DD), ikke et tidspunkt. Elementet kan slettes fra og med denne datoen, norsk tid: jobben (4c) sletter
//     første natt med Oslo-dato ≥ svaret. Lista viser den samme datoen.
//
// Ren funksjon uten database, så enhetstestene kan feste regnestykket (test/unit/archived-retention-deadline-1152.test.ts).
import { ARCHIVED_CONTENT_RETENTION_MONTHS } from "../../config/retention.js";

const TIME_ZONE = "Europe/Oslo";
const osloDayParts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Kalenderdatoen i Norge for et tidspunkt. */
export function osloCalendarDate(at: Date): { year: number; month: number; day: number } {
  const parts = osloDayParts.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** En kalenderdato flyttet `months` måneder fram, med siste dag i måneden når dagen ikke finnes der. */
export function addCalendarMonths(date: { year: number; month: number; day: number }, months: number): string {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Datoen (YYYY-MM-DD, norsk kalender) et arkivert element kan slettes fra: seks kalendermåneder etter det seneste av
 * `archivedAt` og overgangstidspunktet.
 */
export function archivedContentDeletesOn(archivedAt: Date, floor: Date, months: number = ARCHIVED_CONTENT_RETENTION_MONTHS): string {
  const start = archivedAt.getTime() >= floor.getTime() ? archivedAt : floor;
  return addCalendarMonths(osloCalendarDate(start), months);
}

/** Den seneste av datoene (YYYY-MM-DD sammenlignes som tekst). */
export function latestDate(dates: readonly string[]): string {
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}

// Formen migreringen skriver: `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`. Strengt: et tidspunkt uten
// tidssone kunne vært lest som lokal tid, og et halvt år forskjøvet med en feil tolkning er nettopp det gulvet skal hindre.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** Overgangstidspunktet fra raden, eller `null` når raden mangler eller ikke kan leses. `null` betyr «ukjent», aldri «nå». */
export function parseRetentionFloor(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ISO_UTC.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  // Datoen skal leses tilbake uendret (QA-porten 4b): JavaScript flytter `2026-02-31` til 3. mars og `T24:00` til neste dag
  // uten å si fra. En slik rad er skadet, og skadet betyr «ukjent».
  return parsed.toISOString().slice(0, 19) === trimmed.slice(0, 19) ? parsed : null;
}
