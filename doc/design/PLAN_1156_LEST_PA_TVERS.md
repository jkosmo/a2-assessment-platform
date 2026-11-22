# Lest seksjon teller i alle kurs som har den (#1156) — plan

**Avgjort av produkteier 13.11.2026:** en lest seksjon teller i alle kurs som inneholder den, slik en bestått modul gjør.
Hvert kurs avgjør fortsatt om lesingen gjelder for kursets nåværende hovedversjon (#934).

Kartlagt i koden 14.11.2026 (etter 2.162.1). Filreferanser er til kartleggingen; de sjekkes på nytt før bygging.

## Slik er det i dag

- `CourseSectionRead { userId, courseId, sectionId, readAt }`, unik på `userId + courseId + sectionId`. Ingen versjon lagres.
  Alle tre fremmednøklene sletter med (`Cascade`): **slettes et kurs, forsvinner lesingene som ble gjort i det.**
- Regelen for ny versjon er **tidsbasert** (`loadSectionReadRules` / `readCountsForCurrentVersion`, `courseVersioning.ts`): en
  lesing teller hvis seksjonen er uendret i kursets hovedversjon, eller hvis den ble gjort etter at hovedversjonen kom. Siden
  seksjonens innhold er felles (`CourseSection.activeVersionId`), gjelder den samme regelen for en lesing gjort i et annet kurs.
- **Bestått modul er mønsteret:** `ModulePass` har ingen `courseId`; hvert kurs henter beståtte for modulen og deltakeren og
  bruker sitt eget krav i minnet (`moduleCredit.ts`, `readPerCourseRule`). En bestått utsteder kursbevis i alle publiserte kurs
  med modulen, via utboksen, én transaksjon per kurs (`checkAndIssueCourseCompletions`). En innlevering gjør deltakeren
  «påbegynt» i alle kurs med modulen.
- **Lesere som filtrerer på `courseId`** (alle må endres): `findReadSectionIds` (kursbevisporten og kursdetaljen),
  `findReadSectionIdsForCourses` («Mine kurs» og den ukentlige e-posten), `findReadSectionIdsForCourseParticipants`
  (kursrapporten og CSV, #1152-vakta, «midt i kurset»), `findLearnerSectionReadersForCourse` (rapportens deltakere),
  kandidatlistene i `courseDeleteGuard.ts` og `contentLifecycle.ts`, `hasUserStartedCourse` («påbegynt»: klassestatus,
  påminnelser, `/enrollments`), `findStartedOrCompletedCourseIds` (synlighet for kurs fra arkiverte klasser), og vilkår 9 i
  tildelings-e-posten (rå SQL, `courseAssignmentNotice.ts`).
- **Lesere som skal stå:** aktivitetsrapporten («leste i kurs X», ett innslag per kurs), «Min statistikk» (teller én per seksjon
  allerede), og vakta for gamle kursbevis (matcher `userId + courseId` mot kursbeviset).
- **Skrivere:** `markSectionRead` (under innholdslåsen delt og deltakerlåsen; sjekker kursbevis bare for kurset man står i),
  og importen «Oppdater kurs», som kopierer lesingene av en utbyttet seksjon til kopien, bare for dette kurset.

## Valget: behold tabellen, les på tvers

Lesingen beholder kurset den ble gjort i («åpnet fra»), men **teller på tvers**: hvert kurs henter deltakerens lesinger av
sine seksjoner fra alle kurs, tar den **seneste** per seksjon, og bruker sin egen versjonsregel. Med den tidsbaserte regelen
teller en senere lesing alltid i minst like mange kurs som en tidligere, så «seneste» mister aldri noe.

Det andre valget, ny nøkkel `userId + sectionId` (slå sammen radene), krever to utrullinger (utvid, trekk sammen), en regel for
hvilket tidspunkt som vinner, og at aktivitetsrapporten og vakta for gamle kursbevis skrives om. Gevinsten er færre rader. Det
er ikke verdt det nå.

**Én migrering likevel** (bare utvidelse): `courseId` blir valgfri og fremmednøkkelen mot kurset `SetNull` i stedet for
`Cascade`, så lesingene blir stående når et kurs slettes (de teller fortsatt i de andre kursene); og en indeks på
`userId + sectionId`. Gammel kode tåler det: den skriver alltid `courseId`, og en rad uten kurs finnes først etter en sletting
og leses ikke av gammel kode. Unik-nøkkelen står (Postgres skiller `NULL`-er).

Dette endrer én ting avgjort i #1152 («et kurs slettes med lesehistorikk»): lesingene blir stående uten kurs. De tilhører
deltakeren og seksjonen nå, ikke kurset. Seksjonen kan fortsatt slettes (da går lesingene, som før).

**#1140 etappe 5** (hvert kurs velger sin egen hovedversjon av en seksjon) bryter den tidsbaserte regelen: da må lesingen
huske hvilken versjon som ble lest. Det hører til den etappen og bygges ikke nå; `DESIGN_1140.md` skal si det.

## Følgene, avgjort ut fra «slik en bestått modul gjør»

1. **Kursbevis i de andre kursene utstedes med en gang**, som for moduler: en lesing legger en hendelse i utboksen, og den
   kjører `checkAndIssueCourseCompletions` for alle publiserte, ikke-arkiverte kurs som har seksjonen, én transaksjon per kurs.
   Da stopper også påminnelsene om frist for det kurset. I dag skjer det først når deltakeren åpner «Mine kurs».
2. **«Påbegynt» gjelder i alle kurs med seksjonen**, som en innlevering gjør i dag: klassestatus, `/enrollments`, påminnelser,
   og vilkår 9 i tildelings-e-posten (en som har lest en delt seksjon, får ikke «nytt kurs»-e-post om et kurs der hen alt har
   begynt — slik det er for moduler).
3. **Rapporten for kurs B** tar med deltakere som har lest B-seksjoner i et annet kurs, som den gjør for innleveringer.
4. **#1152-vakta** («fullført uten kursbevis», «midt i») ser lesingene på tvers. Flere kurs blir holdt igjen; det er den trygge
   retningen.
5. **Importen** kopierer den seneste lesingen per deltaker av den utbyttede seksjonen (fra alle kurs) til kopien, med kurset man
   oppdaterer som «åpnet fra».
6. **Aktivitetsrapporten** viser som før ett innslag per lesing med kurset den ble gjort i; uten kurs (slettet) står den uten
   kursnavn.

## Spørsmål til produkteier

- **Teller lesingen også i kurs deltakeren ikke er tildelt?** For moduler gjør den det i dag, også kursbevis i et begrenset
  kurs hen ikke er med i (koden har ingen sjekk; det er ukjent om det er ment). Anbefaling: likt moduler nå, og ta spørsmålet
  for begge i #1157 (konsistenssjekken).

## Etter gjennomlesingen (uavhengig Claude-agent, 14.11.2026; Codex nådde forbruksgrensen midt i)

Dom: «ikke klar» til spørsmålene under er avgjort. Endringene her går foran teksten over.

**Må avgjøres av produkteier før bygging:**

1. **Kurs deltakeren ikke ser.** Avstemmingen av kursbevis går gjennom alle publiserte kurs uten å sjekke om deltakeren ser
   dem (`reconcileCourseCompletionsForUser`). Med lesing på tvers ville alle som har lest et åpent kurs, få kursbevis i et
   begrenset kurs med de samme seksjonene, i bulk på utrullingsdagen. Et kursbevis kan ikke trekkes tilbake og holder kurset
   igjen fra sletting for alltid. **Anbefaling:** lesingen teller bare i kurs deltakeren ser (åpne kurs, og begrensede kurs
   hen er tildelt), for fremdrift og kursbevis. Moduler beholder dagens oppførsel; spørsmålet for begge tas i #1157.
2. **Hva «påbegynt» betyr.** Med «påbegynt» på tvers ville en delt introseksjon gjøre at den som tildeles kurs B, aldri får
   «nytt kurs»-e-posten; den ukentlige e-posten ville tatt med åpne kurs hen aldri har valgt, som «i gang» (flere e-poster);
   kurs fra arkiverte klasser ville dukket opp igjen i «Mine kurs». **Anbefaling:** fremdriften («Seksjoner 1/9») og
   kursbeviset teller på tvers — det er det saken handler om — men det som utløser eller stopper e-post og synlighet
   (vilkår 9 i tildelings-e-posten, «i gang» i den ukentlige e-posten, synlighet fra arkiverte klasser), krever fortsatt
   aktivitet i kurset selv.
3. **Lesingene blir stående når et kurs slettes** (endrer #1152 «slettes med lesehistorikk»): de tilhører deltakeren og
   seksjonen, og teller i de andre kursene.

**Rettet i planen (tekniske funn):**

- **Arkiverte kurs** teller bare lesinger fram til `archivedAt`. Ellers kan et arkivert kurs bli «fullført uten kursbevis»
  fordi noen leser en delt seksjon et annet sted, og da kan det ikke slettes (#1152).
- **`markSectionRead`** sjekker regelen for alle kurs med seksjonen og gir lesingen nytt tidspunkt hvis den ikke teller i ett
  av dem; ellers kan en ny lesing i A etter en ny hovedversjon i B la B vise seksjonen som ulest.
- **Gammel kode leser rader uten kurs** to steder: aktivitetsrapporten (`r.course.title`) og vakta for gamle kursbevis
  (`courseId in [... null]`). Begge rettes (`course` valgfri, `null` filtreres bort). **Tilbakerulling:** rader uten kurs må
  slettes eller få et kurs før koden rulles tilbake; det står i versjonsnotatet.
- **Utboks-hendelsen** får en egen type (ikke `course_completion_check` med `sectionId`: `moduleId` udefinert ville matchet
  alle publiserte kurs). En gammel worker under utrullingen gir opp hendelsen etter fem forsøk; avstemmingen når «Mine kurs»
  åpnes fanger bevis som går tapt. Hendelsen legges bare når raden er ny eller får nytt tidspunkt.
- **Telleskriptet før prod** skiller kurs deltakeren ser og ikke ser, og viser hvilke kurs som går fra null til flere
  bevisinnehavere (de blir mottakere av e-post ved neste hovedversjon, og «kurs fullført» dateres utrullingsdagen i
  aktiviteten).
- **Aktivitetsrapporten:** `distinctReads` får nøkkelen `userId|sectionId|readAt`, så en lesing kopiert av importen ikke telles to
  ganger.
- **Den felles funksjonen** sier hvilken elementliste den bruker: deltakerens (fremdrift, kursbevis) eller alle elementene
  (#1152-vakta, med seksjoner arkivert sammen med kurset). I rapporten velges «seneste» før datofilteret.
- Mockene i `test/unit/course-certificate-gate-invariant.test.ts` og `course-items-accessor.test.ts` må endres.

## Skiver

- **1156a (tjeneren, én pakke):** migreringen; alle leserne over går gjennom én funksjon som henter på tvers (likt
  `readPerCourseRule`, og en dekningsvakt som nekter nye lesere av tabellen utenom den); utboks-hendelsen for kursbevis i de
  andre kursene; «påbegynt» og vilkår 9; importen.
- Klienten trenger ingen endring: den viser det tjeneren sier.

## Samtidighet

- `markSectionRead` skriver som før under deltakerlåsen. Kursbevisene i de andre kursene utstedes etter commit via utboksen,
  under hvert kurs' egne låser (samme vei som moduler), så lesetransaksjonen blir ikke lengre.
- To lesinger av samme seksjon i to kurs samtidig: to rader, begge teller; «seneste» velges ved lesing.

## Utrulling

- Én migrering, bare utvidelse. Ingen bryter: lesingene som finnes, teller i de andre kursene fra første dag.
- **Følge i prod fra dag én:** deltakere som har lest delte seksjoner, kan bli «fullført» i flere kurs med en gang og få
  kursbevis første gang de åpner «Mine kurs» eller når neste hendelse kommer. Før prod telles det i prod hvor mange kursbevis
  som vil bli utstedt (et lese-skript), så produkteier ser tallet.

## Tester

- Samme seksjon i to kurs: lest i A → lest i B i «Mine kurs», kursdetaljen, rapporten og CSV.
- Endret seksjon som B har tatt i bruk i ny hovedversjon: må leses på nytt i B, ikke i A (og omvendt).
- Lesing i A fullfører B → kursbeviset for B utstedes via utboksen; påminnelsen for B stopper.
- Kurs A slettes → lesingene står uten kurs og teller fortsatt i B.
- Import «Oppdater kurs»: kopien får den seneste lesingen fra alle kurs.
- «Påbegynt» og vilkår 9 på tvers; kontroll: en deltaker som ikke har lest noe, er «ikke startet».
- Dekningsvakt: ingen leser av `courseSectionRead` utenom den felles funksjonen (unntak med grunn: aktivitetsrapporten,
  «Min statistikk», vakta for gamle kursbevis, skriverne).
- Mutasjonssjekk av hver regel; stage-test med to kurs som deler en seksjon.
