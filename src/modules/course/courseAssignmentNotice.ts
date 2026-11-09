// #1142: e-post når en deltaker får nye kurs fra en klasse (doc/design/PLAN_1142.md).
//
// Skive 1 (denne): regelen «hvem har kurset nå». Ingenting her sender e-post, og ingenting kaller regelen ennå.
// Skive 3: jobben i workeren som lager radene i `CourseAssignmentNotice` fra regelen, og behandleren i outboxen som sjekker
// hvert kurs på nytt med SAMME regel rett før sending. Begge skal bo i denne fila: det er den eneste fila i `src/` som får
// skrive tabellen (vakt: test/course-assignment-notice-write-guard.test.js).
//
// Hvorfor radene lages av en jobb og ikke av handlingene: punkt 1 og 3 i planen. Kort: da gir alle veier inn e-post, også
// de ingen har tenkt på, og ingen handling trenger nye låser. Veiene inn er listet i test/course-assignment-ways-in-guard.test.js,
// som blir rød når en ny skriver av medlemskap, tildelinger, `Course.publishedAt`/`archivedAt` eller `Class.archivedAt` dukker opp.
import { Prisma } from "@prisma/client";
import type { DbTransactionClient } from "../../db/transaction.js";

/** Det regelen trenger av en klient: `prisma` eller en transaksjon. */
export type CourseAssignmentRuleClient = Pick<DbTransactionClient, "$queryRaw">;

/** Regelen for én person og noen kurs: rett før sending, og når jobben samler en persons rader (skive 3). */
export type CourseAssignmentRuleScope = { userId: string; courseIds: string[] };

export type EligibleAssignmentPair = { userId: string; courseId: string };

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
 *   8. personen har ikke kursbevis for kurset, for noen hovedversjon (produkteier 2026-11-08, spørsmål 1);
 *   9. personen har ikke påbegynt kurset: ingen lest seksjon i kurset, ingen innlevering på en modul i kurset, og ingen tråd,
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
 */
function eligiblePairsQuery(scope?: CourseAssignmentRuleScope): Prisma.Sql {
  const scoped = scope
    ? Prisma.sql`AND cm."userId" = ${scope.userId} AND cga."courseId" = ANY(${scope.courseIds}::text[])`
    : Prisma.empty;
  return Prisma.sql`
    SELECT DISTINCT cm."userId" AS "userId", cga."courseId" AS "courseId"
    FROM "ClassMember" cm
    JOIN "Class" c                   ON c.id = cm."classId" AND c.kind = 'MANUAL' AND c."isSystem" = false
                                        AND c."archivedAt" IS NULL
    JOIN "CourseGroupAssignment" cga ON cga."classId" = c.id
    JOIN "Course" co                 ON co.id = cga."courseId" AND co."publishedAt" IS NOT NULL AND co."archivedAt" IS NULL
    JOIN "User" u                    ON u.id = cm."userId" AND u."activeStatus" = true AND u."isAnonymized" = false
    WHERE NOT EXISTS (SELECT 1 FROM "CourseCompletion" cc
                      WHERE cc."userId" = cm."userId" AND cc."courseId" = cga."courseId")
      AND NOT EXISTS (SELECT 1 FROM "CourseSectionRead" r
                      WHERE r."userId" = cm."userId" AND r."courseId" = cga."courseId")
      AND NOT EXISTS (SELECT 1 FROM "Submission" s
                      JOIN "CourseItem" ci ON ci."moduleId" = s."moduleId" AND ci."itemType" = 'MODULE'
                      WHERE s."userId" = cm."userId" AND ci."courseId" = cga."courseId")
      AND NOT EXISTS (SELECT 1 FROM "DiscussionThread" t
                      WHERE t."courseId" = cga."courseId"
                        AND (t."authorId" = cm."userId"
                             OR EXISTS (SELECT 1 FROM "DiscussionReply" dr WHERE dr."threadId" = t.id AND dr."authorId" = cm."userId")
                             OR EXISTS (SELECT 1 FROM "DiscussionSubscription" ds WHERE ds."threadId" = t.id AND ds."userId" = cm."userId")))
    ${scoped}
  `;
}

/**
 * Parene (person, kurs) som regelen sier ja til nå. Med `scope`: bare for den personen og de kursene. Uten: alle — det er
 * jobbens spørsmål i skive 3 («hvem har nå et kurs, og ingen rad»).
 */
export async function eligibleAssignmentPairs(client: CourseAssignmentRuleClient, scope?: CourseAssignmentRuleScope): Promise<EligibleAssignmentPair[]> {
  if (scope && scope.courseIds.length === 0) return [];
  return client.$queryRaw<EligibleAssignmentPair[]>(eligiblePairsQuery(scope));
}
