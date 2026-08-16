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

## Vanlige spørsmål

**Kan jeg redigere en publisert modul?**
Ja, redigeringer lagres som ny kladd. Den publiserte versjonen forblir aktiv til du publiserer kladden.

**Hva skjer med eksisterende besvarelser om jeg avpubliserer en modul?**
Allerede leverte besvarelser ferdigbehandles. Ingen nye besvarelser kan leveres på en avpublisert modul.

**Kan jeg slette en modul som har besvarelser?**
Nei. Moduler med besvarelser kan bare arkiveres, ikke slettes.
