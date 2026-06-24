# Feature Surface Map

> **Purpose.** A living lookup of the user-facing behaviours that live in **more than one place**.
> Most of our deploy→bug→deploy churn is *"correct fix, incomplete surface"*: a fix lands in the
> one path in the screenshot while a sibling path breaks next (retrospective: 6 bugs / 5 deploys,
> v1.3.37→1.3.42; the #479 file-size limit that lived in 4 places; the 429 cascade across the LLM
> pipeline). This map is the antidote to grepping from scratch every time.
>
> **How to use.** Before building or fixing any behaviour below, open this entry, change **every**
> listed surface in the same PR, and make the listed guard test(s) green. If the behaviour isn't
> here yet, `grep` the feature/i18n label across all of `public/` + `src/`, list the surfaces, fix
> them together, and **add the entry**.
>
> **How it stays honest.** Each entry names its **guard test(s)**. When a guard test breaks, the
> map is telling you a surface moved — update both. Don't add line numbers that will rot; name
> files + functions + tests (stable) and only pin a line when it genuinely helps.
>
> Maintained as part of EPIC #595. Informed by the architecture review `doc/design/FRONTEND_ARCHITECTURE_REVIEW_598.md`.

---

## 1. Source-material upload size limit (#479)

A single "max upload size" value lived in **four** places; raising it in three and missing one
shipped a 2.6 MB file rejected with a "10 MB" message, then a 5.6 MB file 413'd by the parser.

| Surface | Where | Notes |
|---------|-------|-------|
| File cap (source of truth) | `src/modules/adminContent/sourceMaterialExtractionService.ts` → `SOURCE_MATERIAL_MAX_BYTES` | 10 MB |
| Upload-body limit (derived) | same file → `SOURCE_MATERIAL_UPLOAD_BODY_LIMIT_BYTES` | base64 ×4/3 + headroom; consumed by both servers |
| Main app body parser | `src/app.ts` (`/api/admin/content/source-material/extract`) | uses the derived constant |
| Parser-worker body parser | `src/parserApp.ts` | **separate service** — easy to miss; uses the derived constant |
| Client guard | `public/static/admin-content-shell.js` → `SOURCE_MATERIAL_MAX_BYTES` | comment binds it to the server constant |
| UI text | `public/i18n/admin-content-translations.js` → `shell.source.fileTooLarge` (×3 locales) | must match the cap |

**Guards:** `test/unit/source-material-extraction-service.test.ts` (sync-guard: body limit ≥ max-file base64); `test/e2e/admin-content-workspaces.spec.ts` "accepts a file between 2 and 10 MB".

## 2. Source-material ingest entry points (#454 / #479)

The "source" step in the conversational shell has several ways to add material — a fix to one
(e.g. the size guard, a chip label) usually applies to all.

- **Upload file**, **Fetch from URL**, **Crawl site**, **External-LLM handoff**, and the **notes** textarea — all in `public/static/admin-content-shell.js` (the source-step render + `fetchedUrlSources`/`uploadedFileSources` + `refreshUploadHint`).
- Endpoints: `POST /source-material/extract` (+ `/extract/:jobId` poll), `/fetch-url`, `/crawl-url`, `/condense` in `src/routes/adminContent.ts`.

**Guards (e2e, `test/e2e/admin-content-workspaces.spec.ts`):** "fetches a single URL…", "can crawl a site…", "accepts a file between 2 and 10 MB". User doc: `doc/SOURCE_MATERIAL_INGEST_GUIDE.md`.

## 3. Module creation — two entry points (#348)

Creating a module is reachable from **two** places; a flow/step change must cover both.

