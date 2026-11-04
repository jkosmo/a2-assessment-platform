// #934 skive 4b: e-post når et kurs får en ny hovedversjon (doc/DESIGN_934.md, «4b»).
//
// Radene (`CourseVersionNotice`, én per person og hovedversjon) lages i `applyCourseVersionChange`, i samme transaksjon
// som hovedversjonen — også når e-posten er av. Her bor de to stegene etter:
//
//   1. JOBBEN i workeren (`runCourseMajorEmailSchedule`, kjørt av `CourseMajorEmailMonitor`), bare når
//      COURSE_MAJOR_EMAIL_ENABLED=true. Den går gjennom radene som venter:
//        - kurset har fått en nyere hovedversjon → `skipped` (e-posten om den nyeste gjelder);
//        - personen er inaktiv eller anonymisert nå → `skipped`;
//        - kurset er avpublisert (eller arkivert) → raden venter, og sendes når kurset er publisert igjen;
//        - ellers → `queued`, og én hendelse i outboxen i SAMME transaksjon, med `availableAt` spredt utover
//          (høyst 20 per runde, tre sekunder imellom: om lag 20 i minuttet, så Azure ikke struper, #900).
//      Bare jobben legger hendelser av typen i outboxen. Er innstillingen av, finnes det ingen — en gammel worker
//      uten behandleren møter derfor aldri typen og kan ikke bruke opp forsøkene.
//
//   2. BEHANDLEREN i outboxen (`deliverCourseMajorVersionNotice`):
//        - `queued → sending` med en betinget oppdatering (to forsøk på samme rad: bare ett slipper gjennom), og så
//          det samme som jobben sjekker, EN GANG TIL — raden kan ha stått i køen mens noe endret seg (Codex runde 2
//          nr. 14): avpublisert → tilbake til `waiting`; nyere versjon eller personen borte → `skipped`;
//        - finner den raden i `sending`, ble et tidligere forsøk avbrutt, og e-posten kan ha gått. Raden blir
//          `uncertain` og sendes ikke på nytt (samme valg som #1115);
//        - sendt → `sent`. Sikker feil → tilbake til `queued`, og outboxen prøver igjen; siste forsøk → `failed`.
//          Avbrutt underveis (kan ha gått) → `uncertain`, ikke prøvd igjen.
import { prisma } from "../../db/prisma.js";
import { runInTransaction } from "../../db/transaction.js";
import { localizeContentText } from "../../i18n/content.js";
import { recipientLocale } from "../../i18n/recipientLocale.js";
import { isReachableParticipant } from "../user/participantReach.js";
import { enqueueOutboxEvents, OUTBOX_EVENT_TYPES } from "../outbox/outboxService.js";
import { sendCourseMajorVersionNotification, type NotificationResult } from "../certification/participantNotificationService.js";
import { EmailContainsLinkError } from "../certification/illustratedEmail.js";

export const COURSE_NOTICE_STATUS = {
  waiting: "waiting",
  queued: "queued",
  sending: "sending",
  sent: "sent",
  skipped: "skipped",
  uncertain: "uncertain",
  failed: "failed",
} as const;

/** Høyst så mange legges i outboxen per runde (jobben går hvert minutt). */
export const COURSE_MAJOR_EMAIL_PER_RUN = 20;
/** Mellomrommet mellom e-postene i en runde: 20 × 3 s = ett minutt. */
export const COURSE_MAJOR_EMAIL_SPACING_MS = 3_000;
/** Så mange ventende rader ses på per runde (hoppes over eller legges i køen). */
const SCAN_LIMIT = 500;
/**
 * En rad som har stått i `sending` så lenge, ble avbrutt uten at noen kom tilbake til den (outboxen ga opp etter sin
 * egen tidsgrense, #1115). Den blir `uncertain` — e-posten kan ha gått — så den ikke henger for alltid.
 */
export const COURSE_MAJOR_EMAIL_STUCK_SENDING_MS = 30 * 60_000;

type NoticeVerdict = { kind: "send" } | { kind: "wait" } | { kind: "skip"; reason: "newer_version" | "recipient_unreachable" | "course_gone" };

/**
 * ⚠️ DEN ENE REGELEN for om en rad skal sendes nå. Jobben og behandleren bruker begge denne, så det som ble sjekket
 * da raden ble lagt i køen, og det som sjekkes rett før sendingen, er det samme.
 */
function judgeNotice(
  notice: { versionMajor: number },
  course: { publishedAt: Date | null; archivedAt: Date | null; versionMajor: number } | null,
  user: { activeStatus: boolean; isAnonymized: boolean } | null,
): NoticeVerdict {
  if (!course) return { kind: "skip", reason: "course_gone" };
  if (course.versionMajor > notice.versionMajor) return { kind: "skip", reason: "newer_version" };
  if (!user || !isReachableParticipant(user)) return { kind: "skip", reason: "recipient_unreachable" };
  if (course.publishedAt === null || course.archivedAt !== null) return { kind: "wait" };
  return { kind: "send" };
}

