# Test Session — v0.8.1

**Version tested:** 0.8.1
**Date:** _______________
**Tester:** _______________
**Environment:** _______________

---

## How to use this document

| Symbol | Meaning |
|--------|---------|
| ✅ | Pass |
| ❌ | Fail — describe in Notes |
| ⚠️ | Partial / unexpected but not a blocker |
| — | Skipped / not applicable |

---

## W1 — Module authoring via GPT prompt

**Precondition:** Logged in as ADMINISTRATOR. Admin-content.html is open. No module pre-selected.
**Covers:** TC-ADMIN-08r (certificationLevel locale), TC-ADMIN-06r/07r (draft version selection), DEF-01 (textarea), DEF-02 (version fields preserved)

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Section 1 → Copy authoring prompt | Clipboard message appears | | |
| 2 | Paste into ChatGPT. Ask for a Norwegian assessment module on a topic of your choice | LLM returns JSON | | |
| 3 | Inspect `module.certificationLevel` in the returned JSON | Locale object `{"en-GB":"…","nb":"…","nn":"…"}`, not a plain string | | |
| 4 | Import the JSON via Section 4 (Import draft) | All form fields populate, including version fields (rubric, prompt, MCQ, task text) | | |
| 5 | Inspect the certificationLevel field (Nivå) | **Textarea** (multi-line), shows the JSON locale object legibly — same visual style as Module name | | |
| 6 | Click "Create module" | Module shell created, module ID shown in Section 3 | | |
| 7 | Immediately inspect the version fields (rubric criteria, prompt, MCQ, task text) | Fields **still populated** from the imported draft — not wiped | | |
| 8 | Click "Save new draft version" | Draft version saved without error | | |
| 9 | Click "Export module JSON" | JSON downloaded | | |
| 10 | Open exported JSON. Inspect `module.certificationLevel` | Locale object preserved (not null, not a plain string) | | |
| 11 | Click "Load content" (Section 3) | Form populates from the **latest draft** (the version just saved), not an older published version | | |
| 12 | Edit the assessment policy textarea (Section 8): enter `{"scoring":{"practicalWeight":60,"mcqWeight":40},"passRules":{"totalMin":65}}` then save new draft | Saved without error | | |
| 13 | Export again. Inspect `selectedConfiguration.moduleVersion.assessmentPolicy` | Contains the entered scoring weights (not null) | | |
| 14 | Publish the module version | Published, badge changes to "Live" | | |

**W1 verdict:** _______________

---

## W2 — Participant workflow in Norwegian locale

**Precondition:** Module from W1 is published and active. Participant.html is open.
**Covers:** Norwegian locale, module titles on locale switch (DEF-03), MCQ locale, certificationLevel display

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Load modules (keep locale at **en-GB** initially) | Module list loads, module title shown in English | | |
| 2 | Switch locale to **nb** | Module list **re-renders** — title, description, and certificationLevel update to Norwegian without page reload | | |
| 3 | Select the module | Module summary shows Norwegian title, description, and certificationLevel | | |
| 4 | Inspect submission form field labels | Labels in Norwegian | | |
| 5 | Switch locale to **en-GB** | Module title/description in list and module summary update to English; field labels update to English | | |
| 6 | Switch back to **nb** | Everything returns to Norwegian | | |
| 7 | Fill in submission fields and click "Create submission" | Submission created | | |
| 8 | If MCQ configured: start and complete the MCQ | Questions and options shown in Norwegian | | |
| 9 | Queue or wait for auto-assessment | Status moves to queued / processing | | |
| 10 | Poll until result appears | Result shown | | |
| 11 | Inspect the pass/fail indicator | Norwegian text (Bestått / Ikke bestått) | | |

**W2 verdict:** _______________

---

## W3 — Custom submission schema with locale labels

**Precondition:** Use the module created in W1. Add a `submissionSchemaJson` to it:
1. In admin-content Section 3, select the W1 module
2. Click "Load content"
3. In Section 8 (submission schema textarea), paste:
```json
{"fields":[{"id":"answer","label":{"en-GB":"Your answer","nb":"Ditt svar","nn":"Ditt svar"},"type":"textarea","required":true},{"id":"reflection","label":{"en-GB":"Reflection","nb":"Refleksjon","nn":"Refleksjon"},"type":"textarea","required":false}]}
```
4. Click "Save new draft version", then publish
5. Open **participant.html directly** (not via Preview button in admin-content)

