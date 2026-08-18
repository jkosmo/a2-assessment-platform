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

## 1a · Innstillinger er lagt om (v2.18.10) — nytt siden forrige runde

Panelet var «kun lagt til ting uten hensyn til konsistens». Det er nå fire blokker i fast
rekkefølge. Se på det før du tester noe:

- [ ] Innstillinger har **fire overskrifter**: Modulen · Vurdering · Innsendingsskjema · Lagrede
      versjoner. Hver ting står under den den hører til — sertifiseringsnivå og gyldighet under
      *Modulen*, ikke sammen med poenggrensene.
- [ ] **Lagre står etter alle innstillingene og før historikken.** Ingen innstillingsfelt under
      knappen.
- [ ] Kriterier og vurderingsinstruks er **underseksjoner av Vurdering** — visuelt ett hakk inn,
      ikke sidestilt med de fire overskriftene.
- [ ] Se på det ved **normal bredde og 200 % zoom**. Hierarkiet skal holde.
- [ ] **Kriteriene finnes bare ett sted i den nye flaten.** De vises i Forhåndsvisning og
      redigeres i Innstillinger — ikke lenger i Rediger.
- [ ] Skriv `101` i samlet beståttgrense og lagre → feilmelding. **Rett tallet og lagre igjen** —
      knappen skal fortsatt virke. Samme med sluttdato før startdato.

## 1b · Innstillinger er nå komplett (S3c) — nytt siden forrige runde

Alle åtte feltene spesifikasjonen krever er redigerbare her. Tre av dem er nye:

- [ ] **Kriterier.** Editoren står **alltid åpen** — det finnes ingen «Endre kriterier»-knapp
      lenger (v2.18.10). Endre et navn, juster en vekt, lagre. Kontroller at endringen står etter
      reload — og at totalvekten oppdateres mens du drar.
