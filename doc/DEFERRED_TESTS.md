# Deferred Manual Test Cases

These test cases were not completed in the most recent test round and must be included in the next session.

> **All previously deferred items are resolved.** No open deferred tests at v0.8.5.

---

## Resolved

### TC-PART-03b — Custom submission schema form
**Resolved in v0.8.5** (verified OK, W1 of TEST_SESSION_v0.8.5.md).

Root cause was a server Zod validation error: `submissionSchemaFieldSchema.label` was typed as `z.string()` but locale-object labels `{"en-GB":"…","nb":"…"}` were being sent. Fixed by changing to `localizedTextSchema` in `src/routes/adminContent.ts`.

**Historical context:** W3 in v0.8.1 showed the custom schema not applied after save+publish. Root cause analysis: the likely cause was that "Lagre ny utkastversjon" failed (showing an error that was previously silent), the user then published using the previously-loaded version ID, resulting in the old schema-less version being published. The silent failure was addressed in v0.8.4 (red error message on save failure). The schema validation root cause was fixed in v0.8.5.
