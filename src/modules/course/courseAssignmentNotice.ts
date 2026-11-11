// #1142: e-post når en deltaker får nye kurs fra en klasse (doc/design/PLAN_1142.md).
//
// Alt som skriver `CourseAssignmentNotice`, bor i denne fila (vakt: test/course-assignment-notice-write-guard.test.js):
//
//   1. REGELEN «hvem har kurset nå» (`eligibleAssignmentPairs`, skive 1). Brukes både når radene lages og rett før sending.
//
//   2. JOBBEN i workeren (`runCourseAssignmentEmailSchedule`, kjørt av `CourseAssignmentEmailMonitor` hvert minutt når
//      varselkanalen ikke er `disabled`). Fire steg per runde (planen, punkt 4):
//        - rydder: `sending` i over 30 min → `uncertain`; `queued` i over 2 timer → tilbake til `waiting` (hendelsen er borte);
//        - lager rader: `INSERT … SELECT` fra regelen for par uten rad, `waiting`, `ON CONFLICT DO NOTHING`. Radene lages av jobben, ikke av
//          handlingene: da gir alle veier inn e-post, også de ingen har tenkt på, og ingen handling trenger nye låser;
//        - finner personer som er klare: den NYESTE ventende raden er minst 15 min gammel, eller den ELDSTE minst 60 min
//          (sikkerhetsnettet). Høyst 20 samlinger per runde;
//        - samler per person i én transaksjon (`collectPersonDigest`): personlåsen først, så vinduet og regelen på nytt, slett
//          det som ikke gjelder lenger, og legg resten i én hendelse i outboxen med en ny `batchId`.
//
//   3. BEHANDLEREN i outboxen (`deliverCourseAssignmentDigest`), de åtte stegene i punkt 4: finner radene på `batchId`,
//      sjekker hvert kurs på nytt med regelen, sletter det som ikke gjelder, tar radene betinget `queued → sending` med
//      `UPDATE … RETURNING`, og sender én e-post med kursene som kom tilbake.
//
//   4. STAGE-KOPIEN (`neutralizeEmailStateAfterProdCopy`, `npm run stage-copy:neutralize-email`): det som venter i en kopi av
//      prod, sendes aldri fra stage (punkt 2).
//
// Sletting, ikke `skipped`: en rad som aldri ble sendt og ikke gjelder lenger, slettes. Blir personen lagt til igjen, lager
// jobben en ny rad og vinduet starter på nytt. Slettingen er ALLTID betinget på status (`waiting` i jobben, `queued` og
// `batchId` i behandleren); `baseline`, `sending`, `sent`, `uncertain` og `failed` slettes aldri.
//
// ⚠️ `@updatedAt` er Prisma, ikke en trigger i databasen. All rå SQL i fila setter `updatedAt` selv, og overgangene ryddingen
// måler på, setter sitt eget tidspunkt (`queuedAt`, `sendingAt`). Uten `sendingAt` målte ryddingen alderen fra `queued`, og en
// rad som hadde ventet over 30 min i køen, ble `uncertain` midt i sendingen (Codex runde 1 nr. 3).
//
// Låser: samlingen tar `pg_advisory_xact_lock(1142001, hashtext(userId))` som første setning, og ingen annen rådgivende lås.
// Ingen annen transaksjon tar denne. Jobben og behandleren tar ikke innholdslåsen (punkt 3). Revisjonsloggen tar sin egen
// lås, så samlingen skriver ikke dit; slettingene logges som driftshendelser.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { recipientLocale } from "../../i18n/recipientLocale.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { enqueueOutboxEvents, OUTBOX_EVENT_TYPES, SENDS_TO_A_PERSON } from "../outbox/outboxService.js";
import {
  sendCourseAssignmentDigest,
  type CourseAssignmentDigestCourseInput,
  type NotificationResult,
} from "../certification/participantNotificationService.js";
import { EmailContainsLinkError } from "../certification/illustratedEmail.js";
import { COURSE_MAJOR_EMAIL_PER_RUN, COURSE_MAJOR_EMAIL_SPACING_MS } from "./courseMajorVersionEmail.js";
import { neutralizeWeeklyDigestAfterProdCopy } from "../weeklyDigest/weeklyDigestJob.js";

/** Det regelen trenger av en klient: `prisma` eller en transaksjon. */
export type CourseAssignmentRuleClient = Pick<DbTransactionClient, "$queryRaw">;

/** Regelen for én person og noen kurs: rett før sending, og når jobben samler en persons rader (skive 3). */
export type CourseAssignmentRuleScope = { userId: string; courseIds: string[] };

/**
 * #1146: `arrivedAt` er når den eldste åpne veien til kurset åpnet (personen har hatt kurset sammenhengende siden da), og
 * `lastPathAt` når den nyeste åpnet.
 */
export type EligibleAssignmentPair = { userId: string; courseId: string; arrivedAt: Date; lastPathAt: Date };

export const ASSIGNMENT_NOTICE_STATUS = {
  /** Personen hadde kurset da #1142 kom (migreringen), eller raden kom fra en kopi av prod. Sendes aldri. */
  baseline: "baseline",
  waiting: "waiting",
  queued: "queued",
  sending: "sending",
  sent: "sent",
  uncertain: "uncertain",
  failed: "failed",
} as const;

/** Vinduet: den NYESTE ventende raden til en person må være så gammel før e-posten samles. */
export const COURSE_ASSIGNMENT_EMAIL_QUIET_MS = 15 * 60_000;
/** Sikkerhetsnettet: er den ELDSTE ventende raden så gammel, samles e-posten selv om nye kurs kommer hvert tiende minutt. */
export const COURSE_ASSIGNMENT_EMAIL_MAX_WAIT_MS = 60 * 60_000;
/** Høyst så mange samlinger per runde. Delt med 4b, så tempoet er det samme (men ikke et felles tak, punkt 4). */
export const COURSE_ASSIGNMENT_EMAIL_PER_RUN = COURSE_MAJOR_EMAIL_PER_RUN;
/** Mellomrommet mellom samlingene i en runde (`availableAt`). Delt med 4b. */
export const COURSE_ASSIGNMENT_EMAIL_SPACING_MS = COURSE_MAJOR_EMAIL_SPACING_MS;
/** En rad i `sending` så lenge ble avbrutt uten at noen kom tilbake til den. Den blir `uncertain`: e-posten kan ha gått. */
export const COURSE_ASSIGNMENT_EMAIL_STUCK_SENDING_MS = 30 * 60_000;
/**
 * En rad i `queued` så lenge har mistet hendelsen sin (outboxen ga opp før behandleren tok radene, eller en gammel worker
 * brukte den opp under en tilbakerulling). Den går tilbake til `waiting` og samles på nytt. Outboxens forsøk er ferdige
 * etter om lag 8 minutter, så 2 timer er god margin. Trygt fordi behandleren finner radene på `batchId`.
 */
