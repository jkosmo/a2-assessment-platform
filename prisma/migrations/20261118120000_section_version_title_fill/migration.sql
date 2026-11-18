-- #1163 skive 2: fyller tittelen i seksjonsversjoner som står uten (doc/design/PLAN_1163_SEKSJON_UTKAST.md).
--
-- Migreringen i 2.166.0 (20261115180000_section_version_title) fylte alle versjoner som fantes da den kjørte. Under utrullingen
-- av 2.166.0 kunne en instans med kode fra før (2.165.0) likevel lage en versjon uten tittel, fordi den koden ikke kjenner
-- kolonnen. En slik versjon leser arbeidstittelen (`CourseSection.title`), også et senere utkasts tittel. Denne migreringen
-- lukker det vinduet når 2.167.0 rulles ut: da kjører prod 2.166.0, som alltid skriver tittelen. Derfor må 2.167.0 nå prod ETTER
-- 2.166.0, ikke sammen med den; rulles den ut rett over 2.165.0, har den samme vindu som 2.166.0 hadde.
--
-- Reserven i `sectionVersionTitle` (sectionTitle.ts) blir stående til de gamle skriverutene er borte (doc/DECISIONS.md, «Valgt
-- under byggingen av #1163, skive 2»).
--
-- Bare tillegg: en versjon med tittel røres ikke, og migreringen kan kjøres på nytt uten virkning.

UPDATE "CourseSectionVersion" AS v
SET "title" = s."title"
FROM "CourseSection" AS s
WHERE v."sectionId" = s."id" AND v."title" IS NULL;
