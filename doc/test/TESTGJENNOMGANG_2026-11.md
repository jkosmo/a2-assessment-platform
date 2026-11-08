# Testgjennomgang november 2026 (versjon 2.145.0)

Produkteier 2026-11-08: «Vi burde muligens ha en gjennomgang av testene, slik at alle fortsatt er relevante, ikke tester mot
gammel funksjonalitet vi har tatt bort.»

Dette er en liste over kandidater. Hver rad er laget slik at produkteier kan avgjøre den for seg. Kolonnen «Bevis» viser enten
hvor det testen sjekker, er fjernet, eller hvilken annen test som dekker det samme. Lista under er uendret fra gjennomgangen;
hva som er gjort med den, står i «Status» rett under.

## Status etter ryddingen 2026-11-08 (grenen `rydding-testinfra`)

**Gjort:** CI-jobben for e2e, stage-skriptene (avsnitt 3), de tre trege tingene (5.1-1, 4.4, 4.1-1, 4.1-2), og radene merket
«sikker» som ikke gjelder bryteren, den gamle regelen eller arkiverte klasser. **Ikke gjort:** avsnitt 1.2 og 1.3 (bryteren og
den gamle regelen, en annen agent), og radene som er usikre. **Ikke kjørt:** integrasjonsendringene (se under), fordi
testdatabasen var i bruk.

| Rad | Hva som er gjort | Hva som dekker det som ble fjernet |
|---|---|---|
| Utenfor oppdraget (e2e i CI) | `playwright`-jobben i `.github/workflows/ci.yml` er låst til `ubuntu-24.04`. Samme feil i første (40473237228, 2026-10-27) og siste (42503343943) kjøring | – |
| 3.1, 3.2 | `test/stage/versjon.ts` (`forventMinstVersjon`, enhetstest i `test/unit/stage-minst-versjon.test.ts`) i 17 filer og 2.139; dialogene krever minst 2.136.0 | – |
| 3.1 | Slettet 2.127, 2.128, 2.129, 2.130, 2.135 | Se radene i 3.1 |
| 3.1 (2.134) | Slettet :150-179; kalibreringen forventer nå 1.2 | `release-2-136-regelen-per-kurs` (409 på avkrysningen), `test/m2-module-pass-per-course-934-5a3.test.ts` (avvisningene med bryteren på) |
| 3.1 (release-surface) | 401 på kursimport slettet | `deployed-surface.spec.ts`, lista over beskyttede ruter |
| 5.1-1 | `shell-undefined-names-guard`: én `tsc`-kjøring; rød når en fil mangler, ikke er i programmet, eller `tsc` feiler i oppsettet | – |
| 4.4 | `vitest.integration.config.ts` leser og utelukker `include` fra `vitest.unit.config.ts`. `vitest list --filesOnly` før og etter: nøyaktig de 24 er borte fra integrasjon, alle står i enhet | Enhetskjøringen |
| 4.1-1 | `locale-surface-contract-1044`: «lasting» slått sammen med «språkbytte» (8 tester færre) | Den sammenslåtte testen |
| 4.1-2 | Undermenyen sjekkes i `page-title.spec.ts` for /results, /review, /deltakere/aktivitet; `deltakere-subnav-keys-1096` har /deltakere/status igjen (9 tester færre). Felles sjekk i `test/support/deltakereSubnav.ts` | `page-title.spec.ts` |
| 4.1-6, 4.1-7 | `admin-content-workspaces` :1485 og :1679 slettet, de unike sjekkene flyttet | :1709 og :2378 |
| 4.1-8 | `profile-certificate-link.spec.ts` slettet | `profile-stats-1138.spec.ts` («Beståtte kurs», nå med `target="_blank"`), `profile-locale-switch.spec.ts` (en-GB) |
| 4.1-9 | `participant-course-list-grouping` «funn A» slettet, linje/båt tatt ut av :123 | `course-progress-boat-1137.spec.ts` (fullført 5 av 6, nå med `--done`, lenke, grønn, ingen båt; kontrollen «i gang er ikke grønn» flyttet dit) |
| 4.1-10 | `participant-section-reader.spec.ts` slettet | `participant-section-advance.spec.ts` «#929: siste element …» (nå med `blob:`-bildet og at leseren lukkes); `participant-inline-open.spec.ts` (ingen modal) |
| 4.1-11 | `section-portability-916` :96 slettet | `content-owner-surfaces.spec.ts:103` |
| 4.1-14 | De to «utelukker hverandre»-testene er én, med alle tre parene begge veier | `admin-content-mcq-fill-1077.spec.ts` |
| 4.1-15 | Knappeteksten tatt ut av `participant-inline-open` | `participant-section-advance.spec.ts` «#924: neste element er en MODUL» |
| 2-1 … 2-8, 1.1-3 | Ny `test/removed-routes.test.ts` med 6 omdirigeringer og 2 404-er; fjernet fra `participant-console-config`, `m2-completed-modules` (ny tittel), `m2-certification-status-flow` | Tabellen |
| 2-9 | `certification-status-service` «eksporterer ingen resertifiserings-API» slettet | 404-raden i tabellen |
| 2-10 | `assessment-rules-config`: to tester om den gamle blokka er én | Den sammenslåtte testen |
| 2-11 | `results-course-export`: hele innholdet i eksportmenyen sjekkes | Samme test |
| 2-12 | `workspace-validation-accessibility:29` slettet | `participant-console-config.test.ts:281` (integrasjon) |
| 1.1-2 | `transactional-failure-injection`: døde variabler fjernet, testnavn etter det de måler | – |
| 1.1-4, 1.1-5 | `m2-content-lock-934-4a` :259 slettet; `versionAware` tatt ut av kallet i `m2-course-versions-934:253` | `m2-course-versions-934.test.ts:353` |
| 4.2-3, 4.2-5, 4.2-6, 4.2-7 | Slettet eller forenklet | `discussion-owner-notifications:138`; `m2-discussions-api:345`; `m2-content-ownership-enforcement:78` og `:116` |
| 4.3-1 … 4.3-8 | `pseudonymizationService.test.ts` slettet; to bildetester slettet; `moduleText`-kildesjekk slettet; hodesjekkene samlet i `admin-content-ui-contracts`; «state 1/2/3» slettet; personvernvarselet samlet i DOM-testen; slettedialog og `createListPage` tatt ut av ui-contracts | `pseudonymization-service.test.ts`; `mascot-check.test.ts` (pakkesjekken); `admin-content-preview-markdown.dom.test.js`; `admin-content-ui-contracts`; testene «draft only»/«published»; `admin-content-workspaces.dom.test.js`; `list-page-1046.dom.test.js` |
| 5.1-2 | `hidden-cascade-guard` leser `/static/mascot/figure.css` fra `mascots/*/figure.css`, og CSS-lappsøket går også i `mascots/` | – |
| 5.1-3 | `course-archive-entry-guard` deler på alle toppnivåfunksjoner, også de som ikke er eksportert | – |
| 5.1-4 | `admin-content-state-rail`: `updateStateRail()` må stå i kroppen til `renderPreview` | – |
| 5.1-5, 5.2-3 | `client-locale-parser-guard`: 0-oppføringen fjernet (en oppføring på 0 er nå en feil), unntaket for en fil som ikke finnes fjernet. `GULV` står, kompleksitetsrapporten leser den | – |
| 5.2-1, 5.2-2, 5.2-4 | Unntakene i `mcq-pass-rule-guard` og `role-set-guard` fjernet, `>= 0`-sjekken fjernet, `submission.assessorExpectedContent` tatt ut av lista | – |
| 5.3-1 | Regexen krever ikke lenger linjeskift | – |
| 5.3-4 | Kontroll som krever minst ett treff i `module-publish-gate-956`, `request-locale-984`, `participant-reach-guard-968`, `route-error-body-shape` | – |

**Latt stå, og hvorfor:**

- Bryteren og den gamle regelen (en annen agent): 1.1-1, 1.2, 1.3, 4.2-2 (5a3-fila), 5.2-5 (listene i
  `content-lock-write-guard` er lesere av den gamle regelen), de døde grenene i `release-2-136-dialogene` (:70-73, :118-122) og
  `test.skip` i `release-2-136-regelen-per-kurs`.
- Usikre rader: 1.1-6, 1.1-7, 3.1 `maal-1135`, 4.1-3, 4.1-4, 4.1-5, 4.1-12, 4.1-13, 4.2-1, 4.2-4, 4.2-9, 4.3-9, 5.3-2.
- Sikre, men ikke sletting eller sammenslåing: sperre for `manuell-934-versjonsvalg-ui` (skriver på stage uten sperre), lista i
  `scripts/test/stage-release-report.mjs`, og 5.3-3 («la være»).
- 4.2-8 (tre rundturer eksport → import i én): en sammenslåing av integrasjonstester som ikke kunne kjøres nå.

**Ikke kjørt, må kjøres før sammenslåing** (testdatabasen var i bruk): `test/removed-routes.test.ts`,
`participant-console-config`, `m2-completed-modules`, `m2-certification-status-flow`, `m2-content-lock-934-4a`,
`m2-course-versions-934`, `m2-discussions-api`, `m2-content-ownership-enforcement`, `content-read-open-by-decision`. De er
typesjekket med `npm run build`.

