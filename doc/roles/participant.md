# Deltaker (`PARTICIPANT`)

Deltakere er de ansatte som leverer besvarelser og tar vurderinger på plattformen.

## Hva deltakere har tilgang til

- `/participant` — «Mine kurs»: kursene, fremdriften og kursbevisene (fullførte kurs står nederst i
  hvert tema). Siste resultat og anke ligger i modulen.
- `/profile` — egen profil, fullførte moduler og kurs, og samtykkestatus. «Mine kurs» står øverst til venstre og fører
  tilbake (#1159), også på telefon.

API:
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

### 1b. Slik beveger du deg gjennom et kurs

Et kurs er serielt, og oversikten viser det: du ser **ett steg av gangen** som det aktuelle.

- **Det aktuelle steget** står som et kort med tittel og én knapp — «Les» eller «Gjennomfør».
- **Fullførte steg** krymper til én linje med status. Trykk «Se igjen» for å åpne dem på nytt;
  innholdet forblir tilgjengelig så lenge du har kurset.
- **Kommende steg** vises som dempede titler, så du ser hva som gjenstår. De kan fortsatt åpnes hvis
  du vil hoppe fram, men rekkefølgen er den anbefalte veien gjennom kurset.

Kursets to typer innhold skilles med både ord og form:

| Merke | Type | Hva det betyr |
|---|---|---|
| ● Sirkel | **Lesestoff** | Innhold du leser og markerer som lest. Kan ikke gå galt. |
| ◆ Rombe | **Test** | Oppgave som vurderes. Kan gi «Bestått» eller «Ikke bestått», og teller mot kursbeviset. |

Fargen på merket viser status, ikke type: grønt betyr fullført for begge.

Har to kurs den samme seksjonen, står den som lest i begge når du har lest den i ett av dem, og fullfører det et kurs, får du
kursbeviset for det andre kurset like etter, eller senest når du åpner «Mine kurs» eller kursbevisene. Har kurset fått en ny versjon av seksjonen etter at du leste den, må du lese den på nytt der.

**Tilbake, oppfriskning og lenker (#1158).** Seksjonen eller modulen du har åpen, står i adressen sammen med kurset. Det
betyr:

- **Tilbake lukker det du har åpent og lar deg stå i kurset.** Det gjelder nettleserens tilbake-knapp, tilbake-sveipen på
  telefonen, «Lukk seksjonen»/«Lukk modulen» og Escape. Alle gjør det samme. Nettleserens fram-knapp åpner det igjen.
- **Går du rett fra én seksjon til neste** («Marker seksjon lest, og gå videre», «Neste: …»), er det fortsatt bare ett steg
  tilbake til kurset, ikke ett per seksjon du har lest.
- **Oppdaterer du siden, eller åpner et bokmerke**, står seksjonen eller modulen åpen igjen.
- **Lenka i e-posten om et resultat eller en anke** åpner modulen i kurset, og den står åpen også etter en oppfriskning.
- **Er seksjonen eller modulen fjernet fra kurset, eller ikke lenger tilgjengelig**, står du i kurset med en melding om at
  den ikke ble funnet.
- **Tekst du har skrevet, men ikke levert**, er der når du åpner modulen igjen, også etter tilbake eller en oppfriskning
  (kladden lagres i nettleseren).

### 1c. En påbegynt flervalgstest (#1160)

Krysser du av på noen spørsmål og så oppdaterer siden, lukker modulen eller tar en pause, står avkrysningene der når du
åpner modulen igjen, i den samme testen. Ingenting er sendt inn før du trykker **Send test**.

- Avkrysningene lagres i nettleseren du bruker, ikke på serveren. En annen nettleser eller en annen maskin har dem ikke.
- Kladden gjelder i fire timer, som fritekstkladden.
- **Er modulen endret siden du begynte** (en ny versjon kan ha andre spørsmål), starter du på en ny test uten de gamle
  avkrysningene, så ingen svar havner på feil spørsmål.
- Når du har levert, er avkrysningene borte fra kladden.
- **Bytter du språk midt i testen**, står testen på språket du begynte på til du har levert, også etter en oppfriskning, så
  avkrysningene og rekkefølgen du har satt, står der.
- **Får siden ikke hentet testen** (nettet er borte, serveren svarer ikke), lukkes modulen med en melding om det. Svarene er
  tatt vare på, og ingenting nytt er startet: åpne testen igjen fra kurset for å fortsette.

Modulen viser ingen tekniske meldinger mens du jobber (#1161): ingen id-er når den åpnes eller etter levering. Resultatet
står i modulen når det er klart. Id-en til innleveringen finnes under «Vis detaljer» i resultatet, til bruk om noe skal
ettergås, som «Bevis-ID» på kursbeviset.

### 2. Forstå resultater

Etter at vurderingen er fullført, vises resultatet i modulen. Åpner du modulen igjen senere, står siste
resultat der, med svaret du leverte. Har du begynt på et nytt forsøk, ser du det i stedet.

| Status | Betydning |
|---|---|
| **Bestått** | Modulen er godkjent |
| **Ikke bestått** | Modulen er ikke godkjent; ny levering kan gjøres |
| **Under vurdering** | Besvarelsen behandles av en manuell vurderer |
| **Under anke** | Klagen din er mottatt og behandles |

Totalpoeng og detaljert vurdering vises for fullførte besvarelser.

**Når får du e-post om resultatet?** Moduler med fritekstoppgave vurderes i bakgrunnen, og du får en
e-post når resultatet er klart. **Rene flervalgsmoduler (MCQ) sender ingen resultat-e-post** — de rettes
automatisk i det du leverer, og du ser Bestått/Ikke bestått med én gang på skjermen. Skulle den
umiddelbare rettingen svikte, tar bakgrunnsjobben over og du får e-post som vanlig, slik at du aldri
står uten beskjed.

### 3. Klage på en beslutning

Du kan anke dersom resultatet er «Ikke bestått» og du mener vurderingen er feil. Du trenger ikke gjøre
det med en gang — anken kan sendes senere. Et bestått resultat kan ikke ankes.

1. Gå til `/participant` og åpne kurset
2. Åpne modulen du vil anke — siste resultat vises
3. Skriv en begrunnelse for klagen
4. Klikk **Send inn anke**

Anken gjelder siste resultat. Tar du et nytt forsøk, er det det nye resultatet som kan ankes.

Klagebehandler varsles og behandler klagen. Du mottar e-post eller varsel om utfallet.

**Merk:** Du kan ikke levere ny besvarelse på en modul mens en aktiv klage er under behandling.

### 4. Kursfremdrift og kursbevis

Kurs grupperer flere moduler. Kursbevis utstedes automatisk når alle moduler i kurset er bestått.

1. Gå til `/participant` — «Mine kurs»-seksjonen viser kursfremdrift
2. Klikk på et kurs for å se hvilke moduler som inngår og hvilke du har bestått
3. Et fullført kurs står nederst i sitt tema, med lenken «Vis kursbevis». Beviset finnes også i Profil, med samme lenke.

## Vanlige spørsmål

**Kan jeg levere på nytt?**
Ja, så lenge maksimalt antall forsøk for modulen ikke er nådd. Antall tillatte forsøk fremgår av modulbeskrivelsen.

**Hva skjer om jeg ikke får svar?**
Om besvarelsen har stått «Under behandling» i mer enn 30 minutter, kontakt plattformadministrator.

**Jeg vil trekke tilbake en anke — er det mulig?**
Nei, en innsendt anke kan ikke trekkes tilbake etter innsending. Klagebehandleren vil uansett vurdere saken.
