# Designnotat: når «det er ikke nok her» skal vinne over «et menneske bør se på den» (#1048)

Skrevet før endringen, etter regel 1 i `CHANGE_DESIGN_RULES.md`.

## Målt problem

78 ekte vurderinger på stage 2026-09-05:

| | |
|---|---|
| Modellen ba om menneskelig vurdering | **21 av 78 (27 %)** |
| Av disse som nådde en sensor | **0** |
| Alle 21 endte som | `AUTO_FAIL_INSUFFICIENT_EVIDENCE` |

Overstyringen skjer ett sted, `decisionService.ts:181`:

```ts
(llmRecommendsManualReview && !autoFailForInsufficientEvidence) || …
```

Modellens anmodning honoreres, med mindre auto-stryk slår til. Og auto-stryk slår til hver gang
besvarelsen både stryker på terskel og bærer signalet «utilstrekkelig grunnlag».

## Produkteiers regel

> Oppgaver til fritekstbesvarelser inneholder ofte et krav eller råd om lengde. Er lengden på
> besvarelsen **vesentlig under** minimum for denne, lar vi «det er ikke nok her» vinne. Hvis ikke,
> lar vi «et menneske bør se på den» vinne.
>
> ⚠️ I noen sammenhenger kan korte besvarelser være ønskelig, og vi må være forsiktige med å ikke
> legge opp til automatisk stryk for det.

Lest presist snur den bevisbyrden: **mennesket vinner som hovedregel**, og automatisk stryk er
unntaket som må begrunnes med et målbart faktum.

## ⚠️ Endringen kan bare gå én vei

Den nye betingelsen er den gamle **OG** «vesentlig for kort»:

```
autoFail = (som før) && vesentligForKort
```

En `&&` kan bare gjøre mengden mindre. Uansett hva en forfatter setter som minimum, kan resultatet
aldri bli strengere enn i dag — bare mildere. Derfor trenger denne endringen **ingen egen
aktivering**, i motsetning til bekymringen i #1049: der handlet den om at et omfangstall kunne
stramme vurderingen ved et uhell, og det kan det ikke her.

## Hva vi måler mot

Alt finnes allerede der vedtaket forberedes (`assessmentJobService`):

- **Svarets lengde** — `extractAnswerText` brukes tre linjer unna, til innholdslikhet.
- **Forventet minimum** — `module.scopeMinWords` (#1049), ellers nivåets standard fra `LEVEL_SCOPE`.

⚠️ **Kan vi ikke måle, vinner mennesket.** Har modulen verken eget omfang eller et gjenkjennelig
nivå, finnes ikke faktumet som skal begrunne unntaket. Da står hovedregelen. Det er den ærlige
lesningen av regelen, og den er i kandidatens favør.

⚠️ **«Vesentlig under» er en andel, ikke et fast tall,** og den står i regelfila. En besvarelse på
40 ord der 100 var ventet er noe annet enn 280 der 300 var ventet. Startverdi 0,5 — under halvparten
av forventet minimum. Den kan justeres uten kodeendring når vi har sett tall fra prod.

## Hva vi IKKE gjør

**Vi rører ikke terskelen.** En besvarelse som stryker på poeng, stryker fortsatt. Endringen handler
bare om HVEM som avgjør det: en maskin alene, eller et menneske som ser på saken.

**Vi rører ikke `hasInsufficientEvidenceSignal`.** Den brukes tre steder (#1026), og de to andre
skal fortsatt oppføre seg som før.

## ⚠️ Overlevert fra #1023

En besvarelse som bærer signalet returnerer tidlig fra `evaluateSecondaryAssessmentTrigger` og får
**aldri** den grensebaserte andrevurderingen — og det er nettopp populasjonen nær stryk-grensen.
Denne saken løser ikke det. Den bør vurderes når vi ser tallene fra regelen over.

## Hva integrasjonssuiten avslørte

To ting som ikke var synlige i enhetstestene.

### 1. Regelen gjaldt for bredt

Første utgave slo av auto-stryk hver gang svaret ikke var målbart for kort — også når modellen
**ikke** hadde bedt om et menneske. Seks policy-tester gikk fra `COMPLETED` til `UNDER_REVIEW`.

Saken handler om en **konflikt**: modellen sier «det er ikke nok her» og «et menneske bør se på
den» samtidig, og vi hørte bare det første. Sier den bare det første, finnes ingen anmodning å
overstyre. Betingelsen ble derfor snevret inn til `(!llmRecommendsManualReview || vesentligForKort)`.

### 2. «Kan ikke måle» er normalen, ikke unntaket

`LEVEL_SCOPE` kjenner `basic` / `intermediate` / `advanced`. Seed-modulene sto som `"foundation"` —
en levning fra da nivået var et fritekstfelt, og fortsatt den vanligste verdien i testsuiten.

Seed-dataen er rettet, fordi den framstilte en modul produktet ikke kan lage.

⚠️ **Men for ekte moduler er dette ikke en feil som skal rettes.** `admin-content-shell.js` bevarer
nivåtekst utenfor skalaen med vilje, og importerte moduler bærer hva de bærer. For dem finnes
ingen forventet lengde — og da er «et menneske avgjør» det riktige svaret: har ingen sagt hvor langt
svaret skulle være, kan vi ikke stryke noen for å ha skrevet kort.

**Konsekvensen å følge med på:** frem til forfattere tar i bruk omfangsfeltet fra #1049, går
insufficiency-saker på slike moduler til sensor i stedet for automatisk stryk. På stage var det
21 av 78 vurderinger — og alle 21 ble tidligere strøket uten at et menneske så dem. Det er nettopp
det saken ble åpnet for, men volumet bør måles etter deploy.