export const COURSE_ASSIGNMENT_EMAIL_STUCK_QUEUED_MS = 2 * 60 * 60_000;
/** Nøkkelrommet for personlåsen (to heltall, som deltakerlåsen 9_340_402). */
export const COURSE_ASSIGNMENT_PERSON_LOCK_NAMESPACE = 1_142_001;
/** Så mange klare personer ses på per runde. Det over 20 samlinger venter til neste runde. */
const READY_SCAN_LIMIT = 500;

/**
 * Et tidspunkt i rå SQL, som `timestamp` i UTC, slik Prisma lagrer `DateTime`. ⚠️ Et `Date` rett inn i rå SQL blir
 * `timestamptz`, og mot kolonnene (`timestamp` uten sone) regnes det om med øktens tidssone: riktig i Azure (UTC), en time
 * feil mot en lokal database med `Europe/Berlin` (målt 2026-11-09). Det samme gjelder `now()`; bruk `NOW_UTC`.
 */
const utc = (date: Date) => Prisma.sql`${date.toISOString()}::timestamp`;
const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/**
 * ⚠️ DEN ENE REGELEN for «hvem har kurset nå» (planen, punkt 2). Brukes både når radene lages og rett før sending, så en rad
 * aldri kan lages og slettes om igjen hvert minutt. To regler som skilte seg litt, ville gitt nettopp det.
 *
 * Et par (person, kurs) er med når ALLE vilkårene holder:
 *   1. personen er medlem (`ClassMember`) av en klasse med `kind = 'MANUAL'` — Entra-klasser gir ikke e-post (saken);
 *   2. klassen er ikke systemklassen «Alle deltakere» (`isSystem`) — den ville gitt e-post til hele firmaet (saken);
 *   3. klassen er ikke arkivert (produkteier 2026-11-08, skive 0). Et kurs fra både en aktiv og en arkivert klasse er med
 *      gjennom den aktive;
 *   4. klassen har kurset (`CourseGroupAssignment`), og kurset er publisert;
 *   5. kurset er ikke arkivert (arkivering avpubliserer også, men regelen skal ikke hvile på det);
 *   6. personen er aktiv, og
 *   7. ikke anonymisert (#968, de samme feltene som `isReachableParticipant`);
 *   8. personen har ikke kursbevis på kursets hovedversjon eller nyere (#1146, produkteier 2026-11-10; før: for noen
 *      hovedversjon). Med kursbevis på en ELDRE hovedversjon er personen bare med når alle åpne veier til kurset (klasse,
 *      medlemskap, tildeling) åpnet etter at kurset fikk sin hovedversjon (`CourseVersion.publishedAt`). Ellers ville en ny
 *      hovedversjon gitt e-post om «nytt kurs» i tillegg til e-posten fra #934, uten at noen la kurset til (planreview B1);
 *   9. (gjelder bare den uten kursbevis) personen har ikke påbegynt kurset: ingen lest seksjon i kurset, ingen innlevering på en modul i kurset, og ingen tråd,
 *      intet svar og ingen følging i kursets diskusjoner. Det er «påbegynt» fra skive 0 (`findStartedOrCompletedCourseIds`
 *      i `classService.ts`), og testen sammenligner de to. «Du har fått et nytt kurs» om et kurs hen er i gang med, er feil
 *      av samme grunn som for et fullført kurs (QA-porten 2026-11-09: en klasse arkivert før vinduet og gjenopprettet etter,
 *      ville ellers gitt e-post om et kurs deltakeren aldri mistet).
 *
 * Vilkår 1–5 er grunnlaget «Mine kurs» bruker for kurs fra klasser (`getUserClassIds` → `getClassAssignedCourseDueDates`
 * → `filterVisibleCourseIds`), avgrenset til vanlige klasser som ikke er arkivert. Vilkår 6–9 gjør e-postregelen med
 * vilje strengere.
 *
 * `enrollmentPolicy` er med vilje IKKE et vilkår: et `OPEN`-kurs som tildeles en klasse, gir e-post. Tildelingen gir
 * kurset en frist og gjør det til en del av klassen; den gamle e-posten per kurs ble også sendt for slike kurs. Har
 * personen alt begynt på det på egen hånd, tar vilkår 9 det ut. Testen (test/m2-course-assignment-rule-1142.test.ts) sammenligner grunnlaget med «Mine kurs» og
 * tester filtrene for seg, ett vilkår om gangen.
 *
 * `onlyCourseIds` avgrenser til noen kurs uten å avgrense personen: jobbens runde i testene, som deler database med andre.
 *
 * `excludeExistingNotices` tar ut par som alt har en rad, uansett status. Det er ikke et vilkår for «hvem har kurset», bare
 * en innsnevring for den som LAGER rader (jobben og stage-kopien): etter `baseline` har nesten alle par en rad, og uten den
 * ville regelen regnes ut for alle hvert minutt, bare for at `ON CONFLICT` skulle kaste svaret (QA-porten 2026-11-09).
 * `ON CONFLICT DO NOTHING` står igjen for kappløp. Sjekken før sending og samlingen bruker det IKKE: der finnes raden alltid.
 */
type EligiblePairsOptions = {
  scope?: CourseAssignmentRuleScope;
  onlyCourseIds?: string[];
  excludeExistingNotices?: boolean;
  /** #1146: bare par fra denne spørringen (`userId`, `courseId`). Steg 2b avgrenser med den før regelen regnes ut (punkt 9 R4). */
  onlyPairs?: Prisma.Sql;
};

