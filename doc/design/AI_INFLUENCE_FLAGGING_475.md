# AI-influence flagging → UNDER_REVIEW + annotation — Technical Design (#475)

Status: **Phase 1 implemented (v2.8.0), shipped feature-flagged OFF + shadow-mode.** The non-technical
gates (§9) still gate *enabling* it in production. Builds on the discovery write-up in #475; grounded in
the actual assessment pipeline (file refs throughout).

## 0. Phase 1 as built (product-owner refinement, 2026-07-26)

Two product-owner decisions reshaped the signal model from the original draft below, and made Phase 1
both simpler and lower-risk:

1. **The frame is disengagement, not AI use.** AI use is *encouraged* (including declaring it); the
   problem is AI use where the participant is not actively involved, because that reduces learning. So we
   flag the *autonomous* case, and the first response is a **reflective nudge**, not a flag: on submit we
   invite the participant to go back and engage; only if they **insist** (and the signal is strong
   enough) does it route to review, with the reason "assumed too-autonomous AI use".
2. **Process telemetry is out.** Paste ratio is not a usable signal (a 500-word essay is naturally
   written in Word and pasted); by the same logic time-on-task and typing speed collapse too. So Phase 1
   captures **no** keystroke/paste/time telemetry. The real signals are **the declaration** and **the
   choice to submit after the nudge**. This removes most of the DPIA burden (§9) — we store only the
   aggregate declaration the participant volunteers.

**As built:** `Submission.processSignalsJson` (additive nullable) stores `{ declaration, declarationText?,
insistedAfterPrompt }`. `src/modules/assessment/aiInfluence.ts` evaluates it against the global
`aiInfluence` rules (`config/assessment-rules.json`) + per-module `ModuleAssessmentPolicy.aiInfluence`
override: it forces review only when **enabled && !shadowMode && declaration==="autonomous" &&
insistedAfterPrompt**. That flows into `resolveAssessmentDecision`'s `needsManualReview` OR-gate and
withholds `passFailTotal` (never touches the fail path). The client (`public/participant.js` +
`participant.html`) shows the declaration only when `participant/config.aiInfluence.enabled`, and the
reflective nudge only when live (not shadow). Reviewer sees the declaration via `manualReviewReadModels`.
Communication is kept off the main surface per the owner: info lives in profile/privacy + the reactive
nudge. The sections below are the original design; where they describe paste/keystroke signals (§2 Phase
1 "Process", §3 `pasteRatio`/`largestInsertionChars`/`secondsPerChar`, §7 telemetry listeners) they are
**superseded** by this section — those were not built.

## 1. Principle & guardrails (non-negotiable)

