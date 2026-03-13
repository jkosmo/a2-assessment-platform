# Assessment Decision Policy

This document describes the current assessment decision policy as implemented in the application.

It is intended to answer one practical question:

When does a submission become automatic `PASS`, automatic `FAIL`, or `UNDER_REVIEW`?

This document is normative for the current implementation and should be kept aligned with:
- `src/services/assessmentJobService.ts`
- `src/services/decisionService.ts`
- `src/services/secondaryAssessmentService.ts`
- `config/assessment-rules.json`

## Scope

The policy covers the decision stage after a participant submission has:
- been created
- completed MCQ
- completed practical evaluation

It does not describe:
- manual review resolution policy
- appeal resolution policy
- certification validity policy after a final decision

## Inputs

The decision logic uses four main inputs:

1. Practical assessment result from the LLM
2. MCQ score
3. Manual-review signals
4. Policy thresholds from `config/assessment-rules.json`

### Practical assessment result

The LLM returns a structured result including:
- `rubric_total` from `0..20`
- `practical_score_scaled` from `0..70`
- `pass_fail_practical`
- `manual_review_recommended`
- `confidence_note`
- `red_flags`
- criterion rationales and improvement advice

### MCQ result

The MCQ pipeline returns:
- `mcqScaledScore` from `0..30`
- `mcqPercentScore` from `0..100`

### Policy thresholds

Current thresholds in [assessment-rules.json](C:/Users/JoakimKosmo/a2-assessment-platform/config/assessment-rules.json):
- total minimum for pass: `70`
- practical minimum percent for pass: `50`
- MCQ minimum percent for pass: `60`
- borderline window: `67..73`
- red-flag severities that force review: `high`

## Decision Sequence

The implementation follows this order:

1. Run primary practical assessment.
2. Persist the primary LLM evaluation.
3. Decide whether a secondary practical assessment should run.
4. If secondary runs, persist it and check for disagreement.
5. Build the final assessment decision from:
   - final practical result
   - MCQ result
   - thresholds
   - red flags
   - review triggers

The decision is created as an automatic decision record first.
If the result needs manual review, a manual review record is opened and submission status becomes `UNDER_REVIEW`.

## Secondary Assessment Policy

Secondary assessment is enabled by default.

It is triggered when the primary result indicates one or more of these:
- `manual_review_recommended = true`
- confidence note contains low/medium confidence patterns
- primary result contains medium/high red-flag severities according to secondary-assessment policy

Current trigger patterns from [assessment-rules.json](C:/Users/JoakimKosmo/a2-assessment-platform/config/assessment-rules.json):
- `medium confidence`
- `low confidence`
- red flag severities: `medium`, `high`

### Disagreement Rules

If secondary assessment runs, the system checks for disagreement between primary and secondary results.

Disagreement is currently defined as one or more of:
- practical score delta `>= 8`
- rubric total delta `>= 3`
- pass/fail mismatch
- mismatch on `manual_review_recommended`

If disagreement exists, the submission is forced to manual review with this reason:
- `Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.`

Exception:
- if both primary and secondary results are clearly insufficient-evidence fails
- and neither result contains red flags
- and both practical passes are `false`

then disagreement does **not** force manual review. In that case the submission continues through the normal automatic-fail logic.

## Automatic PASS

A submission becomes automatic `PASS` only if all of these are true:
- total score `>= 70`
- practical percent `>= 50`
- MCQ percent `>= 60`
- no open red flags at configured forcing severities
- no forced manual review reason
- not in the manual-review path

If these conditions are met:
- decision reason is `Automatic pass by threshold rules.`
- submission status becomes `COMPLETED`
- no manual review is opened

## Automatic FAIL

A submission becomes automatic `FAIL` in two main situations.

### 1. Regular threshold fail

If the submission does not pass thresholds and no review condition applies, it becomes automatic `FAIL`.

This gives:
- decision reason `Automatic fail by threshold rules.`
- submission status `COMPLETED`

### 2. Insufficient-evidence fail

The system now explicitly treats clearly non-substantive submissions as automatic `FAIL`.

This path applies when all of these are true:
- no forced manual review reason exists
- no high-severity red flag exists
- total score is not in the borderline window
- thresholds are not passed
- the submission looks insufficiently evidenced

