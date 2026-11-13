-- #1150 skive 2a-2 (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Hva systemet må huske»): en modul eller seksjon som fulgte
-- et kurs inn i arkivet, husker hvilket kurs og hvilken versjon som var publisert, så gjenopprettingen av kurset kan sette
-- den tilbake slik den var. Ren utvidelse: to valgfrie kolonner per tabell, ingen tilbakefylling, og gammel kode leser dem ikke.
-- Ingen fremmednøkler: merket er et merke, ikke et eierskap. Slettes kurset, nullstiller slettingen merket.
ALTER TABLE "Module" ADD COLUMN "archivedWithCourseId" TEXT;
ALTER TABLE "Module" ADD COLUMN "activeVersionIdBeforeArchive" TEXT;
ALTER TABLE "CourseSection" ADD COLUMN "archivedWithCourseId" TEXT;
ALTER TABLE "CourseSection" ADD COLUMN "activeVersionIdBeforeArchive" TEXT;

-- Gjenopprettingen og slettingen av et kurs spør etter elementene som peker på det.
CREATE INDEX "Module_archivedWithCourseId_idx" ON "Module"("archivedWithCourseId");
CREATE INDEX "CourseSection_archivedWithCourseId_idx" ON "CourseSection"("archivedWithCourseId");
