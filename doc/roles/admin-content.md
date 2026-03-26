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

**Eksportere:**
1. Finn modulen i listen
2. Klikk **Eksporter JSON** (last ned)
3. JSON-filen inneholder all modul-metadata, rubrikk og MCQ

**Importere:**
1. Klikk **Importer JSON** i toppen av modullisten
2. Velg JSON-filen
3. Gjennomgå det importerte innholdet
4. Lagre som kladd og publiser når klar

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
