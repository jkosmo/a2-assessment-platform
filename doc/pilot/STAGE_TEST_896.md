# Stage-test: #896 omlegging av innholdsforvaltning

Første stage-verifisering av `dev`. 49 commits, 60 filer, ingen Prisma-endringer mot `main` — så
ingen migrasjon og ingen infra-risiko. Alt under er kun testbart i en ekte nettleser mot ekte LLM;
det som kunne dekkes automatisk er allerede dekket (931 unit, 467 integrasjon, 161 e2e).

Test i denne rekkefølgen — hvert punkt bygger på det forrige.

## 1 · Arbeidsrommet (S1–S3)

- [ ] Åpne en eksisterende modul. Den lander på **Rediger**.
- [ ] Bytt til **Forhåndsvisning** og **Innstillinger**. Fanen står i URL-en (`?tab=settings`);
      last siden på nytt og bekreft at du blir stående.
- [ ] Rediger et felt uten å lagre, prøv fanebytte → advarsel. **Avbryt** beholder teksten.
- [ ] I **Innstillinger**: endre sertifiseringsnivå eller gyldighetsdato uten å lagre, bytt fane.
      Du skal få en advarsel som sier at verdiene **forkastes** (i motsetning til et utkast, som
      overlever). Avbryt → verdiene står fortsatt.
- [ ] Bytt UI-språk mens du har ulagrede innstillinger. Samme advarsel.
- [ ] Bytt modultype i Innstillinger og tilbake igjen. Begge veier skal være mulige — det er
      historikken, ikke gjeldende versjon, som avgjør hva som tilbys.

## 1b · Innstillinger er nå komplett (S3c) — nytt siden forrige runde

Alle åtte feltene spesifikasjonen krever er redigerbare her. Tre av dem er nye:

- [ ] **Kriterier.** «Endre kriterier» åpner editoren. Endre et navn, juster en vekt, lagre.
      Kontroller at endringen står etter reload — og at totalvekten oppdateres mens du drar.
- [ ] **Vurderingsinstruks.** «Endre instruks». Den viser **ett språk** (ditt UI-språk) og sier
      det. Endre systeminstruksen, lagre, bytt UI-språk og kontroller at **de to andre språkene er
      urørt**. Dette er det viktigste punktet i hele seksjonen — samme feil er gjort tre ganger før.
- [ ] Skriv ugyldig JSON i «Eksempler» og lagre → du skal få beskjed, ikke en stille tømming.
- [ ] **Svarfelt** (innsendingsskjema) og **praktisk vekt**. Endre begge, lagre, kontroller at de
      står. Merk: `max_total` har med vilje ingen input — den følger av kriteriene.
- [ ] **Skriv en verdi, og utvid så en seksjon.** Verdien skal fortsatt stå. (Den ble stille
      tilbakestilt før; rettet, men verdt å se med egne øyne.)
- [ ] Alt over skal fortsatt utløse advarsel ved fanebytte, språkbytte og «Åpne avansert
      redigering» hvis det er ulagret.

> **Avansert-siden har fortsatt de samme editorene.** Den er ikke fjernet ennå (S3c gjenstår), så
> du kan gjøre samme ting to steder. Det er en mellomtilstand, ikke en feil — men rapporter det
> hvis de to gir *ulikt resultat*.

## 2 · Publiseringsgaten (S4) — hovedpunktet

Lag en modul der **ett** språk mangler i oppgaveteksten.

- [ ] Trykk **Publiser**. Publisering blokkeres, og meldingen sier **hvilket felt** og **hvilket
      språk** — på ditt UI-språk, ikke som `taskText: missing nn`.
- [ ] Trykk **«Oversett det som mangler»**. Kontroller etterpå at
      - hullet er fylt,
      - de språkene som allerede var skrevet er **byte-for-byte uendret**,
      - modulen publiseres automatisk.
- [ ] Gjenta med **beskrivelsen** som eneste hull.
- [ ] Gjenta på en **MCQ-only** modul (ingen oppgavetekst, ingen fasit) og på en **fritekst-only**
      modul (ingen MCQ). Begge skal kunne fullføre — de var umulige i tidligere runder.
- [ ] MCQ uten begrunnelse, med språkhull: ingen begrunnelse skal **diktes opp**.
- [ ] Legg modulen i et kurs og publiser kurset. Kaskadedialogen skal navngi felt og språk på ditt
      språk, tilby **«Åpne modulen»**, og verken modul eller kurs skal publiseres.

## 3 · Versjonshistorikk (S5)

- [ ] Lag to tydelig forskjellige versjoner gjennom vanlig lagring.
- [ ] **Innstillinger → Lagrede versjoner**: nyeste først, merker for **Live** og **Åpen nå**.
- [ ] **Gjenopprett** den eldste. Kontroller at
      - Rediger faktisk viser det gamle innholdet (oppgavetekst, fasit, kriterier, prompt, MCQ),
      - historikken fikk **nøyaktig én** ny versjon — ingenting slettet,
      - den nye versjonen er et **utkast**, også om kilden var publisert.
- [ ] Dobbeltklikk **Gjenopprett**: fortsatt bare én ny versjon.
- [ ] Skjermleser eller nettleserens tilgjengelighetstre: hver knapp skal annonseres med
      versjonsnummeret sitt.

## 4 · Eksport og import (S6)

- [ ] Publiser v1, mellomlagre en tydelig forskjellig v2. **Eksporter modulpakke** fra Rediger.
      Filen skal inneholde **v2** — den du ser på — ikke den publiserte v1.
- [ ] Importer den filen i en **annen** modul via **«Importer pakke i denne modulen»**.
      Kontroller at
      - det ble en ny **upublisert** versjon på målmodulen,
      - målmodulens **egen tittel** er uendret,
      - ingen ny modul ble opprettet ved siden av.
- [ ] Prøv å importere en **kurspakke** samme sted → tydelig avvisning før noe sendes.
- [ ] Avbryt bekreftelsen, og avbryt filvelgeren. Handlingsmenyen skal fortsatt være brukbar uten
      å laste siden på nytt. Samme etter en fullført eksport.

## 5 · Språk

- [ ] Gå gjennom punktene over på **bokmål**, **nynorsk** og **engelsk**. Ingen rå `shell.*`-nøkler,
      ingen engelsk servertekst midt i norsk UI.
      **Kjent avvik (#914):** blokkeringer som *ikke* er oversettelseshull — f.eks. blueprint-avvik —
      vises fortsatt som engelsk servertekst. Det er registrert, ikke glemt.

## Kjente begrensninger, ikke feil

- **Avansert-siden** har ikke «Oversett det som mangler». Den viser felt × språk og peker til
  samtale-arbeidsrommet. Siden skal fjernes i S3c; to kopier av flyten er arbeid som kastes.
- **Eldre innhold** fra før #905 har alle tre språk fylt med kopier av samme tekst. Gaten ser dem
  som komplette — teknisk sant, innholdsmessig ikke. Opprydding hører til #892.
- **#915:** gjenoppretting kan vise falsk kriteriedrift fordi rubrikkversjoner muteres på stedet.
  Kriteriene er intakte; bare driftindikatoren lyver.
- **#916:** en enslig seksjon kan ikke eksporteres eller importeres for seg — den kan bare reise
  som del av en kurspakke. Funksjonen er aldri bygget; tas etter S3c.
- ~~#912: eksport/import brytes for moduler uten sertifiseringsnivå~~ — **løst i v2.18.5.**
