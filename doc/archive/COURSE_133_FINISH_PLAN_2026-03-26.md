# Ferdigstillingsplan for #133 Organisere moduler i kurs

## Formål
Dette dokumentet oppdaterer status og ferdigstillingsplan for `#133` basert på faktisk kode i repoet per `2026-03-26`.

Det erstatter ikke det opprinnelige designnotatet i `doc/design/course-organization.md`.
Det fungerer som:
- statusavklaring mot faktisk implementasjon
- eksplisitt UX-beslutning for gjenværende arbeid
- løsningsdesign for restarbeidet
- grunnlag for nye eller oppdaterte GitHub-issues

## Prosessgrunnlag
Planen er laget etter prinsippene i `doc/design/AI_WORKFLOW.md`:
- sammenlign issuebeskrivelse med faktisk kode før videre arbeid
- oppdater issue-status når implementasjonen ikke matcher issue-status
- dokumenter UX- og løsningsvalg i repoet, ikke bare i issue-tekst
- lag små, tydelige follow-up issues i stedet for å gjenåpne brede arbeider uten avgrensning

## Oppsummert status
`#133` er ikke fullført end-to-end, selv om epiken og alle opprinnelige child issues er lukket.

Det som er implementert:
- datamodell for `Course`, `CourseModule` og `CourseCompletion`
- admin-API for kurs
- admin-UI for kurs i Admin Content
- deltaker-API for kursliste, kursdetalj og kursbevis
- kursbevis-trigger fra assessment, review og appeal
- kursrapport i backend og Results UI
- capability/route-kobling for `/api/courses`

Det som fortsatt mangler eller er delvis levert:
- deltaker-UX matcher ikke fullt ut design og issue-aksept
- kursrapporten matcher ikke fullt ut opprinnelig issue-scope
- testdekning for kursfunksjonalitet er i praksis fraværende
- dokumentasjon og issue-status er ute av sync med faktisk implementasjon

## Validert levert omfang

### Levert og kan stå som ferdig
- `#277` Datamodell
- `#278` Admin API
- `#279` Admin UI
- `#282` Kursbevis

Begrunnelse:
- disse delene finnes i kodebasen og er koblet inn i applikasjonen
- datamodell og migrasjon finnes
- admin-ruter og admin-UI finnes
- `CourseCompletion` utstedes fra beslutningsflytene

### Delvis levert og trenger ferdigstilling
- `#280` Deltaker API
- `#281` Deltaker UI
- `#283` Rapportering

Begrunnelse:
- funksjonalitet finnes, men ikke helt i samsvar med opprinnelig design/aksept

## Faktiske gap som må lukkes

### 1. Deltakerkurs i UI er bare delvis i tråd med designet
Nåværende implementasjon:
- kurs vises i accordion i `/participant`
- kursdetalj lastes fra `/api/courses/:courseId`
- modulene i kursdetaljen rendres som enkle rader

Gap:
- modulene inne i kurset gjenbruker ikke eksisterende modulkort slik designet beskrev
- modulene er ikke tydelig handlingsbare innganger til eksisterende deltakerflyt
- `moduleStatus` i kursdetalj er i praksis bare `PASSED` eller `NOT_STARTED`, ikke reell `IN_PROGRESS`

Konsekvens:
- deltakeropplevelsen er funksjonell, men svakere enn planlagt
- API-kontrakten og UI-kontrakten er ikke helt ærlige om hva som faktisk støttes

### 2. Permalink-strategien for kurs er uklar
Opprinnelig designnotat beskrev permalink `/participant/course/:courseId`.

Nåværende implementasjon:
- det finnes ingen egen Express-side for `/participant/course/:courseId`
- UI støtter i stedet deep-link via query-param på `/participant?courseId=<id>`

Gap:
- design og implementasjon er ute av sync

### 3. Kursrapporten er levert, men ikke helt i samsvar med issue-scope
Nåværende implementasjon:
- `/api/reports/courses` finnes
- Results UI viser kursrapport

