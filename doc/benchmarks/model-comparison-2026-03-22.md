# Model Comparison Benchmark — 2026-03-22

## Configuration

| Parameter | Value |
|---|---|
| Date | 2026-03-22 |
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
| chat | 6.5 | 0.8 | 4 | 7 |
| mini | 13.8 | 0.4 | 13 | 14 |
| nano | 5.2 | 0.4 | 5 | 6 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 24553 | 3969 | 16645 | 31286 |
| mini | 6458 | 936 | 5299 | 8168 |
| nano | 5687 | 676 | 4568 | 6931 |

## Case: green_clear_pass

**Expected outcome:** PASS
**Description:** Substantive, well-structured submission should pass.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 20 | 0 | 0 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 7 | 13 | 0 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 0 | 20 | 0 | 0 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 7.6 | 0.8 | 6 | 8 |
| mini | 10.6 | 1.3 | 7 | 12 |
| nano | 9.0 | 0.0 | 9 | 9 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 19696 | 3196 | 13105 | 23743 |
| mini | 6112 | 988 | 5081 | 8536 |
| nano | 5335 | 1218 | 3971 | 9415 |

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
| mini | 14.9 | 0.2 | 14 | 15 |
| nano | 15.9 | 0.2 | 15 | 16 |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | 19117 | 3466 | 13197 | 25422 |
| mini | 6878 | 1138 | 4542 | 9975 |
| nano | 5466 | 595 | 4503 | 6707 |

## Findings

_To be filled in after reviewing results._

## Recommendation

_Go/no-go decision on switching deployment, with rationale._