/** Når en vei til kurset åpnet: den siste av medlemskapet og tildelingen (#1146, punkt 3). */
const PATH_OPENED_AT = Prisma.sql`GREATEST(cm."addedAt", cga."createdAt")`;

function eligiblePairsQuery({ scope, onlyCourseIds, excludeExistingNotices, onlyPairs }: EligiblePairsOptions = {}): Prisma.Sql {
  const scoped = scope
    ? Prisma.sql`AND cm."userId" = ${scope.userId} AND cga."courseId" = ANY(${scope.courseIds}::text[])`
    : Prisma.empty;
  const onlyCourses = onlyCourseIds ? Prisma.sql`AND cga."courseId" = ANY(${onlyCourseIds}::text[])` : Prisma.empty;
  const withoutNotice = excludeExistingNotices
    ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "CourseAssignmentNotice" n WHERE n."userId" = cm."userId" AND n."courseId" = cga."courseId")`
    : Prisma.empty;
  const pairFilter = onlyPairs
    ? Prisma.sql`JOIN (${onlyPairs}) op ON op."userId" = cm."userId" AND op."courseId" = cga."courseId"`
    : Prisma.empty;
  // Vilkår 8 tar ut kursbevis på kursets hovedversjon eller nyere. Det som er igjen av `cc`, er et kursbevis på en ELDRE
  // hovedversjon (#1146).
  const hasOlderCertificate = Prisma.sql`EXISTS (SELECT 1 FROM "CourseCompletion" cc
                                                 WHERE cc."userId" = cm."userId" AND cc."courseId" = cga."courseId")`;
  return Prisma.sql`
    SELECT cm."userId" AS "userId", cga."courseId" AS "courseId", MIN(${PATH_OPENED_AT}) AS "arrivedAt",
           MAX(${PATH_OPENED_AT}) AS "lastPathAt"
    FROM "ClassMember" cm
    JOIN "Class" c                   ON c.id = cm."classId" AND c.kind = 'MANUAL' AND c."isSystem" = false
                                        AND c."archivedAt" IS NULL
    JOIN "CourseGroupAssignment" cga ON cga."classId" = c.id
    JOIN "Course" co                 ON co.id = cga."courseId" AND co."publishedAt" IS NOT NULL AND co."archivedAt" IS NULL
    JOIN "User" u                    ON u.id = cm."userId" AND u."activeStatus" = true AND u."isAnonymized" = false
    ${pairFilter}
    WHERE NOT EXISTS (SELECT 1 FROM "CourseCompletion" cc
                      WHERE cc."userId" = cm."userId" AND cc."courseId" = cga."courseId" AND cc."versionMajor" >= co."versionMajor")
      AND (${hasOlderCertificate} OR (
            NOT EXISTS (SELECT 1 FROM "CourseSectionRead" r
                        WHERE r."userId" = cm."userId" AND r."courseId" = cga."courseId")
        AND NOT EXISTS (SELECT 1 FROM "Submission" s
                        JOIN "CourseItem" ci ON ci."moduleId" = s."moduleId" AND ci."itemType" = 'MODULE'
                        WHERE s."userId" = cm."userId" AND ci."courseId" = cga."courseId")
        AND NOT EXISTS (SELECT 1 FROM "DiscussionThread" t
                        WHERE t."courseId" = cga."courseId"
                          AND (t."authorId" = cm."userId"
                               OR EXISTS (SELECT 1 FROM "DiscussionReply" dr WHERE dr."threadId" = t.id AND dr."authorId" = cm."userId")
                               OR EXISTS (SELECT 1 FROM "DiscussionSubscription" ds WHERE ds."threadId" = t.id AND ds."userId" = cm."userId")))))
    ${scoped}
    ${onlyCourses}
    ${withoutNotice}
    GROUP BY cm."userId", cga."courseId", co."versionMajor"
    HAVING NOT ${hasOlderCertificate}
        OR MIN(${PATH_OPENED_AT}) > (SELECT cv."publishedAt" FROM "CourseVersion" cv
                                     WHERE cv."courseId" = cga."courseId" AND cv."versionMajor" = co."versionMajor")
  `;
}

/**
 * Parene (person, kurs) som regelen sier ja til nå. Med `scope`: bare for den personen og de kursene. Uten: alle.
 * `excludeExistingNotices`: bare par uten rad — jobbens spørsmål («hvem har nå et kurs, og ingen rad»). Se `eligiblePairsQuery`.
 */
export async function eligibleAssignmentPairs(
  client: CourseAssignmentRuleClient,
  scope?: CourseAssignmentRuleScope,
  options?: { excludeExistingNotices?: boolean },
): Promise<EligibleAssignmentPair[]> {
  if (scope && scope.courseIds.length === 0) return [];
  return client.$queryRaw<EligibleAssignmentPair[]>(eligiblePairsQuery({ scope, excludeExistingNotices: options?.excludeExistingNotices }));
}

/**
 * Lager en rad for hvert par regelen sier ja til, og som ikke har en rad fra før. Brukt av jobben (`waiting`) og av
 * stage-kopien (`baseline`). Gir tilbake hvor mange som ble laget. Regelen tar ut par som alt har en rad
 * (`excludeExistingNotices`), så den ikke regnes ut for alle par hvert minutt; `ON CONFLICT` tar kappløpene.
 */
function insertRowsFromRule(
  client: Pick<DbTransactionClient, "$executeRaw">,
  input: { status: string; reason: string | null; at: Date; onlyCourseIds?: string[] },
): Promise<number> {
  // #1146: en `baseline`-rad regnes som varslet nå (databasens klokke, som `settledAt` ellers). En ventende rad er ikke avgjort.
  const settledAt = input.status === ASSIGNMENT_NOTICE_STATUS.baseline ? NOW_UTC : Prisma.sql`NULL`;
  return client.$executeRaw`
    INSERT INTO "CourseAssignmentNotice" ("id", "userId", "courseId", "status", "reason", "createdAt", "updatedAt", "settledAt")
    SELECT gen_random_uuid()::text, p."userId", p."courseId", ${input.status}::text, ${input.reason}::text, ${utc(input.at)}, ${utc(input.at)}, ${settledAt}
    FROM (${eligiblePairsQuery({ onlyCourseIds: input.onlyCourseIds, excludeExistingNotices: true })}) p
    ON CONFLICT ("userId", "courseId") DO NOTHING
  `;
}

/** Statusene der en rad er avgjort: personen er varslet, eller regnet som varslet. Steg 2b ser bare på disse. */
const SETTLED_STATUSES = [
  ASSIGNMENT_NOTICE_STATUS.baseline,
  ASSIGNMENT_NOTICE_STATUS.sent,
  ASSIGNMENT_NOTICE_STATUS.uncertain,
  ASSIGNMENT_NOTICE_STATUS.failed,
];

/**
 * #1146, steg 2b: personen har fått kurset på nytt. Alle åpne veier til kurset er nyere enn `settledAt` (kurset eller
 * medlemskapet er fjernet og lagt inn igjen etter forrige varsel): raden blir `waiting` igjen, og vinduet starter nå.
 *
 * - Bare rader i sluttstatus. `waiting`, `queued` og `sending` røres aldri, så jobben, samlingen og behandleren endrer aldri de
 *   samme radene. To workere samtidig: `status IN (…)` gjør at bare den første setter raden tilbake.
 * - En rad i sluttstatus uten `settledAt` er sendt av en eldre worker (overlappen under utrulling, eller etter en
 *   tilbakerulling til 2.150.0): den leses med `sendingAt`, ellers `updatedAt`, som migreringen fyller ut (QA-porten #1146
 *   nr. 2). Ellers ville feilen #1146 retter, levd videre for de parene.
 * - `settledAt` blir NULL, og settes igjen ved neste `sending` (databasens klokke), etter veien. Raden kan ikke gå i ring.
 * - Sammenligningen bruker bare ekte tider: veiene (Prisma) og `settledAt` (databasen). Jobbens `now`, som testene stiller,
 *   brukes bare til vinduet (punkt 9 R1).
 * - Avgrenset først til par der minst én vei er nyere enn `settledAt` (punkt 9 R4); bare for dem regnes regelen og `MIN` ut.
 * - Tellingen før utrulling bruker `readdedPairsQuery` (punkt 9 R6).
 */
export function readdedPairsQuery(onlyCourseIds?: string[], options?: SettledAtOptions): Prisma.Sql {
  const settled = options?.settledAt ?? settledAtOf;
  const candidates = Prisma.sql`
    SELECT DISTINCT n2."userId", n2."courseId"
    FROM "CourseAssignmentNotice" n2
    JOIN "ClassMember" cm2           ON cm2."userId" = n2."userId"
    JOIN "CourseGroupAssignment" cga2 ON cga2."classId" = cm2."classId" AND cga2."courseId" = n2."courseId"
    WHERE n2.status = ANY(${SETTLED_STATUSES}::text[]) AND ${settled("n2")} IS NOT NULL
      AND GREATEST(cm2."addedAt", cga2."createdAt") > ${settled("n2")}
  `;
  return Prisma.sql`
    SELECT n.id, n."userId", n."courseId", p."arrivedAt"
    FROM "CourseAssignmentNotice" n
    JOIN (${eligiblePairsQuery({ onlyCourseIds, onlyPairs: candidates })}) p ON p."userId" = n."userId" AND p."courseId" = n."courseId"
    WHERE n.status = ANY(${SETTLED_STATUSES}::text[]) AND ${settled("n")} IS NOT NULL AND p."arrivedAt" > ${settled("n")}
  `;
}

type SettledAtOptions = {
  /**
   * Hvordan `settledAt` leses for en rad med aliaset. Standard: `settledAtOf`. Tellingen i prod FØR migreringen (kolonnen
   * finnes ikke ennå) sender migreringens utfylling, `COALESCE("sendingAt", "updatedAt")`, så tallet produkteier godkjenner,
   * kommer fra den samme spørringen (planreview R6).
   */
  settledAt?: (alias: "n" | "n2") => Prisma.Sql;
};

/** `settledAt` for en rad i sluttstatus; uten (sendt av en eldre worker): som migreringen fyller den ut. */
const settledAtOf = (alias: "n" | "n2") => Prisma.raw(`COALESCE(${alias}."settledAt", ${alias}."sendingAt", ${alias}."updatedAt")`);

async function resetReaddedRows(now: Date, onlyCourseIds?: string[]): Promise<Array<{ userId: string; courseId: string }>> {
  // Først: en ny vei mens en gammel står (kurset lagt til klasse B mens personen har det fra A). Personen hadde kurset hele
  // tiden; den nye veien regnes som kjent (`settledAt` flyttes fram til den). Uten dette ga «fjern A» senere e-post om et kurs
  // som aldri forsvant (svar 2; integrasjonstesten fant det 2026-11-10). Kommer B til og forsvinner A mellom to runder, ser
  // jobben bare B og sender e-post (kjent, punkt 9).
  //
  // Bare veiene teller her (vilkår 1–3: vanlig klasse, ikke arkivert, medlemskap og tildeling), ikke resten av regelen. En
  // person med kursbevis på en eldre hovedversjon, som er inaktiv, eller et kurs som er avpublisert, har fortsatt kurset
  // gjennom A; uten dette ville «fjern A» senere gitt e-post (QA-porten #1146 nr. 1).
  const onlyCourses = onlyCourseIds ? Prisma.sql`AND n."courseId" = ANY(${onlyCourseIds}::text[])` : Prisma.empty;
  await prisma.$executeRaw`
    UPDATE "CourseAssignmentNotice" n
    SET "settledAt" = a."lastPathAt", "updatedAt" = ${NOW_UTC}
    FROM (
      SELECT n3.id, MAX(GREATEST(cm."addedAt", cga."createdAt")) AS "lastPathAt"
      FROM "CourseAssignmentNotice" n3
      JOIN "ClassMember" cm            ON cm."userId" = n3."userId"
      JOIN "Class" c                   ON c.id = cm."classId" AND c.kind = 'MANUAL' AND c."isSystem" = false AND c."archivedAt" IS NULL
      JOIN "CourseGroupAssignment" cga ON cga."classId" = c.id AND cga."courseId" = n3."courseId"
      WHERE n3.status = ANY(${SETTLED_STATUSES}::text[]) AND ${Prisma.raw(`COALESCE(n3."settledAt", n3."sendingAt", n3."updatedAt")`)} IS NOT NULL
      GROUP BY n3.id
      HAVING MIN(GREATEST(cm."addedAt", cga."createdAt")) <= MIN(${Prisma.raw(`COALESCE(n3."settledAt", n3."sendingAt", n3."updatedAt")`)})
         AND MAX(GREATEST(cm."addedAt", cga."createdAt")) >  MIN(${Prisma.raw(`COALESCE(n3."settledAt", n3."sendingAt", n3."updatedAt")`)})
    ) a
    WHERE n.id = a.id AND n.status = ANY(${SETTLED_STATUSES}::text[]) ${onlyCourses}
  `;
  return prisma.$queryRaw<Array<{ userId: string; courseId: string }>>`
    UPDATE "CourseAssignmentNotice" n
    SET status = ${ASSIGNMENT_NOTICE_STATUS.waiting}, reason = ${READDED_REASON}, "createdAt" = ${utc(now)}, "updatedAt" = ${utc(now)},
        "settledAt" = NULL, "batchId" = NULL, "queuedAt" = NULL, "sendingAt" = NULL, "sentAt" = NULL
    FROM (${readdedPairsQuery(onlyCourseIds)}) r
    WHERE n.id = r.id AND n.status = ANY(${SETTLED_STATUSES}::text[]) AND ${settledAtOf("n")} < r."arrivedAt"
    RETURNING n."userId", n."courseId"
  `;
}

const READDED_REASON = "re_added";

const courseFilter = (onlyCourseIds?: string[]) =>
  onlyCourseIds ? Prisma.sql`AND "courseId" = ANY(${onlyCourseIds}::text[])` : Prisma.empty;

/**
 * Vinduet, i SQL over én persons ventende rader (`HAVING`): den nyeste er minst 15 min gammel, eller den eldste minst
 * 60 min. Én definisjon, brukt både når jobben finner klare personer og når samlingen sjekker vinduet på nytt under låsen.
 */
function windowIsOpen(now: Date): Prisma.Sql {
  const quietBefore = new Date(now.getTime() - COURSE_ASSIGNMENT_EMAIL_QUIET_MS);
  const maxWaitBefore = new Date(now.getTime() - COURSE_ASSIGNMENT_EMAIL_MAX_WAIT_MS);
  return Prisma.sql`max("createdAt") <= ${utc(quietBefore)} OR min("createdAt") <= ${utc(maxWaitBefore)}`;
}

export type CourseAssignmentEmailScheduleSummary = {
  asOf: string;
  /** Nye rader (`waiting`) fra regelen. */
  created: number;
  /** #1146: rader i sluttstatus satt tilbake til `waiting` fordi personen har fått kurset på nytt. */
  reset: number;
  /** Rader som sto i `sending` i over 30 min og ble `uncertain`. */
  uncertain: number;
  /** Rader som sto i `queued` i over 2 timer og ble lagt tilbake til `waiting`. */
  requeued: number;
  /** Samlinger lagt i outboxen (én e-post hver). */
  queued: number;
  /** Ventende rader slettet fordi regelen ikke lenger sa ja (avpublisert, ikke tildelt, fjernet, sluttet, …). */
  removed: number;
  /** Personer som var klare, men venter til neste runde (over grensen per runde). */
  deferred: number;
};

/**
 * Én runde av jobben. `now` er jobbens klokke (radenes `createdAt` og `queuedAt`); `onlyCourseIds` avgrenser runden til
 * noen kurs — for testene, som deler database med andre tester.
 */
export async function runCourseAssignmentEmailSchedule(input?: { now?: Date; onlyCourseIds?: string[] }): Promise<CourseAssignmentEmailScheduleSummary> {
  const now = input?.now ?? new Date();
  const onlyCourseIds = input?.onlyCourseIds;
  const scope = onlyCourseIds ? { courseId: { in: onlyCourseIds } } : {};
  const summary: CourseAssignmentEmailScheduleSummary = { asOf: now.toISOString(), created: 0, reset: 0, uncertain: 0, requeued: 0, queued: 0, removed: 0, deferred: 0 };

  // 1. Rydding. Prisma setter `updatedAt` selv her.
  const stuckSending = await prisma.courseAssignmentNotice.updateMany({
    where: { ...scope, status: ASSIGNMENT_NOTICE_STATUS.sending, sendingAt: { lt: new Date(now.getTime() - COURSE_ASSIGNMENT_EMAIL_STUCK_SENDING_MS) } },
    data: { status: ASSIGNMENT_NOTICE_STATUS.uncertain, reason: "interrupted" },
  });
  summary.uncertain = stuckSending.count;
  const stuckQueued = await prisma.courseAssignmentNotice.updateMany({
    where: { ...scope, status: ASSIGNMENT_NOTICE_STATUS.queued, queuedAt: { lt: new Date(now.getTime() - COURSE_ASSIGNMENT_EMAIL_STUCK_QUEUED_MS) } },
    data: { status: ASSIGNMENT_NOTICE_STATUS.waiting, batchId: null, queuedAt: null, reason: "requeued" },
  });
  summary.requeued = stuckQueued.count;

  // 2. Nye rader fra regelen. `createdAt` er tidspunktet jobben så paret første gang.
  summary.created = await insertRowsFromRule(prisma, { status: ASSIGNMENT_NOTICE_STATUS.waiting, reason: null, at: now, onlyCourseIds });

  // 2b (#1146). Kurs personen har fått på nytt: raden blir `waiting` igjen.
  const reset = await resetReaddedRows(now, onlyCourseIds);
  summary.reset = reset.length;
  for (const [userId, courseIds] of groupCourseIdsByUser(reset)) {
    logOperationalEvent(operationalEvents.course.assignmentNoticeReset, { userId, courseIds, count: courseIds.length });
  }

  // 3. Personer som er klare, eldst først.
  const ready = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId"
    FROM "CourseAssignmentNotice"
    WHERE status = ${ASSIGNMENT_NOTICE_STATUS.waiting} ${courseFilter(onlyCourseIds)}
    GROUP BY "userId"
    HAVING ${windowIsOpen(now)}
    ORDER BY min("createdAt") ASC, "userId" ASC
    LIMIT ${READY_SCAN_LIMIT}
  `;

  // 4. Én samling per person.
  for (const { userId } of ready) {
    if (summary.queued >= COURSE_ASSIGNMENT_EMAIL_PER_RUN) {
      summary.deferred += 1;
      continue;
    }
    const availableAt = new Date(now.getTime() + summary.queued * COURSE_ASSIGNMENT_EMAIL_SPACING_MS);
    const collected = await collectPersonDigest(userId, { now, availableAt, onlyCourseIds });
    summary.removed += collected.removed;
    if (collected.batchId) summary.queued += 1;
  }
  return summary;
}

