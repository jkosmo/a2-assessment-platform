# Brukerflatene: hvem bruker hva

*Målt 2026-09-12. Bare telling — ingen anbefaling. Kjør `npx tsx scripts/complexity/ui-inventory.ts` for å oppdatere.*

Hvorfor: skjermene er laget på ulike tidspunkt, og hver forbedring landet der noen jobbet akkurat da.
Den beste utgaven av hver byggekloss finnes derfor allerede — den nyeste. Tabellen viser hvilke
skjermer som har den, hvilke som har sin egen, og hvilke som mangler den.

## Per byggekloss

| Byggekloss | Bruker den felles | Felles + egne rester | Bare egen | Har den ikke | Egne utgaver i alt | Felles modul sist endret |
|---|---:|---:|---:|---:|---:|---|
| Feilmelding fra serveren | 13 | 1 | 0 | 0 | 1 | 2026-09-10 |
| Tom liste / ingenting å vise | 5 | 0 | 4 | 5 | 32 | 2026-06-22 |
| Laster… | 5 | 0 | 2 | 7 | 7 | 2026-06-22 |
| Melding nederst (toast) | 13 | 1 | 0 | 0 | 2 | 2026-06-24 |
| Meny og profil øverst | 7 | 0 | 0 | 7 | 0 | 2026-08-23 |
| Språkvelger | 7 | 0 | 6 | 1 | 6 | 2026-08-30 |
| Hvem er jeg (identitetsfelt) | 6 | 0 | 0 | 8 | 0 | 2026-08-30 |
| Hva som vises ut fra rolle | 1 | 0 | 1 | 12 | 5 | — |
| Knapp som jobber (opptatt-tilstand) | 4 | 0 | 4 | 6 | 11 | 2026-08-30 |
| Tekster på ett språk (hardkodet) | 8 | 0 | 6 | 0 | 56 | — |

- **Feilmelding fra serveren** — Når et kall feiler: oversettes svaret via den delte tabellen, eller vises serverens tekst rått? Felles modul: `api-error.js`.
- **Tom liste / ingenting å vise** — Vises tomtilstanden med den delte hjelperen, eller med egen HTML? Felles modul: `loading.js (showEmpty)`.
- **Laster…** — Vises lasting med den delte hjelperen (skjelett), eller med egen tekst? Felles modul: `loading.js (showLoading)`.
- **Melding nederst (toast)** — Bruker skjermen den delte toasten? Felles modul: `toast.js`.
- **Meny og profil øverst** — Bygges toppmenyen av den delte modulen? Felles modul: `workspace-nav.js`.
- **Språkvelger** — Har skjermen språkvelger, og henter den innhold på nytt ved bytte (#1040)? Felles modul: `localized-resource.js`.
- **Hvem er jeg (identitetsfelt)** — Identitetsfeltene fra den delte modulen (#1044), eller egne? Felles modul: `identity-defaults.js`.
- **Hva som vises ut fra rolle** — Skjules/vises deler av skjermen etter rolle med den delte regelen? Felles modul: `applyRoleBasedVisibility`.
- **Knapp som jobber (opptatt-tilstand)** — Deaktiveres knappen med den delte hjelperen mens kallet pågår? Felles modul: `busy-button.js`.
- **Tekster på ett språk (hardkodet)** — Norsk tekst skrevet rett i koden i stedet for i oversettelsestabellen. Tallet er antall linjer. Felles modul: `i18n-tabellene`.

## Per skjerm

Datoen i parentes er når skjermen tok den felles byggeklossen i bruk. «egen (n)» er antall steder
med egen løsning. For «Tekster på ett språk» er tallet antall kodelinjer med norsk tekst utenfor
oversettelsestabellen.

| Skjerm | Sist endret | Feilmelding fra serveren | Tom liste / ingenting å vise | Laster… | Melding nederst (toast) | Meny og profil øverst | Språkvelger | Hvem er jeg (identitetsfelt) | Hva som vises ut fra rolle | Knapp som jobber (opptatt-tilstand) | Tekster på ett språk (hardkodet) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Deltaker: Mine kurs | 2026-09-11 | begge (1 egne) | felles | felles | felles (2026-03-11) | felles (2026-06-22) | egen (1) | felles (2026-08-30) | — | felles (2026-08-30) | egen (3) |
| Deltaker: Fullførte | 2026-09-11 | felles (2026-08-29) | felles | felles | felles (2026-08-30) | felles (2026-06-22) | felles (2026-08-30) | felles (2026-08-30) | — | felles (2026-08-30) | felles |
| Deltaker: Profil | 2026-09-11 | felles (2026-08-29) | felles | felles | felles (2026-08-30) | felles (2026-06-22) | felles (2026-08-30) | felles (2026-08-30) | — | felles (2026-08-30) | felles |
| Kursbevis | 2026-09-11 | felles (2026-08-30) | — | — | felles (2026-08-30) | — | felles (2026-08-30) | — | — | — | felles |
| Sensor: køer | 2026-09-11 | felles (2026-08-23) | felles | felles | felles (2026-03-22) | felles (2026-06-22) | felles (2026-08-30) | felles (2026-08-30) | felles (2026-03-22) | — | felles |
| Rapporter | 2026-08-30 | felles (2026-08-29) | felles | felles | felles (2026-08-30) | felles (2026-06-22) | felles (2026-08-30) | felles (2026-08-30) | — | felles (2026-08-30) | felles |
| Kullstatus | 2026-08-30 | felles (2026-08-30) | — | — | felles (2026-08-30) | felles (2026-07-19) | felles (2026-08-30) | — | — | — | felles |
| Forfatter: modul (samtale) | 2026-09-12 | felles (2026-08-23) | — | — | begge (2 egne) | — | — | — | — | egen (2) | egen (1) |
| Forfatter: kurs | 2026-09-12 | felles (2026-08-23) | egen (16) | egen (3) | felles (2026-04-18) | — | egen (1) | — | — | — | egen (17) |
| Forfatter: seksjoner | 2026-09-10 | felles (2026-08-23) | egen (9) | — | felles (2026-06-15) | — | egen (1) | — | — | egen (3) | egen (19) |
| Forfatter: bibliotek | 2026-09-12 | felles (2026-08-23) | egen (4) | — | felles (2026-04-18) | — | egen (1) | — | — | egen (5) | egen (8) |
| Forfatter: klasser | 2026-09-11 | felles (2026-08-23) | egen (3) | egen (4) | felles (2026-06-26) | — | egen (1) | — | egen (5) | egen (1) | egen (8) |
| Forfatter: kalibrering | 2026-08-24 | felles (2026-08-23) | — | — | felles (2026-04-18) | — | egen (1) | — | — | — | felles |
| Admin: plattform | 2026-08-30 | felles (2026-08-30) | — | — | felles (2026-03-22) | felles (2026-06-22) | felles (2026-08-30) | felles (2026-08-30) | — | — | felles |

## Slik leses det

- En kolonne med mange «egen» eller «—» er en byggekloss som ble laget etter at de fleste skjermene
  var ferdige. Det er der spredning gir mest.
- En skjerm med mange «egen» er bygget tidlig og lite rørt siden. Den bør tas som helhet.
- «begge» betyr at spredningen er halvgjort: den felles finnes, men gamle rester står igjen.
- «—» betyr at tellingen verken fant den felles eller et kjent eget mønster. Det kan være at
  skjermen ikke trenger egenskapen — eller at den løser det på en måte tellingen ikke kjenner.
  Sjekk skjermen før du konkluderer.
