# #934 — hovedversjon og mindre versjon for kurs og moduler

Status: **avklart med produkteier** 2026-11-01 (skissen godkjent). Skive 1 bygget i 2.127.0, skive 2 i 2.128.0, skive 3 i 2.129.0, 4a i 2.131.0, 4b i 2.132.0, 5a-1 i 2.133.0, 5a-2 i 2.134.0 og 5a-3 i 2.135.0 (bryteren er av); 5b gjenstår.
Skisse: https://claude.ai/artifact/AyQpYXMQSDHW8WL8YPe34n

## Hva produkteier har bestemt (2026-11-01)

- Kurs får **hovedversjon og mindre versjon** (3.0 → 3.1 er mindre, 3.x → 4.0 er hoved).
- **Innholdsansvarlig velger** ved publisering. Grensesnittet skal gjøre konsekvensen tydelig.
- **Mindre versjon** har ingen konsekvens for utstedte kursbevis.
- **Hovedversjon:** et kursbevis gjelder sin hovedversjon («Kursbevis, versjon 3»), og forblir gyldig
  for den. Kurset regnes ikke som fullført i versjon 4 før deltakeren har tatt det som er nytt.
  Statusrapporten viser «må ta ny versjon» — ikke stryk.
- Deltakere med bevis for en eldre hovedversjon **får e-post** når en ny hovedversjon publiseres.
- **Moduler bruker de samme begrepene.** Dagens avkrysning «erstatter tidligere bestått» (#997) blir
  valget hovedversjon / mindre versjon.

Dette erstatter saksteksten fra 2026-08-19 (steg 4 «supersett-regelen» og steg 5 «CourseVersion»):
versjonen er noe forfatteren merker, ikke noe systemet utleder — samme begrunnelse som #997.

## Hva det betyr for en deltaker

| Situasjon | Ser i «Mine kurs» | Kursbevis | Rapport |
|---|---|---|---|
| Fullført 3.x, kurset er nå 3.4 | Fullført | «versjon 3» gjelder | Fullført |
| Fullført 3.x, kurset er nå 4.0 | «Ny versjon 4.0 — fullfør det nye for nytt kursbevis», det nye merket | «versjon 3» står, gyldig for 3 | Må ta ny versjon |
| Fullfører 4.0 | Fullført | nytt bevis «versjon 4»; det gamle står | Fullført |
| Aldri fullført | Som i dag | — | Som i dag |

**Det som allerede er gjort, teller** (produkteier 2026-11-01: «Hvis et oppdatert kurs har seksjoner
eller moduler som ikke er oppdatert, så skal den nye versjonen stå med seksjonene lest og modulene
fullført»):

- En **modul** som er bestått, står som bestått — unntatt en modul som selv har fått hovedversjon
  (den er erstattet, SUPERSEDED, og må tas på nytt, som i dag).
- En **seksjon** som er lest, står som lest — unntatt en seksjon som er **endret siden forrige
  hovedversjon av kurset**. Den leses på nytt (produkteier 2026-11-01). Innenfor samme hovedversjon
  gjelder #1095 fortsatt: en ny seksjonsversjon i en mindre versjon av kurset krever ikke ny lesing.
- Nye moduler og seksjoner må tas.

Har versjon 4.0 bare fått én ny modul, er det den ene modulen som gjenstår.

**Hva «endret siden forrige hovedversjon» betyr, presist:** når en hovedversjon publiseres, lagres
hvilken versjon hver seksjon i kurset har (`CourseVersion.sectionVersionsJson`). En seksjon krever ny
lesing i hovedversjon N når den aktive seksjonsversjonen i N er en annen enn i N−1. En lesing teller
for N når den er gjort etter at N ble publisert, eller seksjonen er uendret.

## Data

- `Course.versionMajor` (heltall, starter på 1) og `Course.versionMinor` (starter på 0). Eksisterende
  kurs blir 1.0.
- `CourseCompletion.versionMajor` og `versionMinor` — versjonen beviset ble utstedt for. Eksisterende
  bevis blir 1.0.
- Unik nøkkel `(userId, courseId)` → `(userId, courseId, versionMajor)`. Ett bevis per hovedversjon.
- «Fullført kurset» = har bevis for **kursets nåværende hovedversjon**. Dagens `if (existing) return`
  blir «finnes et bevis for denne hovedversjonen».
- Modul: `ModuleVersion` får `versionMajor`/`versionMinor` ved siden av dagens `versionNo` (som
  beholdes som løpenummer). Hovedversjon på en modul = dagens `supersedesEarlierPasses: true`.
- `CourseVersion` (én rad per hovedversjon): `courseId`, `versionMajor`, `publishedAt`,
  `sectionVersionsJson` (seksjon → aktiv versjon da). Trengs for regelen om endrede seksjoner; brukes
  ikke til å lagre kursets innhold (det står i kursbevisets øyeblikksbilde, som i dag).
- Alt er additivt (expand/contract-trygt): nye kolonner med standardverdi, ingen fjernet.

## Når forfatteren velger — og når hen ikke blir spurt

| Hendelse | Spørsmål | Hvorfor |
|---|---|---|
| Kurset publiseres første gang | Ingen — blir 1.0 | Ingen har bevis ennå |
| Publisert kurs: lagre endring i innholdet (legge til, ta ut, flytte) | **Hoved / mindre** | Endringen trer i kraft straks for alle |
| Publisert kurs: «Publiser nye versjoner» (#1095) | **Hoved / mindre**, ett svar | Samme |
| Publisert kurs: bare tittel eller beskrivelse | Ingen — mindre | Endrer ikke kravet |
| Modul publiseres i modulens egen flate, og noen har bestått | **Hoved / mindre** for modulen | Erstatter dagens avkrysning |
| Modul publiseres som **hoved**, og ligger i publiserte kurs | **Hoved / mindre per kurs** | Se under |
| Seksjon publiseres i seksjonens egen flate | Ingen — mindre for kursene | «Lest» består ny versjon (#1095) |
| Ingen har bevis / ingen har bestått | Ingen spørsmål, mindre | Ingenting å ha konsekvens for |

**En modul som får hovedversjon:** forfatteren velger for hvert publiserte kurs modulen ligger i om
kurset får hovedversjon eller mindre versjon (avgjort 2026-11-01). Dialogen viser kursene og hvor mange
kursbevis hvert valg gjelder.

## Dialogen (skisse: se artefakten)

Forfatteren ser to valg med konsekvensen skrevet ut, og tallene som gjelder dette kurset:

- **Mindre versjon (3.1 → 3.2)** — «Rettelser og forbedringer. De 42 som har kursbevis, beholder det.
  Ingen får e-post.»
- **Hovedversjon (3.2 → 4.0)** — «Nytt eller endret innhold deltakerne må ta. De 42 som har kursbevis
  for versjon 3, beholder det, men må fullføre det nye for å få kursbevis for versjon 4. De får
  e-post.»

Standardvalg: **mindre**. Et feiltrykk skal ikke sende 42 e-poster. Hovedversjon krever et bevisst
klikk.

Har ingen kursbevis, vises ikke spørsmålet; versjonen øker som mindre.

## Synlig versjonsnummer

- Forfatter: kurslista og kursskjemaet viser «v3.2». Modullista viser «v2.1» der den i dag viser «v5».
- Deltaker: kursbeviset viser «Versjon 3». Kurskortet viser versjonen bare når den er ny for
  deltakeren.
- Kurseksport bærer versjonen som opplysning; import setter den ikke (påstand, ikke bevis — som
  opprinnelsen, DECISIONS 2026-09-18).

## E-post

Én e-post per deltaker med bevis for en eldre hovedversjon, gjennom outboxen, på deltakerens språk —
samme vei som #997. Tekst: kursnavn, ny versjon, hva som er nytt (antall nye eller endrede elementer),
lenke til kurset. Ingen e-post ved mindre versjon.

## Åpne spørsmål til produkteier

Alle avgjort 2026-11-01:

1. **Modul med hovedversjon → spør for hvert kurs.** Moduldialogen lister hvert publiserte kurs modulen
   ligger i, med antall kursbevis for kursets nåværende hovedversjon, og et valg hoved/mindre per kurs
   (standard mindre, som ellers).
2. **Frister:** en frist som er oppfylt, står som oppfylt. Den nye hovedversjonen er frivillig til noen
   setter en ny frist; ingen påminnelser for den.
3. ~~Seksjoner~~ — avgjort 2026-11-01: en seksjon som er endret siden forrige hovedversjon av kurset,
   leses på nytt. Seksjonen selv får ikke eget versjonsvalg; det er kursets hovedversjon som avgjør.

## Rekkefølge (skiver)

1. Datamodell + migrasjon (additiv), versjon på kurs og bevis, utstedelse per hovedversjon. Ingen ny
   flate. Alle eksisterende blir 1.0. Den gamle unike nøkkelen (bruker, kurs) står.
2. Leserne skiller versjonene (tabellen under), og den gamle nøkkelen fjernes — i samme utrulling
   (QA-porten 2026-11-01: utvid først, trekk sammen etterpå, og ingen leser skal kunne møte to bevis
   før den kan skille dem). Deltakerflaten: bevis med versjon, rapportkategori «må ta ny versjon».
3. Forfatterdialogen for kurs (lagre endring, publiser nye versjoner) + versjon i lister, og
   `CourseVersion` for seksjonsregelen. Først her kan hovedversjon 2 lages.
4. E-post.
5. Moduler: avkrysningen #997 → hoved/mindre, og kursenes hovedversjon fra modulens.

Hver skive kan rulles ut alene. Skive 1 endrer ingenting synlig for noen.

### Skive 1 — bygget (2.127.0)

Kolonnene `versionMajor`/`versionMinor` på `Course` og `CourseCompletion` (standard 1.0), unik nøkkel
`(userId, courseId, versionMajor)` ved siden av den gamle `(userId, courseId)`, og utstedelsen spør etter bevis for kursets nåværende hovedversjon.
`CourseVersion` (seksjonsregelen) kommer i skive 3, sammen med det første som kan lage en ny
hovedversjon: øyeblikksbildet tas av det som gjaldt *før* endringen, i samme transaksjon.

### Lesere av kursbevis — hva hver av dem skal bety (skive 2, gjort i 2.128.0)

Så lenge alle kurs er 1.x, svarer de likt. Når hovedversjon 2 finnes, må hver leser bety én av to ting:

| Leser | Skal bety | Merknad |
|---|---|---|
| `routes/courses.ts:181` (`/api/courses/completions`) → `isCourseCompleted()` i deltakerflaten | bevis for **nåværende** hovedversjon | lista har flere rader per kurs; kartet i `participant.js` velger riktig; eldre bevis gir «Ny versjon» (skive 2) |
| `courseReport.ts` (fullført-tall og deltakerrader) | **nåværende**, og «må ta ny versjon» som egen kategori | gjort i skive 2 |
| `enrollmentService.deriveStatus` | **hvilken som helst** — fristen står som oppfylt | gjort i skive 1 |
| `contentLifecycle.ts:124/186` (innhold i et bevis kan ikke slettes) | **hvilken som helst** | uendret |
| `contentLifecycle.ts:237` (påbegynt, ikke fullført) | **hvilken som helst** | lesinger og innleveringer har ingen versjon; med «nåværende» ville alle som tok versjon 1 stå som påbegynt og låse arkivering |
| `courseCommands.ts`/`courseCascadeDeleteService.ts` (kurs med bevis kan ikke slettes) | **hvilken som helst** | uendret |
| `activityReport.ts` (fullføringer over tid) | **hver utstedelse** er en hendelse | uendret |
| Profilsiden og kursbeviset | alle bevis, med versjon | gjort i skive 2 (versjon vises fra 2) |

### Skive 3 — bygget (2.129.0)

- **Hvor spørsmålet stilles:**
  - i kursskjemaet når innholdet i et publisert kurs med kursbevis endres (lagt til, tatt ut, flyttet);
  - i «Publiser nye versjoner», ett svar for kurset.

  Mindre er standard. Tjeneren gjør en hovedversjon uten kursbevis til mindre. Diskusjonsbryteren per
  element er ikke innhold.
- **Upubliserte kurs:**
  - Et kurs som aldri har vært publisert, får ingen versjon; det blir 1.0 ved første publisering.
  - Et kurs som har vært ute, versjoneres også mens det er avpublisert. «Har vært ute» betyr publisert
    nå, delingslenke (satt ved første publisering) eller kursbevis.
  - Ellers kunne innholdet endres mens kurset var nede, og publiseres igjen uten versjon (QA-porten,
    2.129.0).
- **Uten spørsmål:**
  - Navn eller beskrivelse endret gir mindre.
  - Kursskjemaet lagrer navn og innhold i ÉTT kall til et eget endepunkt (`PUT /courses/:id/content` med
    `items` og `version`), i én transaksjon. Under rullering svarer en gammel server 404 i stedet for å
    lagre halvt; den gamle `PUT /courses/:id` står som før for gamle faner.
  - Versjonen regnes ut med kursraden låst (`SELECT … FOR UPDATE`), og «Publiser nye versjoner» leser
    settet på nytt etter låsen: samtidige endringer mister ingen økning og gir ingen dobbel (QA-runde 4). Serveren avgjør versjonen én gang: endret innhold gir forfatterens svar, ellers gir
    et endret navn mindre. Ingen klient kan slå økningen av (QA-porten, runde 2).
  - En seksjon som importen bytter ut med en kopi, tar øyeblikksbildet med seg
    (`renameSectionInVersionSnapshots`), så de kopierte lesingene teller som før.
  - Legacy-ruta `PUT …/modules` gir alltid mindre.
  - Import `updateExisting` gir mindre. En oppdatering legger aldri nytt påkrevd innhold inn i et
    publisert kurs:
    - nye moduler blir utkast utenfor kurset;
    - nye versjoner legges klar, og spørsmålet stilles når de publiseres;
    - utbyttede elementer er kopier av den levende versjonen.

    Navn eller beskrivelse teller også, med én økning per import.
- **`CourseVersion` og regelen for endrede seksjoner:** se `src/modules/course/courseVersioning.ts`. Når
  hovedversjon N lages:
  - raden for N−1 skrives med seksjonsversjonene rett før endringen (slutten av N−1);
  - raden for N skrives med versjonene rett etter.

  Regelen sammenligner slutten av N−1 med starten av N. En seksjon som fikk ny versjon innenfor N−1, i
  en mindre versjon (#1095), telles derfor ikke som endret en gang til. En lesing teller for N når
  seksjonen er uendret, eller er lest etter `publishedAt` for N. Kurs uten rader (alle 1.x) har ingen
  regel.
- **Én funksjon for alle veier inn (produkteier 2026-11-02: «felles kode, ikke duplisert logikk»):**
  - Alt som setter innhold live i et kurs, eller endrer versjonen, kaller `applyCourseVersionChange`.
    Det gjelder skjemaet (`/content` og `/items`), «Publiser nye versjoner», «Publiser kurs», importen,
    seksjon og modul fra egen side, og navnet.
  - Funksjonen eier sjekken av kursbevis, regelen for manglende svar (`course_version_required`),
    låsen, øyeblikksbildet og økningen.
  - `test/course-version-write-guard.test.js` nekter andre skrivere.
  - De tre dialogene deler `mountCourseVersionChoice`.
- **«Publiser kurs» med nytt innhold** spør det samme når kurset har vært ute og har kursbevis. Det
  skjer i én transaksjon, og versjonen avgjøres før kurset publiseres, så en første publisering blir 1.0.
- **OVERGANG, fjernes i neste utgivelse etter 2.129.0:** en fane som var åpen fra før utrullingen, lagrer
  navn og innhold i to kall og kjenner ikke spørsmålet. `PUT …/items` uten markøren `versionAware: true` og
  uten svar gir derfor en mindre versjon i stedet for avvisning, ellers ville navnet stått lagret og innholdet
  avvist. Kursskjemaet fra 2.129.0 sender markøren, og der gjelder regelen under.
- **Uten svar, når noen har kursbevis,** avvises endringen. Det gjelder alle veier som stiller spørsmålet
  (skjema, «Publiser nye versjoner», «Publiser kurs», `replaceExisting`). Dialogene har alltid et svar.
- **Ett sted for regelen:** alle som spør «hvilke seksjoner har deltakeren lest» går gjennom
  kursrepositoriet, som bruker regelen. Det gjelder kursbevisporten, kursdetaljen, fremdriften i
  «Mine kurs» og kursrapporten.
- **Ny lesing:** en lesing som ikke teller, får nytt tidspunkt når deltakeren leser seksjonen på nytt.
  En lesing som teller, står urørt, for aktivitetsrapporten bygger på tidspunktet.
- **«Publiser nye versjoner»:** elementene, kursets versjon og øyeblikksbildet publiseres i ÉN
  transaksjon, alt eller ingenting. `publishSection` fikk en `tx` som `publishModuleVersion`. Stopper
  noe, er ingenting publisert, og et nytt forsøk ser det samme settet (QA-porten, 2.129.0).

Står igjen:
- **Til skive 4:** e-post. Dialogen sier ingenting om e-post før den finnes.
- **Til skive 5:**
  - modulenes eget hoved/mindre-valg per kurs (til da gir en modul publisert fra egen side kursene en
    mindre versjon);
  - versjonen i modullista.
- **Uten skive:** versjonen i kurseksporten.
- **Import med `replaceExisting`** (bare API; skillet bruker den ikke) bytter ut hele innholdet. Produkteier
  2026-11-02: på et kurs med kursbevis kreves `version` (mindre/hoved), ellers `400 course_version_required`
  før noe skrives. Uten kursbevis: som før.
- **Deling mellom fagansvarlige:** kursdetaljen viser `certificateHolders` også til en fagansvarlig som ikke
  eier kurset. Det er ønsket (produkteier 2026-09-07, bekreftet 2026-11-02); se `doc/DECISIONS.md`.

### Kjente hull etter 2.129.0

QA-porten, runde 6 (2026-11-02). Ingen kan miste innhold, gi feil kursbevis eller la innhold gå live uten
versjonsregelen. Etter produkteiers regel er de registrert her og ikke rettet før stage:

1. **En gammel fane gir to mindre versjoner** når den endrer både navn og innhold i én lagring. Det er to kall
   (`PUT /:courseId`, så `PUT …/items` i overgangen), og hvert gir en mindre versjon. Forsvinner med
   overgangen i neste utgivelse.
2. **Ferske oppslag i publiseringstransaksjonen går via den globale klienten.** `getCoursePendingVersions` og
   `getCoursePublishPreview` bruker `prisma`, ikke `tx`, mens transaksjonen holder en forbindelse og
   kurslåsen. Mange samtidige publiseringer med en liten forbindelsespool kan gå tom og rulles tilbake med
   500. Ingenting blir halvt publisert. Rettingen er å gi oppslagene klienten som parameter.
3. **Låserekkefølge ved delte elementer.** To samtidige publiseringer av to kurs som deler et element,
   låser først eget kurs og så det andre. PostgreSQL avbryter den ene med 500, og den rulles tilbake. Rettingen
   er å låse alle berørte kursrader i én fast rekkefølge (sortert id) før noe publiseres.

## Plan for resten (skive 4–5)

Status: **revidert 2026-11-04 etter Codex' gjennomgang, runde 1 og 2, og produkteiers avgjørelser 2026-11-03/04.**
**4a er bygget i 2.131.0**, **4b i 2.132.0** og **5a-1 i 2.133.0** (se «… — bygget» under). Resten er ikke bygget. Det blir ingen flere Codex-runder på
planen; QA-porten tar hver skive når den er bygget.

Det viktigste:

- **Én lås for alt innhold.** Alt som skriver innhold, eller endrer hvilke elementer et kurs har, tar den samme låsen
  først i transaksjonen og sjekker alt annet etter at låsen er tatt. Det som må se en fast versjon (kursbevis,
  innlevering, lesing), tar den samme låsen delt. I tillegg én lås per deltaker. Se «Låsene» under. Det erstatter
  låsene per kurs og per element i forrige utgave.
- **4a:** kursskjemaet lagrer i ett kall, og kallet avvises hvis noen andre har lagret kurset siden skjemaet ble
  åpnet. Skjemaet nekter å lagre hvis elementlista ikke ble lastet.
- **4b:** e-postene lagres som én rad per person og versjon, i samme transaksjon som hovedversjonen. Workeren
  sender dem, med et bilde.
- **5a er delt i tre.** Om en bestått modul teller i et kurs, avgjøres av **hvilken versjon av modulen** deltakeren
  besto, ikke av når. Kravet per kurs står til det er oppfylt. Siden sender med hvilken versjon deltakeren så.
- **5b:** modulene får versjonsnummeret hoved.mindre tilbake.

Prod har 2.130.1 (skive 1–3). Prod er én instans, og prodsettinger skjer om kvelden.

### Det som gjenstår

1. **E-post** når en ny hovedversjon publiseres (bestemt 2026-11-01).
2. **Moduler:** avkrysningen fra #997 («erstatter tidligere bestått») blir valget hovedversjon eller mindre versjon,
   **per kurs** modulen ligger i (bestemt 2026-11-01).
3. **Versjonsnummer på moduler**, i modullista og i kurseksporten.
4. **Kjente hull etter 2.129.0, nr. 2 og 3**, og at en fane som har stått åpen, kan skrive over en annens endringer.
5. **Overgangen for gamle faner** (`versionAware`) fjernes.

### Skivene, minste først

| Skive | Innhold | Synlig for brukeren |
|---|---|---|
| **4a** | Innholdslåsen; kursskjemaet lagrer i ett kall med kontroll mot andres lagring; gamle faner avvises | Feilmelding ved samtidig redigering |
| **4b** | E-post ved ny hovedversjon | Deltakere med eldre kursbevis; antall mottakere i dialogen |
| **5a-1** | Deltakerlåsen; kursbevis utstedes låst; innlevering og lesing sender versjonen deltakeren så | Deltaker: «Teksten er endret, last siden på nytt» |
| **5a-2** | Grunnmur: versjonsnummer på moduler, beståtte per innlevering, kravet per kurs og modul. Skrives ved siden av dagens regel, med en rapport som sammenligner | Nei |
| **5a-3** | Den nye regelen slås på; `SUPERSEDED` skrives ikke; nye endepunkter med svar per kurs | Forfatter: den gamle avkrysningen avvises til 5b er ute |
| **5b** | Dialogene med svar per kurs, «v2.1» i modullista, versjonen i kurseksporten | Forfatter |

Hver skive rulles ut alene på stage. 5a-3 og 5b går til prod i samme prodsetting (se 5a-3).

### Låsene (gjelder alle skivene)

Produkteier 2026-11-04: det er få forfattere, og en innholdsendring tar millisekunder. Det er greit at alle
innholdsendringer på hele plattformen står i kø bak hverandre.

**Innholdslåsen** er én rådgivende lås i PostgreSQL for hele plattformen (`pg_advisory_xact_lock` med én fast
nøkkel). Den gjelder ut transaksjonen og slippes ved commit eller tilbakerulling.
- **Eksklusiv** for alle som skriver innhold eller endrer hvilke elementer et kurs har:
  - kursskjemaet (`updateCourse`, `/content`, `/items`, `/modules`);
  - publisering: «Publiser kurs», «Publiser nye versjoner», seksjon og modul fra egen side, kalibrering;
  - arkivering, avpublisering og gjenoppretting av kurs, modul og seksjon;
  - sletting: kurs med alt innhold (`courseCascadeDeleteService.ts:192`), kurs (`courseCommands.ts:330`), modul
    (`adminContentCommands.ts:346`), seksjon (`sectionCommands.ts:502`);
  - levende redigering: seksjonens tittel og innhold (`sectionCommands.ts:225, 241`), modulens tittel
    (`adminContentCommands.ts:232`);
  - import, begge modusene, og modulimport.
- **Delt** for dem som må lese en fast versjon: utstedelse av kursbevis (alle tre veiene), oppretting av
  innlevering og registrering av lesing. Delte låser venter ikke på hverandre, bare på en som skriver innhold.
- **Alt sjekkes etter låsen, inne i transaksjonen:** hvilke kurs som berøres, «ligger ikke i noe kurs», hva en
  sletting tar med seg, at kildeversjonen for kalibreringen fortsatt er aktiv, og hvilken versjon som er aktiv. En
  forhåndsvisning som ble regnet ut før, er bare et forslag. Stemmer den ikke med det som regnes ut etter låsen,
  avvises handlingen med 409, og ingenting er skrevet.

**Deltakerlåsen** er én rådgivende lås per deltaker (nøkkel fra `userId`), eksklusiv. Den tas av alt som endrer hva
en deltaker har gjort: innlevering, vedtak (`decisionService.ts:397, 461` og `decisionLineageService.ts:53`, altså også
manuell vurdering og anke), registrering av lesing, og utstedelse av kursbevis for personen.

**Fast rekkefølge:** innholdslåsen først, så deltakerlåsen. En transaksjon som har tatt deltakerlåsen, tar aldri
innholdslåsen etterpå. Vedtakene trenger ikke innholdslåsen: de legger kontrollen av kursbevis i outboxen
(`AssessmentDecisionApplicationService.ts:176`, `manualReviewService.ts:262`, `appealService.ts:383`), og den kjører i
en egen transaksjon. Med én rekkefølge kan låsene ikke låse hverandre fast.

**Én hjelpefunksjon:** `withContentLock(tx, "exclusive" | "shared")` og `withLearnerLock(tx, userId)`. De gir tilbake
en merket transaksjonsklient, og funksjonene som skriver innhold (`applyCourseVersionChange`, `setCourseItems`,
publiseringene) tar bare imot den merkede typen. Glemmer en ny vei låsen, kompilerer den ikke. I tillegg kommer en
vakttest (samme tanke som `test/course-version-write-guard.test.js`): enhver transaksjon som skriver `CourseItem`,
`Course`, `Module`, `ModuleVersion`, `CourseSection`, `CourseSectionVersion` eller `SectionAsset`, tar innholdslåsen
først.

**Ventetid:** transaksjonene som tar låsen delt, og deltakerlåsen, setter `lock_timeout` (forslag: 3 sekunder, under
Prismas transaksjonsgrense). Venter de lenger, svarer serveren `503 content_busy`, og siden prøver igjen. Workeren
prøver igjen av seg selv. Det tunge arbeidet i en import (lese fila, forberede bilder) skjer før transaksjonen, som i
dag. Store importer holder likevel låsen i noen sekunder; det er godtatt.

**Det låsene løser** (funn fra Codex):
- runde 1: nr. 2 (arkivering mot innlegging), nr. 3 (låserekkefølge mellom element og kurs) og nr. 11 (kursbevis mot
  krav fra to øyeblikk);
- runde 2: nr. 3 (et nytt kurs får modulen etter publiserers siste sjekk), nr. 4 (sletting etter en utdatert
  analyse), nr. 6 (bestått og lest var aldri oppfylt samtidig) og nr. 10 (kalibreringen kloner en gammel versjon);
- tildelingen av modulversjonsnummer (5a-2) skjer også under den eksklusive låsen, så to publiseringer kan ikke få
  samme nummer.

**Det som fjernes:** låsing per kurs i sortert rekkefølge (`lockCourseRows`, planlagt for hull 3), delt og eksklusiv
lås på elementradene, og dagens `lockCourseRow` (`courseVersioning.ts:44`, brukt i `:102` og
`coursePublishService.ts:468, 668`) og `lockCourseRowShared` (`courseVersioning.ts:54`, brukt i
`courseRepository.ts:137`). Innholdslåsen gjør jobben deres. Grensen `publishedAt` for en ny hovedversjon er like
ekte som før: en lesing tar låsen delt og venter på en versjonsendring.

**Ikke en lås:** telleren `contentRevision` i 4a. Den gjelder en fane som har stått åpen, ikke to som skriver samtidig.

### 4a — innholdslåsen, kursskjemaet og overgangen

**Hva Codex fant, sjekket i koden:**
- Skjemaet sender hele elementlista ved hver lagring, også når forfatteren ikke har rørt den
  (`admin-content-courses.js:2328`). En fane som har stått åpen, skriver da over det en annen har lagret.
- Når elementene er uendret, lagrer skjemaet i to kall: først navnet (`PUT /:courseId`), så elementene
  (`PUT …/items`). Har noen andre endret elementene, kan det andre kallet kreve versjonssvar og avvises etter at
  navnet er lagret.
- At prod har kjørt 2.130.1 en stund, lukker ingen fane. Serveren må avvise gamle faner.
- **Feiler lastingen av elementlista, bruker skjemaet en gammel liste med bare moduler**
  (`admin-content-courses.js:1529–1538`). Lagres skjemaet da, slettes alle seksjonene fra kurset. Det kan skje
  allerede i dag, fordi skjemaet sender lista også når den ser uendret ut.

**Løsningen:**
- **Innholdslåsen** bygges her, med hjelpefunksjonen, vakttesten og overgangen fra `lockCourseRow` og
  `lockCourseRowShared` (se «Låsene»).
- **En teller på kurset:** `Course.contentRevision` (heltall, starter på 0) øker hver gang kursets innhold eller
  innstillinger lagres. Kursdetaljen (`GET /courses/:id`) sender den med. `claimCourseRevision(client, courseId,
  expected?)` sjekker og øker den, etter innholdslåsen. Er den endret siden skjemaet ble lastet: `409
  course_changed`, og ingenting er skrevet. Uten `expected` (importen) øker den bare.
- **Kursskjemaet lagrer et eksisterende kurs i ÉTT kall,** alltid til `PUT /courses/:id/content`: innstillingene,
  `items` (alltid med), `version` når spørsmålet ble stilt, og `expectedRevision`. Ved 409 beholder skjemaet det
  forfatteren skrev, og ber hen laste siden på nytt.
- **Ingen reserveliste:** feiler `GET …/items`, viser skjemaet en feilmelding og kan ikke lagres. Den gamle lista med
  bare moduler (`admin-content-courses.js:1535–1537`) fjernes.
- **Gamle faner avvises før første skriving:**
  - `PUT /:courseId` og `PUT …/content` uten `expectedRevision` gir `409 course_form_outdated`. Det er det
    første kallet en gammel fane gjør, både når elementene er endret og når de ikke er det. Dermed lagres verken
    navn eller innhold.
  - `PUT …/items` og legacy `PUT …/modules` uten `expectedRevision` godtas bare for et kurs som aldri har vært
    ute (samme regel som `applyCourseVersionChange`: ikke publisert, ingen delingslenke, ingen kursbevis). Det er
    veien for agent-tokenet (`agentTokenScope.ts:19`, bare utkast) og for et nytt kurs fra skjemaet. Ellers `409
    course_form_outdated`.
  - `versionAware` godtas fortsatt, men betyr ingenting. Overgangen i `adminCourses.ts:537–542` fjernes.
- **Hull 2:** `getCoursePublishPreview`, `getCoursePendingVersions` og `countCertificateHolders` tar klienten som
  parameter (`coursePublishService.ts:471, 559–628, 669`). Det sparer forbindelser i poolen, selv om låsen nå tar seg
  av samtidigheten.
- **Hull 3** forsvinner: med én lås finnes det ingen rekkefølge å komme i utakt med.

**Veier inn** (alle som skriver kursets elementer eller innstillinger; alle tar innholdslåsen og kaller
`claimCourseRevision`):
- kursskjemaet: `admin-content-courses.js:2193–2330` og lastingen `:1526–1543`; rutene `adminCourses.ts:424`
  (`PUT /:courseId`), `:449` (`/content`), `:472` (`/modules`), `:515` (`/items`);
- `updateCourse` (`courseCommands.ts:132`), `setCourseItems` (`:375`), `setCourseModules` (`:457`);
- importen: `contentImportService.ts:1060` (`updateExisting`), `:1103` (`replaceExisting` og nytt kurs), `:1114`
  (eldre filformat);
- alle de andre innholdsskriverne i «Låsene» tar bare låsen.

**Samtidighet:**
- To faner på samme kurs: den første lagrer, den andre får 409. Ingen skriver over den andre.
- To publiseringer, en publisering og en innlegging, en arkivering og en innlegging, eller en sletting og en
  endring: den ene venter på den andre, og sjekker etterpå det den andre har gjort. Ingen 500 fra fastlåsing.

**Utrulling:**
- Gammel fane mot ny server: første kall gir 409, og ingenting er lagret. Forfatteren laster siden på nytt.
- Ny klient mot gammel server: `/content` finnes og lagrer navn og innhold i ett kall uten tellerkontroll, som i
  dag. Prod er én instans, så vinduet er bare selve utrullingen (se «Kjente mangler»).
- Migreringen er additiv (ny kolonne med standardverdi).

**Bevis:**
- integrasjonstest: to faner; A lagrer, så B → B får 409, og ingenting av B er skrevet. Både med og uten endrede
  elementer;
- integrasjonstest: den gamle klientens rekkefølge (`PUT /:courseId`, så `PUT …/items` med `versionAware`) →
  første kall gir 409, og navnet er uendret;
- e2e: et kurs med seksjoner der `GET …/items` feiler → skjemaet viser feil og kan ikke lagres; seksjonene står;
- integrasjonstest med to samtidige transaksjoner, for hvert par: publisering mot publisering (kurs som deler et
  element), publisering mot innlegging av modulen i et annet kurs, arkivering mot innlegging, sletting med alt
  innhold mot at en seksjon tas ut av kurset, og kalibrering mot ny hovedversjon. Ingen 500, og utfallet er det samme
  som om de hadde kommet etter hverandre;
- vakttesten: en ny innholdsskriver uten låsen gjør testen rød (mutasjonssjekk: fjern låsen i én skriver);
- `PUT …/items` uten teller på et utkast (agent-tokenet) virker som før.

**QA stopper på:** halv lagring, at en fane skriver over en annens endring, at seksjoner forsvinner, 500 ved
samtidige endringer, eller en innholdsskriver uten låsen.

### 4a — bygget (2.131.0)

- **Låsen:** `src/db/contentLock.ts`. `runContentWrite` åpner transaksjonen og tar låsen eksklusivt som første
  setning; `runContentRead` tar den delt. Begge gir en merket klient (`ContentWriteTx`/`ContentReadTx`). Låsen tas
  ikke andre steder, og en innholdstransaksjon inne i en annen stopper med én gang (den ville ventet på sin egen
  lås). Venter en skriver lenger enn 15 sekunder, eller en leser lenger enn 3, svarer serveren `503 content_busy`;
  ventetiden kommer i tillegg til transaksjonens arbeidstid, så Prisma ikke ruller tilbake med 500 mens den venter.
- **Vakta:** `test/content-lock-write-guard.test.js` bruker TypeScripts typesjekker: enhver skriving til
  `CourseItem`, `Course`, `Module`, `ModuleVersion`, `CourseSection`, `CourseSectionVersion`, `SectionAsset` og
  `CourseVersion` i `src/` må skje på en klient med merket. Unntak per funksjon: de to vedlikeholdsskriptene.
- **Kurslåsene er borte:** `lockCourseRow` og `lockCourseRowShared`. Registrering av lesing (`courses.ts`) tar
  innholdslåsen delt i stedet — det er den ene leseren 4a flytter. De andre delte leserne og deltakerlåsen er 5a-1.
- **Telleren:** `Course.contentRevision` (migrering `20261104180000_course_content_revision`), `claimCourseRevision`
  i `courseVersioning.ts`. Kursdetaljen sender den. Skjemaet lagrer et eksisterende kurs i ÉTT kall til
  `PUT …/content` med `expectedRevision`, også når elementene er uendret. `409 course_changed` beholder det
  forfatteren skrev.
- **Gamle faner:** `PUT /:courseId` og `PUT …/content` uten teller gir `409 course_form_outdated`. `PUT …/items` og
  `PUT …/modules` uten teller godtas bare for et kurs som aldri har vært ute, sjekket etter låsen. `versionAware`
  godtas og betyr ingenting.
- **Ingen reserveliste:** feiler `GET …/items`, sier skjemaet fra og lagrer ikke.
- **Forhåndsvisninger etter låsen:** «Publiser kurs» uten upubliserte elementer ser på nytt (`publishCourseChecked`,
  409 og spørsmålet hvis et utkast er lagt inn); kaskaden og «Publiser nye versjoner» sjekker også publiserbarhet og
  #997-svaret på nytt; «Slett med alt innhold» får det forhåndsvisningen viste (`expectedDeleted…Ids`) og svarer
  `409 course_cascade_changed` hvis det er endret (uten det: `409 course_form_outdated`); «Oppdater dette kurset» sammenligner det planen bygde på
  (`courseUpdateBasis`) og svarer `409 import_target_changed`.
- **Hull 2:** forhåndsvisningene og tellingen tar klienten som parameter, og leser på den låste transaksjonen.
- **Hull 3:** borte; det finnes bare én lås.

**Veier inn, slik de ble dekket** (grepet etter skrivere, ikke kallere, 2026-11-04). Alle tar innholdslåsen; de
merket «teller» kaller også `claimCourseRevision`:
- kurs: `createCourse`, `updateCourse` (teller), `setCourseItems` (teller), `setCourseModules` (teller), `publishCourse` (bare med låst
  klient), `publishCourseChecked`, `publishCourseCascade`, `publishCoursePendingVersions`, `unpublishCourse`,
  `archiveCourse`, `restoreCourse`, `deleteCourse`, `cascadeDeleteCourse`, `assignCourseSlugIfMissing`;
- moduler: `createModule`, `updateModuleTitle`, `composeModuleVersion` (også `updateModuleDetails`),
  `createModuleVersion`, `restoreModuleVersion`, `appendMcqQuestions`, `publishModuleVersion`,
  `publishModuleVersionWithThresholds` (kalibrering), `unpublishModule`, `archiveModule`, `restoreModule`,
  `deleteModule` (G2 flyttet fra ruta inn i transaksjonen), **`purgeUnpublishedModules`** (manglet i planen; sjekker
  hver kandidat på nytt etter låsen);
- seksjoner: `createSection`, `createSectionWithAssets`, `updateSectionTitle`, `updateSectionContent`,
  `publishSection`, `unpublishSection`, `archiveSection`, `restoreSection`, `deleteSection`;
- bilder: **`createSectionAsset`** (opplasting) og **`localizeSectionAssets`** (oversatte SVG-er) — begge manglet i
  planens liste; raden skrives under låsen, fila lastes opp før;
- import: `importModuleFromEnvelope`, **`importSectionFromEnvelope`** (manglet i planen), `importCourseFromEnvelope`
  (alle tre modusene, teller);
- bevisste unntak: `collapseDuplicatedLocalizedTitles` og `repairUnreadableSvgAssets` (vedlikeholdsskript).

**Bevis:** `test/m2-content-lock-934-4a.test.ts` (to faner med og uten endrede elementer, fire samtidige lagringer,
den gamle klientens rekkefølge, utkast uten teller, arkivering mot innlegging begge veier, sletting med alt innhold
mot uttak, to «Publiser kurs» med delt element, «Publiser kurs» mot et utkast lagt inn, kalibrering mot ny versjon,
lesing bak en lang skriving gir 503, nestet transaksjon), `test/e2e/admin-content-course-lock-934-4a.spec.ts`
(elementlista feiler, også etter at hodet er tegnet på nytt; ett kall med teller; 409; 390 px) og vakta.

**QA-porten** (2026-11-04): runde 1 NO-GO — kaskaden sammenlignet ikke versjonene (en ny utkastversjon lagret mens
publiseringen ventet, ble publisert), og modulrutene gjorde 503 om til 400. Begge rettet. Runde 2 NO-GO — importens
grunnlag manglet telleren (en lagring som bare endret navn eller innstillinger, ble skrevet over), en full
forbindelsespool ga 500 (P2028) i stedet for 503, og oversatte SVG-er ble liggende i lageret ved 503. Alle tre
rettet og mutasjonssjekket der det finnes en test (se «Kjente mangler» nr. 16–17). Runde 3 er ikke kjørt.

### 4b — e-post ved ny hovedversjon

**Hva Codex fant (runde 1 nr. 6 og 7), sjekket i koden:**
- #997-avsenderen sjekker ikke revisjonssporet (`participantNotificationService.ts:489`). Forrige plan bygde på
  at den gjorde det.
- En leiekontrakt i outboxen som går ut (`outboxService.ts:114–124`), kan gi et nytt forsøk mens det første
  fortsatt sender.
- En hovedversjon kan lages mens kurset er avpublisert, og importen kan avpublisere kurset i samme transaksjon
  (`contentImportService.ts:1136–1153`). «Hovedversjon laget» betyr derfor ikke alltid «ny versjon tilgjengelig».
- En innstilling som stopper innleggingen i outboxen, mister e-postene for godt.

**Løsningen: én rad per person og versjon, sendt av workeren.**
- **Ny tabell `CourseVersionNotice`** med unik nøkkel `(courseId, versionMajor, userId)` og status: `waiting`
  (venter), `queued` (lagt i outboxen), `sending`, `sent`, `skipped` (ikke aktuell lenger), `uncertain` (kan ha
  gått), `failed`.
- **Radene lages i `applyCourseVersionChange`** når resultatet er en hovedversjon, i samme transaksjon som økningen.
  Alle veier til en hovedversjon går dit: skjemaet, «Publiser nye versjoner», «Publiser kurs», import med
  `replaceExisting`, og modulveiene fra 5a-3. Radene lages også når e-posten er slått av, så ingen e-post går tapt.
- **Mottakerne** regnes ut av én funksjon, `findMajorVersionRecipients(client, courseId)`: har kursbevis for kurset
  (for en eldre hovedversjon, siden den nye ikke har noen ennå), `activeStatus = true` og `isAnonymized = false`,
  én per person. Dialogene viser tallet fra den samme funksjonen (`majorEmailRecipients` i kursdetaljen,
  `publish-preview` og `pending-versions`). Tallet kan være høyere enn `certificateHolders`, som bare teller
  nåværende hovedversjon.
- **Over 200 mottakere** (produkteier 2026-11-03): dialogen krever et ekstra «ja», og klienten sender
  `confirmEmailRecipients` med tallet den viste. Serveren teller på nytt i transaksjonen. Er tallet over 200 og ikke
  bekreftet, eller bekreftet lavere, avvises endringen med `409 major_email_confirm_required` og tallet. Ingenting er
  skrevet. En gammel klient sender aldri feltet og avvises derfor over 200.
- **Når den sendes:** en liten jobb i workeren, som påminnelsene (`CourseReminderMonitor`), går gjennom
  `waiting`-radene. Den kjører bare når `COURSE_MAJOR_EMAIL_ENABLED=true` på workeren:
  - kurset er publisert og har fortsatt denne hovedversjonen → raden legges i outboxen
    (`course_major_version_notification`, med radens id), med `availableAt` spredt utover (om lag 20 i minuttet).
    Raden settes til `queued` i samme transaksjon;
  - kurset er avpublisert → raden venter. Den sendes når kurset er publisert igjen;
  - kurset har fått en nyere hovedversjon → `skipped`. E-posten om den nyeste gjelder;
  - personen er inaktiv eller anonymisert nå → `skipped`.
- **Sendingen** (behandleren i outboxen):
  - **sjekker det samme som jobben en gang til** (Codex runde 2 nr. 14): kurset publisert, versjonen fortsatt kursets
    nyeste, personen aktiv og ikke anonymisert. Avpublisert → tilbake til `waiting`. Nyere versjon, eller personen
    borte → `skipped`. Raden kan altså ha stått i køen mens noe endret seg, uten at en utdatert e-post går;
  - setter `queued → sending` med en betinget oppdatering **rett før sendingen** (QA-porten 2.132.0). En feil i
    oppslagene før det lar raden stå i `queued`, så e-posten ikke går tapt. På siste forsøk går den tilbake til
    `waiting`, så jobben legger den inn på nytt;
  - er raden alt `sent`, gjøres ingenting;
  - er den `sending`, ble et tidligere forsøk avbrutt, og e-posten kan ha gått. Raden blir `uncertain` og sendes
    ikke på nytt (samme valg som #1115);
  - vellykket → `sent`. Sikker feil → tilbake til `queued`, og outboxen prøver igjen;
  - typen registreres i `SENDS_TO_A_PERSON` (`outboxService.ts:160`).
- **Innhold:**
  - kursnavnet på mottakerens språk (nb, nn, en-GB) og «versjon 4»;
  - hva som er nytt: antall nye eller endrede elementer. Tallet regnes ut når hovedversjonen lages (seksjoner med ny
    versjon, elementer lagt til, og fra 5a-3 moduler med hevet krav) og lagres på `CourseVersion`-raden for N
    (`changedItemCount`, ny kolonne);
  - at det gamle kursbeviset fortsatt gjelder sin versjon;
  - «Logg inn på A-2 læringsplattform og åpne kurset under Mine kurs». **Ingen lenker** (firmapolicy, #1139).
  - Avsender som påminnelsene. Tonen som i #1139: voksen, litt humor, aldri skam.
- **Bildet** (valgt av produkteier 2026-11-03): seilbåten står på bukker i båtverftet og får et nytt strøk maling.
  Seilet er rullet sammen, og båten smiler. Det er variant A, `scene-6a-service.png` fra bildeutkastene
  (`codex-bilder`). Bildet skaleres til 600×200 JPEG under 30 KB og legges i repoet når skiva bygges (stien bestemmes
  da, for eksempel `src/assets/email/kurs-ny-versjon.jpg`). Utkastet ligger i en midlertidig mappe og må kopieres inn.
  Alt-tekst på bokmål: «Båten står på bukker i båtverftet og får et nytt strøk maling». Nynorsk og engelsk oversettes.
- **HTML og ren tekst, med bildet som innebygd vedlegg (CID).** Bildet hentes ikke fra noen nettadresse.
  `sendViaAcs` sender i dag bare ren tekst (`participantNotificationService.ts:188–206`). #1139 planlegger den samme
  utvidelsen. Det blir **én felles funksjon**, laget av den saken som bygges først; den andre bruker den. Kanalene
  `log` og `webhook` får ren tekst.
- **E-posten fra #997** (`sendModuleRevisedNotification`) står til 5a-3. Der erstattes den av denne.

**Samtidighet:**
- To hovedversjoner etter hverandre gir rader for begge. Har den eldste ikke gått ennå, sendes bare den nyeste.
- Et nytt forsøk på samme økning lager ingen nye rader (unik nøkkel).
- To workere som tar samme rad: den betingede oppdateringen slipper bare én gjennom.

**Utrulling:**
- Ingen rad i outboxen får den nye typen før workeren med jobben er oppe og innstillingen er på. En gammel worker
  møter derfor aldri typen og kan ikke bruke opp forsøkene.
- Innstillingen slås på etter at app og worker begge viser ny versjon (`/version`). Rader laget før det, venter og
  sendes da, hvis versjonen fortsatt er kursets nyeste.
- Gammel klient mot ny server: over 200 mottakere avvises (se over); ellers som før.
- Ny klient mot gammel server: `confirmEmailRecipients` ignoreres, og det sendes ingen e-post. Den gamle serveren har
  ingen.

**Bevis:**
- integrasjonstest: hovedversjon gir én rad per mottaker; inaktive, anonymiserte og dem uten kursbevis er utelatt;
  ingen rader ved mindre versjon;
- integrasjonstest: et nytt forsøk på samme økning gir ingen nye rader; behandleren kjørt to ganger på samme rad
  sender én gang; en rad som står i `sending`, blir `uncertain` og sendes ikke;
- integrasjonstest: avpublisert kurs → raden venter; publisert igjen → sendt; nyere hovedversjon → `skipped`; det
  samme når endringen skjer mens raden står i køen;
- integrasjonstest: tallet i dialogen er lik antall rader; over 200 uten bekreftelse → 409 og ingenting skrevet;
- enhetstest av teksten: riktig språk; verken `http`, `www` eller `href` i HTML eller ren tekst; bildet er med som
  CID og har alt-tekst.

**QA stopper på:** e-post ved mindre versjon, dobbel e-post, e-post til feil person, lenke i e-posten, eller at
tallet i dialogen og antall e-poster ikke stemmer.

### 4b — bygget (2.132.0)

- **Radene:** `CourseVersionNotice` (migrering `20261104220000_course_version_notice`), unik på (kurs, hovedversjon,
  person). `applyCourseVersionChange` lager dem når resultatet er en hovedversjon, i samme låste transaksjon som
  økningen (`createMajorVersionNotices`, `skipDuplicates`), også når e-posten er av. Vakta
  `test/course-version-write-guard.test.js` nekter at rader lages andre steder.
- **Mottakerne:** `findMajorVersionRecipients` (`courseVersioning.ts`): kursbevis for kurset, aktiv, ikke anonymisert,
  én per person. `countMajorVersionRecipients` bruker samme vilkår og gir `majorEmailRecipients` i kursdetaljen,
  `publish-preview` og `pending-versions`.
- **Over 200:** tallet telles på nytt etter låsen. Over 200 og ikke bekreftet, eller bekreftet lavere: `409
  major_email_confirm_required` (`details.majorEmailRecipients`), og transaksjonen rulles tilbake. Feltet
  `confirmEmailRecipients` tas imot av `PUT …/content`, `PUT …/items`, `POST …/publish`, `POST …/publish-pending` og
  importen. De tre dialogene viser tallet og krever en avkrysning over 200 (`courseVersionAnswer`); uten den sendes
  ingenting.
- **Hva som er nytt:** `CourseVersion.changedItemCount` — seksjoner med ny versjon eller nye i kurset, og moduler som er
  blitt levende i kurset (`countChangedItems`). Øyeblikksbildet før endringen tas av `snapshotContent`
  (kursrepositoriet), som alle fire veiene med spørsmål bruker.
- **Jobben:** `CourseMajorEmailMonitor` → `runCourseMajorEmailSchedule` (`courseMajorVersionEmail.ts`), hvert minutt,
  bare med `COURSE_MAJOR_EMAIL_ENABLED=true` og en varselkanal som er på. Høyst 20 per runde, tre sekunder imellom
  (`availableAt`). Nyere hovedversjon eller personen borte → `skipped`; avpublisert eller arkivert → venter. En rad
  som har stått i `sending` i over 30 minutter (outboxen ga opp etter sin tidsgrense), blir `uncertain`.
- **Behandleren:** `deliverCourseMajorVersionNotice`. `queued → sending` betinget, så samme regel (`judgeNotice`) en
  gang til. `sending` funnet → `uncertain`, ikke sendt. Avbrutt underveis → `uncertain`; sikker feil → `queued` og nytt
  forsøk; siste forsøk → `failed`; kanalen av → tilbake til `waiting`; en tittel som ligner en lenke → `failed`
  (`contains_link`). Typen står i `SENDS_TO_A_PERSON`.
- **E-posten:** `buildCourseMajorVersionEmail` med teksten fra `getCourseMajorVersionNotificationMessage` (nb, nn,
  en-GB; mottakerens språk). **Den felles malen** for #1139 og #1141: `renderIllustratedEmail` (`illustratedEmail.ts`)
  lager HTML (tabeller, bildet øverst som `cid:`), ren tekst og vedlegget, og nekter alt som ligner en lenke;
  `deliverIllustratedEmail` sender den — ACS med HTML, vedlegg og `disableUserEngagementTracking`, `log` og
  `webhook` bare ren tekst. `sendViaAcs` tar `html` og `attachments`. Scenene står i `EMAIL_ILLUSTRATIONS`.
- **Bildet:** `src/assets/email/kurs-ny-versjon.jpg`, 600 × 200, 16 KB (skalert med Chromium fra
  `scene-6a-service.png`). Lest fra disk ved første sending; hele repoet følger med i utrullingen.
- **#997-e-posten** (`sendModuleRevisedNotification`) står urørt til 5a-3.

**Veier inn til en hovedversjon** (grepet etter kallere av `applyCourseVersionChange` med `kind: "question"`,
2026-11-04): kursskjemaet (`PUT …/content` → `updateCourse` → `writeCourseItems`), `PUT …/items` (`setCourseItems`),
«Publiser nye versjoner» (`publishCoursePendingVersions`), «Publiser kurs» med nytt innhold (`publishCourseCascade`),
og import med `replaceExisting` (`setCourseItems`, og `setCourseModules` for eldre filformat). Alle andre kall ber om
mindre versjon (`kind: "minor"`) og kan ikke gi en hovedversjon. Modulveiene kommer i 5a-3.

**Bevis:** `test/m2-course-major-email-934-4b.test.ts` (gjennom rutene: én rad per mottaker fra hver vei, ikke ved
mindre versjon, én per person med flere bevis, nytt forsøk uten nye rader; 200 uten bekreftelse, 201 avvist uten og med
lavere tall og ingenting skrevet, godtatt med tallet gjennom skjemaet, `/items`, «Publiser nye versjoner», «Publiser
kurs» og importen; jobben: køen i samme transaksjon, spredning, 20 per runde, to runder samtidig, avpublisert venter,
to hovedversjoner etter hverandre, inaktiv og anonymisert, `sending` som henger; behandleren: sendt på mottakerens
språk, levert to ganger sender én gang, `sending` → `uncertain`, ny sjekk av alle tre forholdene, utfallene, kanalen
av, lenke i tittelen, to forsøk samtidig), `test/unit/course-major-version-email-934-4b.test.ts` (språk, ingen
`http`/`www`/`href`, CID og alt-tekst, ren tekst uten bilde, bildefila, ACS- og webhook-formen),
`test/unit/outbox-service.test.ts`, `test/unit/course-major-email-monitor-934-4b.test.ts`,
`test/e2e/admin-content-course-major-email-934-4b.spec.ts` (tallet i de tre dialogene, avkrysningen over 200, 409, 390
px). Mutasjonssjekket: 45 av 45 røde (M18, køen uten betingelse, overlevde først — testen med to runder samtidig
avhenger av tidspunkter; `queueNotice` ble skilt ut og testet direkte).

**QA-porten** for rettingene i 2.132.1 (2026-11-05): samlet med 5a-1 og 5a-2, se «5a-2 — bygget».

### 5a — modulens beståtte status per kurs

**Hvorfor dagens #997 ikke holder:** «erstatter tidligere bestått» setter `CertificationStatus` til `SUPERSEDED` for
alle som har bestått modulen, uansett kurs (`certificationRepository.ts:74`, kalt fra `adminContentCommands.ts:1016`).
Med valg per kurs kan modulen være hovedversjon i kurs A og mindre versjon i kurs B.

**Hva Codex fant, sjekket i koden:**
- Å sammenligne tidspunkter er feil. `passedAt` er når vedtaket ble fattet (`certificationStatusService.ts:47`). En
  innlevering på den gamle versjonen som vurderes eller vinner en anke etter publiseringen, ville telt.
- Å kopiere seksjonsregelen (forrige hovedversjon mot nåværende) slipper gjennom den som hoppet over en
  hovedversjon.
- Én statusrad per person og modul kan ikke bære to kurs. Et stryk på et nytt forsøk for kurs A overskriver raden
  med `NOT_CERTIFIED` (`certificationStatusService.ts:50–73`) og tar beståtten fra kurs B.
- Kursbeviset utstedes etter flere separate spørringer uten lås (`courseCompletionService.ts:73–105`). En anke og en
  lesing kan komme imellom, så bestått og lest aldri var oppfylt samtidig.
- En deltaker som skrev svaret på den gamle oppgaven og leverer etter at en ny er publisert, får den nye versjonen
  registrert (`submissionService.ts:90–106`). Det samme gjelder en lesing av en gammel tekst.
- «Publiser kurs» setter også moduler live som har vært publisert før og så er avpublisert
  (`coursePublishService.ts:161`: «upublisert» betyr bare at modulen ikke har en aktiv versjon nå). De kan ha
  beståtte.
- Den gamle avkrysningen kan brukes på den versjonen som allerede er aktiv (`adminContentCommands.ts:1003–1016`). Da
  peker `SUPERSEDED` på samme versjon som de beståtte den tok bort. En tilbakefylling som bare ser på
  versjonsrekkefølgen, kunne gitt dem beståtten tilbake.
- En ny klient mot gammel server: skjemaet fjerner `courseVersions` uten å si fra (`adminContent.ts:964`). «Publiser
  nye versjoner» manglet svar for de andre kursene modulene ligger i.

**Regelen:**
- **Hver modulversjon får et versjonsnummer, hoved.mindre,** første gang den publiseres (se «Data» over). Nummeret
  endres aldri etterpå. `versionNo` står som løpenummer. Nummeret settes ett sted: der modulens aktive versjon settes
  (`adminContentRepository.ts:704`), under den eksklusive innholdslåsen. Alle publiseringer går gjennom det stedet,
  også kalibreringen (`adminContentCommands.ts:1302`). Første publisering gir 1.0.
- **Kravet per kurs og modul:** for hvert kurs C og hver modul M lagres den laveste hovedversjonen av M som teller i C
  (ny tabell `CourseModuleRequirement`, unik `(courseId, moduleId)`, feltet `minModuleMajor`).
  - Kravet **heves** bare når C får en hovedversjon på grunn av en ny versjon av M. Da blir det Ms nye hovedversjon.
  - Kravet **senkes aldri.** Det står gjennom senere hovedversjoner av kurset til deltakeren har bestått. Den som
    hoppet over en hovedversjon, er dermed dekket.
  - Når M legges inn i C, settes kravet til Ms nåværende hovedversjon. Det er som i dag: etter en #997-revisjon
    teller eldre beståtte ikke noe sted.
  - Når M tas ut av C, slettes raden.
- **Beståtte per innlevering:** ny tabell `ModulePass`, én rad per bestått innlevering, med `moduleVersionId` fra
  vedtaket. Den skrives ett sted, `upsertCertificationStatusFromDecision` (`certificationStatusService.ts:31`), som
  alle vedtak går gjennom, under deltakerlåsen:
  - `decisionService.ts:397 → :416` (bare flervalg);
  - `decisionService.ts:461 → :505` (automatisk vurdering, når den ikke går til manuell vurdering);
  - `decisionLineageService.ts:53 → :77` (manuell vurdering, `manualReviewService.ts:224`, og anke,
    `appealService.ts:341`).

  Bestått vedtak → raden for innleveringen lages eller oppdateres. Et senere vedtak på **samme** innlevering som
  stryker (overprøving eller anke) → raden for den innleveringen slettes. Et stryk på en **annen** innlevering rører
  ingenting: **en bestått står til modulen revideres** (produkteier 2026-11-03, svar f, i tråd med #989).
- **Ugyldiggjort før 5a:** `ModulePass.invalidatedAt` settes bare av tilbakefyllingen, for beståtte som #997 tok bort
  (se 5a-2). En slik rad teller aldri. Etter at regelen er slått på, settes feltet ikke lenger; da er det kravet per
  kurs som gjør jobben.
- **En modul teller for kurs C** når deltakeren har en `ModulePass` som ikke er ugyldiggjort, og der vedtakets
  modulversjon har hovedversjon større enn eller lik kravet for (C, M). Tidspunktet spiller ingen rolle.
- **Én funksjon for alle lesere:** `findCreditedModuleIds(client, userId, courseId)`, og en variant for mange kurs
  eller mange deltakere, i kursrepositoriet, slik seksjonsregelen er.
- **`CertificationStatus` skrives som før.** Den brukes av det som gjelder modulen uten kurs
  (`reviewAppealReport.ts:181`, via `reportingRepository.ts:237`), men ikke lenger til fremdrift i kurs.
- **En importert kopi av en modul arver ikke beståtte**, som i dag (produkteier 2026-11-04). Kopien er en ny modul i
  kurset, og kravet for den blir 1.

**Sannhetstabell** (kurs C, modul M; deltakeren besto M i hovedversjon 1):

| Hendelse | Kravet i C | Teller beståtten i C? |
|---|---|---|
| M publiseres som mindre (1.1), eller kalibreres | 1 | Ja |
| M publiseres som hoved (2.0), C velger mindre | 1 | Ja |
| M hoved (2.0), C velger hoved, og noen har kursbevis i C | 2 | Nei, før bestått på 2.x |
| M hoved, C velger hoved, men ingen har kursbevis i C | 1 (C blir mindre, svar d) | Ja |
| Rett etter publiseringen | Hevet i samme transaksjon som versjonen settes live | Ingen glipe |
| Hoppet over: C 2.0 hevet kravet til 2; C 3.0 rører ikke M | 2 | Nei, før bestått på 2.x |
| M 2.1 etter at kravet ble 2 | 2 | Bestått på 2.0 og 2.1 teller |
| Innlevering på 1.x vurdert eller anket etter at 2.0 kom | 2 | Nei i C; ja i kurs der kravet er 1 |
| Deltakeren skrev på 1.x og leverer etter at 2.0 kom | — | Innleveringen avvises (5a-1); utkastet står |
| Nytt forsøk for kurs A stryker | uendret | Beståtten på 1.x teller fortsatt i kurs med krav 1 (svar f) |
| Anke snur bestått til stryk på samme innlevering | uendret | Den innleveringen teller ikke lenger |
| M legges inn i C senere | Ms nåværende hovedversjon | Bare bestått på den eller nyere |
| Gammel `SUPERSEDED`-rad fra #997 | Tilbakefylt til Ms nåværende hovedversjon | Nei, ugyldiggjort (svar c) |
| C har aldri vært publisert | uendret | Som før |
| Importert kopi av M i C | 1 for kopien | Nei, kopien har ingen beståtte |
| En eldre modulversjon med lavere hovedversjon publiseres på nytt | — | Avvises (`409 module_version_outdated`). «Gjenopprett» lager en ny versjon. Ellers kunne kravet aldri oppfylles |
| Den aktive versjonen publiseres på nytt som hoved | — | Avvises. Et nummer som er gitt, endres ikke |

**Kursbeviset:** `moduleSnapshotJson` beholder formatet, en liste med modul-id-er. Utstedte kursbevis og
slettesperren leser det som før (`routes/courses.ts:224`, `contentLifecycle.ts:124`). Hvilket vedtak som oppfylte
kravet, lagres ikke på beviset; det er ikke bedt om.

5a er delt i tre skiver som hver kan rulles ut alene.

#### 5a-1 — deltakerlåsen, låst utstedelse, versjonen deltakeren så

Bygger på innholdslåsen fra 4a.
- **Deltakerlåsen** bygges her (se «Låsene»). Den tas av innlevering, alle vedtaksveier, lesing og utstedelse.
- **Utstedelsen:** `evaluateCourseCompletion` (`courseCompletionService.ts:18`) kjører i en egen kort transaksjon per
  kurs: innholdslåsen delt, så deltakerlåsen, og så leses kursets versjon, elementer, krav, beståtte og lesinger. Det
  gjelder alle tre veiene inn: workeren (`:120`, via `outboxService.ts:186`), lesingen (`:139`, kalt fra
  `routes/courses.ts:527` i lesingens transaksjon) og sertifikatsiden (`:160`, én transaksjon per kurs, så låsene er
  korte). Ingen innholdsendring, anke eller lesing kan komme midt i.
- **Siden sender versjonen deltakeren så:**
  - innlevering: deltakersiden sender id-en til modulversjonen den viste. `createSubmission`
    (`submissionService.ts:90–106`) tolker svaret først, og leser så aktiv versjon i transaksjonen, under
    innholdslåsen delt og deltakerlåsen;
  - lesing: `GET /courses/:courseId/sections/:sectionId` (`routes/courses.ts:470–485`) sender også id-en til
    seksjonsversjonen. `POST …/read` sender den tilbake, og `markSectionRead` (`courseRepository.ts:135`) sjekker den
    under innholdslåsen delt og deltakerlåsen;
  - er versjonen ikke lenger aktiv: `409 module_version_changed` eller `409 section_version_changed`. Ingenting er
    skrevet. Utkastet ligger igjen i nettleseren, og siden ber deltakeren laste på nytt;
  - mangler id-en (en fane fra før utrullingen): `409 client_outdated`, med samme melding. Gamle deltakerfaner må
    lastes på nytt én gang.

**Bevis:**
- integrasjonstest: publisering og utstedelse samtidig, fra workeren og fra sertifikatsiden → beviset er enten for den
  gamle versjonen med det gamle kravet, eller ikke utstedt;
- integrasjonstest: en anke som snur et bestått, og lesing av siste seksjon, samtidig med utstedelsen → aldri
  kursbevis uten at begge var oppfylt samtidig;
- integrasjonstest: innlevering og lesing med utdatert eller manglende versjons-id → 409, ingenting skrevet;
- e2e: deltakeren skriver et svar, forfatteren publiserer en ny versjon, deltakeren leverer → melding, og utkastet
  står.

**QA stopper på:** et kursbevis utstedt mot krav fra to ulike øyeblikk, eller en innlevering eller lesing registrert
på en annen versjon enn den deltakeren så.

#### 5a-1 — bygget (2.133.0)

- **Låsene** (`src/db/contentLock.ts`): `runContentReadForLearner(userId, cb)` tar innholdslåsen delt og så deltakerlåsen;
  `runLearnerWrite(userId, cb)` tar bare deltakerlåsen. Nøkkelen er `pg_advisory_xact_lock(9_340_402, hashtext(userId))`,
  to heltall, så den ikke kan kollidere med innholdslåsen eller revisjonssporet. Venter den over 3 sekunder: `503
  content_busy`. Arbeidstiden i transaksjonen utvides med begge ventegrensene. En ny transaksjon inne i en som holder
  deltakerlåsen, stoppes med en gang (`assertNotNested`), så rekkefølgen ikke kan brytes.
- **Merkene:** `LearnerTx` og `LearnerContentTx`. Disse tar bare imot dem: `submissionRepository.create`,
  `decisionRepository.createAssessmentDecision`, `certificationRepository.upsertCertificationStatus`,
  `courseRepository.markSectionRead` og `createCourseCompletion`, og `upsertCertificationStatusFromDecision` og
  `appendDecisionWithLineage`. Vakta `test/content-lock-write-guard.test.js` nekter i tillegg enhver skriving av
  `CourseCompletion`, `CourseSectionRead`, `AssessmentDecision`, `CertificationStatus` og nye `Submission` på en klient uten
  merket (eller uten den eksklusive innholdslåsen: importen flytter lesinger, #997 setter `SUPERSEDED`).
- **Utstedelsen:** én funksjon, `evaluateCourseCompletionLocked`. Den leser kurset, kravet, beståtte og lesinger inne i
  transaksjonen og skriver beviset der. Kursbevissiden sjekker først uten lås (`findCompletionToIssue`), for den åpnes ofte
  og har sjelden noe å gjøre, og gir opp resten av runden ved `content_busy`.
- **Versjonen deltakeren så:** som beskrevet over. Sjekken ligger etter låsene. For innlevering er det også en rask sjekk
  før dokumentet tolkes. Lesingen sjekker også at seksjonen fortsatt ligger i kurset, etter låsene.
- **Siden:** `apiFetch` prøver igjen ved `503 content_busy` (1, 2 og 4 sekunder), på alt utenom `/api/admin/` (der har
  skriveren ventet i 15 sekunder, og noen ruter gjør flere transaksjoner). Knappene på lesesiden er av
  til teksten er lastet. Ved 409 på innlevering står kladden: den autolagres hvert kvarte sekund, og ved `beforeunload`.

**Veier inn** (grepet 2026-11-04):
- *Kursbevis:* `createCourseCompletion` kalles bare fra `evaluateCourseCompletionLocked`, som har tre veier: workeren
  (`deliverOutboxEvent` → `course_completion_check`, lagt i køen av `AssessmentDecisionApplicationService`,
  `manualReviewService` og `appealService`), lesingen (`POST …/read`), og kursbevissiden (`GET /api/courses/completions` →
  `reconcileCourseCompletionsForUser`). Ingen skript i `scripts/` lager kursbevis.
- *Innlevering:* `POST /api/submissions` → `createSubmission`. Flervalg og vurdering arver versjonen fra innleveringen.
- *Lesing:* `POST …/read` → `markSectionRead`. Importen flytter lesinger under den eksklusive låsen
  (`contentImportService.ts`).
- *Vedtak:* `createMcqOnlyDecision` og `createAssessmentDecision` (`decisionService.ts`), og `appendDecisionWithLineage` fra
  `manualReviewService` og `appealService`. To døde metoder i repositoriene er fjernet.
- *Modulstatus:* `upsertCertificationStatusFromDecision` fra de samme tre, og `supersedeCertificationsForModule` (#997) under
  den eksklusive låsen.
- *Klienter:* `public/participant.js` er den eneste siden som leverer eller registrerer lesing. Stage-testene og
  `scripts/dev/measure-*` er oppdatert.

**Bevis:** `test/m2-learner-lock-934-5a1.test.ts` (gjennom rutene; alle tre veiene til kursbevis mot en ny hovedversjon, et
endret krav og en anke; en ekte hovedversjon samtidig med utstedelsen; alle fire vedtak; 409 og 503 og ingenting skrevet),
`test/content-lock-write-guard.test.js`, `test/unit/content-lock-queue.test.ts`, `test/dom/api-client-content-busy.dom.test.js`,
`test/e2e/participant-seen-version-934-5a1.spec.ts`, `test/stage/release-2-133-deltakerlaas.spec.ts`. Mutasjonssjekket: 34 av
38 røde. De fire som overlevde, gjør ingen forskjell: tre leser fra den globale klienten etter at låsen er tatt, altså det
samme ferske (kurset i utstedelsen, modulversjonen i innleveringen, medlemskapet i lesingen), og den fjerde fjerner sjekken
etter låsene i en test der den raske sjekken stopper først (kappløpstesten måler den). En femte, «kladden lagres ved 409»,
overlevde fordi autolagringen og `beforeunload` allerede gjør det. Den koden er fjernet.

**QA-porten** (2026-11-05): samlet med 2.132.1 og 5a-2, se «5a-2 — bygget».

#### 5a-2 — grunnmur, uten endret regel

Alt er nytt ved siden av det gamle. Ingen leser bytter regel i denne skiva.
- **Først, før tilbakefyllingen bygges:** sjekk ekte data for `SUPERSEDED`-rader som peker på samme versjon som
  vedtaket de tok bort (Codex runde 2 nr. 7). Lesespørring mot stage nå; produkteier kjører den mot prod:

  ```sql
  SELECT count(*) FROM "CertificationStatus" cs
  JOIN "AssessmentDecision" d ON d.id = cs."latestDecisionId"
  WHERE cs.status = 'SUPERSEDED' AND d."moduleVersionId" = cs."supersededByVersionId";
  ```

  Sjekk også at revisjonssporet `module_passes_superseded` fortsatt finnes for alle revisjonene, det vil si at
  oppryddingen av gamle spor (`AuditRetentionMonitor`) ikke har tatt dem.
- **Migrering, additiv:** `ModuleVersion.versionMajor` og `versionMinor` (tomme for utkast), og tabellene `ModulePass`
  (med `invalidatedAt`) og `CourseModuleRequirement`.
- **Skrives ved siden av dagens regel og speiler den nøyaktig,** så byttet i 5a-3 ikke endrer noens svar:
  - publisering med `supersedesEarlierPasses: true` → modulen får ny hovedversjon, og kravet heves i **alle** kurs
    den ligger i. Dagens regel er global. Uten avkrysning → mindre;
  - «Publiser nye versjoner» med samme avkrysning: likt;
  - kalibrering og modulimport (`contentImportService.ts:419`): mindre;
  - `setCourseItems` og `setCourseModules`: krav for nye moduler, sletting for fjernede. Det skjer i én funksjon,
    `syncModuleRequirements`;
  - vedtak → `ModulePass`, som beskrevet over;
  - en eldre modulversjon med lavere hovedversjon, eller den aktive versjonen som hoved, kan ikke publiseres
    (sannhetstabellen, de to siste radene).
- **Tilbakefylling:** et skript som regner alt ut på nytt fra historikken, og som kan kjøres flere ganger. Før regelen
  slås på, er alt det skriver bestemt av historikken. En ny kjøring retter derfor det en tidligere kjøring, eller gammel
  kode under utrullingen, gjorde feil. Etter at regelen er slått på, kjøres det ikke.
  - Versjonsnummer: per modul, i publiseringsrekkefølge, under den eksklusive innholdslåsen. En versjon som står som
    `supersededByVersionId`, eller i revisjonssporet `module_passes_superseded`, starter en ny hovedversjon, med mindre
    den var nummerert fra før. En revisjon uten beståtte ga ingen rad og blir mindre; den rørte ingen.
  - `ModulePass`: siste vedtak per ferdig vurdert innlevering, når det er bestått. Per deltaker, under deltakerlåsen:
    radene slettes og bygges på nytt.
  - **#997-historikken bevares eksplisitt,** ikke utledet av rekkefølgen. En bestått som en revisjon tok bort, får
    `invalidatedAt`: vedtaket ble fattet før revisjonen ifølge revisjonssporet, eller raden står fortsatt som
    `SUPERSEDED`. Det gjelder også når revisjonen pekte på samme versjon som vedtaket.
  - Krav: Ms nåværende hovedversjon, for hver modul i hvert kurs.
- **Sammenligningsrapport** (`npm run module-credit:compare`): regner ut gammel og ny regel side om side for alle
  deltakere og kurs, og lister forskjellene med årsak. Forventede årsaker: et nytt forsøk som strøk etter bestått
  (svar f), og en innlevering på gammel versjon vurdert etter en #997-revisjon. Alle andre forskjeller er feil.

**Utrulling:** gammel og ny kode svarer likt, fordi ingen leser bytter regel. Det gammel kode gjør under utrullingen,
retter neste kjøring av tilbakefyllingen.

**Bevis:**
- tilbakefylling på en pseudonymisert kopi av prod (oppskriften fra 2026-10-24), og rapporten uten uforklarte
  forskjeller;
- enhetstester av nummereringen, også revisjon på samme versjon og en versjon som er aktivert på nytt;
- integrasjonstest: en `SUPERSEDED`-rad på samme versjon blir ugyldiggjort og teller ikke;
- integrasjonstest for hvert vedtaksspor (bare flervalg, automatisk, manuell vurdering, anke) → riktig `ModulePass`.

**QA stopper på:** en vei som setter en modul live, endrer et kurs eller fatter et vedtak uten å skrive de nye radene,
eller at en bestått som #997 tok bort, teller igjen.

#### 5a-2 — bygget (2.134.0)

**Hva som leser det nye:** bare sammenligningsrapporten. `CertificationStatus`, kursbeviset, «Mine kurs», kursdetaljen og
rapportene leser som før. Det som er endret for noen, er to avvisninger ved publisering, se «Det forfatteren merker», og
`GET /api/me/data`, som nå også viser radene i `ModulePass`, fordi den skal vise det som er lagret om personen.

**Filene:**
- `src/modules/adminContent/moduleVersioning.ts`: nummereringen (`numberModuleVersions` og `findVersionsStartingMajor` er rene
  funksjoner), `resolvePublishNumber`, `raiseModuleRequirements` og `syncModuleRequirements`.
- `src/modules/certification/modulePass.ts`: raden per innlevering.
- `src/modules/course/moduleCredit.ts`: `findCreditedModuleIds` og `findCreditedModules`, den ene regelen 5a-3 skal bruke.
- `src/modules/course/moduleCreditBackfill.ts` og `moduleCreditComparison.ts`, med skriptene `npm run module-credit:backfill`
  og `npm run module-credit:compare` (`scripts/maintenance/`), og lesespørringene i
  `scripts/maintenance/module-credit-precheck.sql`.

**Veier inn** (grepet 2026-11-04). Vakta `test/content-lock-write-guard.test.js` nekter alle andre, se under.
- *Setter en modulversjon live, og gir nummer:* bare `createAdminContentWriter(tx).publishModuleVersion`
  (`adminContentRepository.ts`). `versionKind` er påkrevd. Kallerne:
  - `publishModuleVersion` (`adminContentCommands.ts`): avkrysningen gir hoved, ellers mindre. Den kalles fra modulens egen
    rute (`POST …/module-versions/:id/publish`), «Publiser kurs» (`publishCourseCascade`, alltid mindre), «Publiser nye
    versjoner» (`publishCoursePendingVersions`, hoved bare når avkrysset og noen har bestått den modulen), og modulimporten
    (`contentImportService.ts`, alltid mindre, også kursimporten som går gjennom den);
  - `publishModuleVersionWithThresholds` (kalibreringen, `POST /api/calibration/workspace/publish-thresholds`): mindre.
  - *Agent-tokenet* kan ikke publisere: `agentTokenScope.ts` slipper bare gjennom modulimport med `autoPublish: false` og
    `mode: createNew`, utkast, og `PUT …/items` på upubliserte kurs.
  - `archiveModule`, `unpublishModule` og `courseCascadeDeleteService` setter bare modulens `activeVersionId` til `null`. Ingen av
    dem gir eller tar nummer.
- *Skriver versjonsnummeret:* `publishModuleVersion` over, og `numberModuleHistory` (for historikk uten nummer, kalt ved
  publisering, ved `syncModuleRequirements` og av tilbakefyllingen). `createModuleVersion` kan ikke sette det.
- *Skriver kursets elementer, og kaller derfor `syncModuleRequirements`:* `writeCourseItems` (fra `setCourseItems` og
  `updateCourse`, altså `PUT …/items`, `PUT …/content`, importen som oppdaterer, og agent-tokenet) og
  `setCourseModules` (`PUT …/modules`, importen som bytter ut alt). Unntak: `courseCascadeDeleteService` sletter hele kurset,
  og fremmednøkkelen tar radene.
- *Skriver kravet:* bare `moduleVersioning.ts` (`raiseModuleRequirements`, `syncModuleRequirements` og tilbakefyllingen).
  Sletting av kurs eller modul tar radene med seg (CASCADE).
- *Fatter et vedtak, og går derfor gjennom `upsertCertificationStatusFromDecision`:* `createMcqOnlyDecision` og
  `createAssessmentDecision` (`decisionService.ts`; en sak som går til manuell vurdering, skriver verken status eller rad), og
  `appendDecisionWithLineage` fra `manualReviewService` og `appealService`. Raden skrives FØR vakta mot nedgradering, som
  returnerer tidlig. `decisionRepository.createAssessmentDecision` er det eneste stedet et vedtak lages.
- *Skriver `ModulePass`:* `recordModulePassFromDecision` og tilbakefyllingen. Sletting følger innlevering, vedtak, versjon,
  modul og bruker (CASCADE). Ingen kode sletter innleveringer eller vedtak i dag.
- *Leser det nye:* `findCreditedModules` (rapporten) og `GET /api/me/data`. `ModuleVersion.versionMajor` og `versionMinor` står
  i svaret fra publiseringsrutene og kalibreringen, og i revisjonssporet `module_version_published`.
- *Kursbevis, status og øvrige lesere:* uendret. De er listet i «Lesere av kursbevis» og flyttes i 5a-3.
- *Utenfor `src/`:* `prisma/seedCore.ts` og `scripts/runtime/bootstrapSeed.mjs` lager aktive versjoner direkte. De kjøres bare i test
  og utenfor prod. Radene får nummer ved neste publisering eller tilbakefylling, og vakta ser dem ikke. Ingen skript i
  `scripts/maintenance/` setter en modul live eller skriver kursets elementer.

**Avgjørelser der planen var åpen:**
- **Historikk uten nummer** får nummer av samme funksjon, enten det skjer ved publisering eller i tilbakefyllingen. Derfor kan
  ingen publisering regne feil fra en tom historikk, om noen publiserer etter utrullingen og før tilbakefyllingen. Gammel kode
  under utrullingen retter seg ved neste publisering eller tilbakefylling.
- **En versjon er «ute»** når den er publisert, er aktiv, eller noen har levert på den. Bare `publishedAt` holder ikke: da kunne
  et vedtak havne på en versjon uten nummer, som aldri teller.
- **«Med mindre den var nummerert fra før» i historikken:** det gjelder et nummer som faktisk er gitt. En revisjon med beståtte
  gir derfor ny hovedversjon også når versjonen alt var ute, og versjonen plasseres der revisjonen skjedde. Da ligger de eldre
  versjonene under den, og et vedtak på en av dem, fattet etter revisjonen, teller ikke (Codex, 2026-11-05). En versjon som alt har
  fått et nummer (av ny kode, eller en tidligere kjøring), beholder det.
- **En revisjon uten beståtte** (`supersededCount: 0` i sporet) blir mindre i historikken, slik planen sier, med mindre en statusrad
  peker på versjonen: da mistet noen en bestått, og den blir hoved. Den ugyldiggjør
  likevel beståtte fra før seg: en som strøk på nytt før revisjonen, sto som ikke bestått og skal ikke få noe tilbake.
- **«Ferdig vurdert innlevering»** kan ikke leses av statusen på innleveringen. En åpen anke setter en bestått innlevering til
  `UNDER_REVIEW`, og beståtten står til anken er avgjort (`appealService.ts:55`). Regelen speiler hvilke vedtak som faktisk gikk
  gjennom `upsertCertificationStatusFromDecision`: siste vedtak per innlevering, når det er bestått, unntatt et automatisk vedtak
  på en innlevering som har en manuell vurdering, og unntatt `SUPERSEDED` og `REJECTED`. Vedtak fra før #948 kan si bestått
  mens saken lå hos sensor; de teller ikke, og status ble aldri skrevet for dem.
- **Mangler kravet eller nummeret, teller beståtten ikke** i den nye regelen. Rapporten lister det.
- **Tilbakefyllingen nekter å kjøre** når `module_pass_per_course = on`. Da er kravene forfatterens valg.

**Det forfatteren merker** (sannhetstabellen, de to siste radene). Dette er det eneste utfallet i skiva som endrer seg, og det
står i planen:
- den aktive versjonen, eller en annen versjon som har nummer, publisert med avkrysningen: `409 module_version_number_fixed`.
  I dag tar det beståtten fra alle og sender e-post. Forfatteren kan nå det fra «Publiser» på en modul uten nytt utkast, når noen
  har bestått, ved å svare ja på spørsmålet;
- en versjon med lavere hovedversjon enn den høyeste: `409 module_version_outdated`. Det nås bare gjennom API-et; siden
  publiserer den nyeste. «Gjenopprett» lager en ny versjon.

Teksten står i `participant-translations.js`. Ingenting er skrevet ved 409.

**Lesespørringer før tilbakefyllingen** (`scripts/maintenance/module-credit-precheck.sql`, bare SELECT; integrasjonstesten kjører
fila). Ikke kjørt mot stage eller prod ennå.

```sql
-- 1. SUPERSEDED-rader som peker på samme versjon som vedtaket de tok bort (Codex runde 2 nr. 7).
SELECT count(*) AS same_version_superseded FROM "CertificationStatus" cs
JOIN "AssessmentDecision" d ON d.id = cs."latestDecisionId"
WHERE cs.status = 'SUPERSEDED' AND d."moduleVersionId" = cs."supersededByVersionId";

-- 2. De samme radene per modul og versjon, så det kan sjekkes for hånd.
SELECT cs."moduleId", cs."supersededByVersionId", count(*) AS rows FROM "CertificationStatus" cs
JOIN "AssessmentDecision" d ON d.id = cs."latestDecisionId"
WHERE cs.status = 'SUPERSEDED' AND d."moduleVersionId" = cs."supersededByVersionId"
GROUP BY cs."moduleId", cs."supersededByVersionId";

-- 3. Revisjoner uten spor: SUPERSEDED-rader uten en `module_passes_superseded` med beståtte for samme modul og versjon. En rad med
--    null beståtte teller ikke som spor. Skal gi null rader.
SELECT cs."moduleId", cs."supersededByVersionId", count(*) AS rows FROM "CertificationStatus" cs
WHERE cs.status = 'SUPERSEDED' AND NOT EXISTS (
  SELECT 1 FROM "AuditEvent" a
  WHERE a.action = 'module_passes_superseded' AND a."entityType" = 'module' AND a."entityId" = cs."moduleId"
    AND a."metadataJson" LIKE '%' || cs."supersededByVersionId" || '%'
    AND a."metadataJson" NOT LIKE '%"supersededCount":0%'
)
GROUP BY cs."moduleId", cs."supersededByVersionId";
```

`module_passes_superseded` er ikke blant handlingene `auditRetentionService.ts` rydder, så sporet skal stå. Spørring 3 sjekker at
det stemmer. Rader den finner, ugyldiggjøres likevel av tilbakefyllingen, for de står som `SUPERSEDED`.

**Rapporten:** per deltaker, kurs og modul, gammel og ny regel, med årsak og `expected`. Forventet er
`retake_failed_after_pass` og `pass_on_old_version_after_revision`. Alle andre årsaker er feil, og koden blir 1:
`overturned_pass_kept_by_old_rule` (se «Kjente mangler» nr. 41), `superseded_pass_counts_again`,
`invalidated_but_old_rule_counts`, `missing_requirement`, `pass_on_unnumbered_version` og `unexplained`. I tillegg lister den hull
i dataene: versjoner som er ute uten nummer, manglende krav, krav uten element, krav som ikke er modulens nåværende
hovedversjon, og aktive versjoner som er lavere enn kravet (nr. 45). Rapporten har id-er, ingen navn eller e-post.

**Rekkefølgen for produkteier,** først stage, så prod om kvelden:
1. Rull ut 2.134.0. Migreringen kjører ved oppstart, og er bare utvidelse. Kjør `test/stage/release-2-134-modulversjon.spec.ts`
   (stage).
2. Kjør lesespørringene over. Noter tallet i 1. Spørring 3 skal gi null rader; gir den rader, se på dem før du går videre.
3. `dotenv -e .env.<miljø> -- npm run module-credit:backfill`. Koden er 2 hvis noe var opptatt: kjør på nytt.
4. `dotenv -e .env.<miljø> -- npm run module-credit:compare -- --out rapport.json`. Koden er 0 når alt er forklart.
5. Kjør steg 3 og 4 en gang til. Tallene skal være like.
6. Før prod: gjør 3 og 4 på en pseudonymisert kopi av prod, slik planen krever. Gjort, se under.

**Prøvekjørt på en kopi av prod** (2026-11-05, kode `bb60c0c6`, data til 2026-11-04, lokal database, pseudonymisert og uten svartekster):
- migreringene fra prods nivå til 2.134.0 gikk gjennom;
- lesespørring 1 ga 0, og 2 og 3 ga ingen rader. Prod har ingen `SUPERSEDED`-rader og ingen `module_passes_superseded` i sporet, så #997 er aldri
  brukt der. Historikktilfellene med revisjoner, og «Kjente mangler» nr. 45, gjelder derfor ikke dataene i prod i dag;
- tilbakefyllingen: 70 moduler, 114 versjoner nummerert, 63 krav, 104 beståtte for 17 deltakere, ingen ugyldiggjort. Alle versjoner ble hovedversjon 1;
- rapporten: 103 sammenlignet, ingen forskjeller, ingen hull, kode 0. Ingen tilfeller av nr. 41;
- andre kjøring ga 0 nye nummer og samme rapport, tegn for tegn.

Selve kjøringen i prod må gjøres etter utrullingen, for dataene endrer seg. Slik ble kopien tatt: ingen fil på disk, rett inn i den lokale databasen,
og produkteier kjørte brannmurregelen, fordi sikkerhetsfilteret ikke slipper den gjennom fra agenten.

**Bevis:** `test/unit/module-credit-934-5a2.test.ts` (nummereringen, også revisjon på samme versjon og en versjon som er aktivert
på nytt; beståttene; årsakene), `test/m2-module-credit-934-5a2.test.ts` (rutene for publisering, «Publiser kurs», «Publiser nye
versjoner», kalibrering, import og kursets elementer; alle fire vedtakssporene; tilbakefyllingen; `SUPERSEDED` på samme versjon;
kontrollcasene for rapporten), `test/content-lock-write-guard.test.js` (nye tabeller under låsene, og skrivingene ett sted, med
kontrollcase), `test/stage/release-2-134-modulversjon.spec.ts`.

**QA-porten** (2026-11-05), samlet for 2.132.1, 5a-1 og 5a-2:
- Codex runde 1, hele området: NO-GO. Revisjon på en versjon som alt var ute, sammen med et sent vedtak. Rettet.
- Codex runde 2, hele området: NO-GO. En rad med null beståtte skjulte en revisjon uten spor, og versjonen ble lest etter at svaret
  var kopiert. Begge rettet, og valideringen på leseruta er lagt til.
- Runde 3, bare rettingene: Codex stoppet på utgiftstaket. En lokal agent med samme sjekkliste ga GO, med små funn som er rettet eller
  står som nr. 47. Det er ikke det samme som Codex. Kjør Codex på disse rettingene før prod, om taket er hevet.

#### 5a-3 — den nye regelen slås på

- **Bryteren er en rad i `PlatformConfig`** (`module_pass_per_course = on`), ikke en miljøinnstilling. App og worker
  leser den i samme transaksjon som avgjørelsen. To miljøinnstillinger kunne vært ulike på app og worker, og da
  kunne workeren utstedt kursbevis etter den gamle regelen.
- **Når den er på:**
  - alle lesere bruker `findCreditedModuleIds`: porten for kursbevis (`courseCompletionService.ts:82`), «Mine kurs»
    og kursdetaljen (`routes/courses.ts:65, 280–281, 347, 419`), og kursrapporten (`courseReport.ts:177, 265`);
  - `SUPERSEDED` skrives ikke, og #997-e-posten sendes ikke. E-posten fra 4b gjelder;
  - de nye endepunktene virker. Før bryteren svarer de `409 module_versioning_not_active` uten å skrive noe.
- **Nye endepunkter.** En gammel server svarer 404 på dem, så ingenting lagres med feil regel:
  - `POST /modules/:moduleId/module-versions/:id/publish-versioned`: `moduleVersion: "major" | "minor"`,
    `courseVersions: { [courseId]: "major" | "minor" }`, `expectedCourseIds` (kursene dialogen viste) og
    `confirmEmailRecipients: { [courseId]: antall }`. Mindre for modulen → mindre i alle kurs, uten spørsmål. Hoved for
    modulen → svar kreves for hvert kurs med kursbevis (`400 course_version_required`, med kursene).
  - `POST /courses/:courseId/publish-pending-versioned`: `versionIds`, `courseVersions` for **alle** berørte kurs
    (dette og alle andre som har et av elementene og har vært ute, også avpubliserte), `expectedCourseIds` og
    `confirmEmailRecipients`.
  - Forhåndsvisningene (`GET …/publish-preview-versioned` for modulen, `pending-versions` for kurset) lister kursene
    med `certificateHolders`, `majorEmailRecipients` og om kurset er publisert. Tallene kommer fra de samme
    funksjonene som publiseringen bruker.
- **Rekkefølgen i én transaksjon** (begge endepunktene):
  1. ta innholdslåsen (eksklusiv). Finn de berørte kursene og les settet på nytt. Er det endret siden dialogen → 409.
     Ingen kan legge modulen inn i et nytt kurs før transaksjonen er ferdig;
  2. avgjør resultatet for hvert kurs med samme regel som `applyCourseVersionChange`: hoved bare når svaret er hoved
     og noen har kursbevis;
  3. ta øyeblikksbildet for hvert kurs;
  4. publiser alle elementene. I «Publiser nye versjoner» får en modul ny hovedversjon når minst ett kurs får
     hovedversjon på grunn av den. I modulens egen dialog er det forfatterens valg;
  5. øk hvert kurs **nøyaktig én gang**, og hev kravet for modulene i kursene som fikk hovedversjon.
- **«Publiser kurs» med en modul som har vært publisert før** (Codex runde 2 nr. 11): avvises med `409
  course_publish_has_republished_modules`, med modulene listet. Dialogen viser forfatteren til «Publiser nye
  versjoner», som stiller spørsmålet per kurs. Moduler som aldri har vært publisert, og seksjoner, går som i dag.
- **Gamle kontrakter etter bryteren:**
  - modulpublisering med `supersedesEarlierPasses: true` → `409 client_outdated`, ingenting skrevet. Avkrysningen
    sier ingenting om kursene og kan ikke oversettes trygt. `false` eller utelatt → mindre i alle kurs, som i dag;
  - «Publiser nye versjoner» med det gamle endepunktet: `courseVersion` gjelder dette kurset. Sender klienten
    `supersedesEarlierPasses: true`, eller berører publiseringen andre kurs med kursbevis, → `409 client_outdated`.
    `courseVersion: "major"` med en modul i settet → også 409 (se «5a-3 — bygget»). Ellers publiseres det med `courseVersion` for
    dette kurset.
- **Deltakerens vei:** kursdetaljen gir `moduleStatus: REVISED_RETAKE_REQUIRED` fra den nye regelen. Modulsiden
  åpnet fra kurset bruker kursets status, ikke bare siste vedtak (`participant.js:1203`, `moduleService.ts:154`), så
  «må tas på nytt» vises og et nytt forsøk kan startes.

**Utrulling og tilbakerulling:**
1. 5a-2 er i prod, tilbakefyllingen er kjørt, og rapporten har ingen uforklarte forskjeller.
2. 5a-3 rulles ut med bryteren av. App og worker viser ny versjon (`/version` på begge).
3. Tilbakefyllingen kjøres en siste gang. Så slås bryteren på, sammen med 5b, i samme prodsetting. På stage gir den
   gamle avkrysningen 409 mellom 5a-3 og 5b, og det er greit.
4. **Fast regel: når bryteren er slått på, rulles det aldri tilbake til kode som ikke leser bryteren** (alt eldre
   enn 5a-3). Bryteren slås heller ikke av igjen etter at første krav er hevet; da ville den gamle regelen telle
   beståtte som ikke lenger gjelder. Feil rettes framover.

**Bevis:**
- integrasjonstest: modul i to kurs, hoved i A og mindre i B → deltakeren i B beholder beståtten og fullført;
  deltakeren i A står som «må ta ny versjon» og må bestå på nytt;
- integrasjonstest: nytt forsøk for A stryker → B beholder beståtten;
- integrasjonstest: hoppet over en hovedversjon, og innlevering på gammel versjon vurdert eller anket etter
  publiseringen (sannhetstabellen);
- integrasjonstest: «Publiser nye versjoner» med to moduler og tre kurs → hvert kurs økt én gang, ett øyeblikksbilde
  per kurs. Modulen lagt inn i et fjerde kurs samtidig → venter, og kommer med eller gir 409;
- integrasjonstest: avpublisert modul → nytt utkast → «Publiser kurs» → 409, og ingenting publisert;
- integrasjonstest: de gamle kontraktene → 409 og ingenting skrevet; de nye endepunktene før bryteren → 409;
- e2e: deltakeren går fra kurset til modulen, tar den på nytt, består, og får kursbevis for den nye versjonen;
- vakttest: ingenting leser `CertificationStatus` for fremdrift i kurs utenom den ene funksjonen; ingenting skriver
  `SUPERSEDED` når bryteren er på.

**QA stopper på:** at en deltaker mister beståtten i et kurs som fikk mindre versjon; at en hovedversjon ikke gir «må
bestå på nytt»; et kursbevis uten at kravet er oppfylt; en vei inn som går utenom; eller at forfatterens valg
forsvinner uten at noen sier fra.

#### 5a-3 — bygget (2.135.0)

Bryteren er av i alle miljøer, og med den av er alt som i 2.134.0. Det er testet regel for regel, med en kontroll for hver test med
bryteren på.

**Filene:**
- `src/modules/course/modulePassSwitch.ts`: bryteren (`isModulePassPerCourseOn`). Raden leses hver gang, på samme klient som avgjørelsen.
  Ingen mellomlagring. Vakta nekter det.
- `src/modules/course/moduleCredit.ts`: `findModuleProgress`, den ene veien til fremdrift i kurs. Den velger regel ut fra bryteren: av =
  `CertificationStatus`, på = `passCountsForCourse` med kravet per kurs.
- `src/modules/course/versionedPublishService.ts`: de to nye publiseringene, i rekkefølgen planen sier.
- `src/modules/course/courseVersioning.ts`: `findAffectedCourses` (settet og tallene), `resolveCourseVersionKind` (hoved bare når svaret er
  hoved og noen har kursbevis), og `raiseModules` på `applyCourseVersionChange`, så versjonen, kravet og e-posten kommer fra samme kall.
- `scripts/maintenance/switch-on-module-pass.ts` (`npm run module-credit:switch-on`): slår bryteren på under den eksklusive låsen. Det finnes
  med vilje ingen «av».

**Lesere av fremdrift i kurs** (grepet 2026-11-05). Alle går gjennom `courseRepository.findModuleProgress` → `moduleCredit.ts:213`:
- porten for kursbevis: `courseCompletionService.ts:81`, altså alle tre veiene inn (workeren, lesingen og kursbevissiden). I den låste
  veien er bryteren, kravet og beståttene lest i samme transaksjon;
- «Mine kurs»: `routes/courses.ts:70`;
- kursdetaljen: `routes/courses.ts:289`, med `moduleStatusOf` (`:305`) for både `items` og `modules`. `retakeRequired` settes på `:380`;
- kursrapporten: `courseReport.ts:176` (kursraden) og `:267` (deltakerradene). CSV-eksporten (`routes/reports.ts:417, 440`) går gjennom de samme.

Metodene `countPassedModulesForUser`, `findUserCertificationStatusesForModules`, `findPassedModuleIds`, `countPassedUsersForModule` og
`findPassedUserIdsForModule` er fjernet fra kursrepositoriet, så en ny leser ikke kan bruke dem.

**Lesere av `CertificationStatus` som står igjen, og hvorfor.** Ingen av dem er fremdrift i kurs:
- `moduleCredit.ts:157`: regelen med bryteren av;
- `reportingRepository.ts:237` → `reviewAppealReport.ts:182`: statusrapporten per modul, uten kurs, som planen sier («Kjente mangler» nr. 48);
- `certificationRepository.ts:65` (`findPassedCertificationsForModule`): #997-e-posten med bryteren av (`adminContentCommands.ts:1044`), og tallene til
  den gamle dialogen (`routes/adminContent.ts:966`, `coursePublishService.ts:673`), nr. 49;
- `certificationRepository.ts:88` (`findByUserAndModule`): vakta mot nedgradering, som før;
- `moduleCreditComparison.ts:115`, `moduleCreditBackfill.ts:128` og `moduleVersioning.ts:176`: rapporten og tilbakefyllingen, som regner på den gamle regelen med vilje;
- `routes/me.ts:139`: innsynseksporten viser det som er lagret.

**Skrivere av `SUPERSEDED` på modulstatus:** bare `certificationRepository.ts:80`, kalt bare fra `adminContentCommands.ts:1050`, og der er bryteren sjekket
først (`:1022`): med den på er svaret `409 client_outdated` før noe skrives. Alle andre `SUPERSEDED` i koden er innleveringer, anker og saker, en annen sak.

**Veier jeg fant utenfor planen:**
- Modulsiden leste siste vedtak på tre steder, ikke ett: `alreadyPassed` (planens `participant.js:1203`), `earlierResultToShow`, som viste det gamle resultatet over et
  nytt forsøk, og `formatModuleStatusSummary`, som skrev «Fullført». Alle tre følger nå kursets status.
- Teksten `courses.module.revisedRetakeHint` fantes, men ble aldri brukt. Den er det som vises nå.
- Den gamle `publish-pending` sjekker #997-svaret også før låsen. Den sjekken ville gitt `400 revision_answer_required` med bryteren på, så den leser bryteren den også. Det er sjekken etter låsen som avgjør.
- Tilbakefyllingen leste bryteren én gang, utenfor låsen. Nå også i hver transaksjon.
- `GET /modules/:id/passed-count` leser modulstatus. Det står, se nr. 49.

**Avgjørelser der planen var åpen:**
- **Regelen velges i `findModuleProgress`, ikke i `findCreditedModuleIds`.** Leserne trenger også «besto en versjon som ikke teller» (`REVISED_RETAKE_REQUIRED`), og
  den gamle regelen. Selve regelen er fortsatt `passCountsForCourse`. `findCreditedModules` står for rapporten, som skal lese den nye regelen også med bryteren av.
- **`retakeRequired` er et nytt felt på kursdetaljen, og finnes bare med bryteren på.** `REVISED_RETAKE_REQUIRED` kan også komme fra en `SUPERSEDED`-rad med bryteren av, og da
  skal modulsiden være som i 2.134.0. Uten feltet ville en deltaker med en slik rad fått ny oppførsel ved utrullingen.
- **Et nytt forsøk starter bare når siste vedtak er en avgjort bestått.** Har deltakeren strøket på nytt, eller saken vurderes, går siden som vanlig: resultatet, med anke og «Prøv igjen».
  Ellers ville anke-knappen forsvunnet. Beskjeden står til deltakeren har bestått.
- **Det gamle `publish-pending` med bryteren på gir modulene MINDRE.** Velger en utdatert fane hovedversjon av kurset, og settet har en modul, svarer serveren `409 client_outdated`:
  hovedversjon skal bety «må bestå på nytt», men denne kontrakten kan ikke heve kravet per kurs, og valget skal ikke forsvinne uten at noen sier fra. Bare seksjoner går som før. Dialogen
  fra 5b bruker det nye endepunktet.
- **`expectedCourseIds` kreves bare når modulen er hoved.** Mindre spør ikke om kursene, så settet avgjør ingenting. Det er også derfor `moduleVersion: "minor"` med
  `courseVersions: { x: "major" }` gir `400 validation_error`: det valget ville ellers forsvunnet.
- **`409 affected_courses_changed`** er koden når settet er endret, eller et svar gjelder et kurs som ikke er berørt. Teksten står på alle tre språkene.
- **Et kurs som aldri har vært ute, er ikke berørt:** ingen versjon, ingen spørsmål, og kravet står (sannhetstabellen). Et svar for det gir 409. Et arkivert kurs som har vært ute, er berørt, som i dag
  (`applyMinorVersionToCoursesContaining` tar det med).
- **Skjemaene er `strict`.** Et felt serveren ikke kjenner, er `400`. Det er lærdommen fra Codex runde 2: skjemaet fjernet `courseVersions` uten å si fra.
- **Datovinduet i kursrapporten** gjelder `ModulePass.passedAt` med bryteren på, og `CertificationStatus.passedAt` med den av.

**Rekkefølgen for produkteier,** når 5b er ute, først stage, så prod om kvelden. Det er planens rekkefølge, med kommandoene:
1. Rull ut. App og worker viser ny versjon (`/version` på begge). Bryteren er av. Kjør `test/stage/release-2-135-bryteren-av.spec.ts`.
2. `dotenv -e .env.<miljø> -- npm run module-credit:backfill`, så `dotenv -e .env.<miljø> -- npm run module-credit:compare`. Koden skal være 0.
3. `dotenv -e .env.<miljø> -- npm run module-credit:switch-on`.

Fast regel: når bryteren er på, rulles det aldri tilbake til kode eldre enn 2.135.0, og den slås ikke av igjen etter at første krav er hevet. Feil rettes framover. Skriptet har derfor ingen «av».

**Bevis:** `test/m2-module-pass-per-course-934-5a3.test.ts` (gjennom rutene: alle bevisene i planen, med en kontroll med bryteren av for hver regel),
`test/content-lock-write-guard.test.js` (ny del: leserne, relasjonene, `SUPERSEDED` og bryteren, med kontrollcaser), `test/unit/module-pass-switch-934-5a3.test.ts` (reglene uten database, skjemaene og
agent-tokenet), `test/e2e/participant-course-retake-934-5a3.spec.ts` (den ekte `participant.js` mot falske API-er: e2e-oppsettet har ingen database, så serverens del av den samme veien står i integrasjonstesten),
`test/stage/release-2-135-bryteren-av.spec.ts` (bare API, med bryteren av).

### 5b — dialogene og versjonsnummeret

- **Moduldialogen** erstatter #997-avkrysningen (`admin-content-publish.js:435–513`) og bruker
  `publish-versioned`. Først velges hoved eller mindre for modulen. Velges hoved, listes hvert kurs modulen ligger i
  og som har vært ute, også avpubliserte. Hvert kurs viser antall kursbevis, antall som får e-post, og valget
  hoved/mindre. Mindre er valgt fra start. Over 200 mottakere krever et ekstra «ja». Dialogen bruker
  `mountCourseVersionChoice`, én per kurs.
- **«Publiser nye versjoner»** (`admin-content-courses.js:694–707`) bruker `publish-pending-versioned` og viser ett
  valg per berørt kurs. #997-spørsmålet faller bort.
- **«Publiser kurs»** forklarer 409 for moduler som har vært publisert før, og viser til «Publiser nye versjoner».
- **Versjonsnummeret:** modullista viser «v2.1» der den i dag viser «v5». `versionNo` står i API-et som før.
- **Kurseksporten** tar med `versionMajor` og `versionMinor` som opplysning. Importen leser dem ikke.
- **Utrulling:** ny klient mot server der bryteren er av → 409, og dialogen sier at funksjonen ikke er slått på ennå.
  Mot gammel server → 404. Ingen av delene skriver noe.

**Bevis:** e2e av dialogen med to kurs, hoved på det ene, og riktig kall; «Publiser nye versjoner» der et annet kurs
deler modulen; 390 og 360 px med lange kurstitler; eksport og import tur-retur er uendret.

**QA stopper på:** at dialogen kan sende uten svar for et kurs med kursbevis, eller at den flyter over på 390 px.

#### 5b — bygget (2.136.0)

Bryteren er av i alle miljøer. Da er publiseringen den samme som i 2.135.0, og det nye som vises er versjonsnummeret og feltene i eksporten.

**Filene:**
- `public/static/course-version-choice.js`: valget mellom mindre og hoved, flyttet fra `admin-content-courses.js`, og `mountAffectedCourses`, ett valg per kurs. Begge dialogene og de tre fra før bruker det. Stilene er flyttet til `shared.css`.
- `public/static/admin-content-publish.js`: moduldialogen (`#modulePublishDialog` i `admin-content.html`).
- `public/static/admin-content-courses.js`: «Publiser nye versjoner» og forklaringen av 409 på «Publiser kurs».
- `public/static/version-label.js`: «v2.1».

**Hvordan siden vet hvilken dialog den skal vise.** Serveren avgjør, ikke klienten:
- Moduldialogen leser `GET …/publish-preview-versioned` først. `200` med kursene: valg per kurs. `409 module_versioning_not_active` eller `404`: alt under er koden fra før, med `passed-count` og #997-spørsmålet.
- «Publiser nye versjoner» leser `affectedCourses` i `pending-versions`. Feltet finnes bare med bryteren på, så uten det er dialogen den gamle.
- Det samme ved sending. `409 module_versioning_not_active` eller 404 fra de nye endepunktene gir den gamle veien. Ingenting er skrevet. Modulen går rett til #997-spørsmålet, og kurset leser `pending-versions` på nytt.
- Begge retninger er testet: ny klient mot server med bryteren av, ny klient mot gammel server, bryteren som går av og som går på mens dialogen står.

**Avgjørelser der planen var åpen:**
- **Planen sa at dialogen skulle si at funksjonen ikke er slått på.** Det ville stoppet all publisering mens bryteren er av. Oppdraget for 5b (2026-11-05) sier derfor at den gamle dialogen brukes, uendret.
- **En annen feil på forhåndsvisningen (500, 403, nett) stopper, med «prøv igjen».** Å falle tilbake ville gitt det gamle spørsmålet mens bryteren kan være på. Der kan avkrysningen gi 409, og «nei» gir mindre i alle kurs uten at noen ble spurt. Med bryteren av svarer ruta 409 så snart eierskapet er sjekket, så dette stopper ikke publisering med mindre den gamle ruta også ville feilet.
- **Ikke noe spørsmål når versjonen har nummer, eller modulen aldri har vært publisert.** Et gitt nummer endres ikke (produkteier), og første publisering blir 1.0 uansett. Det sendes som `minor`.
- **Et kurs uten kursbevis har ingen knapper.** Serveren gir det mindre uansett (`resolveCourseVersionKind`), så et valg ville forsvunnet uten at noen sa fra. Det står «Kurset får mindre versjon». Dialogen sender heller ikke noe svar for det: får kurset kursbevis etter at dialogen ble vist, avviser serveren, og forfatteren blir spurt. Et svar klienten fant på selv, ville gått gjennom uten at noen hadde tatt stilling.
- **Hoved uten kurs går an.** Modulen får nytt hovednummer, og dialogen sier at bare nummeret endres.
- **Avviste svar nullstilles.** Dialogen vises på nytt med ferske tall, hovedversjon står for modulen, og hvert kurs er tilbake på mindre. Dialogen sier fra. Et svar som overlever, kunne gjelde et annet tall enn det forfatteren så.
- **«Publiser kurs» åpner «Publiser nye versjoner» etter 409,** i tillegg til teksten, som nevner modulene. Knappen finnes bare på kurssiden, og «Publiser kurs» kan trykkes fra lista.
- **Dialogen lukkes før kallet** i moduldialogen, så et klikk til ikke kan publisere to ganger. Framdriften vises slik den gjør for resten av modulsiden.

**Versjonsnummeret, der planen ikke stemte.** Planen sier at modullista viser «v5» i dag. Det gjelder deltakerens modulliste (`participant.js`). Forfatterens liste hadde ingen versjon. Den har fått merket kurslista allerede bruker, ved siden av statusen. Modulsidens hode og versjonshistorikken viste også `versionNo`, og er rettet. Et utkast har ikke noe nummer, så hodet sier bare «Utkast», og historikken «Utkast (lagring 6)»: «v6» ved siden av «v2.1» ville sett ut som en høyere versjon.

**Rekkefølgen for produkteier** er den i «5a-3 — bygget», med `test/stage/release-2-136-dialogene.spec.ts` i tillegg i første steg. Testen virker både med bryteren av og på.

**Bevis:** `test/e2e/admin-content-module-publish-934-5b.spec.ts`, `test/e2e/admin-content-course-pending-934-5b.spec.ts` (hva som sendes, begge retninger, 390 og 360 px med lange titler, tre språk), `test/e2e/module-version-number-934-5b.spec.ts`, `test/unit/version-number-export-934-5b.test.ts`, `test/m2-course-export-version-934-5b.test.ts` (eksport og import tur-retur gjennom rutene), `test/stage/release-2-136-dialogene.spec.ts` (bare API).

### Kjente mangler (bevisst ikke rettet)

Ingen av disse kan miste innhold, gi feil kursbevis, la innhold gå live uten versjonsregelen, sende feil eller dobbel
e-post eller lekke data, med unntak av de korte utrullingsvinduene i nr. 1, som produkteier har godtatt, nr. 30, og nr. 41. De
to siste er regelen så lenge bryteren er av, og faller bort når den slås på (målt, se nr. 30 og 41).

1. **Gammel og ny server side om side under en utrulling** (Codex runde 2 nr. 1, 8, 12 om tømming, og 15). Mens begge
   kjører, kan en lagring gå til den gamle uten tellerkontroll, en gammel server kan fatte vedtak uten `ModulePass`,
   og en hovedversjon på den gamle serveren lager ingen e-postrader. Prod er én instans, og prodsettinger skjer om
   kvelden, så vinduet er sekunder til minutter med nesten ingen forfattere. Tilbakefyllingen (5a-2) retter det som
   gjelder beståtte. Fast regel: etter at bryteren i 5a-3 er på, rulles det aldri tilbake til kode som ikke leser den.
2. **Modulens tittel og beskrivelse** endres direkte på modulen, uten ny versjon (`adminContentCommands.ts:232`). En
   eldre versjon viser den nye tittelen. Det endrer ikke kravet. Endringen tar innholdslåsen.
3. **Oversatte SVG-bilder** ligger på `SectionAsset`-raden (`assetCommands.ts:413–507`). En eldre seksjonsversjon
   viser den nye oversettelsen. Ingenting brekker. Vedlikeholdsskriptene `localizedTitleCleanup.ts` og
   `assetCommands.ts:273` er bevisste unntak.
4. **Agent-tokenet** lagrer elementer på utkast uten telleren fra 4a. Det gjelder bare utkast, og agenten lager sine
   egne.
5. **Import med `updateExisting`** sjekker ikke at kurset er uendret siden eksporten. Elementer som tas ut, blir
   liggende i biblioteket; ingenting slettes.
6. **En e-post som kan ha gått** (avbrutt etter at ACS tok imot den, før `sent` ble skrevet) sendes ikke på nytt.
   Raden står som `uncertain`. Personen kan gå glipp av én e-post. Samme valg som #1115.
7. **E-post som venter** mens innstillingen er av, sendes når den slås på, hvis versjonen fortsatt er kursets nyeste.
   Den kan altså komme sent.
8. **Den gamle avkrysningen** gir 409 mellom 5a-3 og 5b, når bryteren er på. Derfor går de i samme prodsetting. Teksten er den samme `client_outdated` som deltakeren får (2.133.0), så forfatteren
   leser også «Har du skrevet et svar, er det lagret som kladd». Etter å ha lastet siden på nytt er det over. Fra 2.136.0 gjelder det bare en fane fra før 2.136.0, eller en dialog som sto åpen da bryteren ble slått på. Der leser «Prøv igjen» serveren på nytt og gir den nye dialogen.
9. **Seksjoner over flere hovedversjoner** (Codex runde 2 nr. 13). Seksjonsregelen sammenligner slutten av forrige
   hovedversjon med starten av den nåværende, slik den er avgjort. En lesing fra før hovedversjon 2, av en seksjon som
   ble endret i 2 og står uendret i 3, teller derfor i 3. Forrige utgave av planen ville rette det ved å se bakover
   gjennom alle radene. Men radene for eldre hovedversjoner holder slutten av versjonen, ikke starten, så det ville
   krevd ny lesing der regelen sier at det ikke trengs. Rettingen er derfor tatt ut. En riktig retting lagrer grensen
   per seksjon når hovedversjonen lages, og tas bare hvis produkteier vil. Det gjelder bare kurs med tre eller flere
   hovedversjoner.
10. **Ventetid bak innholdslåsen.** Mens en stor import eller publisering pågår, venter innleveringer, lesinger og
    utstedelse. Etter 3 sekunder svarer serveren 503, og siden prøver igjen.
11. *(Lukket i 2.133.0: `apiFetch` prøver igjen ved `503 content_busy`, utenom forfatterflatene.)*
12. **«Slett med alt innhold» fra en fane fra før 2.131.0** får `409 course_form_outdated` og må laste siden på
    nytt: ruta krever det forhåndsvisningen viste, ellers kunne en delt seksjon som nettopp ble eksklusiv, slettes
    uten at administratoren så det.
13. **Kalibreringen sender ikke hvilken versjon forfatteren kalibrerte på.** Den kloner versjonen som er aktiv etter
    låsen. Er en ny versjon publisert i mellomtiden, får den nye versjonen tersklene — samme utfall som om de kom
    etter hverandre. Tallene forfatteren så, gjaldt den gamle.
14. **«Rydd stage» (`purgeUnpublishedModules`)** sjekker hver kandidat på nytt etter låsen, men har ingen egen
    integrasjonstest for kappløpet: testen ville slettet andre testers upubliserte moduler i den delte databasen.
15. **Etter et avvist kall (409) må forfatteren laste siden selv.** Skjemaet beholder teksten, men slår ikke sammen
    endringene; det forfatteren skrev, må skrives inn igjen etter innlastingen.
16. **«Rydd stage» og `content_busy`** (QA-porten 2.131.0, runde 2, P2): sletter en kandidat om gangen og legger en
    som ikke fikk låsen, under `failed`. Ruta svarer 200 med det som ble gjort. Bare administrator; hver modul som
    slettes, er sjekket på nytt etter låsen.
17. **Oversatte SVG-er** (`localizeSectionAssets`) har ingen egen test for at filene ryddes når raden ikke kan skrives
    (rettet i runde 2, men ikke mutasjonssjekket: testen ville krevd språkmodell og lager).
18. **E-post ved ny hovedversjon: `skipped` er endelig** (4b). Er en person inaktiv eller anonymisert når jobben eller
    behandleren ser på raden, hoppes hen over for den versjonen — også om hen blir aktiv igjen (for eksempel etter en
    feil i synkroniseringen fra Entra). Hen ser den nye versjonen i Mine kurs neste gang hen logger inn.
19. **En kurstittel som ligner en lenke** (`www.`, `http`, `href`, en e-postadresse eller et domenenavn med små
    bokstaver, som `portal.a-2.no`) stopper e-posten for det kurset: radene blir `failed` (`contains_link`). Firmapolicy
    er ingen lenker, og en adresse i ren tekst blir en lenke i Outlook. Ingen varsler forfatteren; det står bare på
    radene. Domener skrevet med store bokstaver slipper gjennom, med vilje: «ASP.NET» er et kursnavn.
20. **Ingen side viser radene** (4b). Status (`sent`, `uncertain`, `failed` …) står i databasen og i workerens
    `lastSummary`, ikke i grensesnittet.
21. **To forsøk på samme rad samtidig** (en leiekontrakt som gikk ut mens ACS fortsatt svarte): det andre setter raden
    `uncertain`, og det første kan da ikke skrive `sent`. E-posten går én gang, men raden kan si `uncertain` om en som
    gikk. Samme valg som #1115.
22. *(Lukket 2026-11-05: `COURSE_MAJOR_EMAIL_ENABLED` står i Bicep, av som standard, og styres av GitHub-variabelen med samme navn.
    En infrastrukturutrulling setter den til verdien i variabelen, så en verdi satt for hånd på workeren overlever ikke.)*
23. **Eierskapet sjekkes før innholdslåsen** (QA-porten 2.131.0, runde 3). Fjernes en forfatter som eier mens lagringen
    står i kø bak låsen, går lagringen gjennom. Vinduet er sekunder, og forfatteren hadde tilgang da hen trykket.
24. **Rubrikk-, oppgavemal- og flervalgsversjoner tar ikke innholdslåsen** (QA-porten 2.131.0, runde 3). En samtidig
    lagring kan treffe den unike nøkkelen og gi en synlig feil. Ingenting går tapt, og forfatteren prøver igjen.
25. *(Lukket i 2.133.0: alle tre veiene til et kursbevis, workeren, lesingen og kursbevissiden, tar innholdslåsen delt og
    deltakerlåsen. Se «5a-1 — bygget».)*
26. **En sikker sendefeil der lagringen også feiler** (QA-porten 2.132.0): feiler databasen rett etter at ACS svarte
    `Failed`, står raden i `sending` og blir `uncertain`. Personen får ikke e-posten, men aldri to.
27. **En ny hovedversjon i øyeblikket før sendingen** (QA-porten 2.132.0): e-posten om den forrige kan gå likevel, og
    så den om den nyeste. Vinduet er det korte stykket mellom sjekken og sendingen.
28. **Grensen på 20 i minuttet gjelder per worker** (QA-porten 2.132.0). Prod har én worker, så to overlapper bare i en
    utrulling. Azure kan da strupe, og outboxen prøver igjen.
29. **En fane fra før 2.133.0** får en generell feilmelding (409) ved innlevering og lesing, for den gamle siden kjenner
    ikke kodene. Kladden står, for autolagringen var der allerede. Etter én innlasting er det over.
30. **En bestått på en gammel versjon etter en revisjon gir fortsatt kursbevis** (`upsertCertificationStatusFromDecision`
    skriver `ACTIVE` uten å se på versjonen; #997 rører bare dem som har bestått da revisjonen publiseres). Dette er ikke
    et kappløp, slik denne teksten først sa: vinduet er hele levetiden til innleveringen. Eksempel: deltakeren åpner en
    flervalgsmodul på v1 (innleveringen lages med en gang), forfatteren publiserer v2 med #997, og deltakeren svarer på de
    gamle spørsmålene en time etter. Flervalgsinnsendingen har ingen versjonssjekk, så det kommer ingen 409. Det samme
    gjelder vurderingskøen og en manuell vurdering eller anke som ender med bestått uker etter. Ingen lås kan rette dette.
    Slik har det vært siden #997, også i prod. **Faller bort når bryteren slås på:** versjonen avgjør (sannhetstabellen: «Nei i C»). Målt begge veier i
    `test/m2-module-pass-per-course-934-5a3.test.ts`, «innlevering på 1.x vurdert etter at 2.0 kom», med kontroll med bryteren av.
31. **Workeren finner kursene uten lås** (`checkAndIssueCourseCompletions`). Får et kurs modulen i det øyeblikket, sjekkes ikke
    det kurset. Kravet måles riktig; beviset kommer når deltakeren åpner kursbevissiden. Gjelder også et kurs som
    publiseres i det øyeblikket.
32. **Å opprette en anke og å ta en sak tar ikke deltakerlåsen.** De endrer saksgangen, ikke hva deltakeren har bestått, og
    planen tar dem ikke med. Et vedtak som kommer rett etter, venter som før på sin egen betingede overgang.
33. **Et admin-overtak før en deltakerlås som ikke ble ledig** (`manualReviewService`, `appealService`). Revisjonsraden for
    overtaket skrives før transaksjonen. Får vedtaket `503`, og siden prøver igjen, står det to rader om overtaket. Saken
    selv er rett; bare sporet er dobbelt. Krever en administrator som tar over en annens sak i de samme sekundene.
34. **Revisjonssporets lås og en rad kan låse hverandre fast** (uavhengig gjennomlesing 2.133.0; lest i koden, ikke kjørt).
    En innlevering tar revisjonssporets lås og så sakene den erstatter; å ta en sak tar raden og så låsen. En publisering av
    flere moduler og et vedtak har samme mønster. PostgreSQL stopper den ene: 500 og tilbakerulling, ingenting tapt. Et
    vedtak i en jobb prøves igjen, og vurderingen kjøres da på nytt. Rekkefølgen er eldre enn 5a-1.
35. **Et vedtak kan vente på revisjonssporets lås bak en lang publisering eller import.** Den låsen har ingen egen ventegrense,
    så vedtaket stopper på transaksjonens grense (8 sekunder) med 500, ikke 503, og siden prøver ikke igjen. Mens det står,
    holder det deltakerlåsen, så samme deltakers andre handlinger kan få 503. Ingenting tapt. Varigheten er ikke målt.
36. **Bytte av modul mens siden prøver igjen** (opptil om lag 31 sekunder ved 503). Svaret på modul A brukes da på modul B: A
    sin innleverings-id og spørsmål vises der. Å sende dem gir en feil, og innleveringen på A står uten vurdering. Ingen tekst går tapt.
37. **Småting på deltakersiden.** Etter `section_version_changed` er knappen aktiv, men gir 409 igjen til panelet åpnes på nytt.
    Hvert nytt forsøk teller mot grensen på 10 innleveringer, så et tredje klikk i en lang travel periode kan gi 429.
38. **`assertNotNested` ser bare de låste veiene.** `runInTransaction` eller `recordAuditEvent` uten `tx` inne i en lås stoppes
    ikke. Gjennomlesingen fant ingen slike kall i vedtaks- og vurderingsveiene den leste.
39. **Et hull i historikken kan gi et nummer ute av rekkefølge** (5a-2). En versjon uten nummer som ligger foran en med nummer i
    publiseringsrekkefølgen, får neste ledige nummer, ikke det den ville fått da. Det krever rader uten `publishedAt`, eller at
    gammel kode publiserte i utrullingsvinduet; publisering og tilbakefylling fyller hull før noe nytt gis. Nummeret er likevel unikt.
40. **En avkrysning uten beståtte** (5a-2). Fra nå gir den ny hovedversjon, som planen sier. I historikken ble den mindre, for den
    rørte ingen. Siden spør bare når noen har bestått, så dette krever et eget API-kall. Kravet blir høyere uten at noen merker det.
41. **En anke som snur en bestått, tar ikke beståtten i dag** (funnet i 5a-2, målt i `test/m2-module-credit-934-5a2.test.ts`). Vakta
    mot nedgradering i `upsertCertificationStatusFromDecision` sammenligner `passedAt` med innleveringens `submittedAt`, og et vedtak
    kommer alltid etter innleveringen. Statusen står som bestått, og kursbevis kan utstedes. Slik har det vært siden vakta kom. Det er
    ikke rettet her, for ingen utfall skal endres i 5a-2. `ModulePass` er rett, så det faller bort i 5a-3. Rapporten lister dem
    (`overturned_pass_kept_by_old_rule`) som ikke forventet, så de må ses på før bryteren slås på. Produkteier avgjør om det skal
    rettes før 5a-3, og hva som skjer med dem som alt har fått bevis. **Faller bort når bryteren slås på:** innleveringen teller ikke, og et nytt bevis utstedes ikke. Et bevis som alt er utstedt, står: det
    er permanent. Målt begge veier i `test/m2-module-pass-per-course-934-5a3.test.ts`. Kopien av prod hadde ingen slike.
42. **Den nyeste versjonen kan ha lavere hovedversjon enn den høyeste** (5a-2). Publiseres v4 først og et eldre utkast v3 etterpå med
    avkrysning, er v3 2.0 og v4 1.1. «Publiser nye versjoner» viser v4 som ventende, og gir `409 module_version_outdated`. Forfatteren
    må lagre en ny versjon. Krever to utkast samtidig og en avkrysning på det eldste.
43. **Tilbakefyllingen mot en samtidig revisjon** (5a-2). Den holder korte låser, så en revisjon kan komme mellom modulen og
    deltakeren. Da ligger beståtten igjen uten `invalidatedAt`, men kravet er hevet, så den teller ikke. Neste kjøring retter det.
    Grensen er tidspunkter fra revisjonssporet og vedtaket: et vedtak i samme millisekund kan havne på feil side. Rapporten viser det
    som `invalidated_but_old_rule_counts`.
44. **Rapporten er ingen fast avlesning** (5a-2). Den leser uten lås, så en publisering eller et vedtak underveis kan gi en
    forskjell som er borte ved neste kjøring. Den sammenligner per modul; hva det betyr for et kursbevis, står ikke i den.
45. **En eldre versjon som ble aktivert på nytt etter en revisjon, uten avkrysning** (5a-2, historikk). Gammel kode tillot det.
    Tilbakefyllingen gir den det gamle nummeret og setter kravet til den høyeste hovedversjonen. Med den nye regelen kan da ingen
    bestå modulen slik at det teller. Ny kode avviser det samme (`409 module_version_outdated`), så det kan bare gjelde historikk.
    Rapporten lister dem (`activeVersionBelowRequirement`) og er rød. Før bryteren slås på, må forfatteren publisere en ny versjon av
    modulen.
46. **En e-post om hovedversjon kan utebli ved et databasebrudd på siste forsøk** (4b, Codex 2026-11-05). Feiler både oppslaget og
    tilbakestillingen på outboxens siste forsøk, blir raden stående som `queued`, uten hendelse. Jobben leser bare `waiting` og
    gamle `sending`, så personen får ingen e-post og ingen ser det. Ingen får feil eller dobbel e-post, så det stopper ikke
    utrulling. Rettes med en oppsamling av gamle `queued`-rader, men det må tenkes gjennom så det ikke gir dobbel sending.
47. **Oppgaven kan bytte versjon på skjermen uten beskjed** (5a-1, gjennomlesing 2026-11-05). Byttes språk eller trykkes «Last
    moduler», hentes lista på nytt, og oppgaveteksten tegnes som den nye versjonen. Er felt-id-ene like, står svaret urørt, og en
    innlevering gir 201 på den nye versjonen, ikke 409. Deltakeren ser den nye oppgaven når hen leverer, og svaret vurderes mot den,
    så versjonen stemmer. Det hen ikke får, er beskjed om at oppgaven er endret. Produkteier avgjør om det er godt nok.
48. **Statusrapporten per modul viser ikke «revidert» når bryteren er på** (5a-3). Den leser `CertificationStatus` (`reviewAppealReport.ts:182`), som planen sier, og `SUPERSEDED` skrives ikke lenger. En som besto en
    eldre hovedversjon, står der som bestått. Modulen har ikke noe kurs å måle kravet mot, så svaret er ikke feil, men kategorien blir stående tom for nye revisjoner. Kursrapporten viser «må ta ny versjon».
49. **Tallene til den gamle dialogen leser modulstatus** (5a-3): `GET /modules/:id/passed-count` og `passedCount` i `pending-versions`. En som besto og strøk på nytt, telles ikke, selv om beståtten teller i et kurs. Dialogen
    spør da ikke, og svaret er mindre, så ingen mister noe. Dialogen fra 5b bruker `affectedCourses` og `publish-preview-versioned`, så tallene brukes bare mens bryteren er av (2.136.0).
50. **En forfatter som eier en modul, svarer også for kurs hen ikke eier** (5a-3). `publish-versioned` og `publish-pending-versioned` lister alle berørte kurs med tittel og antall kursbevis, og et svar «hoved» gir hovedversjon og e-post
    der. Planen sier «hvert kurs modulen ligger i», og deling mellom fagansvarlige er ønsket. Produkteier avgjør om det skal begrenses når dialogen fra 5b er sett.
51. **En bestått uten krav eller uten versjonsnummer vises som «revidert»** (5a-3, med bryteren på). Den skal ikke telle, men forklaringen stemmer ikke. Det kan bare skje hvis tilbakefyllingen ikke er kjørt: `syncModuleRequirements` og
    publiseringen holder radene ved like, og rapporten lister hull og er rød. Derfor står tilbakefylling og rapport rett før bryteren i rekkefølgen.
52. **Sammenligningsrapporten har ingen mening etter bryteren** (5a-3). Den sammenligner med den gamle regelen, og da er forskjeller forventet, også krav som ikke er modulens nåværende hovedversjon. Den er ikke sperret, for den leser bare.
53. **Datovinduet i kursrapporten kan gi et annet tall med bryteren på** (5a-3). Den gamle regelen så på siste bestått per modul. Den nye teller en bestått i perioden som teller i kurset, også om en nyere finnes utenfor perioden.
54. **Beskjeden om nytt forsøk følger åpningen fra kurset** (5a-3). Åpnes modulen fra «Last moduler» i stedet for fra kursraden, vet ikke siden hvilket kurs det gjelder, og viser det gamle resultatet, som i dag. Et nytt forsøk kan startes derfra også.

55. **«Publiser nye versjoner» vet ikke at en modul har fast nummer** (5b). En avpublisert modul uten nytt utkast står i lista med en versjon som har nummer. Svarer forfatteren hoved for et kurs den ligger i, avvises det (`409 module_version_number_fixed`), teksten sier hvorfor, og dialogen står. Forfatteren velger mindre, eller lagrer en ny versjon. Ingenting er skrevet. `affectedCourses` sier ikke noe om det per modul.
56. **Avviste svar må gis på nytt** (5b). Det er valgt, se «5b — bygget», men med mange kurs er det noen klikk til.
57. **Kalibreringssiden viser `versionNo`** (5b): versjonsvelgeren og tabellen. Det er et støtteverktøy, og nummeret der er det som står i rådataene. Seksjoner har ikke hoved og mindre, så `v3` i seksjonslista står.
58. **Over 200 per kurs: «ja» nullstilles når valget byttes** (5b, som i 4b). Bytter forfatteren til mindre og tilbake, må det krysses av på nytt. Det er den trygge retningen.

### Gjennomgang av planen

- **2026-11-02, for hånd mot koden:** skrivere av `SUPERSEDED`, lesere av beståtte, #997-spørsmålet i «Publiser nye
  versjoner», og at outboxen ikke har noen nøkkel mot dobbel sending. Tatt med over.
- **2026-11-03, Codex runde 1** (18 funn). Alle stemte i koden. Nyanser: nr. 5 om SVG brekker ingenting (oversettelsen
  ligger på raden, ikke i versjonen); nr. 10 og 15 beskriver hvordan koden virker allerede i dag; nr. 16: at slutten
  av N−1 skrives over starten i `CourseVersion`, er bevisst (skive 3).
- **2026-11-04, Codex runde 2** (15 nye funn; Codex regnet runde 1 nr. 2, 4, 6, 8, 13, 14, 16, 17 og 18 som løst).
  - Løst av låsene: runde 1 nr. 2, 3 og 11; runde 2 nr. 3, 4, 6 og 10.
  - Rettet i planen: nr. 2 (ingen reserveliste i skjemaet), nr. 5 (siden sender versjonen, også ved lesing), nr. 7
    (#997-historikken bevares eksplisitt og sjekkes mot ekte data først), nr. 11 («Publiser kurs» avviser moduler som
    har vært publisert før), nr. 14 (sjekk på nytt når e-posten sendes).
  - Fjernet: nr. 9 (kopien arver ikke beståtte, produkteier 2026-11-04).
  - Godtatt: nr. 1, 8, 12 (tømming) og 15 (utrullingsvinduet, «Kjente mangler» nr. 1), og nr. 13 («Kjente mangler»
    nr. 9). Nr. 8 er i tillegg dempet ved at tilbakefyllingen regner alt på nytt.
- **Ingen flere runder** (produkteier 2026-11-04). QA-porten tar hver skive når den er bygget.

### Spørsmål til produkteier

**E-posten i en ekte innboks** (stage, 2026-11-05, `test/stage/manuell-934-epost-outlook.spec.ts`): kom fram i Outlook til testkontoen. Båtbildet
vises, ingen lenker, riktig tittel, versjon og språk. Produkteier har sett den.

**Besvart 2026-11-05, alle anbefalingene:**
- Forfatteren får ikke beskjed når en lenkelignende kurstittel stopper e-posten. Raden står som `failed` med `contains_link`.
- Den engelske ordlyden med «boatyard» står.
- Forfatteren laster siden på nytt etter `409 course_changed`. Ingen sammenslåing.
- «Kjente mangler» nr. 23 står.
- Nr. 47: meldingen om at oppgaven er endret, kommer etter 5a-3.
- Et begrenset kurs skal kreve at personen er tildelt kurset, også for kursbevis. Egen sak etter #934, se `doc/DECISIONS.md`.

**Besvart 2026-11-03: ja til alle anbefalingene (a–e), og ja til grensen i b): over 200 mottakere krever et ekstra
«ja» i dialogen. Svar f: ja.**

a) **Lenke i e-posten.** Designet sier «lenke til kurset», men firmapolicy er ingen lenker (#1139). **Anbefaling:**
ingen lenke. Siste avsnitt sier i stedet «Logg inn på A-2 læringsplattform og åpne kurset under Mine kurs». Avsender
er den samme som påminnelsene.

b) **Hvem og hvor fort.** **Anbefaling:**
- bare aktive, ikke anonymiserte, med bevis for en eldre hovedversjon;
- én e-post per person;
- fordelt jevnt over minutter hvis det er mange mottakere.

Vil du ha en grense, for eksempel at over 200 mottakere krever et ekstra «ja» i dialogen?

c) **Eksisterende `SUPERSEDED`-rader fra #997.** De som allerede har mistet beståtten ved en tidligere revisjon,
fikk beskjed om å ta modulen på nytt. **Anbefaling:** de står som de er (ikke bestått). Å gi beståtten tilbake
nå ville stride mot e-posten de fikk.

d) **Kurs med bare modulen, ingen kursbevis ennå.** Uten kursbevis spørres det ikke. Det blir en mindre versjon,
som i skive 3. Samme regel også her?

e) **Fristen** (bestemt 2026-11-01): en oppfylt frist står som oppfylt etter hovedversjon, og det sendes ingen
påminnelser for den nye versjonen. 4b-e-posten er altså den eneste beskjeden. Riktig?

f) **Et nytt forsøk som stryker.** I dag tar et stryk på et nytt forsøk bort en tidligere bestått
(`certificationStatusService.ts:50–73`). Med beståtte per kurs kan ikke et stryk for kurs A ta beståtten fra kurs B.
**Avgjort 2026-11-03: en bestått står til modulen revideres** (#989), også når et senere forsøk stryker.

## Det som må holdes rett (fra DECISIONS)

- Et kursbevis er permanent (2026-08-20) — fortsatt sant: det gamle står og er gyldig for sin versjon.
- Kravet måles på utstedelsestidspunktet og lagres (`moduleSnapshotJson`/`sectionSnapshotJson`) —
  uendret, og nå per hovedversjon.
- Innhold i et utstedt kursbevis kan aldri slettes — gjelder alle bevis, også eldre versjoner.
- «Er kurset fullført» leses som **bevis for nåværende hovedversjon ELLER status**, aldri status alene
  (`isCourseCompleted()`).