export type CollectedDigest = { batchId: string | null; courseIds: string[]; removed: number };

/**
 * Samler én persons ventende rader til én e-post, i ÉN transaksjon: personlåsen → radene og vinduet på nytt → regelen for
 * personen og kursene → slett det som ikke gjelder → resten blir `queued` med en ny `batchId`, og én hendelse i outboxen.
 * Enten står radene `queued` med en hendelse, eller ingen av delene. To jobber samtidig (to workere under utrulling): den
 * andre venter på låsen og finner så ingen ventende rader. Eksportert for testen av låsen.
 */
export async function collectPersonDigest(
  userId: string,
  input: { now: Date; availableAt: Date; onlyCourseIds?: string[] },
): Promise<CollectedDigest> {
  const result = await runInTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${COURSE_ASSIGNMENT_PERSON_LOCK_NAMESPACE}::int, hashtext(${userId}))`;

    const rows = await tx.$queryRaw<Array<{ id: string; courseId: string }>>`
      SELECT id, "courseId" FROM "CourseAssignmentNotice"
      WHERE "userId" = ${userId} AND status = ${ASSIGNMENT_NOTICE_STATUS.waiting} ${courseFilter(input.onlyCourseIds)}
    `;
    if (rows.length === 0) return { batchId: null, courseIds: [], removed: [] as string[] };
    const open = await tx.$queryRaw<unknown[]>`
      SELECT 1 FROM "CourseAssignmentNotice"
      WHERE "userId" = ${userId} AND status = ${ASSIGNMENT_NOTICE_STATUS.waiting} ${courseFilter(input.onlyCourseIds)}
      HAVING ${windowIsOpen(input.now)}
    `;
    if (open.length === 0) return { batchId: null, courseIds: [], removed: [] as string[] };

    const eligible = new Set((await eligibleAssignmentPairs(tx, { userId, courseIds: rows.map((r) => r.courseId) })).map((p) => p.courseId));
    const gone = rows.filter((r) => !eligible.has(r.courseId));
    if (gone.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "CourseAssignmentNotice"
        WHERE id = ANY(${gone.map((r) => r.id)}::text[]) AND status = ${ASSIGNMENT_NOTICE_STATUS.waiting}
      `;
    }
    const keep = rows.filter((r) => eligible.has(r.courseId));
    if (keep.length === 0) return { batchId: null, courseIds: [], removed: gone.map((r) => r.courseId) };

    const batchId = randomUUID();
    const claimed = await tx.$queryRaw<Array<{ courseId: string }>>`
      UPDATE "CourseAssignmentNotice"
      SET status = ${ASSIGNMENT_NOTICE_STATUS.queued}, "batchId" = ${batchId}, "queuedAt" = ${utc(input.now)}, "updatedAt" = ${utc(input.now)}, reason = NULL
      WHERE id = ANY(${keep.map((r) => r.id)}::text[]) AND status = ${ASSIGNMENT_NOTICE_STATUS.waiting}
      RETURNING "courseId"
    `;
    if (claimed.length === 0) return { batchId: null, courseIds: [], removed: gone.map((r) => r.courseId) };
    await enqueueOutboxEvents(
      [{ type: OUTBOX_EVENT_TYPES.courseAssignmentDigest, payload: { batchId, userId }, availableAt: input.availableAt }],
      tx,
    );
    return { batchId, courseIds: claimed.map((r) => r.courseId), removed: gone.map((r) => r.courseId) };
  });
  if (result.removed.length > 0) logRemoved("collect", userId, result.removed);
  return { batchId: result.batchId, courseIds: result.courseIds, removed: result.removed.length };
}

