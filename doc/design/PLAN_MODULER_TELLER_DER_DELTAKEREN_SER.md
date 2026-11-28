# Bestått modul teller bare i kurs deltakeren ser — plan

**Avgjort av produkteier 28.11.2026** («OK» på anbefalingen etter gjennomgangen av 2.191.0, «Dupliser kurs»): et bestått i en
modul teller bare i kurs deltakeren ser, slik en lest seksjon gjør fra #1156. Spørsmålet ble stående åpent i #1156 («Moduler
beholder dagens oppførsel; spørsmålet for begge tas i #1157», doc/DECISIONS.md). Det må være på plass før «Dupliser kurs» går til
prod.

Kartlagt i koden 28.11.2026 (2.191.0).

## Hvorfor nå

`ModulePass` har ingen `courseId`. Et bestått teller i alle kurs med modulen (`findModuleProgress`, moduleCredit.ts), også et
begrenset kurs deltakeren ikke er tildelt. To følger, begge fantes før, men «Dupliser» gjør dem til ett klikk:

1. **Kursbevis i bulk.** En kopi med bare moduler gir kursbevis til alle som har bestått modulene, så snart den publiseres:
   avstemmingen (`reconcileCourseCompletionsForUser`) utsteder dem når deltakeren åpner «Mine kurs», og den neste beståtte gjør det
   i workeren (`checkAndIssueCourseCompletions`). Et kursbevis kan ikke trekkes tilbake.
2. **Kopien kan ikke slettes.** Arkiveres en kopi, regner slettevakta (`courseDeleteGuard.ts`, grunn 2) alle som har bestått de
   delte modulene som «fullført uten kursbevis», også når kopien aldri ble publisert. Kurset holdes igjen for alltid.

## Regelen

For deltaker D, kurs K og modul M i kursets krav: en bestått som teller etter dagens regel (`passCountsForCourse`: ikke
ugyldiggjort, hovedversjon ≥ kravet), teller i K bare når

1. **D ser K**: samme regel som lesingene (`findLearnersSeeingCourses`, learnerVisibility.ts): K er åpent, eller begrenset og D har
   en aktiv påmelding eller er i en klasse K er tildelt (en arkivert klasse bare når D har påbegynt eller fullført K);
2. **og, er K arkivert, levert fram til `archivedAt`** (besvarelsens `Submission.submittedAt`, gjennom `ModulePass.submissionId`).
   Samme punkt 3 som for lesinger: ellers kan et arkivert kurs bli «fullført uten kursbevis» av at noen består en delt modul et
   annet sted. **Levert, ikke bestått** (planlesingen, blokker): en besvarelse som ble levert før arkiveringen og venter på vurdering
   eller anke, kan bli bestått etterpå. Med `passedAt` ville den ikke telt, grunn 2 i slettevakta ville aldri slått til, og kurset
   kunne slettes når saken var avgjort — beviset kunne da aldri utstedes. Med `submittedAt` holder grunn 2 kurset igjen.

**Ingen unntak for «gjort i kurset».** Lesingen husker kurset den ble gjort i, og en lesing gjort i K teller alltid i K. Et bestått
har ikke noe kurs. Følgen: **mister D tildelingen til et begrenset K, teller ikke beståttene der lenger.** Kursbevis som er
utstedt, står. Det er samme svar som «Mine kurs» gir i dag (D ser ikke K), og rapporten for K viser D som ikke bestått.

`standing` blir `null` (ikke `REVISED`) for et bestått som ikke teller fordi D ikke ser K: «ta modulen på nytt» er feil beskjed.

## Hvor det endres: én funksjon

`findModuleProgress` er den ene veien (`test/content-lock-write-guard.test.js` nekter andre lesere). Den får synligheten slik
`findSectionReadCredit` har den, med de samme valgene:

- `knownVisibleCourseIds` / `visibilityComplete` (bare med én deltaker): kalleren har slått fast hva D ser, med innloggingen;
- ellers slås synligheten opp på kallerens klient, i ett sett med spørringer, bare for begrensede kurs (og et arkivert kurs bare
  for beståtte før `archivedAt`).

