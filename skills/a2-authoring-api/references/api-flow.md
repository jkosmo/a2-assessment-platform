# API call flow — orchestrating an authoring package

Reference implementation: [scripts/import-package.mjs](../scripts/import-package.mjs)
(use it directly when you have a shell; follow the same sequence when calling the API
through another mechanism). Endpoint catalog: `doc/API_REFERENCE.md` (Admin Content).

All calls: `Content-Type: application/json`, auth per SKILL.md (mock headers locally,
`Authorization: Bearer …` in shared environments — preferably a short-lived `aat_...`
agent authoring token issued by the user via
`POST /api/admin/content/agent-authoring/tokens`). All routes require the `admin_content`
capability (ADMINISTRATOR or SUBJECT_MATTER_OWNER).

Note when running on an agent token: the API enforces the draft-only rules below
(`draft: true`, `autoPublish: false`, `mode: "createNew"`, items only on draft courses) —
deviating returns `403 agent_token_scope`. The token cannot call anything outside this
flow, and cannot issue or revoke tokens.

## Sequence

Execute the `plan` from the validate report in order, maintaining a
`clientRef → serverId` map. **Never call any `.../publish` endpoint.**

### 1. `POST /api/admin/content/agent-authoring/validate`

Body `{ "package": <pkg> }` → `200 { valid, summary, issues, plan }`. Abort (fix package)
unless `valid: true`.

### 2. `create_section` → `POST /api/admin/content/sections`

```json
{ "title": <payload.title>, "bodyMarkdown": <payload.bodyMarkdown>, "draft": true, "clientRef": "<ref>" }
```

`draft: true` is **mandatory** in agent flows (without it the section auto-publishes).
→ `201 { section: { id, … }, links: { editor }, clientRef }` — store `section.id`.

### 3. `create_module` → `POST /api/admin/content/modules/import`

Wrap the module payload in a synthesized module-scoped `a2-content-export/v1` envelope
with an **empty audit** (no publish history ⇒ can never auto-publish):

```json
{
  "payload": {
    "exportFormat": "a2-content-export/v1",
    "exportedAt": "<now ISO>",
    "scope": "module",
    "module": { "module": <payload.module>, "activeVersion": { …<payload.activeVersion>, "audit": {} } }
  },
  "mode": "createNew",
  "autoPublish": false,
  "clientRef": "<ref>"
}
```

`autoPublish: false` is **mandatory**. → `201 { moduleId, moduleVersionId, links: { conversation, advanced }, clientRef }`.

### 4. `create_course` → `POST /api/admin/content/courses`

```json
{ "title": <payload.course.title>, "description": <…if set>, "certificationLevel": <…if set>, "clientRef": "<ref>" }
```

→ `201 { course: { id, publishedAt: null, … }, links: { course }, clientRef }`.

### 5. `set_course_items` → `PUT /api/admin/content/courses/:courseId/items`

Resolve each item: `ref` → mapped server ID; explicit `moduleId`/`sectionId` pass through.

```json
{ "items": [ { "type": "SECTION", "sectionId": "…" }, { "type": "MODULE", "moduleId": "…" } ] }
```

→ `204` (no body).

## Audit trace (agentRunId)

Generate ONE `agentRunId` per orchestration run (pattern `[a-zA-Z0-9._-]{1,64}`, e.g.
`aar-<timestamp>-<random>`; the reference script does this automatically) and send it in
the body of every write (`POST /sections`, `POST /modules/import`, `POST /courses`,
`PUT .../items`). Every write is then audit-logged with
`source: "agent_authoring" + clientRef + agentRunId` — so a human can reconstruct exactly
what a run created, even after a partial failure. Always include the `agentRunId` in your
final summary to the user.

## Error handling

- Validation failures on create calls: `400 { error: "validation_error", issues: [...] }` —
  same Zod-issue shape as the validate report; show field paths.
- Other errors: `{ error: "<code>", message }` (e.g. `module_import_failed`, 403
  `forbidden`, 404 `import_target_not_found`).
- **Partial failure**: stop at the failed step; report per step what happened
  (done / failed / skipped — the reference script returns this as `steps[]`), the created
  IDs + links, the error body, and the `agentRunId`. Never auto-delete — cleanup (archive +
  delete in the admin UI) or completion is the human's decision; a retry of the remaining
  steps can reuse the `clientRef → id` map you already have. Retries of CREATE steps
  currently create duplicates (Idempotency-Key is tracked in #726) — on a timeout, check
  with the user / the library list before re-running a create step.

## Admin links (for the final summary)

| Object | Link |
|---|---|
| Module (conversational editor) | `/admin-content/module/:moduleId/conversation` |
| Module (advanced editor) | `/admin-content/module/:moduleId/advanced` |
| Course builder | `/admin-content/courses/:courseId` |
| Section editor | `/admin-content/sections?id=:sectionId` |
