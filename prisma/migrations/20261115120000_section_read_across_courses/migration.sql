-- #1156 (doc/design/PLAN_1156_LEST_PA_TVERS.md, «Én migrering likevel»): en lest seksjon teller i alle kurs som inneholder den.
-- Ren utvidelse. Gammel kode tåler den: den skriver alltid `courseId`, og en rad uten kurs finnes først etter at et kurs er
-- slettet med den nye koden.
--
-- Tilbakerulling: rader uten kurs må slettes eller få et kurs FØR koden rulles tilbake. Gammel kode leser `courseId` som påkrevd
-- (aktivitetsrapporten, «Min statistikk», den ukentlige e-posten og vakta for gamle kursbevis), og Prisma kaster på en tom verdi.

-- Lesingen blir stående når kurset den ble gjort i, slettes. Den tilhører deltakeren og seksjonen.
ALTER TABLE "CourseSectionRead" ALTER COLUMN "courseId" DROP NOT NULL;
ALTER TABLE "CourseSectionRead" DROP CONSTRAINT "CourseSectionRead_courseId_fkey";
ALTER TABLE "CourseSectionRead" ADD CONSTRAINT "CourseSectionRead_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hvert kurs henter deltakerens lesinger av sine seksjoner fra alle kurs.
CREATE INDEX "CourseSectionRead_userId_sectionId_idx" ON "CourseSectionRead"("userId", "sectionId");

-- Unik-nøkkelen (`userId`, `courseId`, `sectionId`) står: Postgres skiller tomme verdier, så to lesinger uten kurs kolliderer ikke.