function groupCourseIdsByUser(rows: Array<{ userId: string; courseId: string }>): Map<string, string[]> {
  const byUser = new Map<string, string[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.courseId]);
  return byUser;
}

function logRemoved(stage: "collect" | "deliver", userId: string, courseIds: string[]) {
  logOperationalEvent(operationalEvents.course.assignmentNoticeRemoved, { stage, userId, courseIds, count: courseIds.length });
}

export type CourseAssignmentDigestSend = typeof sendCourseAssignmentDigest;

/** En sikker feil: e-posten gikk ikke. Outboxen prøver igjen. */
class DigestNotDeliveredError extends Error {}

/**
 * Behandleren i outboxen for én samling (planen, punkt 4, «Behandleren»). `send` kan byttes ut i testene; `lastAttempt`
 * sier at outboxen gir opp etter dette forsøket (radene blir da `failed` ved en sikker feil).
 */
export async function deliverCourseAssignmentDigest(
  batchId: string,
  options?: { lastAttempt?: boolean; send?: CourseAssignmentDigestSend },
): Promise<void> {
  const send = options?.send ?? sendCourseAssignmentDigest;

  // 1. Radene i samlingen. Ingen: ryddingen la dem tilbake (en ny samling har en annen id), eller personen er slettet.
  const rows = await prisma.courseAssignmentNotice.findMany({
    where: { batchId },
    select: { id: true, status: true, userId: true, courseId: true },
  });
  if (rows.length === 0) return;

  // 2. Et tidligere forsøk tok radene og ble avbrutt. E-posten kan ha gått; samme valg som #1115: synlig, ikke sendt på nytt.
  if (rows.some((r) => r.status === ASSIGNMENT_NOTICE_STATUS.sending)) {
    await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.sending, { status: ASSIGNMENT_NOTICE_STATUS.uncertain, reason: "interrupted" });
    return;
  }

  // 3. `sent`, `uncertain`, `failed`, eller lagt tilbake til `waiting`: ingenting å gjøre.
  const queued = rows.filter((r) => r.status === ASSIGNMENT_NOTICE_STATUS.queued);
  if (queued.length === 0) return;
  const userId = queued[0]!.userId;

  // 4–6. Sjekken med regelen, og oppslagene e-posten trenger. Ingenting er sendt ennå: en feil her lar radene stå i `queued`,
  // så outboxen prøver igjen. Gir outboxen opp nå, finnes det ingen hendelse igjen: tilbake til `waiting`, så jobben samler
  // dem på nytt (som 4b, QA-porten 2.132.1).
  let prepared: Awaited<ReturnType<typeof prepareDigest>>;
  try {
    prepared = await prepareDigest(batchId, userId, queued);
  } catch (error) {
    if (options?.lastAttempt) {
      await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.queued, { status: ASSIGNMENT_NOTICE_STATUS.waiting, batchId: null, queuedAt: null });
    }
    throw error;
  }
  if (!prepared) return;
  const { user, keepIds, coursesById } = prepared;

  // 7. Betinget overgang rett før sendingen. To forsøk på samme samling: bare ett får radene tilbake. E-posten lages av
  // radene som kom tilbake. ⚠️ Rå SQL: `sendingAt` og `updatedAt` settes her. #1146: `settledAt` også — fra nå regnes personen
  // som varslet; `sent`, `uncertain` og `failed` beholder tidspunktet. Går raden tilbake uten at e-posten gikk, blir den NULL.
  const claimed = await prisma.$queryRaw<Array<{ id: string; courseId: string }>>`
    UPDATE "CourseAssignmentNotice"
    SET status = ${ASSIGNMENT_NOTICE_STATUS.sending}, "sendingAt" = ${NOW_UTC}, "settledAt" = ${NOW_UTC}, "updatedAt" = ${NOW_UTC}
    WHERE "batchId" = ${batchId} AND status = ${ASSIGNMENT_NOTICE_STATUS.queued} AND id = ANY(${keepIds}::text[])
    RETURNING id, "courseId"
  `;
  if (claimed.length === 0) return;
  const courses = claimed.map((row) => coursesById.get(row.courseId)).filter((c): c is CourseAssignmentDigestCourseInput => Boolean(c));

  // 8. Send.
  let result: NotificationResult;
  try {
    result = await send({
      batchId,
      userId,
      recipientEmail: user.email,
      recipientName: user.name,
      locale: recipientLocale(user),
      courses,
    });
  } catch (error) {
    // Teksten ligner en lenke (en tittel eller et klassenavn med en adresse malen ikke gjorde ufarlig): sendes aldri.
    if (error instanceof EmailContainsLinkError) {
      await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.sending, { status: ASSIGNMENT_NOTICE_STATUS.failed, reason: "contains_link" });
      return;
    }
    // Sendefunksjonen fanger sine egne feil fra selve sendingen; det som kastes hit, kom før e-posten gikk. Sikker feil.
    const reason = error instanceof Error ? error.message : String(error);
    await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.sending, {
      status: options?.lastAttempt ? ASSIGNMENT_NOTICE_STATUS.failed : ASSIGNMENT_NOTICE_STATUS.queued,
      sendingAt: null,
      ...(options?.lastAttempt ? {} : { settledAt: null }),
      reason: reason.slice(0, 500),
    });
    throw error;
  }

  if (result.delivered) {
    await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.sending, { status: ASSIGNMENT_NOTICE_STATUS.sent, sentAt: new Date(), reason: null });
    return;
  }
  if (result.failureReason === "channel_disabled") {
    // Varselkanalen er av: ingenting ble sendt. Radene venter til den er på igjen (jobben kjører ikke uten).
    await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.sending, {
      status: ASSIGNMENT_NOTICE_STATUS.waiting,
      batchId: null,
      queuedAt: null,
      sendingAt: null,
      settledAt: null,
      reason: "channel_disabled",
    });
    return;
  }
  const reason = (result.failureReason ?? "unknown").slice(0, 500);
  if (result.ambiguous) {
    // Avbrutt mens den var på vei: den kan ha gått. Ikke prøv igjen.
    await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.sending, { status: ASSIGNMENT_NOTICE_STATUS.uncertain, reason });
    return;
  }
  await setBatchStatus(batchId, ASSIGNMENT_NOTICE_STATUS.sending, {
    status: options?.lastAttempt ? ASSIGNMENT_NOTICE_STATUS.failed : ASSIGNMENT_NOTICE_STATUS.queued,
    sendingAt: null,
    ...(options?.lastAttempt ? {} : { settledAt: null }),
    reason,
  });
  throw new DigestNotDeliveredError(`course assignment digest not delivered: ${reason}`);
}

