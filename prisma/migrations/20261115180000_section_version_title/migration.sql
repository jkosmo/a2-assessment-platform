-- #1163 skive 1 (doc/design/PLAN_1163_SEKSJON_UTKAST.md, «Andre gjennomlesing» punkt 1): tittelen er en del av utkastet.
-- Hver seksjonsversjon får sin egen tittel; deltakerne leser tittelen fra den publiserte versjonen, og `CourseSection.title`
-- blir forfatterens arbeidstittel (lister, redigereren).
--
-- Ren utvidelse. Gammel kode leser og skriver ikke kolonnen; en versjon gammel kode lager under utrullingen, får `NULL`, og da
-- leser ny kode seksjonens tittel (doc/DECISIONS.md, «Valgt under byggingen av #1163, skive 1»).
--
-- Tilbakerulling: kolonnen kan bli stående. Gammel kode viser `CourseSection.title` til deltakerne, så en ny tittel som bare
-- står i et utkast, går ut med en gang etter tilbakerullingen (slik det var før).

ALTER TABLE "CourseSectionVersion" ADD COLUMN "title" TEXT;

-- Fylles i samme migrering: alle versjoner som finnes, får tittelen seksjonen har i dag. Det er tittelen deltakerne ser nå,
-- så ingen deltaker ser noe annet etter migreringen.
UPDATE "CourseSectionVersion" AS v
SET "title" = s."title"
FROM "CourseSection" AS s
WHERE v."sectionId" = s."id" AND v."title" IS NULL;
