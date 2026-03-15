# Deferred Manual Test Cases

These test cases were not completed in the most recent test round and must be included in the next session.

## Deferred from v0.7.4/v0.7.5 round

### TC-PART-03b — Custom submission schema form
**Context:** W3 in v0.8.1 showed the custom schema not applied after save+publish. Root cause analysis: no code bug found — the likely cause was that "Lagre ny utkastversjon" failed (showing an error), the user then published using the previously-loaded version ID (which was already in the publish field from "Load content"), resulting in the old schema-less version being published.

**Setup steps — follow carefully:**
1. In admin-content Section 3, select a module and click "Hent innhold" (Load content)
2. Confirm the section 8 schema textarea is empty (or has old content)
3. In Section 8 (submission schema textarea), paste:
   `{"fields":[{"id":"answer","label":{"en-GB":"Your answer","nb":"Ditt svar","nn":"Ditt svar"},"type":"textarea","required":true},{"id":"reflection","label":{"en-GB":"Reflection","nb":"Refleksjon","nn":"Refleksjon"},"type":"textarea","required":false}]}`
4. Click "Lagre ny utkastversjon (Steg 5-8)"
5. **CRITICAL**: Confirm the success message "Lagret bundle" appears. If you see an error instead, stop and investigate before continuing.
6. Confirm "Sist lagrede utkast" in the status panel now shows a chain that includes the new version numbers (e.g., Module v2, Rubric v2…)
7. Click "Publiser modulversjon"
8. Open **participant.html directly** (not via Preview)

**Test steps:**
1. Select the module in nb locale
2. Verify only **2 fields** appear: "Ditt svar" (required) and "Refleksjon" (optional) — not the default 3 fields
3. Try to submit with "Ditt svar" empty → submission blocked
4. Leave "Refleksjon" empty, fill "Ditt svar" only → submission proceeds
5. Switch locale to en-GB → labels update to "Your answer" and "Reflection"
**Expected:** Dynamic form renders exactly the fields defined in the schema.
