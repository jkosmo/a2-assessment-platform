# #934 — hovedversjon og mindre versjon for kurs og moduler

Status: **avklart med produkteier** 2026-11-01 (skissen godkjent). Skive 1 bygget i 2.127.0, skive 2 i 2.128.0, skive 3 i 2.129.0; skive 4–5 gjenstår.
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

## Det som må holdes rett (fra DECISIONS)

- Et kursbevis er permanent (2026-08-20) — fortsatt sant: det gamle står og er gyldig for sin versjon.
- Kravet måles på utstedelsestidspunktet og lagres (`moduleSnapshotJson`/`sectionSnapshotJson`) —
  uendret, og nå per hovedversjon.
- Innhold i et utstedt kursbevis kan aldri slettes — gjelder alle bevis, også eldre versjoner.
- «Er kurset fullført» leses som **bevis for nåværende hovedversjon ELLER status**, aldri status alene
  (`isCourseCompleted()`).
