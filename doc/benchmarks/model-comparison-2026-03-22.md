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

## Case: yellow_sensitive_data

**Expected outcome:** UNDER_REVIEW
**Description:** Sensitive-data handling case should go to manual review.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 0 | 0 | 20 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 0 | 0 | 20 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 0 | 0 | 0 | 20 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | — | — | — | — |
| mini | — | — | — | — |
| nano | — | — | — | — |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | — | — | — | — |
| mini | — | — | — | — |
| nano | — | — | — | — |

## Case: green_clear_pass

**Expected outcome:** PASS
**Description:** Substantive, well-structured submission should pass.

### Outcome distribution

| Model | Deployment | PASS | FAIL | UNDER_REVIEW | Errors |
|---|---|---|---|---|---|
| chat | `a2-assessment-stage-gpt-5.3-chat` | 0 | 0 | 0 | 20 |
| mini | `a2-assessment-stage-gpt-5.4-mini` | 0 | 0 | 0 | 20 |
| nano | `a-2-assessment-stage-gpt-5.4-nano` | 0 | 0 | 0 | 20 |

### Score (rubric_total)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | — | — | — | — |
| mini | — | — | — | — |
| nano | — | — | — | — |

### Latency (ms)

| Model | Avg | Std dev | Min | Max |
|---|---|---|---|---|
| chat | — | — | — | — |
| mini | — | — | — | — |
| nano | — | — | — | — |

## Findings

_To be filled in after reviewing results._

## Recommendation

_Go/no-go decision on switching deployment, with rationale._
