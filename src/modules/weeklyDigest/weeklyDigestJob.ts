// #1139 skive 3 (doc/design/PLAN_1139.md, punkt 6-9 og 12): jobben og behandleren for den ukentlige e-posten.
//
// Alt som skriver `WeeklyDigest`, bor i denne fila (vakt: test/weekly-digest-write-guard.test.js).
//
//   1. JOBBEN (`runWeeklyDigestSchedule`, kjørt av `WeeklyDigestMonitor` hvert 5. minutt i workeren) gjør ingenting utenfor vinduet
//      mandag 07:00–12:00 Oslo (spørsmål 3), eller når WEEKLY_EMAIL_ENABLED er av. I vinduet: nåbare deltakere med bryteren på, uten
//      rad for uka, og på mottakerlista (tom = ingen, `*` = alle, 12.1). For hver: innholdet regnes (weeklyDigestContent.ts). Tomt →
//      raden `skipped` (`nothing_outstanding`) med en gang, uten hendelse (12.3). Ellers → raden `queued` og hendelsen i utboksen i
//      SAMME transaksjon, betinget: `ON CONFLICT ("userId","weekKey") DO NOTHING RETURNING id`, så to workere eller en omstart aldri
//      gir to e-poster samme uke (12.9). Rekkefølgen er en hash av personen og uka, så ikke de samme kommer sist hver uke. Høyst
//      100 vurdert per runde, og en tidsgrense; resten tas i neste runde, og sammendraget teller dem.
//      TEMPO (statusen øverst i planen): sendekvoten er 10 i timen for hele abonnementet. Utsendingen spres med høyst 5 i timen
//      (`availableAt` 12 minutter imellom, regnet fra mandag 07:00), så halve kvoten alltid er ledig for annen e-post.
//      Rydding: `sending` i over 30 min → `uncertain`. `queued` etter grensen for sen levering → `failed` (`lost_event`): hendelsen er
//      borte, og uka er over (12.6). Rader eldre enn 12 uker slettes (12.10).
//
//   2. BEHANDLEREN (`deliverWeeklyDigest`, utboks-typen `weekly_digest`): sjekker alt på nytt rett før sending. Av (nødstopp, 12.8),
//      for sent (etter tirsdag 17:00 Oslo i radens uke), sluttet, anonymisert, meldt av, ikke lenger på lista, eller ingenting
//      utestående → `skipped`, ingen e-post. Så betinget `queued → sending` (`UPDATE … RETURNING`), og sending. Utfallene som #1142:
//      sendt → `sent`; kanalen av → `skipped`; lenkesperren → `failed`; avbrutt underveis → `uncertain` (aldri sendt på nytt); sikker
//      feil → nytt forsøk, `failed` på siste.
//
//   3. STAGE-KOPIEN (`neutralizeWeeklyDigestAfterProdCopy`, kalt fra `neutralizeEmailStateAfterProdCopy`): ventende rader → `skipped`,
//      og `skipped`-rader for uka for alle nåbare uten rad, så stage aldri sender det prod har sendt eller skal sende (12.5).
//
// Ingen driftslogg med hvem som har meldt seg av, og ingen revisjonshendelse per sending (12.10).
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { recipientLocale } from "../../i18n/recipientLocale.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { getActiveRoles } from "../../repositories/userRepository.js";
import { enqueueOutboxEvents, OUTBOX_EVENT_TYPES } from "../outbox/outboxService.js";
import { deliverIllustratedEmail, type NotificationResult } from "../certification/participantNotificationService.js";
import { EmailContainsLinkError } from "../certification/illustratedEmail.js";
import { addDaysToKey } from "../reporting/activityReport.js";
import { getWeeklyDigestContent, osloMidnight, weeklyDigestWeekKey, type WeeklyDigestContent } from "./weeklyDigestContent.js";
import { renderWeeklyDigestEmail } from "./weeklyDigestEmail.js";

export const WEEKLY_DIGEST_STATUS = {
  queued: "queued",
  sending: "sending",
  sent: "sent",
  skipped: "skipped",
  uncertain: "uncertain",
  failed: "failed",
} as const;

