# Content generation benchmark (#376)

`src/scripts/runContentGenerationBenchmark.ts` benchmarks the *generation*
flow — module drafts + MCQ sets — across multiple Azure OpenAI deployments,
certification levels, and generation modes. Counterpart to
`runModelComparisonBenchmark.ts`, which benchmarks the *assessment* flow.

## When to run

- Before switching the authoring deployment (e.g. moving from `gpt-4o` to a
  smaller / newer / reasoning model).
- After substantive prompt changes (`buildModuleDraftPrompts` /
  `buildMcqGenerationPrompts`) to surface regressions in question quality
  or scenario complexity.
- When a calibration argument needs empirical backing — e.g. claiming
  "model X produces weaker distractors than model Y."

This is an operator-run tool, not part of CI. Each run hits the live Azure
OpenAI API and costs money proportional to the number of total runs.

## Prerequisites

The script reads the standard authoring env vars:

- `AZURE_OPENAI_ENDPOINT` — required
- `AZURE_OPENAI_API_KEY` — required
- `AZURE_OPENAI_API_VERSION` — defaults to the codebase setting
- `LLM_MODE=azure_openai` — required

The deployments under test are passed via `--deployments` and override
`AZURE_OPENAI_AUTHORING_DEPLOYMENT` per iteration.

## Usage

```powershell
npm run benchmark:content -- `
  --deployments=full:gpt-4o,mini:gpt-4o-mini `
  --levels=basic,intermediate,advanced `
  --modes=thorough `
  --repeats=3 `
  --questions=5 `
  --options=4 `
  --output=benchmark-results/content
```

Flags:

| Flag | Default | Notes |
|---|---|---|
| `--deployments=label:dep[,label:dep,...]` | (required) | Deployment names exactly as configured in Azure OpenAI. Labels are how they appear in the report. |
| `--levels=basic,intermediate,advanced` | all three | Comma-separated. |
| `--modes=ordinary,thorough` | `thorough` | The `ordinary` mode was deprecated in v1.1.54; kept here for back-compat. |
| `--repeats=N` | `3` | Repeats per (deployment × level × mode × case) combination. |
| `--questions=N` | `5` | MCQ questions per set. |
| `--options=N` | `4` | Options per question (2–6). |
| `--cases=id1,id2` | all fixtures | Restrict to specific source-material fixtures. See `CASES` in the script. |
| `--output=basepath` | `benchmark-results/content` | Without extension; produces `<base>-YYYYMMDD.jsonl` (raw) and `<base>-YYYYMMDD.md` (report). |

## Source-material corpus

Fixtures live inline in `CASES` at the top of the script. Keep the corpus
small (2–4 entries) and committed so benchmark runs are repeatable. Adding
or modifying a case will change historical comparison — note any change in
the PR.

## Output

### JSONL (raw)

One record per generation run. Useful for ad-hoc aggregation in jq/Python:

```json
{
  "round": 1,
  "modelLabel": "full",
  "deployment": "gpt-4o",
  "caseId": "labour-rights",
  "level": "intermediate",
  "mode": "thorough",
  "questionCount": 5,
  "optionCount": 4,
  "scenario": {
    "taskWordCount": 124,
    "taskSentenceCount": 7,
    "constraintsWordCount": 38,
    "assessorWordCount": 95,
    "constraintsExceedsCeiling": false
  },
  "mcq": {
    "actualQuestionCount": 5,
    "questionCountMatch": true,
    "eliminationRiskHigh": 0,
    "eliminationRiskMedium": 1,
    "eliminationRiskLow": 4,
    "distractorMetadataCompletePct": 95
  },
  "scenarioLatencyMs": 4120,
  "mcqLatencyMs": 12450
}
```

### Markdown report

Aggregated per `(model, level, mode)` combination. Two tables: one for
scenario metrics, one for MCQ metrics. The "How to read these numbers"
section at the bottom of the report explains what each column means and
which thresholds matter.

## Interpreting the numbers

Key signals:

| Metric | What it tells you | Pay attention when |
|---|---|---|
| Avg task words / sentences (per level) | Does the model differentiate `basic` from `advanced`? | Advanced scenario is shorter than basic, or all levels collapse to same length. |
| Constraints > 80 words | Constraints box is leaking answer-outline | `> 0%`. `validateModuleDraft` warns on this at publish. |
| Q-count match | LLM honours the requested `questionCount` | `< 95%`. Some models systematically over- or under-produce. |
| EliminationRisk:high | LLM produces distractors that can be eliminated without domain reasoning | `> 0%`. `validateMcqDistractors` blocks publish on `high`. |
| EliminationRisk:medium | Soft signal of weak distractors | `> 30% sustained`. Combined with low metadata completeness, indicates the model is gaming the format. |
| Distractor metadata complete | Model produced the full `whyTempting/whyWrongUnderStem/wouldBeCorrectIf` triple | `< 80%`. Lower means the model is abbreviating, which weakens the quality gate. |

A useful single test: run with `--levels=basic,advanced --modes=thorough
--repeats=5` on two candidate deployments. If avg task words differ by
less than 30% between basic and advanced for both models, calibration is
broken at the prompt or model level — not a model-choice problem.

## Follow-up (not implemented yet)

The first version captures structural metrics that can be derived
deterministically from the LLM output. The deeper quality dimensions in
#368's root-cause analysis need separate LLM-judge calls and are
intentionally out of scope for this MVP:

- **LLM-judge plausibility rating per distractor** — needs an evaluator
  prompt + one extra LLM call per question. Adds ~$0.005–0.02 per
  question depending on judge model.
- **Cognitive-level distribution** (recall / understanding / application /
  analysis) per question — needs an LLM tag pass.
- **Simulated-candidate solve rate without source material** — needs a
  second LLM call per question with source hidden, comparing answer
  selection rates across models.
- **Per-call cost estimation** — needs token-usage extraction from the
  Azure OpenAI response payload (currently `callLlm` discards it).

These could be added as `--with-judge`, `--with-cognitive-tag`,
`--with-solve-rate`, `--with-token-usage` flags on top of the current
script. Filed informally; not blocking #368 close.

## Repeatability

Each run mutates `process.env.AZURE_OPENAI_AUTHORING_DEPLOYMENT` and
restores it after the call. Running the script multiple times against the
same fixtures should produce statistically similar results subject to LLM
non-determinism (temperature defaults to `AZURE_OPENAI_AUTHORING_
TEMPERATURE ?? 0.4`).

For maximum reproducibility, set `AZURE_OPENAI_AUTHORING_TEMPERATURE=0`
before running. This minimises but does not eliminate output drift.
