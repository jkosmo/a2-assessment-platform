# Beslutninger

Regler som ikke kan leses ut av koden alene — fordi de er **valg**, ikke konsekvenser.

## Hvorfor denne fila finnes

#938 tok en hel kveld å forstå. Ikke fordi koden var vanskelig, men fordi ingen kunne si hva regelen
var *ment* å være. Når det ikke står noe sted, kan man ikke avgjøre om et avvik er en feil eller en
beslutning — og da må hver diskusjon starte med å rekonstruere hensikten fra implementasjonen.

Alle tre reglene som styrte kursbevis lå i koden, ingen av dem sto skrevet:

| Regel | Hvor den bodde |
|---|---|
| `EXPIRED` teller som bestått | en kommentar i #820 |
| Et kursbevis er permanent | `if (existing) return` |
| Arkivert innhold teller ikke | ett filter på én av fem lesere |

## Hva som hører hjemme her

En beslutning der **et annet valg ville vært like forsvarlig**. Ikke hvordan noe er implementert —
det står i koden. Ikke hvorfor en feil ble fikset — det står i saken.

Skriv den når beslutningen tas. Én linje er nok; det er *at* den står som betyr noe.

**Format:** hva · hvorfor · hvor den håndheves · sak · dato · status.
Status er `avklart` eller `åpent spørsmål`.

---

## Kursbevis

### Et kursbevis er permanent og har ikke tilbakevirkende kraft

Har man bestått, forblir man bestått — også om kurset senere får nytt innhold. En ny versjon av
kurset gjelder pågående og framtidige kandidater, ikke de som allerede er ferdige.

**Hvorfor:** produkteier, 2026-08-20. «Skulle en innholdsprodusent lage en ny versjon av kurset der
man legger til moduler og seksjoner, vil det ikke ha tilbakevirkende kraft for de som allerede har
bestått kurset.»

**Håndheves:** `courseCompletionService.ts` — `if (existing) return`.
**Sak:** #933/#934 · **Dato:** 2026-08-20 · **Status:** avklart

⚠️ Konsekvens som er lett å snuble i: `courseStatus` kan falle tilbake til `IN_PROGRESS` for en
deltaker som *har* bevis, fordi `/api/courses` teller det nye innholdet inn i `total`. Derfor må
«er kurset fullført» leses som **bevis ELLER status**, aldri status alene (`isCourseCompleted()` i
`participant.js`). Å lese bare statusen ga et kurs som sto under «Fullført» og rendret seg som
pågående, uten sertifikatlenke.

### En fullført rad kan fortsatt åpnes — og skal kunne det

