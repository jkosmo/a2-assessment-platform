# Versions

This document tracks release versions and what each version includes.

## 1.3.38 - 2026-06-21

feat(participant): utskrivbart kursbevis ved kursfullføring (#550)

- **Nytt bevis-view:** `/certificate?id=<bevis-ID>` viser et rent, utskrivbart kursbevis (kursnavn,
  deltakernavn, fullføringsdato, sertifiseringsnivå, antall moduler, bevis-ID) med «Skriv ut / lagre
  som PDF» (`window.print()` + print-CSS — dependency-fritt).
- **Backend:** `GET /api/courses/completions/:certificateId` (eier-scopet — 404 for andres bevis).
  Ny repo-metode `findCourseCompletionByCertificateId`.
- **Lenker:** «Vis bevis» fra bevis-banneret i kursvisningen (`participant.js`) og «Vis / skriv ut
  bevis» fra «Mine kursbevis» (`participant-completed.js`).
- Feiringen (konfetti + completion-toast + bevis-banner) fra #549/#550 var allerede på plass; denne
  skiva legger til selve det visbare/utskrivbare beviset.
- **Test:** 3 nye Playwright-e2e (render, ikke-funnet, manglende id) + backend-integrasjonstest
  (eier 200 + annen bruker 404). i18n i en-GB/nb/nn. Bruker-doc: `COURSE_CERTIFICATES_GUIDE.md`.

## 1.3.37 - 2026-06-21

fix(author): regenerer-flyt følger også kilde-først-rekkefølgen (#555)

- **Bugfiks (forfatter-feedback):** «Generer nytt innhold fra kildemateriale» på en *eksisterende*
  modul spurte fortsatt om scenario **før** kildemateriale — den gamle rekkefølgen #555 skulle
  fjerne. Regen-flyten følger nå samme enhetlige rekkefølge som ny-modul-flyten: **kilde →
  scenario → (cert) → vurderingsplan**.
- `askForScenarioMode` (scenario-først) erstattet av `askForScenarioModeRegen` (scenario etter
  kilde); `startGenerateDraftFlow` starter nå på kilde-steget.
- Ekstern-LLM-handoff skjer på kilde-steget, så scenario er ennå ukjent der → defaulter til «auto»
  (ekstern LLM avgjør). Dokumentert i koden.
- **Test:** ny e2e «shell regen flow asks for source material before scenario». 32/32 admin-content
  e2e grønne.

## 1.3.36 - 2026-06-21

feat(author): samordnet samtale-rekkefølge + MCQ-only via samtale (#555)

- **#555 enhetlig forfatter-rekkefølge:** samtale-shellen (`admin-content-shell.js`) følger nå
  samme IA som Avansert-editoren (#554): **Kilde → Modultype → Innhold → Publiser**. Kildemateriale
  er nå første spørsmål etter tittel; deretter velger forfatteren modultype.
- **Modultype-steg:** nytt valg «Fritekst + flervalg» vs «Kun flervalg» rett etter kilde.
  Fritekst-grenen fortsetter inn i den uendrede scenario → cert → vurderingsplan-flyten; scenario-
  spørsmålet er flyttet til *etter* kilde (var før kilde).
- **MCQ-only via samtale:** «Kun flervalg» oppretter en `MCQ_ONLY`-modul, hopper over
  scenario/vurderingsplan/rubrikk/prompt og går rett til MCQ-generering. Lagring sender
  `assessmentMode=MCQ_ONLY` + `assessmentPolicy.passRules.mcqMinPercent` (standard 70 %, kan
  overstyres i Avansert) — ingen taskText/rubrikk/prompt.
- **Tester:** to nye/oppdaterte samtale-e2e (ny rekkefølge for fritekst, samt ny MCQ-only-samtale
  som verifiserer `MCQ_ONLY`-payload). i18n-nøkler lagt til i alle tre locales (en-GB, nb, nn).
- Regen-flyten på eksisterende moduler er uendret (beholder scenario-først-rekkefølgen).

## 1.3.35 - 2026-06-21

feat+fix(author): MCQ length-cue-deteksjon (#551) + kurs-pakke-guard i modul-import

- **#551 MCQ-lengde-cue:** ny deterministisk `detectCorrectAnswerLengthBias` flagger sett der
  fasiten er lengst i ≥70 % av spørsmålene. Koblet inn i `generateMcqQuestions` (legges i
  `validationWarnings`), generate-MCQ-ruten returnerer det i `validation.issues`, og samtale-shellen
  viser nå MCQ-kvalitets-advarsler i «MCQ klar»-boblen (tidligere ble validation-issues ikke vist).
  Prompten hadde allerede en grundig «Option parity»-regel — den deterministiske sjekken fanger når
  LLM-en likevel bryter den.
- **Import-guard:** å importere en **kurs**-pakke via «Importer modul-pakke» ga rå
  `scope_mismatch`-400. Modul-importen sjekker nå `scope` klient-side og gir en handlingsbar
  melding («Dette er en kurs-pakke. Importer den fra Kurs-siden …»).

Test: 5 nye unit-tester (lengde-bias-heuristikk), eksisterende llm-gen (44) uendret, 30 e2e, tsc rent.

## 1.3.34 - 2026-06-21

fix(content): eksport utelater rationale:null → MCQ-spørsmål uten rationale kan re-importeres (#557)

Et MCQ-spørsmål uten `rationale` ble eksportert som `rationale: null`, men import-schemaet godtok
`string|object|undefined` (ikke null) → `validation_error` ved re-import. Eksporten utelater nå
`rationale`-nøkkelen når den mangler (i stedet for null), så import (optional) godtar fraværet.
(Valgte eksport-fiks framfor å nullbar-gjøre det delte `mcqQuestionSchema`, som ville kaskadert til
MCQ-revisjons-endepunktet.)

Test: export/import-roundtrip-testen bruker nå et spørsmål **uten** rationale (regresjonsvakt).
6 roundtrip-tester grønne, tsc rent.

## 1.3.33 - 2026-06-21

fix(author+participant): MCQ-only kort-gating + kurs-cache (staging-tilbakemelding runde 4)

- **#554 kort-gating:** «Vurderingskriterier»/«LLM-prompt»/«Innleveringsskjema»-kortene + rubric/
  prompt-seksjonene vistes fortsatt ved Kun MCQ — `.content-card`/`.card`-CSS overstyrer
  `[hidden]`-attributtet. Bruker nå `style.display` (samme gotcha som `.row`/`.inline` tidligere),
  + re-applyer gatingen etter innholds-refresh. e2e utvidet til å sjekke at kort faktisk skjules.
- **Kurs-cache (D):** etter bestått modul re-lastet kurs-lista accordion med ferske «Laster…»-
  containere, men `courseDetailCache` beholdt gammel oppføring → expand hoppet over ny-henting →
  placeholder hang. `loadParticipantCourses` tømmer nå cachen.

Logget: #563 (konsistens — kurs publiseres ikke vs modul krever publisering).

Test: 30 e2e (utvidet MCQ-only-author + section-reader), 49 kontrakt/i18n, tsc rent.

## 1.3.32 - 2026-06-21

sec(ingest): lukk DNS-rebinding/TOCTOU i URL-henting (#520)

`assertSafeUrl` validerte hostnavnets IP-er på forhånd, men `fetch` gjorde sitt eget DNS-oppslag —
en angriper med kort-TTL-record kunne returnere public IP ved sjekken og privat IP ved selve
tilkoblingen (DNS-rebinding) → SSRF-bypass.

- Ny `createValidatingLookup` brukes som `connect.lookup` i en undici `Agent` (dispatcher). Det er
  oppslaget fetch faktisk kobler til med, og det re-validerer hver resolved IP (avviser private/
  metadata/loopback) ved tilkoblingstidspunktet → rebinding-vinduet lukket.
- Global `fetch` beholdes (test-mockbar) med `dispatcher`-opsjon; `assertSafeUrl` (forhånds-sjekk)
  beholdt som første lag (defense-in-depth).
- `undici` lagt eksplisitt i `dependencies` (var transitiv).

Test: 8 nye unit-tester (rebinding/metadata/IPv6/mixed/fail-closed). Eksisterende url-fetch-tester
uendret (16 grønne totalt). tsc rent.

## 1.3.31 - 2026-06-21

feat(author): avansert-editor IA — fjern nummerering + modultype på topp (#554, del 1)

Første del av den omforente forfatter-IA-en (avansert-editoren):
- **Fjernet «N)»-nummereringen** fra alle seksjonstitler (import/modul/åpne/status/rubric/prompt/
  MCQ/modulversjon/publiser + JSON-fallback) på tvers av en/nb/nn. Nummereringen var hullete
  (betinget skjulte seksjoner) og fantes ikke andre steder i UI-et.
- **«Modultype» som egen topp-seksjon** (etter status, før innhold): MCQ-only-vekslingen + terskel
  flyttet ut av «Modulversjon»-seksjonen hit. Modultype gater nå innholdet.
- **MCQ-only skjuler fritekst-innhold:** rubric- og prompt-seksjonene (rå JSON) + rubric/prompt/
  innleveringsskjema-kortene i Innholdsoversikt skjules når Kun MCQ er valgt.

Test: 30 e2e grønne (inkl. MCQ-only-author-e2e), 63 admin-content kontrakt-/i18n-tester, tsc rent.

Gjenstår av omleggingen: #555 (samtale-shell skal følge samme rekkefølge — egen runde, krever
arbeid i tilstandsmaskinen `admin-content-shell.js`).

## 1.3.30 - 2026-06-21

fix(participant): MCQ-only 409 ved innlevering + fullførings-flyt (staging-tilbakemelding runde 3)

- **#2 (409 «already completed and passed»):** rotårsak — #8 sync-sensur fullfører MCQ-only-
  innleveringen ved mcq/submit, men UI kjørte likevel auto-assessment (`/assessments/:id/run`) →
  409 mot recert-vernet. `mcq/submit` returnerer nå `assessmentComplete`; UI hopper over auto-run
  og henter resultatet direkte. Auto-start (#7) fyrer heller ikke for en allerede bestått modul.
- **#3 seksjonsleser lukkes ikke:** «Marker som lest» lukker nå leseren (forventet) + re-laster
  kurs-oversikten.
- **#3 modul-status + kurs-konfetti:** kurs-lista re-lastes nå etter bestått modul og etter
  seksjons-lesing, så status oppdateres i kursoversikten og #550-konfettien fyrer ved fullført kurs.

Test: 30 e2e grønne (oppdatert section-reader-e2e: mark-read lukker leseren), mcq-service unit +
i18n/contract grønne, tsc rent.

Note: helhetlig forfatter-IA (#554/#555) — omforent design (felles rekkefølge Samtale+Avansert,
uten nummerering, modultype på topp) er festet på issuene; implementeres som egen runde.

## 1.3.29 - 2026-06-21

fix+feat(participant): MCQ-only-bugfikser + feiring ved bestått/fullført (#549, #550, +#1/#2-fiks)

Andre runde med staging-tilbakemelding på MCQ-only:
- **#1-fiks (auto-start):** «MCQ vises direkte» fungerte ikke via kurs-stien — auto-start-hooken lå
  bare i modul-kort-klikket, ikke i `openCourseModule`. Flyttet inn i `activateParticipantModule`
  så begge stier (kort + kurs) auto-oppretter besvarelse + starter MCQ.
- **#2-fiks (layout):** seksjon 8 var visuelt entangled — MCQ-only-vekslingen + terskel grupperes
  nå i et avgrenset «modultype»-delpanel, adskilt fra fritekst-feltene. (Full omlegging kommer i
  #554 der modultype velges ved opprettelse.)
- **#549 feiring bestått modul:** konfetti (lettvekts, dependency-fri, respekterer reduced-motion)
  + «🎉 Gratulerer — du bestod!»-banner på resultatet (én gang per innlevering).
- **#550 feiring fullført kurs:** konfetti + toast når et kurs blir fullført i økten (ikke for
  allerede-fullførte kurs ved innlasting). E-post ved kurs-fullføring gjenstår (backend/ACS) —
  sporet i #550; modul-bestått sender allerede resultat-e-post.

Test: 30 e2e grønne (inkl. oppdatert MCQ-only-author-e2e), i18n-nøkkel-vakt dekker de nye nøklene,
55 kontrakt-tester. tsc rent. (Feirings-banneret er dekorativt + i18n-vakt-dekket; visuell
verifisering på staging.)

## 1.3.28 - 2026-06-21

feat(content): MCQ-only import/eksport + bruker-doc (#547, #525)

Siste #525-skive. Modul-pakker støtter nå MCQ-only-moduler ende-til-ende:
- **Eksport** (`buildModuleExportEnvelope`): kaster ikke lenger på manglende rubric/prompt for
  MCQ-only; emitter `assessmentMode` + null rubric/prompt/taskText. Bundle-select + transform
  bærer `assessmentMode`.
- **Import** (`contentImportService`): MCQ-only-gren — hopper over rubric/prompt-opprettelse,
  valgfri taskText, setter `assessmentMode`.
- **Schema:** `moduleExportPayloadSchema.activeVersion` får `assessmentMode` + gjør
  `taskText`/`rubric`/`promptTemplate` valgfrie/nullbare.
- **Bonusfiks:** `assessmentPolicy.passRules.totalMin` gjort valgfri — MCQ-only-policy setter kun
  `mcqMinPercent`, og decisionService defaulter `totalMin`. (Dette var også en latent #546-bug:
  forfatter-lagring av MCQ-only sendte policy uten totalMin → ville blitt avvist.)
- **Bruker-doc:** `doc/MCQ_ONLY_MODULES_GUIDE.md` (forfatter-guide: opprett, deltaker-opplevelse,
  sertifisering, import/eksport).

Test: ny integrasjons-roundtrip-test (MCQ-only eksport→import bevarer assessmentMode, ingen
rubric/prompt). tsc rent. Logget separat: #557 (rationale:null eksport/import-bug, pre-eksisterende).

## 1.3.27 - 2026-06-21

fix(mcq-only): UX-batch fra staging-akseptanse + deterministisk MCQ-sensur (#525-oppfølging)

Tilbakemeldinger fra forfatter-/deltaker-test av MCQ-only på staging:
- **#4 Avrunding:** MCQ-resultat viser nå skår med 2 desimaler (66.67 % i stedet for 66.666…).
- **#5 Toppmeny-rekkefølge:** content-area-nav er nå **Kurs, Moduler, Seksjoner, Kalibrering**
  (4 admin-content-sider).
- **#3 Layout:** «Kun MCQ-modul»-avkrysningen arvet full-bredde tekst-input-styling →
  checkbox-reset i avansert editor.
- **#7 MCQ direkte:** å velge en MCQ-only-modul oppretter nå besvarelsen + starter MCQ automatisk
  (ingen «Opprett besvarelse»-klikk) — MCQ vises direkte.
- **#8 Deterministisk sensur:** MCQ-only-innlevering behandles nå **synkront** i submit
  (`processSubmissionJobNow`) — ingen LLM (var allerede skippet) og ingen async-jobb/poll-venting
  → umiddelbart resultat, lavere kost.

Design-saker logget for avklaring (ikke i denne): #554 (MCQ-only som førsteklasses opprettelses-
valg), #555 (samtale-rekkefølge scenario/kilde).

Test: oppdatert Playwright-e2e (auto-start ved MCQ-only-valg). tsc rent, 30 e2e + full vitest-suite
grønn.

## 1.3.26 - 2026-06-21

feat(author): MCQ-only forfatter-UI i avansert editor (#546, #525)

Tredje #525-skive (forfatter-UI). I avansert modul-editor (steg 8):
- Ny «Kun MCQ-modul»-veksling. Når aktivert: fritekst-feltene (oppgavetekst, vurderingsregler,
  vurderingsinstruks) skjules, og en MCQ-terskel-input (default 70 %) vises.
- Lagring sender `assessmentMode=MCQ_ONLY` med kun `mcqSetVersionId` +
  `assessmentPolicy.passRules.mcqMinPercent`; ingen rubric/prompt/taskText.
- «Save bundle» (steg 5-8) hopper over rubric- + prompt-generering for MCQ-only.
- Skjuling via `style.display` (klasse-CSS `.row`/`.inline` overstyrer `[hidden]`). Nye i18n-
  nøkler (en/nb/nn): `adminContent.moduleVersion.mcqOnly`, `adminContent.help.mcqOnly`,
  `adminContent.moduleVersion.mcqMinPercent`.

Test: ny Playwright-e2e (toggle skjuler fritekst + viser terskel; lagring sender MCQ_ONLY +
mcqMinPercent=80). tsc rent, 29 e2e grønne, admin-content kontrakt-/i18n-tester grønne.

Gjenstår: import/eksport + bruker-doc (#547).

## 1.3.25 - 2026-06-21

feat(participant): MCQ-only deltaker-flyt — hopp over fritekst-steg (#545, #525)

Andre #525-skive (deltaker-UI). For moduler med assessmentMode=MCQ_ONLY:
- Modul-lesemodellen eksponerer nå `assessmentMode` til deltakeren (moduleRepository-select +
  de tre byggerne i moduleService).
- Deltaker-konsollet skjuler fritekst-feltene + ansvars-bekreftelsen og viser en kort note;
  «Opprett besvarelse» sender en tom besvarelse (ack implisitt) → rett til MCQ → resultat.
- Fritekst-moduler (FREETEXT_PLUS_MCQ) er uendret.

Detalj: ack-`<input>` har `.inline`-klasse hvis CSS overstyrer `[hidden]`, så labelen skjules via
`style.display` (avdekket av e2e-en). Ny i18n-nøkkel `submission.mcqOnlyNote` (en/nb/nn).

Test: ny Playwright-e2e (MCQ-only skjuler fritekst+ack; fritekst-modul beholder dem). tsc rent,
29 e2e grønne, i18n-nøkkel-vakt grønn.

Gjenstår: forfatter-UI (#546), import/eksport + bruker-doc (#547).

## 1.3.24 - 2026-06-20

feat(module): MCQ-only moduler — backend-fundament + sertifiserings-invariant (#525, #476)

Backend-skive (CI-verifisert, ingen UI ennå). assessmentMode-diskriminator gjør at en modul kan
være ren MCQ uten fritekst/LLM-vurdering:

- **Datamodell:** `AssessmentMode { FREETEXT_PLUS_MCQ | MCQ_ONLY }` på `ModuleVersion`
  (default FREETEXT_PLUS_MCQ → bakoverkompatibelt). `taskText`/`rubricVersionId`/
  `promptTemplateVersionId` nullbare (på ModuleVersion + AssessmentDecision). 2 expand-migrasjoner.
- **Vurdering:** `MCQ_ONLY` hopper helt over LLM-pipelinen; bestått = MCQ-score ≥ terskel
  (`assessmentPolicy.passRules.mcqMinPercent`, default **70%**, forfatter-justerbar). Egen
  `resolveMcqOnlyDecision`/`createMcqOnlyDecision` + gate i `assessmentJobService`.
- **Authoring-API:** `POST .../module-versions` tar `assessmentMode`; validering gjør fritekst-
  feltene valgfrie for MCQ_ONLY (mcqSet alltid påkrevd).
- **Sertifiserings-invariant (#476/#525):** kurs-fullføring/sertifikat utstedes kun når
  **alle moduler er bestått OG alle læringsseksjoner er lest**. Tidligere ble seksjons-lesing
  ignorert ved sertifiserings-utstedelse — nå gates det, og sjekken trigges både ved modul-
  bestått og ved at en seksjon merkes lest.

Tester: 8 nye enhetstester (MCQ-only-beslutning + validering). tsc rent, 531 unit + 28 e2e grønne,
eksisterende kurs-fullføring/deltaker-integrasjonstester uendret.

Gjenstår (egne skiver med e2e): deltaker-UI (hopp over fritekst-steg), forfatter-UI (MCQ-only-
veksling), import/eksport av assessmentMode, bruker-dokumentasjon.

## 1.3.23 - 2026-06-20

fix(participant): herd dev-konsoll-race + e2e for deltaker-seksjonsleser (#541)

- **#541:** «Last kurs» var klikkbar før `loadParticipantConsoleConfig()` hadde fylt
  identitets-skjemaet → tidlig klikk sendte tom `x-user-id` → fallback til rolleløs
  `dev-user-1` → forvirrende 403. Knappen deaktiveres nå til config er lastet, og aktiveres
  når identiteten er satt.
- **Test:** ny Playwright-e2e for hele deltaker-flyten (last kurs → utvid kurs → åpne seksjon →
  bilde-hydrering til `blob:`-URL → «Marker som lest» POST). Dekker flyten som tidligere bare
  var manuelt testet.

Kun front-end + test. `tsc` rent, 28 e2e grønne.

## 1.3.22 - 2026-06-20

fix(course): rett opp LMS-flyt avdekket ved lokal mock-testing (#540, #542) + UX/dev-tooling

Første økt med lokal full-stack-kjøring (portable Postgres + `AUTH_MODE=mock`) avdekket to ekte
feil som var usynlige på staging fordi Entra-Bearer-token skjulte dem:

- **#542 (ekte produktfeil):** `participant.js` sendte header-*objektet* (`headers()`) til
  `apiFetch`, som forventer en *funksjon*. Objektet ble tolket som `options` og alle `x-user-*`-
  headere droppet. På Entra bærer Bearer-token identiteten, så det virket; i mock-modus forsvant
  identiteten → fallback til rolleløs `dev-user-1` → 403 på `/api/courses`, `/api/modules`,
  seksjons-lesing. Fikset alle 6 kall-steder (`headers()` → `headers`).
- **#540:** seksjons-/kurs-/bibliotek-konsollene manglet `initConsentGuard` → viste rå
  `403 consent_required` i innholdsområdet i stedet for samtykke-dialogen. Lagt til på alle tre.
- **UX:** bilde-opplasting krevde manuell lagring først. Ulagret seksjon auto-lagres nå stille
  før opplasting (`persistSection({ silent })`).
- **Dev-tooling:** `localizeSectionContent` returnerer nå deterministisk stub-output i
  `LLM_MODE=stub` (lokal/CI) i stedet for å kaste, så oversett-*flyten* kan testes uten LLM.
  Nytt `npm run dev:seed:consent` forhåndsgodkjenner samtykke for alle mock-identiteter på fersk DB.

Tester (skrevet med fiksene, kjørt lokalt): Playwright-e2e for samtykke-dialog (#540) og at
deltaker-flyten sender `x-user-*` i mock-modus (#542). Static-test-serveren serverer nå
`/participant`. `tsc` rent, alle 27 e2e grønne. (Dev-konsoll-race #541 logget separat, lav prio.)

## 1.3.21 - 2026-06-19

fix(course): begrens bilde-størrelse i deltaker-leser + sticky seksjons-nav (#483 follow-up)

To funn fra staging-test:
- **Bilde-størrelse:** deltaker-leseren manglet `max-width` på bilder → de viste i full
  px-oppløsning og sprengte visningen. La til `#sectionReaderBody img { max-width:100%; height:auto }`
  (editor-preview hadde det allerede).
- **Toppmeny under redigering:** content-area-nav (Moduler/Kurs/Seksjoner) scrollet av toppen i
  den lange editor-visningen. Gjort `position: sticky; top: 0` på seksjons-siden så den blir værende.

Kun front-end (HTML/JS). `node --check` rent.

## 1.3.20 - 2026-06-19

fix(course): asset-bilder rendres nå i preview + deltaker-visning (#483)

Etter at opplastings-500-en (1.3.19) var løst, ble bildet satt inn men vist brutt: resolver-en
lager `<img src="/api/content-assets/<id>">`, men et plain `<img>` kan ikke bære Bearer/console-
auth-headerne — serve-endepunktet svarte 401 → brutt bilde. (CSP-en manglet også `blob:`.)

- Ny `hydrateContentAssetImages(root, getHeaders)` i `api-client.js`: henter hvert
  `/api/content-assets/`-bilde via autentisert `fetch` og bytter til en lokal `blob:`-URL.
  Kalles etter render i seksjons-editorens preview + deltaker-leseren.
- CSP `img-src` utvidet med `blob:` (lokalt generert av vår egen JS; ingen ekstern last-vektor).

Klient + én CSP-direktiv. Regresjonsvakt i `security-headers.test.ts` (img-src blob:). `tsc` +
`node --check` rene. App-only deploy.

## 1.3.19 - 2026-06-19

fix(course): bilde-opplasting 500 — apiFetch sendte FormData med JSON Content-Type (#483)

Bilde-opplasting feilet med 500 fordi `buildConsoleHeaders` setter `Content-Type:
application/json`, og `apiFetch` slo den inn i FormData-opplastingen. Nettleseren satte da ikke
multipart-boundary, og server-ens `express.json()` prøvde å parse multipart-kroppen som JSON →
`SyntaxError: Unexpected token '-', "------WebK"...` → 500 (før requesten nådde multer/blob).

Fiks: `apiFetch` stripper nå `Content-Type` når `body` er `FormData`, så nettleseren setter
`multipart/form-data` med boundary selv. Klient-only.

CI fanget det ikke fordi integrasjonstesten bruker supertest `.attach` (korrekt multipart) i
stedet for `apiFetch` — nettopp UI-opplastings-gapet sporet i #524.

## 1.3.18 - 2026-06-17

feat(course): bilde-opplasting i seksjons-editor — U2 fase 3 (#489)

UI for asset-opplasting (bygger på F4 backend, #483). I seksjons-editoren:
- «Last opp bilde»-knapp over markdown-feltet + skjult fil-input (PNG/JPEG/GIF/WebP).
- Krever at seksjonen er lagret først (assets knyttes til seksjons-id) — ellers melding.
- Spør om **alt-tekst** (obligatorisk, a11y), laster opp via `POST /sections/:id/assets`,
  og setter inn `![alt](asset:<id>)` på cursor-posisjon i markdown. Live-preview viser bildet
  (resolver → `/api/content-assets/<id>`).

Kun front-end (`admin-content-sections.js` + i18n). `node --check` rent. Manuell test på staging
fullfører forfatter→deltaker-bildeflyten før prod.

## 1.3.17 - 2026-06-17

feat(course): asset-opplasting backend — F4 fase 2 (#483)

Backend for bilde-/asset-opplasting til læringsseksjoner. Bygger på fase 1-infra (#483, 1.3.16).

- Ny `SectionAsset`-modell (sectionId, filename, mimeType, blobPath, sizeBytes) + migrering.
- `assetStorage.ts`: blob-backend via web-app-MSI (`DefaultAzureCredential`, ingen nøkkel) når
  `COURSE_ASSETS_BLOB_ENDPOINT` er satt; ellers **filsystem-fallback** for lokal/CI.
- `POST /api/admin/content/sections/:id/assets` (multipart via multer; mime-allowlist **uten SVG**
  pga XSS; 5 MB cap; feil → 400) + `GET .../assets` (liste).
- Privat servering: `GET /api/content-assets/:id` (ny `content_assets`-kapabilitet — alle
  autentiserte innholds-lesere) streamer blob via appen; aldri public blob-tilgang.
- Resolver: `![alt](asset:<id>)` i markdown → `<img src="/api/content-assets/<id>">` ved render
  (før sanitisering; portabelt for export/import-remapping).

`@azure/storage-blob` + `@azure/identity` + `multer` i `dependencies`. Integrasjonstest
(opplasting→liste→servering + mime-avvisning + 404) + resolver-unit-tester. `tsc` rent.
Deployes app-only etter at fase 1-infra er oppe på staging. U2-UI = fase 3.

## 1.3.16 - 2026-06-17

feat(infra): course-asset blob storage — F4 fase 1 (#483)

Infra-fundament for bilde-/asset-opplasting til læringsseksjoner. **Kun infra — ingen app-kode
bruker det ennå** (fase 2 kommer separat, app-only).

- Ny `Microsoft.Storage/storageAccounts` (`a2<env>assets<suffix>`, Standard_LRS, StorageV2) +
  privat blob-container `course-assets`.
- **MSI-only:** `allowSharedKeyAccess=false` + `allowBlobPublicAccess=false` → ingen kontonøkkel
  eller SAS finnes; web-appens system-assigned MSI får **Storage Blob Data Contributor**
  (deterministisk-GUID role assignment, betinget på `!skipRoleAssignments`). Ingenting å rotere,
  i tråd med KV-RBAC-invariantene.
- App-settings `COURSE_ASSETS_BLOB_ENDPOINT` (endpoint, ikke secret) + `COURSE_ASSETS_CONTAINER`
  på web-appen.

Full deploy (`deploy-azure.yml`). `az bicep build` rent; ARM what-if (staging + prod) kjøres og
reviewes før merge (invariant #11).

**Rollback:** revert commit → storage account + container + role assignment + app-settings
fjernes. Ingen app-kode avhenger av dem ennå, så ingen runtime-påvirkning. (Merk: en allerede
opprettet storage account med data slettes ikke automatisk av en revert — men i fase 1 er den tom.)

## 1.3.15 - 2026-06-17

sec(ingest): re-valider redirect-mål mot SSRF-policy ved URL-henting (#504)

Tetter en aktiv SSRF-bypass i `fetchUrlAsSourceMaterial`: kun den opprinnelige URL-en ble
validert, men `redirect: "follow"` fulgte automatisk redirects — en angriper kunne sende inn en
public URL som redirecter til `127.0.0.1`/intern adresse, som vi så hentet + parset (med `jsdom`
i prod). Erstattet med `redirect: "manual"` + manuell løkke som re-validerer HVERT redirect-mål
med `assertSafeUrl` før det følges, capet på `MAX_REDIRECTS = 5` (`invalid_redirect` /
`too_many_redirects`). Ny unit-test: public start-URL som 302-redirecter til loopback blokkeres
(`private_address`). 8/8 url-fetch-tester grønne.

Portering av codex-PR #504 (var basert på v1.2.2, konfliktende) rent inn på main. Restrisiko
DNS-rebinding (fetch re-resolver etter sjekken) spores som eget oppfølger-issue.

## 1.3.14 - 2026-06-17

fix(course): retest-funn — liste-overflow, import av delvise locales, oversettelse-\n + GUI-lås

Fire funn fra manuell retest:
1. **Seksjons-liste horisontal scroll:** `row-action-btn` arvet shared.css `button{width:100%}`
   → full-bredde knapper sprengte tabellen. Satt `width:auto` + flex-actions-celle.
2. **Import av kurs med seksjon feilet (#512):** seksjons-payloaden brukte `localizedTextSchema`
   (krever alle tre locales), men seksjoner har ofte delvise locales (kun nb) → union-valideringsfeil
   ved import. Byttet til `localizedTextPatchSchema` (delvis objekt OK). Round-trip-testen bruker nå
   en kun-nb-seksjon for å dekke dette.
3. **Oversettelse la inn literal `\n` (nynorsk):** prompt-instruksjonen om «escaped newlines» fikk
   modellen til å skrive backslash-n. Forenklet prompten + la til `normaliseLiteralNewlines`-
   defensiv normalisering. Engelsk var allerede OK.
4. **GUI ikke låst under oversettelse:** editor-kontroller (input/faner/lagre/tilbake/oversett)
   deaktiveres nå mens LLM-kallet pågår.

`tsc` + unit-tester (44) rene. Mark-som-lest-404: ruten er bekreftet live (401 uautentisert) — bes
retestet; kunne ikke reproduseres fra koden.

## 1.3.13 - 2026-06-16

feat(course): auto-oversettelse-assist i seksjons-editor (#514)

Eksplisitt LLM-oversettelse av seksjoner (tittel + bodyMarkdown), på linje med kurs/moduler.
Per teacher-locale-prinsippet: eksplisitt handling, forfatter ser over resultatet før lagring.

- `localizeSectionContent` + `buildSectionLocalizationPrompts` i llmContentGenerationService —
  markdown-bevarende prompt (bevarer #-overskrifter, lister, lenker, kode, {{asset:...}};
  oversetter kun lesbar tekst)
- `POST /api/admin/content/sections/localize` (rate-limited, validerer source≠target)
- Editor: «Oversett fra dette språket»-knapp fyller de andre språk-fanene fra aktivt språk;
  forfatter reviewer/redigerer før lagring
- Unit-tester for prompt-byggeren (markdown/placeholder-bevaring + felt-utelatelse)

## 1.3.12 - 2026-06-16

feat(course): export/import tar med læringsseksjoner (#512)

Tetter datatap-gapet: kurs-eksport/-import håndterte kun moduler, så seksjoner forsvant ved
overføring mellom miljøer. Nå bevares den fulle modul/seksjon-sekvensen.

- Envelope-format (additivt, bakoverkompatibelt på `v1`): valgfri `items`-sekvens med
  diskriminert MODULE/SECTION; ny `sectionExportPayloadSchema` (lokalisert title + bodyMarkdown).
  `modules` beholdt (nå valgfri) som subset for v1-importører.
- Eksport (`buildCourseExportEnvelope`): bygger `items` fra `CourseItem` i rekkefølge, inliner
  hver seksjons aktive versjons markdown; emitterer både `items` + `modules`-subset.
- Import (`importCourseFromEnvelope`): foretrekker `items` (gjenskaper seksjoner via
  `createSection` + bevarer rekkefølge via `setCourseItems`); faller tilbake til legacy
  `modules`-vei for v1-filer.
- Assets (#483/F4) ennå ikke inlinet — markdown-only foreløpig (notert i #512).

Integrasjonstest: round-trip av kurs med interleaved seksjon (eksport → import → ny seksjon
gjenskapt i rekkefølge). `tsc` + CI mot Postgres rene.

Closes #512

## 1.3.11 - 2026-06-16

fix(course): UI-polish for seksjoner etter testtilbakemelding (#488/#490/#492 follow-up)

Batch av fem tilbakemeldingspunkter fra manuell staging-test:
1. «Seksjoner»-fanen lagt til i content-area-nav på Moduler- (library) og Kalibrering-sidene
   (manglet — var kun på Kurs/Seksjoner-sidene).
2. Seksjons-liste: fjernet 720px-tak som tvang horisontal scroll; tittel-kolonne tar slakk;
   «Ny seksjon»-knapp er ikke lenger full bredde.
3. (Auto-oversettelse av seksjoner → eget issue #514; manuell per-språk fungerer, deltaker-
   fallback gjør at innhold aldri vises tomt.)
4. Kursbyggeren fargekoder nå SEKSJON-rader (blå tint) for tydelig forskjell fra MODUL.
5. Seksjons-leser: eksplisitt «Marker som lest»-knapp + «Lukk» (i stedet for auto-marker-ved-
   åpning, som var utydelig); markering oppdaterer badge + progresjon ved lukk.

Kun front-end (HTML/JS/i18n). `node --check` rent.

## 1.3.10 - 2026-06-16

feat(course): seksjons-lese-progresjon — alle elementer teller, leste seksjoner markeres (#487/#492)

Snur progresjons-modellen: kurs-progresjon teller nå ALLE elementer (moduler + seksjoner),
ikke bare moduler. Moduler "fullføres" via bestått vurdering; seksjoner markeres som lest.

- Ny modell `CourseSectionRead` (userId, courseId, sectionId, readAt) + migrering
- `markSectionRead` (idempotent upsert) + `findReadSectionIds` i repository
- `POST /api/courses/:courseId/sections/:sectionId/read` (validerer kurs-tilhørighet)
- Deltaker-kurs-detalj + liste: `progress.total` = antall elementer, `completed` = bestått
  moduler + leste seksjoner; seksjons-items får `read`-flagg
- Deltaker-UI: seksjons-rad viser «Lest»/«Ikke lest»-badge; leser-overlay markerer lest ved
  åpning og oppdaterer visningen ved lukk

`CourseSectionRead` cascade-slettes med bruker/kurs/seksjon. Integrasjonstest dekker
mark-read (idempotent) + progresjons-opptelling + COMPLETED. `tsc` + CI mot Postgres rene.

Closes #487

## 1.3.9 - 2026-06-16

fix(course): manglende i18n-nøkler for seksjons-rader i deltaker-visning (#491 follow-up)

Deltaker-visningen viste rå nøkler (`courses.section.read`, `courses.section.label`) fordi
`t()` returnerer nøkkelen når den mangler — `|| fallback` slo aldri inn. La til
`courses.section.label/read/close/loading` i alle tre locales (en-GB/nb/nn) og pekte
leser-overlayen til `courses.section.close/loading`. «0/5 moduler» er uendret og korrekt
(modul-progresjon mot sertifisering; seksjoner vurderes ikke).

## 1.3.8 - 2026-06-16

fix(course): seksjons-editor sendte tomme språk-strenger → 400 ved lagring (#488 follow-up)

Editoren sendte alle tre locales (nb/nn/en-GB) ved lagring, også de uutfylte med tom
streng. `localizedTextPatchObjectSchema` er `.partial()` men hver *tilstedeværende* nøkkel må
ha minst 1 tegn, så tomme strenger ga `too_small`-valideringsfeil (400). La til
`nonEmptyLocales()` som kun sender locales forfatteren faktisk har fylt ut, + en klient-side
guard med melding hvis verken tittel eller innhold er fylt på noe språk.

## 1.3.7 - 2026-06-16

feat(course): deltaker-visning av læringsseksjoner — P1 (#491)

Åttende skive av #476 (Tier 2 LMS, epic #478). Fullfører forfatter→deltaker-løkka.

Backend:
- Deltaker-kurs-detalj (`GET /api/courses/:id`) returnerer nå `items` — den blandede
  modul/seksjon-sekvensen i rekkefølge (modul-status bevart, seksjoner med tittel)
- Nytt `GET /api/courses/:id/sections/:sectionId` — validerer at seksjonen tilhører det
  publiserte kurset, returnerer sanitisert HTML (F3/X1) + tittel i deltakerens locale

Front-end (`participant.js`):
- Kurs-detalj rendrer den blandede sekvensen; seksjons-rader åpner en mobil-først
  leser-overlay som viser server-rendret, sanitisert innhold (fallback til modul-only)

Integrasjonstest (`m2-course-section-participant.test.ts`): seksjon i sekvensen +
sanitisert HTML (script strippet) + 404 for seksjon utenfor kurset. `tsc` + `node --check`
+ CI mot Postgres rene.

Closes #491

## 1.3.6 - 2026-06-16

feat(course): kursbygger med blandede moduler + seksjoner — U3 (#490)

Syvende skive av #476 (Tier 2 LMS, epic #478). Kurs-detalj-byggeren håndterer nå en blandet
sekvens av moduler og læringsseksjoner:
- Innholdslista viser type-badge ([MODUL]/[SEKSJON]) og deler rekkefølge/flytt/fjern-kontroller
- Ny seksjons-velger (dropdown fra seksjons-biblioteket — «velg fra bibliotek», D1-valg a)
- Lastes via `GET /courses/:id/items`, lagres via `PUT /courses/:id/items` (B2) som også
  re-synker CourseModule server-side
- Fallback til legacy modul-only-form hvis items-endepunktet mangler

Kun front-end (`admin-content-courses.js` + badge-CSS). Samtale-baserte ny-kurs-flyten er
urørt. `node --check` + `tsc` + `build` rene. Manuell testing ved staging-deploy sammen med P1.

Closes #490

## 1.3.5 - 2026-06-15

feat(course): seksjons-editor (U1) + IA-design (D1) — #488, #484

Sjette skive av #476 (Tier 2 LMS, epic #478). Første UI for læringsseksjoner.

D1 (#484): `doc/DESIGN_476_LMS_SECTIONS_IA.md` — godkjent IA + wireframes (editor=laptop,
deltaker=mobil-først, eksplisitt språk-veksling i editor, «velg fra bibliotek» for seksjoner).

U1 (#488): ny «Seksjoner»-fane (`/admin-content/sections`):
- Liste over seksjoner (tittel/versjon/sist endret) + opprett/rediger/slett
- Editor med språk-faner (nb/nn/en-GB) — forfatter redigerer hvert språk manuelt
- Side-ved-side markdown + **live forhåndsvisning** via nytt
  `POST /api/admin/content/sections/preview` som rendrer med samme F3/X1-sanitiseringspolicy
  som deltaker-visningen vil bruke (server-side, ingen klient-side render-stack)
- «Seksjoner»-lenke lagt til i kurs-sidens content-area-nav

Ren additiv UI + ett lese-endepunkt. `tsc` + `build` rene. Manuell testing følger ved
staging-deploy sammen med U3 (#490) + P1 (#491).

## 1.3.4 - 2026-06-15

feat(course): blandet CourseItem-ordering-API — B2 (#486)

Femte skive av #476 (Tier 2 LMS, epic #478). API for å sette/lese den fulle ordnede
sekvensen av et kurs — moduler og læringsseksjoner om hverandre:
- `PUT /api/admin/content/courses/:courseId/items` — sett ordnet liste (sortOrder = posisjon);
  validerer at ids finnes og at modul/seksjon ikke gjentas
- `GET /api/admin/content/courses/:courseId/items` — les ordnet liste (med tittel/arkivstatus)

`setCourseItems` re-synker `CourseModule` fra MODULE-items i samme transaksjon, så de
ikke-cutover-de lese-pathene (#502) fortsatt stemmer under expand-contract. Integrasjonstest
(`m2-course-items.test.ts`) dekker interleaved sekvens + CourseModule-synk + validering
(ukjent id, duplikat). `tsc` rent; CI kjører mot Postgres. Ren backend — bygger på F1 (#480)
+ F2 (#481).

## 1.3.3 - 2026-06-15

feat(course): seksjon-CRUD-API — B1 (#485)

Fjerde skive av #476 (Tier 2 LMS, epic #478). REST-API for kurs-læringsseksjoner under
`/api/admin/content/sections` (arver `admin_content`-autorisasjon):
- `POST /` opprett (title + bodyMarkdown, begge lokaliserte) → seksjon + v1
- `GET /` liste, `GET /:id` detalj (med aktiv versjons bodyMarkdown)
- `PATCH /:id/title` oppdater tittel
- `PUT /:id/content` ny innholdsversjon (immutabel, versionNo++, latest-wins)
- `DELETE /:id` (blokkeres hvis seksjonen er knyttet til et kurs)

Kommandoer i `src/modules/course/sectionCommands.ts` speiler Module/ModuleVersion-mønsteret.
Integrasjonstest (`m2-admin-sections.test.ts`) dekker create→read→list→re-version→delete +
delete-blokkering ved kurs-tilknytning. `tsc` rent; CI kjører mot Postgres. Ren backend —
ingen UI ennå (U1 #488).

## 1.3.2 - 2026-06-15

feat(course): CourseItem-polymorfi + backfill + dual-write — F1 expand-fase (#480)

Tredje skive av #476 (Tier 2 LMS, epic #478). Innfører polymorf `CourseItem`
(courseId, itemType MODULE|SECTION, sortOrder, moduleId?/sectionId?) som skal erstatte
`CourseModule`-join og la moduler + læringsseksjoner interleaves i ett ordnet forløp.

Expand-contract (trygt, reversibelt): migrering `20260615000002_add_course_item` oppretter
tabellen, backfiller hver eksisterende `CourseModule` → `CourseItem(type=MODULE)` med bevart
`sortOrder` (gen_random_uuid for id), og har en XOR-CHECK som sikrer at nøyaktig én av
moduleId/sectionId er satt per itemType. `CourseModule` beholdes urørt; `setCourseModules`
dual-writer nå MODULE-items i parallell i samme transaksjon (SECTION-items bevares ved
re-ordering). Lese-pathene er UENDRET → null regresjon på eksisterende kurs-oppførsel.

Lese-cutover (flytt alle `course.modules`-konsumenter til `CourseItem`) + drop av
`CourseModule` følger som egen contract-fase. Integrasjonstest dekker dual-write +
SECTION-bevaring; CI kjører migrering + full suite mot Postgres. `tsc` + `prisma validate` rene.

## 1.3.1 - 2026-06-15

feat(course): CourseSection + CourseSectionVersion-modeller — F2 (#481)

Andre skive av #476 (Tier 2 LMS, epic #478). Additiv datamodell for læringsseksjoner:
`CourseSection` (id, title som lokalisert JSON, activeVersionId, archivedAt) +
`CourseSectionVersion` (immutabel versjon med `bodyMarkdown` som lokalisert JSON, versionNo,
publishedBy/At) — speiler `Module`/`ModuleVersion`-mønsteret slik at historiske visninger kan
fryses mot en versjon. Håndskrevet migrering `20260615000001_add_course_section_models`.

Rent additivt (to nye tabeller + FK-er, ingen endring på eksisterende tabeller) → kan ikke
brekke eksisterende kurs/moduler. Kobles til kurs via CourseItem (#480/F1) som kommer separat;
står frittstående inntil da. Offline-verifisert: `prisma validate` 🚀, `prisma generate` + `tsc`
rent. Runtime-migrering CI-verifisert (verify-jobben kjører migrering mot Postgres).

## 1.3.0 - 2026-06-15

feat(course): markdown-sanitiseringstjeneste for læringsseksjoner — F3 (#482) + embedded-video iframe-allowlist X1 (#493)

Første skive av #476 (Tier 2 LMS — læringstekster mellom moduler, epic #478). Ny ren
tjeneste `src/modules/course/sectionContent.ts`: `renderSectionMarkdown()` renderer
SMO-skrevet markdown via `marked` og saniterer server-side med DOMPurify (jsdom) før det
når en deltaker. `sanitizeSectionHtml()` eksponerer samme policy for live-preview-bruk.

Sikkerhet: script, inline event-handlers og `javascript:`-URLer fjernes. Iframes avvises
by default; embedded video tillates KUN fra en eksplisitt HTTPS-domene-allowlist
(`ALLOWED_VIDEO_IFRAME_HOSTS`: YouTube, youtube-nocookie, Vimeo player) via en
`uponSanitizeElement`-hook. `isAllowedVideoEmbed()` validerer protokoll + host.

`marked` + `dompurify` lagt i `dependencies` (importert i prod-kode), `@types/dompurify` i
devDeps. 13 vitest-enhetstester (positive + negative), tsc rent. Ingen DB/UI ennå — rent
backend-fundament, ship-safe alene.

## 1.2.38 - 2026-06-04

fix(admin-content): «Importer kurs-pakke»-knappen åpner nå fil-velgeren også når kurslisten ikke er tom

Klikk-handleren på `importCoursePackageBtn` ble kun wiret i tom-liste-renderingen av
kurslisten. I den populerte listeveien (minst ett kurs finnes) ble kun `change`-handleren
på fil-inputen registrert, så knappen ga ingen respons ved klikk. La til samme
`click → importCoursePackageFile.click()`-binding i den populerte veien
(`public/static/admin-content-courses.js`).

## 1.2.37 - 2026-05-29

sec(frontend): participant console hardening — same-origin redirect-restore + dokumentert config-eksponering (#355)

AC1 — `auth_intended_url`-restore validerer nå at lagret URL er same-origin + intern path
før navigering, så en eventuelt forgiftet sessionStorage-verdi ikke blir en open-redirect.
Ren funksjon `isSafeSameOriginRedirect(target, currentOrigin)` eksportert fra api-client.js
med dedikert vitest-enhetstest (6/6 grønne) som dekker same-origin/positive, javascript:/
data:/vbscript:-rejection, protocol-relative + relative path-rejection, port/scheme-mismatch,
malformed input, og tom currentOrigin.

AC2 — review av `/participant/config`: responsen er allerede minimal for et pre-auth-
endpoint. Mock-only-feltene (mockRolePresets, identityDefaults) er server-side gated på
`AUTH_MODE === "mock"` → tom/undefined i produksjon. Ingen gjenværende felt kan fjernes
uten å brekke SPA-startup eller post-login workspace-rendering. Ingen kodeendringer
trengtes; konklusjonen dokumenteres.

AC3 — ny seksjon i `doc/CONFIG_REFERENCE.md` ("Public exposure of /participant/config")
med per-felt-tabell: hvorfor hvert felt må være public, hva en uautentisert leser lærer.
Default-policy ved nye felt: «default til authenticated, ikke /participant/config».

Lukker #355.

## 1.2.36 - 2026-05-27

fix(infra): kodifiser deploy-SP Key Vault Secrets User-grant i Bicep (#470, #410-durabilitet)

#410-credential-guarden trenger lesetilgang til DATABASE-URL-secreten for å avgjøre om
skipPostgresUpdate er trygt. Deploy-SP-en hadde bare control-plane-roller (ikke KV data-plane
read) → guarden fikk `kvRead=secret-read-failed` og tvang PG-server-update på hver deploy
(ServerIsBusy-risiko). En manuell staging-grant (az rest PUT) bekreftet fiksen, men forsvinner
ved RG-recreate.

Kodifiserer grant-en i `infra/azure/main.bicep`: ny ressurs `deployPrincipalDatabaseSecretReader`
gir deploy-SP-en (param `deployPrincipalId`) **Key Vault Secrets User** scopet til DATABASE-URL-
secreten (least-privilege — guarden leser kun den). Betinget på `!skipRoleAssignments && !empty(deployPrincipalId)`.
Deploy-SP-en har User Access Administrator → oppretter assignment for seg selv.

Plumbing: `deployPrincipalId` param i Bicep ← `-DeployPrincipalId` i deploy-environment.ps1 ←
`${{ vars.DEPLOY_PRINCIPAL_ID }}` i deploy-azure.yml (begge miljø-jobber). GitHub env-vars satt:
staging=36b2fabb…, production=cba285e6…. What-if-workflowene passer også param-et.

Selvheling: pre-flighten kjører FØR Bicep, så første deploy med dette tvinger fortsatt update
(rollen finnes ikke ennå); Bicep oppretter den; påfølgende deploys leser og skipper. Idempotent
re-deploy dekkes av eksisterende RoleAssignmentExists-toleranse. Dekker både staging og prod.

Oppfølging: fjern den manuelle staging-assignmenten (guid 23be1dd0…) når Bicep eier grant-en.

Rollback: revert commit (grant forsvinner → guard over-fyrer igjen, men trygt — ingen drift).

## 1.2.35 - 2026-05-27

fix(infra): App Service-settings som separate child-ressurser etter KV + role assignments (#416)

Mai-2026-rotårsak: appSettings lå inline i app-ressursenes siteConfig, så de deployet i samme
ARM-operasjon som app-en — før KV-secrets og role assignments var ferdig provisjonert. MSI-
sidecaren kunne forsøke å resolve KV-referanser før read-rollen var på plass → app crashet ved
første boot.

Fiks: appSettings for webApp, workerApp og parserApp er trukket ut til separate
`Microsoft.Web/sites/config@2023-12-01`-child-ressurser (`name: 'appsettings'`) med eksplisitt
`dependsOn`:
- webApp/workerApp → [kvSecretAppRuntime, <app>RuntimeSecretReader] (begge refererer kun
  APP-RUNTIME-SECRETS-bundelen, #431 Stage 2)
- parserApp → [kvSecretParserWorkerAuthKey, parserAppParserAuthSecretReader]

Hvorfor child-ressurs og ikke `dependsOn` på selve app-en: role assignment-en trenger
app-ens MSI `principalId`, så app-en kan ikke avhenge av sin egen role assignment (syklus).
Child-config-ressursen opprettes etter app-en (identitet finnes) og etter role assignment-en,
så KV-referanser først resolves når rollen er på plass.

Settings-arrayene er flyttet VERBATIM (ikke gjenskrevet) og konvertert til den flate mappen
config-ressursen krever via `toObject(array, e => e.name, e => e.value)` — null risiko for
tapte settings fra manuell array→map-omskriving. Ingen `connectionStrings` finnes.
dependsOn på `!skipRoleAssignments`-betingede readers er trygt (Bicep ignorerer dependsOn på
ikke-deployet betinget ressurs — gjelder dagens prod SKIP_ROLE_ASSIGNMENTS=true).

Verifisert: `az bicep build` rent, infra-lint grønn, 3/3 config-ressurser, 0 gjenværende inline
appSettings. ARM what-if (staging + prod) reviewes før merge per invariant #11.

Rollback: revert Bicep-commit (inline-appSettings = nåværende prod-state).

## 1.2.34 - 2026-05-27

fix(infra): PG pre-flight uavhengig av App Service + credential-drift-guard (#411, #410)

Begge endrer PG-pre-flight-regionen i `scripts/azure/deploy-environment.ps1`, derav én PR.

**#411** — `$existingPgServer` resolves nå før `if ($existingWebApp -and $existingWorkerApp)`,
og PostgreSQL-property-pre-flighten (som setter `$skipPostgresUpdate`) er flyttet UT av den
App Service-guarden. Tidligere ble pre-flighten hoppet over på partial teardown (PG finnes,
App Services slettet) → ubetinget server-update risikerte ServerIsBusy-lås. Kjører nå når
PG-serveren finnes, uavhengig av App Services.

**#410** — credential-drift-guard. main.bicep skriver `kvSecretDatabaseUrl` ubetinget men
oppdaterer serveren kun når `!skipPostgresUpdate`. Korrigert premiss: workflowene passer en
*fast* `POSTGRES_ADMIN_PASSWORD`-secret (ikke generert per kjøring), så drift oppstår kun ved
en passord-rotasjon som treffer skip-pathen. Fiks: skip-beslutningen leser nåværende passord
fra DATABASE-URL-secreten — hvis ønsket ≠ nåværende (rotasjon tilsiktet) tvinges server-update
så server + Key Vault endres atomisk (invariant #12); ved match er skip trygt; ved usikkerhet
tvinges update (trygg retning). Ren logikk i `deploy-environment.helpers.ps1`
(`Get-PostgresPasswordFromConnectionString`, `Resolve-PostgresSkipForCredentialSafety`) med
Pester-tester. Ingen Bicep-endring.

Rollback: revert commit. Endringen legger kun til en sikkerhets-guard (tvinger server-update
ved rotasjon/usikkerhet) — verste utfall er en retbar ServerIsBusy, aldri credential-drift.

## 1.2.33 - 2026-05-27

sec(auth): vendre MSAL lokalt + CSP/security-headers (#393)

[Security][P2] Klienten lastet MSAL fra ekstern CDN (alcdn.msauth.net) uten SRI. En
kompromittert CDN-respons ville kjørt i vår origin og kunne lest tokens / kalt API-er
som offeret.

(1) **Vendret MSAL 2.38.0 lokalt**: `public/static/vendor/msal-browser-2.38.0.min.js`
(hentet fra npm, kanonisk provenans). api-client.js `loadMsalScript()` laster nå lokalt
med SRI-integrity (sha384) + crossorigin. Ingen ekstern CDN-avhengighet ved kjøretid.
Oppdateringsprosess dokumentert i `doc/MSAL_VENDORING.md`.

(2) **Security-headers-middleware** (`src/middleware/securityHeaders.ts`, mountet tidlig
i app.ts): CSP med strikt `script-src 'self'` — mulig fordi MSAL nå er lokal og appen
har null inline-script/event-handlers. style-src beholder 'unsafe-inline' (inline
<style>/style-attrs, lavrisiko). connect/frame/form-action tillater Entra-login-origin
for MSAL silent-token/redirect. Pluss X-Content-Type-Options: nosniff, X-Frame-Options:
DENY, Referrer-Policy.

Statisk verifisert før implementering: alle scripts lokale, ingen inline-script/handlers,
all CSS lokal, ingen eksterne https-referanser, ingen ekstern fetch. blob:-nedlastinger
bruker `download`-attr (ikke CSP-styrt). test/unit/security-headers.test.ts dekker
header-kontrakten.

Akseptansekriterier #393: (a) ingen ekstern CDN ✓ (b) versjon kontrollert av vendret
asset ✓ (c) CSP begrenser script-injeksjon ✓ (d) Entra-login i alle arbeidsflater —
gjenstår brukerverifisering.

## 1.2.32 - 2026-05-24

ux(admin): handoff-dialog copy + post-publish-flyt (#361/#442 follow-up)

To uavhengige UX-forbedringer i samme batch (jf. UX-batching):

(1) **Handoff-dialog copy** (option C, brukerfeedback): «Ulagrede endringer»-dialogen
ved Avansert→Samtale brukte «gå tilbake», men brukeren startet i Avansert — misvisende
retning. Endret til retningsnøytralt:
- saveFirst: «Lagre og gå tilbake» → «Lagre og fortsett» (en: «Save and continue»)
- discard: «Gå tilbake uten å lagre» → «Fortsett uten å lagre» (en: «Continue without saving»)
- brødtekst: «blir med tilbake til samtalen» → «blir med til samtalen» (en: «carry back» → «carry over»)
Oppdatert i alle tre locales (begge translation-sett) + HTML-fallback i
admin-content-advanced.html (som dessuten lå på pre-v1.2.28-tekst).

(2) **Post-publish-flyt**: etter publisering landet brukeren i full modul-velger
(«Velg en modul»), som er en unaturlig kontekst rett etter å ha jobbet med én modul.
publishLatestDraftInBackground nullstiller ikke lenger hele konteksten + startModulePicker,
men kaller `loadModule(moduleId)` — laster modulen på nytt (nå Live) og avslutter med
showModuleActions («Hva vil du gjøre med denne modulen?»). «Velg en annen modul» er
fortsatt tilgjengelig derfra. Samme mønster som unpublishModuleInBackground.

## 1.2.31 - 2026-05-24

fix(admin): modul-detaljer-dialog viser blank tittel etter reopen (#361 follow-up)

Bruker rapporterte: «Jeg går inn i Avansert og endrer tittel fra CLS til CLS3, lukker
dialogboks, åpner dialogboks igjen. Tittel er blank.»

Rotårsak: v1.2.29 byttet applyModuleDetailsDialog til setLocalizedEditorValue så
moduleTitleInput.value inneholder bare current-locale string + dataset.localeOriginal
har hele locale-objektet. Men openModuleDetailsDialog (admin-content.js L2591) leste
fortsatt rå .value via parseLocalizedSafe — som returnerer den enkle strengen, ikke
locale-objektet. Trace med currentLocale="nb" og {en-GB:"CLS3", nb:"", nn:""}:
.value = "" (nb verdi) → parseLocalizedSafe("") = "" → alle tabs vises blanke.

Fix: ny readLocaleSrc-helper i openModuleDetailsDialog leser dataset.localeOriginal
først, faller tilbake til parseLocalizedSafe(.value) hvis dataset ikke er satt.
Symmetrisk med readLocalizedFieldValue-pattern fra save-flyten.

Version-details og prompt dialogene har ikke samme issue fordi deres apply-funksjoner
fortsatt bruker formatEditorValue (JSON-stringify i .value) — de leser .value
direkte og det fungerer. Latent inconsistency, men ikke fikset i denne sliсen.

## 1.2.30 - 2026-05-24

fix(admin): handleSaveContentBundle leser ikke dataset.localeOriginal (v1.2.29 e2e-regresjon)

v1.2.29 endret `applyModuleDetailsDialog` til å bruke `setLocalizedEditorValue` —
input.value inneholder nå current-locale string, og dataset.localeOriginal lagrer hele
locale-objektet. Men `handleSaveContentBundle` (admin-content.js L2235) kalte
`normalizeLocalizedTitlePatchValue(moduleTitleInput.value, ...)` som bruker
`parseLocalizedTextField` (uten dataset-bevissthet). Resultat: lagring sendte
{en-GB: "X", nb: "X", nn: "X"} med en-GB-strengen kopiert til alle locales — andre
locales overskrevet. E2e-test "advanced editor persists a renamed module title when
saving content" fanget regresjonen (#nb verdi var "Renamed module" i stedet for
"Omdøpt modul").

Fix: handleSaveContentBundle bruker nå `readLocalizedFieldValue` (med required:false)
som merger dataset.localeOriginal med current-locale edit. Bevarer eksisterende
behavior når dataset ikke er satt (faller tilbake til normalizeLocalizedTitlePatchValue).

## 1.2.29 - 2026-05-24

fix(admin): handoff-tittel rendres som JSON-streng i Samtale-preview (#361 follow-up)

Bruker fanget diagnostic-log fra v1.2.28: `[handoff-apply-shell] {titleType:"string",
titlePreview:"{\n  \"en-GB\": \"CLS3\",\n  \"nb\": \"\",\n  \"nn\": \"\"\n}"...}`.
Det avslørte at moduleTitleInput.value inneholdt JSON-stringified locale-objekt med
2-space-indent — eksakt mønsteret `JSON.stringify(obj, null, 2)` produserer. Tre sammen-
hengende feil:

1. **Rotårsak**: `applyModuleDetailsDialog` (admin-content.js L2616-2619) brukte legacy
   stringify-pattern (`isMultiLocale ? JSON.stringify(obj, null, 2) : obj["en-GB"]`) som
   plasserte rå JSON i input.value uten å sette dataset.localeOriginal. Bypassed v1.2.22-
   invarianten om at locale-aware felt holder current-locale string i .value og lagrer
   hele locale-objektet på dataset. Fix: bruk `setLocalizedEditorValue` for title og
   description (locale-aware). certificationLevel beholdes på asValue-mønsteret.

2. **doWriteHandoff** (admin-content.js L4294) leste rå `moduleTitleInput?.value` — som
   etter dialog-bruk var JSON-strengen. Andre locale-felt (taskText, criteria-input)
   hadde samme svakhet. Fix: ny `readLocaleField`-helper bruker eksisterende
   `readLocalizedFieldValue` (required:false) for å hente locale-objektet fra dataset
   når det finnes, ellers plain string. Sender full locale-fidelity i handoff.

3. **localizeValueForLocale** (admin-content-preview.js L24) brukte `??`-coalesce i
   fallback-kjeden, så tom streng ("") for current-locale returnerte "" i stedet for å
   falle tilbake til en-GB. Med locale-objekt `{en-GB:"CLS3",nb:"",nn:""}` og preview-
   locale nb fikk bruker blank tittel selv om en-GB hadde innhold. Fix: ny
   `pickFirstNonEmpty`-helper med truthy-sjekk (whitespace trimmet).

Sammen sikrer fixene at: (a) dialog ikke korrumperer input, (b) handoff bærer full
locale-fidelity, (c) preview faller pent tilbake mellom locales. Diagnostic-logging
fra v1.2.28 fjernet (server-POST og console.log).

## 1.2.28 - 2026-05-24

fix+diag(admin): handoff dialog-copy oppdatert + diagnostic-log (#361 follow-up)

(1) Dialog-copy `handoff.unsaved.body` oppdatert i alle tre locales etter v1.2.26
utvidet handoff-settet. Tidligere tekst sa «kun oppgavetekst, veiledning og MCQ» —
nå reflektert at title, description, criteria også blir med, og spesifiserer hva som
IKKE blir med (rubric-vekting, prompt-mal, submission-skjema, vurderingspolicy).

(2) Diagnostic console.log på begge sider av handoff (`[handoff-write-advanced]` i
Avansert, `[handoff-apply-shell]` i Samtale) for å verifisere hva som faktisk
skrives/leses. Brukertest av v1.2.26/27 viste at title ikke kom gjennom selv om kode-
trace ser korrekt ut. Logging avklarer rotårsak. Fjernes etter neste verifisering.

## 1.2.27 - 2026-05-24

fix(admin): title/description fra handoff vises ikke i shell (#361 follow-up)

Brukertest av v1.2.26 viste at title-endring fra Avansert→Shell handoff ikke ble synlig
i Samtale-preview (kun MCQ kom igjennom). Rotårsak i `renderPreview` (shell.js ~L1009):

```js
title: mod.title,           // ← ignorerte activeDraft.title
description: mod.description,
taskText: hasDraft ? activeDraft.taskText : (cfg.moduleVersion?.taskText ?? ""),
```

Mens taskText og andre felt brukte `hasDraft ? activeDraft : bundle`-mønsteret, fulgte
ikke title/description samme prinsipp. Bundle.module.title vant alltid for loaded
moduler — så handoff'd title-endringer ble overstyrt av server-state.

Fix: title og description bruker nå samme `hasDraft && activeDraft.x ? activeDraft.x : mod.x`-
mønster som de andre feltene.

## 1.2.26 - 2026-05-24

feat(admin): full working-draft handoff shell ↔ Avansert (addresses #361)

Tidligere bare 4 felt (taskText, candidateTaskConstraints, assessorExpectedContent,
mcqQuestions). Roundtrip mistet title/description/criteria/blueprint hvis ulagrede.

**Endringer**:
- Shell→Avansert: handoff inkluderer nå title, description, criteria, assessmentBlueprint
  i tillegg til eksisterende sett. «Forkast utkastet og åpne Avansert»-knappen er
  re-labeled til «Ta utkastet med til Avansert (uten å lagre)» — den DEPRECATED å
  forkaste; nå carries draft som dirty state i Avansert.
- Avansert→Shell: handoff inkluderer nå title, description, criteria. Blueprint
  utelates (Avansert eksponerer ikke blueprint som textarea — shell henter fra modul-
  bundle).
- `applyHandoffFromShell` (Avansert) markerer riktig dirty-card per felt (moduleDetails,
  versionDetails, mcq, rubric).
- `applyHandoffDraft` (shell) bygger sessionDraft med utvidet patch.

**Eksplisitt utelatt** (Avansert-only — shell rendrer ikke, dokumentert i
admin-content-handoff.js):
- rubric.scalingRule, promptTemplate, submissionSchema, assessmentPolicy

## 1.2.25 - 2026-05-24

fix(reports): TS2783 duplicate courseId i course-learners-mapping (v1.2.24 CI-fix)

CI fanget TS2783 i `src/routes/reports.ts:344` etter v1.2.24 — `CourseLearnerRow`
inkluderer allerede `courseId`, så explicit `courseId: courseLearnerReport.selectedCourseId`
ble overskrevet av spread. Lokal tsc rapporterte falskt grønt (mistenker stale cache —
verifisert i CI etterpå). Fjernet den eksplisitte assignment-en.

Lærdom: TypeScript-feil som dukker opp i CI men ikke lokalt indikerer trolig en stale
`.tsbuildinfo` eller node_modules-cache. Trygt å stole på CI-tsc framfor lokal.

## 1.2.24 - 2026-05-23

feat(results): 4 nye scoped CSV-eksporter (closes #358)

Bygger på eksisterende `exportCsv`-mønster og legger til fire nye `type`-verdier i
`/api/reports/export`:

- **`module-summary`** — én rad per modul, aggregert. Reuser `getCompletionReport`.
- **`module-learners`** — én rad per (learner, modul) innen aktive filters. Ny
  `getModuleLearnersReport` i `completionReport.ts` (generaliserer
  `getCompletionLearnerReport` til å fungere uten moduleId-filter).
- **`course-summary`** — én rad per kurs, aggregert. Flatset
  `getCourseReport`-output med moduleCount; modul-breakdown forblir i UI-detalj-view.
- **`course-learners`** — én rad per (learner, kurs). Krever `courseId`-filter
  (returnerer tom CSV uten — iterering over alle kurs er ikke spec'd ennå).

Alle eksporter respekterer top-level filters (module, course, status, dateRange,
orgUnit). Eksisterende `completion`/`pass-rates`-buttons beholdes.

Frontend: fire nye knapper i Results-export-row + i18n for en-GB/nb/nn.

## 1.2.23 - 2026-05-23

feat(observability): intent-classification logging i Samtale (#357 Phase A, #466 sporer Phase B)

Beslutning på arkitektur for #357: hybrid (regler først, LLM-fallback når regler er
clarify/unsupported). Phase A: instrumentering. Phase B: implementasjon basert på
faktisk pilot-data.

**Endringer**:
- `POST /api/admin/content/intent-log` (`intentLogLimiter` 60/min/bruker): server-
  endepunktet logger structured JSON via `console.log` med prefiks `[intent-log]`.
  Ingen DB-tabell ennå; App Service log stream / Application Insights fanger payloaden.
- Frontend `logIntentClassificationToServer` i `admin-content-shell.js`: fire-and-forget
  fra `runUnifiedRevision` etter `classifyShellEditInstruction`. Sender `rawInput`,
  `intentKind`, `targets`, `locale`, `moduleId`, `hasDraft`, `hasMcq`. Feil i logging
  påvirker aldri brukerflyt.
- `rawInput` truncated til 500 tegn på server for safety.

**Phase B sporet i #466** — etter data-innsamling: utvide rule-set + bundet LLM-classifier-
fallback.

## 1.2.22 - 2026-05-23

slice: locale-aware textarea-display + kollaps modulliste (closes #462, closes #465)

**#462 — rå JSON i Avansert-textareas**

`formatEditorValue` viste locale-objekter som rå `{"en-GB":"...","nb":"..."}`-blob i
textarea-feltene. Fikset med to nye helpers i `admin-content.js`:

- `setLocalizedEditorValue(el, value)` — viser current-locale-verdi i textarea, lagrer
  original locale-objekt på `el.dataset.localeOriginal`. Aksepterer både locale-objekt
  direkte og JSON-encoded locale-objekt-string (legacy lagring fra Samtale).
- `readLocalizedFieldValue(el, fieldLabelKey, options)` — merger brukerens textarea-tekst
  inn i den lagrede originalen ved save (kun current-locale oppdateres, andre bevart).
  Hvis bruker har skrevet en JSON-blob manuelt, faller den tilbake til
  `parseLocalizedTextField` så multi-locale-edit via JSON fortsatt fungerer.

Anvendt på 8 locale-aware felt: moduleTitle, moduleDescription, mcqSetTitle,
moduleVersionTaskText, moduleVersionCandidateTaskConstraints,
moduleVersionAssessorExpectedContent, promptSystemPrompt, promptUserPromptTemplate.

Ikke-locale-felt (rubric-criteria, mcq-questions, assessment-policy) bruker fortsatt
`formatEditorValue` / rå JSON som før.

**Kjent begrensning**: locale-switching mid-edit oppdaterer ikke textarea-innholdet
automatisk. Bytte av locale påvirker bare nyåpnede moduler. Dokumentert som
follow-up-issue om det blir et reelt problem i bruk.

**#465 — kollaps modulliste i Participant**

Når deltakeren aktiverer en modul, kollapses modullisten (og hjelpeteksten) i
participant-UI-en så modul-innholdet får mer plass. Header + «Last moduler»-knappen
forblir synlig. Klikk på «Last moduler» ekspanderer listen igjen.

Implementert som CSS-klasse `.module-list-collapsed` på `#moduleListSection` med
`display: none` på `#moduleList` + `#moduleSelectionHint` + summary-hint.

## 1.2.21 - 2026-05-23

fix(admin): #464 borderlineWindow ble stripped av zod-schema på lagring

v1.2.20 implementerte borderlineWindow-logikken i decisionService, men brukertest
viste at vinduet ikke faktisk persisterte: oppgitt vindu 0-90, lagret, publisert,
deretter participant-innlevering med score i vinduet → fortsatt automatisk
pass/fail (avhengig av threshold), aldri manuell review. Ved re-åpning av Avansert
var vinduet borte.

**Root cause**: `assessmentPolicyBodySchema.passRules` i `adminContentSchemas.ts`
hadde kun `totalMin` som tillatt felt. Zod stripper ukjente nøkler stille uten
`.passthrough()`, så `borderlineWindow`, `mcqMinPercent` og `practicalMinPercent`
(alle tilbudt av UI-dialogen) ble fjernet fra payloaden før den nådde createModuleVersion.

**Fix**: utvidet schemaet til å akseptere alle feltene UI-en samler inn. Backward-
kompatibelt (alle nye felt er `.optional()`).

## 1.2.20 - 2026-05-23

slice: 5 backlog-issues + #462 utsatt (addresses #464, #460, #459, #461, #463)

**#464 — borderlineWindow brukes nå i decisionService**

Tidligere dead field. Nå: hvis `passRules.borderlineWindow.{min,max}` er satt og
`totalScore` er i intervallet, rutes innleveringen til manuell vurdering selv om
threshold-rules ellers gir auto-pass. `passFailTotal=false` for borderline-saker.
Decision-reason refererer eksplisitt til borderline-vinduet.

**#460 — Status-label split i to (`published_with_draft`)**

`deriveLibraryStatus` returnerer nå `published_with_draft` når `activeVersionId` er
satt men `latestVersion !== activeVersion`. Frontend viser «Live + utkast» (en-GB:
«Live + draft», nb/nn: «Live + utkast»). Grønn bakgrunn (publisert) + gul outline
(har upublisert draft). Filter «Har upublisert utkast» dekker både `unpublished_draft`
og `published_with_draft`. Filter «Publiserte» dekker både `published` og
`published_with_draft`.

**#459 — Avpubliser-knapp i modul-bibliotek-rad**

Ny `Avpubliser`-knapp synlig kun for moduler med status `published` eller
`published_with_draft`. Klikk → window.confirm-dialog med tydelig melding om
konsekvensene → POST `/modules/:id/unpublish` (samme endepunkt Avansert bruker) →
toast + refresh.

**#461 — Versjonsnummer i participant module-list**

Diskret «· vN»-tag etter modul-tittel i participant-modulvalg. Publiseringsdato vises
i tooltip. Diskret stilet (`font-size: 11px`, `color: meta`) så det ikke konkurrerer
med tittel-presentasjonen. Hjelper support/debug å reprodusere hvilken versjon en
deltaker fikk servert.

**#463 — Dirty-detection før publisering**

`handlePublishModuleVersion` sjekker nå `dirtyCards.size > 0` før POST. Hvis det er
ulagrede endringer, vises bekreftelses-dialog som lister hvilke cards som er dirty
og forklarer at publisering bruker SIST LAGRET versjon. Brukeren kan velge å avbryte
og lagre først, eller fortsette publisering uten ulagrede endringer.

**#462 — Utsatt**

Kvikkfix for rå JSON i Avansert-textareas ville introdusert data-tap (parser ville
overskrive locale-objekter med plain string ved første save fra Avansert). Krever
origin-tracking + merge-på-save. Bumpet til neste slice som dedikert oppgave.

## 1.2.19 - 2026-05-23

feat(review): decision-orientert case-detail layout (addresses #349, #354)

Review- og appeal-detail-paneler er omstrukturert fra «data dump + linear sections»
til en decision-stack:

1. **Header**: status-chip + SLA-chip + modul + kandidat (kort kontekst på toppen).
2. **Kandidatens innlevering**: oppgave, svar, refleksjon, innleveringstidspunkt — som
   en strukturert `<dl>` (ikke pre-formatert tekst).
3. **Beslutningshistorikk**: AI-vurdering → Vurderer-overstyring → Anke → Anke-beslutning,
   som en tidslinje med actor + tidspunkt + decision + begrunnelse.
4. **Din beslutning**: textareas + select + Krev oppdraget / Fullfør beslutning (samme
   form-felter som før, bare flyttet inn i sin egen seksjon med blå-toned bakgrunn).
5. **Tekniske detaljer**: collapsed `<details>`-seksjon med rå JSON / ID-er / timestamps —
   tilgjengelig, men ikke synlig i førsteinntrykk.

**#354** (interaction grammar): «Claim review»/«Claim appeal»/«Assign to me» → konsistent
«Krev oppdraget» (`case.action.claim`). «Finalize override»/«Resolve appeal» → «Fullfør
beslutning» (`case.action.finalize`). Begge knapper plassert i samme rekkefølge i begge
paneler. Eksisterende `manualReview.claim/override` og `appealHandler.claim/resolve`-keys
beholdes for bakoverkompatibilitet — `data-i18n` på knappene peker nå på `case.action.*`.

**Acceptance per #349**:
- ✅ Case detail-paneler kan forstås uten å lese hele raw data dump
- ✅ Viktigste decision-data først; teknisk metadata sekundær/collapsible
- ✅ Operator-hastighet uten endring i business rules (samme form-felter, samme submit-paths)

**Acceptance per #354**:
- ✅ Manual-review og appeal bruker samme interaction-grammar (claim → finalize)
- ✅ Rolle-spesifikke ord (Decision reason / Override note / Resolution note) beholdt
  der de er distinkte; standardiserte der de var asymmetriske uten grunn.

## 1.2.18 - 2026-05-23

slice: 3 endringer i modul-bibliotek (closes #457, closes #458, closes #352)

**#457 — STATUS_LABELS i18n**

`STATUS_LABELS` i `admin-content-library.js` var hardkodet norsk («Arkivert», «Upublisert
utkast», «Publisert», «Klargjort»). Brukere i en-GB/nn så norske labels. Erstattet med
i18n-keys (`library.status.archived` osv.) med oversettelser for alle tre locales.

**#458 — Import-dialog focus-restore på feil**

`importModulePackageFile`-change-handleren fokuserer nå tilbake til `importModulePackageBtn`
når import feiler, så tastatur-bruker kan re-trigge uten å Tab-e fra en tom file-input.
SR-bruker får allerede annonsering via toast.js (`role="alert"` for error-toasts).

**#352 — Retire transitional admin-content routes**

- `GET /admin-content?moduleId=X` → 301-redirect til canonical
  `/admin-content/module/X/conversation`.
- `GET /admin-content/advanced` (no module context) → 301-redirect til `/admin-content`
  (modul-bibliotek). Avansert-editoren ligger nå kun på `/admin-content/module/:id/advanced`.
- Interne client-refs (`buildAdminContentAdvancedUrl` fallback, shell.js error-recovery)
  oppdatert til canonical routes så vi ikke genererer 301-vekkredirects internt.
- `participant-console-config.test.ts` testene oppdatert til å bekrefte både redirects og
  canonical routes.

Bookmarks/eksterne lenker til legacy URLs fortsetter å virke via 301.

## 1.2.17 - 2026-05-23

fix(admin): Sertifiseringsnivå-kolonnen viste hardkodet engelsk + ugyldig "Foundation"

Modul-bibliotek-tabellen hadde et `CERT_LABELS`-objekt med fastlåst engelsk («Basic»,
«Intermediate», «Advanced») pluss en ugyldig «Foundation»-verdi som ikke finnes i
skjemaet (`certificationLevelSchema = enum["basic","intermediate","advanced"]`).

Fix:
- Erstatt `CERT_LABELS` med `CERT_I18N_KEYS` som mapper enum → i18n-keys
  (`adminContent.promptDialog.certificationLevelBasic|Intermediate|Advanced`). Bruker
  ser «Grunnleggende / Videregående / Avansert» i nb, «Grunnleggjande / Vidaregåande /
  Avansert» i nn, «Basic / Intermediate / Advanced» i en-GB.
- Fjern «Foundation» (dead code).
- Tolerer legacy-data der `certificationLevel` ble lagret som JSON-encoded locale-objekt
  — parser ut en kjent enum-verdi om mulig, ellers viser verdien rå (synlig signal at
  noe er feil og kan ryddes manuelt).


---

Older versions (v1.2.16 and earlier) are archived in [`archive/VERSIONS_archive.md`](archive/VERSIONS_archive.md) — flyttet 2026-05-29 for å holde denne fila lesbar.
