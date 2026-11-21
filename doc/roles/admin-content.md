# Innholdsadministrator (`SUBJECT_MATTER_OWNER`)

Innholdsadministratorer oppretter, publiserer og vedlikeholder vurderingsmoduler og kurs.

## Hva innholdsadministratorer har tilgang til

- `/admin-content` — modul- og kursadministrasjon
- `/results` — rapporter og fullføringsstatistikk
- `/calibration` — kalibreringssarbeidsflate (konfigureres per miljø)
- `/profile` — egen profil

API:
- `GET/POST /api/admin/content/modules` — liste og opprett moduler
- `PUT/DELETE /api/admin/content/modules/:id` — rediger og slett moduler
- `POST /api/admin/content/modules/:id/publish` — publiser modulversjon
- `POST /api/admin/modules/:id/archive` — arkiver modul
- `GET/POST /api/admin/content/courses` — liste og opprett kurs (et nytt kurs er begrenset, #1164)
- `PUT /api/admin/content/courses/:id` — rediger kurs
- `POST /api/admin/content/courses/:id/publish` — publiser kurs
- `POST /api/admin/content/courses/:id/archive` — arkiver kurs
- `GET /api/reports/*` — alle rapporter

## Sentrale arbeidsflyter

### 1. Opprette ny modul fra bunnen

1. Gå til `/admin-content` → fanen **Moduler**
2. Klikk **Opprett modul**
3. Fyll inn metadata:
   - **Tittel** — navn på modulen (støtter en-GB, nb, nn)
   - **Beskrivelse** — hva modulen dekker
   - **Innleveringstype** — tekst, fil, MCQ, eller kombinasjon
   - **Sertifiseringsnivå** — valgfritt fritekstfelt (f.eks. «Grunnleggende»)
4. Legg til **rubrikk** — punktene AI-en vurderer, med beskrivelse og maksimumpoeng per punkt
5. Legg til **MCQ-spørsmål** (om aktuelt) — spørsmål med svaralternativer og riktig svar
6. Lagre som kladd
7. Forhåndsvis og verifiser innholdet
8. Publiser modulen (se neste arbeidsflyt)

**Merk:** En modul lagres som kladd og er ikke synlig for deltakere før den publiseres.

### 2. Publisere og avpublisere en modulversjon

**Publisere:**
1. Finn modulen i listen under fanen **Moduler**
2. Klikk **Publiser** på den aktuelle versjonen
3. Modulen får status «Publisert» og er nå synlig for deltakere

**Avpublisere:**
1. Finn publisert modul
2. Klikk **Avpubliser**
3. Bekreft i dialogboksen
4. Modulen fjernes fra deltakernes oversikt, men eksisterende besvarelser påvirkes ikke

**Merk:** Avpublisering blokkerer ikke pågående besvarelser som allerede er levert.

### 3. Arkivere en modul og gjenopprette fra arkivbiblioteket

**Arkivere:**
1. Finn modulen i listen
2. Klikk **Arkiver** (kun tilgjengelig på avpubliserte moduler)
3. Bekreft i dialogboksen
4. Modulen flyttes til **Arkivbiblioteket**

**Gjenopprette fra arkiv:**
1. Gå til **Arkivbiblioteket** under **Moduler**-fanen
2. Finn ønsket modul
3. Klikk **Gjenopprett**
4. Modulen gjenopprettes som kladd — publiser på nytt for å gjøre den tilgjengelig

#### Hva du ser på en arkivert modul eller seksjon

Et arkivert element kan åpnes og leses, men ikke endres (som et arkivert kurs). Linja under statusmerket sier «Modulen er
arkivert og kan ikke endres. Gjenopprett den for å endre den.» (eller «Seksjonen …»). Lagre og Avbryt er borte, og feltene er
sperret i alle fanene — også innstillingene, kriteriene, vurderingsinstruksen og innsendingsskjemaet, som står utfoldet så de
kan leses.

Du kan:
- **Eksportere** elementet.
- **Gjenopprette** det: i handlingsraden når elementet er åpnet, eller i lista. Etterpå kan det endres igjen.
- **Slette** det for godt (bare et arkivert element kan slettes).
- Endre **eierne** (under Innstillinger).

**Slettes eller beholdes (fra 2.162.0).** Under «Arkiverte» i listene for kurs, moduler og seksjoner står det under merket
enten «Slettes 13.05.2027» eller «Beholdes: <grunn>». Arkivert innhold som ingen deltaker har brukt, slettes av seg selv
seks måneder etter at det ble arkivert (jobben gjør det om natten fra 2.175.0; ingenting slettes før 14.05.2027). Grunnene til å beholde
er de samme som «Slett» ville gitt: har kursbevis, en deltaker har fullført kravet uten kursbevis, det er uklart hva kurset krevde og noen har bestått eller lest noe av det (fra 2.169.0), besvarelser venter på
vurdering, en deltaker har levert tekst uten å fullføre modulen (i sju dager fra leveringen, med datoen; fra 2.174.0), har besvarelser, inngår i et kursbevis, ligger i et kurs som beholdes, eller står i utkastet til et kurs. Vil du
ikke vente, kan du trykke «Slett» selv.

Det som ikke tilbys før elementet er gjenopprettet: generering og «Be om endring», oversetting, «Erstatt fra fil», «Last opp
bilde», publisering og avpublisering, å hente fram en eldre versjon, og i listene «Døp om» og **«Dupliser»**. «Oversett det
som mangler» i listene hopper over arkiverte elementer, og tallet på knappen teller dem ikke.

Et arkivert kurs følger fortsatt nye versjoner av moduler og seksjoner det deler med andre kurs.

**Kursimport mot et arkivert kurs:** er kurset fila ble eksportert fra, arkivert, kan det ikke oppdateres. Dialogen sier det,
og tilbyr bare «Importer som nytt kurs». Vil du oppdatere kurset, gjenoppretter du det først. Endrer fila en modul eller
seksjon som er arkivert, avvises oppdateringen på samme måte.

**«Slett kurs og ubrukt innhold»** (administratorer) står bare på et arkivert kurs.

**Lesingene blir stående når et kurs slettes (#1156).** En lest seksjon tilhører deltakeren og seksjonen, ikke kurset den ble lest
i, og teller i alle kurs som har seksjonen. Slettes kurset, teller lesingene videre i de andre kursene. Aktiviteten viser dem uten
kursnavn.

### 4. Importere og eksportere modul-JSON

Det finnes **to** steder, med bevisst ulik betydning:

| Hvor | Import gjør |
|------|-------------|
| **Modullista** | Oppretter en **ny modul** fra pakken |
| **Inne i en modul → Rediger** | Legger pakken som en **ny upublisert versjon på modulen du står i** |

Velg etter hva du er ute etter: en kopi ved siden av, eller nytt innhold i modulen du allerede har.

**Eksportere fra modullista:**
1. Finn modulen i listen
2. Klikk **Eksporter JSON** (last ned)
3. Filen inneholder den **publiserte** versjonen — det deltakerne faktisk får

**Eksportere fra Rediger (inne i modulen):**
1. Velg **Eksporter modulpakke** i handlingsmenyen
2. Filen inneholder **versjonen du ser på** — også når den er et upublisert utkast

**Importere inn i modulen du står i:**
1. Velg **Importer pakke i denne modulen** i handlingsmenyen på Rediger
2. Velg JSON-filen
3. Innholdet legges som en ny upublisert versjon. Modulens egen tittel og beskrivelse endres
   **ikke** — modulen beholder identiteten sin
4. Gå gjennom innholdet og publiser når det er klart. Angrer du, gjenoppretter du en tidligere
   versjon fra **Innstillinger → Lagrede versjoner**

**Importere som ny modul:**
1. Klikk **Importer JSON** i toppen av modullisten
2. Velg JSON-filen
3. Modulen opprettes som utkast — gjennomgå og publiser når klar

> Import publiserer aldri av seg selv, uansett om pakken kom fra en publisert modul. Publisering er
> alltid en egen, uttrykkelig handling — og den må gjennom oversettelseskontrollen.

### 5. Opprette og administrere kurs

1. Gå til `/admin-content` → fanen **Kurs**
2. Klikk **Opprett kurs**
3. Fyll inn tittel og valgfri beskrivelse (støtter en-GB, nb, nn)
4. Legg til moduler i ønsket rekkefølge ved å velge fra nedtrekkslisten
5. Juster rekkefølgen med pil opp/ned
6. Lagre
7. Klikk **Publiser** når kurset er klart for deltakere

#### Hvem ser et nytt kurs (#1164)

Et nytt kurs er **begrenset**: bare de som er tildelt kurset (via en klasse eller enkeltvis) ser det. Det gjelder også et kurs
du importerer som nytt, og kurs som lages med skillen. Vil du at alle deltakere skal se det, velger du **Åpen** under
**Innstillinger → Synlighet**. Kurs som fantes fra før, er ikke endret.

#### Publisere et kurs (#1164)

**Publiser** og **Publiser utkastet** spør før noe skjer, og dialogen sier **hvem som ser kurset etterpå**:

- **Alle deltakere** når kurset er åpent. Det står i «Mine kurs» hos alle så snart det er publisert, og har deltakerne sett
  det, kan det ikke trekkes tilbake.
- **De tildelte** når kurset er begrenset: klassene med antall deltakere, hvor mange som er tildelt enkeltvis, og tallet i alt
  (en person i flere klasser telles én gang). Er ingen tildelt, sier dialogen at ingen ser kurset ennå.

Har kurset innhold som ikke er publisert, står det i den samme dialogen, og publiseres sammen med kurset. Har noen kursbevis,
og innholdet er endret, spør den samme dialogen om det er en mindre eller en hovedversjon. **Avbryt** eller Esc publiserer
ingenting. Ved **Publiser utkastet** gjelder synligheten slik den står i utkastet.

#### Andres kurs og moduler (#1165)

Du kan åpne kurs og moduler andre produsenter eier, for å lese dem. Under statusmerket står «Du kan lese, men bare eierne kan
endre». Feltene er sperret, Lagre og Avbryt er borte, og i handlingsraden står bare **Eksporter**. Eierne ser du under
**Innstillinger**. I listene står **Åpne** og **Eksporter** på andres kurs, og **Åpne**, **Dupliser** og **Eksporter** på andres
moduler, med merket «Kun for eier». En kopi du lager med **Dupliser**, eier du selv. Vil du endre noe i en annens kurs eller
modul, ber du en av eierne legge deg til som eier.

#### Endre en seksjon: lagre er et utkast (fra 2.166.0, #1163)

**Lagre** på en seksjon lagrer et utkast, akkurat som på kurs og moduler. **Deltakerne ser ikke endringen før du publiserer
den**, verken teksten eller tittelen. Før 2.166.0 gikk en lagret seksjon ut til deltakerne med en gang; det gjør den ikke lenger.

- Etter lagring står «Lagret som utkast. Deltakerne ser ikke endringen før den er publisert.» Under statusmerket står
  «Utkast lagret … Deltakerne ser versjon X til utkastet er publisert.», og merket «Nyere utkast».
- **Publiser ny versjon** (i seksjonen eller i lista) viser først hvilke kurs som får den nye teksten og tittelen. Ingenting
  skjer før du trykker **Publiser**. Kursene seksjonen står i, får da en ny mindre versjon, slik de fikk ved lagring før.
- **Døp om** og **Oversett det som mangler** i seksjonslista lager også et utkast. Det nye navnet ses av deltakerne når du
  publiserer seksjonen.
- En **ny seksjon** lagres som utkast. Publiser den når den er klar.
- Har noen andre lagret seksjonen etter at du åpnet den, lagres ingenting, og du får beskjed. Kopier det du skrev, last siden
  på nytt og gjør endringen igjen.

Modulen viser den samme linja under merket når du har et nyere utkast åpent: «Deltakerne ser versjon X til utkastet er
publisert.»

#### Seksjonen oversettes når du lagrer (fra 2.167.0, #1163)

Seksjonen har **ingen «Oversett»-knapp** lenger. Du skriver på ett språk og trykker **Lagre**; da oversettes det du har endret
til de andre språkene, og alt lagres i samme utkast. Mens det pågår, står «Lagrer og oversetter …», og siden er sperret.

- **Bare det du har endret, oversettes**, og fra språket du endret det på. Har du bare rettet teksten, oversettes ikke tittelen
  (og omvendt). Har du selv skrevet på to språk, blir begge stående; bare det tredje oversettes.
- **Figurer (SVG-tegninger med tekst)** som du har satt inn i utkastet, oversettes i samme lagring. En figur som alt er oversatt,
  oversettes ikke på nytt, heller ikke når du skriver på et annet språk. En figur deltakerne alt ser i den publiserte versjonen,
  endres ikke ved lagring.
- **Feiler en oversetting**, lagres det som finnes, og meldingen sier hvilket språk som mangler. Det språket står da tomt i
  utkastet (ikke med den gamle oversettelsen). Når du publiserer, stopper kontrollen og tilbyr **Fyll inn det som mangler**:
  den oversetter det som mangler, lagrer utkastet og publiserer. Du kan også skrive det som mangler selv og lagre.
- **Avbryt** forkaster det du har endret siden sist lagring. Ingenting er sendt eller oversatt før du lagrer, så Avbryt rører
  ikke noe som er lagret.
- Har noen andre lagret seksjonen etter at du åpnet den, lagres ingenting (heller ikke oversettelsene), og teksten din står i
  skjemaet som du hadde den.

**Fyll inn det som mangler** finnes både i seksjonen og i seksjonslista, på meldingen som kommer når publiseringen stopper. Den
gjelder også eldre utkast og utkast som agent-API-et har laget. Lykkes ikke alt, lagres det som lyktes, og ingenting publiseres.

#### Arkivere og gjenopprette et kurs (2.159.0)

**Arkiver** (i kurslista, eller i handlingsraden når kurset er åpnet) viser først hva som skjer, og ingenting skjer før du
bekrefter:

- **Følger med inn i arkivet:** modulene og seksjonene som bare brukes i dette kurset. De arkiveres sammen med kurset, også
  de du ikke eier selv (de er merket «Eies av en annen forfatter»).
- **Blir stående:** det som brukes i et annet aktivt kurs, eller i et lagret utkast til et (merket «lagret utkast»). Det
  røres ikke.
- **Deltakere midt i kurset:** hvor mange. De beholder lesinger, besvarelser og beståtte moduler, men kurset forsvinner fra
  «Mine kurs». Ingen får e-post.
- **Besvarelser som venter på vurdering:** de vurderes ferdig etterpå. Den som fullfører kurset mens det er arkivert, får
  kursbeviset først når kurset gjenopprettes og publiseres. Fullfører noen kurset da, kan kurset ikke slettes.
- **Fullført uten kursbevis:** får beviset nå, når kurset er publisert. Et upublisert kurs gir ikke kursbevis.
- **Utkastet:** har kurset et lagret utkast, forkastes det.

Har noe endret seg mens dialogen sto åpen (en modul er lagt inn i et annet kurs, eller flere er kommet i gang), arkiveres
ingenting: dialogen viser det som gjelder nå, og du bekrefter på nytt.

Et arkivert kurs kan åpnes og leses, men ikke endres: feltene og innholdslista er sperret, og linja under statusmerket sier
at kurset må gjenopprettes først. Eierne kan fortsatt endres.

**Gjenopprett** viser hva som kommer tilbake. Modulene og seksjonene som fulgte kurset inn, blir publisert igjen med samme
versjon som før. Var et element et utkast, eller finnes versjonen ikke lenger, kommer det tilbake som utkast og må
publiseres før kurset. Elementer som ble arkivert for seg, arkivert før 2.159.0, eller arkivert sammen med et annet kurs,
blir stående arkivert: gjenopprett dem hver for seg. Kurset selv kommer alltid tilbake som utkast. Publiser det når du er
klar. Meldingen etterpå sier hva som faktisk kom tilbake.

### 6. Klasser: hva medlemmene får på e-post

Når du gir en klasse et kurs, eller legger noen til i en klasse som har kurs, får medlemmene en e-post om de nye kursene.

**Hva de får:** én e-post med alle kursene de har fått, hvilken klasse de kommer fra, og fristen hvis du har satt en.
E-posten har én knapp, **Åpne Mine kurs**. Der finner de kursene. Gjelder e-posten bare ett kurs, heter knappen
**Åpne kurset** og går rett til det.

**Når:** om lag et kvarter etter den siste endringen du gjør. Legger du til fem kurs etter hverandre, får medlemmene én
e-post med alle fem, ikke fem e-poster. Du har altså et kvarter på deg til å rette opp: et kurs du fjerner fra klassen
før e-posten går, kommer ikke med.

**Tildeler du et kurs før det er publisert,** får medlemmene e-posten når du publiserer det.

**Ingen e-post om:**
- kurs medlemmet allerede har begynt på eller fullført;
- kurs medlemmet har fått e-post om før, eller hadde fra en klasse før denne e-posten kom (2.147.0);
- kurs i en arkivert klasse, eller i «Alle deltakere»;
- endret frist.

## Vanlige spørsmål

**Deler to kurs en seksjon. Må deltakeren lese den i begge? (#1156)**
Nei. En lest seksjon teller i alle kurs som har den, som en bestått modul, men bare i kurs deltakeren ser (åpne kurs, og begrensede
kurs hen er tildelt). Fremdriften i «Mine kurs», kursrapporten og kursbeviset regner med lesingen, og blir et kurs fullført av den,
utstedes kursbeviset like etter (workeren gjør det), eller senest når deltakeren åpner «Mine kurs» eller kursbevisene. Har kurset ditt tatt i bruk en ny hovedversjon der seksjonen er endret, må den leses på nytt i
ditt kurs. E-postene regner ikke slik: «du har fått et nytt kurs» og «i gang» i den ukentlige e-posten krever at deltakeren har gjort
noe i kurset selv. Rapporten for kurset tar med dem som har lest kursets seksjoner i et annet kurs.

**Kan jeg redigere en publisert modul?**
Ja, redigeringer lagres som ny kladd. Den publiserte versjonen forblir aktiv til du publiserer kladden.

**Kan jeg redigere en publisert seksjon? (2.166.0)**
Ja, på samme måte: lagringen er et utkast, og deltakerne leser den publiserte versjonen (tekst og tittel) til du publiserer.

**Hva skjer med eksisterende besvarelser om jeg avpubliserer en modul?**
Allerede leverte besvarelser ferdigbehandles. Ingen nye besvarelser kan leveres på en avpublisert modul.

**Kan jeg slette en modul som har besvarelser?**
Nei. Moduler med besvarelser kan bare arkiveres, ikke slettes. En arkivert modul uten besvarelser kan slettes, også når den
har lagrede versjoner (fra 2.161.0). Fra 2.172.0 teller en ren flervalgsmodul som deltakere bare har åpnet, uten å svare, som
uten besvarelser: den kan slettes, og de tomme radene går med. Fritekst som er levert, teller alltid som en besvarelse, også før
den er vurdert.

**Kan jeg avpublisere, arkivere eller slette en modul eller seksjon som ligger i et kurs?**
Det kommer an på kurset:

- Ligger den i et **aktivt** kurs (publisert eller utkast), kan den verken avpubliseres, arkiveres eller slettes. Meldingen
  sier hvilke kurs det gjelder. Ta den ut av kursene først.
- Ligger den bare i **arkiverte** kurs, kan den avpubliseres og arkiveres. Arkiverte kurs teller ikke som bruk, og vises
  heller ikke i kolonnen «Brukt i kurs» eller i kursfilteret.
- **Slette** kan du ikke så lenge den ligger i et kurs, heller ikke et arkivert: det arkiverte kurset beholder innholdet sitt.
  Meldingen sier hvilke av kursene som er arkiverte. Slett kurset først (et arkivert kurs kan slettes når ingenting holder det igjen; lista sier hva som gjør det); da er
  elementet fritt og kan slettes etterpå. Lista viser datoen: et element som bare ligger i et kurs som skal slettes, får
  kursets dato.

Gjenoppretter du et arkivert kurs der en modul eller seksjon er arkivert for seg (ikke sammen med kurset), står kurset som
utkast. Det kan ikke publiseres før elementet er gjenopprettet eller tatt ut av kurset. Dialogen for «Gjenopprett» viser
hvilke elementer det gjelder (se «Arkivere og gjenopprette et kurs» over).
