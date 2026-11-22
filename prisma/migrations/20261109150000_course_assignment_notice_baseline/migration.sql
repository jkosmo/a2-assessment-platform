-- #1142 skive 3: `baseline` for kursene folk har fra før (doc/design/PLAN_1142.md, punkt 2). Ingen får e-post om gamle kurs.
--
-- Utvidelse, bare data: én INSERT i tabellen fra skive 1. Kommer i samme versjon som jobben, ikke før: lå den i skive 1, ville
-- par laget mellom skive 1 og skive 3 fått både den gamle e-posten per kurs og den nye.
--
-- «Har vært ute», ikke bare «er publisert» (Codex runde 1 nr. 1): et kurs som står avpublisert akkurat nå, ville ellers gitt
-- alle medlemmene e-post om et gammelt kurs når det publiseres igjen. Sporene: publisert nå, delingslenka (satt ved første
-- publisering siden 2.121.0), arkivert, kursbevis, og `course_published` i revisjonssporet (skrevet ved hver publisering
-- siden #803). Med vilje uten filter på personen (en som har sluttet og kommer tilbake, skal ikke få e-post om gamle kurs)
-- og uten filter på arkiverte klasser (gjenopprettes klassen, skal medlemmene ikke få e-post om kurs de hadde før).
--
-- Kurs som aldri har vært ute, får ingen rad: de gir e-post når de publiseres (vei 3). Kjent hull: et kurs som var ute, ble
-- avpublisert og SÅ tildelt en klasse, får `baseline` (sjeldent, godtatt).
--
-- Testen (test/m2-course-assignment-baseline-1142.test.ts) leser denne fila og kjører den. Hold den til ÉN setning.
INSERT INTO "CourseAssignmentNotice" ("id", "userId", "courseId", "status", "reason", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."userId", p."courseId", 'baseline', 'before_1142', now(), now()
FROM (
  SELECT DISTINCT cm."userId", cga."courseId"
  FROM "ClassMember" cm
  JOIN "Class" c ON c.id = cm."classId" AND c.kind = 'MANUAL' AND c."isSystem" = false
  JOIN "CourseGroupAssignment" cga ON cga."classId" = c.id
  JOIN "Course" co ON co.id = cga."courseId"
  WHERE co."publishedAt" IS NOT NULL                       -- publisert nå
     OR co."slug" IS NOT NULL                              -- fikk delingslenka ved første publisering (2.121.0)
     OR co."archivedAt" IS NOT NULL                        -- pensjonert
     OR EXISTS (SELECT 1 FROM "CourseCompletion" cc WHERE cc."courseId" = co.id)
     OR EXISTS (SELECT 1 FROM "AuditEvent" ae
                WHERE ae."entityType" = 'course' AND ae."entityId" = co.id AND ae."action" = 'course_published')
) p
ON CONFLICT ("userId", "courseId") DO NOTHING;
