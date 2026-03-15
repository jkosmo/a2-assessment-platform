# Test Session — v0.8.0

**Version tested:** 0.8.0
**Date:** _______________
**Tester:** _______________
**Environment:** _______________

---

## How to use this document

Fill in the **Result** column for each step as you go:

| Symbol | Meaning |
|--------|---------|
| ✅ | Pass — behaves as expected |
| ❌ | Fail — describe what went wrong in Notes |
| ⚠️ | Partial / unexpected but not a blocker |
| — | Skipped / not applicable |

Write a **session verdict** at the bottom when done.

---

## W1 — Module authoring via GPT prompt

**Precondition:** Logged in as ADMINISTRATOR. Admin-content.html is open.
**Covers:** TC-ADMIN-08r (certificationLevel locale), TC-ADMIN-06r, TC-ADMIN-07r

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Section 1 → Copy authoring prompt | Clipboard message appears | | |
| 2 | Paste the prompt into ChatGPT or similar. Ask it to generate a Norwegian assessment module about a topic of your choice | LLM generates a JSON draft | | |
| 3 | Inspect the `module.certificationLevel` field in the returned JSON | It is a locale object `{"en-GB":"…","nb":"…","nn":"…"}`, not a plain string | | |
| 4 | Import the JSON via Section 4 (Import draft) | Form populates without error | | |
| 5 | Inspect the `certificationLevel` input field | Shows the JSON locale object, not just an English string | | |
| 6 | Click "Create module" | Module created, ID shown | | |
| 7 | Click "Save new draft version" | Draft version saved | | |
| 8 | Click "Export module JSON" | JSON downloaded | | |
| 9 | Open the exported JSON. Inspect `module.certificationLevel` | Locale object preserved, not null | | |
| 10 | Click "Load content" (Section 3) | **Draft** content loads — matches what was just saved, not an older published version | | |
| 11 | Edit the assessment policy textarea (Section 8): enter `{"scoring":{"practicalWeight":60,"mcqWeight":40},"passRules":{"totalMin":65}}` then save new draft | Saved without error | | |
| 12 | Export again. Inspect `selectedConfiguration.moduleVersion.assessmentPolicy` | Contains the entered scoring weights (not null) | | |
| 13 | Publish the module version | Published, badge changes to "Live" | | |

**W1 verdict:** _______________

---

## W2 — Participant workflow in Norwegian locale

**Precondition:** Module from W1 is published and active. Participant.html is open.
**Covers:** Core flow, Norwegian locale, MCQ locale, certificationLevel locale display

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Switch locale to **nb** (Bokmål) | UI labels change to Norwegian | | |
| 2 | Select the module created in W1 | Module appears in the list | | |
| 3 | Inspect the module title and description | Shown in Norwegian | | |
| 4 | Inspect the status line (certification level) | certificationLevel shown in Norwegian | | |
| 5 | Inspect the submission form field labels | Labels shown in Norwegian (not English) | | |
| 6 | Switch locale to **en-GB** while the module is still selected | Field labels update to English immediately, without page reload | | |
| 7 | Switch back to **nb** | Labels return to Norwegian | | |
| 8 | Fill in the submission fields and click "Create submission" | Submission created | | |
| 9 | If MCQ is configured: start and complete the MCQ | MCQ questions and options displayed in Norwegian | | |
| 10 | Queue assessment (or wait for auto-assessment) | Status moves to queued / processing | | |
| 11 | Poll until result appears | Result shown | | |
| 12 | Inspect criterion names in the result view | Criterion labels in Norwegian (not raw camelCase keys) | | |
| 13 | Inspect the pass/fail indicator | Norwegian text (Bestått / Ikke bestått) | | |

**W2 verdict:** _______________

---

## W3 — Custom submission schema with locale labels

**Precondition:** A module exists with `submissionSchemaJson` containing locale-object labels. Example schema:
```json
{
  "fields": [
    {"id":"answer","label":{"en-GB":"Your answer","nb":"Ditt svar","nn":"Ditt svar"},"type":"textarea","required":true},
    {"id":"reflection","label":{"en-GB":"Reflection","nb":"Refleksjon","nn":"Refleksjon"},"type":"textarea","required":false}
  ]
}
```
**Covers:** TC-PART-03b (custom schema), TC-PART-06r (locale labels)

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Open participant.html in **nb** locale | — | | |
| 2 | Select the module with the custom schema | Submission form shows exactly 2 fields (not the default 3) | | |
| 3 | Inspect field labels | "Ditt svar" and "Refleksjon" (Norwegian) | | |
| 4 | Try to submit with the required field empty | Submission blocked, validation feedback shown | | |
| 5 | Leave the optional field empty, fill only the required field | Submission proceeds | | |
| 6 | Switch locale to **en-GB** without reloading | Labels update to "Your answer" and "Reflection" | | |