/**
 * Steg 4–6 i behandleren: regelen for personen og kursene i `queued` (det som ikke er med, slettes), så personen, titlene,
 * klassene og fristen. Null: ingenting å sende.
 */
async function prepareDigest(batchId: string, userId: string, queued: Array<{ id: string; courseId: string }>) {
  const eligible = new Set((await eligibleAssignmentPairs(prisma, { userId, courseIds: queued.map((r) => r.courseId) })).map((p) => p.courseId));
  const gone = queued.filter((r) => !eligible.has(r.courseId));
  if (gone.length > 0) {
    await prisma.courseAssignmentNotice.deleteMany({
      where: { id: { in: gone.map((r) => r.id) }, batchId, status: ASSIGNMENT_NOTICE_STATUS.queued },
    });
    logRemoved("deliver", userId, gone.map((r) => r.courseId));
  }
  const keep = queued.filter((r) => eligible.has(r.courseId));
  if (keep.length === 0) return null;
  const courseIds = keep.map((r) => r.courseId);

  const [user, courses, assignments] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, preferredLocale: true } }),
    prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, title: true } }),
    // Klassene personen har kurset fra: de samme vanlige klassene regelen ser på.
    prisma.courseGroupAssignment.findMany({
      where: { courseId: { in: courseIds }, class: { kind: "MANUAL", isSystem: false, archivedAt: null, members: { some: { userId } } } },
      select: { courseId: true, dueAt: true, class: { select: { name: true } } },
    }),
  ]);
  // Personen er slettet (radene følger med): ingenting å sende.
  if (!user) return null;

  const coursesById = new Map<string, CourseAssignmentDigestCourseInput>();
  for (const course of courses) {
    const fromClasses = assignments.filter((a) => a.courseId === course.id);
    coursesById.set(course.id, {
      courseId: course.id,
      title: course.title,
      classNames: [...new Set(fromClasses.map((a) => a.class.name))],
      dueAt: earliestDueAt(fromClasses.map((a) => a.dueAt)),
    });
  }
  return { user, keepIds: keep.map((r) => r.id), coursesById };
}