**Mutasjoner** (kopi, feil, kjør, gjenopprett fra kopien, `git status`): `shell-undefined-names-guard` (udefinert navn i
`results.js`; omdøpt fil i lista; `tsc` uten `--listFiles` gir 13 røde), `hidden-cascade-guard` (en display-regel i
`mascots/seilbat/figure.css` som slår `#orphanedDraftTexts[hidden]`: rød nå, grønn med den gamle vakta; en `[hidden]`-lapp i
`figure.css`: rød), `course-archive-entry-guard` (kallet flyttet fra `writeCourseItems` til `setCourseItems`: rød),
`role-set-guard` (`roles.includes` i `authorization.ts`), `mcq-pass-rule-guard` (`percentScore >= 50` i `decisionService.ts`),
`admin-content-state-rail` (kallene fjernet fra `renderPreview`), `request-locale-984` (reserven skrevet om i hjelperen: kontrollen
rød), `page-title` (rå nøkkel i `review.html`: tre røde), `stage-minst-versjon` (uten formsjekken: rød).

**Tid** (denne maskinen, ett mål før og ett etter, samme dag; enkeltmål, så veggtiden varierer med lasten på maskinen):

| Suite | Før | Etter |
|---|---|---|
| Enhet (`test:unit`), veggtid | 77,0 s, 252 filer, 3 133 tester | 50,8 s, 252 filer, 3 131 tester |
| `shell-undefined-names-guard` alene | 38,1 s | 1,5–3,1 s |
| E2e (port 4391, 4 arbeidere), veggtid | 164,0 s, 113 filer, 912 tester | 154,4 s, 111 filer, 888 tester |
| E2e, sum testtid | 587 s | 547 s |
| Integrasjon | ikke målt | ikke målt; 24 filer færre (~22 s i CI-loggen) |

Ord brukt i dokumentet:

- **Bryteren:** innstillingen `module_pass_per_course` fra #934. Den er på i prod og på stage, og skal aldri slås av igjen
  (`src/modules/course/modulePassSwitch.ts:7-8`, `doc/DESIGN_934.md`).
- **Den gamle regelen:** reglene for bestått som gjaldt før bryteren ble slått på.
- **Kildetest:** en test som leser kildekoden som tekst og feiler hvis et mønster finnes eller mangler. I koden heter de ofte
  «vakt» (`*-guard.test.js`).
- **Sikker / usikker:** «sikker» betyr at beviset er sjekket i koden. «Usikker» betyr at noe gjenstår, og det står hva.

## Sammendrag

### Konklusjon først

1. **21 stage-skript måler ingenting i dag.** Den første testen i hver fil krever en bestemt gammel versjon, for eksempel
   `expect(json.version).toBe("2.127.0")`. Fila kjører i serie (`mode: "serial"`), så når den første testen feiler, hopper
   Playwright over resten. Mot 2.145.0 gir hver fil én rød test og ingen målinger. Se avsnitt 3.
2. **`release-2-136-dialogene.spec.ts` får nytt versjonsnummer ved hver release av samme grunn.** 14 release-commits på rad har
   bare endret linje 90 og 93. Forslag: én felles hjelpefunksjon som krever *minst* en versjon, ikke nøyaktig. Se avsnitt 3.2.
3. **Integrasjonstestene kjører med bryteren AV.** Ingen oppsett eller seed skriver bryteren. Bare to filer slår den på. Det betyr
   at kursfremdrift og kursbevis i de fleste integrasjonstestene måles med den gamle regelen, som prod ikke bruker. Dette er det
   viktigste relevansfunnet, men det er ikke en sletting. Se avsnitt 1.2.
4. **Den gamle regelen finnes fortsatt i koden.** Testene av den er derfor ikke døde, selv om bryteren aldri skal av. De kan
   slettes **sammen med** koden, i én endring. Det er en egen beslutning for produkteier. Se avsnitt 1.3.
5. **Lite av testtiden går til overflødige tester.** De største tidsgevinstene er tre konkrete ting: én kildetest som starter
   TypeScript-kompilatoren 13 ganger (27 s lokalt), 24 kildetester som kjører både i enhets- og integrasjonskjøringen (~22 s), og
   de gamle regel-testene (~15 s, bare hvis koden fjernes).
6. **Utenfor oppdraget, men viktig:** e2e-jobben i CI har feilet i alle 72 kjøringer siden 2026-10-27. I den siste (2.145.0)
   stopper den ved installasjonen av Chromium: «Playwright does not support chromium on ubuntu26.04-x64» (Playwright 1.59.1).
   E2e-testene kjører altså bare lokalt nå. Jeg har bare sjekket årsaken i den siste kjøringen.

### Hva produkteier må avgjøre

- **A.** Slette de fem stage-skriptene som tester oppførsel som ikke finnes lenger (avsnitt 3.1, «slett»), og bytte
  versjonslåsen i de andre ut med en «minst»-sjekk (avsnitt 3.2)?
- **B.** Slå bryteren på i oppsettet for integrasjonstestene, slik at de måler regelen prod bruker (avsnitt 1.2)?
- **C.** Fjerne den gamle regelen fra koden, og testene av den i samme endring (avsnitt 1.3)? Dette er den største oppryddingen,
  og den er tverrgående, så den bør planlegges for seg.
- **D.** Resten av radene (sletting av dobbeltdekning, sammenslåing av fraværstester, retting av kildetester) kan tas som én
  ryddesak.

### Antall kandidater per type

| Type | Avsnitt | Slett | Slå sammen | Forenkle | Behold, men merk | Sum kandidater |
|---|---|---|---|---|---|---|
| 1. Tester av fjernet eller erstattet funksjonalitet (utenom stage) | 1 | 1 | 2 | 4 | 9 (den gamle regelen) | 16 |
| 2. Tester som bare bekrefter at noe er borte | 2 | 2 | 10 | 0 | 0 | 12 |
| 3. Stage-skript | 3 | 6 | 1 | 20 | 0 | 27 |
| 4. Dobbeltdekning | 4 | 13 | 15 | 6 | 0 | 34 |
| 5. Kildetester som har mistet formålet helt eller delvis | 5 | 1 | 0 | 13 | 0 | 14 |
| **Sum** | | **23** | **28** | **43** | **9** | **103** |

En rad i tabellene kan gjelde én test, flere tester i én fil eller en hel fil. Tallene over teller rader.

### Anslått tid spart per full runde

Målt 2026-11-08 på denne maskinen (Windows, 8 kjerner), bortsett fra integrasjon (se under).

| Suite | Filer | Tester | Tid i dag | Anslått besparelse | Hvor besparelsen kommer fra |
|---|---|---|---|---|---|
| Enhet (`test:unit`) | 252 | 3 133 | 63,5 s | 10–20 s | `shell-undefined-names-guard` kjører `tsc` én gang i stedet for 13 (fila tar 27,3 s) |
| DOM (`test:dom`) | 15 | 109 | 6,4 s | 0 s | Ingenting å hente |
| E2e (`test:e2e:admin-content`, 4 arbeidere) | 113 | 912 | 150 s | ~10 s | Dobbeltdekning og like sjekker på 390 og 360 px (~35 s testtid fordelt på 4 arbeidere) |
| Integrasjon (CI-loggen for 2.145.0) | 181 | 1 232 | ~447 s | 25–45 s | 24 kildetester kjører også her (~22 s), dobbeltdekning (~5 s), den gamle regelen (~15 s, bare hvis koden fjernes) |
| Stage | 45 | – | ikke målt | – | Krever stage. 21 filer stopper i dag etter første test, så de koster lite tid nå |
| **Sum lokal runde** | | | **~11 min** | **~45–75 s (7–11 %)** | |

Hvordan det ble målt:

- **Enhet og DOM:** `vitest run --reporter=json` med `vitest.unit.config.ts` og `vitest.dom.config.ts`. Alle grønne.
- **E2e:** `playwright test --config playwright.admin-content.config.ts --reporter=json`, på port 4391 (`ADMIN_CONTENT_E2E_PORT`) så
  den ikke kolliderte med en annen tjener. 912 av 912 grønne.
- **Integrasjon er IKKE kjørt lokalt**, siden testdatabasen kan være i bruk av en annen jobb. Tallene er hentet fra loggen til
  CI-jobben `verify` for 2.145.0-commiten (kjøring 42503343943, 2026-11-08, Linux). Den jobben kjører `npm test`, som tar alle
  filene i serie. Tid per fil er avstanden mellom tidsstemplene på to etterfølgende fil-linjer i loggen, altså medregnet
  innlasting av koden. Lokalt, med `test:integration`, ser tallene trolig annerledes ut. Måling lokalt bør gjøres senere, når
  databasen er ledig.

**En observasjon om integrasjonstiden:** av de ~447 sekundene går ~211 til å laste inn koden for hver fil, ikke til selve testene
(~236 s). Det er rundt 1,2 s per fil, og 110 av de 181 filene tar under 2 s totalt. Å slå sammen små filer sparer altså mer enn å
slette enkelttester. Å endre hvordan vitest isolerer filene, kan spare mer, men det kan gi tester som påvirker hverandre. Det er
ikke tatt med i anslaget.

### De ti kandidatene med størst gevinst

