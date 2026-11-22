-- #1139 skive 2 (doc/design/PLAN_1139.md, punkt 4): den ukentlige e-posten kan slås av på profilen. Ren utvidelse: ny kolonne
-- med standardverdi, så gamle rader får `true` og gammel kode ser den ikke.
ALTER TABLE "User" ADD COLUMN "weeklyEmailEnabled" BOOLEAN NOT NULL DEFAULT true;
