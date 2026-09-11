-- #970: startverdi for «sist sett»-språket — språket på brukerens SISTE besvarelse.
--
-- Uten dette ville den første påminnelseskjøringen etter deploy sendt e-post på den konfigurerte
-- standarden (en-GB) til alle som ikke hadde logget inn siden kolonnen kom — der de før fikk bokmål.
-- Besvarelsens språk er det beste signalet vi har fra før: det ble satt av samme forespørselsspråk
-- som nå skrives ved innlogging. Brukere uten besvarelser står igjen som NULL → standarden.
UPDATE "User" u
SET "preferredLocale" = s."locale"
FROM (
  SELECT DISTINCT ON ("userId") "userId", "locale"
  FROM "Submission"
  WHERE "locale" IN ('en-GB', 'nb', 'nn')
  ORDER BY "userId", "submittedAt" DESC
) s
WHERE s."userId" = u."id" AND u."preferredLocale" IS NULL;