Klienttypen (`ProgressReader`) utvides med `course` og `VisibilityClient`, og med den typene som sender klienten videre
(`CourseRepositoryClient`, `ModuleLevelReader`, courseRepository.ts) — ellers kompilerer ikke `repo.findModuleProgress`. `findCreditedModules`/`findCreditedModuleIds` brukes
bare av tester; de får samme regel eller merkes som det gamle spørsmålet (avgjøres under byggingen, står i testen).

## Veiene inn (alle leser `findModuleProgress`)

| Leser | Hvem | Synligheten |
|---|---|---|
| Kursbevisporten `findCompletionToIssue` | lesingen, workeren etter bestått, avstemmingen, arkivering/gjenoppretting | det kalleren vet (`KnownVisibility`), ellers oppslag i transaksjonen. Sendes videre til både moduler og seksjoner |
| `checkAndIssueCourseCompletions` (workeren, etter bestått) | én deltaker, alle publiserte kurs med modulen | oppslag før låsene, som `…ForSection`; kurs D ikke ser, hoppes over |
| Kursdetaljen `routes/courses.ts:214` | D, innlogget | ruta har slått fast at D ser K |
| «Mine kurs» og den ukentlige e-posten `myCoursesProgress.ts` | D | kursene er de D ser |
| Kursrapporten og CSV `courseReport.ts` (to steder) | alle deltakere | oppslag. **Deltakerne** (`:143–153`): en innlevering gjør D til en rad bare i kurs D ser (planlesingen), ellers får en begrenset kopi rader «Pågår 0/N» for alle som har levert på de delte modulene. Tildelte, kursbevis og lesinger som teller, gir rad som før |
| «Midt i kurset» `contentLifecycle.ts:628–660` (arkiveringsdialogen, kurslista, `course_has_active_participants`) | kandidatene | oppslag. **Også kandidatene filtreres** (planlesingen): en innlevering gjør D til kandidat bare i kurs D ser, slik en lesing bare blir kandidat når den teller. Ellers står alle som har bestått de delte modulene et annet sted, som «midt i» en begrenset kopi (0 av N), og arkiveringen spør om dem |
| Slettevakta `courseDeleteGuard.ts:204`, grunn 2 | kandidatene | oppslag. Færre «fullført uten kursbevis»: kopien kan slettes. Grunn 3 og 4 (ventende saker, uferdige innleveringer) er uendret: tvil gir «beholdes» |
| Arkiveringens utstedelse `issueMissingCompletionsBeforeArchive` (courseCompletionService.ts) | kandidatene, én om gangen under den eksklusive låsen | synligheten som arkiveringens analyse alt har regnet ut, sendes med (`KnownVisibility`), så hver deltaker ikke gir to nye oppslag under låsen |
| Modulrapportene med kurs valgt (`completionReport.ts:37`, `findModuleStanding` med `courseId`) | | **uendret, uttrykkelig**: rapporten handler om modulen; kurset gir bare kravet til hovedversjon. Funksjonen ber om det med et eget valg (`visibility: "ignore"`), og det står i testen. Uten det ville en som besto en eldre hovedversjon, vist «Bestått» i stedet for «Ny versjon» |
| `externalCompletionService.ts` (registrerte kursbevis) | | leser ingen modulfremdrift (sjekket) |

**Ikke endret:** «påbegynt» (innlevering på en modul i kurset, også for synlighet fra arkiverte klasser), vilkår 9 i
tildelings-e-posten, modulrapportene (også med kurs valgt, over), profilen og resertifiseringen (`findModuleStanding`).

**Ett tillegg i slettevakta:** et kurs som **aldri** er publisert (`isCourseEverPublished`), har ingen «fullført uten kursbevis»
(grunn 2). Ingen deltaker har sett det, og beviset kan bare komme ved at det publiseres. Uten dette holdes en åpen kopi som aldri
ble publisert, igjen for alltid av alle som har bestått modulene (planlesingen, punkt 6).