**W3 verdict:** _______________

---

## W4 — Manual review workflow

**Precondition:** A submission exists that is UNDER_REVIEW (either force-review a new one, or use an existing open review). Logged in as REVIEWER or ADMINISTRATOR.

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Open manual-review.html | Review queue loads | | |
| 2 | Select a review from the queue | Details panel populates on the right | | |
| 3 | Inspect the queue table on a **narrow viewport (< 600 px)** — use DevTools device emulation | Table reflows to card view; each row is stacked, column names appear as bold labels before each value | | |
| 4 | Claim the review | Reviewer name appears in the queue row | | |
| 5 | Enter a decision reason and override outcome | No validation errors | | |
| 6 | Submit the review | Review closes; status updates | | |

**W4 verdict:** _______________

---

## W5 — Appeal workflow

**Precondition:** A completed submission exists where the participant has the right to appeal. Logged in as APPEAL_HANDLER or ADMINISTRATOR.

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | In participant.html, create an appeal for a completed submission | Appeal created | | |
| 2 | Open appeal-handler.html | Appeal queue loads | | |
| 3 | Inspect the appeal queue on a **narrow viewport** | Card view: each row stacks with labelled cells | | |
| 4 | Claim the appeal | Assigned timestamp appears | | |
| 5 | Resolve the appeal with a new decision reason | Appeal resolved; status updates | | |
| 6 | Return to participant.html — verify the appeal outcome is visible | Appeal result shown in participant view | | |

**W5 verdict:** _______________

---

## W6 — Participant section locking (keyboard isolation)

**Precondition:** participant.html open. Use keyboard-only navigation (Tab / Shift+Tab).
**Covers:** #122 section-locked tabindex=-1

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Load participant.html before a module is selected | Assessment section is locked | | |
| 2 | Tab through the page | Tab focus does **not** land on any button or input inside the locked assessment section | | |
| 3 | Select a module and create a submission | Assessment section may still be locked until MCQ/assessment conditions are met | | |
| 4 | Once assessment is unlocked (after MCQ or direct queue), Tab through the page | Assessment section buttons are now reachable via Tab | | |
| 5 | Inspect the appeal section before an appeal is available | Tab focus skips it | | |
| 6 | After result is ready and appeal is available, Tab through | Appeal button is reachable via Tab | | |

**W6 verdict:** _______________

---

## W7 — Accessibility: visual and keyboard (Tier 1 + Tier 2)

**Precondition:** Use Microsoft Edge for the skip-nav test. Use Chrome/Firefox for others.
**Covers:** TC-WCAG-01r (skip-nav Edge), #118 (colours), #124 (card view)

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Open participant.html in **Microsoft Edge**. Press Tab once | Skip-nav link becomes visible at the top of the page | | |
| 2 | Press Enter on the skip-nav link | Focus moves to the main content area | | |
| 3 | Open any page. Inspect `.field-warning` elements (e.g. validation messages) | Text is dark orange — clearly legible, not the bright orange of the old palette | | |
| 4 | Inspect `.field-success` elements | Text is dark green — clearly legible against white background | | |
| 5 | Open manual-review.html in DevTools at 400 px viewport width | Queue table displays as stacked cards; no horizontal scroll | | |
| 6 | Verify each card row shows a bold column label before the value | e.g. "Status: Open", "Module: …" | | |
| 7 | Open appeal-handler.html at 400 px | Same card layout; 9 columns all visible as stacked labels | | |
| 8 | Open participant-completed.html at 400 px | History table as stacked cards | | |
| 9 | Open calibration.html at 400 px | Both outcomes and anchors tables as stacked cards | | |
| 10 | Resize back above 600 px | All tables return to normal horizontal layout | | |

**W7 verdict:** _______________

---

## W8 — Regression: version selection and cross-module isolation

**Covers:** TC-ADMIN-07r (latest draft), cross-module field contamination

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | In admin-content, load a module that has both a published version and a newer draft | Load content populates the form from the **draft** (higher versionNo), not the published version | | |
| 2 | Switch to a different module in the module selector | All version-related fields (rubric, prompt, MCQ, assessment policy, etc.) clear before the new module's content loads | | |
| 3 | Load content for the second module | No content from the previous module bleeds into the form | | |

**W8 verdict:** _______________

---

## Session verdict

| Workflow | Verdict | Blocker? |
|----------|---------|----------|
| W1 — Authoring via GPT prompt | | |
| W2 — Participant (Norwegian) | | |
| W3 — Custom schema + locale labels | | |
| W4 — Manual review | | |
| W5 — Appeal | | |
| W6 — Section locking (keyboard) | | |
| W7 — Accessibility | | |
| W8 — Regression | | |

**Overall:** _______________

**New issues found:**

| # | Description | Severity | File / area |
|---|-------------|----------|-------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
