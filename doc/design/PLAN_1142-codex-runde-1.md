Jeg fant **tre blokkerende hull**. Gjennomgangen er statisk; ingen filer er endret. Jeg har ikke telt planens allerede beskrevne og godtatte overgangshull som nye funn.

1. **BLOKKERENDE — baseline overser eldre kurs som var avpublisert da slug ble innført.**

   **Hvor:** Planen linje 166–175; [slug-migreringen:15](prisma/migrations/20261031090000_course_slug/migration.sql:15), [courseCommands.ts:324](src/modules/course/courseCommands.ts:324) og [courseVersioning.ts:137](src/modules/course/courseVersioning.ts:137).

   Slug-migreringen fylte bare kurs med `publishedAt IS NOT NULL`. Arkivering nullstiller `publishedAt`. Et kurs publisert og deretter arkivert eller avpublisert **før slug-migreringen**, kan derfor fortsatt ha begge feltene null. Planens påstand «Arkiverte kurs har slug» holder ikke.

   **Scenario:** Klassen hadde kurset før utrullingen. Kurset har vært avpublisert siden før slug-migreringen. Baseline hopper over alle medlemsparene. Når kurset publiseres igjen, får medlemmer uten kursbevis e-post om et gammelt kurs. Dette er et annet hull enn planens uttrykkelig godtatte tilfelle med *tildeling etter avpublisering*.

   **Sannsynlighet:** Avhenger av historiske data; feilen er deterministisk ved republisering av et slikt kurs. Forekomsten kan ikke fastslås fra repoet.

   **Rett planen:** Utvid baseline med dokumenterbar publiseringshistorikk. Koden i `hasCourseBeenPublished` bruker allerede kursbevis som ytterligere bevis; revisjonssporet kan dekke flere tilfeller. Kartlegg gamle kurs uten slug før utrulling. Behold en separat test for et **ekte, aldri publisert utkast**, slik at rettingen ikke ødelegger vei 3.

2. **BLOKKERENDE — full prod→stage-kopi kan sende de ventende e-postene en gang til.**

   **Hvor:** Planen linje 179–180; [outboxService.ts:135](src/modules/outbox/outboxService.ts:135) og [participantNotificationService.ts:417](src/modules/certification/participantNotificationService.ts:417).

   Å ta med den nye tabellen hindrer gjenskaping av `baseline`/`sent`, men kopierer også `waiting` og `queued`. En full kopi tar dessuten med ventende outbox-hendelser. Dedupen gjelder bare innenfor hver database; avsenderen har ingen kontroll mot produksjonens leveringsstatus.

   **Scenario:** Kopien tas mens et digest venter. Produksjon sender etter kopitidspunktet. Stage starter med ekte mottakeradresser og aktiv e-postkanal, og sender samme digest. Kopieres bare varselradene, kan to timers opprydding senere gjenskape utsendingen.

   **Sannsynlighet:** Høy dersom kopien inneholder ventende varsler og stage har ekte utsending aktivert; ingen risiko fra denne veien når utsending er forsvarlig sperret.

   **Rett planen:** Kopioppskriften må stoppe utsending **før** import/start og håndtere både varselrader og outbox. Behold historikken som hindrer gjenskaping, men nøytraliser kopiert utsendingsarbeid før ekte sending eventuelt aktiveres. Å inkludere tabellen er ikke tilstrekkelig.

3. **BLOKKERENDE — rå `UPDATE … RETURNING` mangler tidsstempelet som oppryddingen trenger.**

   **Hvor:** Planen linje 226 og 256; [courseMajorVersionEmail.ts:95](src/modules/course/courseMajorVersionEmail.ts:95), [courseMajorVersionEmail.ts:221](src/modules/course/courseMajorVersionEmail.ts:221) og [eksisterende varselmigrering:17](prisma/migrations/20261104220000_course_version_notice/migration.sql:17).

   I 4b skjer overgangen til `sending` gjennom Prisma, som oppdaterer `@updatedAt`. SQL-en i planen setter bare status. `@updatedAt` er ikke en PostgreSQL-trigger. Bygges SQL-en som vist, kan oppryddingen måle alderen på den tidligere tilstanden.

   **Scenario:** Et varsel har stått over 30 minutter i kø etter driftsstans eller køopphopning. Behandleren tar det med rå SQL. Neste monitorrunde setter den pågående sendingen til `uncertain` fordi `updatedAt` fortsatt er gammelt. Sendingen får deretter en sikker, midlertidig feil. Den betingede tilbakeføringen fra `sending` treffer ingen rad, og neste forsøk sender ikke. E-posten uteblir.

   **Sannsynlighet:** Lav ved normal, kort kø; reell ved etterslep og overlapp mellom sending og monitorrunde.

   **Rett planen:** Sett `updatedAt` eksplisitt i rå statusoppdateringer, eller innfør `sendingAt` og bruk det som oppryddingsgrunnlag. Test en gammel `queued`-rad som nettopp er overtatt, med opprydding mens `send` holdes åpen.

