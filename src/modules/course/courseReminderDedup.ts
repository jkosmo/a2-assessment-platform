import type { CourseReminderKind } from "../../i18n/notificationMessages.js";

/**
 * #971: dedup av påminnelser som DATA, ikke som substring-søk i JSON-teksten.
 *
 * Før: `metadataJson.includes('"daysBefore":3')` — som også traff `"daysBefore":30`, og som sluttet å
 * treffe stille hvis et felt byttet plass eller serialiseringen endret seg. Da ville hele kullet fått
 * samme påminnelse på nytt hver syklus, uten at noe feilet.
 *
 * Nå: én nøkkel per (mottaker, type[, daysBefore, asOfDate]), bygget fra det PARSEDE
 * metadata-objektet med samme funksjon som avsenderen bruker for å spørre. Rekkefølge og
 * formatering i JSON-en er irrelevant; `3` og `30` er ulike verdier.
 *
 *   due_soon  → én per (userId, daysBefore, asOfDate)
 *   overdue   → én per (userId) — forfalt-purring sendes én gang
 */
export function reminderDedupKey(input: {
  userId: string;
  kind: CourseReminderKind;
  daysBefore?: number | null;
  asOfDate?: string | null;
}): string {
  if (input.kind === "overdue") return `${input.userId}|overdue`;
  return `${input.userId}|due_soon|${input.daysBefore ?? ""}|${input.asOfDate ?? ""}`;
}

/** Nøkkelen for en lagret revisjonsrad, eller null om raden ikke er en gyldig påminnelse. */
export function reminderDedupKeyFromMetadataJson(metadataJson: string): string | null {
  let meta: unknown;
  try {
    meta = JSON.parse(metadataJson);
  } catch {
    return null;
  }
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (typeof m.userId !== "string") return null;
  if (m.kind !== "overdue" && m.kind !== "due_soon") return null;
  return reminderDedupKey({
    userId: m.userId,
    kind: m.kind,
    daysBefore: typeof m.daysBefore === "number" ? m.daysBefore : null,
    asOfDate: typeof m.asOfDate === "string" ? m.asOfDate : null,
  });
}

/** Settet av alt som alt er sendt for et kurs — bygget ÉN gang per kurs, ikke én spørring per kandidat. */
export function buildSentReminderKeySet(rows: Array<{ metadataJson: string }>): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = reminderDedupKeyFromMetadataJson(row.metadataJson);
    if (key) keys.add(key);
  }
  return keys;
}
