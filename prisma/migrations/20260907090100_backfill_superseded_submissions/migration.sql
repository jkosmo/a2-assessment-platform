-- #951, del 2: rett opp de innleveringene som allerede står som COMPLETED uten å være avgjort.
--
-- ⚠️ HVORFOR EN EGEN MIGRASJON. `ALTER TYPE ... ADD VALUE` legger til verdien, men den kan ikke
-- BRUKES i samme transaksjon som den ble lagt til i. Backfillen må derfor kjøre etter at
-- forrige migrasjon er committet. Slås de to sammen, feiler den med
-- «unsafe use of new value of enum type».
--
-- ⚠️ AVGRENSNINGEN ER SMAL MED VILJE. Bare innleveringer som har en sensorsak markert SUPERSEDED
-- røres. En retake på en modul UTEN åpen sensorsak setter ikke den gamle innleveringen til
-- COMPLETED via denne veien — den bærer et ekte vedtak og skal fortsatt telle.
--
-- På stage traff dette 12 rader, alle med et gammelt automatisk vedtak som sa «ikke bestått».
-- De var derfor ikke synlig gale i tallene ennå, men de var like ubesluttede.

UPDATE "Submission" s
SET "submissionStatus" = 'SUPERSEDED'
WHERE s."submissionStatus" = 'COMPLETED'
  AND EXISTS (
    SELECT 1
    FROM "ManualReview" r
    WHERE r."submissionId" = s."id"
      AND r."reviewStatus" = 'SUPERSEDED'
  );
