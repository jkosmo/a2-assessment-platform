# Model Comparison Benchmark — 2026-10-11

## Configuration

| Parameter | Value |
|---|---|
| Date | 2026-10-11 |
| Rounds per model per case | 10 |
| Iteration order | Interleaved (full → mini → nano per round) |
| Temperature | 0 |
| Max output tokens | 1200 |

**Models:**

- gpt41mini: `a2-assessment-stg-gpt-4.1-mini`
- mini54: `a2-assessment-stg-gpt-5.4-mini`
- nano54: `a2-assessment-stg-gpt-5.4-nano`

**Cases:**

- `new_bourdieu_nb_strong` — expected: PASS — Sterk nb-besvarelse om Bourdieu (totalScore 91.43 i staging). Detaljert definisjon av habitus, felt, doxa, kapital og symbolsk vold med konkret anvendelse på utdanningssystemet.
- `new_bourdieu_nb_decent` — expected: PASS — Middels sterk nb-besvarelse om Bourdieu (totalScore 80.29 i staging). Korrekt om hoveddelen, men forklarer ikke begrepene veldig grundig og mangler presis skille mellom kapitalformer.
- `new_bourdieu_nb_weak` — expected: UNDER_REVIEW — Svak nb-besvarelse om Bourdieu (totalScore 65 i staging, rutet til manuell gjennomgang). Overflatisk — nevner begrepene men forklarer dem ikke nøye.

## Case: new_bourdieu_nb_strong

**Expected outcome:** PASS
**Description:** Sterk nb-besvarelse om Bourdieu (totalScore 91.43 i staging). Detaljert definisjon av habitus, felt, doxa, kapital og symbolsk vold med konkret anvendelse på utdanningssystemet.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| gpt41mini | `a2-assessment-stg-gpt-4.1-mini` | 10 | 0 | 0 | 0 |
| mini54 | `a2-assessment-stg-gpt-5.4-mini` | 10 | 0 | 0 | 0 |
| nano54 | `a2-assessment-stg-gpt-5.4-nano` | 10 | 0 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| gpt41mini | 19.0 | 0.0 | 19 | 19 |
| mini54 | 19.0 | 0.0 | 19 | 19 |
| nano54 | 19.0 | 0.0 | 19 | 19 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| gpt41mini | 7166 | 1099 | 5987 | 9855 |
| mini54 | 3996 | 1392 | 2853 | 7801 |
| nano54 | 5499 | 1021 | 4304 | 8016 |

## Case: new_bourdieu_nb_decent

**Expected outcome:** PASS
**Description:** Middels sterk nb-besvarelse om Bourdieu (totalScore 80.29 i staging). Korrekt om hoveddelen, men forklarer ikke begrepene veldig grundig og mangler presis skille mellom kapitalformer.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| gpt41mini | `a2-assessment-stg-gpt-4.1-mini` | 0 | 5 | 5 | 0 |
| mini54 | `a2-assessment-stg-gpt-5.4-mini` | 0 | 0 | 10 | 0 |
| nano54 | `a2-assessment-stg-gpt-5.4-nano` | 10 | 0 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| gpt41mini | 8.9 | 1.1 | 7 | 10 |
| mini54 | 11.0 | 0.0 | 11 | 11 |
| nano54 | 12.0 | 0.0 | 12 | 12 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| gpt41mini | 6820 | 1078 | 5725 | 9566 |
| mini54 | 4216 | 1193 | 2906 | 6072 |
| nano54 | 7443 | 1127 | 6287 | 10385 |

## Case: new_bourdieu_nb_weak

**Expected outcome:** UNDER_REVIEW
**Description:** Svak nb-besvarelse om Bourdieu (totalScore 65 i staging, rutet til manuell gjennomgang). Overflatisk — nevner begrepene men forklarer dem ikke nøye.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| gpt41mini | `a2-assessment-stg-gpt-4.1-mini` | 0 | 10 | 0 | 0 |
| mini54 | `a2-assessment-stg-gpt-5.4-mini` | 0 | 10 | 0 | 0 |
| nano54 | `a2-assessment-stg-gpt-5.4-nano` | 0 | 2 | 8 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| gpt41mini | 7.0 | 0.0 | 7 | 7 |
| mini54 | 7.7 | 0.5 | 7 | 8 |
| nano54 | 9.0 | 0.6 | 8 | 10 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| gpt41mini | 7815 | 1647 | 5656 | 10610 |
| mini54 | 3937 | 741 | 2944 | 5495 |
| nano54 | 6915 | 1069 | 5282 | 8341 |

## Findings

**Sterk besvarelse — alle tre riktige og identiske.** PASS 10/10 og samme rubrikkscore (19) i alle
modellene. 5.4-mini er raskest (4,0 s mot 7,2 s for 4.1-mini).

**Middels besvarelse — dagens modell er den ustabile.** gpt-4.1-mini vipper mellom FAIL og
UNDER_REVIEW (5/5) med score 7–10. 5.4-mini gir UNDER_REVIEW 10/10 med samme score hver gang (11).
5.4-nano gir PASS 10/10 (12). Forventet utfall er PASS, men det tallet kommer fra en kjøring med
modulens egne kriterier; benchmarken bruker fortsatt standardkriteriene (åpen sak fra mars), så
«middels» ligger nær grensa uansett modell. Det sikre funnet er at 4.1-mini ikke er konsistent her.

**Svak besvarelse — nano er den rause.** 4.1-mini og 5.4-mini gir FAIL 10/10 (7 og 7,7). 5.4-nano
gir UNDER_REVIEW 8/10 (9). Samme tendens som i mars: nano scorer svake besvarelser høyere.

**Determinisme:** 5.4-mini har null spredning på to av tre tilfeller og 0,5 på det tredje; 4.1-mini
har 1,1 på det midterste. **Latens:** 5.4-mini er 40–50 % raskere enn 4.1-mini; nano er ikke
raskere enn 4.1-mini i denne kjøringen.

## Recommendation

**Pek stage sin vurdering mot `a2-assessment-stg-gpt-5.4-mini`** (innstillingen
`AZURE_OPENAI_ASSESSMENT_DEPLOYMENT`), og se på ekte innleveringer i «Vurderingskvalitet» før prod.

Begrunnelse: 5.4-mini er den mest konsistente, den raskeste, og den feiler mot streng side (review
eller FAIL) der modellene er uenige — det er riktig retning for en vurderingsmotor med manuell
gjennomgang som sikkerhetsnett. Nano treffer «forventet utfall» på flest tilfeller, men er den
rause, og forventningen for middels-tilfellet er usikker (standardkriterier). Dagens gpt-4.1-mini
er den dårligste på konsistens og den tregeste.

**Åpen sak (fra mars, fortsatt):** gi benchmarken modulens faktiske kriterier (`rubricCriteriaIds`)
før prod-beslutningen, så middels-tilfellet måles mot det kurset faktisk krever.