- **Library "create module" dialog** — `public/static/admin-content-library.js` (`createModuleBtn`, `emptyCreateBtn`, `createModuleDialog`, `openCreateDialog`).
- **Conversation idle "new module"** — `public/static/admin-content-shell.js` (and the regen flow, #579).

**Guards:** `test/e2e/admin-content-module-library.spec.ts` (library dialog → POST → conversation route); `test/e2e/admin-content-workspaces.spec.ts` "shell can create a new module…".

## 4. Module-type (assessment mode) selection — 3-way (#525/#578)

`FREETEXT_PLUS_MCQ` / `MCQ_ONLY` / `FREETEXT_ONLY` is chosen in **three** surfaces:

- Conversation new-module step and conversation **regen** step — `public/static/admin-content-shell.js`.
- Advanced editor radio fieldset — `public/admin-content.js` + `public/admin-content-advanced.html`.

**Guards (`test/e2e/admin-content-workspaces.spec.ts`):** "authors a FREETEXT_ONLY module version", "authors an MCQ-only module version", "shell regen flow can switch the module to …".

## 5. Result score-row display per mode (#591)

`renderResultSummary` (`public/participant.js`) shows/hides score rows by mode — each branch is a surface:

- `MCQ_ONLY` → hide practical row · `FREETEXT_ONLY` → hide MCQ row · `FREETEXT_PLUS_MCQ` → show both.

**Guards (`test/e2e/participant-mcq-only.spec.ts`):** the triad — "MCQ-only result … not practical", "FREETEXT_ONLY result hides the MCQ score row", "FREETEXT_PLUS_MCQ result shows both …".

## 6. Course certificate display — multiple places (#550 / #580)

A completed-course certificate surfaces in **four** views. All of them fetch
`GET /api/courses/completions` and turn a completion into a link to the printable view — a
change to issuance, fetch-wiring, or rendering must be verified on all four:

| Surface | File | How completions load |
|---------|------|----------------------|
| Result banner in the course accordion | `public/participant.js` (`participantCompletions`, ~L2784) | `/api/courses` + `/api/courses/completions` together on render (`Promise.all`) |
| `/participant/completed` → "Mine kursbevis" | `public/participant-completed.js` (`loadCourseCertificates`) | auto-loaded on page open after console config (#580) — **was previously button-only** |
| `/profile` → "Fullførte kurs" | `public/profile.js` | on profile render |
| Printable `/certificate?id=…` | `public/certificate.js` | fetches `/api/courses/completions/:id` |

**Issuance gates (server):** a completion is issued when **all modules passed AND all sections
read**, for any course with ≥1 element — including **module-less reading courses** (#476/#580).
`reconcileCourseCompletionsForUser` (run on `GET /api/courses/completions`) backfills any missed
event-driven issuance. See `src/modules/course/courseCompletionService.ts`.

**Guards (all run locally with no DB — static-server + mocked routes):**
`test/e2e/participant-certificate.spec.ts`, `test/e2e/participant-completed-certificates.spec.ts`,
`test/e2e/profile-certificate-link.spec.ts`, `test/e2e/participant-course-banner.spec.ts` (#630 —
result-banner surface), plus server-side `test/m2-course-completions.test.ts` (issuance + reconcile,
incl. module-less). All four surfaces now have guards.

**Pre-deploy gate:** run the journey locally before deploying any cert change —
`npx playwright test --config playwright.admin-content.config.ts test/e2e/participant-certificate.spec.ts test/e2e/participant-completed-certificates.spec.ts test/e2e/profile-certificate-link.spec.ts` (~9s, no Docker/Postgres).

## 7. Conditional visibility — the `.hidden` cascade trap

`.hidden` (`display:none` without `!important`) loses the cascade to `display`-setting classes
(`.row`/`.card`/`.content-card`/`.module-brief`/grid…), so the element never hides. Use
`setHidden(el, on)` / inline `style.display`.

- Helper: `public/static/dom-visibility.js` (`setHidden`).
- Recurring offenders: any `.row`/`.card`/grid element toggled conditionally (e.g. `#selectedModuleBrief`, `#mcqSection`).

**Guard pattern:** assert the element is actually hidden (`toBeHidden()`) in the e2e, not just that a class was toggled.

## 8. Locale resolution + per-page `currentLocale`

Initial-locale resolution is now **single-source** (`public/static/i18n-locale.js` → `resolveInitialLocale(supportedLocales)`), but each page still owns a mutable `currentLocale` that the display formatters read lazily. A locale-handling change touches the shared resolver + each page's `setLocale`/re-render.

**Guard:** `test/unit/i18n-locale.test.js`.

## 9. Shared display primitives — single source of truth (#596, EPIC #595)

These were each duplicated across many page scripts and are now one module + unit test. **Use the
import; do not re-add a local copy.**

| Primitive | Module | Was duplicated in |
|-----------|--------|-------------------|
| `escapeHtml` | `public/static/html-escape.js` | 6 files (slice 1) |
| `formatNumber` | `public/static/format-display.js` (`createNumberFormatter`) | 7 files (slice 2) |
| `resolveInitialLocale` | `public/static/i18n-locale.js` | 9 files (slice 3) |
| `formatDateTime` | `public/static/format-display.js` (`createDateTimeFormatter`) | 7 files (slice 4) |
| `renderWorkspaceNavigation` | `public/static/workspace-nav.js` (`renderWorkspaceNavigationWithProfile`) | 13 page scripts (slice 5) — all now thin wrappers |

**Guards:** `test/unit/html-escape.test.js`, `test/unit/format-display.test.js`, `test/unit/i18n-locale.test.js`. Nav rendering exercised across e2e page loads. **Rule:** never re-add a local `renderWorkspaceNavigation` body — call the shared helper; pass `localePicker: null` on pages that intentionally omit the profile link (e.g. `profile.js`).

### Intentionally distinct (NOT duplicates — do not force-merge)
`#596` consolidation is complete. The following look similar but are genuinely different and stay
separate:
- **`escapeHtml` in `static/admin-content-sections.js`** also escapes `'` (`&#39;`) for
  attribute-context safety — a real superset, not a copy of the text-escape canonical.
- **Single-of-a-kind date formatters:** `certificate.js` (`dateStyle:"long"`), `profile.js`
  `formatDate` (`dateStyle:"medium"`), `admin-content.js` `formatDateTimeValue` (NaN-guard form).
  Distinct formats, not duplication.

The 3 `String(x)` `escapeHtml` variants (preview/shell/loading) and the 2 identical numeric
`formatDate` copies (courses/library) were consolidated in slice 6 (v1.3.61).

## 10. Assessment LLM pipeline — 429/oversize chain (#479)

The authoring pipeline fans into several large Azure OpenAI calls that share one tokens-per-minute
quota; one un-retried/oversize call cascades.

- Single call + retry/backoff: `src/modules/adminContent/llmContentGenerationService.ts` (`callLlm`, `parseRetryAfterMs`, `computeLlmBackoffMs`).
- Oversize input handling: `condenseSourceMaterial` chunks via `splitIntoChunks`.
- Pipeline order (each a call): condense → blueprint → draft → MCQ.
- **Sibling not yet fixed:** the assessment-side LLM client `src/modules/assessment/llmAssessmentService.ts` lacks the same retry (tracked in #603).
- Deployment TPM capacity is **not** in IaC (#607); current capacity recorded there.

**Guards:** `test/unit/llm-retry.test.ts` (retry + chunked condense), `test/unit/llm-content-generation-service.test.ts` (backoff helpers + `splitIntoChunks`).
