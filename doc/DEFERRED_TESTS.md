# Deferred Manual Test Cases

These test cases were not completed in the most recent test round and must be included in the next session.

## Deferred from v0.7.4/v0.7.5 round

### TC-PART-03b — Custom submission schema form
**Context:** Verified that submissionSchemaJson is correctly saved and published (see W3 findings in TEST_SESSION_v0.8.1.md — there was a publishing inconsistency that may need investigation). Once a module with a correct published submissionSchemaJson exists, verify:
1. Select that module in participant.html
2. Verify only the schema-defined fields appear (not the 3 default fields)
3. Verify required fields block submission when empty
4. Verify optional fields allow submission when empty
**Expected:** Dynamic form renders exactly the fields defined in the schema.
**Note:** The W3 verdict found that the schema did not publish correctly (live version showed v1 while saved versions showed v3). Investigate root cause before retesting.
