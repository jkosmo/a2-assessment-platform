Baseline og `sendingAt`-rettingen holder statisk. **Stage-kopisteget har fortsatt to hull.** Ingen filer er endret eller tester kjørt.

Baseline bruker riktige tabeller og kolonner i `prisma/schema.prisma`. Verdiene `course` og `course_published` stemmer med `src/observability/auditEvents.ts:17,108` og publiseringsskriveren i `src/modules/course/courseCommands.ts:273`. Retention-jobben beskærer revisjonssporet, men **ikke denne handlingen**: slettelisten i `src/modules/retention/auditRetentionService.ts:16` omfatter fire andre handlinger. Planens kartlegging dekker usikkerheten om eldre historikk.

Eksplisitt `sendingAt` ved overtakelse og rydding på samme felt lukker tidsstempelfeilen fra runde 1 (`doc/design/PLAN_1142.md:245,279`). Jeg fant ikke ytterligere blokkeringer i samtidighet eller utrulling utover planens uttrykkelig godtatte overgangshull.

1. **BLOKKERENDE — stage kan opprette varsler som ennå ikke fantes i prod-kopien.**

   **Hvor:** `doc/design/PLAN_1142.md:194–199` og `251–252`.

   Kopisteget nøytraliserer eksisterende varselrader og hendelser. Det dekker ikke tildelinger som produksjonsjobben ennå ikke har oppdaget.

   **Scenario:** Et medlem legges til rett før databasekopien tas, mellom to monitorrunder. Kopien inneholder medlemskapet og kurstildelingen, men ingen `CourseAssignmentNotice`. Kopisteget endrer ingenting for dette paret. Etter oppstart oppretter både prod og stage hver sin rad og sender til samme ekte mottaker.

   **Sannsynlighet:** Lav ved tilfeldig kopitidspunkt og frisk worker; større ved workerstans eller deaktivert kanal. Sendingen følger deterministisk dersom begge miljøene senere sender.

   **Rett planen:** Kopiskriptet må også opprette `baseline` for kopierte medlems-/kurspar uten varselrad før stage starter. Definer dette som en egen stage-baseline. Test uttrykkelig et kvalifisert par **uten** varselrad og outbox-hendelse.

2. **BLOKKERENDE — nøytralisering av 4b-hendelser stopper ikke ventende 4b-varsler.**

   **Hvor:** `doc/design/PLAN_1142.md:198–199`; `src/modules/course/courseMajorVersionEmail.ts:102–137,147–155`; `doc/DESIGN_934.md:505–507`.

   Planen omtaler nøytralisering av 4b-*hendelser*, men ikke `CourseVersionNotice`-rader som fortsatt står i `waiting`. Disse finnes med hensikt også når 4b-e-post er deaktivert.

   **Scenario:** Kopien inneholder en ventende hovedversjonsrad uten outbox-hendelse. Kopiskriptet finner ingen hendelse å stoppe. Når 4b-monitoren aktiveres i stage, oppretter den en ny hendelse og sender produksjonsvarselet fra stage.

   **Sannsynlighet:** Høy dersom kopien har ventende 4b-rader og stage aktiverer 4b med ekte utsending; ellers latent.

   **Rett planen:** Nøytraliser også kopierte, uferdige `CourseVersionNotice`-rader, eksempelvis til eksisterende terminalstatus `skipped` med `reason = 'copied_from_prod'`. Test en `waiting`-rad uten hendelse ved å kjøre 4b-jobben etter kopiskriptet.

Blokkerende: 2, forslag: 0