| # | Kandidat | Gevinst | Avsnitt |
|---|---|---|---|
| 1 | 21 stage-skript med versjonslås måler ingenting: bytt til «minst»-sjekk, og slett de fem som tester borte oppførsel | Relevans: stage-runden tester igjen det den ser ut til å teste | 3 |
| 2 | `release-2-136-dialogene.spec.ts`: felles «minst»-sjekk i stedet for å skrive inn versjonen | Én commit-linje mindre per release, og ingen stille hull om den glemmes | 3.2 |
| 3 | Slå bryteren på i oppsettet for integrasjonstestene | Relevans: testene måler regelen prod bruker | 1.2 |
| 4 | `test/unit/shell-undefined-names-guard.test.js`: én `tsc`-kjøring for alle 13 filene, og feil hvis en fil mangler | 27,3 s → ~3 s, og fjerner en blindsone | 5 |
| 5 | Ta de 24 kildetestene ut av `vitest.integration.config.ts` (de kjører allerede i `test:unit`) | ~22 s per integrasjonskjøring | 4.4 |
| 6 | Fjern den gamle regelen og testene av den i én endring | ~15 s integrasjon, og mindre kode å forstå | 1.3 |
| 7 | `test/e2e/locale-surface-contract-1044.spec.ts`: slå sammen «lasting» og «språkbytte» for hver av de 8 flatene | 8 sidelastinger | 4.1 |
| 8 | `page-title.spec.ts` og `deltakere-subnav-keys-1096.spec.ts` laster de samme 9 sidene | ~10 s testtid | 4.1 |
| 9 | Én tabell for fjernede ruter (6 omdirigeringer og 2 404-er) i stedet for spredte tester | Oversikt, og én fil mindre å laste | 2 |
| 10 | Rett kildetestene som er blinde eller har utdaterte unntak (`hidden-cascade-guard`, `course-archive-entry-guard`, `client-locale-parser-guard`, `mcq-pass-rule-guard`, `role-set-guard`) | Testene beskytter igjen det de sier | 5 |

---

## 1. Tester av funksjonalitet som er fjernet eller erstattet

Utenom stage-skriptene (avsnitt 3) og kildetestene (avsnitt 5).

### 1.1 Funksjonalitet som er borte

Først de konkrete eksemplene fra oppdraget:

| Eksempel | Finnes det fortsatt? | Tester som bruker det |
|---|---|---|
| `GET /api/modules/completed` (fjernet i 2.141.0) | Nei. Stien gir 404 (`doc/VERSIONS.md:63`). Kommentarer i `src/modules/module/moduleCompletionPolicyService.ts:6` og `public/profile.js:710` | Ingen e2e-mock bruker den. `test/m2-completed-modules.test.ts:140-146` sjekker 404 (rad 1.1-3) |
| «Fullførte»/«Fullførte moduler» i deltakerkonsollen (fjernet i 2.126.0) | Nei. `/participant/completed` omdirigerer med 301 (`src/app.ts:151-153`) | Ingen test bruker fanen. `completedModules` i e2e er en kolonne i kursrapporten og lever. 301-en testes i `test/participant-console-config.test.ts:142-147` (avsnitt 2) |
| `versionAware` (fjernet i 2.131.0) | Skjemaet godtar fortsatt feltet, men det betyr ingenting (`src/routes/adminCourses.ts:93-95`) | Rad 1.1-4 og 1.1-5 |
| `outcome.js` på profilen | `public/static/outcome.js` finnes og brukes av seks andre klientfiler. Profilen bruker den ikke lenger (`public/profile.js:33`) | Ingen test påstår at profilen bruker den. `test/unit/outcome-derivation.test.js` og `test/unit/settled-submission-allowlist.test.ts` gjelder levende kode. Bare kommentaren i `test/outcome-derivation-guard.test.js:11` er utdatert |
| Den gamle regelen | Finnes fortsatt, bak bryteren (`src/modules/course/moduleCredit.ts:222`) | Avsnitt 1.3 |

| # | Fil | Hva den tester | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/e2e/admin-content-publish-revision-997.spec.ts` (3 tester) | Den gamle #997-dialogen ved publisering av modul. Testen mocker ikke `publish-preview-versioned`, så klienten faller tilbake til den gamle dialogen (`public/static/admin-content-publish.js:460-462`) | `test/e2e/admin-content-module-publish-934-5b.spec.ts:86` og `:99` tester den samme gamle dialogen for «gammel server (404)» og «bryteren av (409)»: tallet, at «Ja» sender `true`, og at ingen bestått gir ingen dialog. «Nei» (997:72) har ingen eksakt makker; 5b:109 sender `false`, men fordi bryteren går av, ikke fordi forfatteren svarer «Nei» | Slå sammen: flytt «Nei»-testen inn i 5b-fila, slett resten | Sikker for to av tre. Usikker for «Nei» |
| 2 | `test/unit/transactional-failure-injection.test.ts:29, :38, :282, :290, :356, :471` | Variablene og testnavnene `createOverrideDecision`/`createResolutionDecision` | Funksjonene er fjernet i 2.133.0 (`doc/VERSIONS.md:240`), ingen treff i `src/`. Variablene sendes ikke til noen `vi.mock`. Testene måler at `assessmentDecisionCreate` feiler | Forenkle: fjern variablene, gi de to testene navn etter det de måler | Sikker |
| 3 | `test/m2-completed-modules.test.ts:15, :140-146` | Testnavnet «…exposes it in the completed endpoint» og en 404 for den fjernede stien | Endepunktet fjernet i 2.141.0 (`doc/VERSIONS.md:63`). 404-en kommer fordi `/:moduleId` ikke finner en modul som heter «completed». Delen om `participantStatus` (:106-123) lever | Forenkle: nytt testnavn, flytt 404-en til fraværstabellen (avsnitt 2) | Sikker |
| 4 | `test/m2-content-lock-934-4a.test.ts:259-270` | `versionAware: true` ignoreres og gir `400 course_version_required` | `test/m2-course-versions-934.test.ts:353-367` løkker over både `{}` og `{versionAware: true}` og sjekker det samme | Slett | Sikker |
| 5 | `test/m2-course-versions-934.test.ts:253` | Sender `versionAware: true` uten at testen trenger det | Feltet har ingen virkning (`src/routes/adminCourses.ts:93-95`) | Forenkle: fjern feltet fra kallet | Sikker |
| 6 | `test/me-stats-1138.test.ts:205-211` | Den gamle bildeadressen `/static/boat/` virker | Aliaset finnes fortsatt (`src/modules/mascot/mascotPack.ts:280, :342`). `test/unit/mascot-fasit-assets.test.ts:40-44` henter bildene gjennom appen, og `test/unit/mascot-pack.test.ts:72-73, :83` sjekker forsøk på å gå ut av mappa | Slå sammen: legg adressen inn i lista på `:222`, slett testen | Usikker: jeg har ikke sjekket at fasit-testen bruker `/static/boat/` og ikke bare `/static/mascot/` |
| 7 | `test/module-completion-policy.test.ts` (én påstand) | Konfigurasjonen for fullførte innleveringer | `test/m2-completed-modules.test.ts:110-112` dekker det samme gjennom ruta, men trenger Postgres | Behold. Fila er billig og kjører i enhetsporten, der integrasjonstesten ikke kjører | Usikker |

### 1.2 Integrasjonstestene kjører med bryteren av

| Fil | Hva den tester | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|
| Hele integrasjonssuiten (`test/*.test.ts`) | Kursfremdrift, kursbevis, rapporter og publisering | Ingen seed eller oppsett skriver `module_pass_per_course` (søk i `prisma/`, `scripts/`, `vitest.integration.config.ts`). Bare `test/m2-module-pass-per-course-934-5a3.test.ts:40` og `test/m2-module-credit-934-5a2.test.ts:999` slår den på. Uten raden gjelder den gamle regelen (`src/modules/course/modulePassSwitch.ts:17-20`: «Alt annet, og ingen rad, er den gamle regelen») | Forenkle: slå bryteren på i oppsettet for integrasjonstestene. Bare testene i 1.3 skal ha den av | Sikker på funnet. Usikker på hvor mange tester som blir røde når bryteren slås på. Det er nettopp det som må måles |

### 1.3 Den gamle regelen: testene lever så lenge koden lever

Koden for den gamle regelen finnes fortsatt:

