# Manuell test — stage 2.57.0

Alt som lar seg måle er automatisert. **Dette er bare det som krever et menneske:** om noe *føles*
riktig, om mengden er passe, og om en side ser ut som den skal på papir.

Sett av 15–20 minutter. Noter det som skurrer, også hvis du ikke kan sette ord på hvorfor.

⚠️ Hvis stage ikke svarer `2.57.0` på `/version`, stopp — da tester du feil versjon.

---

## 1. Profilsiden sier fra ved feil — for første gang

**Hvorfor:** `profile.js` kalte en global som aldri har vært satt. Hver eneste feilmelding har
forsvunnet stille siden 22. mars. Nå vises de.

1. Åpne `/profile`
2. Slå av nettet (flymodus, eller «Offline» i utviklerverktøyets nettverksfane)
3. Trykk **Last** / oppdater profilen

| Forventet | |
|---|---|
| En rød boks øverst til høyre med lesbar norsk tekst | ☐ |
| Den **blir stående** til du klikker × | ☐ |
| Teksten sier noe om hva som gikk galt, ikke bare «Error» | ☐ |

⚠️ **Det viktigste spørsmålet:** er meldingen til å forstå for en som ikke er utvikler?

---

## 2. «Resultater lastet» er borte

**Hvorfor:** tabellen som nettopp ble fylt sier det samme. Teksten ble stående og tok plass.

1. Åpne `/results`
2. Trykk **Last resultater**

| Forventet | |
|---|---|
| Tabellene fylles | ☐ |
| Ingen «Resultater lastet»-tekst noe sted | ☐ |
| Det føles **ikke** som om noe mangler | ☐ |

⚠️ **Si fra hvis det siste ikke stemmer.** Argumentet for å fjerne den var at handlingen har en
synlig virkning. Er virkningen for svak — for eksempel hvis tabellen så nesten lik ut før og etter
— er argumentet feil, og teksten skal tilbake.

---

## 3. Toast-mengden på sensorflaten

**Hvorfor:** `/review` har fjorten steder som viser toast. Jeg mistenker at flere gjentar noe
skjermen allerede viser, men det er en vurdering du er bedre plassert til å ta.

1. Åpne `/review`
2. Gjør en vanlig arbeidsrunde: last køen, velg en sak, bytt fane, filtrer

| Spørsmål | Svar |
|---|---|
| Hvor mange toaster dukket opp? | ____ |
| Var noen av dem overflødige? Hvilke? | ____ |
| Kom noen i veien for det du holdt på med? | ____ |

⚠️ Dette er ikke en feilsjekk. Det er den ene avgjørelsen jeg ikke kan ta fra koden.

---

## 4. Kursbeviset — språk og utskrift

**Hvorfor:** kursnavnet sto på **feil språk** før i dag. Fila var urørt siden juni og manglet alt.

1. Åpne `/participant/completed`, klikk deg inn på et kursbevis
2. Bytt språk i velgeren øverst

| Forventet | |
|---|---|
| **Kursnavnet** bytter språk, ikke bare etikettene rundt | ☐ |
| Sertifiseringsnivået er lesbart, ikke `basic`/`intermediate` | ☐ |

3. Trykk **Skriv ut** (eller Ctrl+P for forhåndsvisning)

| Forventet | |
|---|---|
| Beviset ser riktig ut på papir | ☐ |
| Ingen toast eller knapp havner i utskriften | ☐ |

⚠️ **Nivået er en kjent åpen sak (#1045):** dataene inneholder både språkkart og rå nøkler. Kommer
det opp `basic` her, er det den saken og ikke en ny feil — men noter det.

---

## 5. Språkbytte på tvers — føles det rolig?

**Hvorfor:** sju flater henter innhold på nytt ved språkbytte. Automatikken har målt at det ikke
blinker feil språk, men ikke om det **oppleves** greit.

Gå gjennom `/review`, `/results`, `/profile`, `/deltakere/status` og bytt nb ↔ en-GB på hver:

| Forventet | |
|---|---|
| Innholdet bytter språk uten at du må trykke noe | ☐ |
| Ingen synlig blinking eller hopp i layouten | ☐ |
| Valgt rad / valgt kurs beholdes | ☐ |
| Ingen rød feilmelding | ☐ |

---

## 6. Tomme tilstander ser like ut

**Hvorfor:** tre flater hadde håndlagde tomtilstander uten den delte stilen.

Finn en tom tabell (filtrer til noe uten treff) på `/results` og `/profile`:

| Forventet | |
|---|---|
| Tom tabell ser lik ut begge steder | ☐ |
| Teksten forklarer hvorfor den er tom | ☐ |

---

## Testsak opprettet på stage

For å få sensorkøen ut av «null rader» er det opprettet **én innlevering**, tydelig merket
`[TESTSAK #1046 …]`, på modulen **Agentflyt**:

| | |
|---|---|
| Innlevering | `cmtg2bgex0001pefiqz2lpofe` |
| Utfall | `UNDER_REVIEW` — ligger i sensorkøen |
| Hvorfor den havnet der | `declaration: "autonomous"` + `insistedAfterPrompt: true` tvinger manuell vurdering, uavhengig av modellens svar |

⚠️ Den er **ikke slettet**. Vil du ha den bort, si fra — jeg rydder på eksakt id, ikke på filter.

Den ga forresten det beviset som manglet: modulen **Agentflyt** heter «Agent Workflow» på engelsk,
så køen kunne endelig måles mot en ekte flerspråklig tittel.

---

## Det som allerede er maskinelt verifisert — ikke bruk tid her

- Ingen rå JSON på noen flate, verken ved lasting eller etter språkbytte
- Ingen rød feilmelding ved ren sidelasting
- Et tregt svar i gammelt språk overskriver ikke det du står i
- Språkbytte under første henting blir ikke slukt
- Køsøk finner saken på tvers av språk
- Alle feilmeldinger går gjennom den delte oversetteren

Dette er nå verifisert **på tre nivåer**:

1. Enhet, DOM og e2e mot mockede API-er — 1315 / 6 / 309
2. Stage-suiten mot **ekte data**, på API-nivå — 37
3. **Nytt i dag:** de ekte flatene i nettleser mot ekte data — 12

Nivå 3 har ikke vært mulig før. Appen sender deg til innlogging før noe rendres, og MSAL bruker
`sessionStorage` som Playwright ikke fanger. Løsningen: la `/participant/config` si `mock` — da
hoppes innloggingen over — og legg det ekte tokenet på hvert API-kall selv.

⚠️ Suiten er mutasjonsverifisert: med ugyldig token blir 8 av 12 røde. Den måler altså noe.

⚠️ **Forbeholdet som står igjen:** ingen av nivåene kan avgjøre om noe *føles* riktig. Det er hele
grunnen til at denne lista finnes.