Et fullført kurs vises som én grønn rad (#939), men raden er ikke en blindvei: den kan ekspanderes,
og innhold som er lagt til ETTER at beviset ble utstedt er synlig og kan tas frivillig.

**Hvorfor:** verifisert av produkteier mot ekte data 2026-08-22, med begrunnelsen «kan ta dette
skulle jeg ønske». Beviset er permanent og skal ikke kreve mer arbeid — men nytt innhold skal
heller ikke være utilgjengelig for den som vil ha det.

**Håndheves:** `.course-done-row` beholder sjevronen og `focusCourse`-handleren
(`participant.js`); `.course-accordion-item--done:not(.is-focused) .course-accordion-body` skjuler
bare kroppen når kurset ikke er fokusert.

**Sak:** #939 · **Dato:** 2026-08-22 · **Status:** avklart

⚠️ Verdt å vite for den som senere vil «forenkle» den fullførte raden: å fjerne ekspanderingen ville
gjøre nytt kursinnhold utilgjengelig for alle som allerede har bestått. Raden ser ferdig ut, men
den er en inngang.

### Kravet måles på utstedelsestidspunktet, og lagres

Man har bestått når man har bestått alle moduler kurset inneholdt **da**, og bekreftet lest alle
seksjoner kurset inneholdt **på det tidspunkt**.

**Hvorfor:** produkteier, 2026-08-20. Uten et lagret øyeblikksbilde er halve regelen uetterprøvbar.

**Håndheves:** `CourseCompletion.moduleSnapshotJson` + `sectionSnapshotJson` — lista porten faktisk
målte mot, ikke en ny utledning.
**Sak:** #933 · **Dato:** 2026-08-19 (v2.23.0) · **Status:** avklart

⚠️ `sectionSnapshotJson` er nullbar med vilje og **ikke bakfylt**. `null` betyr ærlig «utstedt før vi
registrerte dette» — å bakfylle med `[]` ville påstått at gamle kurs var seksjonsfrie.

### Utstedelse skjer bare for publiserte kurs

**Håndheves:** `courseCompletionService.ts` — `if (!course.publishedAt || course.archivedAt) return`.
**Sak:** #934 · **Dato:** 2026-08-19 · **Status:** avklart

### Arkivert innhold teller ikke i kravet

Arkivering er måten innhold tas ut av sirkulasjon på. Å kreve at en deltaker leser en arkivert
seksjon er å kreve noe hen ikke kan gjøre — og et krav som aldri kan oppfylles er verre enn ikke
noe krav.

**Hvorfor:** produkteier, 2026-08-20, på spørsmål om arkivert innhold skulle telle: «Nei.»

**Håndheves:** i dag inkonsistent — porten filtrerer arkiverte seksjoner, men ikke arkiverte
moduler, og framdriftsvisningen filtrerer ingen av delene.
**Sak:** #938/#944/#945 · **Dato:** 2026-08-20 · **Status:** **implementert** i v2.26.1/v2.26.2

### Innhold som står i et utstedt kursbevis kan aldri slettes

Arkivert materiale var en del av pensum da diplomet ble utdelt og må bevares som grunnlaget for
det. Arkivering er greit — sletting er det ikke.

**Hvorfor:** produkteier, 2026-08-21. «Arkivert materiale var naturligvis del av pensum når diplom
ble utdelt og må bevares som grunnlag for diplom, men ellers ikke.»

**Håndheves:** ikke ennå. G2 nekter sletting mens innholdet ligger i et kurs, men når det er fjernet
derfra er sletting tillatt — og ingenting sjekker om en `CourseCompletion` peker på det.
**Sak:** #938 · **Dato:** 2026-08-21 · **Status:** **implementert** i v2.26.2 (kun seksjoner — moduler var allerede dekket av `certificationStatuses`-sjekken i `deleteModule`)

⚠️ Bevisst bivirkning: innhold noen har fått diplom på blir permanent uslettbart.

### En seksjon deltakeren ikke kan åpne vises ikke i sekvensen i det hele tatt

Upublisert og arkivert lesestoff **utelates** fra deltakersekvensen. Det merkes ikke som
utilgjengelig — det er ikke der.

**Hvorfor:** hvert annet svar var allerede «nei». Begge deltakerrutene (`GET`/`POST
.../sections/:id`) svarer 404, bevisporten krever den ikke, og framdriften teller den ikke. #944 ga
seksjonen et `available`-flagg i stedet, men #992 viste at klienten ignorerer flagget for seksjoner
(`const available = isSection || entry.available !== false`) — raden så klikkbar ut og endte i 404.
Et halvt løfte er verre enn ingen: enten er elementet der og virker, eller så er det ikke der.

⚠️ **Moduler er UNNTATT, og det er en annen beslutning.** En avpublisert modul står igjen i
sekvensen med `available: false`, fordi klienten faktisk rendrer den som deaktivert, tilstanden er
midlertidig, og modulen teller i `moduleTotal` og i kursbevisets krav. Å skjule den ville endret hva
beviset krever.

**Håndheves:** `courseRepository.findCourseItemsForParticipant` — regelen er i spørringen, og
returtypen bærer ikke feltene den bygger på, så ingen kaller kan utlede en egen variant.
**Sak:** #958, utløst av #992 · **Dato:** 2026-08-23 · **Status:** avklart

⚠️ Ikke bekreftet med produkteier — skrevet ned som den regelen refaktoreringen i #958 håndhever, ut
fra at alle andre flater allerede oppførte seg slik. Skulle produkteier heller ville se det
utilgjengelige lesestoffet, er det klientens `available`-håndtering som må fikses (#992), ikke denne
døra som må åpnes.

---

## Sertifisering

### Moduler utløper ikke — de gjelder til de revideres

En bestått modul forblir bestått. Det finnes ingen utløpsdato og ingen resertifisering. Vil man at
innhold skal gjelde på nytt, reviderer man modulen.

**Kurs kan fortsatt ha tidsrom.** Innmeldinger har `dueAt` — en frist for å bli *ferdig*. Det er noe
annet enn en utløpsdato på kunnskap, og den røres ikke.

**Hvorfor:** produkteier, 2026-08-22. «Å tvinge folk å ta samme modul om og om igjen er bare mas.»

Avgjørende for beslutningen var at mekanismen kostet uten å virke:

| | |
|---|---|
| Alle moduler utløp etter 365 dager | global verdi i `config/assessment-rules.json`, ikke per modul |
| Utløpt blokkerte **ingenting** | `EXPIRED` telte som bestått i kursbevisporten |
| Følgen | påminnelser om å fornye noe ingenting krevde fornyet |

⚠️ **Å fjerne resertifisering endrer derfor ingen bestått-avgjørelse.** Ikke én. Porten ignorerte
allerede utløp, så mekanismen kan tas ut uten at noen får et annet resultat enn i dag.

**`passedAt` beholdes** — når en modul ble bestått har verdi i seg selv. Det er bare utregningen av
utløp og forfall som forsvinner.

**Ingen krav utenfra** krever dokumentert resertifisering (bekreftet med produkteier). Skulle det
komme et slikt krav, er dette beslutningen som må gjøres om.

**Sak:** #989, oppløser #947 · **Dato:** 2026-08-22 · **Status:** avklart, ikke implementert

### «Bestått en modul» = enhver livssyklustilstand unntatt `NOT_CERTIFIED`

`CERTIFICATION_PASSED_STATUSES` inneholder `EXPIRED`. En utløpt modulsertifisering teller altså
fortsatt mot et kursbevis.

**Hvorfor:** #820 formulerer det som robusthet — å liste beståtte tilstander eksplisitt holder
sjekken riktig hvis en ny ikke-bestått tilstand legges til senere.

**Håndheves:** `certificationRepository.ts:9-18`, brukt av `countPassedModulesForUser`.
**Sak:** #820, gjenåpnet som #947 · **Dato:** 2026-08-21 · **Status:** **åpent spørsmål**

⚠️ Konsekvensen er ikke uttalt noe sted: hvis «bestått» er en historisk kjensgjerning som ikke
utløper, betyr resertifisering noe annet enn navnet antyder, og `deriveRecertificationStatus` er
uten konsekvens for kursporten. Trenger et ja eller nei fra produkteier.

---

## Innholdsleveranse fra agent

### Fil-eksport/-import er hovedveien; API-veien beholdes som mulighet

Agent-authoring-API-et (`/agent-authoring/validate` + opprettelse) er bygd, testet og utrullet på
både stage og prod. Det er likevel **ikke** veien innhold faktisk kommer inn: produkteier bruker
fil-eksport og -import, og det fungerer godt for kurs.

**Hvorfor:** API-veien krever et agent-token som aldri er utstedt, og at agenten har nettverk til
verten — noe en agent i en sandkasse-chat ikke har. Filveien har ingen av delene som forutsetning.

**Beslutning (produkteier, 2026-08-22):** behold API-veien som en mulighet for framtiden, ikke fjern
den. Men **filveien er den som skal virke**, og den må dekke isolerte moduler og seksjoner — ikke
bare kurs.

⚠️ Konsekvens for skillet: det som `SKILL.md` kaller «fallback» er i praksis hovedveien. Den ble
aldri oppdatert da frittstående seksjonseksport kom (#916), og derfor finnes `scope: "section"`
ingen steder i skillet. Det er årsaken til #987 — ikke en glipp i én fil, men at den mest brukte
stien var dokumentert som unntaket.

**Sak:** #987 · **Dato:** 2026-08-22 · **Status:** avklart, ikke implementert

## Innhold og språk

### Ren streng betyr «ett språk, ikke oversatt ennå»

Et lokalisert felt som er en **ren streng** betyr at teksten finnes på ett språk og ikke er oversatt.
Et **objekt** med hull betyr genuint manglende oversettelse. De to må aldri forveksles.

**Hvorfor:** skillet er den eneste kilden til «hva er faktisk oversatt». Kode som fyller alle tre
språk med kildeteksten ødelegger informasjonen permanent — den kan ikke gjenskapes fra dataene.

**Håndheves:** `localizedTextMaybeUntranslatedSchema` kontra `localizedTextSchema`,
`missingLocalesFor` (leser en ren streng som `nb`).
**Sak:** #892 · **Status:** avklart, brytes tre steder i dag (#981, #982)

### Feilkoden er kontrakten, ikke teksten

Backend returnerer en **kode**; klienten slår den opp i sin egen tabell og rendrer på brukerens
språk. Serverens `message` er en engelsk reserve for API-konsumenter uten tabell — aldri det som
vises.

**Hvorfor:** konsollene er trespråklige og defaulter til `en-GB`. En norsk setning fra serveren
vises da ordrett til en engelsk forfatter, og omvendt.

**Håndheves:** `public/static/import-error.js`, publiseringsgatens `issues[]`.
**Sak:** `FEATURE_SURFACE_MAP` §24, #937 · **Status:** avklart, brutt på mange flater (#972, #980, #983, #985)

## Tilgjengelighet av innhold

### Upublisert innhold vises ikke for kandidater i det hele tatt

En seksjon uten aktiv versjon — utkast, eller holdt tilbake av oversettelsesgaten — **utelates fra
deltakerens kurssekvens**. Ikke nedtonet, ikke merket «utilgjengelig»: borte. SMO ser den i
kursbyggeren som før.

Den skal heller ikke ha konsekvenser: ikke telle i framdriften, ikke kreves for kursbeviset, ikke
stoppe «Avslutt kurset».

**Hvorfor:** produkteier 2026-08-23, på spørsmål om vi heller burde nekte forfatteren å legge et
utkast inn i et publisert kurs: *«La oss ikke vise utkastseksjoner for kandidater før de er
publisert, SMOer kan se dem … utkastseksjoner skal ikke ha konsekvenser for kandidater før de er
publisert.»*

Det er det motsatte valget av å blokkere, og det er begrunnet i arbeidsflyten: forfatteren skal
kunne sette sammen et kurs og fylle det med innhold i den rekkefølgen hen vil. Prisen for å blokkere
ville vært å tvinge fram «skriv ferdig først, sett sammen etterpå».

⚠️ Dette **erstatter** #944-tilnærmingen, som viste en nedtonet rad. Den var et kompromiss: raden
skulle fortelle deltakeren at «det er noe her» i stedet for at noe forsvant. Men for en kandidat som
aldri har sett seksjonen, finnes det ingenting å forklare — raden var en beskjed om vår egen
redigeringstilstand.

⚠️ **Moduler er ikke det samme, og endres ikke.** En avpublisert eller arkivert modul vises fortsatt
som en ikke-klikkbar rad (#502-followup). Forskjellen er historikk: deltakeren kan allerede ha
bestått modulen, og da er raden hens egen fortid, ikke vår redigering. Den teller likevel ikke som
krav (#945).

**Håndheves:** `courses.ts` (sekvensen filtreres), `isSectionAvailableToParticipant`,
`test/m2-course-section-read.test.ts`.
**Sak:** #944, #992 · **Status:** avklart 2026-08-23

### Manglende `available` fra serveren betyr «vis den», ikke «skjul den»

Klientens `isEntryAvailable` tolker `undefined` som tilgjengelig. Bare et eksplisitt `false` skjuler
noe.

**Hvorfor:** feltet er PÅKREVD i DTO-en, så det mangler bare når klienten snakker med en eldre
server — typisk midt i en utrulling. Tolket vi `undefined` som utilgjengelig, ville en
versjonsmismatch skjult **hele kurset** for deltakeren. Det er verre enn den blindveien regelen
finnes for å hindre, og feilen ville sett ut som datatap.

Det motsatte valget er like forsvarlig i teorien («feil på den sikre siden»), men her er «den sikre
siden» å vise for mye, ikke for lite: serveren nekter uansett med 404 på lesestien, så en klient som
viser en rad for mye gir en feilmelding — en klient som skjuler alt gir et tomt kurs.

**Håndheves:** `public/participant-console-state.js`,
`test/participant-sequence-predicate-guard.test.js`.
**Sak:** #992 · **Status:** avklart

### «Neste» hopper over utilgjengelig innhold i stedet for å stoppe

`nextEntryAfter` går videre til første tilgjengelige element, ikke til neste rad.

**Hvorfor:** alternativet — å stoppe ved det utilgjengelige — låser deltakeren bak innhold hen ikke
kan gjøre noe med. Regelen «et krav som aldri kan oppfylles er verre enn ikke noe krav» (#944) er
den samme; her gjelder den navigasjonen. Elementet vises fortsatt i sekvensen, men som ikke-klikkbart:
deltakeren skal se at det er der, ikke lure på om noe forsvant.

**Håndheves:** `test/e2e/participant-section-advance.spec.ts`.
**Sak:** #992 · **Status:** avklart

### Detaljer fra serveren vises til forfattere, ikke til deltakere

Toastens detaljfelt beholder Zod-utdata på admin-flatene og er fjernet på deltakerflaten.

**Hvorfor:** ikke et sikkerhetsskille, men et nyttighetsskille. En forfatter kan bruke
`path: ["bodyMarkdown"]` til å finne feilen i fila si; en kandidat midt i en test kan ikke, og for
hen er dumpen bare støy som ser ut som en systemfeil. Å fjerne feltet begge steder ville gjort
importfeil vanskeligere å diagnostisere uten å hjelpe noen.

**Håndheves:** `test/e2e/participant-section-advance.spec.ts` (deltaker, ingen `.toast__detail`),
`test/e2e/section-portability-916.spec.ts` (forfatter, detaljfeltet skal være der).
**Sak:** #988, #992 · **Status:** avklart

## Roller og innsyn

### Revisjonssporet leses av alle med et oppfølgingsforhold til kandidaten

`SUBMISSION_AUDIT_READERS` (`src/auth/roleSets.ts`) inneholder fem roller: ADMINISTRATOR,
SUBJECT_MATTER_OWNER, REVIEWER, APPEAL_HANDLER og REPORT_READER. Det er et valg, ikke en
forglemmelse.

**Hvorfor:** produkteier 2026-08-23 begrunnet de to som så uventede ut:

- **SUBJECT_MATTER_OWNER** er *«å regne som en lærer som har det praktiske pedagogiske ansvaret for
  oppfølging av kandidater.»*
- **REPORT_READER** er *«potensielt kandidaters mentorer som skal kunne følge opp kompetansemål
  avtalt i eksempelvis medarbeidersamtaler.»*

Settet er altså ikke «alle som er litt privilegerte». Det er alle med et **oppfølgingsforhold** til
en kandidat. Et revisjonsspor viser hva som faktisk skjedde med en innlevering — når den kom, hvem
som vurderte, hva som ble overstyrt — og det er nettopp det de fem trenger.

⚠️ QA-porten meldte dette som en divergens mot `/api/reports`, som kun er ADMINISTRATOR og
REPORT_READER. Den er tilsynelatende: de to svarer på **ulike spørsmål**. `/api/reports` er analyse
på tvers av organisasjonen; revisjonssporet er oppfølging av ett menneske. At mentoren finnes begge
steder, og læreren bare det ene, følger av nettopp det.

### ⚠️ Det avgjørelsen ikke løser — og som den gjør skarpere

Begge begrunnelsene hviler på et **forhold**: «mine kandidater», «mine mentees». Det forholdet
finnes ikke i datamodellen.

Konsekvensen er at hver av de fem rollene ser **enhver** innlevering i **ethvert** kurs. En mentor
med ansvar for tre personer kan lese revisjonssporet til alle. REVIEWER og APPEAL_HANDLER får alt,
ikke bare saker de er tildelt.

**Rollene er riktige. Avgrensningen mangler.** Det er et datamodellspørsmål, ikke et
rollespørsmål — og derfor en egen sak, ikke en justering av dette settet.

**Håndheves:** `test/role-set-guard.test.js` fester settene, så en endring må gjøres bevisst i
stedet for å oppdages i en nattskanning.
**Sak:** #962, #1000, #941 · **Status:** avklart 2026-08-23

## Publisering av kurs

### Et kurs kan publiseres uten moduler — seksjoner alene er nok

`publishCourse` krevde minst ett element med `itemType: "MODULE"`. Et kurs som bare består av
lesestoff kunne ikke publiseres, uansett hvor mange publiserte seksjoner det hadde.

Regelen fjernes. Kravet blir **minst ett element**, av hvilken som helst type.

**Hvorfor:** produkteier 2026-08-24, på spørsmål om dette var tilsiktet: *«jeg tviler på at rene
seksjonskurs vil trengs, men det krever kompleksitet å aktivt hindre det samt at vi ville måtte
forklare brukere begrensningen som også krever mer.»*

⚠️ Merk formen på begrunnelsen: beslutningen er ikke at rene lesekurs er *ønsket*. Den er at
**å hindre dem koster mer enn å tillate dem** — kode som skal vedlikeholdes, pluss en forklaring
til brukeren om hvorfor knappen ikke virker. En regel må tjene til livets opphold.

Regelen ga mening da et kurs var en beholder for moduler. Etter #916 er seksjoner likeverdige
kurselementer med egen publiseringsgate, og da var kravet blitt vilkårlig.

⚠️ **Kodebasen motsa seg selv i mellomtiden**, og det er slik dette ble oppdaget:

- `courseReport.ts` har en test som heter *«reports a completion rate for a module-free reading
  course»* — #969 fikset nevneren nettopp for det tilfellet. Rapporten regnet altså ut
  fullføringsgrad for et kurs porten nektet å publisere.
- `test/m2-section-export-import-916.test.ts` måtte legge inn en dummy-modul kalt «QA modul» for å
  komme forbi porten, med en kommentar om at blokkertesten ellers ville bestått av feil grunn.

**Det kravet IKKE blir:** null elementer. Et tomt kurs skal fortsatt ikke kunne publiseres — den
delen av den gamle porten var reell beskyttelse, ikke vilkårlighet, og den beholdes.

**Sak:** #1001 · **Status:** avklart 2026-08-24

## Vurdering

### MCQ-beståttgrensen er 70 %, med mindre modulen sier noe annet

`assessmentPolicy.passRules.mcqMinPercent` avgjør. Mangler den, er grensen **70 %**.

**Hvorfor:** produkteier 2026-08-24: *«50% er veeeldig lavt. MCQ spørsmålene er jevnt over for enkle,
så 70% er et minimum med mindre noe annet er eksplisitt satt for modulen.»*

⚠️ Dette er ikke en ny regel — det er regelen `decisionService` allerede brukte for å fatte vedtaket.
Det som var galt, var at `mcqService` regnet ut visningsfeltet `passFailMcq` med en **hardkodet
50 %-grense** og lagret den. En kandidat med 60 % fikk dermed vedtaket «ikke bestått, under 70 %»
side om side med raden «MCQ bestått: Ja» i ankebehandlerens skjermbilde.

⚠️ **Hvor 50-tallet kom fra, og hvorfor det er lærerikt:** linja ble stående igjen av commiten
`refactor: forenkle vurderingsmodell til én terskel (#257)`. Commiten som forenklet til ÉN terskel
er den som etterlot den andre. En opprydding som fjerner en modell må lete etter avledede verdier
som fortsatt regnes etter den gamle.

**Konsekvens for lagrede rader:** `passFailMcq` er en avledet verdi som lagres, og det er selve
feilklassen. Riktig kur er å utlede den ved lesing fra `percentScore` + policyen, ikke å bakfylle.
Produkteier bemerket at bare siste forsøk har konsekvens, og lesestedene viser allerede bare det.

**Sak:** #949 · **Status:** avklart 2026-08-24

### Historiske vurderingsdata rettes ikke retroaktivt i pilotfasen

Et feil beregnet visningsfelt på gamle rader (#949 sitt `passFailMcq`) rettes **ikke** med et
backfill-skript. Skrivingen rettes, og gamle rader står som de står.

**Hvorfor:** produkteier 2026-08-24: *«Det er så lite reelle data både på stage og prod at noen
unøyaktigheter ikke har betydning, vi er fortsatt kun i tidlig pilot, det viktige er at ting blir
riktig fremover.»*

⚠️ Beslutningen kom av spørsmålet *«Et vedlikeholdsskript som endrer sensur av tidligere vurderte
moduler?»* — stilt om et skript som var ferdig bygget og testet. Skriptet endret teknisk sett ingen
sensur (`AssessmentDecision` er urørt, og ingen beslutningslogikk leser feltet), men spørsmålet
avdekket at begrunnelsen for å velge backfill framfor utledning var **implementasjonsbekvemmelighet**,
ikke et prinsipielt argument.

⚠️ **Generaliseringen, som er den varige verdien her:** et vedlikeholdsskript som muterer
vurderingsdata og som ikke bør kjøres, er en felle som ligger i repoet og venter på noen som ikke
leser hele historikken. Bygg det ikke «for sikkerhets skyld».

Dette gjelder pilotfasen. Med reelle volumer må avveiningen tas på nytt — da kan et feil visningsfelt
i en ankesak ha konsekvenser en tørrkjørt, reverserbar retting ikke har.

**Sak:** #949, #1005 · **Status:** avklart 2026-08-24