The current implementation treats a submission as insufficiently evidenced if either:
- the LLM explicitly recommends manual review for an otherwise clearly failing submission, or
- the confidence/rationale/advice text contains patterns indicating minimal, placeholder, non-substantive, or incomplete evidence

Examples of such signals:
- minimal content
- non-substantive submission
- partial documentation
- placeholder content
- requires additional materials
- missing iteration / QA evidence

This gives:
- decision reason `Automatic fail due to insufficient submission evidence.`
- submission status `COMPLETED`

## Manual Review

A submission becomes `UNDER_REVIEW` only when one of the actual escalation rules applies.

Current manual-review triggers are:

1. Forced manual review reason exists
2. A configured high-severity red flag exists
3. Total score is in the borderline window `67..73`
4. `manual_review_recommended = true` and the submission is not already classified as a clear insufficient-evidence fail

This gives:
- decision reason `Automatically routed to manual review due to red flag / confidence / borderline rule.`
  or a more specific forced-review reason
- submission status `UNDER_REVIEW`
- a manual review record with status `OPEN`

## Red Flags

Red flags affect the decision in two ways:

1. They block automatic pass when they match configured forcing severities.
2. They can force manual review directly.

Current forcing severities from [assessment-rules.json](C:/Users/JoakimKosmo/a2-assessment-platform/config/assessment-rules.json):
- `high`

This means:
- medium red flags can still matter for secondary assessment
- high red flags are the main direct blocker in the final decision service

## Borderline Window

The borderline window is currently:
- `67` to `73` inclusive

If total score lands in this window, the submission is routed to manual review even if there are no red flags.

Purpose:
- reduce false positives and false negatives near the decision boundary

## Submission Status Outcomes

The resulting submission status is simple:

- `COMPLETED`
  when the decision is final and no manual review is required
- `UNDER_REVIEW`
  when a manual review record is opened

There is no direct appeal logic in this stage.

## Examples

### Example A: clear pass

- practical score high
- MCQ above threshold
- no red flags
- no disagreement

Outcome:
- automatic `PASS`

### Example B: clear weak but complete submission

- practical score low
- MCQ low
- no red flags
- not borderline

Outcome:
- automatic `FAIL`

### Example C: extremely weak / placeholder submission

- practical score low
- MCQ low
- no red flags
- low confidence because submission is minimal or non-substantive

Outcome:
- automatic `FAIL` due to insufficient submission evidence

### Example D: borderline score

- total score within `67..73`

Outcome:
- `UNDER_REVIEW`

### Example E: high red flag

- high-severity red flag present

Outcome:
- `UNDER_REVIEW`

### Example F: primary/secondary disagreement

- secondary assessment runs
- disagreement threshold is exceeded

Outcome:
- `UNDER_REVIEW`

### Example G: primary/secondary disagreement on two clearly insufficient fails

- primary says the submission is minimal / non-specific / requires resubmission
- secondary also says the submission is minimal / missing assessment artifacts
- both practical passes are `false`
- no red flags are present
- disagreement thresholds are still exceeded

Outcome:
- automatic `FAIL`
- no manual review opened

## Operational Notes

- The participant UI currently surfaces the final status, decision reason, confidence note, improvement advice, and criterion rationales.
- Manual review queue volume is directly affected by this policy.
- If the business wants fewer manual reviews, the most important levers are:
  - borderline window
  - red-flag thresholds
  - how much weight is given to `manual_review_recommended`

## Change Control

If this policy changes, update all of:
- [assessment-rules.json](C:/Users/JoakimKosmo/a2-assessment-platform/config/assessment-rules.json) when thresholds/patterns change
- [decisionService.ts](C:/Users/JoakimKosmo/a2-assessment-platform/src/services/decisionService.ts) when final routing changes
- [secondaryAssessmentService.ts](C:/Users/JoakimKosmo/a2-assessment-platform/src/services/secondaryAssessmentService.ts) when secondary-trigger/disagreement policy changes
- [ASSESSMENT_DECISION_POLICY.md](C:/Users/JoakimKosmo/a2-assessment-platform/doc/ASSESSMENT_DECISION_POLICY.md)
