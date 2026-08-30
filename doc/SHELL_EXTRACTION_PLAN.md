# Uttrekksplan for `admin-content-shell.js`

Målt 30.08.2026 med tre verktøy i `scripts/dev/`: `dead-code-scan`, `section-coupling` og
`pure-function-scan` — alle bygget på TypeScript-parseren.

## ⚠️ Planen ble skrevet om én gang. Det er den viktigste opplysningen i dokumentet.

**Første utkast** rangerte de 18 seksjonene etter kobling og foreslo å trekke dem ut i rekkefølge,
med chat-rendering (626 linjer) som første store gevinst.

**Det var feil analyse.** De seks modulene som allerede ER trukket ut av denne fila —
`preview`, `blueprint-hash`, `shell-state`, `shared`, `localized-copy`, `external-llm` — har
**null muterbar tilstand på modulnivå**, alle seks. Mønsteret er å trekke ut **ren logikk**, ikke
seksjoner.

En seksjon på 626 linjer der alt rører `sessionState` og `document` kan ikke trekkes ut, uansett
hvor lite den kobler til naboene.

## Hva som faktisk er mulig

| | Linjer |
|---|---:|
| Fila | 7 873 |
| I navngitte seksjoner | 6 657 |
| **Ren logikk (ingen tilstand, DOM eller nett)** | **824 (12 %)** |
| Bundet til tilstand, DOM eller nett | 5 833 (88 %) |

**51 modulnivå-bindinger** — `let`/`var` og DOM-konstanter — er det koden henger i.

### De største rene funksjonene

| Linjer | Funksjon |
|---:|---|
| 63 | `buildDriftDiffModalHtml` |
| 62 | `buildCriteriaEditorHtml` |
| 35 | `computeCriteriaDiff` |
| 30 | `buildEditorStateFromCriteriaRecord` |
| 23 | `normalizeModuleTitlePatch` |
| 21 | `buildDefaultSubmissionSchema` |
| 21 | `captureLatestCriteriaState` |

⚠️ **`applyStructuredTitleEditInBackground` (50) og `refreshLocalizedDraftInBackground` (49) er
trolig feilklassifisert.** Renhetssjekken ser bare på funksjonens egen tekst — kaller den en annen
funksjon som rører tilstand, fanges det ikke. Navnene («InBackground») tyder på det motsatte av
rent. Sjekk hver enkelt før uttrekk.

## Revidert plan

### Steg 1 — kriterieredigereren (~150 linjer)

`buildCriteriaEditorHtml`, `computeCriteriaDiff`, `buildEditorStateFromCriteriaRecord`,
`captureLatestCriteriaState`. De hører sammen, er rene, og utgjør en sammenhengende oppgave:
å regne ut hva som er endret i vurderingskriteriene og bygge redigereren.

**Dette er første gang den logikken kan enhetstestes.** I dag nås den bare gjennom e2e.

### Steg 2 — driftsdiffen (~63 linjer)

`buildDriftDiffModalHtml`. Selvstendig, ren, og den bygger HTML — altså perfekt for en DOM-test
på 8 sekunder i stedet for en e2e-test på 80.

### Steg 3 — de små normalisererne (~65 linjer)

`normalizeModuleTitlePatch`, `buildDefaultSubmissionSchema` og de øvrige småfunksjonene i i18n- og
fanelogikken.

### Etter det: stopp og mål på nytt

Når ~280 linjer ren logikk er ute, kjør `pure-function-scan` igjen. Uttrekk avdekker ofte ny
renhet: en funksjon som bare var uren fordi den kalte noe som nå er en importert modul.

⚠️ **Ikke planlegg lenger enn dette.** De to første stegene tar kanskje en halv dag og gir et svar
på om mønsteret bærer. Å planlegge steg 4–9 nå ville vært å gjette.

## ⚠️ Risiko og disiplin

Ren refaktorering av kode uten enhetstester er den farligste endringen vi gjør.

1. **Ett uttrekk per commit.** Aldri to.
2. **Alle fire suitene mellom hvert steg.**
3. **`dead-code-scan` etter hvert steg** — et uttrekk som etterlater noe uåpnåelig har flyttet feil
   ting.
4. **Skriv testen for den nye modulen FØR koden flyttes inn.** Ellers er uttrekket bare en
   flytting.
5. **Ingen atferdsendring i samme commit som et uttrekk.**

⚠️ Punkt 5 ryker oftest. I #1027 blandet jeg fiks og flytting, og brukte fem QA-runder på å finne
ut hvilken av dem som brakk hva.

## Hva denne planen IKKE er

Den er ikke et argument for at fila er for stor.

Fire metoder fant til sammen 548 linjer død kode i hele frontend — **2 %**. Og 88 % av `shell.js`
er lim mellom DOM, tilstand og nett. **Det er ikke en defekt; det er hva en samtaledrevet
innholdsassistent er.**

Målet er testbarhet for de 12 % som kan testes, ikke færre linjer.