/** Den tidligste fristen; en klasse uten frist teller ikke (samme regel som `getClassAssignedCourseDueDates`). */
function earliestDueAt(dueDates: Array<Date | null>): Date | null {
  let earliest: Date | null = null;
  for (const dueAt of dueDates) if (dueAt && (!earliest || dueAt < earliest)) earliest = dueAt;
  return earliest;
}

/** Betinget: endrer bare samlingens rader som fortsatt står i `from`. */
function setBatchStatus(
  batchId: string,
  from: string,
  data: { status: string; reason?: string | null; batchId?: null; queuedAt?: null; sendingAt?: null; settledAt?: null; sentAt?: Date },
) {
  return prisma.courseAssignmentNotice.updateMany({ where: { batchId, status: from }, data });
}

export type StageCopyNeutralizeSummary = {
  /** Steg 1: rader i `waiting`, `queued` og `sending` som ble `baseline`. */
  pendingToBaseline: number;
  /** #1146: rader i sluttstatus (også de fra steg 1) som fikk `settledAt` = nå, så stage ikke setter tilbake det prod gjør. */
  settledNow: number;
  /** Steg 2: par prod-jobben ennå ikke hadde sett, som fikk `baseline`. */
  unseenPairsToBaseline: number;
  /** Steg 3: `CourseVersionNotice` (4b) i `waiting`, `queued` og `sending` som ble `skipped`. */
  majorVersionNoticesSkipped: number;
  /** Steg 4: outbox-hendelser som sender e-post og ikke var levert, satt `failed`. */
  outboxEventsFailed: number;
  /** #1139: ukentlige e-poster i `queued` og `sending` som ble `skipped`. */
  weeklyDigestsPendingSkipped: number;
  /** #1139: `skipped`-rader laget for uka, for nåbare uten rad. */
  weeklyDigestsWeekSkipped: number;
};