Gap:
- issue `#283` beskrev filtrering på kurs og tidsperiode
- dagens rapport-API bruker ikke samme filtermodell som de andre rapportene
- results-UI støtter ikke eksplisitt kursfilter for kursrapporten

### 4. Kurs mangler automatisert testdekning
Validering i repoet viser ingen dedikert testdekning for:
- `/api/courses`
- `/api/admin/content/courses`
- `/api/reports/courses`
- kursbevis-trigger og idempotens
- kursvisning i deltaker- og results-workspace

Dette er det største resterende kvalitetsgapet.

### 5. Dokumentasjon og GitHub-status er feil
Nåværende situasjon:
- `#133` er lukket og kommentert som fullført
- `doc/design/course-organization.md` beskriver fortsatt status som "implementasjon ikke påbegynt"
- API- og brukerrettet dokumentasjon refererer ikke tydelig til kursfunksjonaliteten

Konsekvens:
- repoet og GitHub gir motstridende signaler om modenhet og restarbeid

## UX-beslutninger for ferdigstilling

### UX-beslutning 1: Accordion i `/participant` er fortsatt primærflyt
Vi beholder kurs som en del av deltakerens eksisterende arbeidsflate.

Begrunnelse:
- lavere navigasjonskost
- bygger videre på allerede levert funksjonalitet
- minst risiko for å forstyrre eksisterende modulflyt

Konsekvens:
- kurs skal fortsatt vises i `/participant`
- deltaker skal ikke måtte inn i en separat kursapplikasjon eller ny workspace

### UX-beslutning 2: Ingen egen `/participant/course/:courseId`-side i MVP-finish
Vi standardiserer på deep-linking via `/participant?courseId=<id>`, ikke en ny egen side.

Begrunnelse:
- dette er allerede delvis implementert
- det løser deling/bookmark-behovet uten ny sideflate, ny HTML-side og ny navigasjonskontrakt
- det er en mindre og tryggere ferdigstilling enn å introdusere en ny participant-side nå

Konsekvens:
- opprinnelig designnotat må oppdateres eller markeres som historisk
- issue-tekst må justeres til faktisk MVP-beslutning

### UX-beslutning 3: Kursmoduler skal være handlingsbare og gjenbruke eksisterende modulvalglogikk
Det endelige målet for kursmoduler i accordion er ikke bare lesbar status, men faktisk gjenbruk av deltakerens eksisterende modulhandlinger.

Begrunnelse:
- dette var kjernen i opprinnelig UX-intensjon
- dagens rader er informative, men ikke tilstrekkelig operasjonelle

Konsekvens:
- kursinnhold skal bruke samme modulstatusmodell og samme "velg/start"-adferd som resten av deltakerflyten
- full pixel-likhet er mindre viktig enn reell funksjonell gjenbruk

### UX-beslutning 4: Kursrapport skal følge samme filtermentalitet som øvrige rapporter
Kursrapport skal ikke være en særflate med hardkodet datalast.

Begrunnelse:
- admin/resultatbrukere forventer samme filtermønster i Results
- issue `#283` beskrev filtrering som del av scope

Konsekvens:
- kursrapporten skal støtte minst tidsfilter
- kursfilter bør støttes eksplisitt dersom vi vil si at `#283` er ferdig

## Løsningsdesign for restarbeidet

### Arbeidsspor A: Fullfør deltaker-API og deltaker-UX for kurs

#### Mål
Gjøre kursvisningen i `/participant` funksjonelt ferdig og konsistent med resten av deltakerflyten.

#### Backend-endringer
- utvid `/api/courses/:courseId` til å kunne returnere reell modulstatus:
  - `PASSED`
  - `IN_PROGRESS`
  - `NOT_STARTED`
- beregn `IN_PROGRESS` fra brukerens siste relevante submission/resultat for modulen, ikke bare fra `CertificationStatus`

#### Frontend-endringer
- kursaccordion skal vise handlingsbare moduloppføringer, ikke bare passive rader
- moduloppføringene skal bruke eksisterende modulvalgslogikk i deltakerklienten
- deep-link `?courseId=` skal være dokumentert og verifisert som støttet oppførsel

