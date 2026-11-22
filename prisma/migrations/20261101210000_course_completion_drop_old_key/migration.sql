-- #934 skive 2: trekk sammen. Den gamle unike nøkkelen (bruker, kurs) fjernes; (bruker, kurs, hovedversjon)
-- fra 2.127.0 står. Fra nå kan en deltaker ha ett kursbevis per hovedversjon.
--
-- Trygt under rullering, også om prod hopper fra 2.126.0: eldre kode slår opp bevis med (bruker, kurs) som en
-- vanlig spørring og sjekker før den oppretter — den trenger ikke indeksen. Ingen flate kan lage hovedversjon 2
-- før skive 3, så ingen deltaker kan ha to bevis mens gamle containere kjører.
DROP INDEX IF EXISTS "CourseCompletion_userId_courseId_key";
