-- #1093: en valgfri plassering per kurs i «Mine kurs».
--
-- Lista sorteres nå alfabetisk på tittelen i deltakerens språk; et kurs med et tall her kommer
-- først, stigende (et introduksjonskurs alle skal ta først). Tomt er det vanlige.
--
-- Bare utvidelse: én ny kolonne som kan være NULL. Gamle containere som kjører under et bytte,
-- velger og skriver ikke kolonnen, og merker den ikke.
ALTER TABLE "Course" ADD COLUMN "sortOrder" INTEGER;
