# #1077 — nye spørsmålstyper i moduler: designnotat

Status: godkjent av produkteier 2026-10-24 (alle fire avgjørelser nederst: anbefalingen).

## Kort fortalt

Én type om gangen, i denne rekkefølgen: **velg alle som stemmer** → **sett i riktig rekkefølge** →
**fyll inn ordet som mangler**. Hvert spørsmål er fortsatt rett eller galt (ingen delpoeng), så
poengsum, bestått-grense (`mcqMinPercent`), rapporter og gjennomgang regner som i dag. Datamodellen
får en type og en strukturert fasit ved siden av dagens felt (additivt, #811); et spørsmål uten type
er dagens «ett riktig svar».

## Slik er det i dag (kartlagt 2026-10-24)

- `MCQQuestion`: `stem`, `optionsJson`, `correctAnswer` (alternativets **tekst**, lagret som
  LocalizedText per språk), `rationale`. Ingen type.
- `MCQResponse`: `selectedAnswer` (tekst på deltakerens språk) og `isCorrect` (boolsk), én rad per
  forsøk og spørsmål.
- Retting skjer ett sted: `mcqService.ts:115-133` (`matchesLocalizedContentVariant`, eksakt tekst mot
  hvert språk). `rawScore` = antall riktige, `percentScore` = andel av spørsmålene i forsøket.
- Bestått-grensen har ett hjem: `mcqPassRule.ts` (vakt: `mcq-pass-rule-guard.test.js`).
- Fasit går ut én vei: `/api/submissions/:id/mcq-review` (#1061), og bare når `reviewAfterSubmit` er på.

Antakelsen «nøyaktig ett riktig svar, som tekst» ligger i ni lag: zod-skjemaet (`correctAnswer` må
være et alternativ), KI-genereringens kodek og prompt, klientens oversettelse (fasit = indeks i
kildespråket), skillets kontroller (`mcq-cue-check`, `localization-check`, `export-validate`),
deltakerens radioknapper, `selectedAnswer` som én streng, `isCorrect` som boolsk, `rawScore` som
heltall, og kvalitetsrapportens distraktortall (`mcqSemanticReport`).

## Forslag

### Datamodell (additiv)

| Felt | Ny | Innhold |
|---|---|---|
| `MCQQuestion.questionType` | `TEXT NOT NULL DEFAULT 'single'` | `single` · `multiple` · `order` · `fill` |
| `MCQQuestion.answerKeyJson` | `TEXT NULL` | typeavhengig fasit (under); null for `single` |
| `MCQResponse.answerJson` | `TEXT NULL` | deltakerens svar for de nye typene; `selectedAnswer` beholdes som lesbar tekst |

`correctAnswer` beholdes for `single`. For `multiple` lagres det FØRSTE riktige alternativet der, så
lesere som ikke kjenner typen ennå, viser noe forståelig i stedet for å feile. Den er ikke grunnlaget
for retting.

Fasit per type:

- **`multiple`:** posisjonene til de riktige alternativene i `optionsJson`, `{"correct":[0,2]}` — minst
  ett riktig; alle kan være riktige (DECISIONS 2026-10-24). Posisjoner, ikke tekst: oversettelsen holder alternativene i samme
  rekkefølge, så fasiten følger med på alle språk.
- **`order`:** alternativene *er* den riktige rekkefølgen i `optionsJson`; ingen ekstra fasit. Stokkes
  ved levering, som i dag.
- **`fill`:** godkjente svar per språk, `{ nb: ["tre", "3"], nn: [...], "en-GB": [...] }`. Spørsmålet har
  én lukke (`___`) i stammen.

### Retting — rett eller galt, samme sted

`mcqService` får én funksjon per type, kalt fra samme løkke:

- `multiple`: riktig når valgt mengde = fasitmengden (ingen ekstra, ingen mangler).
- `order`: riktig når rekkefølgen er nøyaktig fasitens.
- `fill`: riktig når svaret, normalisert, er lik et godkjent svar på et av språkene. Normalisering:
  trim, flere mellomrom til ett, små bokstaver (`toLocaleLowerCase`), ingen avstandsregning og ingen KI.

`isCorrect` forblir boolsk, `rawScore` heltall, og alt nedstrøms (vedtak, `mcqMinPercent`,
gjennomgang, ankebehandling, kalibrering) er uendret.

### Deltakeren

- `multiple`: avkrysningsbokser, teksten «Velg alle som stemmer». Antallet riktige oppgis ikke.
- `order`: liste med «Flytt opp»/«Flytt ned» på hver rad (tastatur og skjermleser), dra-og-slipp som
  tillegg på PC.
- `fill`: ett tekstfelt der lukka står.
- Kladd (autolagring), forhåndsvisning og gjennomgang etter innlevering (#1061) støtter typen.

### Forfatteren, KI, oversettelse, eksport og skillet

Per type, i samme leveranse: editoren (velg type; flere avkrysninger / rekkefølge / godkjente svar),
zod-skjemaet, KI-generering og -revisjon (prompt og kodek), oversettelsen (fasit følger posisjon for
`multiple` og `order`; godkjente svar oversettes per språk for `fill`), eksport/import, og skillet
(`package-schema.md`, `modules.md`, `mcq-cue-check`, `localization-check`, `export-validate`).

### Rapporter

`mcqSemanticReport`: vanskegrad og diskriminering er uendret (bygger på `isCorrect`). Distraktortall
gir mening for `single` og `multiple`; for `order` og `fill` vises de ikke.

⚠️ Funnet under kartleggingen, ikke verifisert: `mcqSemanticReport.ts:165` sammenligner deltakerens
tekst med de lagrede (serialiserte) alternativene. For spørsmål lagret med språkkart blir
distraktortallene trolig alltid 0. Sjekkes og rettes som eget punkt før `multiple`.

## Leveranse 1b — KI og skillet (produkteier 2026-10-24)

- **Generering (endret samme dag, se DECISIONS):** plattformen trekker en plan — et tilfeldig antall
  spørsmål, 10–50 % av settet, på tilfeldige plasser, hvert med et tilfeldig antall riktige (ett til
  alle) — og KI konstruerer de spørsmålene på fakta fra kilden. Følger svaret ikke planen: ett nytt
  forsøk, så en advarsel. Forfatteren ser typen og kan bytte med bryteren. (Første versjon, «KI lager
  det bare der kilden lister flere ting, høyst hvert tredje», ga null av tretti på stage.)
- **Revisjon:** typen beholdes, med mindre forfatteren ber om det **generelt** («bruk flere spørsmål med
  flere riktige svar», «gjør testen vanskeligere»). Da vurderer KI selv hvor mange, ut fra
  vanskelighetsgraden, men **høyst 50 %** av spørsmålene i settet. Det trengs ikke å be om det per
  spørsmål. Endringen vises som et forslag forfatteren godtar, som i dag.
- **Skillet** følger samme regel som genereringen, og kontrollene (hint, oversettelse, eksport) kjenner
  typen.

## Leveranser

1. **Felles grunnlag + `multiple`.** Migrasjon (de tre feltene), typebevisst retting, deltakervisning,
   editor, KI, oversettelse, eksport/import, skillet, rapport. E2e for deltaker og forfatter.
2. **`order`.**
3. **`fill`.**

Hver leveranse går gjennom stage og QA-porten før neste begynner.

## Avgjørelser (produkteier, 2026-10-24: anbefalingen på alle fire)

1. Rett eller galt per spørsmål (anbefalt), eller delpoeng?
2. Skal deltakeren få vite hvor mange som er riktige i «velg alle som stemmer»? (Anbefalt: nei.)
3. «Fyll inn»: er normaliseringen over riktig nivå (store/små bokstaver og mellomrom likt, ellers
   eksakt)?
4. Rekkefølgen på leveransene: `multiple` → `order` → `fill`?

## Leveranse 2 — «sett i riktig rekkefølge» (produkteier 2026-10-25: anbefalingen på alle tre)

1. **KI lager høyst ett per test, og bare der kilden beskriver steg i en bestemt rekkefølge** (en
   prosess, en prosedyre, et forløp). Finner KI ingen slik rekkefølge, lager den ingen og sier fra, så
   forfatteren ser hvorfor. Ingen tilfeldig plan som for «velg alle»: en rekkefølge plattformen tvinger
   fram, blir kunstig. Forfatteren kan alltid gjøre et spørsmål om til typen selv.
2. **3–6 elementer.** Med to er det å gjette; med sju eller flere blir flyttingen tung på telefon.
3. **Revisjon som for «velg alle»:** typen beholdes, med mindre forfatteren ber om det generelt.

Fasit og utlevering:

- Alternativene lagres i riktig rekkefølge (`optionsJson`); `answerKeyJson` er null.
- **Utleveres alltid stokket**, også når modulen har slått av stokking (#1032) — ellers er fasiten
  rekkefølgen deltakeren ser. Stokkingen gir aldri den riktige rekkefølgen.
- Riktig når hele rekkefølgen stemmer; `answerJson = {"order":[posisjoner]}`, `selectedAnswer` er
  elementene skilt med « → ».


## Leveranse 3 — «fyll inn ordet som mangler» (produkteier 2026-10-31)

Avgjørelser:

1. **Godkjente svar som liste**, uten KI. Store og små bokstaver, mellomrom og tegnsetting på slutten
   teller ikke, **og ett feil tegn godtas i svar på sju tegn eller mer** («samtyke» for «samtykke»). I
   kortere svar er ett tegn et annet ord («tro» er ikke «tre»).
2. **Én lukke** (`___`) per spørsmål, på hvert språk.
3. **Rett eller galt**, som de andre typene.

Lagring (avvik fra forslaget over): de godkjente svarene lagres som **alternativene** (`optionsJson`),
hvert med sine språk, ikke som en egen liste per språk i `answerKeyJson`. Da virker oversettelsen,
publiseringskontrollen, eksport/import, spørsmålsbanken og skillets språkkontroll uendret. Prisen er at
hvert språk har like mange godkjente svar — «tre» og «3» blir «three» og «3». Svaret godtas på et
hvilket som helst av spørsmålets språk.

- `answerKeyJson` er null; `correctAnswer` er det første godkjente svaret, for lesere som ikke kjenner typen.
- **Alternativene sendes aldri til deltakeren** (`mcq/start` gir `options: []`) — de er fasiten.
- Svaret sendes som `textAnswer`; `answerJson = {"text": …}`, `selectedAnswer` er det som ble skrevet.
- Gjennomgangen (#1061) viser `acceptedAnswers`; kvalitetsrapporten teller ingen feilalternativer.
- KI: revisjon og oversettelse **bevarer** typen og lukka. KI **lager** ikke typen ennå — det er
  leveranse 3b, som for «sett i rekkefølge» (2b).
