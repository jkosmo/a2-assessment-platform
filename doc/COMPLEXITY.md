# Hvor innfløkt er løsningen nå?

*Målt 2026-09-17, versjon 2.69.0. Kjør `npm run complexity` for å oppdatere. Reglene for hvert tall står under tallet.*

## Samlet: **64 / 100**

Gjennomsnittet av de fem tallene under. 100 betyr «slik vi vil ha det».

| Hva | Skår |
|---|---|
| Regler som er skrevet flere steder | **38** |
| Viktige regler med mer enn én utgave i koden | **100** |
| Filer alt må gjennom | **25** |
| Filer som alltid endres sammen | **90** |
| Størrelse | **69** |

## 1. Regler som er skrevet flere steder — 38

Når en regel står flere steder i koden, kan den bli rettet ett sted og glemt et annet. Vi har tester
som teller slike steder og som feiler hvis tallet går opp. Summen nå: **31 steder**.
*Regel: 100 minus 2 poeng per sted.*

| Hva telles | Steder | Hvor tallet kommer fra |
|---|---:|---|
| Skjermer som selv velger hvilket språk et lagret innhold vises på (serveren skal gjøre det) | 2 | `test/client-locale-parser-guard.test.js` |
| Steder som viser serverens rå feiltekst i stedet for en oversatt melding | 13 | `test/raw-server-error-guard.test.js` |
| Feil fra serveren uten kode (klienten kan ikke oversette dem) | 4 | `test/unit/domain-error-codes-999.test.ts` |
| Steder i forfatterkonsollet som bruker menyspråket (ikke innholdsspråket) | 12 | `test/unit/admin-content-locale-roles-974.test.js` |

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

## 3. Filer alt må gjennom — 25

En fil som er svært stor kan ikke endres uten å røre noe annet, og en fil som svært mange andre er
avhengige av gjør hver endring risikabel. Over 1 500 linjer: **5**. Mellom 800 og
1 500: **5**.
*Regel: 100 minus 10 poeng per fil over 1 500 linjer og 5 per fil mellom 800 og 1 500. Oversettelsestabeller telles ikke.*

| Fil | Linjer |
|---|---:|
| `public/static/admin-content-shell.js` | 4570 |
| `public/participant.js` | 4157 |
| `src/modules/adminContent/llmContentGenerationService.ts` | 2091 |
| `public/static/admin-content-courses.js` | 1815 |
| `public/review.js` | 1777 |
| `public/static/admin-content-settings-tab.js` | 1463 |
| `src/routes/adminContent.ts` | 1361 |
| `src/modules/adminContent/adminContentCommands.ts` | 1157 |
| `public/static/admin-content-sections.js` | 1000 |
| `public/static/workspace-help-content.js` | 934 |

Mest brukt av andre filer (ikke med i skåren, men verdt å vite):

| Modul | Antall filer som bruker den |
|---|---:|
| `prisma` | 53 |
| `index` | 39 |
| `locale` | 38 |
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
| `public/participant-completed.js` | `public/profile.js` | 14 | 70 % |
| `public/profile.js` | `public/results.js` | 12 | 60 % |

## 5. Størrelse — 69

Hvor mye det er å holde ved like. Ikke feil i seg selv, men alt her koster tid ved hver endring.
*Regel: gjennomsnitt av tre deltall — API-ruter (100 ned til 0 fra 120 til 320), databasetabeller (100 ned fra 30, 2 poeng per tabell) og oversettelsesnøkler (100 ned fra 3 000, 1 poeng per 50).*

| Hva | Antall |
|---|---:|
| API-ruter | 199 |
| Databasetabeller | 39 |
| Kolonner i databasen | 506 |
| Oversettelsesnøkler (alle språk) | 4871 |
| Testfiler | 352 |

## Historikk

| Dato | Versjon | Samlet | Regler flere steder | Utgaver | Store filer | Endres sammen | Størrelse |
|---|---|---:|---:|---:|---:|---:|---:|
| 2026-09-12 | 2.67.0 | 63 | 28 | 100 | 25 | 90 | 70 |
| 2026-09-14 | 2.68.0 | 65 | 36 | 100 | 30 | 90 | 70 |
| 2026-09-17 | 2.69.0 | 64 | 38 | 100 | 25 | 90 | 69 |
