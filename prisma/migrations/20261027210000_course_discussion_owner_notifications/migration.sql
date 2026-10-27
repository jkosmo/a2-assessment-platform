-- 2.119.0: kursets eiere varsles på e-post om nye spørsmål i diskusjonen, og kan slå det av per kurs.
--
-- Bare utvidelse: én ny kolonne med standardverdi. Gamle containere som kjører under et bytte, kjenner
-- den ikke og leser eller skriver den ikke.
ALTER TABLE "Course" ADD COLUMN "discussionOwnerNotifications" BOOLEAN NOT NULL DEFAULT true;
