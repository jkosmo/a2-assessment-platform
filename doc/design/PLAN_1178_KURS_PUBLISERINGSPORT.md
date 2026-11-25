# #1178 skive 2: publiseringsporten sjekker kursets navn og beskrivelse

Prinsipp 4 i «Oversetting, lagring, publisering og «Avbryt»: felles prinsipper» (doc/DECISIONS.md, godtatt 15.11.2026):
publiseringen sjekker at alt deltakerne ser, finnes på alle tre språk, også kursets navn og beskrivelse. Mangler noe, tilbys
«Fyll inn det som mangler».

Skive 1 (2.182.0) er lagringen: kurset oversetter bare felt som er endret, og et mål som ikke ble oversatt, står tomt. Uten
skive 2 kan et kurs da publiseres med et tomt språk i navnet. Begge skivene går til prod i samme pakke.

Punkt 3 i saken («publiseres uten dialog når alt er publisert») er alt rettet i #1164: «Publiser» spør alltid.

## Regelen

- Navnet må finnes på nb, nn og en-GB. Beskrivelsen er valgfri: er den tom på alle språk, er den komplett. Har den tekst på
  ett språk, må den ha tekst på alle tre. Samme regel som modulens og seksjonens port: `missingLocalesFor`
  (contentValidationService.ts). En ren streng (fra før språkkartene) leses som bokmål, og de to andre mangler.
- Én funksjon på tjeneren, `courseTextGateIssues({ title, description })`, i ny fil `src/modules/course/courseTextGate.ts`.
  Svarer med `issues: [{ code: "translation_incomplete", field: "title" | "description", missingLocales }]`, samme form som
  seksjonsporten.
- Avvisning: `422 course_translation_incomplete` med `details.issues`. Ingenting er publisert.

## Veiene inn (alle som gjør kursets navn og beskrivelse synlige for deltakerne)

| # | Vei | Kode | Hva porten gjør |
|---|-----|------|-----------------|
| 1 | «Publiser», alt innhold publisert | `publishCourseChecked` → `publishCourse` | Sjekker kursraden etter låsen. Avviser. |
| 2 | «Publiser», med upubliserte elementer | `publishCourseCascade` | Sjekker FØR noe skrives: i forhåndssjekken før låsen, og på nytt etter låsen, før første element publiseres. Avviser. |
| 3 | «Publiser utkastet» | `POST …/draft/publish` → `publishCourseDraft` | Sjekker kursraden ETTER `updateCourse` i samme transaksjon (utkastet kan utelate navnet, «som publisert»; det er resultatet som går ut). Avviser; transaksjonen rulles tilbake, og utkastet står. |
| 4 | Import av et publisert kurs | `contentImportService` → `publishCourse` | Holder tilbake, avviser ikke: kurset importeres upublisert (`anyContentHeldBack`), som når en modul mangler språk (#896 S4, #996). Svaret sier at kurset ble holdt tilbake. |
| 5 | Import som oppdaterer et kurs (`updatePlan`) | rører ikke publiseringen (#1095) | Ingenting. |

Hvordan porten plasseres: en sjekk i `publishCourse` selv ville tatt vei 1, 2 og 4, men vei 4 skal holde tilbake og ikke
avvise. Derfor tar `publishCourse` et valg: `publishCourse(courseId, actorId, tx)` avviser alltid (vei 1 og 2), og importen
spør porten FØR den kaller `publishCourse`, og lar være å publisere når porten har funn. Vei 3 kaller porten selv.

Andre veier som skriver navn og beskrivelse på et publisert kurs uten utkast: `PUT /courses/:id` og `PUT …/content` (direkte
lagring). Klienten lagrer et publisert kurs til utkastet (#1140), men tjeneren avviser ikke en direkte lagring av et publisert
kurs uten utkast. Det er en lagring, ikke en publisering, og utenfor denne saken. Føres som kjent mangel hvis det stemmer.

Ikke en vei: `publish-pending` / `publish-pending-versioned` publiserer elementene, ikke kursets tekst.

## Klienten: «Fyll inn det som mangler»

Mønsteret er seksjonenes (`publishErrorToast` + `fillMissingThenPublish`): publiseringen avvises, meldingen sier hva som
mangler, og har knappen «Fyll inn det som mangler». Knappen oversetter bare hullene, fra et språk som har tekst (bokmål først,
så grensesnittspråket), lagrer, og publiserer på nytt med de samme svarene (versjon, e-posttall).

- **Vei 1 og 2, fra lista eller fra skjemaet:** henter kurset (`GET /courses/:id`), oversetter hullene, lagrer navn og
  beskrivelse med `PUT /courses/:id` og telleren (`expectedRevision`) som ble hentet. Har noen andre lagret siden: `409`,
  ingenting endres. Så `commitCoursePublish` på nytt.
- **Vei 3, fra skjemaet** (det eneste stedet «Publiser utkastet» finnes): fyller hullene inn i feltene, lagrer utkastet med
  `saveCourse(courseId, { beforePublish: true, skipTranslation: true })`, og publiserer utkastet på nytt.
  `skipTranslation` trengs: ellers ville lagringen sett de utfylte språkene som «endret» og oversatt de andre fra dem.
- Kunne ikke alt fylles: det som lyktes, lagres, og publiseringen prøves ikke. Meldingen sier det.
- Ny kode i den delte feiltabellen (`api-error.js`): `course_translation_incomplete`, med språkene.

## Samtidighet

- Porten leser etter innholdslåsen i vei 1–3, i samme transaksjon som publiseringen. En lagring som kommer mellom
  forhåndssjekken og låsen, ses.
- «Fyll inn»-lagringen bruker telleren (vei 1–2) eller utkastets id og teller (vei 3). En annen lagring imellom gir 409, og
  ingenting skrives.

## Utrulling

- Ingen migrering. Ingen nye felt i databasen.
- Ny tjener, gammel fane: den gamle klienten får `422 course_translation_incomplete` og viser meldingen fra den delte
  tabellen, eller tjenerens engelske setning hvis koden er ukjent. Den kan ikke fylle inn; forfatteren laster siden på nytt.
- Ny klient, gammel tjener (under utrullingen): tjeneren avviser ikke, og kurset publiseres som før.
- Kurs i prod som alt mangler et språk i navnet, påvirkes ikke før de publiseres på nytt eller et utkast publiseres. Da
  tilbys «Fyll inn». Jeg teller hvor mange det gjelder i prod før utrulling (et lesende skript), så det ikke kommer som en
  overraskelse.

## Tester

- Integrasjon: hver vei 1–4 med et kurs som mangler nn i navnet (avvist eller holdt tilbake), og en kontroll med alle tre
  (publisert). Beskrivelse tom på alle språk: publiseres. Beskrivelse bare på nb: avvist. Vei 2: ingen elementer publisert
  når porten avviser. Vei 3: utkastet står når porten avviser.
- E2e: «Fyll inn det som mangler» fra lista (vei 2) og fra skjemaet (vei 3): hullene oversettes, ingenting annet sendes til
  oversetting, publiseringen går. Og 409 under utfyllingen: ingenting publiseres.
- Mutasjoner: fjern porten i hver vei; fyll alle språk i stedet for hullene; dropp `skipTranslation`.

## Alvorlighetsregel for gjennomlesingen

Dette er et internt system for kompetanseutvikling. NO-GO bare for det som er sannsynlig i vanlig bruk og gjør reell skade,
eller sjeldent men alvorlig og vanskelig å rette. Sjeldne kanttilfeller føres som kjente mangler, også når de kalles
produktspørsmål.
