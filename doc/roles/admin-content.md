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
- `GET/POST /api/admin/content/courses` — liste og opprett kurs
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

**Kan jeg redigere en publisert modul?**
Ja, redigeringer lagres som ny kladd. Den publiserte versjonen forblir aktiv til du publiserer kladden.

**Hva skjer med eksisterende besvarelser om jeg avpubliserer en modul?**
Allerede leverte besvarelser ferdigbehandles. Ingen nye besvarelser kan leveres på en avpublisert modul.

**Kan jeg slette en modul som har besvarelser?**
Nei. Moduler med besvarelser kan bare arkiveres, ikke slettes.

**Kan jeg avpublisere, arkivere eller slette en modul eller seksjon som ligger i et kurs?**
Det kommer an på kurset:

- Ligger den i et **aktivt** kurs (publisert eller utkast), kan den verken avpubliseres, arkiveres eller slettes. Meldingen
  sier hvilke kurs det gjelder. Ta den ut av kursene først.
- Ligger den bare i **arkiverte** kurs, kan den avpubliseres og arkiveres. Arkiverte kurs teller ikke som bruk, og vises
  heller ikke i kolonnen «Brukt i kurs» eller i kursfilteret.
- **Slette** kan du ikke så lenge den ligger i et kurs, heller ikke et arkivert: det arkiverte kurset beholder innholdet sitt.
  Meldingen sier hvilke av kursene som er arkiverte. En egen vei for å slette arkivert innhold kommer (#1152).

Gjenoppretter du et arkivert kurs der en modul eller seksjon er arkivert for seg (ikke sammen med kurset), står kurset som
utkast. Det kan ikke publiseres før elementet er gjenopprettet eller tatt ut av kurset. Dialogen for «Gjenopprett» viser
hvilke elementer det gjelder (se «Arkivere og gjenopprette et kurs» over).
