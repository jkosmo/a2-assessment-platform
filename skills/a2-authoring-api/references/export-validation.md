# Export validation — the fallback file must survive A2's real import

Why this exists: a fallback `a2-content-export/v1` file was called "validated" without ever
being checked against A2's real import schema. Its `exportedAt` was
`2026-07-10T21:01:25.216841+00:00` (timezone offset **+** microseconds); A2's import **rejected**
it. `2026-07-10T21:05:15.364Z` was accepted. "Validated" had meant "looks right", not "checked".

Deterministic helpers: [scripts/export-validate.mjs](../scripts/export-validate.mjs). Unit-tested
in `test/unit/agent-authoring-export-validate.test.ts`; the **real-schema** guarantee is in
`test/unit/agent-authoring-export-schema-roundtrip.test.ts`.

## Headline rule

> **A fallback export is not validated until the finished file has been read back and checked
> against the same schema as A2's import function.**

## The datetime trap

In `src/modules/adminContent/adminContentSchemas.ts`:

- `exportEnvelopeSchema.exportedAt = z.string().datetime()`
- `exportAuditSchema.publishedAt = z.string().datetime()` (on the course, every module
  `activeVersion`, and every section)

Zod `.datetime()` (as configured here) accepts **only** the JS `Date.prototype.toISOString()`
shape — `YYYY-MM-DDTHH:mm:ss.sssZ`. It **rejects** a timezone offset (`+00:00`) and rejects
microseconds. So:

- Always generate `exportedAt` with `new Date().toISOString()` — never a locale/offset string.
- Normalise **any** incoming or copied date the same way. `toIsoZ(input)` does this for a Date,
  an offset string, microseconds, or epoch ms — and **throws** on an unparseable value rather
  than emitting garbage.
- `collectDatetimeFields(envelope)` enumerates every at-risk field; `strictDatetimeFieldsOk`
  flags offenders; `normalizeEnvelopeDates` fixes them all (leaving a `null` publishedAt —
  "draft, no publish history" — untouched).

These two are the only datetime fields in the export contract; both are covered.

## The round-trip (`roundTripFallbackExport`)

The fallback file must be, in order: **(1) generated complete → (2) written to file → (3) read
back → (4) parsed → (5) validated against the same schema as A2's import → (6) delivered only if
validation passes.** The validated file **is** the delivered file — never validate an in-memory
object and then hand over a differently-written one.

`roundTripFallbackExport(envelope, { filePath, contentIntegrity? })` performs exactly this
(dates normalised before the write) and returns `{ delivered, file, checks, envelope }`.
`delivered` is `true` only when JSON parsing, export-schema validation and import-schema
validation all pass and content-integrity did not fail.

## The bundled validator, and why the repo test matters

The distributed zip cannot import `src`. So the skill script carries a **bundled** structural
validator (`validateExportEnvelopeStructure`) that mirrors `exportEnvelopeSchema` — envelope
format, scope↔payload match, ≥1 module/item, item shape + `sortOrder`, required localized
titles, required `activeVersion.audit`, and MCQ `correctAnswer ∈ options` **by localized
identity in every locale** — plus the strict `exportedAt`/`publishedAt` format check.

The bundled validator is best-effort by nature. The thing that keeps it **faithful** is the repo
test `agent-authoring-export-schema-roundtrip.test.ts`, which imports the **real**
`exportEnvelopeSchema` / `importBodySchema` and runs this script's generator output — including
the offset/microseconds bad cases — through them. If the real schema drifts, that test fails.

## Name the checks — never say "validated" generically

The production report must distinguish these by name; `describeChecks(report)` prints them and
`claimsImportValidated(report)` is `true` only when import-schema validation actually passed:

| Check | Meaning |
|---|---|
| **JSON parsing** | the written file parsed back |
| **export-schema validation** | structure matches `a2-content-export/v1` |
| **import-schema validation** | passes the same acceptance A2's import applies (incl. strict datetimes) |
| **content-integrity** | loss audit vs the master (see content-preservation.md) |
| **API dry-run** | **unavailable** — A2 has no import dry-run endpoint (course import writes) |
| **actual import** | done by a human in the admin UI; the skill never imports |

If only JSON parsing ran, the report must **not** claim import validation.

## Known limitation / recommended follow-up

There is **no import dry-run endpoint**: `POST /api/admin/content/courses/import`
(`importCourseFromEnvelope`) **writes**. The skill therefore validates against the bundled mirror
of the schema, guaranteed faithful by the repo test — it cannot get a live verdict from the
platform without creating drafts. **Recommended follow-up (not built here):** a
`courses/import?dryRun=true` endpoint that runs the real schema + integrity checks and returns
the verdict without writing. Flagged only.
