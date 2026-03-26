# Deltaker (`PARTICIPANT`)

Deltakere er de ansatte som leverer besvarelser og tar vurderinger på plattformen.

## Hva deltakere har tilgang til

- `/participant` — oversikt over moduler, aktive besvarelser og sertifiseringsstatus
- `/participant/completed` — fullførte moduler, historikk og kursbevis
- `/profile` — egen profil og samtykkestatusAPI:
- `GET /api/modules` — liste over tilgjengelige moduler
- `GET /api/submissions` — egne besvarelser
- `POST /api/submissions` — levere ny besvarelse
- `GET /api/courses` — liste over publiserte kurs
- `GET /api/courses/:courseId` — kursdetaljer med fremdrift
- `GET /api/courses/completions` — egne kursbevis
- `POST /api/submissions/:id/appeals` — anke et resultat

## Sentrale arbeidsflyter

### 1. Starte og levere en besvarelse

1. Gå til `/participant`
2. Velg modul fra listen — modulen viser beskrivelse og inleveringskrav
3. Klikk **Start vurdering**
4. Fyll ut besvarelsen (tekstfelt og/eller filopplasting)
5. Klikk **Lever besvarelse**
6. Status vises som «Under behandling» mens AI-vurderingen kjøres

**Forventet ventetid:** Noen sekunder til noen minutter avhengig av besvarelsens lengde.

**Mulige utfall:**
- **Bestått** — modulen er godkjent, sertifiseringsstatus oppdateres
- **Ikke bestått** — du kan levere på nytt inntil antall forsøk er oppbrukt
- **Under manuell vurdering** — en vurderer behandler besvarelsen manuelt

### 2. Forstå resultater

Etter at vurderingen er fullført, vises resultatet i `/participant/completed`.

| Status | Betydning |
|---|---|
| **Bestått** | Modulen er godkjent |
| **Ikke bestått** | Modulen er ikke godkjent; ny levering kan gjøres |
| **Under vurdering** | Besvarelsen behandles av en manuell vurderer |
| **Under anke** | Klagen din er mottatt og behandles |

Totalpoeng og detaljert vurdering vises for fullførte besvarelser.

### 3. Klage på en beslutning

Du kan anke dersom resultatet er «Ikke bestått» og du mener vurderingen er feil.

1. Gå til `/participant/completed`
2. Finn modulen du vil anke
3. Klikk **Anke resultat**
4. Skriv en begrunnelse for klagen
5. Klikk **Send inn anke**

Klagebehandler varsles og behandler klagen. Du mottar e-post eller varsel om utfallet.

**Merk:** Du kan ikke levere ny besvarelse på en modul mens en aktiv klage er under behandling.

### 4. Kursfremdrift og kursbevis

Kurs grupperer flere moduler. Kursbevis utstedes automatisk når alle moduler i kurset er bestått.

1. Gå til `/participant` — «Mine kurs»-seksjonen viser kursfremdrift
2. Klikk på et kurs for å se hvilke moduler som inngår og hvilke du har bestått
3. Gå til `/participant/completed` for å se utstedte kursbevis med bevis-ID og dato

## Vanlige spørsmål

**Kan jeg levere på nytt?**
Ja, så lenge maksimalt antall forsøk for modulen ikke er nådd. Antall tillatte forsøk fremgår av modulbeskrivelsen.

**Hva skjer om jeg ikke får svar?**
Om besvarelsen har stått «Under behandling» i mer enn 30 minutter, kontakt plattformadministrator.

**Jeg vil trekke tilbake en anke — er det mulig?**
Nei, en innsendt anke kan ikke trekkes tilbake etter innsending. Klagebehandleren vil uansett vurdere saken.