/** Vinduet jobben lager rader i: mandag fra 07:00 til 12:00 Oslo (spørsmål 3). */
export const WEEKLY_DIGEST_WINDOW_START_HOUR = 7;
export const WEEKLY_DIGEST_WINDOW_END_HOUR = 12;
/** Grensen for sen levering: tirsdag 17:00 Oslo i radens uke (statusen øverst i planen). Etter den → `skipped` (`too_late`). */
export const WEEKLY_DIGEST_TOO_LATE_DAY_OFFSET = 1;
export const WEEKLY_DIGEST_TOO_LATE_HOUR = 17;
/** Tempoet: høyst 5 i timen, 12 minutter imellom (sendekvoten er 10 i timen for hele abonnementet). */
export const WEEKLY_DIGEST_SPACING_MS = 12 * 60_000;
/** Så mange vurderes per runde; resten tas i neste runde. */
export const WEEKLY_DIGEST_EVALUATED_PER_RUN = 100;
/** Tidsgrensen for én runde. */
export const WEEKLY_DIGEST_RUN_BUDGET_MS = 60_000;
/** En rad i `sending` så lenge ble avbrutt uten at noen kom tilbake til den. Den kan ha gått: `uncertain`. */
export const WEEKLY_DIGEST_STUCK_SENDING_MS = 30 * 60_000;
/** Rader eldre enn så mange uker slettes (12.10). */
export const WEEKLY_DIGEST_RETENTION_WEEKS = 12;

const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const utc = (date: Date) => Prisma.sql`${date.toISOString()}::timestamp`;

/** Klokkeslett i Oslo, med `hourCycle: "h23"` (planen 12.11): midnatt er 0, ikke 24. */
const osloClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", weekday: "short", hour: "2-digit", hourCycle: "h23" });

export function osloWeekdayAndHour(at: Date): { weekday: string; hour: number } {
  const parts = osloClock.formatToParts(at);
  return { weekday: parts.find((p) => p.type === "weekday")?.value ?? "", hour: Number(parts.find((p) => p.type === "hour")?.value ?? "0") };
}

/** Er vi i vinduet der jobben lager rader: mandag 07:00–11:59 Oslo. */
export function isInWeeklyDigestWindow(now: Date): boolean {
  const { weekday, hour } = osloWeekdayAndHour(now);
  return weekday === "Mon" && hour >= WEEKLY_DIGEST_WINDOW_START_HOUR && hour < WEEKLY_DIGEST_WINDOW_END_HOUR;
}

/** Når utsendingen for uka begynner: mandag 07:00 Oslo. */
export function weeklyDigestSendStart(weekKey: string): Date {
  return new Date(osloMidnight(weekKey).getTime() + WEEKLY_DIGEST_WINDOW_START_HOUR * 3_600_000);
}

/** Grensen for sen levering: tirsdag 17:00 Oslo i uka. */
export function weeklyDigestTooLateAt(weekKey: string): Date {
  const tuesday = addDaysToKey(weekKey, WEEKLY_DIGEST_TOO_LATE_DAY_OFFSET);
  return new Date(osloMidnight(tuesday).getTime() + WEEKLY_DIGEST_TOO_LATE_HOUR * 3_600_000);
}

/** Mottakerlista (12.1): `null` = alle (`*`); tom liste = ingen. Trimmet, små bokstaver. */
export function weeklyDigestRecipients(raw: string = env.WEEKLY_EMAIL_RECIPIENTS): string[] | null {
  const entries = raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (entries.includes("*")) return null;
  return entries;
}

export function isWeeklyDigestRecipient(email: string, recipients: string[] | null = weeklyDigestRecipients()): boolean {
  return recipients === null || recipients.includes(email.trim().toLowerCase());
}

export type WeeklyDigestScheduleSummary = {
  asOf: string;
  weekKey: string;
  inWindow: boolean;
  evaluated: number;
  queued: number;
  nothingOutstanding: number;
  /** Klare, men ikke nådd i denne runden (taket eller tidsgrensen). */
  notReached: number;
  uncertain: number;
  lostEvents: number;
  deleted: number;
};

/**
 * Én runde av jobben. `now` er jobbens klokke; `onlyUserIds` avgrenser til noen personer (testene, som deler database med andre;
 * planen 12.11). Ryddingen kjører også utenfor vinduet; nye rader lages bare i det.
 */
