# Arkivering og sletting som rydder (#1148) — plan for etappe 2 og 4

Samlesak: #1148. Etappe 1 (#1149) har sin plan i saken. Etappe 3 (#1151) og 5 (#1153) er beskrevet i sakene sine.
Denne siden dekker de to etappene der en feil ikke kan angres: **arkivering som følger med nedover** (#1150) og
**sletting etter seks måneder** (#1152).

Status: forslag, andre utgave. Første utgave ble lest av en uavhengig agent 13.11.2026 (Codex var utilgjengelig); funnene
er arbeidet inn og merket «(gjennomlesing)» der de endret planen. Produkteier har svart på alle spørsmålene (sist på siden).

Etappe 2 bygges i tre skiver i 2.159.0: **2a-1** (lesing: «brukes andre steder» ser utkastene, «midt i» som «Mine kurs»,
forhåndsvisningen) og **2a-2** (tjeneren: arkiveringen tar innholdet med seg, gjenopprettingen setter det tilbake, manglende
kursbevis utstedes først) og **2b** (dialogene i klienten, `doc/FEATURE_SURFACE_MAP.md` §33d) er bygget. Valgene som ikke står her: `doc/DECISIONS.md`
(«Arkivering ser utkastene …» og «Kursarkiveringen tar innholdet med seg …»).

## Avgjort av produkteier 13.11.2026

1. Et kurs med en deltaker midt i kan arkiveres med en bekreftelse som viser hvor mange det gjelder.
2. Innhold med deltakerhistorikk slettes aldri automatisk. Det blir stående arkivert og skjult.
3. Forfatteren får en liste å bekrefte når moduler og seksjoner følger kurset inn i arkivet.
4. Arkiverte kurs teller ikke som bruk (etappe 1). Sletting er unntatt, se #1149.

Stående prinsipper som gjelder her: mest mulig likt mellom kurs, moduler og seksjoner; ingen bryter som ikke kan
begrunnes utover utrullingen; få e-poster.

---

## Etappe 2 (#1150): arkivering følger med nedover

### Regelen

Når et kurs arkiveres, arkiveres også hver modul og seksjon i kurset som **ikke brukes andre steder**. «Andre steder» er:

- et annet kurs som ikke er arkivert (definisjonen fra etappe 1), eller
- et lagret utkast (#1140) til et annet kurs som ikke er arkivert. I dag ser ingen «i bruk»-sjekk utkastene. Arkiveres et
  element som bare står i et utkast, feiler utkastet først når det skal publiseres. Her sjekkes det på forhånd.

Det som deles, blir stående urørt.

**Ett svar på «brukes andre steder» (gjennomlesing).** Den samme funksjonen brukes av kursarkiveringen, av arkivering for
hånd, av importen og av slettingen i etappe 4. Ellers kan et element som står i et annet kurs' utkast, arkiveres for hånd
og slettes etter seks måneder. Oppslaget i utkastene må bo der utkastets innhold tolkes i dag (rutelaget leser
`payloadText`; `courseDraft.ts` gjør det ikke, og en vakt nekter andre lesere av tabellen). Et utkast uten elementliste
betyr «som publisert».

**Kursets eget utkast (gjennomlesing).** Har kurset et lagret utkast når det arkiveres, forkastes utkastet, og dialogen
sier det. Alternativet er verre: etter gjenoppretting ville kurset stått upublisert med et utkast som verken kan lagres
eller publiseres, og som stopper all annen lagring av kurset.

### Hva systemet må huske

Gjenoppretting skal sette tilbake **det som fulgte kurset inn, slik det var**. To nye, valgfrie kolonner på `Module` og
`CourseSection`:

- `archivedWithCourseId`: settes når elementet arkiveres som følge av kurset.
- `activeVersionIdBeforeArchive`: versjonen som var publisert da elementet fulgte kurset inn. Arkivering nullstiller
  `activeVersionId` i dag uten å huske den.

Regler:

- Begge nullstilles når elementet gjenopprettes, alene eller sammen med kurset.
- Gjenoppretting av kurset gjenoppretter elementene der merket peker på kurset **og elementet fortsatt ligger i kurset**
  (gjennomlesing: til etappe 3 er i prod, kan elementlista i et arkivert kurs endres).
- Ingen fremmednøkkel: slettes kurset (etappe 4), skal ikke elementet bli med av den grunn. Merket er et merke, ikke et
  eierskap. Slettingen nullstiller det.
- Arkivering for hånd og importens arkivering setter ikke merket.

Additiv migrering, ingen endring av eksisterende felt.

### Gjenoppretting (gjennomlesing: første utgave virket ikke)

Første utgave sa at alt lander som utkast og publiseres på nytt med «Publiser kurs med innhold». Det går ikke:

- «Publiser kurs med innhold» avviser moduler som har vært publisert før (`409 course_publish_has_republished_modules`).
- «Publiser nye versjoner» tar bare elementer forfatteren eier, og publiserer ikke kurset.
- Republisering tar alltid nyeste versjon. Lå det en upublisert lagring oppå, ville den gått ut.
- Svarer forfatteren «hovedversjon» på et kurs med kursbevis, regnes alle seksjoner som endret, og alle må lese på nytt.

Forslag: **gjenoppretting av kurset setter innholdet tilbake slik det var.**

- Elementene som fulgte kurset inn, får tilbake versjonen de hadde (`activeVersionIdBeforeArchive`). De er publisert igjen,
  med samme versjon og samme nummer. Det gjelder også elementer forfatteren ikke eier: den som fikk arkivere dem med
  kurset, får sette dem tilbake.
- Kurset selv lander som utkast, som i dag. Forfatteren trykker «Publiser». Ingen spørsmål om versjon: ingenting er endret.
- Gjenoppretting gir aldri ny hovedversjon. Lesinger og beståtte teller som før arkiveringen.
- Dette er et unntak fra «arkivert ⇒ gjenopprettes som utkast» (I3), og bare for elementer som fulgte et kurs. Et element
  som gjenopprettes alene, lander som utkast som før.
- Dialogen for gjenoppretting viser hva som kommer tilbake, og hva som **ikke** gjør det: elementer i kurset som ble
  arkivert for hånd, av importen, eller sammen med et annet kurs. De må gjenopprettes hver for seg, og kurset kan ikke
  publiseres før det er gjort (`item_archived`, finnes).

### Forløpet for forfatteren

1. «Arkiver» på et kurs henter en forhåndsvisning: `GET /api/admin/content/courses/:id/archive-preview`.
   - `inProgressCount`: deltakere midt i kurset.
   - `follows`: modulene og seksjonene som arkiveres sammen med kurset.
   - `stays`: de som blir stående, med hvilke kurs som bruker dem.
2. Dialogen viser lista og tallet, med én bekreftelse.
3. `POST …/archive` sender med det forfatteren så (`expected`: id-ene i `follows`, og `inProgressCount`).
   - Stemmer det ikke lenger: `409 course_archive_preview_changed`, og dialogen henter på nytt. Samme form som
     kaskadeslettingen (#762), som kjører analysen på nytt under låsen.
   - Uten `expected` (en gammel fane, eller et direkte kall): `409` når noen er midt i kurset
     (`course_has_active_participants`, som i dag) **eller når noe ville fulgt med** (gjennomlesing: ellers arkiveres
     innhold uten at lista er bekreftet). Bare et kurs uten deltakere midt i og uten elementer som følger, arkiveres uten
     `expected`.
4. Alt skjer i én transaksjon under innholdslåsen: kurset, elementene, merkene, utkastet, revisjonsloggen.

**Tallet «deltakere midt i» (gjennomlesing).** Dagens telling regner alle med et kursbevis som ferdige, også et bevis for
en eldre hovedversjon, og teller innleveringer på en delt modul for alle kursene den ligger i. Tallet forfatteren
bekrefter, skal komme fra samme lesere som «Mine kurs» bruker for «påbegynt».

### Deltakeren som er midt i

- Kurset forsvinner fra «Mine kurs», som i dag for et arkivert kurs.
- Lesehistorikk, besvarelser og beståtte moduler beholdes. Gjenopprettes og publiseres kurset, står fremdriften der.
- Den som oppfyller kravet mens kurset er arkivert (en besvarelse som vurderes ferdig etterpå), får ikke kursbevis:
  utstedelsen hopper over arkiverte kurs. Beviset kommer hvis kurset gjenopprettes og publiseres. Se etappe 4 for hva det
  betyr for sletting.
- En besvarelse som ligger til vurdering når kurset arkiveres, vurderes ferdig. Resultatet finnes i historikken.
- En modul som fulgte kurset inn i arkivet, kan ikke lenger åpnes (arkivert modul har ingen aktiv versjon). Det tetter
  hullet der modulene i et arkivert kurs fortsatt kunne åpnes direkte.
- Ingen e-post til deltakeren.

### Eierskap

Den som kan arkivere kurset, arkiverer også elementene som følger med, selv om en annen forfatter eier dem, **så sant de
ikke brukes i andre kurs** (produkteier 13.11.2026). Det er samme regel som for egne elementer. Importen gjør det samme i
dag. Lista i dialogen merker elementene forfatteren ikke eier, og de følger med tilbake ved gjenoppretting.

### Veier inn som må med

- Kurslista og det åpnede kurset («Arkiver», «Gjenopprett»).
- `POST /courses/:id/archive` og `/restore` kalt direkte (agent-API-et kan ikke arkivere; sjekkes).
- Importens `updateExisting`, som arkiverer utbyttede elementer: uendret, men skal bruke samme «brukes andre steder».
- Arkivering av en klasse rører ikke kurs. Uendret.
- Enkeltarkivering av en modul eller seksjon: uendret, setter ikke merket.

### Samtidighet

- To forfattere: A arkiverer kurs X mens B legger en av modulene inn i kurs Y. Begge skriver under innholdslåsen, så den
  som kommer sist, ser den andres resultat: enten blir modulen stående (B først), eller B får `course_item_archived`
  (A først).
- Forhåndsvisningen er et forslag. Arkiveringen regner på nytt under låsen og svarer 409 hvis lista er endret.
- Gjenoppretting av kurset tar samme lås.

### Utrulling

- Migreringen er additiv. Gammel kode leser ikke kolonnene.
- Mens gammel og ny kode kjører side om side, kan gammel kode gjenopprette et element uten å nullstille merkene, eller
  gjenopprette kurset uten elementene. Gjenopprettingen av kurset ser derfor også på at elementet faktisk er arkivert, og
  et kurs gjenopprettet av gammel kode kan repareres ved å gjenopprette elementene for hånd.
- Gammel fane mot ny tjener: se punkt 3 over.
- Ny klient mot gammel tjener (under utrullingen): forhåndsvisningen svarer 404, og klienten faller tilbake til dagens
  bekreftelse.

### Tester

- Gjennom rutene: eksklusivt innhold følger med; delt innhold står; innhold i et annet kurs' utkast står; gjenoppretting
  tar med nøyaktig det som fulgte inn; håndarkivert element blir ikke gjenopprettet; 409 når lista endres; deltaker midt
  i med og uten bekreftelse.
- Prøvesteinen: et tomt kurs med én deltaker halvveis kan arkiveres med bekreftelse, og lesehistorikken finnes etterpå.
- Dekningsvakt: bare kursarkiveringen setter `archivedWithCourseId`; alle gjenopprettinger nullstiller den.
- Nettleser: dialogen med lista, tallet og 409-forløpet.

---

## Etappe 4 (#1152): sletting etter seks måneder

### Hva som kan slettes

Sletting er bare for arkivert innhold. Et element kan slettes når det ikke har deltakerhistorikk:

| Type | Beholdes for alltid når | Slettes sammen med elementet |
|---|---|---|
| Kurs | noen har kursbevis for kurset, eller har oppfylt kravet uten å ha fått beviset ennå | påmeldinger og frister, klassetildelinger, lesehistorikk, diskusjon, kursutkast, versjonshistorikk, varsler, tema-koblinger |
| Modul | noen har levert på den, eller har en sertifiseringsstatus eller et bestått på den | versjoner, flervalgssett, kriterier, ledetekster |
| Seksjon | den inngår i et utstedt kursbevis | versjoner, bilder, lesehistorikk |

For moduler og seksjoner er dette vaktene som finnes i dag, med ett unntak: en arkivert modul med versjoner, men uten
besvarelser, kan i dag ikke slettes i det hele tatt. Det rettes.

**Kurs: bare kursbevis holder igjen (produkteier 13.11.2026).** «Kursbevis OK. Bestått en modul og diskusjon, ikke nok,
slett.» Et kurs uten kursbevis slettes etter fristen, med påmeldinger, frister, klassetildelinger, lesehistorikk og
diskusjon.

- **Diskusjonen slettes med kurset.** Det er tekst deltakerne har skrevet, og skjemaets egen regel for diskusjon har
  vært «aldri slett for godt». Avgjørelsen gjelder foran den regelen for kurs som slettes; `doc/DECISIONS.md` må si det.
- **Et bestått holder ikke kurset igjen.** Modulen med besvarelsen beholdes uansett (egen vakt), så resultatet finnes.
- **Fullført uten kursbevis holder kurset igjen (produkteier 13.11.2026: «Ja … I så fall bør det gis beskjed om dette til
  den som forsøker å slette»).** En deltaker som oppfyller hele kurskravet mens kurset er arkivert, får ikke kursbevis,
  fordi utstedelsen hopper over arkiverte kurs. Det skjer når en besvarelse blir bestått etter arkiveringen: etter manuell
  behandling, etter en anke, eller (sjelden, minutter) når den automatiske vurderingen var i gang da kurset ble arkivert.
  - Slettingen sjekker kurskravet før den sletter. Oppfyller noen det uten å ha beviset, stoppes slettingen.
  - **Den som trykker «Slett», får vite hvorfor:** hvor mange deltakere det gjelder, at de har fullført kurset etter at
    det ble arkivert, og at kurset må gjenopprettes og publiseres for at de skal få kursbeviset. Egen feilkode, tekst på
    tre språk.
  - Lista over arkiverte sier det samme: «Beholdes: en deltaker har fullført uten kursbevis».
  - Jobben hopper over kurset av samme grunn, og skriver det i revisjonsloggen første gang.
  - Dette er ikke «bestått en modul», men «har fullført kurset».
- **Arkiveringen sier fra på forhånd.** Forhåndsvisningen i etappe 2 viser også hvor mange besvarelser i kurset som
  ligger til vurdering, manuell behandling eller anke. Da vet forfatteren at noen kan fullføre etter arkiveringen.

Et element som fortsatt ligger i et kurs, kan ikke slettes (databasen nekter). Rekkefølgen løser det: kurset slettes
først, og da er elementene fri. Et arkivert element uten egen historikk som ligger i et arkivert kurs som **beholdes**, kan
derfor aldri slettes. Lista sier det («Beholdes: ligger i et kurs som beholdes»).

**Slett krever arkivert, på tjeneren (gjennomlesing).** I dag er det bare klienten som skjuler «Slett» for det som ikke er
arkivert; `deleteCourse`, `deleteModule` og `deleteSection` sjekker det ikke. Etappe 3 legger sjekken på tjeneren, og den må
være i prod før jobben får slette.

### Fristen

- Seks måneder fra siste arkivering (`archivedAt`). Gjenoppretting nullstiller, ny arkivering starter på nytt.
- Konstanten ligger i `src/config/retention.ts`, ved siden av de andre oppbevaringstidene.
- **Overgang uten bryter:** innhold som var arkivert før funksjonen kom, regnes som arkivert den dagen funksjonen kom.
  Ingenting slettes derfor de første seks månedene, men lista viser slettedatoen fra første dag. Det gir et halvt år der
  vi ser hva jobben kommer til å gjøre, før den gjør det. En egen av/på-bryter trengs ikke.
- **Hvordan koden vet «dagen funksjonen kom» (gjennomlesing):** ett tidspunkt per miljø, skrevet av migreringen som en rad
  i `PlatformConfig` (settes til nå hvis raden mangler). En konstant i koden holder ikke: stage og prod får funksjonen på
  ulike dager.
  - Frist = seks måneder etter det seneste av `archivedAt` og dette tidspunktet.
  - Lista og jobben leser samme verdi, så datoen i lista er datoen jobben bruker.
  - Mangler raden, nekter jobben å slette og melder seg usunn. Glemmes gulvet, ville første kjøring ellers slettet alt
    som ble arkivert for over seks måneder siden.
  - En kopi fra prod til stage tar med prods tidspunkt. Det er ufarlig (stage sletter da tidligst når prod ville gjort
    det), og oppskriften for kopien bør si det.

### Jobben

- Daglig i workeren, etter mønsteret fra `AuditRetentionMonitor`: i bunker, kaster aldri videre, melder helse.
- **Ikke ved oppstart, og én sletting per transaksjon (gjennomlesing).** Mønsteret kjører i dag ved oppstart av workeren,
  altså midt i hver utrulling og hver morgenomstart. Slettingen tar innholdslåsen, og mens den holdes, venter deltakernes
  lesing og innlevering. Jobben kjører derfor på et fast tidspunkt om natten, sletter ett element om gangen, og slipper
  låsen mellom hvert.
- Rekkefølge per kjøring: kurs først, så moduler og seksjoner.
- Jobben har ingen egne sletteregler. Den kaller den samme slettefunksjonen som knappen «Slett», med de samme vaktene.
  Et element som vaktene stopper, hoppes over og merkes «beholdes».
- **De to andre som sletter i dag (gjennomlesing):** kaskadeslettingen (#762) og masseryddingen av upubliserte moduler
  sletter selv, og ingen av dem rydder eierrader. De skal kalle den felles slettefunksjonen. Dekningsvakta «bare
  slettefunksjonen sletter kurs, moduler og seksjoner» gjelder da uten unntak.
- Hver sletting skrives i revisjonsloggen som en varig hendelse (ikke en driftshendelse, som ryddes etter sju dager):
  type, id, navn, når det ble arkivert, og at det var fristen som slettet.
- Eierrader (`ContentOwner`) og bildefiler ryddes i samme forløp. I dag blir eierradene liggende.

### Hva forfatteren ser

- I listene, under «Arkiverte»: «Slettes 13.05.2027», eller «Beholdes» med grunnen: har besvarelser, har kursbevis,
  en deltaker har fullført uten kursbevis, eller ligger i et kurs som beholdes.
- «Slett» på et arkivert element virker for alt som kan slettes, også moduler. Forfatteren som ikke vil vente seks
  måneder, sletter selv.
- Ingen e-post før sletting. Datoen står i lista.

### Veier inn som må med

- «Slett» for kurs, modul og seksjon fra lista og fra det åpnede elementet.
- Kaskadeslettingen (#762, administrator): beholdes, og bruker de samme vaktene. Den skal kreve at kurset er arkivert,
  som resten (hører til etappe 3).
- Masseryddingen av upubliserte moduler: uendret.
- Jobben.

### Samtidighet

- Jobben og en forfatter som gjenoppretter samme element: begge under innholdslåsen. Jobben leser `archivedAt` på nytt
  under låsen og hopper over det som er gjenopprettet.
- Jobben og en importering som peker på et arkivert element: etappe 3 stenger import inn i arkiverte mål. Etappe 3 må
  derfor være i prod før jobben får slette. Fristen på seks måneder gir den rekkefølgen av seg selv.

### Utrulling

- Én additiv migrering: indeks på `archivedAt` for kurs, modul og seksjon, og raden med overgangstidspunktet.
- Slettefunksjonen for moduler kan komme først, alene, og prøves med «Slett»-knappen på stage.
- Jobben kommer etterpå. Den kan ikke slette noe før seks måneder etter at den kom.
- Slettingen kan ikke prøves med ekte ventetid på stage. Den prøves i integrasjonstester med flyttede datoer, og med
  «Slett»-knappen mot ekte stage-data (samme funksjon).

### Tester

- Gjennom rutene, per type: kan slettes / beholdes, med hver grunn. Kontroll: ikke-arkivert kan ikke slettes.
- Jobben med flyttede datoer: under fristen, over fristen, gjenopprettet i mellomtiden, overgangsdatoen.
- Kurs med eksklusivt innhold: kurset først, så innholdet, i samme kjøring eller neste.
- Ingenting med kursbevis eller besvarelser forsvinner: en test som teller radene før og etter.
- Dekningsvakt: bare slettefunksjonen sletter kurs, moduler og seksjoner; jobben har ingen egen `delete`.

### Byggeplan etter etappe 3 (14.11.2026)

Kartlagt i koden etter 2.160.0. Planen over står; dette er det som er nytt, og skivene.

**Nytt siden planen ble skrevet**

- **Etappe 3 er i prod:** sletting krever arkivert på tjeneren, og kaskaden krever arkivert kurs. Kravet «etappe 3 i prod før
  jobben sletter» er oppfylt.
- **Merket fra etappe 2 (`archivedWithCourseId`) nullstilles alt når et kurs slettes** (`clearArchiveMarksForCourse`, både
  vanlig sletting og kaskaden). `archivedAt` blir stående, så fristen for elementene regnes fra da kurset ble arkivert.
- **Kursenes versjonshistorikk peker ikke på modulversjoner med fremmednøkkel.** `CourseVersion.sectionVersionsJson` og
  øyeblikksbildene i kursbevisene (`CourseCompletion`) har bare id-er som tekst, og leserne slår dem ikke opp. Et kurs vi
  beholder, mister derfor ingenting når et element det en gang hadde, slettes. Kursbevisene er dessuten vernet: en modul
  med sertifiseringsstatus og en seksjon i et utstedt bevis slettes aldri.
- **Ingen kode sletter innleveringer eller sertifiseringsstatuser.** Begge er `Restrict` mot modulen, så en modul med
  deltakerhistorikk kan ikke slettes, heller ikke ved en feil i vaktene.

**Fire hull planen ikke dekket**

1. **«Fullført uten kursbevis» kan ikke måles med dagens hjelper på et arkivert kurs.** `findCourseInProgressParticipants`
   ser bort fra arkiverte moduler og seksjoner, og fra 2.159.0 er kursets egne elementer arkivert sammen med kurset. Kravet
   krymper da til de delte elementene, og den som bare har bestått en delt modul, ser fullført ut. Sjekken før sletting må
   måle kravet slik det var da kurset ble arkivert. «Alle elementene uansett `archivedAt`» er feil, og feil i den farlige
   retningen (gjennomlesingen): kravet for kursbevis har aldri tatt med en seksjon uten publisert versjon eller en modul som
   var arkivert før kurset. Se «Etter gjennomlesingen», punkt 1.
2. **Sletting ser ikke kursutkast.** Arkiveringen (etappe 2) teller et utkast som bruk, men slettingen gjør det ikke. Et
   arkivert element som står i utkastet til et annet kurs, kan slettes, og utkastet kan da ikke publiseres
   (`course_draft_item_unusable`). Rettes: slettingen teller utkast likt med arkiveringen. Grunnen i lista: «Beholdes: står i
   utkastet til et kurs».
3. **Slettefunksjonen for moduler må skrives om.** Den nekter i dag alt som har versjoner, med en vanlig `Error` som blir den
   generelle `delete_module_failed`. Den må slette i riktig rekkefølge (versjoner, så flervalgsspørsmål og -sett, kriterier og
   ledetekster; bestått og kurskrav går av seg selv) og gi egne feilkoder med tekst på tre språk. Den må også tåle at
   ingen person står bak (jobben): `actorId` blir valgfri, som for kurs og seksjoner.
4. **Mønsteret fra `AuditRetentionMonitor` er svakere enn planen antok.** Det kjører ved oppstart, melder aldri feil og blir
   først «usunt» etter 72 timer. Jobben følger i stedet `WeeklyDigestMonitor`: sjekker ofte, men sletter bare i et vindu om
   natten (Oslo-tid), med `maxTickMs`, `lastError`, `lastSummary` og frist ved oppstart.

**Rydding som følger med:** eierrader (`ContentOwner`) slettes sammen med kurs, modul og seksjon; i dag blir de liggende for
alle tre. Kaskaden skriver en hendelse per seksjon i revisjonsloggen, som den gjør per modul. Kaskaden sletter bare elementer
som er arkivert. Et aktivt element som bare lå i kurset (kurs arkivert før 2.159.0), blir stående, og forhåndsvisningen sier
det. Det følger regelen «slett krever arkivert».

**Masseryddingen av upubliserte moduler** sletter moduler som aldri er arkivert, og er motsatt regel. Den står som et
eksplisitt unntak og går ikke gjennom den felles slettefunksjonen.

**Skiver**, hver sin pakke som kan stå alene i prod:

- **4a. Sletting som virker, med en gang (ingen jobb, ingen migrering).**
  - Modulen slettes med versjonene sine; egne feilkoder (`module_has_submissions`, `module_has_certification`) og tekst.
  - Kurset: «fullført uten kursbevis» stopper slettingen, med egen kode og tekst som sier hvor mange det gjelder og hva som
    må til (gjenopprett og publiser).
  - Utkast teller som bruk ved sletting.
  - Eierrader ryddes for alle tre typene.
  - Kaskaden: bare arkiverte elementer, hendelse per seksjon.
  - Prøves med «Slett»-knappen på stage mot ekte data, og løser det stage-testen for 2.160.0 fant (arkivert modul kunne ikke
    slettes).
- **4b. Forfatteren ser datoen.**
  - Én additiv migrering: indeks på `archivedAt` for kurs, modul og seksjon, og raden med overgangstidspunktet i
    `PlatformConfig` (settes til nå hvis den mangler; første gang en migrering skriver en rad der).
  - En felles funksjon svarer for hvert arkivert element: «slettes <dato>» eller «beholdes» med grunnen. Den kaller de samme
    vaktene som slettingen, så lista og slettingen kan ikke si forskjellig.
  - Listene viser svaret under «Arkiverte».
- **4c. Jobben.**
  - Sjekker hvert tiende minutt, sletter bare mellom 02:00 og 05:00 Oslo-tid, ett element per transaksjon, kurs først.
  - Kaller den felles funksjonen fra 4b og den samme slettingen som knappen. Ingen egne regler.
  - Revisjonsloggen får `source: retention` på hver sletting, og «beholdes» første gang et element hoppes over.
  - Mangler overgangsraden, sletter jobben ingenting og melder seg usunn.
  - Kan ikke slette noe før seks måneder etter at 4b kom i miljøet.

**Samtidighet:** jobben og knappen tar innholdslåsen og leser `archivedAt` og vaktene på nytt under låsen. Én sletting per
transaksjon holder låsen kort; deltakerne venter høyst 3 sekunder før de får «prøv igjen».

**Tester:**

- Gjennom rutene, per type og per grunn til å beholde, med kontroll.
- Modulen med versjoner slettes; tellingen av innleveringer, sertifiseringsstatuser og kursbevis er lik før og etter.
- Kurs der den eneste beståtte er en delt modul: ikke «fullført».
- Kurs der alt er bestått uten bevis: beholdes, med grunnen.
- Utkast som nevner elementet: beholdes.
- Jobben med flyttede datoer: under og over fristen, gjenopprettet imens, overgangsraden mangler, utenfor nattvinduet.
- Dekningsvakt: bare slettefunksjonene sletter kurs, moduler og seksjoner (unntak: masseryddingen, med grunn).
- Stage-test for 4a mot ekte data.

### Etter gjennomlesingen (Codex og en uavhengig Claude-agent, 14.11.2026)

Begge sa «ikke klar», hver for seg, med de samme tre hovedfunnene. Endringene under går foran teksten over der de er
uenige.

1. **Kravet måles slik det var da kurset ble arkivert, med de samme reglene som når kursbevis utstedes.**
   - Modul: med når den ikke er arkivert, eller når den ble arkivert sammen med kurset (`archivedWithCourseId` = kurset).
     En modul arkivert for seg før kurset er ikke med, som ved utstedelse.
   - Seksjon: med når den er tilgjengelig for deltakerne nå, eller når den ble arkivert sammen med kurset og hadde en
     publisert versjon (`activeVersionIdBeforeArchive` satt). Arkiveringen nullstiller `activeVersionId`, så døra for
     deltakere alene ville latt alle seksjonene falle ut.
   - Samme beståttregel (kreditt per kurs, `moduleCredit.ts`, med kravet til hovedversjon) og samme lesingsregel som i dag.
   - Er det uklart om et element var påkrevd, regnes det **ikke** som påkrevd. Tvil gjør flere «fullført», og det gir
     «beholdes».
   - Måles før merkene nullstilles (`clearArchiveMarksForCourse`).
   - Ingen ny lagring trengs: merket fra 2.159.0 sier hva som fulgte kurset. Kurs arkivert før 2.159.0 har elementene sine
     aktive, så de telles med av seg selv.
2. **Ny grunn til å beholde et kurs: «venter på vurdering».** Så lenge en innlevering i kursets moduler venter på vurdering,
   manuell behandling eller anke (`countCoursePendingReviews`), kan kurset ikke slettes, verken med knappen eller av jobben.
   Grunnen går bort av seg selv når sakene er avgjort. Et vedtak tar bare låsen per deltaker, så slettingen tar
   deltakerlåsene (`lockLearnersInContentWrite`) før den måler, slik arkiveringen gjør. Nye innleveringer kan ikke starte
   mens innholdslåsen holdes.
3. **Kaskadeslettingen bruker de samme vaktene:** kursvakta i punkt 1 og 2, bruksregelen med utkast, og opprydding av
   eierrader. Den vurderer kurset før den fjerner elementene.
4. **Masseryddingen av upubliserte moduler** beholder unntaket for «krever arkivert», men bruker den felles bruksregelen
   med utkast. En ny modul som bare står i et lagret utkast, er under arbeid og skal ikke slettes.
5. **Transaksjonene:** hver type får en indre funksjon som tar en transaksjon (vurder, slett), og en ytre som åpner den.
   Knappen, kaskaden og jobben bruker de indre. Alt leses på nytt under låsen: at elementet finnes, at det er arkivert,
   fristen regnet på nytt, overgangsdatoen, bruk og historikk. Finnes elementet ikke lenger, hoppes det over (to workere
   under en utrulling).
6. **Jobben gjør ikke workeren usunn.** «Usunn» betyr at hele workeren startes om, og da stopper vurderingene. Mangler
   overgangsraden, eller er den ugyldig, sletter jobben ingenting og sier det i `lastError` og `lastSummary`, som ikke
   påvirker helsa. Hver runde har en tidsgrense godt under `maxTickMs`. Monitoren registreres for oppstart, helse og
   avslutning som de andre.
7. **Lista og jobben skal si det samme om elementer i et kurs som slettes.** Et element som ligger i et kurs som selv kan
   slettes, viser den seneste av sin egen og kursets dato, ikke «beholdes». «Slett»-dialogen for kurset lister elementene
   som går etterpå.
8. **Migreringen:** `INSERT … ON CONFLICT DO NOTHING` med `updatedAt` satt (kolonnen har ingen standardverdi). 4b starter
   klokka: kommer 4c mer enn seks måneder senere, sletter den det lista har vist fra første natt. En kopi fra prod til stage
   tar med prods dato, og stage kan da slette med en gang; oppskriften for kopien skal si det.
9. **Kostnad:** kursvakta regnes bare for arkiverte kurs, én gang per forespørsel.

**Kjente mangler (stopper ikke bygging):**

- Bildefiler som ikke lar seg slette etter commit, blir liggende (som i dag); de logges.
- Et utkast som ble liggende på et kurs arkivert mellom 2.156 og 2.159, teller ikke som bruk. Et element i et slikt
  utkast kan slettes, og utkastet må da forkastes.
- Et kurs som aldri ble publisert, kan stå som «fullført uten kursbevis» for alltid, fordi innleveringer telles per modul.
  Det beholder mer enn nødvendig, ikke mindre. Teksten sier «har fullført kravet uten kursbevis», ikke «etter
  arkiveringen».

**Tester i tillegg:**

- Kurs med en upublisert seksjon og en deltaker som har fullført resten: beholdes.
- Kurs med en modul arkivert for seg før kurset: telles ikke med.
- Kurs med en innlevering som venter: beholdes; avgjøres den, kan kurset slettes.
- Et vedtak som kommer mens slettingen holder låsene: venter, og slettingen ser resultatet.
- Kaskaden og masseryddingen mot et utkast som nevner elementet.
- Manglende overgangsrad: ingen sletting, workeren frisk.

---

## Rekkefølge

1. Etappe 1 (#1149): arkiverte kurs teller ikke som bruk. Under bygging.
2. Etappe 2 (#1150): arkivering følger med nedover.
3. Etappe 3 (#1151): arkivert betyr urørlig.
4. Etappe 4 (#1152): slettefunksjonen for moduler, så jobben.
5. Etappe 5 (#1153): kopier husker opphavet.

Hver etappe er sin egen pakke og kan stå alene i prod.

## Avgjort av produkteier 13.11.2026, andre runde

1. **Hva holder et kurs igjen for alltid?** «Kursbevis OK. Bestått en modul og diskusjon, ikke nok, slett.» Bare
   kursbevis. I tillegg, bekreftet samme dag: et kurs der en deltaker har fullført alt uten å ha fått beviset (manuell
   behandling eller anke etter arkiveringen), holdes igjen, og den som prøver å slette, får beskjed om hvorfor.
2. **Elementer forfatteren ikke eier:** følger kurset inn i arkivet og tilbake, «så sant det ikke brukes i andre kurs».
3. **«Slett» med en gang** for arkivert innhold som ikke holdes igjen: ja.
4. **Gjenoppretting av et kurs setter modulene og seksjonene tilbake som publiserte, med samme versjon som før:** ja.

Ingen åpne spørsmål. Etappe 2 kan bygges etter denne planen.
