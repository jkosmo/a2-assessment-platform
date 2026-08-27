-- #950: hvilken regel som avgjorde, som data ved siden av den engelske setningen.
--
-- decisionReason er én tekst serveren skriver på engelsk. Klienten forsøkte å oversette den ved å slå
-- den opp i et kart over engelsk prosa, og det driftet: kartnøkkelen på klienten nevnte fortsatt
-- «borderline» etter at serveren sluttet å skrive det, og grunner med tall i seg kan aldri slås opp
-- som tekst. Feltet inneholder dessuten fritekst en sensor eller klagebehandler har skrevet selv.
--
-- En rad MED kode er maskinskrevet og formuleres på deltakerens språk. En rad UTEN kode er et
-- menneskes egne ord — eller eldre enn dette feltet — og vises ordrett.
--
-- Expand-safe: additive, nullable, ingen backfill, ingen drop/rename (CLAUDE.md invariant #13).
ALTER TABLE "AssessmentDecision" ADD COLUMN "decisionReasonCode" TEXT;
ALTER TABLE "AssessmentDecision" ADD COLUMN "decisionReasonParams" TEXT;
