-- #934 skive 4a: teller for kursets innhold og innstillinger, så en fane som har stått åpen ikke skriver over
-- det en annen har lagret (409 `course_changed`). Utvidelse, trygg under rullering: én kolonne med standardverdi.
-- Gammel kode leser den ikke og skriver den ikke.
ALTER TABLE "Course" ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 0;