export type CourseMajorEmailScheduleSummary = {
  asOf: string;
  queued: number;
  skipped: number;
  /** Rader som ble funnet i `sending` etter `COURSE_MAJOR_EMAIL_STUCK_SENDING_MS`, og ble `uncertain`. */
  uncertain: number;
  /** Rader som kunne sendes, men venter til neste runde (over grensen per runde). */
  deferred: number;
};

/**
 * Én runde av jobben. `onlyCourseIds` avgrenser den til noen kurs — for testene, som deler database med andre tester
 * (uten avgrensning ville en test legge andres rader i køen).
 */
export async function runCourseMajorEmailSchedule(input?: { now?: Date; onlyCourseIds?: string[] }): Promise<CourseMajorEmailScheduleSummary> {
  const now = input?.now ?? new Date();
  const scope = input?.onlyCourseIds ? { courseId: { in: input.onlyCourseIds } } : {};
  const summary: CourseMajorEmailScheduleSummary = { asOf: now.toISOString(), queued: 0, skipped: 0, uncertain: 0, deferred: 0 };

  const stuck = await prisma.courseVersionNotice.updateMany({
    where: { ...scope, status: COURSE_NOTICE_STATUS.sending, updatedAt: { lt: new Date(now.getTime() - COURSE_MAJOR_EMAIL_STUCK_SENDING_MS) } },
    data: { status: COURSE_NOTICE_STATUS.uncertain, reason: "interrupted" },
  });
  summary.uncertain = stuck.count;

  // Bare rader det er noe å gjøre med: kurset er publisert (send, eller hopp over en eldre versjon), eller personen
  // er borte (hopp over). Rader for et avpublisert kurs venter og ses ikke på — ellers kunne de fylt hele runden.
  const candidates = await prisma.courseVersionNotice.findMany({
    where: {
      ...scope,
      status: COURSE_NOTICE_STATUS.waiting,
      OR: [
        { course: { publishedAt: { not: null }, archivedAt: null } },
        { user: { OR: [{ activeStatus: false }, { isAnonymized: true }] } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: SCAN_LIMIT,
    select: {
      id: true,
      versionMajor: true,
      course: { select: { publishedAt: true, archivedAt: true, versionMajor: true } },
      user: { select: { activeStatus: true, isAnonymized: true } },
    },
  });

  for (const notice of candidates) {
    const verdict = judgeNotice(notice, notice.course, notice.user);
    if (verdict.kind === "wait") continue;
    if (verdict.kind === "skip") {
      const updated = await prisma.courseVersionNotice.updateMany({
        where: { id: notice.id, status: COURSE_NOTICE_STATUS.waiting },
        data: { status: COURSE_NOTICE_STATUS.skipped, reason: verdict.reason },
      });
      summary.skipped += updated.count;
      continue;
    }
    if (summary.queued >= COURSE_MAJOR_EMAIL_PER_RUN) {
      summary.deferred += 1;
      continue;
    }
    const availableAt = new Date(now.getTime() + summary.queued * COURSE_MAJOR_EMAIL_SPACING_MS);
    if (await queueNotice(notice.id, now, availableAt)) summary.queued += 1;
  }
  return summary;
}

/**
 * Legger én ventende rad i outboxen. Raden og hendelsen i samme transaksjon: enten står raden `queued` med en hendelse
 * i outboxen, eller ingen av delene. Den betingede oppdateringen gjør at to runder samtidig (to workere, eller en runde
 * som så raden før en annen la den inn) ikke legger samme rad inn to ganger: den andre får `false`.
 */
export async function queueNotice(noticeId: string, now: Date, availableAt: Date): Promise<boolean> {
  return runInTransaction(async (tx) => {
    const claimed = await tx.courseVersionNotice.updateMany({
      where: { id: noticeId, status: COURSE_NOTICE_STATUS.waiting },
      data: { status: COURSE_NOTICE_STATUS.queued, queuedAt: now, reason: null },
    });
    if (claimed.count === 0) return false;
    await enqueueOutboxEvents(
      [{ type: OUTBOX_EVENT_TYPES.courseMajorVersionNotification, payload: { noticeId }, availableAt }],
      tx,
    );
    return true;
  });
}

export type CourseMajorVersionSend = typeof sendCourseMajorVersionNotification;

/** En sikker feil: e-posten gikk ikke. Outboxen prøver igjen. */
class NoticeNotDeliveredError extends Error {}

/**
 * Behandleren i outboxen for én rad. Se toppen av fila for tilstandene. `send` kan byttes ut i testene; `lastAttempt`
 * sier at outboxen gir opp etter dette forsøket (raden blir da `failed` ved en sikker feil).
 */
export async function deliverCourseMajorVersionNotice(
  noticeId: string,
  options?: { lastAttempt?: boolean; send?: CourseMajorVersionSend },
): Promise<void> {
  const send = options?.send ?? sendCourseMajorVersionNotification;
  const notice = await prisma.courseVersionNotice.findUnique({
    where: { id: noticeId },
    select: { id: true, status: true, courseId: true, versionMajor: true, userId: true },
  });
  // Kurset eller personen er slettet (radene følger med): ingenting å sende.
  if (!notice) return;

  if (notice.status === COURSE_NOTICE_STATUS.sending) {
    // Et tidligere forsøk ble avbrutt (leiekontrakten gikk ut, eller workeren stoppet) etter at det tok raden. E-posten
    // kan ha gått; en ny ville kunne gi personen to. Samme valg som #1115: synlig, ikke sendt på nytt.
    await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, { status: COURSE_NOTICE_STATUS.uncertain, reason: "interrupted" });
    return;
  }
  // `sent`, `skipped`, `uncertain`, `failed`: ferdig. `waiting`: lagt tilbake; jobben lager en ny hendelse.
  if (notice.status !== COURSE_NOTICE_STATUS.queued) return;

  const claimed = await prisma.courseVersionNotice.updateMany({
    where: { id: notice.id, status: COURSE_NOTICE_STATUS.queued },
    data: { status: COURSE_NOTICE_STATUS.sending },
  });
  if (claimed.count === 0) return;

  // Det samme som jobben sjekket, en gang til: raden kan ha stått i køen mens kurset ble avpublisert, fikk en nyere
  // hovedversjon, eller personen sluttet.
  const [course, user] = await Promise.all([
    prisma.course.findUnique({ where: { id: notice.courseId }, select: { title: true, publishedAt: true, archivedAt: true, versionMajor: true } }),
    prisma.user.findUnique({
      where: { id: notice.userId },
      select: { email: true, name: true, preferredLocale: true, activeStatus: true, isAnonymized: true },
    }),
  ]);
  const verdict = judgeNotice(notice, course, user);
  if (verdict.kind === "wait") {
    await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, { status: COURSE_NOTICE_STATUS.waiting, queuedAt: null });
    return;
  }
  if (verdict.kind === "skip" || !course || !user) {
    await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, {
      status: COURSE_NOTICE_STATUS.skipped,
      reason: verdict.kind === "skip" ? verdict.reason : "course_gone",
    });
    return;
  }

  const version = await prisma.courseVersion.findUnique({
    where: { courseId_versionMajor: { courseId: notice.courseId, versionMajor: notice.versionMajor } },
    select: { changedItemCount: true },
  });
  const locale = recipientLocale(user);

  let result: NotificationResult;
  try {
    result = await send({
      noticeId: notice.id,
      courseId: notice.courseId,
      recipientEmail: user.email,
      recipientName: user.name,
      courseTitle: localizeContentText(locale, course.title) ?? course.title,
      versionMajor: notice.versionMajor,
      changedItemCount: version?.changedItemCount ?? null,
      locale,
    });
  } catch (error) {
    // Teksten ligner en lenke (typisk en kurstittel med en adresse i): den sendes aldri, uansett hvor mange forsøk.
    if (error instanceof EmailContainsLinkError) {
      await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, { status: COURSE_NOTICE_STATUS.failed, reason: "contains_link" });
      return;
    }
    // Sendefunksjonene fanger sine egne feil fra selve sendingen; det som kastes hit, kom før e-posten gikk (bildet
    // kunne ikke leses, o.l.). Sikker feil.
    const reason = error instanceof Error ? error.message : String(error);
    await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, {
      status: options?.lastAttempt ? COURSE_NOTICE_STATUS.failed : COURSE_NOTICE_STATUS.queued,
      reason: reason.slice(0, 500),
    });
    throw error;
  }

  if (result.delivered) {
    await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, { status: COURSE_NOTICE_STATUS.sent, sentAt: new Date(), reason: null });
    return;
  }
  if (result.failureReason === "channel_disabled") {
    // Varselkanalen er slått av: ingenting ble sendt. Raden venter til den er på igjen (jobben kjører ikke uten).
    await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, { status: COURSE_NOTICE_STATUS.waiting, queuedAt: null, reason: "channel_disabled" });
    return;
  }
  const reason = (result.failureReason ?? "unknown").slice(0, 500);
  if (result.ambiguous) {
    // Avbrutt mens den var på vei: den kan ha gått. Ikke prøv igjen.
    await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, { status: COURSE_NOTICE_STATUS.uncertain, reason });
    return;
  }
  await setStatus(notice.id, COURSE_NOTICE_STATUS.sending, {
    status: options?.lastAttempt ? COURSE_NOTICE_STATUS.failed : COURSE_NOTICE_STATUS.queued,
    reason,
  });
  throw new NoticeNotDeliveredError(`course major version notification not delivered: ${reason}`);
}

/** Betinget: endrer bare en rad som fortsatt står i `from`. */
function setStatus(
  id: string,
  from: string,
  data: { status: string; reason?: string | null; queuedAt?: Date | null; sentAt?: Date },
) {
  return prisma.courseVersionNotice.updateMany({ where: { id, status: from }, data });
}