#### Ikke mål
- egen HTML-side for `/participant/course/:courseId`
- ny separat kursnavigasjon

### Arbeidsspor B: Fullfør kursrapport som faktisk MVP-funksjon

#### Mål
Gjøre kursrapporten sammenlignbar med resten av reporting-flaten og nærme den opprinnelige aksepten i `#283`.

#### Backend-endringer
- utvid `/api/reports/courses` med samme filtermønster som øvrige rapporter der det er naturlig
- minst støtte for `dateFrom` og `dateTo`
- vurder eksplisitt `courseId` som filter dersom UI skal kunne fokusere på ett kurs

#### Beregningsregel
- `enrolledParticipants`: brukere med minst én submission på kursmodul innen aktivt filtervindu
- `completedParticipants`: brukere med `CourseCompletion.completedAt` innen aktivt filtervindu
- `moduleBreakdown.passRate`: beregnes på modulnivå innen samme filtervindu

#### Frontend-endringer
- Results skal laste kursrapport med samme relevante filtre som øvrige rapporter
- UI trenger ikke egen stor kursflate; eksisterende tabell er tilstrekkelig hvis filtrene støttes

### Arbeidsspor C: Legg på reell test- og verifikasjonsdekning

#### Mål
Gjøre kursfunksjonaliteten trygg nok til å kunne regnes som ferdig og ikke som "best effort".

#### Minimum testpakke
- unit:
  - `computeCourseStatus`
  - `checkAndIssueCourseCompletions`
- integration:
  - admin course CRUD/publish/archive/module ordering
  - participant `/api/courses` og `/api/courses/:courseId`
  - automatisk kursbevis ved siste beståtte modul
  - `/api/reports/courses` med og uten filtre
- contract/UI:
  - at participant-siden faktisk eksponerer kursaccordion
  - at admin-content har kursfane
  - at results viser kursrapportseksjon
- RBAC:
  - legg til `/api/courses` i RBAC-matrisen

### Arbeidsspor D: Synk GitHub og dokumentasjon med virkeligheten

#### Mål
Fjerne den nåværende situasjonen der kode, designnotat og GitHub viser tre forskjellige sannheter.

#### Dokumentasjonsarbeid
- opprett dette dokumentet som aktiv ferdigstillingsplan
- oppdater `#133` med faktisk status: delvis implementert, ikke fullført
- behold `doc/design/course-organization.md` som historisk designgrunnlag, men slutt å bruke statusfeltet der som sannhet
- oppdater API- og brukerrettet dokumentasjon når restarbeidet er levert

## Anbefalt issue-struktur for ferdigstilling

### 1. Fullfør deltakerkurs API- og UX-paritet
Dekker:
- reell `moduleStatus`
- handlingsbare kursmoduler i accordion
- standardisering på `?courseId=`-deep-link i stedet for ny side

### 2. Fullfør kursrapportering og filterstøtte
Dekker:
- filterstøtte i `/api/reports/courses`
- results-integrasjon som følger samme mønster som øvrige rapporter

### 3. Legg til automatisert dekning for kursflyter
Dekker:
- unit, integration, RBAC og workspace-kontrakter for kurs

### 4. Synk dokumentasjon og issue-status for #133
Dekker:
- reopening/statusoppdatering av epic
- dokumentasjonsoppdatering etter valgt MVP-scope
- tydelig close-out når menneskelig verifikasjon er gjort

## Rekkefølge
1. Status- og scopeopprydding for `#133`
2. Deltakerkurs API/UI-paritet
3. Kursrapportering
4. Testdekning
5. Sluttføring av docs og menneskelig verifikasjon

## Definition of Done for #133
`#133` kan først regnes som ferdig når alle disse er sanne:
- kursflyten i `/participant` er handlingsbar, ikke bare informativ
- deep-link-strategien er eksplisitt valgt og dokumentert
- kursrapporten støtter avtalt filteromfang
- kurs har automatisert dekning i backend, kontrakter og sentrale brukerflyter
- Epic- og child-status i GitHub samsvarer med faktisk kode
- menneskelig verifikasjon av UI-flyt er registrert før endelig lukking
