-- #1192 punkt 2, skive 2a (doc/design/PLAN_1192_BESTATT_OG_FRIST.md): når en frist sist ble satt eller endret.
--
-- En frist satt etter at kursets nåværende hovedversjon ble publisert, gjør kurset utestående igjen for den som bare har
-- kursbevis for en eldre hovedversjon (produkteier 2026-11-24). Ingen tabell lagret når fristen ble satt.
--
-- Bare tillegg (#811). Ingen tilbakefylling: eksisterende frister står med NULL, som regnes som satt FØR den nye hovedversjonen
-- (produkteier, svar B 2026-11-24), så utrullingen endrer ingen status og sender ingen påminnelser. Gammel kode under
-- utrullingen skriver ikke feltet; en frist som endres i de minuttene, beholder et eldre tidspunkt (kjent mangel).

ALTER TABLE "CourseEnrollment" ADD COLUMN "dueSetAt" TIMESTAMP(3);
ALTER TABLE "CourseGroupAssignment" ADD COLUMN "dueSetAt" TIMESTAMP(3);
