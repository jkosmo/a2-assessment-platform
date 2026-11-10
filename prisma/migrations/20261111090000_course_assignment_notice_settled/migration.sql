-- #1146: «settledAt», tidspunktet personen sist ble varslet om kurset (doc/design/PLAN_1146.md, punkt 9 B2). Kommer kurset
-- tilbake etter dette — alle åpne veier til kurset er nyere — settes raden tilbake til `waiting`, og personen får e-post.
--
-- Tre setninger, adskilt med «;» på egen linje (testen test/m2-course-assignment-readded-1146.test.ts kjører dem én og én).
-- Tidspunkter i UTC (`now() AT TIME ZONE 'UTC'`): kolonnene er `timestamp` uten sone, og mot en lokal database med
-- `Europe/Berlin` ville `now()` blitt en time feil (punkt 9 R3).

-- 1. Kolonnen.
ALTER TABLE "CourseAssignmentNotice" ADD COLUMN "settledAt" TIMESTAMP(3)
;
-- 2. Rader i sluttstatus: `sendingAt` for det som ble sendt (eller kan ha blitt det), ellers sist endret (`baseline`, og
-- `failed` som aldri kom til sending). Et kurs lagt inn igjen etter dette gir e-post ved første runde (produkteier
-- 2026-11-10, svar 3).
UPDATE "CourseAssignmentNotice"
SET "settledAt" = COALESCE("sendingAt", "updatedAt")
WHERE status IN ('baseline', 'sent', 'uncertain', 'failed')
;
-- 3. Den nye regelen tar med den som har kursbevis på en eldre hovedversjon (punkt 9 B1). Par med kursbevis og uten rad har
-- aldri fått e-post, og skal ikke få det for et kurs de har hatt lenge. `baseline` for dem, med vilje uten filter på person,
-- klasse eller kurs, som `20261109150000` (punkt 9 R2).
INSERT INTO "CourseAssignmentNotice" ("id", "userId", "courseId", "status", "reason", "createdAt", "updatedAt", "settledAt")
SELECT gen_random_uuid()::text, p."userId", p."courseId", 'baseline', 'before_1146',
       (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
FROM (
  SELECT DISTINCT cm."userId", cga."courseId"
  FROM "ClassMember" cm
  JOIN "Class" c ON c.id = cm."classId" AND c.kind = 'MANUAL' AND c."isSystem" = false
  JOIN "CourseGroupAssignment" cga ON cga."classId" = c.id
  WHERE EXISTS (SELECT 1 FROM "CourseCompletion" cc WHERE cc."userId" = cm."userId" AND cc."courseId" = cga."courseId")
) p
ON CONFLICT ("userId", "courseId") DO NOTHING
;
