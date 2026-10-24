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
  ett riktig og minst ett galt. Posisjoner, ikke tekst: oversettelsen holder alternativene i samme
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

- **Generering:** ett riktig svar er standard. KI lager «velg alle som stemmer» bare der kilden gir
  grunnlag — der den lister flere ting som alle stemmer — og høyst omtrent hvert tredje spørsmål.
  Forfatteren ser typen og kan bytte med bryteren.
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
