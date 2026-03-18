# Designdokument: Organisere moduler i kurs

## Bakgrunn

Dagens løsning er modul-sentrisk i både datamodell, adminflyt, deltakerflyt og rapportering. Moduler vises flatt uten overordnet kursstruktur. Dette gjør det vanskelig å støtte læringsløp som består av flere relaterte moduler.

Issue: `#133 EPIC: Organisere moduler i kurs`

## Mål

- Gjøre det mulig å gruppere moduler i kurs
- Gi administratorer kontroll over kurssammensetning og rekkefølge
- Gi deltakere bedre navigasjon og forståelse av sammenheng mellom moduler
- Gi rapportlesere beståttprosent og oppfølging på kursnivå

## Omfang

### Inkludert i MVP
- Ny `Course`-entitet
- Ny `CourseModule`-relasjon med rekkefølge
- Opprette, redigere, publisere og slette kurs
- Knytte moduler til kurs
- Vise moduler gruppert under kurs for deltakere
- Rapportering av beståttprosent per kurs
- Tilgjengelighetskrav for nye interaksjonsmønstre

### Utenfor MVP
- Flere kurs per modul
- Historisk versjonering av kursmedlemskap for rapportering
- Egen enrolment-modell
- Avanserte anbefalinger som "neste anbefalte kurs"

## Roller

### Administrator / fagansvarlig
Vedlikeholder kurs og moduler i innholdsarbeidsflaten.

### Deltaker
Ser kurs, velger modul, gjennomfører innsending og vurdering, følger egen progresjon.

### Rapportleser / oppfølgingsbruker
Leser rapporter på kursnivå og bryter ned til modulnivå.

## Flyter

### Opprette kurs
1. Åpne kursoversikt
2. Velg `Opprett kurs`
3. Fyll inn kursnavn og beskrivelse
4. Lagre som kladd
5. Legg til moduler
6. Sett rekkefølge
7. Publiser kurs

### Redigere kurs
1. Åpne kurs
2. Endre metadata
3. Legg til/fjern moduler
4. Endre rekkefølge
5. Lagre

### Slette kurs
1. Åpne kurs
2. Velg `Slett kurs`
3. Bekreft
4. Kurs slettes, moduler beholdes

### Deltakerflyt
1. Åpne deltakerkonsoll
2. Se kursgruppert moduloversikt
3. Velg modul i kurs
4. Gjennomfør innsending, MCQ og vurdering
5. Se oppdatert kursprogresjon

### Rapportflyt
1. Åpne resultatarbeidsflate
2. Filtrer på kurs og dato
3. Se beståttprosent per kurs
4. Utvid kurs for å se modulnivå

## Skjermpåvirkning

### Innholdsarbeidsflate - Moduler
- vis kurstilhørighet
- legg til kobling til kurs

### Innholdsarbeidsflate - Kursoversikt
- ny visning for liste over kurs

### Innholdsarbeidsflate - Kursredigering
- ny visning for kursmetadata, medlemskap og rekkefølge

### Deltakerkonsoll - Kurs og modulvalg
- erstatt flat modulliste med kursgruppert visning
- behold frittstående moduler

### Deltakerkonsoll - Innsending / MCQ / vurdering
- vis kurskontekst og progresjon

### Resultatarbeidsflate - Kursrapport
- nytt filter og nytt rapportnivå for kurs
- drilldown til moduler

## UX-spesifikasjon

### Admin
- toppfane `Moduler | Kurs`
- kursoversikt med listevisning
- kursredigering på egen side/panel
- eksplisitte rekkefølgeknapper (`Flytt opp` / `Flytt ned`)
- publisering blokkeres hvis kurset er tomt

### Deltaker
- kurs som accordion/gruppevisning
- moduler vises i definert rekkefølge
- progresjon uttrykkes med tekst
- modul er fortsatt den konkrete handlingsenheten

### Rapportering
- kurs som nytt toppnivå
- vis beståttprosent, antall deltakere i beregningsgrunnlag og antall pågår
- moduldrilldown under hvert kurs

## Tilgjengelighetskrav

- kursaccordion må være tastaturstyrbar
- expand/collapse må bruke korrekt semantikk
- rekkefølgeendring må kunne gjøres uten drag-and-drop
- alle felt må ha etiketter og hjelpetekster
- feil må vises ved riktig felt
- statusmeldinger må annonseres i live regions
- status og progresjon kan ikke uttrykkes kun med farge
- rapporttabeller må ha korrekt tabellsemantikk
- fokusrekkefølge må testes manuelt i alle nye flyter

## Åpne spørsmål

1. Skal en modul kunne ligge i flere kurs?
2. Hva er endelig definisjon på "bestått kurs"?
3. Hva er nevneren i kursbeståttprosent uten enrolment-modell?
4. Skal kurs kunne publiseres separat fra modulene?
5. Skal rapportering følge dagens kursstruktur eller historisk struktur?

## Anbefalte neste steg

1. Avklar åpne spørsmål om medlemskap og rapporteringsdefinisjon
2. Lag datamodellforslag for `Course` og `CourseModule`
3. Spesifiser API-endepunkter for kursadministrasjon
4. Implementer adminvisning for kursoversikt og kursredigering
5. Implementer kursgruppert deltakeroversikt
6. Utvid rapportering med kursnivå
7. Kjør manuell tilgjengelighetstest før merge