- [ ] **Kriterier på ett språk.** Bruk en modul med ulik kriterietekst på en-GB, nb og nn. Endre
      bare ett språk og lagre. De to andre skal være **byte for byte uendret** (#902). Et
      kriterium du ikke rørte skal heller ikke skrives om.
- [ ] **Bytt til «Bare flervalg» med en ulagret kriterieendring.** Du skal få beskjed om å lagre
      eller angre først — ikke en lagring som stille kaster endringen.
- [ ] **Legg til / fjern et kriterium på en flerspråklig modul**, lagre, og kontroller at de
      kriteriene du *ikke* rørte har alle tre språk i behold. (Legg til/Fjern bygger alle kortene
      på nytt fra skjermen; det var her språkene forsvant.)
- [ ] **Bytt UI-språk mens Innstillinger er åpen**, rediger så et kriterium og lagre. Teksten skal
      havne i språket du faktisk står i — ikke i det forrige.
- [ ] **Trykk Lagre uten å røre sertifiseringsnivået** på en modul som har nivået på flere språk,
      med UI-språk og forhåndsvisningsspråk satt **ulikt**. Nivået skal være uendret på alle språk
      etterpå.
- [ ] **⚠️ Ikke dekket av automatiske tester — må testes her.** Generer eller revider en modul slik
      at du har et **ulagret utkast**. Gå til Innstillinger (der finnes ingen Lagre-knapp da),
      juster et kriterium, **legg til ett og fjern ett**, gå tilbake til Rediger og lagre utkastet.
      Alt du gjorde skal være med — ikke de opprinnelig genererte kriteriene. Dette var stille
      datatap på hovedflyten for nye moduler, og rettelsen er ikke festet av en e2e.
- [ ] **⚠️ Ny modul, hele veien.** Opprett en modul gjennom samtaleflyten. Mens kriteriene fortsatt
      genereres: åpne **Innstillinger**. Den skal vise panelet, ikke «Last inn en modul». Bli
      stående til genereringen er ferdig og kontroller at kriteriene **dukker opp** der uten at du
      laster siden på nytt. (Merk: fanen får fortsatt ingen markering — §6 gjenstår.)
- [ ] **«Regenerer fra plan»** i Innstillinger. Knappen var død etter at kriterieeditoren forsvant
      fra Rediger — den leste felter som ikke lenger finnes. Den skal nå faktisk kalle tjenesten.
- [ ] **Endre sertifiseringsnivå og lagre.** Du skal få en vanlig grønn bekreftelse, ikke
      «lagret, men visningen kan være utdatert».
- [ ] **Legg til → fjern → legg til** to nye kriterier i samme økt, og lagre. **Begge** skal være
      der etter reload (de fikk samme interne ID før og overskrev hverandre).
- [ ] **En «Bare flervalg»-modul skal ikke ha vurderingsinstruks i Innstillinger.** Den ble vist
      før, men lagringen kastet endringen og meldte likevel grønt.
- [ ] **Se på modul A sine innstillinger → gå til tomt lerret → opprett modul B** → åpne
      Innstillinger. B skal vise sine egne kriterier, ikke A sine.
- [ ] **Opprett en MCQ-only-modul, og importer et ekstern-LLM-utkast.** Begge skal vise
      Innstillinger før første lagring, ikke «Last inn en modul».
- [ ] **Sett UI-språk og forhåndsvisningsspråk ulikt, kjør «Regenerer fra plan», lagre og
      reload.** Kriteriene skal ligge under **forhåndsvisningsspråket** — det er det som ble
      generert — og de andre språkene skal være urørt.

> **Kjent, ikke rettet i denne runden ([#918](https://github.com/jkosmo/a2-assessment-platform/issues/918)):**
> moduler opprettet gjennom samtalen får kildetittelen kopiert inn i alle tre språk, så
> publiseringsgaten ikke ser at tittelen mangler oversettelse. Rapporter det ikke som nytt.
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

---

# Runde 4 (v2.19.2) — §6, §11 og oppryddingen

Siste runde før #896 kan lukkes. Det som er nytt siden forrige runde:

## 6 · Samtalen foreslår — den overskriver aldri (#926)

Dette er hovedpunktet. Testes med en **eksisterende** modul.

- [ ] Åpne en modul på **Rediger**. Skriv om scenarioteksten for hånd — ikke lagre.
- [ ] Be om en revisjon i chatten («skjerp scenarioet»).
- [ ] Når svaret kommer: teksten din skal stå **urørt** i feltet, og samtaleloggen skal vise
      **«Forslag klart»** med **Bruk** og **Forkast**.
- [ ] **Forkast** → teksten din står fortsatt. Ingenting er endret.
- [ ] Be om en revisjon på nytt, og velg **Bruk** → feltet fylles med forslaget, synlig med én gang.
      (Uten dette ville det aksepterte forslaget vært usynlig til neste re-render.)
- [ ] Gjør det samme uten å ha skrevet noe først: da skal revisjonen lande **rett inn**, uten
      Bruk/Forkast. Et forslag her ville vært et ekstra klikk for noe du nettopp ba om.
- [ ] Samme to runder for **MCQ** («bytt alternativ 1C»).

**Å se etter:** at «skittent» betyr *feltene avviker fra det de ble tegnet med* — ikke at
Rediger-fanen er åpen. Får du Bruk/Forkast på en modul du ikke har rørt, er vakten for bred.

## 7 · Fanemerking ved asynkrone endringer (#926)

- [ ] Opprett en **ny modul** fra samtalen. Bli stående på **Rediger** mens kriteriene genereres.
- [ ] Når de er ferdige: **Innstillinger** skal få en prikk. Åpne fanen → prikken forsvinner.
- [ ] Gjenta, men stå i **Innstillinger** mens de genereres. Da skal ingen prikk komme — endringen
      er synlig der du er.

## 8 · Innstillinger etter oppryddingen

- [ ] Knappen **«Åpne avansert redigering»** skal være **borte**, sammen med setningen over den om
      at feltene «flyttes hit i neste leveranse». Begge var usanne og knappen gjorde ingenting.
- [ ] Ingen vei tilbake til Avansert noe sted i UI-et. `/admin-content/module/<id>/advanced`
      i adressefeltet skal redirigere inn i arbeidsflaten, ikke gi 404.

## 9 · Regresjon på ny-modul-flyten (#927)

Dekket av en e2e nå, men verdt én manuell gjennomgang siden hvert ledd har feilet før:

- [ ] Opprett modul → åpne Innstillinger mens kriteriene genereres → rediger ett kriterium, legg
      til ett, fjern ett → tilbake til Rediger → lagre → **åpne modulen på nytt**.
- [ ] Nøyaktig dine kriterier skal ligge der. Ikke de genererte, og ikke riktig *antall* med feil
      etiketter — det var den faktiske feilen i QA-runde 2.

## Rettelser til «Kjente begrensninger» over

- **Avansert-siden mangler «Oversett det som mangler»** — ikke lenger en begrensning. Siden er
  slettet (v2.19.0), og det finnes én vei til publisering.
- **#916** (enslig seksjonseksport) står fortsatt, og hører nå til #925-arbeidet med Seksjoner.

---

# Runde 5 (v2.22.0) — tre spor kjørt i parallell

Tre agenter arbeidet samtidig i hver sin worktree. Alt er flettet, testet og ligger på stage.
**199 e2e, 1 029 unit-tester.** Rekkefølgen under er ikke tilfeldig — den går fra det som påvirker
deltakeren, via forfatterflaten, til det nye API-et.

## 10 · Deltakerens lesevisning (#921, #922, #923, #924) — v2.20.0

- [ ] **Mine kurs** viser kurslista **ekspandert** ved åpning. Fremdrift og kursbevis er synlig uten
      å klikke.
- [ ] Åpne et kurs → **lista viker helt**, kurset får plassen alene, og det kommer en
      **«← Alle kurs»** øverst.
- [ ] Nettleserens **tilbakeknapp** skal gjøre det samme som lenka. Kurset har egen adresse
      (`?courseId=`), så en delt lenke åpner rett kurs.
- [ ] I en seksjon: **én** knapp, ikke to. Teksten skal si **«… og gå til testen»** når neste
      element er en modul, ikke «neste seksjon».
- [ ] **Siste** element: ingen knapp. ⚠️ Se merknaden under.
- [ ] **Diskusjon** finnes kun på kursnivå. Ingen diskusjonsboks i seksjonsleseren, ingen
      avkrysning per element i kurseditoren.

> ⚠️ **Ikke deploy til prod uten å lese dette.** #923 skjuler diskusjon per element — **ingenting er
> slettet.** API-et, `discussionsEnabled` per element og alle tråder ligger urørt, og verdien leses
> og skrives tilbake uendret ved lagring. Tell tråder med `courseItemId` før en prod-utrulling, slik
> du sa du ville verifisere.

> ⚠️ **Midlertidig oppførsel:** siste seksjon markeres nå **lest i det stille** når den åpnes.
> Uten det ble kursbeviset uoppnåelig for kurs som slutter med lesestoff. Dette erstattes av
> **«Avslutt kurset»**-knappen i **#929** — test at kursbeviset faktisk utstedes, men vit at
> mekanismen bak skal byttes.

## 11 · Lokaliseringskontrakten i forfatterflaten (#918, #920, #919) — v2.21.0

- [ ] **#918:** opprett en modul gjennom samtalen. Gå til publisering. Gaten skal si at tittelen
      mangler språk — før i dag så den en ferdig oversettelse der det bare var én.
      ⚠️ Den navngir foreløpig **feil to språk** hvis du jobber på engelsk; det er **#930**.
- [ ] **#920:** skriv i et felt i Rediger uten å lagre, og bytt språk i **begge** velgerne
      (innholdsspråk i linja over fanene, og menyspråk i topplinja). Begge skal spørre først.
      Avbryt → teksten står. Bekreft → den er borte, som du valgte.
- [ ] Bytt språk med et **urørt** skjema: da skal ingenting spørres. En vakt som alltid spør blir
      klikket bort.
- [ ] **#919** er rettet, men flaten er ikke nåbar — se **#928**. Hopp over den.

## 12 · Seksjoner kan reise alene (#916) — v2.22.0

- [ ] **Innholdsforvaltning → Seksjoner**: hver rad du eier har **Eksporter**. Rader du ikke eier
      skal ikke ha knappen — og ruta avviser uansett.
- [ ] **Importer seksjons-pakke** i sidehodet. Importer en fil du nettopp eksporterte.
- [ ] Den importerte seksjonen lander som **Utkast**, aldri publisert.
- [ ] Har seksjonen figurer, skal de følge med og vises.
- [ ] **Publiseringsgaten gjelder nå seksjoner.** Lag en seksjon med tekst på bare ett språk og
      prøv å publisere → blokkert, med felt og språk navngitt.
- [ ] Men *lagring* skal fortsatt gå: skriv en seksjon på norsk og lagre. Den lagres som utkast,
      ikke aktivert. For en seksjon er lagring publisering, så å avvise lagringen ville gjort det
      umulig å skrive på ett språk om gangen.