4. **FORSLAG — femten minutter er ikke en utrullingsgaranti.**

   **Hvor:** Planen linje 333–336; [CourseMajorEmailMonitor.ts:38](src/modules/course/CourseMajorEmailMonitor.ts:38), [deploy-environment.ps1:898](scripts/azure/deploy-environment.ps1:898) og [outboxService.ts:261](src/modules/outbox/outboxService.ts:261).

   Ventetiden gjelder første oppstart med tom ventekø. Etter omstart eller tilbakerulling kan gamle `waiting`-rader være klare i første runde. Eksisterende `queued`-hendelser trenger heller ikke vente. Deployskriptet legger dessuten ut worker før parser og web; vinduet koordinerer ikke versjonene.

   Dette er **forslag**, fordi planens gjenkøing kan gjenopprette hendelser gamle workere bruker opp; jeg har ikke påvist et ytterligere permanent tap utover hullene planen allerede beskriver.

   **Rett planen:** Avgrens femtenminutterspåstanden til førstegangsoppstart. Beskriv eksplisitt oppførsel ved eksisterende kø, og test gammel dispatcher mot ny hendelsestype etterfulgt av gjenoppretting. Bruk verifisert aktivering etter versjonskontroll dersom dere trenger en faktisk utrullingsgaranti.

5. **FORSLAG — delte konstanter gir ikke felles sendetempo.**

   **Hvor:** Planen linje 241–243; [courseMajorVersionEmail.ts:136](src/modules/course/courseMajorVersionEmail.ts:136), [OutboxDeliveryWorker.ts:90](src/modules/outbox/OutboxDeliveryWorker.ts:90) og [participantNotificationService.ts:189](src/modules/certification/participantNotificationService.ts:189).

   Hver jobb starter sin egen serie med `availableAt = now + indeks × 3 sekunder`. Begge kan dermed reservere de samme tidspunktene og samlet legge inn 40 varsler per minutt. Outboxen behandler sekvensielt **per worker**, men legger ingen pause mellom allerede tilgjengelige hendelser. To workere kan også sende samtidig.

   **Rett planen:** Fjern garantien om at meldingene ikke går i samme sekund. Hvis #900 krever et felles tak, må tidsluker eller struping deles på tvers av produsenter og workerinstanser. Test begge jobbene samtidig og med opparbeidet kø. Jeg klassifiserer ikke dette som blokkering uten dokumentasjon på at den samlede belastningen faktisk gir tap etter retry.

6. **FORSLAG — spørsmålet om fullføring må også angi hvilken hovedversjon som teller.**

   **Hvor:** Planen linje 137–138 og spørsmål 1; [schema.prisma:795](prisma/schema.prisma:795) og [courseCompletionService.ts:91](src/modules/course/courseCompletionService.ts:91).

   Planens `NOT EXISTS` betyr «personen har aldri fått kursbevis for noen hovedversjon». Koden skiller mellom fullføring av eldre og nåværende hovedversjon.

   **Scenario:** Personen har kursbevis for versjon 1, men får versjon 2 gjennom en ny klasse. Planen undertrykker tildelingsvarselet selv om nåværende kurs ikke er fullført. Det kan være ønsket policy, men følger ikke entydig av spørsmålet «kurs personen alt har fullført».

   **Rett planen:** Be om et uttrykkelig valg mellom *ethvert historisk kursbevis* og *kursbevis for nåværende hovedversjon*. Ta med begge tilfellene i testene. Dette er et beslutningspunkt, ikke et konstatert kravbrudd.

7. **FORSLAG — sammenligningstesten kan ikke kreve identiske resultater fra dagens «Mine kurs»-funksjoner.**

   **Hvor:** Planen linje 146–148 og 370–372; [classRepository.ts:103](src/modules/course/classRepository.ts:103) og [enrollmentService.ts:304](src/modules/course/enrollmentService.ts:304).

   `findManualMembership` filtrerer faktisk ikke på klassens `kind` eller `isSystem`. De nevnte synlighetsfunksjonene filtrerer heller ikke på mottakerstatus eller kursbevis. Dermed avviker planens e-postregel med hensikt fra sammenligningsgrunnlaget, særlig for den kunstige Entra-klassen med medlemsrad og for fullførte kurs.

   **Rett planen:** Sammenlign først **kursgrunnlaget fra vanlige klasser**, og test deretter e-postens mottaker- og fullføringsfiltre separat. Ellers risikerer testen å presse implementasjonen mot feil likhet eller ende med å etterligne SQL-regelen.

Selve grepet med å oppdage lagret tilstand er forsvarlig for de undersøkte innmeldings-, tildelings- og publiseringsveiene. Jeg fant ingen ytterligere runtime-oppretter av medlemskap eller klassetildelinger utenfor `classRepository`. Importens avpublisering, klassesletting med kaskader, pseudonymisering og kursbevisutstedelse håndteres prinsipielt av ny kontroll før sending.

`ON CONFLICT DO NOTHING` beskytter opprettelsen, og betinget `UPDATE … RETURNING` beskytter overtakelsen. Personlåsen serialiserer samlingene, men fryser ikke medlemskap eller publisering. Sletting fremfor `skipped` er forsvarlig når slettingen også er avgrenset til riktig rad, batch og usendt status. Vei 3 fungerer for ekte, aldri publiserte utkast med dagens baseline; det er historiske kurs uten slug som bryter skillet.

**Blokkerende: 3, forslag: 4**