1. **A flag is a REVIEW TRIGGER, never a verdict or penalty.** High AI-influence routes a submission to
   **UNDER_REVIEW** (what #475 calls "YELLOW") — it never contributes to a FAIL and never auto-penalizes.
   A human decides.
2. **Transparency, not a black box.** The annotation shows *which* signals fired and their raw values
   (e.g. "78 % of the text arrived as 3 pastes; largest single insertion 2 140 chars; declared: no AI").
3. **No stylometry-only "AI detector."** Discredited, high false-positive, and biased against second-
   language and formally-writing students. We rely on **process signals + a student declaration**, not on
   guessing "does this read like a bot."
4. **Fairness gate before any production threshold** — the false-positive rate is measured on a pilot
   dataset first (§9). Thresholds are never set by guesswork.
5. **Feature-flagged OFF by default**, and rolled out in **shadow mode first** (compute + log, don't
   route) to gather that pilot data before it changes any student's outcome.

## 2. Signal model

| Phase | Signals | Confidence | Effort |
|---|---|---|---|
| **1 (start)** | **Process:** paste ratio, largest single insertion, time-on-task vs length · **Declaration:** the student states their AI use at submit | high signal / low effort | low |
| 2 | **Content:** cosine similarity between the answer and an LLM draft of the same prompt (we already have LLM access via the authoring model) — one *input*, not a rule | medium | medium |
| 3 | **Baseline:** stylometric drift vs the student's own history (needs accumulated submissions) | medium, long-horizon | high |

## 3. Scoring — `aiInfluenceScore` (transparent, component-based)

Phase-1 components (each stored + surfaced; the score is an explainable function of them, not an opaque
classifier):

- `pasteRatio` = pasted chars / total chars (0–1)
- `largestInsertionChars` = biggest single paste/insertion
- `secondsPerChar` = time-on-task / answer length (implausibly fast → suspicious)
- `declaration` = the student's answer to the AI-use question (`none` | `assist` | `heavy` | `undeclared`)

`aiInfluenceScore` is a weighted, capped combination with **per-component reasons**. Crossing the
threshold sets `forcesReview = true`. The reviewer sees the components, not just the score.

## 4. Data model (all additive / expand-safe — CLAUDE.md invariant #13)

- **`Submission.processSignalsJson String?`** (new nullable column) — raw client signals + the declaration.
  Not folded into `responseJson` (that's the answer payload, re-parsed by review read-models).
  *Store aggregates only, never full keystroke logs* (§9 DPIA).
- **`AssessmentDecision.aiInfluenceJson String?`** (new nullable column) — the computed `{score,
  components, forcesReview}`. A *dedicated* column, not the existing `redFlagsJson` (which is reserved for
  LLM-produced canonical red-flag codes via `assessmentRedFlagPolicy.ts`; a synthetic flag there would
  fight that path).

No new tables — both are 1:1 with existing rows, small fixed shape.

## 5. Decision-engine integration — `src/modules/assessment/decisionService.ts`

The routing lives in `resolveAssessmentDecision()` (pure, lines 53–167); `needsManualReview` (lines
128–133) is the OR-gate that produces UNDER_REVIEW. **Exact precedent to mirror: `borderlineWindow`
(#464)** — a policy sub-rule that forces UNDER_REVIEW even when thresholds pass.

- Add `aiInfluence?: { score, components, forcesReview }` to `BuildDecisionInput` (19–35) + the
  `ResolveAssessmentDecisionInput` `Pick` (48–51). Compute the score **upstream** (in the
  submission→decision path) and pass it in.
- Add a disjunct to `needsManualReview` (line 128): `|| Boolean(input.aiInfluence?.forcesReview)`.
- Extend `decisionReason` (141–152) with the ai-influence rationale so it flows into
  `ManualReview.triggerReason` (274) verbatim, as today.
- **Invariant:** `aiInfluence` feeds `needsManualReview` ONLY — never `autoFailForInsufficientEvidence`
  or the threshold gates. It can never turn a pass into a fail; only into a review.

## 6. Config / policy (author-configurable, default off)

- **Global defaults** — `src/config/assessmentRules.ts` `rulesSchema`: new `aiInfluence` block
  `{ enabled: false, pasteRatioMax, largestInsertionMax, minSecondsPerChar, scoreThreshold }`.
- **Per-module override** — `ModuleAssessmentPolicy.aiInfluence` (`src/codecs/assessmentPolicyCodec.ts`,
  stored on `ModuleVersion.assessmentPolicyJson`), mirroring `borderlineWindow`. A writing-practice module
  can set stricter thresholds than an application/case module — this encodes a *pedagogical policy*, so it
  belongs with the author, not hard-coded.

## 7. Client capture — `public/participant.js`

Greenfield telemetry on the `[data-field-id]` answer textareas (rendered ~585–643), accumulated into a
module-scoped counter and added to the POST body at the submit handler (2432–2447, alongside `responseJson`):

- `paste` listener → sum pasted length + track the largest single paste.
- `input`/`beforeinput` → keystroke count + timestamps (for burst detection) — **aggregate counters only,
  not the text**.
- focus/blur/first-keystroke → time-on-task.
- A **declaration field** at submit ("Har du brukt KI-verktøy i denne besvarelsen? Hvordan?") — required,
  stored, shown to the reviewer.

Also extend `createSubmissionSchema` (`src/routes/submissions.ts:15–23`) + `CreateSubmissionInput`
(submissionService/submissionRepository) to accept + persist `processSignals` + `declaration`. (Note:
today the client already sends `responsibilityAcknowledged` but the schema silently strips it — fix that
threading while here.)

**Honest limitation:** client telemetry is spoofable by a determined cheater. It is a *signal*, not proof
— fully consistent with "review trigger, not verdict." The declaration (a truthfulness question) and the
human reviewer carry the integrity weight; the signals just surface *what to look at*.

## 8. Reviewer surfacing — `public/review.js` + `manualReviewReadModels.ts`

Expose `aiInfluenceJson` + the declaration through `toManualReviewWorkspaceView()` (38–81) and render a
line in the review detail (near the `triggerReason`/`decisionReason` block, review.js 688–729): the score,
the component values, which crossed threshold, and the student's declaration. New i18n keys under
`manualReview.details.*`. The reviewer judges content **and** integrity and comments in the review.

## 9. Non-technical GATES — must clear before Phase-1 production

These are hard gates, not checkboxes:

- **DPIA (personvern).** Paste/keystroke/time telemetry is behavioral personal data. Needs a lawful basis,
  a documented retention limit, and a data-protection impact assessment. **Mitigation baked into the
  design:** store only *aggregates* (ratios/counts), never raw keystroke streams; short retention; the
  declaration is the primary lever. No prod telemetry without the DPIA.
- **Pedagogical policy (product owner / fagansvarlig).** What level of AI use is acceptable, and does it
  depend on the task type (writing-training vs application)? The thresholds *are* a policy decision — the
  per-module config (§6) exists precisely so the owner sets it, not us.
- **False-positive budget.** Agree an acceptable FP rate, then **shadow-mode** (§10) to measure it on real
  submissions before any threshold routes a student to review.
- **Student communication.** An in-platform AI-use policy shown *before* submission (transparency +
  deterrence) is arguably higher-value than any detection, and is a fairness prerequisite.

## 10. Phased rollout

- **Phase 0 (now):** this design → DPO + product-owner sign-off on §9.
- **Phase 1a — shadow mode:** ship the capture + scoring + annotation **feature-flagged**, computing the
  score and **logging it only** (does NOT set `forcesReview`). Gathers the labeled pilot dataset to
  measure the FP rate and calibrate thresholds. Zero student impact.
- **Phase 1b — enable routing:** once thresholds are validated against the agreed FP budget, let
  `forcesReview` route to UNDER_REVIEW. Per-module, default off.
- **Phase 2:** LLM-draft content-similarity as an additional component.
- **Phase 3:** student stylometric baseline.

## 11. Decisions made here vs. deferred to owner/DPO

- **Made (architecture):** upstream score → `needsManualReview` disjunct mirroring `borderlineWindow`;
  dedicated nullable columns; transparent component annotation; declaration field; shadow-mode-first;
  aggregate-only telemetry; review-trigger-never-fail invariant.
- **Deferred (not ours to set):** the actual thresholds, the acceptable FP rate, per-module policy
  defaults, the DPIA outcome + retention period, and the pedagogical AI-use policy.

## 12. Correction to #475 — appeal "reason category"

#475 says the appeal flow "just needs a new reason category." **There is no category concept today** —
`Appeal.appealReason` is free text (`prisma/schema.prisma:472`; schema `createAppealSchema` at
`submissions.ts:25–27`). For Phase 1, **no new category is needed**: the flag is visible to the student
and appealable via the existing free-text appeal flow. Add an `appealReasonCategory` enum only if later
appeal *analytics* require it — that's a separate, larger change, not a prerequisite.

## 13. Acceptance criteria (refined from #475)

- [ ] A submission with documented heavy paste/insertion (over the module threshold) routes to
      UNDER_REVIEW — never to FAIL.
- [ ] The annotation names *which* signals fired, with their raw values (transparent, not a black box).
- [ ] A declaration field exists at submit; the answer is stored and shown to the reviewer.
- [ ] Telemetry is **aggregate-only** (no raw keystroke/text logging); retention is bounded.
- [ ] Shipped **feature-flagged off**, in **shadow mode** first; routing enabled only after the FP rate is
      measured against an agreed budget on a pilot dataset.
- [ ] DPIA signed off; pedagogical AI-use policy + per-module thresholds set by the product owner.
- [ ] The teacher can see and override the flag; the reviewer can comment; the student can appeal via the
      existing flow.

## 14. Test hooks

Mirror `TC-POL-YELLOW-001` (`test/assessment-policy.integration.test.ts:269–339`): a submission whose
`processSignals` exceed the ai-influence threshold asserts `status === "UNDER_REVIEW"`,
`passFailTotal === false`, and `decisionReason` contains the ai-influence rationale — plus a unit test that
`aiInfluence` can only *add* review, never flip a pass to fail. (The `createAssessedSubmission` harness
needs extending to inject `processSignals`.)
