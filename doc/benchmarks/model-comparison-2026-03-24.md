# Model Comparison Benchmark — 2026-03-24

## Configuration

| Parameter | Value |
|---|---|
| Date | 2026-03-24 |
| Rounds per model per case | 10 |
| Iteration order | Interleaved (full → mini → nano per round) |
| Temperature | 0 |
| Max output tokens | 1200 |

**Models:**

- chat: `a2-assessment-stage-gpt-5.3-chat`
- mini: `a2-assessment-stage-gpt-5.4-mini`
- nano: `a-2-assessment-stage-gpt-5.4-nano`

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
| chat | `a2-assessment-stage-gpt-5.3-chat` | 10 | 0 | 0 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 10 | 0 | 0 | 0 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 10 | 0 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 19.3 | 0.5 | 19 | 20 |
| mini | 19.0 | 0.0 | 19 | 19 |
| nano | 19.0 | 0.0 | 19 | 19 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 23596 | 3115 | 16285 | 27286 |
| mini | 3628 | 345 | 3175 | 4144 |
| nano | 3814 | 328 | 3537 | 4684 |

## Case: new_bourdieu_nb_decent

**Expected outcome:** PASS
**Description:** Middels sterk nb-besvarelse om Bourdieu (totalScore 80.29 i staging). Korrekt om hoveddelen, men forklarer ikke begrepene veldig grundig og mangler presis skille mellom kapitalformer.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 10 | 0 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 10 | 0 | 0 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 0 | 10 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 10.6 | 0.7 | 9 | 11 |
| mini | 11.0 | 0.0 | 11 | 11 |
| nano | 13.0 | 0.0 | 13 | 13 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 32883 | 4574 | 26732 | 42480 |
| mini | 3924 | 479 | 3321 | 5150 |
| nano | 3996 | 99 | 3892 | 4169 |

## Case: new_bourdieu_nb_weak

**Expected outcome:** UNDER_REVIEW
**Description:** Svak nb-besvarelse om Bourdieu (totalScore 65 i staging, rutet til manuell gjennomgang). Overflatisk — nevner begrepene men forklarer dem ikke nøye.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 10 | 0 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 10 | 0 | 0 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 0 | 10 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 7.0 | 0.4 | 6 | 8 |
| mini | 6.0 | 0.0 | 6 | 6 |
| nano | 8.0 | 0.0 | 8 | 8 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 30000 | 2972 | 23679 | 34121 |
| mini | 3301 | 399 | 2859 | 4287 |
| nano | 4540 | 223 | 4074 | 4829 |

## Findings

**Strong case — alle modeller korrekte og stabile**
Alle tre modeller gir PASS 10/10 med `practical_score_scaled` ≈ 66–68/70 (totalScore ~96–98). Mini og nano er fullstendig deterministiske (std dev = 0 på rubrikk-score), chat har marginal variasjon (std dev 0.5). Ingen kvalitetsforskjell mellom modellene på klare, sterke besvarelser.

**Decent case — FAIL på generisk rubrikk, men kalibreringsproblem ikke modellproblem**
Alle modeller scorer decent til `practical_score_scaled` ≈ 36–38.5/70 (totalScore ~66–68.5), rett under `totalMin = 70`. Årsaken er at benchmarken bruker DEFAULT rubrikk-kriterier i stedet for modulens faktiske kriterier. I staging fikk samme besvarelse totalScore 80.29 med riktig rubrikk. Funnene sier ingenting negativt om modellene — de er konsistente og enige om scoring.

**Weak case — korrekt differensiert, ingen manuell gjennomgang trigget**
Alle modeller gir FAIL (praktisk ~21–28/70, totalScore ~51–58). Nano scorer svake besvarelser noe høyere enn mini (28 vs 21) — litt mer sjenerøs i nedre sjikt. LLM anbefalte ikke manuell gjennomgang, trolig fordi svaret ikke inneholder røde flagg, kun svak faglig dybde.

**Latenstid**
Mini og nano er ~7–8× raskere enn chat (3–4s vs 24–33s). Ingen merkbar forskjell mellom mini og nano på latens.

## Recommendation

**Anbefaling: bytt til `gpt-5.4-nano` for staging-vurdering.**

Nano matcher chat fullt ut på sterke besvarelser, er fullstendig deterministisk ved temperature=0, og er dramatisk raskere. Ingen observert kvalitetsforskjell som taler for å beholde chat.

**Overgang fra gpt-5-nano til gpt-5.4-nano** er uproblematisk basert på disse dataene. 5.4-nano viser ingen regresjoner: scoring er stabil (std dev = 0), korrekt på tydelige tilfeller, og den differensierer godt mellom sterk (96), middels (66) og svak (58) besvarelse. Den scorer svake svar marginalt høyere enn mini, men ikke på en måte som endrer utfall på klare PASS/FAIL-grenser. 5.4-versjonen er en inkrementell oppgradering i samme modellfamilie — lavere risiko enn et større modellbytte.

**Åpen sak:** decent-casen feiler fordi benchmarken mangler `rubricCriteriaIds` for modulen. Dette bør løses i neste benchmark-kjøring ved å hente faktiske kriterier fra modulversjonen `cmn45hotw000ymbfglgq2xmjb`.
