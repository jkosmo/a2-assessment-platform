# Hvor innfløkt er løsningen nå?

*Målt 2026-09-30, versjon 2.77.0. Kjør `npm run complexity` for å oppdatere. Reglene for hvert tall står under tallet.*

## Samlet: **73 / 100**

Gjennomsnittet av de fem tallene under. 100 betyr «slik vi vil ha det».

| Hva | Skår |
|---|---|
| Regler som er skrevet flere steder | **100** |
| Viktige regler med mer enn én utgave i koden | **100** |
| Filer alt må gjennom | **10** |
| Filer som alltid endres sammen | **90** |
| Størrelse | **64** |

## 1. Regler som er skrevet flere steder — 100

Når en regel står flere steder i koden, kan den bli rettet ett sted og glemt et annet. Vi har tester
som teller slike steder og som feiler hvis tallet går opp.

Stedene nå: **18**. Av dem er **18 et gulv** — de kan ikke fjernes, og
begrunnelsen står ved siden av tallet i testen som teller dem (den som oversetter en feilmelding
MÅ lese feilteksten; menyspråket MÅ defineres ett sted). Igjen står **0 som er gjeld**,
og det er dem skåren regner på.
*Regel: 100 minus 2 poeng per sted over gulvet.*

| Hva telles | Steder | Gulv | Gjeld | Hvor tallet kommer fra |
|---|---:|---:|---:|---|
| Skjermer som selv velger hvilket språk et lagret innhold vises på (serveren skal gjøre det) | 0 | 0 | 0 | `test/client-locale-parser-guard.test.js` |
| Steder som viser serverens rå feiltekst i stedet for en oversatt melding | 4 | 4 | 0 | `test/raw-server-error-guard.test.js` |
| Feil fra serveren uten kode (klienten kan ikke oversette dem) | 2 | 2 | 0 | `test/unit/domain-error-codes-999.test.ts` |
| Steder i forfatterkonsollet som bruker menyspråket (ikke innholdsspråket) | 12 | 12 | 0 | `test/unit/admin-content-locale-roles-974.test.js` |

⚠️ **Gulvet kan bare gå ned.** Å heve det er å slette gjeld med et tastetrykk, og da måler denne
raden viljen vår i stedet for koden. Rapporten stopper om et gulv er høyere enn tallet det hører
til — da har tellingen sluttet å måle noe.

## 2. Viktige regler med mer enn én utgave — 100

For de viktigste reglene finnes én delt funksjon. Alt annet som gjør samme jobb på egen hånd er en
ekstra utgave som kan glide fra den første. Ekstra utgaver nå: **0**.
*Regel: 100 minus 15 poeng per ekstra utgave.*

| Regel | Delt funksjon | Ekstra utgaver | Slik telles det |
|---|---|---:|---|
| Kan en modul publiseres? (knapp, kurskaskade, import) | `evaluateModulePublishGate` | 0 | kall til de underliggende sjekkene utenfor den delte funksjonen |
| Kan deltakeren nås? (aktiv og ikke anonymisert) | `isReachableParticipant` | 0 | linjer som sjekker begge feltene selv |
| Hvilket språk gjelder for denne forespørselen? | `requestLocale` | 0 | egne reserveverdier for språk i rutene |
| Er innleveringen avgjort? (hvilke statuser teller som ferdig) | `isSettledSubmission` | 0 | spørringer som lister statusene selv |

## 3. Filer alt må gjennom — 10

En fil som er svært stor kan ikke endres uten å røre noe annet, og en fil som svært mange andre er
avhengige av gjør hver endring risikabel. Over 1 500 linjer: **6**. Mellom 800 og
1 500: **6**.
*Regel: 100 minus 10 poeng per fil over 1 500 linjer og 5 per fil mellom 800 og 1 500. Oversettelsestabeller telles ikke.*

