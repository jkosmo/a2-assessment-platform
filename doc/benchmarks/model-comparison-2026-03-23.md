# Model Comparison Benchmark — 2026-03-23

## Configuration

| Parameter | Value |
|---|---|
| Date | 2026-03-23 |
| Rounds per model per case | 20 |
| Iteration order | Interleaved (full → mini → nano per round) |
| Temperature | 0 |
| Max output tokens | 1200 |

**Models:**

- chat: `a2-assessment-stage-gpt-5.3-chat`
- mini: `a2-assessment-stage-gpt-5.4-mini`
- nano: `a-2-assessment-stage-gpt-5.4-nano`

**Cases:**

- `yellow_sensitive_data` — expected: UNDER_REVIEW — Sensitive-data handling case should go to manual review.
- `green_clear_pass` — expected: PASS — Substantive, well-structured submission should pass.
- `bourdieu_nb_pass` — expected: PASS — Real nb Bourdieu submission that received automatic PASS in staging (totalScore 91.43). Strong analytical response with habitus, capital, field and distinction correctly applied.
- `snasa_nb_pass` — expected: PASS — Real nb submission about Snåsa that received automatic PASS in staging (totalScore 89.71).

## Case: yellow_sensitive_data

**Expected outcome:** UNDER_REVIEW
**Description:** Sensitive-data handling case should go to manual review.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 0 | 20 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 0 | 20 | 0 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 0 | 0 | 20 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 7.0 | 1.3 | 4 | 9 |
| mini | 13.3 | 2.0 | 11 | 17 |
| nano | 11.6 | 2.1 | 5 | 14 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 28667 | 5432 | 18400 | 37935 |
| mini | 10256 | 1407 | 5994 | 13669 |
| nano | 14156 | 2862 | 9032 | 19871 |

## Case: green_clear_pass

**Expected outcome:** PASS
**Description:** Substantive, well-structured submission should pass.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 20 | 0 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 20 | 0 | 0 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 0 | 20 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 8.1 | 0.2 | 8 | 9 |
| mini | 9.7 | 0.7 | 8 | 10 |
| nano | 8.8 | 0.4 | 8 | 9 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 20992 | 3330 | 15765 | 26194 |
| mini | 9093 | 1059 | 6599 | 11123 |
| nano | 11597 | 2681 | 6284 | 16563 |

## Case: bourdieu_nb_pass

**Expected outcome:** PASS
**Description:** Real nb Bourdieu submission that received automatic PASS in staging (totalScore 91.43). Strong analytical response with habitus, capital, field and distinction correctly applied.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 12 | 8 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 19 | 0 | 1 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 2 | 13 | 5 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 7.3 | 1.0 | 6 | 9 |
| mini | 9.0 | 0.0 | 9 | 9 |
| nano | 9.1 | 0.4 | 8 | 10 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 20211 | 3259 | 14134 | 25375 |
| mini | 8098 | 1270 | 6430 | 11632 |
| nano | 12560 | 3504 | 5737 | 20882 |

## Case: snasa_nb_pass

**Expected outcome:** PASS
**Description:** Real nb submission about Snåsa that received automatic PASS in staging (totalScore 89.71).

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 20 | 0 | 0 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 20 | 0 | 0 | 0 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 20 | 0 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 15.2 | 0.4 | 15 | 16 |
| mini | 15.0 | 0.0 | 15 | 15 |
| nano | 14.5 | 0.9 | 13 | 16 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 21457 | 4327 | 14727 | 30180 |
| mini | 10133 | 1371 | 7950 | 13405 |
| nano | 14047 | 3716 | 7171 | 22414 |

## Findings

_To be filled in after reviewing results._

## Recommendation

_Go/no-go decision on switching deployment, with rationale._
