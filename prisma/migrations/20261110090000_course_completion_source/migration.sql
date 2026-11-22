-- #1145: kursbevis for kurs tatt utenfor plattformen (doc/design/PLAN_1145.md). Ren utvidelse: gamle rader får `platform`,
-- gammel kode leser ikke de nye kolonnene.
ALTER TABLE "CourseCompletion" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE "CourseCompletion" ADD COLUMN "registeredById" TEXT;
ALTER TABLE "CourseCompletion" ADD COLUMN "externalReference" TEXT;
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_source_check" CHECK ("source" IN ('platform', 'external'));