**Åpne kurs er ikke løst, med vilje.** Et åpent kurs ser alle, så der teller beståttene som før: en åpen kopi med bare moduler gir
kursbevis til alle som har bestått dem, når den publiseres. Kopien er begrenset fra start; den som gjør den åpen, velger det.
Dialogen for publisering sier allerede hvem som ser kurset.

## Samtidighet

Ingen ny lås. Porten leser synligheten i samme låste transaksjon som beståttene, som for lesinger. En tildeling som kommer etter
målingen, gir beviset ved neste avstemming («Mine kurs») eller neste bestått/lesing, som for seksjoner. Entra-klasser telles ikke
uten innlogging (kjent mangel fra #1156, kan ikke opprettes i dag, #1017): workeren hopper over dem, avstemmingen tar dem.

## Utrulling

Ingen migrering. Ingen kursbevis utstedes av utrullingen: fremdrift tas bare bort. I begrensede kurs der noen har bestått delte
moduler uten å være tildelt, endres tallene: rapportene mister de radene, og «midt i» blir mindre (kandidatene filtreres). Før
prod: tell slike par (deltaker, begrenset kurs) i stage-kopien med et skript etter mønster av
`scripts/maintenance/count-section-read-certificates.ts`.

## Tester

- Enhet: regelen uten database (ser/ser ikke, åpent, arkivert før/etter `archivedAt`, `standing` er `null`).
- Integrasjon gjennom ruta: kopi med bare moduler, publisert, begrenset → `GET /api/courses` (avstemmingen) gir ikke bevis til en
  som har bestått modulene; etter tildeling gir den det. Åpent kurs: bevis som før (kontroll). Workeren etter bestått: ikke i et
  kurs D ikke ser. Rapporten: D vises ikke som bestått. Slettevakta: en arkivert kopi uten tildelte er slettbar; med en tildelt
  som har bestått, holdes den igjen (kontroll).
- Fra planlesingen: levert før arkivering og bestått etter (sak som ventet) → slettevakta holder kurset; kontroll: levert et annet
  sted etter arkiveringen → holder ikke. En begrenset kopi uten tildelte, med innleveringer gjennom kilden → «midt i» 0, ingen rader
  i rapporten. Modulrapporten med kurs valgt for en som ikke ser kurset og har en eldre hovedversjon → «Ny versjon» (uendret).
  Synlig gjennom en arkivert klasse, holdt bare av en innlevering → teller i rapporten og slettevakta. Deltakerrollen utløpt, kurs
  tildelt «Alle deltakere» → teller ikke. Et kurs som aldri er publisert, arkivert → ingen grunn 2.
- Oppslagene: kursdetaljen, «Mine kurs» og workeren under låsene slår ikke opp synligheten selv (`lookupVisibility` kalles ikke);
  rapporten og arkiveringen gjør ett oppslag per kall, ikke per deltaker.
- Mutasjoner: fjern synlighetssjekken, bruk `passedAt` i stedet for `submittedAt`, la `standing` bli `REVISED`, la workeren
  slippe synligheten, dropp `knownVisibleCourseIds` i `myCoursesProgress`, dropp kandidatfilteret i «midt i», dropp
  `visibility: "ignore"` i modulrapporten, dropp «aldri publisert» i slettevakta.

Status: lest av en uavhengig agent 28.11.2026 (én blokker, tre bør-rettes; lagt inn over, merket «planlesingen»). Bygget i 2.192.0.

**Valgt under byggingen:** kandidatfilteret i «midt i kurset» og i kursrapportens deltakere ble **ikke** bygget. Rapporten tar med
innleverne for å dekke Entra-klasser (#996, `course-report-audience-969` fester det), og «midt i» teller i den trygge retningen
(kommentaren i contentLifecycle.ts). Den som har levert på en delt modul et annet sted, står derfor fortsatt som rad og som «midt i»
i en begrenset kopi, med en annen status enn før. Ført som kjent mangel i VERSIONS.
Tillegget i slettevakta («aldri publisert») ble bygget og tatt ut igjen etter full runde: «aldri publisert» kan ikke leses sikkert
for eldre kurs (`slug` kan mangle), og en feil lar et kurs slettes mens noen har fullført uten kursbevis.