export async function runWeeklyDigestSchedule(input?: { now?: Date; onlyUserIds?: string[] }): Promise<WeeklyDigestScheduleSummary> {
  const now = input?.now ?? new Date();
  const weekKey = weeklyDigestWeekKey(now);
  const scope = input?.onlyUserIds ? { userId: { in: input.onlyUserIds } } : {};
  const summary: WeeklyDigestScheduleSummary = {
    asOf: now.toISOString(), weekKey, inWindow: isInWeeklyDigestWindow(now),
    evaluated: 0, queued: 0, nothingOutstanding: 0, notReached: 0, uncertain: 0, lostEvents: 0, deleted: 0,
  };

  // Rydding. `sending` med `sendingAt` fra databasens klokke; sammenlignes med ekte tid.
  summary.uncertain = (await prisma.weeklyDigest.updateMany({
    where: { ...scope, status: WEEKLY_DIGEST_STATUS.sending, sendingAt: { lt: new Date(Date.now() - WEEKLY_DIGEST_STUCK_SENDING_MS) } },
    data: { status: WEEKLY_DIGEST_STATUS.uncertain, reason: "interrupted" },
  })).count;
  // En rad som fortsatt står i kø etter grensen for sen levering (pluss to timer), har mistet hendelsen: behandleren ville ellers ha
  // satt den `too_late`. Alle tidligere uker er forbi grensen; denne uka først to timer etter tirsdag 17:00.
  const pastThisWeek = now.getTime() > weeklyDigestTooLateAt(weekKey).getTime() + 2 * 3_600_000;
  summary.lostEvents = (await prisma.weeklyDigest.updateMany({
    where: { ...scope, status: WEEKLY_DIGEST_STATUS.queued, weekKey: pastThisWeek ? { lte: weekKey } : { lt: weekKey } },
    data: { status: WEEKLY_DIGEST_STATUS.failed, reason: "lost_event" },
  })).count;
  summary.deleted = (await prisma.weeklyDigest.deleteMany({
    where: { ...scope, weekKey: { lt: addDaysToKey(weekKey, -7 * WEEKLY_DIGEST_RETENTION_WEEKS) } },
  })).count;

  if (!env.WEEKLY_EMAIL_ENABLED || !summary.inWindow) return summary;
  const recipients = weeklyDigestRecipients();
  if (recipients !== null && recipients.length === 0) return summary;

  const onlyUsers = input?.onlyUserIds ? Prisma.sql`AND u.id = ANY(${input.onlyUserIds}::text[])` : Prisma.empty;
  const onList = recipients === null ? Prisma.empty : Prisma.sql`AND lower(u.email) = ANY(${recipients}::text[])`;
  const candidates = await prisma.$queryRaw<Array<{ id: string; email: string; name: string; preferredLocale: string | null }>>`
    SELECT u.id, u.email, u.name, u."preferredLocale"
    FROM "User" u
    WHERE u."activeStatus" = true AND u."isAnonymized" = false AND u."weeklyEmailEnabled" = true
      AND NOT EXISTS (SELECT 1 FROM "WeeklyDigest" w WHERE w."userId" = u.id AND w."weekKey" = ${weekKey})
      ${onList}
      ${onlyUsers}
    ORDER BY md5(u.id || ${weekKey})
    LIMIT ${WEEKLY_DIGEST_EVALUATED_PER_RUN + 1}
  `;
  const started = Date.now();
  // Hvor mange som alt er satt opp denne uka: den neste får plassen etter dem (12 minutter imellom).
  let index = await prisma.weeklyDigest.count({ where: { weekKey, status: { not: WEEKLY_DIGEST_STATUS.skipped } } });
  const sendStart = weeklyDigestSendStart(weekKey);

  for (const user of candidates) {
    if (summary.evaluated >= WEEKLY_DIGEST_EVALUATED_PER_RUN || Date.now() - started > WEEKLY_DIGEST_RUN_BUDGET_MS) {
      summary.notReached += 1;
      continue;
    }
    summary.evaluated += 1;
    const locale = recipientLocale(user);
    const content = await getWeeklyDigestContent({ userId: user.id, roles: await getActiveRoles(user.id), locale, now });
    if (!content) {
      await prisma.$executeRaw`
        INSERT INTO "WeeklyDigest" ("id", "userId", "weekKey", "status", "reason", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${user.id}, ${weekKey}, ${WEEKLY_DIGEST_STATUS.skipped}, 'nothing_outstanding', ${NOW_UTC}, ${NOW_UTC})
        ON CONFLICT ("userId", "weekKey") DO NOTHING
      `;
      summary.nothingOutstanding += 1;
      continue;
    }
    const availableAt = new Date(Math.max(now.getTime(), sendStart.getTime() + index * WEEKLY_DIGEST_SPACING_MS));
    const created = await runInTransaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "WeeklyDigest" ("id", "userId", "weekKey", "status", "queuedAt", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${user.id}, ${weekKey}, ${WEEKLY_DIGEST_STATUS.queued}, ${utc(now)}, ${NOW_UTC}, ${NOW_UTC})
        ON CONFLICT ("userId", "weekKey") DO NOTHING
        RETURNING id
      `;
      if (rows.length === 0) return false;
      await enqueueOutboxEvents([{ type: OUTBOX_EVENT_TYPES.weeklyDigest, payload: { digestId: rows[0]!.id }, availableAt }], tx);
      return true;
    });
    if (created) {
      summary.queued += 1;
      index += 1;
    }
  }
  return summary;
}

export type WeeklyDigestSend = (input: {
  digestId: string;
  userId: string;
  recipientEmail: string;
  recipientName: string;
  locale: SupportedLocale;
  content: WeeklyDigestContent;
}) => Promise<NotificationResult>;

const sendWeeklyDigest: WeeklyDigestSend = (input) =>
  deliverIllustratedEmail({
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    email: renderWeeklyDigestEmail(input.content, input.locale),
    logPayload: { notificationType: "weekly_digest", digestId: input.digestId, weekKey: input.content.weekKey, recipient: { email: input.recipientEmail, locale: input.locale } },
  });

class WeeklyDigestNotDeliveredError extends Error {}

/** Betinget: endrer bare raden når den fortsatt står i `from`. */
function setDigestStatus(id: string, from: string, data: { status: string; reason?: string | null; sendingAt?: null; sentAt?: Date }) {
  return prisma.weeklyDigest.updateMany({ where: { id, status: from }, data });
}

/** Behandleren i utboksen for én rad. `send` og `now` kan byttes ut i testene; `lastAttempt`: utboksen gir opp etter dette forsøket. */
export async function deliverWeeklyDigest(
  digestId: string,
  options?: { lastAttempt?: boolean; send?: WeeklyDigestSend; now?: Date },
): Promise<void> {
  const send = options?.send ?? sendWeeklyDigest;
  const now = options?.now ?? new Date();
  const row = await prisma.weeklyDigest.findUnique({ where: { id: digestId }, select: { id: true, userId: true, weekKey: true, status: true } });
  if (!row) return;
  // Et tidligere forsøk tok raden og ble avbrutt. E-posten kan ha gått: synlig, ikke sendt på nytt (#1115).
  if (row.status === WEEKLY_DIGEST_STATUS.sending) {
    await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.sending, { status: WEEKLY_DIGEST_STATUS.uncertain, reason: "interrupted" });
    return;
  }
  if (row.status !== WEEKLY_DIGEST_STATUS.queued) return;
  const skip = (reason: string) => setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.queued, { status: WEEKLY_DIGEST_STATUS.skipped, reason });

  if (!env.WEEKLY_EMAIL_ENABLED) return void (await skip("disabled"));
  if (now.getTime() > weeklyDigestTooLateAt(row.weekKey).getTime()) return void (await skip("too_late"));

  let prepared: { user: { email: string; name: string; preferredLocale: string | null }; locale: SupportedLocale; content: WeeklyDigestContent } | null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { email: true, name: true, preferredLocale: true, activeStatus: true, isAnonymized: true, weeklyEmailEnabled: true },
    });
    if (!user || !user.activeStatus || user.isAnonymized) return void (await skip("not_reachable"));
    if (!user.weeklyEmailEnabled) return void (await skip("unsubscribed"));
    if (!isWeeklyDigestRecipient(user.email)) return void (await skip("not_listed"));
    const locale = recipientLocale(user);
    const content = await getWeeklyDigestContent({ userId: row.userId, roles: await getActiveRoles(row.userId), locale, now });
    if (!content) return void (await skip("nothing_outstanding"));
    prepared = { user, locale, content };
  } catch (error) {
    // Ingenting er sendt. Siste forsøk: `failed` (12.6); ellers står raden i `queued`, og utboksen prøver igjen.
    if (options?.lastAttempt) await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.queued, { status: WEEKLY_DIGEST_STATUS.failed, reason: "prepare_failed" });
    throw error;
  }

  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "WeeklyDigest" SET status = ${WEEKLY_DIGEST_STATUS.sending}, "sendingAt" = ${NOW_UTC}, "updatedAt" = ${NOW_UTC}
    WHERE id = ${row.id} AND status = ${WEEKLY_DIGEST_STATUS.queued}
    RETURNING id
  `;
  if (claimed.length === 0) return;

  let result: NotificationResult;
  try {
    result = await send({
      digestId: row.id,
      userId: row.userId,
      recipientEmail: prepared.user.email,
      recipientName: prepared.user.name,
      locale: prepared.locale,
      content: prepared.content,
    });
  } catch (error) {
    if (error instanceof EmailContainsLinkError) {
      await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.sending, { status: WEEKLY_DIGEST_STATUS.failed, reason: "contains_link" });
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.sending, {
      status: options?.lastAttempt ? WEEKLY_DIGEST_STATUS.failed : WEEKLY_DIGEST_STATUS.queued,
      sendingAt: null,
      reason: reason.slice(0, 500),
    });
    throw error;
  }

  if (result.delivered) {
    await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.sending, { status: WEEKLY_DIGEST_STATUS.sent, sentAt: new Date(), reason: null });
    return;
  }
  if (result.failureReason === "channel_disabled") {
    await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.sending, { status: WEEKLY_DIGEST_STATUS.skipped, reason: "channel_disabled" });
    return;
  }
  const reason = (result.failureReason ?? "unknown").slice(0, 500);
  if (result.ambiguous) {
    await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.sending, { status: WEEKLY_DIGEST_STATUS.uncertain, reason });
    return;
  }
  await setDigestStatus(row.id, WEEKLY_DIGEST_STATUS.sending, {
    status: options?.lastAttempt ? WEEKLY_DIGEST_STATUS.failed : WEEKLY_DIGEST_STATUS.queued,
    sendingAt: null,
    reason,
  });
  throw new WeeklyDigestNotDeliveredError(`weekly digest not delivered: ${reason}`);
}

