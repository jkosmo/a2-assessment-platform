-- #934: hovedversjon og mindre versjon for kurs, og versjonen et kursbevis ble utstedt for.
--
-- Utvidelse, trygg under rullering: fire kolonner med standardverdi. Eksisterende kurs og bevis blir 1.0.
-- Den nye unike nøkkelen (bruker, kurs, hovedversjon) legges til VED SIDEN AV den gamle (bruker, kurs).
-- Den gamle står til skive 2 (utvid først, trekk sammen etterpå): så lenge den står, finnes det høyst ett
-- bevis per kurs, og verken gamle containere eller dagens lesere kan møte to.
ALTER TABLE "Course" ADD COLUMN "versionMajor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Course" ADD COLUMN "versionMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CourseCompletion" ADD COLUMN "versionMajor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CourseCompletion" ADD COLUMN "versionMinor" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "CourseCompletion_userId_courseId_versionMajor_key" ON "CourseCompletion"("userId", "courseId", "versionMajor");
