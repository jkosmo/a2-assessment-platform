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

### Accuracy

| Case | Expected | chat correct | mini correct | nano correct |
|---|---|---|---|---|
| yellow_sensitive_data | UNDER_REVIEW | 20/20 ✓ | 20/20 ✓ | 20/20 ✓ |
| green_clear_pass | PASS | 0/20 ✗ | 0/20 ✗ | 0/20 ✗ |
| snasa_nb_pass | PASS | 20/20 ✓ | 20/20 ✓ | 20/20 ✓ |

**green_clear_pass failure is a test case defect, not a model defect.** The case uses the generic development module (`seed_module_genai_foundations`) with placeholder task text. The LLM has no domain context against which to score the submission, so all models consistently give a rubric total of 6–14 (out of an unknown max) with no pass threshold reached. The `snasa_nb_pass` result (20/20 across all models) confirms that all three models classify correctly when given real module context.

### Red flags

Red flags are evaluated independently of rubric total and drive UNDER_REVIEW routing.

| Red flag | chat (20 rounds) | mini (20 rounds) | nano (20 rounds) |
|---|---|---|---|
| `responsible_use_violation:high` | 20/20 | 20/20 | 20/20 |
| `potential_sensitive_data:high` | 19/20 | 16/20 | 0/20 |

**Gap: nano does not fire `potential_sensitive_data:high`.** For the yellow_sensitive_data case the final routing is still UNDER_REVIEW (driven by `responsible_use_violation:high`), so routing correctness is unaffected in this benchmark. However, on a case where `responsible_use_violation` is absent and only `potential_sensitive_data` is present, nano would route differently than chat/mini. This is a risk that should be evaluated before switching to nano in production.

### Latency

Average latency across all three cases:

| Model | Avg latency |
|---|---|
| chat | ~21 s |
| mini | ~6.5 s |
| nano | ~5.5 s |

nano is ~4× faster than chat. mini and nano are comparable, with nano ~15% faster.

### Criterion rationale analysis — yellow_sensitive_data

Models across all three versions consistently noted the same gaps in the submission:

1. **No reflection on the mistake.** The submission describes what happened but does not acknowledge it as a problem or show awareness of data protection obligations.
2. **No mitigation steps.** The submitter does not describe what should have been done differently (e.g., masking PII, using approved sharing channels, obtaining consent).
3. **No risk assessment.** There is no mention of the potential harm to the individuals whose data was exposed.
4. **No compliance reference.** GDPR / data protection policies are not mentioned.

These rationales were stable across all 20 rounds and all three models — indicating a reliable signal, not noise.

### Criterion rationale analysis — snasa_nb_pass

All models gave high rubric scores (14–16) and PASS outcomes. Common rationales for minor point deductions:

1. **List-like structure rather than flowing prose.** The response reads as a bullet-point summary rather than a coherent paragraph for a general audience.
2. **Slightly over-reliant on place names without explanation.** References to Samien Siltje and Sørsamisk skole without context assume reader familiarity.
3. **Minor language inconsistencies.** Mix of formal and informal register in a couple of sentences.

These are minor quality observations; the submission correctly passes.

## Recommendation

**Switch the production assessment deployment from chat to nano.**

Rationale:
- **chat retires 2026-06-03.** A forced switch is coming regardless; switching proactively avoids a time-pressured migration.
- **Accuracy is equivalent on real cases.** snasa_nb_pass shows 20/20 PASS for all three models with comparable rubric scores (nano avg 15.9 vs chat avg 15.2). Routing decisions are identical.
- **Latency improves 4×.** nano averages ~5.5 s vs chat's ~21 s. This directly reduces submission wait time.
- **mini offers no meaningful advantage over nano.** mini is marginally slower than nano (~18%) with similar accuracy; there is no reason to prefer it.

**Caveat — sensitive data detection gap must be verified before go-live.**
nano fired `potential_sensitive_data:high` 0/20 times vs chat's 19/20 on the yellow_sensitive_data case. The yellow case still routed to UNDER_REVIEW via `responsible_use_violation`, so this benchmark shows no routing regression. However, the flag gap is unexplained. Before switching production:

1. Add a case where `potential_sensitive_data` is the *only* red flag present (no `responsible_use_violation`) and verify nano fires it.
2. Review the system prompt: if sensitive data detection instructions are embedded in a section that uses temperature-sensitive formatting, nano's deterministic (temperature-not-supported) path may interpret them differently.
3. If the gap persists, consider reinforcing the system prompt's sensitive-data detection instructions.

**If the above verification passes:** deploy nano to staging, run the existing batch benchmark, and promote to production.
