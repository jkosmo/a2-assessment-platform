# Deferred Manual Test Cases

These test cases were not completed in the most recent test round and must be included in the next session.

## Deferred from v0.8.1 session

### TC-PART-07 — Default submission field labels show in participant locale
**Found:** v0.8.1 W2. When no custom `submissionSchemaJson` is configured, the three default fields ("Your answer", "Reflection", "Instruction used") always show in English regardless of locale.
**Root cause:** `DEFAULT_SUBMISSION_FIELDS` in participant.js uses plain English strings; they are not i18n keys.
**Steps to verify fix:**
1. Open participant.html in nb locale
2. Select a module with no custom submissionSchema
3. Inspect field labels
**Expected:** Labels shown in Norwegian.
**Work needed:** Add `data-i18n` keys for the three default field labels and resolve them through `t()` in `renderSubmissionFields`.

### TC-PART-08 — "Sjekk framdrift" button inactive after LLM timeout
**Found:** v0.8.1 W2. After assessment job times out, the "Sjekk framdrift" / Check progress button is disabled and cannot be clicked.
**Root cause:** Unclear — likely gate state not updated after timeout status lands.
**Steps to reproduce:**
1. Submit an assessment that results in a timeout
2. Verify the "Sjekk framdrift" button becomes active so the participant can retry
**Expected:** Button active after timeout so participant can poll for updated status.

### TC-PART-09 — Appeal unavailable from completed modules history
**Found:** v0.8.1 W5. From participant-completed.html (past failures), there is no appeal button. Participants must appeal in the active session immediately after receiving a result.
**Design decision needed:** Should participant-completed.html show an appeal button for eligible past results?

### TC-ADMIN-09 — "Live nå" and "Lagrede utkast" visual formatting inconsistency
**Found:** v0.8.1 W3. The "Live nå" chain display uses a different visual format from "Lagrede utkast" in admin-content.html.
**Work needed:** Align the two displays to use the same HTML/CSS pattern.

### TC-ADMIN-10 — Large black squares in manual-review and appeal-handler output
**Found:** v0.8.1 W4/W5. JSON or structured output displayed in `<pre>` elements appears as large black boxes (dark background, poor contrast) in manual-review.html and appeal-handler.html.
**Root cause:** `pre` CSS uses `--color-pre-bg: #111111` — may be inappropriate for inline display in these workspaces.
**Work needed:** Review where `<pre>` is used in those pages; consider a lighter variant or scoped override.

## Retests from v0.7.7 fixes — verified OK in v0.8.1

### ~~TC-ADMIN-08r~~ — certificationLevel exports and displays in participant locale
**Regression test for:** certificationLevel was a plain English string even when module was authored in Norwegian; GPT prompt template did not include locale object for it.
**Steps:**
1. Copy the authoring prompt (section 1 of admin-content.html)
2. Verify the JSON skeleton shows `"certificationLevel": {"en-GB":"","nb":"","nn":""}` (not a plain string)
3. Generate a Norwegian module via the prompt and import the JSON
4. Create module shell and save a draft version
5. Open participant.html in nb locale
6. Select the module — inspect the module status line (shows certificationLevel)
**Expected:** certificationLevel shows in Norwegian ("Grunnleggende", not "Foundation").

### ~~TC-PART-06r~~ — Submission field labels show in participant locale (verified OK v0.8.1 W3)
**Regression test for:** submissionSchema.fields[].label was always rendered in English because localizePreviewText was not applied.
**Steps:**
1. Create a module with a `submissionSchemaJson` where `fields[].label` is a locale object, e.g. `{"en-GB":"Your answer","nb":"Ditt svar","nn":"Ditt svar"}`
2. Open participant.html, switch locale to nb
3. Select the module
**Expected:** The textarea label reads "Ditt svar" (Norwegian), not "Your answer".
**Note:** Also switch locale after selecting the module and verify label updates without reloading.

### ~~TC-WCAG-01r~~ — Skip-nav link visible on Tab in Microsoft Edge (verified OK v0.8.1 W7)
**Regression test for:** Skip-nav link was not appearing in Edge due to missing clip/clip-path properties.
**Steps:**
1. Open any workspace page (e.g. participant.html) in Microsoft Edge
2. Press Tab once — the skip-nav link should become visible
3. Press Enter — focus should move to `<main id="main-content">`
**Expected:** Link is visible on first Tab press in Edge; activating it skips to main content.

## Deferred from v0.7.4/v0.7.5 round (TC-ADMIN-06r/07r verified OK v0.8.1 W1/W8)

### TC-PART-03b — Custom submission schema form
**Context:** Session 2, step 3 of the v0.7.4 test script.
**Setup:** A module must have a `submissionSchemaJson` defined (e.g. two-field schema).
**Steps:**
1. Select that module in participant.html
2. Verify only the schema-defined fields appear (not the 3 default fields)
3. Verify required fields block submission when empty
4. Verify optional fields allow submission when empty
**Expected:** Dynamic form renders exactly the fields defined in the schema.

### TC-PART-05b — Norwegian criterion names in result view
**Context:** Session 2, step 7 of the v0.7.4 test script.
**Setup:** Module must have i18n keys for criterion names (not just camelCase IDs).
**Steps:**
1. Complete a submission in nb locale
2. Wait for assessment to complete
3. View result — inspect criterion name labels
**Expected:** Criterion names that have Norwegian translations show in Norwegian.
**Note:** Requires a module where criterion keys match i18n entries in `result.criterion.*`.

## Retests from v0.7.5 fix

### TC-ADMIN-06r — Assessment policy saves and exports correctly
**Regression test for:** Bug where assessmentPolicy saved as null in export (root cause: Load content returned old published version instead of latest draft).
**Steps:**
1. Load any module in admin-content.html
2. Load content (step 3 in UI)
3. In step 8 assessment policy textarea, enter: `{"scoring":{"practicalWeight":60,"mcqWeight":40},"passRules":{"totalMin":65}}`
4. Click Save new draft version
5. Export the module JSON
**Expected:** Exported JSON contains `assessmentPolicy` with the entered values (not null).

### TC-ADMIN-07r — Load content loads latest draft, not published version
**Regression test for:** Same v0.7.5 bug.
**Steps:**
1. Load a module that has a published version AND a newer unpublished draft version
2. Click Load content
**Expected:** The form populates with the LATEST (highest versionNo) version's content, not the active published version.