**Covers:** TC-PART-03b (custom schema fields), TC-PART-06r (locale labels)

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Open participant.html with locale **nb** | — | | |
| 2 | Select the W1 module | Submission form shows **2 fields** only — "Ditt svar" and "Refleksjon" (not the default 3 fields) | | |
| 3 | Inspect field labels | "Ditt svar" (required) and "Refleksjon" (optional) | | |
| 4 | Try to submit with the required field ("Ditt svar") empty | Submission blocked, validation feedback shown | | |
| 5 | Leave "Refleksjon" empty, fill only "Ditt svar" | Submission proceeds | | |
| 6 | Switch locale to **en-GB** without reloading | Labels update to "Your answer" and "Reflection" immediately | | |

**W3 verdict:** _______________

---

## W4 — Manual review workflow

**Precondition:** A submission is UNDER_REVIEW. Logged in as REVIEWER or ADMINISTRATOR.

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Open manual-review.html | Review queue loads | | |
| 2 | Resize to **≤ 600 px** (DevTools device emulation) | Queue table reflows to card view — each row stacked, column names as bold labels | | |
| 3 | Select a review from the queue | Details panel populates | | |
| 4 | Claim the review | Reviewer name appears in queue row | | |
| 5 | Enter decision reason and outcome, submit | Review closes; status updates | | |

**W4 verdict:** _______________

---

## W5 — Appeal workflow

**Precondition:** A completed submission exists with appeal rights. Logged in as APPEAL_HANDLER or ADMINISTRATOR.

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | In participant.html, create an appeal | Appeal created | | |
| 2 | Open appeal-handler.html | Appeal queue loads | | |
| 3 | Resize to **≤ 600 px** | Card view: 9 columns stacked with labels | | |
| 4 | Claim and resolve the appeal | Appeal resolved; status updates | | |
| 5 | Return to participant.html — verify appeal outcome visible | Appeal result shown | | |

**W5 verdict:** _______________

---

## W6 — Section locking (keyboard isolation)

**Precondition:** participant.html open. Navigate with Tab / Shift+Tab only.
**Covers:** #122 tabindex=-1 on locked sections

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Load page before a module is selected (assessment section locked) | Tab does **not** land inside the locked assessment section | | |
| 2 | Select a module and create a submission. Tab through the page | Assessment section buttons remain unreachable via Tab until unlocked | | |
| 3 | Once assessment is unlocked, Tab through | Assessment section buttons **are** reachable | | |
| 4 | Before appeal is available, Tab through | Appeal button unreachable | | |
| 5 | After result + appeal available, Tab through | Appeal button reachable | | |

**W6 verdict:** _______________

---

## W7 — Accessibility

**Precondition:** Use Microsoft Edge for step 1–2. Chrome/Firefox for remainder.
**Covers:** TC-WCAG-01r (skip-nav Edge), #118 (colours), #124 (card view)

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | Open participant.html in **Edge**. Press Tab once | Skip-nav link visible at top of page | | |
| 2 | Press Enter on skip-nav | Focus moves to main content area | | |
| 3 | Inspect a warning/validation message (`.field-warning`) | Dark orange text — clearly legible, not bright orange | | |
| 4 | Inspect a success message (`.field-success`) | Dark green text — clearly legible against white | | |
| 5 | Open participant-completed.html at 400 px | History table as stacked cards with column labels | | |
| 6 | Open calibration.html at 400 px | Both outcomes and anchors tables as stacked cards | | |
| 7 | Resize above 600 px | Tables return to normal horizontal layout | | |

**W7 verdict:** _______________

---

## W8 — Regression

**Covers:** Cross-module field isolation, latest draft selection

| # | Step | Expected | Result | Notes |
|---|------|----------|:------:|-------|
| 1 | In admin-content, load a module that has both a published version and a newer draft | "Load content" populates form from the **draft** (higher versionNo) | | |
| 2 | Switch to a different module in the selector | All version fields clear before new module's content loads | | |
| 3 | Load content for the second module | No content from the previous module visible | | |

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
