-- #1124 del 2: et sterkt eksempelsvar på fritekstoppgaven, vist deltakeren etter vurderingen når
-- modulen slår det på. Bare utvidelse: én kolonne, null tillatt. Gamle containere som kjører under et
-- bytte, kjenner den ikke og leser eller skriver den ikke.
ALTER TABLE "ModuleVersion" ADD COLUMN "modelAnswer" TEXT;