- `src/modules/course/moduleCredit.ts:161-180, :219-222` (`readModuleStatusRule`);
- `src/modules/adminContent/adminContentCommands.ts:1022, :1042-1060` (skriver `SUPERSEDED` og #997-e-posten);
- `src/modules/course/coursePublishService.ts:538, :713, :729, :749-750, :774-795`;
- `src/modules/course/versionedPublishService.ts:121, :179` og `src/routes/adminContent.ts:1096, :1144` (`409 module_versioning_not_active`);
- klientens reserveveier: `public/static/admin-content-publish.js:460-491` og `public/static/admin-content-courses.js:675, :746-754`.

Testene under måler bare veien med bryteren av. **Anbefaling for alle: behold nå, slett sammen med koden.** Sikkerhet: usikker,
fordi koden finnes. En mutasjon kan vise hvilke tester som avhenger av den gamle regelen: la `isModulePassPerCourseOn`
(`modulePassSwitch.ts:19`) alltid gi `true`, og se hvilke som blir røde.

| # | Fil | Hva den tester | Bevis for at det bare gjelder bryteren av | Merknad |
|---|---|---|---|---|
| 1 | `test/m2-module-pass-per-course-934-5a3.test.ts` | Kontrolltestene «bryteren av» (:321, :362, :456, :487, :603, :609, :1072, :1217, :1314), og blokkene :1008-1038 og :1336-1363 | Alle fire nye endepunkter gir `409 module_versioning_not_active` bare med bryteren av | :1352 dobler også `test/m2-module-revision-supersedes-997.test.ts:124, :138, :152` |
| 2 | `test/m2-module-revision-supersedes-997.test.ts:112, :124, :138, :152, :232` | At `SUPERSEDED` skrives | Skrivingen skjer bare med bryteren av (`adminContentCommands.ts:1022`) | Behold testene for lesing (:166, :199, :218): prod har fortsatt gamle `SUPERSEDED`-rader |
| 3 | `test/m2-course-publish-pending-versions.test.ts:126, :145, :168, :193` | Den gamle veien med ett revisjonssvar | Med bryteren på dekkes det av `test/m2-module-pass-per-course-934-5a3.test.ts:1140-1217` | |
| 4 | `test/e2e/admin-content-course-publish-pending.spec.ts:58, :87` | Den gamle dialogen for «Publiser nye versjoner» | Overlapper `test/e2e/admin-content-course-pending-934-5b.spec.ts:242-252, :254-269` | Resten av fila (:96, :109, :126, :138, :146) er generisk |
| 5 | `test/unit/course-certificate-gate-invariant.test.ts` (hele fila) | Porten for kursbevis | `platformConfig` er null (:60-63), så testen bruker `readModuleStatusRule`. Med bryteren på dekkes gamle DUE- og EXPIRED-rader av `test/m2-module-credit-934-5a2.test.ts:815` | |
| 6 | `test/m2-module-credit-934-5a2.test.ts:678-1007` (~20 tester) og `:1009-1088` | Tilbakefylling og sammenligningsrapport | Tilbakefyllingen nekter å kjøre med bryteren på (`src/modules/course/moduleCreditBackfill.ts:103-107`), altså ikke i prod eller på stage | Trengs bare hvis et nytt miljø skal starte uten bryteren. Produkteier avgjør |
| 7 | `test/m2-module-credit-934-5a2.test.ts:144-300` | Hovedversjon via den gamle avkrysningen | Avkrysningen gir `409 client_outdated` med bryteren på (`adminContentCommands.ts:1022-1024`) | |
| 8 | `test/unit/outbox-service.test.ts:127-130` | Levering av #997-e-posten | E-posten legges bare i køen med bryteren av | |
| 9 | Reserveveiene i klienten: `test/e2e/admin-content-module-publish-934-5b.spec.ts:84-145`, `test/e2e/admin-content-course-pending-934-5b.spec.ts:241-290`, `test/unit/module-pass-switch-934-5a3.test.ts:60`, `test/e2e/participant-course-retake-934-5a3.spec.ts:295` | Klienten faller tilbake til gammel dialog ved 404/409 | Behold så lenge reserveveien i klienten finnes | Kommentaren i 5b-fila på :6 («bryteren er av i alle miljøer») er utdatert |

---

## 2. Tester som bare bekrefter at noe er borte

Forslag: **én tabellstyrt integrasjonstest for fjernede ruter**, for eksempel `test/removed-routes.test.ts`. Hver rad har metode,
sti, forventet status og eventuelt `location`. Alle omdirigeringene finnes i `src/app.ts:151-243`.

| # | Fil | Hva den tester | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/participant-console-config.test.ts:127-132` | `/admin-content/classes` gir 301 | `src/app.ts:151-243` | Slå sammen i tabellen | Sikker |
| 2 | `test/participant-console-config.test.ts:134-139` | `/calibration` gir 301 | Samme | Slå sammen | Sikker |
| 3 | `test/participant-console-config.test.ts:142-147` | `/participant/completed` gir 301 | `src/app.ts:151-153` | Slå sammen | Sikker |
| 4 | `test/participant-console-config.test.ts:166-170` | `/admin-content/advanced` gir 301 | `src/app.ts:182` | Slå sammen | Sikker |
| 5 | `test/participant-console-config.test.ts:174-178` | `/admin-content/module/:id/advanced` gir 301 | `src/app.ts:193` | Slå sammen | Sikker |
| 6 | `test/participant-console-config.test.ts:180-184` | `/admin-content?moduleId=` gir 301 | `src/app.ts:151-243` | Slå sammen | Sikker |
| 7 | `test/m2-completed-modules.test.ts:142-146` | `GET /api/modules/completed` gir 404 | `doc/VERSIONS.md:63` | Slå sammen (én rad) | Sikker |
| 8 | `test/m2-certification-status-flow.test.ts:133-139` | `POST /api/reports/recertification/reminders/run` gir 404 | Resertifisering fjernet (#989) | Slå sammen | Sikker |
| 9 | `test/unit/certification-status-service.test.ts:207-213` | Modulen eksporterer ikke de gamle funksjonene | Ingen vei tilbake uten at noen skriver dem på nytt | Slett | Sikker |
| 10 | `test/unit/assessment-rules-config.test.ts:185-187` | En nøkkel er borte fra konfigurasjonen | Behold `:191`, som tester at en gammel konfigurasjonsfil fortsatt kan leses | Slå sammen med `:191` | Sikker |
| 11 | `test/e2e/results-course-export.spec.ts:77-85` | «Kurs-deltakere» er borte fra eksportmenyen (2.141.0) | Testen teller også 5 valg, så den er en kontroll av hele menyen | Slå sammen: én test som sjekker hele innholdet i menyen | Sikker |
| 12 | `test/workspace-validation-accessibility.test.js:29` | `selectedModuleGuidanceText` er borte | Samme sjekk i `test/participant-console-config.test.ts:281` | Slett i `workspace-validation-accessibility` | Sikker |

Linjer **inne i** tester som ellers tester noe som lever, er ikke tatt med som kandidater. De er billige: for eksempel
`test/participant-console-config.test.ts:229, :281-289, :306`, `test/e2e/participant-course-sequence.spec.ts:121` og
`test/e2e/profile-stats-1138.spec.ts:281, :297`.

Kildetester som sjekker at gamle navn er borte, står i avsnitt 5.3.

---

## 3. Stage-skriptene

### 3.1 Fil for fil

Klasse: **a** = tester nåværende oppførsel som kan bryte igjen. **b** = engangsskript for en gammel release, dekket andre steder.
**c** = tester oppførsel som ikke finnes lenger.

«Lås» betyr at den første testen krever nøyaktig én versjon. Fordi fila kjører i serie, hoppes resten over når låsen feiler
(`test.describe.configure({ mode: "serial" })`). `retries: 1` (`playwright.stage.config.ts:25`) kjører den én gang til.

**Filer som ikke hører til én release**

| Fil | Hva den tester | Klasse | Anbefaling | Sikkerhet |
|---|---|---|---|---|
| `deployed-surface.spec.ts` | Uinnlogget: `/version`, helse, omdirigeringer, 401 på beskyttede ruter, artefaktet stemmer med kilden. Låser bevisst ikke versjonen (:27-29) | a | Behold | Sikker |
| `release-surface.spec.ts` | Uinnlogget: strenger i klientfilene, i18n, at import krever innlogging | a | Slå sammen: 401 på import (:82-89) står også i `deployed-surface.spec.ts:58-71` | Sikker |
| `participant-contract.spec.ts` | Kurslista og kurselementene har feltene klienten leser | a | Behold | Sikker |
| `real-data.spec.ts` | Leser ekte data: sesjon, versjoner, blokkert publisering, eksport | a | Behold. :69, :99 og :222 er målinger uten terskel, ufarlige | Sikker |
| `ui-surfaces.spec.ts` | De ekte flatene: ingen rå JSON, språkbytte | a | Behold | Sikker |
| `ui-gallery.spec.ts`, `ui-gallery-forms.spec.ts` | Skjermbilder til manuell gjennomgang. Hopper over uten `UI_GALLERY_DIR` | a (verktøy) | Behold | Sikker |
| `list-rename-894.spec.ts` | `titleLocales` for ekte rader | a | Behold | Sikker |
| `skill-mcq-draw-and-review.spec.ts` | Skillets trekk og gjennomgang gjennom importen | a | Behold | Sikker |
| `maal-1135-vurdering.spec.ts` | Måling før og etter av KI-vurdereren. Hopper over uten `MAAL_1135` | b | Slett, eller flytt til `scripts/` hvis målingen skal kunne gjentas | Usikker: produkteier kan ønske å måle igjen |
| `manuell-2-138-epost-outlook.spec.ts`, `manuell-934-epost-outlook.spec.ts` | Sender e-postene til en ekte innboks. Krever `MANUELL_EPOST=1` | a (manuell) | Behold | Sikker |
| `manuell-934-versjonsvalg-ui.spec.ts` | #934 gjennom de ekte sidene: 1.0 → 2.0 → bevis → 2.1. Den beste dekningen av kursversjoner | a | Forenkle: legg på en miljøvariabel som sperrer den. I dag kjører den i `npm run test:stage` uten sperre og skriver kurs og kursbevis på stage | Sikker |

**Release-filer**

| Fil | Hva den tester | Klasse | Lås | Anbefaling | Bevis | Sikkerhet |
|---|---|---|---|---|---|---|
| `release-2-78-x` … `release-2-96-byggeklosser` (7 filer: 2.78, 2.81, 2.84, 2.88, 2.91, 2.95, 2.96) | Figurer, listene, innholdsblokker, «Oppdater kurs», aktivitet, telling, byggeklosser | a | Nei | Behold. Dette er de eneste filene i release-rapporten (`scripts/test/stage-release-report.mjs:24`) | | Sikker |
| `release-2-99-flervalg` | «Velg alle» og løkke-SVG | a | `:61` krever `"2.107.0"` | Forenkle: «minst»-sjekk | | Sikker |
| `release-2-100-ki-flervalg` | KI-plan for «velg alle» mot ekte modell | a | Nei | Behold | | Sikker |
| `release-2-101-publiser-alle` | `pending-versions` og «Publiser alle» | a | `:108` `"2.107.0"` | Forenkle: «minst»-sjekk | | Sikker |
| `release-2-102-tema` | Tema og «Mine kurs» etter tema | a | `:86` `"2.107.0"` | Forenkle | | Sikker |
| `release-2-106-rekkefolge` | «Rekkefølge»-spørsmål med KI | a | `:52` `"2.107.0"` | Forenkle | | Sikker |
| `release-2-108-hint` | `cueWarnings` | a | `:57` | Forenkle | | Sikker |
| `release-2-111-kriterier` | `rubricWarnings` | a | `:48` | Forenkle | | Sikker |
| `release-2-115-kriterier-deltaker` | Kriteriene vises for deltakeren, ikke fasiten | a | `:46` | Forenkle | | Sikker |
| `release-2-123-fyll-inn` | «Fyll inn» | a | `:52` | Forenkle | | Sikker |
| `release-2-124-finn-feilene` | `:::feil` | a | `:70` | Forenkle | | Sikker |
| `release-2-125-fyll-inn-ki` | KI lager «fyll inn» | a | `:59` | Forenkle | | Sikker |
| `release-2-126-kursliste` | Kurslista etter tema, toppmenyen, 301 for `/participant/completed`, anke på strøket modul | a | `:83` | Forenkle | 301-en finnes fortsatt (`src/app.ts:151-153`) | Sikker |
| `release-2-127-kursversjon` | Kursbevis, «høyst ett per kurs» | c | `:57` | Slett | «Høyst ett bevis per kurs» (:65-67) har ikke vært sant siden 2.129, der hovedversjon 2 gir et nytt bevis. Resten (:74) dekkes av `release-2-129` :99-115 og `release-2-133` :94 | Usikker: :65-67 feiler bare hvis testkontoen har to bevis for samme kurs |
| `release-2-128-kursversjon` | Alle kursbevis er v1 | c | `:60` | Slett | Premisset på :8 («ingen flate kan lage hovedversjon 2») er usant siden 2.129. Dekkes av `manuell-934-versjonsvalg-ui` og `test/m2-course-versions-934.test.ts` | Sikker |
| `release-2-129-kursversjon` | 1.0 → 2.0 → 2.1 via `PUT …/items` | c | `:96` | Slett | `PUT …/items` uten `expectedRevision` gir nå `409 course_form_outdated` (`src/routes/adminCourses.ts:579-583`, `src/modules/course/courseCommands.ts:30-33`). Dekkes av `release-2-132` :115-142 og `manuell-934-versjonsvalg-ui` :128-296 | Sikker |
| `release-2-130-seilbaat` | Favicon, seilbåt, grønn linje | b | `:73` | Slett | `release-2-130-1-seilbaat` er den samme fila pluss sjekkene på :135-137 | Sikker |
| `release-2-130-1-seilbaat` | Som over, med «Fullført» for skjermleser | a | `:79` | Forenkle: «minst»-sjekk | | Sikker |
| `release-2-131-innholdslaas` | `contentRevision`, gamle faner avvises | a | `:73` | Forenkle | `versionAware` på :116 er en ufarlig markør | Sikker |
| `release-2-132-epost-hovedversjon` | Antall mottakere, hoved- og mindre versjon | a | `:86` | Forenkle | | Sikker |
| `release-2-133-deltakerlaas` | `client_outdated` og versjonskonfliktene | a | `:91` | Forenkle | | Sikker |
| `release-2-134-modulversjon` | Modulnummer, `modulePasses`, gammel avkrysning gir 2.0 og `SUPERSEDED` | delvis c | `:89` | Forenkle: slett :150-179. Resten (:92-148) dekkes også av `release-2-136-dialogene` :96-130 | :150-179 forventer at avkrysningen gir 2.0 og `SUPERSEDED`. Med bryteren på gir den `409 client_outdated` (`src/modules/adminContent/adminContentCommands.ts:1022-1024`). Riktig oppførsel testes i `release-2-136-regelen-per-kurs` :147-156 | Sikker |
| `release-2-135-bryteren-av` | At alt virker som før med bryteren AV | c | `:83` | Slett hele fila | :139-155 krever `module_versioning_not_active`, :157-167 at `affectedCourses` mangler, :169-182 at avkrysningen virker. Alt gjelder bare med bryteren av (`modulePassSwitch.ts:23-29`, `coursePublishService.ts:713-715`). Det motsatte testes i `release-2-136-regelen-per-kurs` | Sikker |
| `release-2-136-dialogene` | Publiseringsvei, nummer, `pending-versions`, versjonsnummer i listene, eksport | a | `:93` `"2.145.0"` | Forenkle, se 3.2 | | Sikker |
| `release-2-136-regelen-per-kurs` | Regelen per kurs med bryteren på: én modul i to kurs, gammel avkrysning gir 409, kursbevis v2. **Den viktigste faste #934-testen på stage** | a | Nei | Forenkle: `test.skip` når bryteren er av (:112, :148, :159) bør bli en feil, siden bryteren alltid skal være på | | Sikker |
| `release-2-139-rapport` | Rekkefølgen i kursrapporten | a | Bruker «minst 2.139.0» (:30-34) | Behold. Mønsteret her er forbildet for 3.2 | | Sikker |

**Release-rapporten** (`npm run test:stage:release`) kjører bare de sju filene 2.78–2.96 som standard
(`scripts/test/stage-release-report.mjs:24`). Kommentaren på :22 («Begge utgivelsestestene») er utdatert. Forslag: la den kjøre
alle release-filene som er i klasse a, eller en navngitt liste over de faste. **Forenkle, sikker.**

### 3.2 `release-2-136-dialogene.spec.ts`: hvorfor den må endres ved hver release

- **Hvor:** `test/stage/release-2-136-dialogene.spec.ts:90` (`test("versjonen er 2.145.0", …)`) og `:93`
  (`expect(json.version).toBe("2.145.0")`).
- **Hvorfor den endres:** ingen skript krever det. Fila er den ene stage-testen dokumentasjonen peker på for #934 5b
  (`doc/VERSIONS.md:153`, `doc/DESIGN_934.md:1209, :1211`, `doc/FEATURE_SURFACE_MAP.md:241`). Den er holdt grønn ved å skrive inn
  versjonen hver gang. `git log` viser 14 release-commits på rad, fra 2.136.1 (`ab27b02a`) til 2.145.0 (`089d6570`), som endrer
  fila.
- **Hva som skjer om den glemmes:** testen på :90 feiler, og de fire testene som måler noe (:96, :107, :132, :149) hoppes over.
  Kontrollen av #934 5b måler da ingenting, og det merkes bare som én rød linje.
- **Døde grener i samme fil:** :70-73 (veien med `module_versioning_not_active`), :118-122 (`affectedCourses` mangler) og
  kommentaren på :16 («virker både med bryteren av og på»). Med bryteren alltid på er dette veier som aldri skal skje. Bevis:
  `src/modules/course/modulePassSwitch.ts:23-29`.

**Forslag:**

1. Én felles hjelpefunksjon, for eksempel i `test/stage/stageAuth.ts`, som krever **minst** en versjon og sammenligner tall for
   tall, med en lesbar feilmelding:

   ```ts
   export async function forventMinstVersjon(base: string, minst: string) {
     const { version } = await (await fetch(`${base}/version`)).json();
     const a = String(version).split(".").map(Number);
     const b = minst.split(".").map(Number);
     const diff = [0, 1, 2].map((i) => (a[i] ?? 0) - (b[i] ?? 0)).find((x) => x !== 0) ?? 0;
     expect(diff, `stage er ${version}, testen krever minst ${minst}`).toBeGreaterThanOrEqual(0);
     return version;
   }
   ```

   I dialogene blir det `forventMinstVersjon(BASE, "2.136.0")`. `release-2-139-rapport.spec.ts:30-34` gjør allerede noe lignende,
   men ser bort fra tredje siffer.
2. Bruk den samme funksjonen i alle filene med lås, med hver fils egen release som minstekrav.
3. Spørsmålet «er det riktig versjon på stage?» hører hjemme ett sted: `deployed-surface.spec.ts`. Trengs en nøyaktig sjekk, kan
   den lese `package.json` der, eller en miljøvariabel som `STAGE_EXPECT_VERSION`.
4. Fjern de døde grenene (:70-73, :118-122), slik at en avslått bryter blir en feil og ikke en stille gren.

### 3.3 Dobbeltdekning blant stage-skriptene

- **Lesekurs gir nøyaktig ett kursbevis:** `release-2-127` :74, `release-2-128` :81, `release-2-129` :99-115, `release-2-130-1` :96,
  `release-2-132` :89 og `release-2-133` :94 bygger alle samme oppsett. Forsvinner med slettingene i 3.1.
- **Versjonssjekken** er kopiert inn i 22 filer. Erstattes av hjelpefunksjonen i 3.2.

---

## 4. Dobbeltdekning

Samme oppførsel testet flere steder på samme lag. Tid for e2e er testtid fra målingen 2026-11-08; veggtiden blir omtrent en
firedel, siden fire arbeidere kjører samtidig.

### 4.1 E2e

| # | Fil | Hva som er dobbelt | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/e2e/locale-surface-contract-1044.spec.ts:258` («lasting gir lesbar tekst…») | Laster samme flate og venter på samme engelske tekst som `:270` («språkbytte følges…»). 258 legger bare til to sjekker: ingen rå `"en-GB"` og ingen `.toast--error` | Begge løkker over de samme 8 flatene | Slå sammen: flytt de to sjekkene inn i 270, før språkbyttet. Slett 258 (8 tester, 2,5 s) | Sikker |
| 2 | `test/e2e/deltakere-subnav-keys-1096.spec.ts:40` | `/results`, `/review` og `/deltakere/aktivitet` på tre språk lastes også i `test/e2e/page-title.spec.ts:41`, med nesten lik mock | Begge filene | Slå sammen: sjekk undermenyen inne i page-title-testen. Behold `/deltakere/status` for seg. Rollene må slås sammen (page-title mangler APPEAL_HANDLER). 9 tester, 9,9 s | Sikker på overlappet |
| 3 | Løkker over `[390, 360]`: `content-blocks-1079.spec.ts:214`, `figure-legible-on-phone-1079.spec.ts:96`, `participant-activity-1099.spec.ts:286`, `profile-stats-1138.spec.ts:331`, `reading-mode-1079.spec.ts:229`, `course-progress-boat-1137.spec.ts:329`, `admin-content-course-form-phone.spec.ts:38`, `admin-content-course-pending-934-5b.spec.ts:209`, `admin-content-module-publish-934-5b.spec.ts:450` | Samme sjekk for to telefonbredder | CSS-bruddpunktene i `public/` er 420, 480, 560, 600, 720, 760 og 900 px, så 360 og 390 havner på samme side av alle. For «flyter over» er 360 strengest | Forenkle: bare 360, eller bytt bredde inne i én test (`setViewportSize`). 38 tester på 390 px tar til sammen 16,8 s | Usikker for `figure-legible`, der oppsettet velges i JavaScript etter spaltebredden. Kan avgjøres med en figur med terskel mellom 360 og 390 |
| 4 | `test/e2e/course-steps-fit-phone.spec.ts:96` | Fem kombinasjoner av bredde og språk × to tester = 10 | CSS-reglene er de samme for 390, 360 og 320 | Forenkle til 320 på nb og en-GB (4 tester). 11 tester på 390/360, 5,0 s | Usikker: påstanden om tittelbredde er relativ til skjermen |
| 5 | `test/e2e/nav-fits-phone-1085.spec.ts:65` | Fire sider × `[390, 320]` for «ingenting utenfor skjermen» | 320 er strengest. Testene for linjeantall på 390 (:91, :97) er egne | Forenkle til 320 (4 tester, 1,3 s) | Usikker: kommentaren sier at feilen ble målt på 390 |
| 6 | `test/e2e/admin-content-workspaces.spec.ts:1485` | Samme mock og vei som `:1709`. Begge klikker forhåndsvisning og sjekker at ingen dialog kommer | Eneste unike i 1485: «Bearbeidet scenario» er synlig | Slå sammen: flytt sjekken til 1709, slett 1485 | Sikker |
| 7 | `test/e2e/admin-content-workspaces.spec.ts:1679` | Samme oppsett og vei som `:2378` (forhåndsvisning og tilbake) | Eneste unike i 1679: `.preview-pane--editing` | Slå sammen: flytt sjekken til 2378, slett 1679 | Sikker |
| 8 | `test/e2e/profile-certificate-link.spec.ts` (1 test) | Lenken til kursbeviset på profilen | `test/e2e/profile-stats-1138.spec.ts:272` (lenke og «Vis kursbevis») og `test/e2e/profile-locale-switch.spec.ts:80` (en-GB). Eneste unike: `target="_blank"` | Slå sammen: flytt `target`-sjekken til stats:272, slett fila | Sikker |
| 9 | `test/e2e/participant-course-list-grouping.spec.ts:195` («funn A») | Kurs som har vokst etter kursbeviset: `aria-valuenow` 100, hel linje, ingen båt | `test/e2e/course-progress-boat-1137.spec.ts:302` har samme scenario og sjekker. `grouping:123` gjentar også linje- og båtsjekkene fra `boat:61` | Slå sammen: flytt `--done` og lenkesjekken til boat:302, slett grouping:195, fjern linje- og båtsjekkene i grouping:123 | Sikker |
| 10 | `test/e2e/participant-section-reader.spec.ts:49` | «Avslutt kurset» vises, lesing registreres først etter klikket | `test/e2e/participant-section-advance.spec.ts:259` sjekker det samme. Unikt i reader: bildet blir `blob:`, og leseren lukkes | Slå sammen: flytt de to sjekkene til advance:259, slett reader | Sikker |
| 11 | `test/e2e/section-portability-916.spec.ts:96` | Seksjonsrad uten eierskap: Eksporter og Dupliser vises, rediger mangler | Ren delmengde av `test/e2e/content-owner-surfaces.spec.ts:103` | Slett | Sikker |
| 12 | `test/e2e/admin-content-workspaces.spec.ts:3966` | Publisering fra kurslista uten dialog | `test/e2e/admin-content-course-cascade-publish.spec.ts:77` er strengere. Unikt i 3966: knappen forsvinner etterpå | Slå sammen: flytt sjekken til 77, slett 3966 | Usikker: ikke sjekket om `mockCommonApis` svarer `allPublished` som standard |
| 13 | `test/e2e/admin-content-workspaces.spec.ts:2409` | Feilet oversettelse gir toast | `:1633` har samme mock. 1633 redigerer tittelen, 2409 oppgaveteksten | Slå sammen: toast-sjekken inn i 1633 | Usikker: kan avgjøres ved å fjerne toasten for tittelveien og se om 1633 blir rød |
| 14 | `test/e2e/admin-content-mcq-fill-1077.spec.ts:93` og `test/e2e/admin-content-mcq-order-1077.spec.ts:98` | Hver sitt par av spørsmålstyper som utelukker hverandre | Ingen er delmengde av den andre | Slå sammen til én tabellstyrt test med alle tre parene | Sikker, liten gevinst |
| 15 | `test/e2e/participant-inline-open.spec.ts:39` | Knappeteksten for #924 | Gjentas i `participant-section-advance.spec.ts:176` | Forenkle: fjern linja, behold testen | Sikker |

### 4.2 Integrasjon

| # | Fil | Hva som er dobbelt | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/m2-module-archive.test.ts:89` | Arkivering avpubliserer en modul som ikke er i noe kurs (7 HTTP-kall i oppsettet) | `test/m2-content-lifecycle.test.ts:219` sjekker samme regel via tjenesten. Ruta for arkivering er dekket av `m2-module-archive.test.ts:38` | Slett | Usikker: 89 går gjennom ruta, 219 gjennom tjenesten. Sikker hvis ruta bare kaller tjenesten |
| 2 | `test/m2-module-pass-per-course-934-5a3.test.ts:1289` og `:1324` | Datovindu (`dateFrom` og `dateTo`), samme tunge oppsett (`twoCoursesWithCertificates`, ~15 HTTP-kall) | Begge i samme fil | Slå sammen til én test med begge grensene | Sikker |
| 3 | `test/m2-discussions-api.test.ts:297` | Eieren varsles ved nytt spørsmål | `test/discussion-owner-notifications.test.ts:138` sjekker også antall mottakere og at bryteren for varsler virker. Kommentaren i 297 om rolle via RoleAssignment er utdatert | Slett | Sikker |
| 4 | `test/m2-discussions-api.test.ts:325` | Abonnenten varsles ved svar (via hendelse) | `test/m2-email-links-1141.test.ts:266` sjekker at den som spurte, får e-post ved svar | Slett | Usikker: de observerer ulike ting. Kan avgjøres ved å slå av varsel til abonnenter og se om bare 325 blir rød |
| 5 | `test/m2-discussions-api.test.ts:201` | Diskusjon av på et element gir 403, og ukjent element gir 404 | Første halvdel dekkes av `:345` | Forenkle til bare 404-delen | Sikker |
| 6 | `test/m2-content-ownership-enforcement.test.ts:140` | Kurslista kan leses av en fagansvarlig som ikke eier kurset | Delmengde av `:78` | Slett | Sikker |
| 7 | `test/content-read-open-by-decision.test.ts:76` | En fremmed fagansvarlig kan lese et kurs | Delmengde av `test/m2-content-ownership-enforcement.test.ts:116` | Slett | Sikker |
| 8 | `test/mcq-fill-1077.test.ts:157`, `test/mcq-multiple-1077.test.ts:131`, `test/mcq-order-1077.test.ts:166` | Tre separate rundturer eksport → import | Samme vei | Slå sammen til én rundtur med alle tre typene, behold sjekken per type | Sikker |
| 9 | `test/m2-workspace-export-import-896.test.ts:157` | Modul uten sertifiseringsnivå overlever rundturen | `test/module-export-roundtrip.test.ts:100` sjekker skjemaet | Slett | Usikker: ruta kan validere annerledes enn skjemaet |

Ser like ut, men skal beholdes (ulike veier inn): `m2-module-credit-934-5a2.test.ts:175, :183` mot
`m2-module-pass-per-course-934-5a3.test.ts:1240, :1248`; `m2-course-versions-934.test.ts:394` mot
`m2-content-lock-934-4a.test.ts:173`; `e2e/admin-section-replace-from-file.spec.ts:89` mot `e2e/section-portability-916.spec.ts:183`.

### 4.3 Enhet og DOM

| # | Fil | Hva som er dobbelt | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/unit/pseudonymizationService.test.ts` (3 tester) | Ikke funnet, allerede anonymisert, kjører | Delmengde av `test/unit/pseudonymization-service.test.ts:82, :96, :104`, som sjekker mer | Slett fila | Sikker |
| 2 | `test/unit/email-template-links-1141.test.ts:253-260` og `test/unit/course-major-version-email-934-4b.test.ts:97-115` | Bildene i e-posten er JPEG under 30 kB | `test/unit/mascot-check.test.ts:67-71, :91-95` har regelen JPEG, 600 × 200, under 30 kB (`mascotCheck.ts:36`), og bildene kommer fra pakken (`illustratedEmail.ts:33`) | Slett de to | Sikker |
| 3 | `test/unit/module-text-blocks-2-96-1.test.ts:69-72` | `variant: "moduleText"` | `test/dom/admin-content-preview-markdown.dom.test.js:59` | Slett | Sikker |
| 4 | `test/admin-content-state-rail.test.js:168-177` og `test/admin-content-ui-contracts.test.js:30-39` | Samme sjekker av skjemahodet | Begge filene | Slå sammen | Sikker |
| 5 | `test/admin-content-state-rail.test.js:206-231` («state 1/2/3») | State 1 og 3 er like hverandre og `:94-107`, state 2 er lik `:81-92` | Samme fil | Slett :206-231 | Sikker |
| 6 | `test/admin-content-ui-contracts.test.js:98-106` | `privacyNotice` i skallet | `test/dom/admin-content-workspaces.dom.test.js:81-89` | Slå sammen, behold DOM-testen | Sikker |
| 7 | `test/admin-content-ui-contracts.test.js:87-89` | Slettedialogen | `test/dom/admin-content-workspaces.dom.test.js:100-107` sjekker også teksten | Slett i ui-contracts | Sikker |
| 8 | `test/admin-content-ui-contracts.test.js:92` | `createListPage({` på listesidene | `test/dom/list-page-1046.dom.test.js:156-159` og `test/unit/content-lifecycle-1046.test.ts:51-52` | Slett | Sikker |
| 9 | `test/admin-content-ui-contracts.test.js:356-369` og `test/admin-content-translations.test.js:45` | `shell.directEdit.*` | Delvis overlapp | Slå sammen | Usikker: ui-contracts fanger også teksten «arvet fra basen» |

### 4.4 Samme filer kjøres to ganger

| Fil | Hva som er dobbelt | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|
| `vitest.integration.config.ts` | De 24 kildetestene og kontraktstestene i rota som står i `vitest.unit.config.ts` (for eksempel `content-lock-write-guard`, `course-visibility-guard`, `admin-content-ui-contracts`), kjører også i `test:integration`, siden integrasjonskonfigurasjonen bare utelukker de sju første rotfilene (`vitest.integration.config.ts:33-39`). `test:native` kjører dem dermed to ganger | `content-lock-write-guard` alene tar 16,1 s i CI og 18,5 s lokalt; de andre 23 tar til sammen ~6 s | Forenkle: legg dem til i `exclude` i integrasjonskonfigurasjonen, eller les lista fra enhetskonfigurasjonen | Sikker. Gjelder ikke `npm test` i CI, som kjører alt én gang |

---

## 5. Kildetester (tester som leser kildekoden)

Ingen kildetest er grønn i dag fordi den leser en fil som mangler. Men flere har blindsoner eller unntak som peker på noe som
er borte. Alle 16 `*-guard`-filene i rota står i `vitest.unit.config.ts`, og alle 31 rotfilene i den lista finnes.

### 5.1 Blinde eller tomme sjekker

| # | Fil | Hva den skal sikre | Problemet | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/unit/shell-undefined-names-guard.test.js` | Ingen udefinerte navn i 13 klientfiler | (a) Starter `npx tsc` én gang per fil: 27,3 s lokalt, 13,5 s i CI, den tregeste enhetstesten. (b) `:56` teller bare TS2304/TS2552. Blir en fil i lista omdøpt, gir `tsc` TS6053, og testen er grønn | Forenkle: én `tsc`-kjøring for alle filene, og feil hvis en fil mangler eller `tsc` ikke kjører. Mutasjon som viser (b): bytt en sti i lista til en som ikke finnes | Sikker |
| 2 | `test/hidden-cascade-guard.test.js:128, :362` | Skjuling taper ikke mot CSS-regler | Regexen på :128 treffer ikke `/static/mascot/figure.css` (`public/participant.html:14`, ny i 2.142.0), og søket på :362 går bare i `public/`, ikke `mascots/seilbat/figure.css` | Forenkle: ta med maskotstien | Sikker på blindsonen. I dag har `figure.css` ingenting som kan skjule noe |
| 3 | `test/course-archive-entry-guard.test.js:30` | Alt som skriver kurselementer, sjekker at innholdet kan brukes | Deler bare på `export async function`. `writeCourseItems` (`courseCommands.ts:434`, ikke eksportert) havner i `setCourseItems`, og veien `updateCourse` → `writeCourseItems` (:191) sees ikke. Grønn fordi sjekken står inne i `writeCourseItems` (:456) | Forenkle: ta med funksjoner som ikke er eksportert. Mutasjon: flytt kallet fra :456 til `setCourseItems`; testen forblir grønn | Sikker |
| 4 | `test/admin-content-state-rail.test.js:236-246` | `renderPreview` kaller `updateStateRail` | `indexOf("updateStateRail()", start)` godtar et kall hvor som helst etter funksjonen, og det finnes flere senere i fila | Forenkle: avgrens til funksjonskroppen, eller slett | Sikker |
| 5 | `test/client-locale-parser-guard.test.js:183-200` | Antallet skal ikke gå ned uten at grensa oppdateres | Eneste grense er `0` (:67), og `0 < 0` er aldri sant | Forenkle | Sikker |

### 5.2 Unntak og lister som peker på noe som er borte

| # | Fil | Unntaket | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/mcq-pass-rule-guard.test.js:41` og `:105` | `decisionService.ts` er unntatt; `:105` sjekker `>= 0` | Fila har ingen treff på mønstrene (`decisionService.ts:381-382` bruker den delte konstanten). Unntaket dekker ingenting, men slipper gjennom et senere brudd. `>= 0` måler ingenting | Forenkle: fjern unntaket og :105 | Sikker |
| 2 | `test/role-set-guard.test.js:45, :48` | Hele `config/capabilities.ts` og `auth/authorization.ts` unntatt | Ingen av filene har `roles.includes(` eller `roles.some(`; `authorization.ts:13` bruker `hasAnyRole` | Forenkle: fjern unntakene | Sikker |
| 3 | `test/client-locale-parser-guard.test.js:86` | `static/localized-text.js` unntatt | Fila finnes ikke (`public/static/localized-text.js`) | Forenkle: fjern linja | Sikker |
| 4 | `test/participant-translations.test.js:42` | Krever nøkkelen `submission.assessorExpectedContent` | Nøkkelen leses ikke noe sted i `public/` utenom oversettelsesfila (`participant-translations.js:229`) | Forenkle: fjern fra lista, og eventuelt nøkkelen | Sikker |
| 5 | `test/content-lock-write-guard.test.js:551-580, :609-617` | Lister over lesere av modulstatus | Alle oppføringene finnes i dag, men listene har ingen sjekk for oppføringer som er borte, slik `course-visibility-guard` har. Når den gamle regelen fjernes (1.3), blir `readModuleStatusRule`, `compareModuleCredit` og `rebuildModulePassesForUser` stående | Forenkle: legg til en sjekk for utdaterte oppføringer | Sikker |

### 5.3 Tester som fester eksakt kildetekst, og fraværssjekker

| # | Fil | Hva | Bevis | Anbefaling | Sikkerhet |
|---|---|---|---|---|---|
| 1 | `test/admin-content-ui-contracts.test.js:42` | Regex på linjeskift i `createFormPage({ host: moduleFormHost` | Oppførselen dekkes av `test/dom/admin-content-workspaces.dom.test.js:26-74` | Forenkle | Sikker |
| 2 | `test/admin-content-ui-contracts.test.js:395-399` | «PATCH title-ruta finnes» | Dekkes av `test/m2-list-rename-894.test.ts:64` og `test/m2-module-ownership.test.ts:101` | Slett | Usikker: de to er integrasjonstester og kjører ikke i enhetsporten |
| 3 | `test/admin-content-ui-contracts.test.js` (~15 `not.toContain`), `test/admin-content-state-rail.test.js:170-182, :192`, `test/workspace-validation-accessibility.test.js:54-55`, `test/participant-translations.test.js:73-76`, `test/unit/created-by-id-dead-963.test.ts` | Gamle navn er borte (for eksempel `openAdvancedEditor`, `writeHandoff`, `chatMessages`; kolonnene i 963 ble fjernet i 2.71.0) | Navnene finnes ikke i `src/` eller `public/` | Forenkle: samle i én tabell, eller la være. De er billige (under 0,3 s hver) | Sikker |
| 4 | `test/unit/module-publish-gate-956.test.ts`, `test/unit/request-locale-984.test.ts`, `test/unit/participant-reach-guard-968.test.ts`, `test/unit/route-error-body-shape.test.ts` | Én-sted-regler uten kontroll | Blir mønsteret eller funksjonsnavnet endret, er testene grønne uten å se noe. Målene finnes i dag | Forenkle: legg til en kontroll som krever minst ett treff | Sikker |

Mindre ting, ikke tatt med i tellingen:

- `test/dom/course-localization-failure-1037.dom.test.js:29` og `test/unit/mascot-check.test.ts:277` leter etter `"\n}\n"`. Med
  CRLF i en Windows-utsjekking finnes den ikke, og testen leser resten av fila. Testen blir bredere, ikke tom.
- Utdaterte kommentarer og titler: `test/outcome-derivation-guard.test.js:11`, `test/unit/workspace-nav-area.test.ts:12`,
  `test/unit/domain-error-codes-999.test.ts:98-110`, `test/dom/course-localization-failure-1037.dom.test.js:75` («BEGGE
  kallerne», nå én), `test/e2e/participant-course-banner.spec.ts:5`.

---

## 6. De tregeste filene

### 6.1 Enhet (lokalt, `vitest.unit.config.ts`, 63,5 s, 252 filer, 3 133 tester)

| # | Fil | Tid | Tester | Merknad |
|---|---|---|---|---|
| 1 | `test/unit/shell-undefined-names-guard.test.js` | 27,3 s | 13 | 13 × `npx tsc`, se 5.1-1 |
| 2 | `test/content-lock-write-guard.test.js` | 18,5 s | 18 | Bygger et TypeScript-program over hele `src/` (9 s for første test). Prisen for en typebevisst sjekk. Kjører også i integrasjon (4.4) |
| 3 | `test/unit/agent-authoring-produce-course-1079.test.ts` | 16,7 s | 160 | Hver test kopierer eksempelkurset og kjører alle kontrollene. Ingen dobbeltdekning funnet |
| 4 | `test/unit/svg-sanitizer-memory-1083.test.ts` | 8,9 s | 2 | Minnemåling, med vilje |
| 5 | `test/unit/mascot-preview.test.ts` | 4,4 s | 1 | Tegner alle e-poster, humør og figurtilstander |
| 6 | `test/unit/complexity-report-1055.test.ts` | 2,6 s | 1 | |
| 7 | `test/unit/mascot-check.test.ts` | 2,4 s | 18 | |
| 8 | `test/unit/admin-content-e2e-port.test.ts` | 2,0 s | 1 | |
| 9 | `test/unit/module-title-localization.test.ts` | 1,5 s | 10 | |
| 10 | `test/unit/asset-layout-variants-1079.test.ts` | 1,4 s | 58 | |
| 11 | `test/unit/skill-adjust-course-1095.test.ts` | 1,0 s | 12 | |
| 12 | `test/unit/url-crawl-service.test.ts` | 0,9 s | 8 | |
| 13 | `test/unit/source-material-pptx-notes-1103.test.ts` | 0,7 s | 1 | |
| 14 | `test/unit/agent-authoring-draw-flow-figure-1079.test.ts` | 0,6 s | 48 | |
| 15 | `test/unit/svg-sanitizer.test.ts` | 0,4 s | 72 | |
| 16 | `test/unit/agent-authoring-pptx-extract-1079.test.ts` | 0,4 s | 36 | |
| 17 | `test/unit/agent-authoring-figure-preview.test.ts` | 0,4 s | 13 | |
| 18 | `test/unit/assessment-job-runner.test.ts` | 0,4 s | 9 | |
| 19 | `test/unit/assessment-job-service.test.ts` | 0,4 s | 5 | |
| 20 | `test/environment-identifier-guard.test.js` | 0,4 s | 4 | |

Tidene er testtid per fil. Innlasting av koden kommer i tillegg, og filene kjører i parallell, så summen (98 s) er større enn
veggtiden (63,5 s).

### 6.2 DOM (lokalt, `vitest.dom.config.ts`, 6,4 s, 15 filer, 109 tester)

Alle 15 filene tar til sammen 1,3 s testtid. Den tregeste er `test/dom/admin-content-workspaces.dom.test.js` med 0,3 s. Resten:
`content-area-login-2120` 0,2 s, `content-practice-blocks` 0,2 s, `list-page-1046` 0,2 s, `content-check-feedback-pairs` 0,2 s,
`form-page-1046` 0,1 s, og de ni andre under 0,05 s hver (`drift-diff`, `section-lock-976`, `criteria-editor`,
`preview-criteria-visibility-1124`, `admin-content-preview-markdown`, `api-client-content-busy`, `api-client-formdata`,
`localized-text-helpers`, `course-localization-failure-1037`). Ingenting å hente her.

### 6.3 E2e (lokalt, `playwright.admin-content.config.ts`, 150 s veggtid, 4 arbeidere, 113 filer, 912 tester)

| # | Fil | Testtid | Tester | Merknad |
|---|---|---|---|---|
| 1 | `admin-content-workspaces.spec.ts` | 60,9 s | 108 | Fire kandidater i 4.1 (#6, #7, #12, #13) |
| 2 | `locale-surface-contract-1044.spec.ts` | 33,9 s | 34 | 4.1-1 |
| 3 | `course-progress-boat-1137.spec.ts` | 25,5 s | 21 | 4.1-3 |
| 4 | `mascot-fasit-profile.spec.ts` | 22,9 s | 2 | Én ny nettleserkontekst per humør og språk. Fasiten ble laget før flyttingen til maskotpakken (2.142.0), og må oppdateres ved hvert bildebytte (2.143.0 endret 11 forekomster). Usikker om den fortsatt trengs ved siden av `mascot-swap.spec.ts` og `profile-stats-1138.spec.ts`; produkteier avgjør |
| 5 | `admin-content-module-publish-934-5b.spec.ts` | 19,1 s | 30 | 1.3-9 og 4.1-3 |
| 6 | `page-title.spec.ts` | 14,8 s | 23 | 4.1-2 |
| 7 | `participant-ai-declaration.spec.ts` | 14,7 s | 20 | |
| 8 | `participant-seen-version-934-5a1.spec.ts` | 13,3 s | 15 | |
| 9 | `deltakere-subnav-keys-1096.spec.ts` | 13,0 s | 12 | 4.1-2 |
| 10 | `participant-result-summary-940.spec.ts` | 12,0 s | 19 | |
| 11 | `participant-section-advance.spec.ts` | 10,5 s | 16 | |
| 12 | `participant-course-retake-934-5a3.spec.ts` | 10,3 s | 9 | |
| 13 | `asset-layout-by-column-1079.spec.ts` | 10,1 s | 15 | |
| 14 | `admin-content-generate-dialog-status.spec.ts` | 9,3 s | 6 | |
| 15 | `participant-practice-blocks-1075-1076-1078.spec.ts` | 9,0 s | 13 | |
| 16 | `admin-content-course-pending-934-5b.spec.ts` | 8,8 s | 19 | 1.3-4 og 4.1-3 |
| 17 | `reading-mode-1079.spec.ts` | 8,0 s | 8 | 4.1-3 |
| 18 | `participant-activity-1099.spec.ts` | 7,9 s | 16 | 4.1-3 |
| 19 | `course-steps-fit-phone.spec.ts` | 7,8 s | 18 | 4.1-4 |
| 20 | `participant-earlier-result-2126.spec.ts` | 7,5 s | 15 | |

Testtid er summen av testenes varighet i fila. Veggtid for hele suiten er omtrent summen (542 s) delt på fire arbeidere.

### 6.4 Integrasjon (fra CI-loggen for 2.145.0, ikke kjørt lokalt)

Tid per fil er avstanden mellom tidsstemplene i loggen, altså medregnet innlasting (~1,2 s per fil). «Testtid» er det vitest
oppgir for selve testene. Tallet gjelder `npm test` i CI (Linux), som også tar med rotfilene fra enhetskonfigurasjonen.

| # | Fil | Tid | Testtid | Tester | Merknad |
|---|---|---|---|---|---|
| 1 | `test/m2-module-pass-per-course-934-5a3.test.ts` | 42,3 s | 38,5 s | 70 | `twoCoursesWithCertificates` brukes 27 ganger. 1.3-1 og 4.2-2 |
| 2 | `test/m2-learner-lock-934-5a1.test.ts` | 28,4 s | 26,7 s | 33 | Samtidighetstester med ventetid, med vilje |
| 3 | `test/m2-content-lock-934-4a.test.ts` | 27,6 s | 26,0 s | 26 | ~4 s med `pause()` med vilje. 1.1-4 |
| 4 | `test/m2-module-credit-934-5a2.test.ts` | 26,6 s | 25,0 s | 63 | 1.3-6 og 1.3-7 (~20 tester for tilbakefylling) |
| 5 | `test/m2-course-versions-934.test.ts` | 17,5 s | 15,9 s | 33 | 800 ms ventetid på :724 |
| 6 | `test/content-lock-write-guard.test.js` | 16,1 s | 15,4 s | 18 | Kildetest, kjører også i `test:unit` (4.4) |
| 7 | `test/assessment-policy.integration.test.ts` | 6,9 s | 6,5 s | 11 | |
| 8 | `test/m2-course-completions.test.ts` | 5,5 s | 3,9 s | 5 | Kjører med bryteren av (1.2) |
| 9 | `test/m2-course-replace-import-934.test.ts` | 5,1 s | 3,5 s | 3 | |
| 10 | `test/m2-appeal-flow.test.ts` | 4,8 s | 3,2 s | 2 | |
| 11 | `test/m2-course-major-email-934-4b.test.ts` | 4,6 s | 3,0 s | 25 | |
| 12 | `test/m2-course-update-import-1095.test.ts` | 4,5 s | 2,8 s | 11 | |
| 13 | `test/m2-email-links-1141.test.ts` | 4,3 s | 2,7 s | 8 | `vi.waitFor` med inntil 5 s |
| 14 | `test/m2-section-asset-layouts-1079.test.ts` | 3,8 s | 2,2 s | 50 | |
| 15 | `test/m2-content-ownership-enforcement.test.ts` | 3,5 s | 1,9 s | 13 | 4.2-6 |
| 16 | `test/m2-publish-gate-surfaces-896.test.ts` | 3,1 s | 1,6 s | 7 | |
| 17 | `test/m2-content-export-import.test.ts` | 3,1 s | 1,5 s | 11 | |
| 18 | `test/course-report-readers-1010.test.ts` | 3,1 s | 1,5 s | 1 | |
| 19 | `test/mcq-order-1077.test.ts` | 2,9 s | 1,3 s | 10 | 4.2-8 |
| 20 | `test/m2-list-lifecycle-1046.test.ts` | 2,8 s | 1,3 s | 4 | |

Integrasjonstestene bør måles lokalt med `test:integration` når testdatabasen er ledig, for å bekrefte tallene.

### 6.5 Stage

Ikke målt; det krever stage. 21 filer stopper i dag etter første test (avsnitt 3), så de koster lite tid nå. Rettes låsen
uten at de fem filene i klasse c slettes, vil stage-runden ta lengre tid enn i dag.

---

## Hvordan dette ble laget

- Grenen `testgjennomgang` fra `dev` på 2.145.0 (`089d6570`).
- Kode og dokumentasjon er lest: `CLAUDE.md`, `AGENTS.md`, `doc/VERSIONS.md`, `doc/FEATURE_SURFACE_MAP.md`, `doc/DESIGN_934.md`.
- Enhet, DOM og e2e er kjørt lokalt med json-rapport. Integrasjon er ikke kjørt; tallene er fra CI-loggen.
- Ingen mutasjoner er kjørt. Der en mutasjon kan avgjøre en usikker rad, står det i raden.
- Linjenumrene gjelder 2.145.0.