const COPIED_FROM_PROD = "copied_from_prod";

/**
 * Prod → stage-kopi (planen, punkt 2; Codex runde 1 nr. 2 og runde 2). Kjøres FØR stage startes på kopien, i én
 * transaksjon, så stage aldri sender en e-post prod har sendt eller skal sende:
 *   1. ventende rader (`waiting`, `queued`, `sending`) → `baseline`: aldri sendt, sendes aldri. Slettes de, lager jobben dem
 *      på nytt;
 *   2. par prod-jobben ennå ikke hadde sett da kopien ble tatt → `baseline`, med samme `INSERT … SELECT` fra regelen som
 *      jobben bruker. Uten det ville stage og prod laget hver sin rad og sendt hver sin e-post;
 *   3. `CourseVersionNotice` i `waiting`, `queued` og `sending` → `skipped`. 4b lager radene også når e-posten er av, så de
 *      kan ligge uten hendelse og sendes fra stage når 4b slås på der;
 *   4. outbox-hendelser som ikke er levert, av typene som sender e-post til en person (`SENDS_TO_A_PERSON`) → `failed`.
 * Punkt 3 og 4 er et eldre hull i oppskriften fra 4b, lukket her.
 */
export async function neutralizeEmailStateAfterProdCopy(): Promise<StageCopyNeutralizeSummary> {
  return runInTransaction(
    async (tx) => {
      const now = new Date();
      const pendingToBaseline = await tx.$executeRaw`
        UPDATE "CourseAssignmentNotice"
        SET status = ${ASSIGNMENT_NOTICE_STATUS.baseline}, reason = ${COPIED_FROM_PROD}, "updatedAt" = ${utc(now)}, "settledAt" = ${NOW_UTC}
        WHERE status IN (${ASSIGNMENT_NOTICE_STATUS.waiting}, ${ASSIGNMENT_NOTICE_STATUS.queued}, ${ASSIGNMENT_NOTICE_STATUS.sending})
      `;
      // #1146 (planreview R5): et kurs lagt inn igjen like før kopien ble tatt, settes tilbake av prod-jobben. Uten dette ville
      // stage-jobben satt den tilbake også, og sendt sin egen e-post.
      const settledNow = await tx.$executeRaw`
        UPDATE "CourseAssignmentNotice" SET "settledAt" = ${NOW_UTC}
        WHERE status IN (${ASSIGNMENT_NOTICE_STATUS.sent}, ${ASSIGNMENT_NOTICE_STATUS.uncertain}, ${ASSIGNMENT_NOTICE_STATUS.failed}, ${ASSIGNMENT_NOTICE_STATUS.baseline})
      `;
      const unseenPairsToBaseline = await insertRowsFromRule(tx, { status: ASSIGNMENT_NOTICE_STATUS.baseline, reason: COPIED_FROM_PROD, at: now });
      const skipped = await tx.courseVersionNotice.updateMany({
        where: { status: { in: ["waiting", "queued", "sending"] } },
        data: { status: "skipped", reason: COPIED_FROM_PROD },
      });
      const failed = await tx.outboxEvent.updateMany({
        where: { status: "pending", type: { in: [...SENDS_TO_A_PERSON] } },
        data: { status: "failed", lastError: COPIED_FROM_PROD, lockedBy: null, lockedAt: null },
      });
      // #1139 (PLAN_1139 12.5): den ukentlige e-posten. Ventende rader → `skipped`, og `skipped` for uka for alle nåbare uten rad.
      const weekly = await neutralizeWeeklyDigestAfterProdCopy(tx, now);
      return {
        pendingToBaseline,
        settledNow,
        unseenPairsToBaseline,
        majorVersionNoticesSkipped: skipped.count,
        outboxEventsFailed: failed.count,
        weeklyDigestsPendingSkipped: weekly.pendingSkipped,
        weeklyDigestsWeekSkipped: weekly.weekSkipped,
      };
    },
    { timeout: 60_000 },
  );
}