| Fil | Linjer |
|---|---:|
| `public/static/admin-content-shell.js` | 4669 |
| `public/participant.js` | 4306 |
| `src/modules/adminContent/llmContentGenerationService.ts` | 2130 |
| `public/static/admin-content-courses.js` | 1803 |
| `public/review.js` | 1777 |
| `public/static/admin-content-settings-tab.js` | 1519 |
| `src/routes/adminContent.ts` | 1491 |
| `src/modules/adminContent/adminContentCommands.ts` | 1299 |
| `public/static/admin-content-sections.js` | 1173 |
| `public/static/workspace-help-content.js` | 934 |
| `src/modules/adminContent/adminContentSchemas.ts` | 809 |
| `public/static/admin-content-library.js` | 805 |

Mest brukt av andre filer (ikke med i skåren, men verdt å vite):

| Modul | Antall filer som bruker den |
|---|---:|
| `prisma` | 53 |
| `index` | 40 |
| `locale` | 39 |
| `AppError` | 36 |
| `auditEvents` | 34 |
| `auditService` | 32 |
| `env` | 31 |
| `prismaRuntime` | 31 |

## 4. Filer som alltid endres sammen — 90

Når to filer nesten alltid endres i samme commit, henger de sammen på en måte koden ikke viser.
Fra git-historikken de siste 90 dagene: par som er endret sammen minst 5 ganger og i minst 60 % av
tilfellene der én av dem ble endret. Par nå: **2**.
*Regel: 100 minus 5 poeng per par. Commits som rører mer enn 12 filer telles ikke — de sier lite om kobling.*

| Fil A | Fil B | Ganger sammen | Andel |
|---|---|---:|---:|
| `public/participant-completed.js` | `public/profile.js` | 10 | 63 % |
| `src/modules/course/courseRepository.ts` | `src/routes/courses.ts` | 8 | 62 % |

## 5. Størrelse — 64

Hvor mye det er å holde ved like. Ikke feil i seg selv, men alt her koster tid ved hver endring.
*Regel: gjennomsnitt av tre deltall — API-ruter (100 ned til 0 fra 120 til 320), databasetabeller (100 ned fra 30, 2 poeng per tabell) og oversettelsesnøkler (100 ned fra 3 000, 1 poeng per 50).*

| Hva | Antall |
|---|---:|
| API-ruter | 203 |
| Databasetabeller | 39 |
| Kolonner i databasen | 502 |
| Oversettelsesnøkler (alle språk) | 5459 |
| Testfiler | 366 |

## Historikk

| Dato | Versjon | Samlet | Regler flere steder | Utgaver | Store filer | Endres sammen | Størrelse |
|---|---|---:|---:|---:|---:|---:|---:|
| 2026-09-12 | 2.67.0 | 63 | 28 | 100 | 25 | 90 | 70 |
| 2026-09-14 | 2.68.0 | 65 | 36 | 100 | 30 | 90 | 70 |
| 2026-09-17 | 2.69.0 | 64 | 38 | 100 | 25 | 90 | 69 |
| 2026-09-18 | 2.70.0 | 63 | 38 | 100 | 20 | 90 | 65 |
| 2026-09-18 | 2.71.0 | 63 | 38 | 100 | 20 | 90 | 65 |
| 2026-09-18 | 2.72.0 | 63 | 42 | 100 | 20 | 90 | 65 |
| 2026-09-19 | 2.73.0 | 63 | 42 | 100 | 20 | 90 | 64 |
| 2026-09-19 | 2.74.0 | 67 | 60 | 100 | 20 | 90 | 64 |
| 2026-09-22 | 2.75.0 ⚠️ | 76 | 100 | 100 | 20 | 95 | 64 |
| 2026-09-22 | 2.76.0 | 76 | 100 | 100 | 20 | 95 | 64 |
| 2026-09-30 | 2.77.0 | 73 | 100 | 100 | 10 | 90 | 64 |

⚠️ **2.75.0: måleregelen ble endret.** Dimensjon 1 teller nå bare steder OVER gulvet (de som faktisk kan fjernes). Før talte den alle, også oversetteren som må lese feilteksten og definisjonen av menyspråket — rundt 18 av 20 steder. Hoppet fra 60 til 96 er derfor en ny målestokk, ikke en opprydding.
