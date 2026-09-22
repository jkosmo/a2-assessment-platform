-- Kontraktsfase for to opprydninger som begge har ventet på en egen deploy (#1005, #991).
--
-- ⚠️ Regelen som bestemmer rekkefølgen: en kolonne droppes FØRST i en senere release enn den der
-- koden sluttet å røre den. Gamle containere velger alle skalarer under et bytte, og ville feilet
-- på en kolonne som forsvant i samme deploy. Se #963 for forrige gang.
--
-- #1005: `MCQAttempt.passFailMcq` var en AVLEDET verdi som ble lagret, og kunne derfor komme i
-- utakt med regelen sin — det var #949. Siden 2.73.0 utleder alle fire lesestedene den av
-- modulversjonens grense, og ingen skriver den.
ALTER TABLE "MCQAttempt" DROP COLUMN IF EXISTS "passFailMcq";

-- #991: `recertificationDueDate` er siste rest av resertifiseringen #989 fjernet. Ingen skriver
-- den, ingen leser den.
ALTER TABLE "CertificationStatus" DROP COLUMN IF EXISTS "recertificationDueDate";

-- #991: indeksen betjente skanningen som lette etter sertifiseringer som snart forfalt. Den
-- skanningen finnes ikke lenger, og en indeks ingen spørring bruker koster bare skriving.
DROP INDEX IF EXISTS "CertificationStatus_expiryDate_idx";

-- ⚠️ `CertificationStatus.expiryDate` blir STÅENDE, med vilje (produkteier 19.09).
-- Innsynseksporten (`/api/me`) oppgir den som historikk om personen — hva som faktisk er lagret,
-- ikke en gjeldende utløpsdato. Å droppe kolonnen ville slettet en opplysning vi i dag utleverer.
--
-- ⚠️ Enum-verdiene DUE_SOON/DUE/EXPIRED blir også stående. De betyr alle «bestått», eldre rader
-- har dem, og `CERTIFICATION_PASSED_STATUSES` teller dem derfor med. Å migrere radene til ACTIVE
-- ville slettet sporet av at en sertifisering en gang var utløpt; produkteier valgte 19.09 å la
-- historikken stå.
