# Kompleksitetsskanning

Månedlig måling av om kodebasen samler opp slitasje. Mekanisme 4 i kompleksitetsbremsen.

> **Sist kjørt: 2026-08-21** · neste forfaller **2026-09-21**

⚠️ Datoen over er den eneste kilden. `AGENTS.md` og `CLAUDE.md` peker hit — de gjentar den ikke.
To kopier av samme faktum som må oppdateres i takt er nøyaktig feilklassen skanningen leter etter.

## Hvorfor månedlig, og hva tallet betyr

Verdien er ikke funnene alene — det er **trenden**. Gikk «hvor mange steder svarer på dette
spørsmålet» opp eller ned siden sist? Det er det eneste tallet som sier om bremsen virker.

En enkeltstående skanning forteller bare at kodebasen har slitasje. Det har alle kodebaser.

## Logg

| Dato | Funn | Områder | Toppfunn | Notat |
|---|---|---|---|---|
| 2026-08-21 | 48 | 6 av 6 | Kursimport uten eierskapssjekk (#942) | Første kjøring. Utløst av #938, ikke av rutinen. 45 saker under #941 |

**Nullpunktet** for trendmålingen, fra første kjøring:

| Spørsmål | Steder |
|---|---|
| Hva inneholder dette kurset? | 25 |
| Er brukeren privilegert nok? | 12 |
| Er dette forsøket bestått? | 8 |
| Er kurset synlig for deltakeren? | 8 |
| Er skjemaet endret? | 5 |
| Er kurset fullført? | 5 |
| Hvilken lokale gjelder nå? | 4 |

## Slik kjøres den

Seks agenter, ett område hver, samme leteinstruks. Kjør dem parallelt — de rører ikke hverandres
filer, og en samlet kjøring tar under ti minutter.

### Områdene

1. **Vurdering og poenggiving** — `src/modules/assessment/`, `src/modules/submission/`, `CertificationStatus`
2. **Modul- og innholdslivssyklus** — `src/modules/adminContent/`, publiseringsgater, `contentLifecycle.ts`
3. **Autorisasjon, roller, eierskap** — `src/auth/`, `contentOwnershipService.ts`, rollesjekker i `src/routes/`
4. **Varsling, rapport og kull** — påminnelser, `cohortStatusService.ts`, `courseReport.ts`, outbox
5. **Frontend-tilstand** — `public/participant.js`, `admin-content-*.js`, CSS-en i `participant.html`
6. **Lokalisering på tvers** — begge lag, `#892`-invarianten, nn-tabellene

### De seks mønstrene

Rekkefølgen er prioriteringen. Hvert mønster har et bevis fra første kjøring — ta dem med i
prompten, de gjør instruksen konkret i stedet for abstrakt.

| # | Mønster | Beviset fra 2026-08-21 |
|---|---|---|
| 1 | **Divergerende definisjoner** — samme spørsmål besvart flere steder med ulike regler | Porten filtrerer arkiverte seksjoner, kurskortet gjør det ikke (#938) |
| 2 | **Ueid policy** — aksessor som returnerer alt og overlater filtreringen til kallerne | `findCourseItems` henter `archivedAt` og filtrerer ingenting — 8 kallere, 5 regler |
| 3 | **Lag på lag** — en fiks oppå en fiks | `markFinalSectionReadSilently` som nødløsning for en manglende knapp |
| 4 | **Redundante eller unåbare vakter** | Tre innganger til bevisporten, hvorav en sveip begrunnet med at hendelsene «can miss» |
| 5 | **Servertekst vist rått** | 40+ kallere dumper hele JSON-kroppen i grensesnittet |
| 6 | **Løfter som ikke holdes** — kommentar eller felt som lover noe koden ikke gjør | `wrapped`-feltet som ble satt og aldri lest |

### Kravet til hvert funn

- **fil:linje for HVERT sted regelen er implementert.** «Dette finnes flere steder» uten liste er verdiløst
- **et konkret scenario** der uenigheten gir feil resultat for en bruker. Ingen funn uten dette
- **risiko** — høy / middels / lav

Maks 8 funn per område. Få og godt belagte slår mange svake.

## Etterarbeidet — dette er halve verdien

**1 · Verifiser de tyngste funnene selv.** Agentene leser koden, de kjører den ikke. Første kjøring
hadde ett funn som var feil: `EXPIRED` teller som bestått ble meldt som en bug, men er et bevisst
valg i #820. Det er en **udokumentert beslutning**, ikke en defekt — og forskjellen avgjør hva man
skal gjøre med den.

**2 · Skill defekt fra beslutning.** Alt som viser seg å være et valg hører hjemme i
`doc/DECISIONS.md`, ikke i en feilrapport.

**3 · Oppdater datoen og loggen over.** Det er «resetten»: uten den vet ingen når neste forfaller,
og uten funn-tallet finnes ingen trend.

## Når den forfaller

`scripts/ai-qa.ps1` leser datoen over og sier fra når skanningen er over en måned gammel. Den
**blokkerer ikke** — en forfalt skanning er ikke en grunn til å stoppe en deploy, bare til å vite det.

Porten kjøres uansett foran hver stage-deploy, så påminnelsen kommer der man allerede ser etter.
Det er med vilje: en rutine som krever sin egen rituelle sjekk blir ikke utført.