const COPIED_FROM_PROD = "copied_from_prod";

/**
 * Prod → stage-kopi (12.5), i nøytraliseringens transaksjon: ventende rader → `skipped`, og `skipped`-rader for uka for alle nåbare
 * uten rad. Gir tilbake antallet i hvert steg.
 */
export async function neutralizeWeeklyDigestAfterProdCopy(tx: DbTransactionClient, now: Date): Promise<{ pendingSkipped: number; weekSkipped: number }> {
  const pendingSkipped = (await tx.weeklyDigest.updateMany({
    where: { status: { in: [WEEKLY_DIGEST_STATUS.queued, WEEKLY_DIGEST_STATUS.sending] } },
    data: { status: WEEKLY_DIGEST_STATUS.skipped, reason: COPIED_FROM_PROD },
  })).count;
  const weekKey = weeklyDigestWeekKey(now);
  const weekSkipped = await tx.$executeRaw`
    INSERT INTO "WeeklyDigest" ("id", "userId", "weekKey", "status", "reason", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, u.id, ${weekKey}, ${WEEKLY_DIGEST_STATUS.skipped}, ${COPIED_FROM_PROD}, ${NOW_UTC}, ${NOW_UTC}
    FROM "User" u
    WHERE u."activeStatus" = true AND u."isAnonymized" = false
    ON CONFLICT ("userId", "weekKey") DO NOTHING
  `;
  return { pendingSkipped, weekSkipped };
}
