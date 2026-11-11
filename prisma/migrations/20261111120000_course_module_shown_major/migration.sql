-- #1140 etappe 1 (doc/DESIGN_1140.md): hovedversjonen av en modul som et kurs viser. Tomt = kurset følger modulens nyeste,
-- som er oppførselen før #1140. Ren utvidelse: ingen tilbakefylling, og kode fra før utrullingen lar feltet stå tomt.
ALTER TABLE "CourseModuleRequirement" ADD COLUMN "shownModuleMajor" INTEGER;

-- Kurset kan ikke vise en lavere hovedversjon enn den det krever: da kunne kravet aldri oppfylles av det deltakeren får.
-- Sjekkes straks, ikke ved commit: den som hever begge i samme transaksjon, setter den viste først.
ALTER TABLE "CourseModuleRequirement"
  ADD CONSTRAINT "CourseModuleRequirement_shown_not_below_min"
  CHECK ("shownModuleMajor" IS NULL OR "shownModuleMajor" >= "minModuleMajor");
