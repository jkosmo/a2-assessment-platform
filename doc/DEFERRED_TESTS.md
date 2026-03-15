# Deferred Manual Test Cases

These test cases were not completed during the v0.7.4/v0.7.5 test round and must be included in the next test session.

## Deferred from v0.7.4/v0.7.5 round

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
