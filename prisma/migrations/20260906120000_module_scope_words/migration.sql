-- #1049: forfatterens forventede svarlengde per modul.
--
-- NULL betyr «bruk nivåets standard» (LEVEL_SCOPE). Kolonnene er derfor nullable uten default:
-- en default ville frosset dagens tall i databasen, og da ville en endring av standarden ikke
-- nådd eksisterende moduler. Standarden hører hjemme i koden, ikke i hver rad.
ALTER TABLE "Module" ADD COLUMN "scopeMinWords" INTEGER;
ALTER TABLE "Module" ADD COLUMN "scopeMaxWords" INTEGER;
