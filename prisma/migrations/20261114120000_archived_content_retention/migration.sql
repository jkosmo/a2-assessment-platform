-- #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Fristen» og «Etter gjennomlesingen» punkt 8): arkivert innhold
-- uten deltakerhistorikk slettes seks kalendermåneder etter det seneste av `archivedAt` og overgangstidspunktet. Ren utvidelse:
-- tre indekser og én rad. Gammel kode leser ingen av delene.

-- Listene over arkiverte og jobben (4c) spør etter det som er arkivert.
CREATE INDEX "Course_archivedAt_idx" ON "Course"("archivedAt");
CREATE INDEX "Module_archivedAt_idx" ON "Module"("archivedAt");
CREATE INDEX "CourseSection_archivedAt_idx" ON "CourseSection"("archivedAt");

-- Overgangstidspunktet: dagen funksjonen kom i DETTE miljøet. Innhold arkivert før det regnes som arkivert da, så ingenting slettes
-- de første seks månedene. Første gang en migrering skriver en rad i `PlatformConfig`.
--   - Nøkkelen er `ARCHIVED_CONTENT_RETENTION_FLOOR_KEY` (src/config/retention.ts).
--   - Verdien er ISO 8601 i UTC med «Z» (`2026-11-14T12:00:00.000Z`), lest av `parseRetentionFloor` (retentionDeadline.ts), som
--     avviser alt annet. Et tidspunkt uten tidssone kunne vært lest som lokal tid.
--   - `updatedAt` har ingen standardverdi i tabellen og må settes. Kolonnen er `TIMESTAMP(3)` uten tidssone, og Prisma leser den
--     som UTC: verdien skrives i UTC, ikke i øktens tidssone (en lokal database på norsk tid ville ellers stått en time feil).
--   - ON CONFLICT DO NOTHING: finnes raden (en kopi fra prod til stage, eller migreringen kjørt på nytt), står den urørt. Flyttes
--     tidspunktet, flyttes alle fristene.
INSERT INTO "PlatformConfig" ("key", "value", "updatedAt", "updatedBy")
VALUES (
  'archived_content_retention_floor',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  now() AT TIME ZONE 'UTC',
  NULL
)
ON CONFLICT ("key") DO NOTHING;
