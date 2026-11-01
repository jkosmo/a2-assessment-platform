# #934 — hovedversjon og mindre versjon for kurs og moduler

Status: **avklart med produkteier** 2026-11-01 (skissen godkjent). Ikke bygget.
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
   flate. Alle eksisterende blir 1.0.
2. Forfatterdialogen for kurs (lagre endring, publiser nye versjoner) + versjon i lister.
3. Deltakerflaten: «Ny versjon», bevis med versjon, rapportkategori «må ta ny versjon».
4. E-post.
5. Moduler: avkrysningen #997 → hoved/mindre, og kursenes hovedversjon fra modulens.

Hver skive kan rulles ut alene. Skive 1 endrer ingenting synlig for noen.

## Det som må holdes rett (fra DECISIONS)

- Et kursbevis er permanent (2026-08-20) — fortsatt sant: det gamle står og er gyldig for sin versjon.
- Kravet måles på utstedelsestidspunktet og lagres (`moduleSnapshotJson`/`sectionSnapshotJson`) —
  uendret, og nå per hovedversjon.
- Innhold i et utstedt kursbevis kan aldri slettes — gjelder alle bevis, også eldre versjoner.
- «Er kurset fullført» leses som **bevis for nåværende hovedversjon ELLER status**, aldri status alene
  (`isCourseCompleted()`).
