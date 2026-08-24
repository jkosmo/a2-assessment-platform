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

## 3. Module creation — four callers of `POST /modules` (#348 / #918)

Creating a module is reachable from **four** places; a flow/step change must cover all of them.

- **Library "create module" dialog** — `public/static/admin-content-library.js` (`createModuleBtn`, `emptyCreateBtn`, `createModuleDialog`, `openCreateDialog`).
- **Conversation new module, free-text** — `confirmAndGenerate` in `public/static/admin-content-shell.js` (and the regen flow, #579).
- **Conversation new module, MCQ-only** — `createMcqOnlyModuleThenGenerate`, same file. A separate function that has repeated the other one's mistakes word for word twice now.
- **External-LLM import** — `applyExternalLlmJsonImport`, same file (#455).

### The title's shape is part of the contract (#918)

`localizedTextSchema` is `string | {all three locales}`, and the two shapes mean different things
(#892/#905): a bare string is «one language, not translated yet»; a full map asserts «this IS
translated». The conversation typed one language and sent three copies of it, so the publish gate
(point 18) found no gap in a title nobody had translated — an English module title reached Norwegian
participants through the gate built to stop exactly that.

So: **send the string as a string.** Only pass an object when the value really is translated — the
external-LLM import is the one caller that can receive one, and it must pass it through unchanged
rather than flattening it. Note that the import is also the only path where the lie survives to the
gate: the other two put a bare string in `sessionDraft.title`, which `normalizeModuleTitlePatch`
carries to the first save, so the module row corrects itself. The import put the map in both places.

**Guards:** `test/e2e/admin-content-module-library.spec.ts` (library dialog → POST → conversation
route); in `test/e2e/admin-content-workspaces.spec.ts`: "shell can create a new module…", "the
conversation creates a module with a one-language title, not three copies of it" (free-text +
MCQ-only), "an external-LLM import carries the title's real language through to the save" (both
directions — bare string stays bare, locale object passes through).

## 4. Module-type (assessment mode) selection — 3-way (#525/#578)

`FREETEXT_PLUS_MCQ` / `MCQ_ONLY` / `FREETEXT_ONLY` is chosen in **two** surfaces (three until
#896 S3c deleted the advanced editor's radio fieldset along with the page):

- Conversation new-module step and conversation **regen** step — `public/static/admin-content-shell.js`.
- **Innstillinger tab (#896 S3b)** — `renderSettingsPanel` / `saveSettingsInBackground` in
  `public/static/admin-content-shell.js`. The only surface that changes the type on an EXISTING
  module. Two rules live here and nowhere else: availability is computed from the module's
  version **history** (not the current version's pointers, or a switch becomes irreversible), and
  the assessment policy is carried whole (sending only the MCQ rule silently reverts totalMin,
  the practical minimum and the borderline window to platform defaults).

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

## 6b. Participant course view — opening an item inline (#865)

A course item opens in the SAME inline, in-place model whether it is a **section** or a **module** — a
`.course-inline-panel` under the row in `#courseDetail_<id>`, natural height, one open at a time. There
are two distinct code paths + a relocated singleton to keep in sync when touching this.

| Surface | Where | Notes |
| --- | --- | --- |
| Section open | `public/participant.js` `renderSectionReaderInto(panel, courseId, entry)` | Was the `#sectionReaderOverlay` modal (removed). Fetches `/api/courses/:id/sections/:sid`, hydrates asset images. **No discussion board since #923** (course level only) and **one combined action button since #924**. Reuses ids `#sectionReaderTitle`/`#sectionReaderBody`/`#sectionReaderMarkRead`. |
| Module open | `openInlineItemByEntry` → `openCourseModule` → `renderCourseDetailModules` → `reopenInlineAfterRender` → `buildModuleInlinePanel` | Relocates the singleton `#moduleWorkspace` (wraps `#submissionSection`/`#mcqSection`/`#assessmentSection`/`#appealSection`) into the row's panel. |
| Re-render safety | `restoreModuleWorkspaceHomeIfInside(container)` before every `innerHTML=""` in `renderCourseDetailModules` **and** `renderParticipantCourseAccordion`; `reopenInlineAfterRender` after | The accordion rebuilds via `innerHTML=""` frequently — the workspace MUST be moved back to `#moduleWorkspaceHome` first or it is destroyed. **Was documented but not enforced** — `renderParticipantCourseAccordion` lacked the call, and v2.11.5 routed the language switch through it, turning a hard-to-reach path into a one-click one. Now guarded: `participant-course-sequence.spec.ts` → "switching language while a module is open does not destroy the module workspace". |
| Standalone module path | `renderModules` card click | Non-course-only (dev/test) flow uses the workspace at home; the click first `collapseInlineOpen()` + `restoreModuleWorkspaceHome()`. |
| Home visibility | CSS `body.participant-course-only #moduleWorkspaceHome { display:none }`; set in `applyCourseOnlyMode` | Course-only shows the workspace ONLY inline; standalone keeps the home location. |
| Shared state | `inlineOpen`, `courseSequences`, `collapseInlineOpen`, `nextEntryAfter` | One-open-at-a-time + «Gå til neste element» nav (module panel only — the section reader’s nav is the #924 combined button). |
| List vs. course state | `focusedCourseId`, `applyCourseFocusState`, `focusCourse`, `unfocusCourse` (#921/#922) | Opening a course hides every OTHER `.course-accordion-item` and reveals `#courseBackBar`. An inline-open item MUST be collapsed before the course is hidden (`unfocusCourse` → `collapseInlineOpen`) or the singleton workspace ends up inside a `display:none` subtree. |

**Pre-deploy gate:** `npx playwright test --config playwright.admin-content.config.ts test/e2e/participant-section-reader.spec.ts test/e2e/participant-mcq-only.spec.ts test/e2e/participant-inline-open.spec.ts test/e2e/participant-course-sequence.spec.ts test/e2e/participant-course-focus.spec.ts test/e2e/participant-section-advance.spec.ts` (~10s, no Docker/Postgres). `participant-inline-open` is the consistency guard (section + module both inline, one open, workspace relocated); `participant-course-sequence` guards the serial presentation; `participant-course-focus` guards list-vs-course state (#921/#922); `participant-section-advance` guards the combined advance button and the absent item-level discussion (#923/#924).

## 6b-2. Participant course view — the serial sequence (spine)

`renderCourseDetailModules` renders the course as **one spine with a single focal point**, not a flat
list of equal buttons. Three mutually exclusive row states, driven by `findNextIncompleteEntry`:

| State | Class on the row | Rendered as |
| --- | --- | --- |
| Completed | `.course-step--done` | One quiet line: kind label, title, status pill, «Se igjen» |
| Current (first incomplete) | `.course-step--now` | The only card — position, title, primary CTA |
| Later | `.course-step--ahead` | Dimmed title line. **Still clickable** |

**Invariants to preserve when touching this:**

- `.course-item[data-key][data-type]`, the `.course-module-row` class on the row button, and the
  `.course-inline-panel` sibling are the **stable hooks** for the inline-open machinery (6b) and for
  every participant e2e. Restyle freely; do not rename these.
- Rows live inside `.course-sequence` (which draws the spine), not directly in `#courseDetail_<id>`.
  `restoreModuleWorkspaceHomeIfInside` / `reopenInlineAfterRender` still take the outer container.
- **Type is carried by shape, status by colour** — circle = reading material, rotated square = test
  (`.course-step-mark`, keyed off `[data-type]`). Never encode type in colour: green already means
  "completed" for both kinds. The `.course-sequence-legend` is required, not decoration — a diamond
  means nothing unexplained. Kind is ALSO in text (`.course-step-kind`) for screen readers.
- **Later steps are deliberately not locked.** `available` means "published", not "unlocked"; there is
  no backend sequence gating. This is presentation only — the invitation is removed, the ability is
  not. If real locking is ever added, it belongs in the API, not here.
- Participant vocabulary is **«Lesestoff» / «Test»** (`courses.kind.*`); «seksjon»/«modul» remain
  author/system words. Adding a locale? All three (`en-GB`, `nb`, `nn`) are parity-checked by
  `test/participant-translations.test.js`.
- **Never mute a step with `opacity`.** v2.11.0 shipped `opacity: .72` on later steps and measured
  **2.91:1** — below WCAG AA. Opacity hits title, kind label and status pill alike and is invisible
  to the tokens. Quiet comes from size, weight and chrome; contrast stays ≥ 4.5:1. Guarded by
  `participant-course-sequence.spec.ts` → "every step label meets WCAG AA contrast", which folds in
  inherited opacity when it measures.
- **The course-level discussion is collapsed by default and mounted on first open**
  (`.course-discussion-toggle` / `.course-discussion-body`). Once the sequence went quiet, an
  always-expanded board outweighed the course content. Since **#923 it is the ONLY discussion
  surface** — see entry 16. Guarded by "the course-level discussion stays collapsed until asked
  for"; `participant-discussions.spec.ts` expands it first.
- **The list and the open course are two states, not two panes (#921/#922).** The list auto-loads
  (`loadParticipantConsoleConfig` ends with `loadParticipantCourses()`) and every card is expanded —
  progress bar + certificate are visible without a click. **#939:** a COMPLETED course is one green row instead — no progress bar, and the certificate rides on the row as `.course-certificate-link`, not in a `.course-certificate-banner` in the body. ⚠️ "Completed" here means `isCourseCompleted()` — certificate issued OR status COMPLETED — because a certificate is permanent while a course that gains content falls back to IN_PROGRESS. Reading only the status made the row disagree with the sort order and dropped the certificate link entirely (found in QA, 2026-08-20); only `.course-detail-slot` (the
  sequence) waits for the course to be opened. Opening a course hides the other cards entirely
  (`.course-accordion--focused .course-accordion-item:not(.is-focused){display:none}`), hides
  `#loadCoursesBtn`, and shows `#courseBackBar`. **The `.course-accordion-header` is no longer a
  disclosure toggle** — it navigates, and it is idempotent. `?courseId=` + `history.pushState`
  make the browser Back button do the same thing as the back link.
- **The section reader's action is ONE button (#924).** «Marker seksjon lest, og gå videre» marks
  read AND opens the next element in the same click. "Next" is read from `courseSequences`
  (the course's mixed item order) via `nextEntryAfter` — **never from a section-only list**, or a
  module deliberately placed between two sections would be skipped. The label changes when the next
  element is a module (`courses.section.markReadAndTest`). **The final element gets no button at
  all**; `markFinalSectionReadSilently` then registers the read, because the certificate gate needs
  every section read (entry 6) and a reading-course's last section would otherwise be unreachable.

## 6c. Section HTML sinks + client/server sanitizer parity (#814)

Server-rendered learning-section HTML is injected via `innerHTML` in **two** places; both re-sanitize
client-side (defense-in-depth). The client policy MUST match the server or allowed embeds get stripped.

| Surface | Where |
| --- | --- |
| Server policy (source of truth) | `src/modules/course/sectionContent.ts` — DOMPurify + `ADD_TAGS:["iframe"]` + embed attrs + `ALLOWED_VIDEO_IFRAME_HOSTS` (youtube×3 + player.vimeo.com, https only) |
| Client sanitizer (mirror) | `public/static/sanitize.js` `sanitizeSectionHtml` — vendored DOMPurify `public/static/vendor/purify-3.4.10.es.js` |
| Sink 1: participant section reader | `public/participant.js` `renderSectionReaderInto` → `bodyEl.innerHTML = sanitizeSectionHtml(body.html)` |
| Sink 2: SMO editor live preview | `public/static/admin-content-sections.js` `refreshPreview` → `pane.innerHTML = sanitizeSectionHtml(data.html)` |

**Maintenance hazard:** if you change the server's allowed tags/attrs or the iframe host allowlist in
`sectionContent.ts`, update `sanitize.js` in the SAME change (the host list is duplicated). Guard test:
`test/e2e/participant-section-sanitize.spec.ts` (strips script/onerror/non-allowlisted iframe, keeps the
YouTube embed). Error strings must never be interpolated raw into `innerHTML` — `escapeHtml(String(err))`
or `showToast` (textContent); see `public/admin-platform.js` / `public/profile.js`.

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

## 11. Section SVG assets — sanitisation + localisation (#657)

SVG section drawings touch upload (sanitise), serving (CSP/nosniff + per-locale variant), and
rendering (preview + participant must thread the locale). A fix in one path (e.g. accept SVG in the
upload mime list) silently leaves the others wrong (an unsanitised serve, or a translated variant
that never reaches the viewer because the locale isn't threaded).

| Surface | Where | Notes |
|---------|-------|-------|
| Allowlist + sanitise on upload | `src/modules/course/assetCommands.ts` → `ALLOWED_ASSET_MIME_TYPES`, `createSectionAsset` | SVG sanitised before `putAsset` |
| Sanitiser (source of truth) | `src/modules/course/svgSanitizer.ts` → `sanitizeSvg` + text helpers | strips script/handlers/`foreignObject`/`<a>` |
| Localise command | `assetCommands.ts` → `localizeSectionAssets`; LLM `localizeSvgTexts` | per-locale variants → `localizedBlobPaths` |
| Localise route (explicit) | `src/routes/adminSections.ts` `POST /:sectionId/assets/localize` | author "Translate" action only |
| Serve (headers + variant) | `src/routes/contentAssets.ts`; `getSectionAssetContent(assetId, locale)` | CSP `sandbox` + nosniff for SVG; `?locale=` picks variant |
| Locale threading (render) | `src/modules/course/sectionContent.ts` → `renderSectionMarkdown(md, locale)` → `resolveAssetUrls` appends `?locale=` | participant: `src/routes/courses.ts`; preview: `adminSections.ts /preview` |
| Client upload + translate trigger | `public/static/admin-content-sections.js` (`accept` incl. svg; translate loop calls `/assets/localize`; preview sends `locale`) | `hydrateContentAssetImages` preserves the `?locale=` query |

**Guards:** `test/unit/svg-sanitizer.test.ts` (XSS vectors + text round-trip), `test/unit/svg-text-localization.test.ts` (stub + order/count), `test/m2-section-assets.test.ts` (upload sanitised + serve headers + localise→variant).

## 12. Admin-content client gating — roles & identity from /api/me, NOT identityDefaults (#690)

Every admin-content page (`/admin-content/*`) decides what to show based on the signed-in user's
**roles**: admin-only buttons, and the top **workspace nav** (items are filtered by `requiredRoles`).
The trap: `participantRuntimeConfig.identityDefaults` is populated **only in mock-role mode** —
`participantConsole.ts` sends it as `undefined` in prod/Entra. So any page that reads roles/identity
from `identityDefaults` works locally and silently shows **nothing** (hidden admin controls, empty
top nav) in prod. The live roles come from `GET /api/me` (`user.roles`, the token's roles). A fix on
one page leaves siblings broken — this bit Klasser + Seksjoner together (v1.3.87→1.3.88).

| Surface | Where | Notes |
|---------|-------|-------|
| Live roles source | `GET /api/me` → `user.roles` (`src/routes/me.ts`) | token roles via `request.context.roles` |
| Roles helper (per page) | `resolveActiveWorkspaceRoles()` in each `admin-content-*.js` | live `/api/me` → identityDefaults → `["SUBJECT_MATTER_OWNER"]` |
| Admin-button gating | `admin-content-classes.js` `isAdministrator` (from `/api/me`) | gates import/sync buttons |
| Workspace nav filter | `resolveWorkspaceNavigationItems(navigation.items, rolesCsv, path)` | empty `navItems` OR empty roles ⇒ `workspaceNav.hidden` |
| Correct reference impls | `admin-content-courses.js`, `-library.js`, `-calibration.js` | already fetch `/api/me` into `activeUserRoles` |
| Was broken (now fixed) | `admin-content-classes.js`, `admin-content-sections.js` | classes passed whole config as navItems; sections passed `roles=""` |

**Guards (must mock the PROD shape — no identityDefaults, roles only via `/api/me`):**
`test/e2e/admin-content-classes.spec.ts` "admin buttons + top nav render in prod-shaped config";
`test/e2e/section-editor.spec.ts` "top workspace nav renders in prod-shaped config". A mock that sets
**both** identityDefaults and `/api/me` hides this class of bug — always include a prod-shape case.

## 13. Content lifecycle — publiser/avpubliser/arkiver/gjenopprett/slett on 3 entities (#705)

Kurs, modul **and** seksjon share one lifecycle: states **Utkast/Publisert/Arkivert**, actions
**Publiser⇄Avpubliser · Arkiver⇄Gjenopprett · Slett**, in that order, with the same four guards.
A change to any rule (a new guard, a label, the auto-unpublish behaviour) must touch all three list
UIs and the three command modules together. The integrity invariant (a published course never holds
an unavailable module/section) is enforced by G2, **not** by the participant-side "Ikke tilgjengelig"
fallback (that is only a safety net, #502-followup). Canonical model: `doc/design/CONTENT_LIFECYCLE.md`.

**Cascade publish (#734):** G2 stops content being *withdrawn* from under a course, but a course could
still be published while its items were never published (draft modules/sections added via API/import).
Course publish now **detects** unpublished items and either cascade-publishes them (items → course) or
blocks with the reasons — a second enforcement point for I1. This spans the publish route, a new
preview endpoint, a course-command service, and a course-list/detail confirm dialog; a change to the
cascade policy (wording, an escape-hatch option, which items count as publishable) must touch all of them.

| Surface | Where | Notes |
|---------|-------|-------|
| Shared guards (source of truth) | `src/modules/course/contentLifecycle.ts` | G2 `assertModuleNotInAnyCourse`/`assertSectionNotInAnyCourse`; G3 `assertCourseHasNoInProgressParticipants` |
| Cascade-publish service | `src/modules/course/coursePublishService.ts` (`getCoursePublishPreview`, `publishCourseCascade`) | Inspects items + per-item publishability (module→`validateModuleVersionForPublish`, section→has content); publishes items then course; 422 if any item un-publishable (I1) |
| Course publish route | `src/routes/adminCourses.ts` (`GET /:id/publish-preview`, `POST /:id/publish` `{publishItems}`) | 409 needs-confirm / 422 blocked / 200 `{course,publishedItems}`. Agent tokens denied (not in `agentTokenScope` allowlist) |
| Cascade-publish dialog UI | `public/static/admin-content-courses.js` (`publishCourseInAdmin`→preview, `openCascadePublishDialog`) + `#cascadePublishDialog` in `admin-content-courses.html` | Lists unpublished items; confirm cascades; blocked mode hides confirm (`setHidden`). i18n `adminContent.courses.cascadePublish.*` |
| Module commands | `src/modules/adminContent/adminContentCommands.ts` (`unpublishModule`, `archiveModule`) + repo `archiveModule` (auto-unpublish) | G2 on unpublish+archive; delete-in-course guard in `adminContent.ts` route |
| Course commands | `src/modules/course/courseCommands.ts` (`unpublishCourse`, `archiveCourse`) | G3 on both; archive auto-unpublishes (I3); delete blocked by completions (G4) |
| Section commands | `src/modules/course/sectionCommands.ts` (`publishSection`/`unpublishSection`/`archiveSection`/`restoreSection`/`deleteSection`) | G2 on unpublish/archive/delete; archive auto-unpublishes |
| Routes | `adminContent.ts` (modules), `adminCourses.ts` (`/unpublish`), `adminSections.ts` (`/publish,/unpublish,/archive,/restore`) | `ValidationError` → 400 with named courses; module-delete keeps 409/`module_in_use` but reuses the named-courses message (#705); module publish rejects an unknown version 404 (no unguarded fallthrough) |
| Shared status badge | `public/static/content-status-badge.js` (`lifecycleStatusBadge`, `moduleLibraryStatusBadge`) + i18n `adminContent.lifecycle.status.*` | **#705: single source for all three lists.** Course/section/library rows all render it (Utkast/Publisert/Arkivert). The module library's 5-state (`deriveLibraryStatus`) is collapsed to 3 + a «nyere utkast» `.status-chip`. Change the badge in ONE place. |
| Module list UI | `public/static/admin-content-library.js` (`statusBadge` → `moduleLibraryStatusBadge`, row actions) | publish/unpublish/archive/restore + status column; badge now the shared 3-state |
| Course list UI | `public/static/admin-content-courses.js` (`courseStatus`/`courseStatusBadge` → shared, `unpublishCourseInAdmin`, Status column) | Avpubliser + status column; badge was hardcoded Norwegian, now shared i18n |
| Section list UI | `public/static/admin-content-sections.js` (`sectionStatus`/`statusBadge` → shared/`sectionLifecycle`, archived toggle) | status column + all lifecycle actions; badge now shared i18n |
| Shared badge style | `public/static/shared.css` → `.status-badge--{draft,published,archived}` + `.status-chip` | one badge style across all three lists (#705) |
| Course delete audit | `src/modules/course/courseCommands.ts` (`deleteCourse`) | logs `course_deleted` (#705; was mislogged as `course_archived`) |

**Cascade delete (#762, ADMINISTRATOR-only):** the *inverse* of cascade publish — a destructive
cleanup that deletes a course together with the modules/sections it **exclusively** owns, while
never destroying preserved records (submissions/certifications/completions). Shared content is
spared (only unlinked). All-or-nothing: any blocker aborts the whole delete. This spans a course-
command service, two ADMINISTRATOR-gated routes, and a course-list confirm dialog; a change to the
exclusivity/preserved-record policy or the FK deletion order must touch all of them. The service
reuses the proven bulk-purge FK order (`ModuleVersion` before its rubric/prompt/mcq versions).

| Surface | Where | Notes |
|---------|-------|-------|
| Cascade-delete service | `src/modules/course/courseCascadeDeleteService.ts` (`getCourseCascadeDeletePreview`, `cascadeDeleteCourse`) | Exclusivity via `findCoursesContainingModule/Section`; preserved records via `adminContentRepository.findModuleDeleteSummary` (`_count.submissions`/`certificationStatuses`) + `courseCompletion.count`; one transaction, FK order load-bearing; audit `course_cascade_deleted` + per-module `module_deleted` |
| Cascade-delete routes | `src/routes/adminCourses.ts` (`GET /:id/cascade-delete-preview`, `POST /:id/cascade-delete`) | **ADMINISTRATOR-only** per-route gate (403 otherwise); 400 `validation_error` w/ `details.blockers` when blocked; 200 summary otherwise |
| Cascade-delete dialog UI | `public/static/admin-content-courses.js` (`isAdministrator`, row `data-action="cascade-delete"`, `openCascadeDeleteDialog`, `renderCascadeDeletePreview`) + `#cascadeDeleteDialog` in `admin-content-courses.html` | Row action gated on `/api/me` ADMINISTRATOR role (surface #12, never identityDefaults); dialog lists deleted/spared/blockers; confirm hidden when blockers (`setHidden`); hardcoded-Norwegian labels |

**Guards:** `test/m2-content-lifecycle.test.ts` (G2/G3/I3 across all three); `test/m2-module-archive.test.ts` (archive auto-unpublishes); `test/m2-course-cascade-publish.test.ts` (#734 — preview, cascade, blocked-nothing-half-published); `test/m2-course-cascade-delete.test.ts` (#762 — deletes exclusive modules+sections, spares shared, blocks on submission/completion, preview shape, SMO 403); `test/e2e/admin-content-workspaces.spec.ts` "courses list can unpublish a published course (#705)" + "sections list shows status and runs the lifecycle actions (#705)"; `test/e2e/admin-content-course-cascade-publish.spec.ts` (#734 dialog: cascade confirm, direct-publish, blocked); `test/e2e/admin-content-course-cascade-delete.spec.ts` (#762 — action hidden for SMO / shown for ADMINISTRATOR, dialog lists preview, confirm fires delete, blockers hide confirm).

## 14. Admin-content list pages — shared shape across Kurs/Moduler/Seksjoner/Klasser (#705-UX)

The four admin-content list pages are intentionally aligned so an author recognises the same shape
everywhere. A change to any shared element (filter pills, status badge, action-button row, the
"used in courses" popover, the top-nav i18n, the Kalibrering tab) should be applied to all relevant
pages — they are separate static JS/HTML files, so consistency is by convention, not a component.

| Shared element | Where | Notes |
|----------------|-------|-------|
| Filter pills | `.list-filters`/`.list-filter-btn` in `shared.css`; built per page (`courseFilterBar`/`sectionFilterBar`; modules uses its own `.library-filter-btn`) | Alle/Aktive/Publiserte/Arkiverte |
| Course filter dropdown (#745) | modules: `#libraryCourseFilter` (`.library-course-select`) built by `rebuildCourseFilterOptions`; sections: `#sectionCourseFilter` (`.list-course-select`) built by `sectionCourseFilterBar` | «Alle kurs» / per-course / «Ikke i noe kurs»; client-side, dedupes each item's `courses[]`, composes with status filter + search. NOT on the Kurs list itself. |
| Status badge | `.status-badge--{draft,published,archived}` in `shared.css` (entry #13) | Utkast/Publisert/Arkivert |
| Action row | `.row-actions` in `shared.css` | wraps `.row-action-btn` group |
| "Used in courses" popover | `.course-count-btn`/`.courses-popover` in `shared.css`; `showCoursesPopover` (library), `showSectionCoursesPopover` (sections) | count + click popover |
| Top workspace nav i18n | each page's `renderWorkspaceNavigation` `buildLabel: (item) => tNav/t(item.labelKey)` | **never** render `item.labelKey` raw (was the classes bug, D) |
| Kalibrering tab + reveal | `#navKalibrering` in each `.html` + `renderContentAreaNav()` role-gate in each page JS | role-gated visibility |
| Landing entry | capability `admin-content` path = `/admin-content/courses` (`src/config/capabilities.ts`) | «Innholdsforvaltning» opens on Kurs |

**Guards:** `test/e2e/admin-content-classes.spec.ts` "admin buttons + top nav render in prod-shaped config" (asserts a REAL i18n key resolves, not raw); `test/e2e/admin-content-workspaces.spec.ts` course archive (filter pill), unpublish, sections lifecycle; `test/e2e/admin-content-course-links-library-filter.spec.ts` course filter (modules + sections). When adding a column/filter to one list, mirror it where it applies and update this entry.

Related (course builder, not a list page): the course builder item list (`renderModuleList` in `admin-content-courses.js`) gives each row an **«Åpne»** link (`target="_blank"`) to that item's editor — module → `/admin-content/module/<id>/conversation`, section → `/admin-content/sections?id=<id>` (#744, same guard spec).

## 15. Agent Authoring — draft-only invariant across 3 entities + token scope (EPIC #647)

Agents create content through the **same** `admin_content` commands humans use, and the
"agent-created content is never live" guarantee is enforced **per entity + per call**, not in
one place. A change to any create/import path, or to the token scope, must keep all of these true.

| Surface | Where | Draft-only rule |
|---------|-------|-----------------|
| Package contract (source of truth) | `src/modules/adminContent/agentAuthoringSchemas.ts` (`.strict()`, no publish/audit fields) | hallucinated publish fields → `unknown_field` |
| Validation report + plan | `src/modules/adminContent/agentAuthoringValidationService.ts` | no DB writes; plan only when `errors == 0` |
| Module create | `POST /modules/import` (`src/routes/adminContent.ts`) → `importModuleFromEnvelope` | agent tokens forced to `createNew` + `autoPublish:false`; empty `audit` ⇒ never auto-publishes |
| Section create | `POST /sections` (`src/routes/adminSections.ts`) → `createSection({draft})` | agent tokens forced `draft:true` (else section auto-publishes on save) |
| Course create | `POST /courses` (`src/routes/adminCourses.ts`) → `createCourse` | `publishedAt` stays null (no publish call) |
| Course items | `PUT /courses/:id/items` | agent tokens: only on **unpublished** courses |
| Token scope | `src/auth/agentTokenScope.ts` (`enforceAgentTokenScope`) | `aat_` tokens reach ONLY the 5 draft ops; no publish path, no token self-mint |
| Token roles | `src/auth/agentAuthoringTokenService.ts` + `authenticate.ts` | issuer's effective roles frozen on the token (`rolesJson`) — not re-derived (#651 stage-403 fix) |
| Audit trace | `source: agent_authoring` + `agentRunId` in every write's metadata (AA-5) | reconstruct a run from audit |
| User surface | «Agent-tilgang» section on `/profile` (`public/profile.js`, role-gated via `/api/me` — see entry #12) | issue/copy-once/list/revoke |

**Guards:** `test/agent-authoring-validate.test.ts` (validate + no-writes), `…-orchestration.test.ts`
(drafts + links across all 3 modes, both roles), `…-audit.test.ts` (agentRunId + partial failure),
`…-token.test.ts` (scope, expiry/revoke, role snapshot), `…-skill-import.test.ts` (fixture through
the skill script), `test/unit/agent-authoring-validation.test.ts` (rules), `test/e2e/profile-agent-tokens.spec.ts`
(token UI). User docs: `doc/AGENT_ACCESS_GUIDE.md`; API: `doc/API_REFERENCE.md`; design: `doc/design/AGENT_AUTHORING_647.md`.

## 16. Module workspace view tabs — audience, visibility and unsaved state (#896 S1)

The module workspace is **three views of one module**, not three pages: Forhåndsvisning, Rediger
(default) and Innstillinger. Forhåndsvisning and Rediger share **one** DOM panel — the tabs only
change what is visible and *who the content is rendered for*. A change to any of the four
behaviours below has to touch every row here, because they are wired in three different files.

| Surface | Where | Notes |
|---------|-------|-------|
| Tab bar + panels | `#tabPreview`/`#tabEdit`/`#tabSettings`, `#tabPanelModule`, `#tabPanelSettings` in `public/admin-content.html` | `role="tablist"`; Forhåndsvisning and Rediger share `#tabPanelModule`, whose `aria-labelledby` follows the active tab |
| Tab state machine | `applyTabState` / `switchToTab` / `bindViewTabs` in `public/static/admin-content-shell.js` | selection, roving `tabindex` (**initialised on mount**, not on first switch), arrow/Home/End, `setHidden` for every pane |
| Tab in the URL | `tabFromUrl` / `syncTabToUrl` (`?tab=preview\|settings`) | the tab survives reload and is shareable; Rediger is the default and stays OUT of the query so the plain route is canonical. `replaceState`, not `push` — Back must mean previous page, not previous tab. `/advanced` 301-redirects here since S3c |
| **Audience filtering** | `audience` option in `public/static/admin-content-preview.js` (`buildPreviewHtml`, `renderPreviewMcqQuestions`, `renderPreviewCriteria`), set from `activeTab` at the shell's call site | `"participant"` withholds assessor expectation, MCQ correct-answer marking **and** the answer meta line, rationale, and `candidateVisible:false` criteria. Any NEW author-only field added to the preview must be gated here too, or it leaks into the tab that promises the learner's view |
| Unsaved-state guard | `unsavedTabSwitchKind` + `#dialogUnsavedTabSwitch` in the shell | Warns on the **same signal as the status rail**: an open direct-edit form (`"form"`) or any `sessionDraft` (`"draft"`). The two cost different things, so the dialog copy and the confirm button switch with the kind — form values are LOST (`Forkast og bytt`, danger), a draft is only unsaved (`Bytt likevel`, primary) and is carried along. Every dismissal path — button, Escape, backdrop — routes through the dialog's `close` event so focus and selection cannot disagree |
| **Same guard on the two language switches** (#920) | `confirmLocaleSwitchDiscard` in the shell, called from the content-language bar (`renderPreviewLocaleBar`) and the UI-language selector (`populateUiLocaleSelect`) | §7 requires the same warning on a language change as on a tab change, and for the same reason: both re-render the pane the edit form is built INTO, so its fields are DOM-only work the re-render destroys. The guard used to cover `activeTab === "settings"` ONLY, so «Rediger direkte» + type + switch language replaced the typed text with the stored text of the new language, silently. One deliberate difference from the tab switch: `"draft"` does not ask, because a language switch re-renders FROM the draft and endangers nothing — asking would put a dialog in front of every language switch for the life of the draft. Dirty, never presence: since v2.18.13 the form is open the whole time Rediger is |
| **Attention marker** (#926) | `markTabAttention` / `clearTabAttention` in the shell, `.module-tab[data-attention]` in `public/admin-content.html` | Set when content lands in a tab the author is not looking at (generated criteria → Innstillinger). Cleared on open — it means «something happened you have not seen», so it must not be able to stick. Double-coded: dot, `aria-label` suffix, live region. The suffix is rebuilt from `t()`, so a UI-language switch has to re-apply it |
| Conditional visibility | `setHidden` from `public/static/dom-visibility.js` | `.workspace-shell` is `display:grid` and the panels are `.card`; note the mirror trap — the `hidden` **attribute** survives `setHidden(el, false)`, so panels must start with inline `style="display:none"` |

**Guards (`test/e2e/admin-content-workspaces.spec.ts`):** "opens on Rediger and the tabs switch
between the three views", "Forhaandsvisning withholds the answer key and assessor-only content",
"leaving Rediger with an open edit form warns…", "Escape on the unsaved-changes dialog behaves like
staying", "the tablist is one tab stop…", "staying after an arrow-key switch returns focus…", "help
on the module route explains the tabs…", "switching language with unsaved edits asks first, and
staying keeps the typed text" (#920 — both switchers), "switching language with an untouched editor
is silent, and keeps the editor open" (the other half: a guard on presence would ask every time).
DOM contract: `test/dom/admin-content-workspaces.dom.test.js`
("exposes the three module views as one tablist"). Docs: `doc/route-map.md`,
`doc/design/ADMIN_CONTENT_IA_ARCHITECTURE.md`, `doc/design/STATUS_896.md`,
`doc/pilot/VERIFICATION_CHECKLIST.md`. **S3 will move the settings fields into the tab and delete
the Avansert page — update every row above in that PR.**

## 17. Direct-edit save — one button, five transactions (#896 S2)

`Lagre` in the direct-edit form translates **and** writes. The order is load-bearing: translate
first (nothing written, abortable), persist second. Three flows now share one piece of state and
must be changed together — three QA rounds found a defect in each pairing.

| Surface | Where | Notes |
|---------|-------|-------|
| Capture + no-change check | `previewEditConfirm` handler in `public/static/admin-content-shell.js` | Baselines are captured when the form OPENS (`existingCriteriaRecord`). No edit ⇒ no LLM call and no version. Optional fields read with `??` where the schema tolerates empty (`candidateTaskConstraints`) and `||` where it does not (MCQ `rationale` — min(1), see below) |
| Busy state | `setFormBusy` | Disables the form buttons **and** the UI/preview locale pickers: a locale switch runs `retranslateChat`, which rebuilds the form under a running save. Must be released on BOTH the success and abort paths — releasing only on abort left the language selector dead for the session |
| Abort | `abort.signal` listener (not the button) | The AbortController is NOT wired to the localize requests, so the call is **orphaned**, not stopped: `commit()` refuses to run once aborted and the response lands nowhere. The LLM call still completes and still costs |
| Interplay with the tab dialog | `pendingSaveCommit` + `unsavedTabSwitchKind` in the shell | A translation that resolves while the discard dialog is open is HELD: «Bli værende» finishes the save, «Forkast» drops it. Aborting on dialog-open threw away a completed translation; committing during it saved values the author was about to discard |
| Persistence | `saveDraftBundleInBackground` | **One composed call** to `POST /modules/:id/versions` since #906 — rename, rubric, prompt, MCQ and the version share a transaction. Untouched criteria are OMITTED from the patch (not sent as `null`, which would wipe draft criteria) so #902 only affects authors who really edited criteria |
| Localization honesty | `dropFailedLocales` / `dropLocale` | Applies to **every** field since #905: a locale whose translation failed is dropped rather than filled with a copy of the source. This is what made the S4 publish gate possible — before it, a failed translation was structurally identical to a real one |

**Guards (`test/e2e/admin-content-workspaces.spec.ts`):** "Lagre translates and saves in one step,
and an untouched form does neither", "cancelling the save writes nothing and hands the fields
back", "discarding while a save is running writes nothing", "a failed translation saves one
language honestly instead of three copies". Also `admin-content-mcq-only-revision.spec.ts` (an
MCQ-only module must make a real edit before it saves).

## 18. Publishing a module version — four doors (#896 S4)

A module version can go live through four different code paths. A gate on one of them is not a
gate; it is a detour sign. When you change what publishing requires, change **all** of these in
the same PR — the participant sees the same module regardless of which door it came through.

| Door | Where | Behaviour under the translation gate |
|------|-------|--------------------------------------|
| Author's publish action | `POST /modules/:id/module-versions/:vid/publish` in `src/routes/adminContent.ts` | 422 `publish_blocked_by_validation` with `translation_incomplete` issues carrying `field` + `missingLocales` |
| Course cascade | `evaluateModule` in `src/modules/course/coursePublishService.ts` | Module reported `publishable: false` in `publish-preview`; cascade returns 422 and publishes **nothing** (not the module, not the course) |
| Import auto-publish | `importModulePayload` in `src/modules/adminContent/contentImportService.ts` | Import **succeeds**, auto-publish is skipped — the module lands as a draft. Failing the transaction would lose the import; leaving it a draft matches the agreed import model. It returns `heldBackByTranslationGate` so `importCourseFromEnvelope` can keep the COURSE a draft too — `publishCourse` only checks that a module item exists, so publishing around a held-back module produces a live course whose module is not available |
| Calibration thresholds | `publishModuleVersionWithThresholds` in `src/modules/adminContent/adminContentCommands.ts` | **Deliberately exempt.** It clones the already-live version and changes only pass thresholds; no new participant-facing text, and gating would block calibration on modules published before the gate existed |

The shared check is `validateTranslationCompleteness` + `validateMcqTranslationCompleteness` /
`missingLocalesFor` in `src/modules/adminContent/contentValidationService.ts`. It reads the
**stored** value (serialized), never a flattened one — flattening picks the first non-empty locale
and hides exactly the gap.

**The field set must be identical on all three enforcing doors** (`title`, `description`,
`taskText`, `assessorExpectedContent`, `candidateTaskConstraints`, MCQ questions — each only when
present). Two gates that disagree about what "complete" means tell the author different things
depending on which button they pressed. The first QA round found exactly this: the module route
gated four fields, the cascade the same four, and import only three.

**The client's `TRANSLATION_GATE_FIELDS`** in `public/static/admin-content-shell.js` mirrors the
same list. The gap-fill offers a fix per field, so a field the server blocks on but the client does
not know about produces an action that cannot resolve the block.

**A bare string is `nb` on both sides.** `missingLocalesFor`'s `sourceLocale` default and the
client's `LEGACY_STRING_LOCALE` are the same claim about the same bytes. Change one and an author
working in a different UI language gets their text relabelled: the second QA round found a
Norwegian legacy title being saved under `en-GB` because the client accepted a bare string as the
source for whatever locale it was asked for. New saves avoid the question entirely by writing a
one-key map.

**Gate messages are rendered from `field` + `missingLocales`, never from `message`.** Three
surfaces show them — the conversational workspace, the advanced editor, and the course cascade
dialog — and each has its own field-label keys. The server's `message` is English on the module
route and Norwegian in the cascade; both read as leaked internal strings in the wrong UI language.
It is the fallback for blockers that carry no structured fields.

**Two localizers, and the gap-fill must pick.** `generate/module-draft/localize` translates the
scenario, answer key and constraints together (coherent, one call) but its schema DEMANDS a
non-empty task text and answer key — so it 400s for `MCQ_ONLY` and for free-text modules with no
answer key. `sections/localize` takes one field at a time (`title` for short text, `bodyMarkdown`
for long) and works everywhere. The description is only ever reachable through the second one: the
draft localizer does not return it. Import surfaces: **both** the library
(`admin-content-library.js`) and the advanced editor (`admin-content.js`) must send
`autoPublish: false`, or the same package goes live or stays a draft depending on which page it was
imported from.

**Guards:** `test/m2-publish-translation-gate-896.test.ts` (door 1 + the locale arithmetic),
`test/m2-publish-gate-surfaces-896.test.ts` (doors 2 and 3, both directions),
`test/unit/content-import-service.test.ts` (door 3 at unit level), and in
`test/e2e/admin-content-workspaces.spec.ts`: "shell publish names the missing languages and offers
to fill only the gaps" (the author-facing message, the gap-fill, and that already-translated
locales survive untouched), "gap-fill works on a FREETEXT_ONLY module…" (the save reads the
**stored** assessment mode — reading only `sessionDraft` made the save demand an MCQ set that
module type does not have), and "gap-fill can source a title-only gap on a module with no task
text" (the source locale comes from the fields the gate named, not a fixed pair).

## 19. Cloning a module version — three callers, one forgotten field (#896 S5)

Three code paths build a new `ModuleVersion` from an existing one. `assessmentMode` has a schema
default of `FREETEXT_PLUS_MCQ`, so a clone that forgets to carry it does not fail — it silently
converts the module to a different type.

| Caller | Where | Carries `assessmentMode`? |
|--------|-------|---------------------------|
| Restore an earlier version | `restoreModuleVersion` in `adminContentCommands.ts` | Yes |
| Calibration threshold publish | `publishModuleVersionWithThresholds` in `adminContentCommands.ts` | Yes — **it did not until #896 S5**; calibrating an MCQ-only module republished it as free-text-plus-MCQ |
| Import | `importModulePayload` in `contentImportService.ts` | Yes — reads it from the envelope |

The shared read is `findActiveModuleVersionForClone`. Anything it does not `select` is silently
absent from every clone, so adding a column to `ModuleVersion` means checking that select too.

**Guards:** `test/m2-restore-module-version-896.test.ts` → "carries the assessment mode, so
restoring an MCQ-only version does not change the module type".

**Restore is append-only.** It copies forward; it never rewinds. The versions created after the
restored one stay in the list, which is what makes restoring the wrong version undoable — and is
the reason the UI can offer the action without a scary confirmation. A restored version is a
DRAFT even when its source was published; publishing stays separate and still passes the #896 S4
translation gate. Guard: same file, "restores a published version as a draft, leaving the live
version untouched".

## 20. Innstillinger-feltene — én liste, seks lesere (#896 S3c)

Hvert felt i Innstillinger må registreres tre steder for å oppføre seg riktig, og hvert av de tre
fantes i flere kopier:

| Leser | Hva som går galt uten | Kopier før v2.18.10 |
|-------|----------------------|---------------------|
| `stampRenderedValues` | Feltet får ingen `renderedValue`, så de to under ser det aldri som endret | 3 (én per seksjon) |
| `captureSettingsDraftValues` / `restoreSettingsDraftValues` | Verdien nullstilles stille når panelet rendres på nytt — og panelet rendres på nytt hver gang en seksjon åpnes | 1 |
| `hasUnsavedSettingsEdits` | Fanebytte forkaster verdien uten advarsel | 1 |
| Selve lagringen | Verdien sendes aldri | 1 |

Feilen dette produserer er **stille**: verdien står på skjermen, forsvinner ved neste re-render, og
ingenting advarer. QA 2026-08-16 fant at de fire poengregelfeltene fra v2.18.9 var registrert i
lagringen, men i **ingen** av de tre andre.

Listen er nå én — `SETTINGS_INPUT_IDS` i `admin-content-shell.js`, gruppert etter hvilken seksjon
som rendrer feltet — og `stampRenderedValues` / `anyFieldDirty` er de eneste leserne. **Et nytt felt
skal legges i den listen, ikke ved siden av den.** Felt i sammenslåtte seksjoner (instruks, skjema)
er ikke i DOM-en før seksjonen åpnes; verdiene deres ligger i `settingsDraftValues` til da, og
`hasUnsavedSettingsEdits` sjekker begge deler.

**Guard:** `test/e2e/admin-content-workspaces.spec.ts` → "every settings field survives a re-render
and is seen by the exit guard" — den går gjennom hvert felt hver for seg, fordi en test som bare
ser på det første feltet er grønn mens resten er stille.

## 21. Lokalisert tekst redigert i ett språk — merge, aldri overskriv (#892/#902/#905)

Komponeringen skriver lokaliserte felt **verbatim**. En editor som viser ett språk og sender
tilbake det den viser, sletter derfor de to andre. Samme feil er nå gjort fire ganger i #896:
tittel (#892), beskrivelse og sertifiseringsnivå (S3b), vurderingsinstruks (S3c) og kriterier
(#902). `mergeLocaleInto` finnes for å gjøre den én gang.

To regler som begge må holde:

1. **Redigert felt flettes.** `mergeLocaleInto(lagret, redigertSpråk, nyTekst)`.
2. **Urørt felt står uendret, byte for byte.** Å flette en uendret verdi gjør en ren streng — «ett
   språk, ikke oversatt ennå» — om til en tolokalers map som påstår at samme tekst er gyldig i
   begge. Det er en oversettelse ingen har gjort. `buildCriteriaRecordFromEditorState` sammenligner
   derfor mot `localizeValueForLocale(lagret, locale)` før den fletter.

Fella i kriterietilfellet: tilstanden går innom `captureLatestCriteriaState`, som bygger hvert
element på nytt fra DOM-kortene. Den må bære `storedLabel` / `storedDescription` / `locale` videre
fra forrige tilstand, ellers er de borte igjen på vei til lagringen — som er nøyaktig hvordan den
rene strengen overlevde første forsøk på å fikse dette.

### Femte gang: drift-dialogen (#919)

Samme feil, ny flate. `/generate/rubric` blir spurt om `contentLocale` og svarer i det;
`llmCriteriaArrayToStorageRecord` merker svaret `{[locale]: tekst}`. Å godta et forslag skrev det
ettspråks-kartet rett over et kriterium som hadde tre — og slettet to oversettelser som aldri ble
vist og aldri redigert. Rettelsen er den samme regelen som over, i `mergeProposedCriterion` /
`mergeProposedLocalizedField` (`public/static/admin-content-shell.js`).

**To knapper, ikke én.** «Godta valgte» går gjennom `mergeProposedCriteria`; «Godta alle» ga
`proposedRecord` rett til lagringen og hoppet over flettingen helt. Den går nå samme vei, med alle
ID-er som «valgte». Et helt nytt kriterium har ingenting å flette mot og lagres som ettspråks-kart —
å finne på de to andre språkene der er nøyaktig løgnen #892 finnes for å stoppe.

⚠️ **Drift-banneret er i dag ikke synlig noe sted.** `[data-drift-banner]` tegnes av
`renderPreview()`, men etter #896 S3c / v2.18.13 finnes ingen fane der den utskriften både tegnes og
vises: Rediger overskriver ruta med redigeringsskjemaet umiddelbart, Forhåndsvisning undertrykker
banneret (deltakervisning), og Innstillinger skjuler hele panelet. Elementet ligger i DOM-en etter
Forhåndsvisning → Innstillinger, men `isVisible()` er `false`. E2e-vaktene under må derfor
`dispatchEvent("click")` i stedet for å klikke. Det er en egen sak — fletting er rettet, men ingen
forfatter når flaten.

**Guards:** e2e "editing a criterion in one language keeps the other two", "Innstillinger edits
the assessment instruction in one language and keeps the others", "accepting a drift proposal keeps
the two languages it was not shown in" og "accept-all merges too, and a brand-new criterion is
stored as the one language it has".

## 22. Generert innhold som lander i utkastet — seks produsenter, én port (#896 §6 / #926)

Seks funksjoner produserer innhold som skal inn i `sessionDraft`. Alle nås fra samme chat-boks:

| Produsent | Skriver |
|---|---|
| `generateDraftInBackground` | scenario, forventning, rammer |
| `generateMcqInBackground` | MCQ-spørsmål |
| `reviseDraftInBackground` | scenario, forventning, rammer |
| `reviseMcqInBackground` | MCQ-spørsmål |

Alle fire skrev tidligere rett i utkastet med `sessionDraft = buildPreviewCandidate(...)`. Det
brøt §6 — «samtalen foreslår, den overskriver aldri» — men verre: med Rediger-skjemaet åpent ble
feltene **ikke tegnet på nytt**, så forfatteren så sin egen tekst over et utkast som var byttet ut.
Overskrivingen ble først synlig ved lagring.

Alle fire går nå gjennom **`commitOrProposeGenerated`**. Et nytt genereringssteg skal legges der,
ikke ved siden av. Porten avgjør:

- rent skjema → landes som før (et forslag her ville kostet et klikk for det man nettopp ba om)
- skittent skjema → parkeres i samtaleloggen med «Bruk»/«Forkast», og `sessionDraft` **røres ikke**

**Den viktigste detaljen:** dirty-sjekken er `hasOpenEditForm()` — felt som avviker fra det de ble
tegnet med — **ikke** `isEditFormOpen()`. Siden v2.18.13 er skjemaet åpent hele tiden Rediger-fanen
er det, så en vakt på tilstedeværelse gjør hver eneste generering til et forslag.

### Beslektet: hvem andre river skjemaet?

`renderPreview()` skriver rett i `previewContent.innerHTML` og river dermed et åpent
redigeringsskjema. Enhver bakgrunnsjobb som kaller den må sjekke `isEditFormOpen()` først.
`populateSessionDraftCriteriaInBackground` gjorde det på vei UT, men ikke på vei INN — rettet
2026-08-18. Samme spørsmål gjelder neste bakgrunnsjobb noen skriver.

### Fanemerking

Innhold som lander i en fane forfatteren ikke ser på skal merkes: `markTabAttention(tab)`.
Merkingen er dobbelt kodet (prikk, `aria-label`-suffiks, live-region) og fjernes idet fanen åpnes.

**Guards:**
- `test/admin-content-ui-contracts.test.js` → «§6 — generated content goes through the
  propose/commit gate»: én test per produsent, som også avviser en direkte
  `sessionDraft = buildPreviewCandidate(...)` i kroppen. Dette er dekningsvakten — det er *en femte
  produsent lagt til uten porten* som er den sannsynlige regresjonen, ikke at grenen selv blir feil.
- e2e «a revision lands as a proposal when the fields hold unsaved typing» og «an untouched form
  takes the revision straight in, with no extra click». Den andre er ikke pynt: den er vakten mot
  å gate på tilstedeværelse i stedet for på dirty.

## 23. Discussion — course level ONLY, but the item-level data still exists (#923)

Discussion used to exist at three levels (course, module, section). Three places to write split a
conversation that is small to begin with into three half-dead threads, so **from #923 the only
entry point is the course-level board**. What changed is the UI; **nothing was deleted**, and that
distinction is load-bearing for the production check below.

| Surface | Where | State after #923 |
|---------|-------|------------------|
| Course-level board (participant) | `public/participant.js` `renderCourseDetailModules` → `mountDiscussionPanel({courseItemId: null})` | **Kept.** Collapsed by default, mounted on first open. |
| Section-reader board (participant) | `public/participant.js` `renderSectionReaderInto` | **Removed.** No `#sectionReaderDiscussion`, no mount. |
| Module-inline board (participant) | `buildModuleInlinePanel` | Never existed — the module workspace had no board. |
| Per-item «Diskusjon» checkbox (SMO) | `public/static/admin-content-courses.js` `renderModuleList` | **Removed.** The stored `discussionsEnabled` per item is still read on load and written back unchanged by `PUT /courses/:id/items`, so existing values survive a course edit. |
| Course-level «Diskusjon» checkbox (SMO) | `public/static/admin-content-courses.js` (`#discussionsEnabled`) | **Kept** — it still turns the whole course's board off. |
| API | `GET/POST /api/courses/:id/discussions` with `itemId` / `courseItemId` | **Unchanged.** Still accepts item context; still enforces `CourseItem.discussionsEnabled` (`src/modules/discussion/discussionService.ts`). |
| Data | `DiscussionThread.courseItemId` | **Untouched.** No migration, no delete. |

**Why the API and data were left alone:** the product owner's own words (#923, 2026-08-18): *«Jeg
tror ikke dette er i aktivt bruk enda, men jeg kan ved produksjonsetting gå gjennom og verifisere
dette.»* That verification is only possible if the rows are still there. Rolling the UI back
restores the old behaviour with no data work.

**Production checklist for this change (the one irreversible part):**

- [ ] Count threads/posts with a non-null `courseItemId` in **production** before deploying.
- [ ] If the count is not zero: stop, and agree with the product owner what happens to them.

**Guards:** `test/e2e/participant-section-advance.spec.ts` → "seksjonsleseren har ikke lenger sitt
eget diskusjonsboard — kursnivået har det" (asserts the reader has no board *even when the item has
`discussionsEnabled: true`*, and that the course board still mounts);
`test/e2e/participant-discussions.spec.ts` (course-level create/list/reply);
`participant-course-sequence.spec.ts` → "the course-level discussion stays collapsed until asked
for". User docs: `doc/DISCUSSIONS_GUIDE.md`. Design: `doc/DISCUSSIONS_DESIGN.md`.

## 24. Publishing a learning section — four doors (#916)

The section counterpart to § 18. Same rule, different mechanics: a module has a draft-save that is
separate from publishing, while **saving a section publishes it** (latest-wins). So the gate cannot
simply refuse every door — refusing a save would mean an author writing in one language could not
store their work at all, trading a language bug for lost text.

| Door | Where | Behaviour under the translation gate |
|------|-------|--------------------------------------|
| Author's publish action | `POST /sections/:id/publish` → `publishSection` in `src/modules/course/sectionCommands.ts` | 422 `publish_blocked_by_validation` with `translation_incomplete` issues carrying `field` + `missingLocales` |
| Course cascade | `evaluateSection` in `src/modules/course/coursePublishService.ts` (preview) + `publishSection` (the publish step) | Section reported `publishable: false` in `publish-preview`; cascade returns 422 and publishes **nothing** |
| Create with auto-publish | `createSection` (no `draft: true`) | The section is created as a DRAFT. Response carries `translationGate: { heldBack: true, issues[] }`; the audit event records `heldBackByTranslationGate` |
| Content save | `updateSectionContent` | The new version is stored but NOT activated. A live section keeps serving its last complete version; the response carries the same `translationGate` block |

The last two mirror § 18's **import door**, which resolves the identical conflict the same way: the
write succeeds, the activation does not. Standalone section import (#916) never reaches the gate at
all — it always lands unpublished by decision, so there is nothing to hold back.

**Gated fields: `title` and `bodyMarkdown` — that is the section's entire participant-visible
surface.** `bodyMarkdown` only when present, matching § 18's "an absent optional field is not an
untranslated one". Deliberately NOT gated: the localized SVG variants of a section's figures (#657).
They are generated from the text rather than authored, they have a documented fallback (an
untranslated drawing renders in its source language rather than not at all), and gating them would
hold a section with figures to a standard a section without figures is not held to.

**Two consequences worth knowing before changing this:**

1. **A held-back save must stay visible to its author.** `GET /sections/:id` reads the **newest**
   version, not only the active one, and reports `hasUnpublishedChanges`. Reading `activeVersion`
   alone would make the author's own text vanish on reload, which reads as data loss.
2. **Export must read the newest version too.** `buildSectionExportPayload` falls back from
   `activeVersion` to the newest version. Before the gate a section was live the moment it was
   saved, so "active" was always there; now a draft section in a course would otherwise export with
   an empty body and the file would silently lose the content it exists to carry.

**Not covered (known, and identical for modules):** `PATCH /sections/:id/title` can introduce a gap
in an already-live section's title without passing a gate, exactly as `PATCH /modules/:id/title`
can. The title is not versioned, so there is no activation to hold back, and blocking the write
would make a legacy single-language section's title uneditable. The gap is caught the next time the
section is published or its content saved.

**Guards:** `test/m2-section-export-import-916.test.ts` (all four doors, both directions),
`test/unit/section-export-envelope-916.test.ts` (the field set and the locale arithmetic),
`test/m2-course-cascade-publish.test.ts` (the cascade with complete sections still publishes), and
`test/e2e/section-portability-916.spec.ts` for the client half — the gate messages must be rendered
from `field` + `missingLocales` in the author's language, never from the server's English `message`,
and a held-back save must not show a plain "Seksjon lagret."

## 25. «Hva inneholder dette kurset?» — to navngitte dører, ikke åtte kallere (#958)

Fram til v2.26.x fantes én aksessor, `courseRepository.findCourseItems(courseId)`. Den hentet
`module.archivedAt`, `module.activeVersionId`, `module.activeVersion.publishedAt`,
`section.archivedAt` og `section.activeVersionId` — nøyaktig feltene som avgjør tilgjengelighet — og
**filtrerte ingenting**. Åtte kallere tok hver sin avgjørelse, med fem ulike regler. Samme rad ga
«tilgjengelig», «påkrevd», «publiserbar» og «slettbar» ulike svar. Det er roten til #938, #944, #945
og #992, og mønster 2 («ueid policy») i `doc/COMPLEXITY_SCAN.md`.

**Kuren er ikke et filter til.** Det er at kalleren ikke lenger *kan* unnlate å ta stilling: man
velger dør i det man kaller, og deltakerdøra leverer ikke feltene regelen bygger på.

| Dør | For hvem | Hva den gjør med det utilgjengelige |
|---|---|---|
| `findCourseItemsForParticipant` | deltakerflatene + bevisporten | Seksjoner deltakeren ikke kan åpne er **utelatt**. Moduler er alle med, hver med et ferdig avgjort `available`. Returnerer verken `archivedAt`, `activeVersionId` eller `publishedAt` |
| `findAllCourseItems` | forfatterlista, publiseringsgaten, kaskadesletting, eksport | Alt. Bærer `archivedAt` (forfatterlista sender det videre), men ikke `activeVersionId` |

### Kallerne

| Kaller | Regelen den hadde | Dør nå |
|---|---|---|
| `routes/courses.ts` — deltakerdetalj | modul: 3-ledds `available`; seksjon: `isSectionAvailableToParticipant`; telleren: `&& i.available` | deltaker (tre filtre slettet) |
| `routes/courses.ts` — les seksjon | `isSectionAvailableToParticipant` → 404 | deltaker (slettet — oppslaget ER regelen) |
| `routes/courses.ts` — marker lest | `isSectionAvailableToParticipant` → 404 | deltaker (slettet) |
| `courseCompletionService.ts` — bevisporten | `isSectionAvailableToParticipant` | deltaker (slettet) |
| `coursePublishService.ts` — publiseringsgaten | ingen på elementnivå | alt |
| `courseCascadeDeleteService.ts` — sletting | ingen | alt |
| `routes/adminCourses.ts` — forfatterlista | ingen; sender `archivedAt` til klienten | alt |
| `adminContent/adminContentQueries.ts` — eksport | ingen | alt |

### Hvorfor moduler og seksjoner behandles ULIKT

Asymmetrien er bevisst, og den er den eneste delen av dette som er et *valg*:

- En **seksjon** deltakeren ikke kan åpne har ingen fungerende representasjon. Begge deltakerrutene
  svarer 404, bevisporten krever den ikke, framdriften teller den ikke — og #992 viste at klienten
  ignorerer `available` for seksjoner (`const available = isSection || entry.available !== false`).
  Raden så klikkbar ut og endte i 404. Å utelate den er å slutte å love noe vi ikke holder.
- En **modul** uten publisert versjon er en midlertidig tilstand deltakeren skal se at finnes
  (§ 6b-2), klienten rendrer den som deaktivert med «Ikke tilgjengelig», og den teller fortsatt i
  `moduleTotal` og i kursbevisets krav. Å skjule den ville endret **hva beviset krever** — en
  policy-endring, ikke en opprydding.

### Regelen bor i `sectionAvailability.ts`, i to former som må svare likt

`isSectionAvailableToParticipant(section)` for rader man allerede har lest, og
`sectionAvailableWhere` som Prisma-filter når filtreringen kan skje i databasen. Den andre fantes
tidligere som en anonym `where`-literal i `findCourseItemSectionIdsForCourses` — to formuleringer av
samme setning, uten noe som holdt dem i takt.

### Guards

- `test/course-items-accessor-guard.test.js` — **dekningsvakt**: nekter `courseItem.findMany`
  utenfor `courseRepository.ts`, så en niende kaller ikke kan oppstå utenom dørene. Unntakslista er
  poenget (omvendte oppslag innhold→kurs, og `setCourseModules` som leser rader for å skrive dem
  tilbake). ⚠️ Ligger i `test/` og MÅ stå i `include`-lista i `vitest.unit.config.ts`, ellers kjører
  den bare i full CI og ikke i QA-porten før deploy.
- `test/unit/course-items-accessor.test.ts` — begge dørene, med en falsk Prisma-klient som faktisk
  tolker `where` og `select`. Kontrollcase i hver gruppe.
- `test/m2-course-section-read.test.ts` — 404 på begge deltakerrutene, sekvensen uten den uleselige
  seksjonen, og kontrollcaset med den publiserte.
- `test/m2-course-module-availability.test.ts` — avpublisert modul er med, `available:false`.

### Klientsiden — samme spørsmål, andre siden av HTTP

| Sted | Rolle |
|---|---|
| `participant-console-state.js` `isEntryAvailable` / `isEntryDone` / `isEntryOutstanding` | **Sannheten på klienten** |
| `participant.js` raden, `findNextIncompleteEntry`, `nextEntryAfter`, `outstandingBeforeFinish` | kaller predikatene |

Fram til #992 svarte disse fire ulikt, og tre av dem antok at enhver seksjon er tilgjengelig —
`const available = isSection || entry.available !== false`, korrekt den dagen den ble skrevet, en
løgn fra det øyeblikket #944 ga seksjoner feltet. Utfallet var en blindvei: «1 gjenstår» og ingen
«Avslutt kurset», mens serveren gjerne ville utstedt beviset.

⚠️ **Etter #958 er klientsiden forsvar i dybden for SEKSJONER, ikke bærende** — serveren sender dem
ikke lenger. Den skal likevel ikke slettes: MODULER sender fortsatt `available: false`, og en klient
kan møte en eldre server midt i en utrulling. Begrunnelsen «serveren ordner det» var nettopp det som
lot #944-hullet stå åpent i alle stier utenom importen.

### Tre lærdommer fra fire runder på samme regel

**Modul-siden og seksjons-siden er ulike, og det er lett å fikse bare den ene.** #944 filtrerte
seksjonstellingen og glemte modultelleren; 2.26.3 filtrerte modultelleren og glemte at telleren i
brøken ikke fulgte nevneren. Hver gang så fiksen komplett ut fordi den ene halvdelen var grønn.

**En antakelse skrevet før feltet fantes er usynlig for grep.** `isSection || …` HAR et filter — det
er bare feil. Leter man etter «steder som mangler filter», finner man den aldri.

**Den beste kuren fjerner spørsmålet.** Produkteiers beslutning om at upublisert innhold ikke skal nå
kandidaten gjorde at to tellere kunne slutte å kjenne regelen i det hele tatt, og #958 flyttet resten
inn i døra. En avklaring om produktet gjorde mer for denne flaten enn tre runder med filtre.

### Ikke ryddet, med vilje

«Er denne modulen arkivert» er en **annen** regel og lever fortsatt tre steder
(`routes/courses.ts` × 2, `courseCompletionService.ts`), fordi den bæres av `findCourseById` og
`findPublishedCourses*` — søsteraksessorene i #959. Den hører hjemme der, ikke her.

**Asset-ruta spør ikke** (#993): `isSectionInAccessibleCourse` sjekker at kurset er synlig, aldri om
seksjonen er tilgjengelig. Figurer i en arkivert seksjon kan hentes av den som har id-en. Samme
klasse som #944, en fjerde dør — funnet under dette arbeidet, ikke fikset her.

## 26. «Får denne deltakeren se dette kurset?» — én dør, ett unntak (#959)

`findCourseById` returnerer kurset uansett hvem som spør. Regelen «hvem får se hva» bodde derfor hos
kalleren, i **fire varianter** i `enrollmentService.ts` alene — og de tre deltakerrutene hadde hver
sin etterkontroll.

⚠️ **Dette hadde allerede kostet ett hull.** #778/#785: de direkte endepunktene gatet bare på
`publishedAt`, så en deltaker uten innmelding kunne lese et RESTRICTED kurs hen hadde id-en til.
Fiksen den gangen la til en **fjerde kopi** av regelen i stedet for å flytte den ned.

### Døra

| Funksjon | For hvem |
|---|---|
| `findCourseForParticipant({ courseId, userId, roles, groupIds })` | deltakerflatene. Returnerer `null` for finnes-ikke / ikke-publisert / ikke-synlig |
| `courseRepository.findCourseById` | forfatter, eksport, systemevaluering. Ufiltrert, og skal være det |

**Signaturen krever identiteten.** Det er hele mekanismen: man kan ikke hente et kurs på deltakerens
vegne uten å oppgi hvem deltakeren er, så synligheten kan ikke bli glemt — bare aktivt valgt bort.

`null` dekker med vilje alle tre årsakene. Å skille dem i responsen ville lekket at et RESTRICTED
kurs eksisterer til noen som ikke skal vite det.

### Det ene unntaket

**Selv-innmelding** (`POST /:courseId/enroll`) bruker den ufiltrerte aksessoren, og det er riktig.

Ruta finnes nettopp for deltakere som **ennå ikke** har tilgang. Gjennom døra ville et RESTRICTED
kurs blitt `404 «finnes ikke»` i stedet for `selfEnroll` sin `400 «dette krever tildeling»` — og
deltakeren fikk vite at kurset ikke finnes framfor hvordan hen får tilgang.

⚠️ Jeg konverterte den først, og `m2-enrollment` ble rød på 404 der den ventet 400. En ekte
oppførselsendring smuglet inn i en opprydding — samme feilklasse som resten av #941. Synligheten er
ikke glemt der; den er **flyttet til `selfEnroll`**, som eier regelen om hvem som kan melde seg på
selv.

### Fire varianter som fortsatt finnes — og hvorfor

`filterVisibleCourseIds` er kjernen. `isCourseVisibleToUser` er én-kurs-innpakningen.
`isModuleInAccessibleCourse` og `isSectionInAccessibleCourse` er **byte-like** bortsett fra
oppslagsfeltet (`moduleId` vs `sectionId`) — de løser innhold → kurs → synlighet.

De to siste er ikke slått sammen ennå. De hører til #993, som uansett må røre
`isSectionInAccessibleCourse`: den sjekker at kurset er synlig, men aldri om **seksjonen** er
tilgjengelig, så figurer i en arkivert seksjon kan hentes av den som har id-en.

**Vakter:** `test/course-visibility-guard.test.js` — nekter `findCourseById` i deltakerrutene, med
kontrollassertion på at døra faktisk er i bruk (ellers ville testen vært grønn om ruta sluttet å
hente kurs). Unntakslista krever en skreven grunn per oppføring. `test/m2-enrollment.test.ts` pinner
400-en fra selv-innmelding; `test/m2-course-restricted-visibility.test.ts` pinner 404-en fra
lesestiene.

## 27. «Får denne brukeren gjøre dette?» — tjue steder, ett hjem (#962)

Spørsmålet ble besvart **tjue steder**. Tre hadde et navngitt sett — men hvert sitt, i hver sin
modul. De sytten andre var `roles.includes("ADMINISTRATOR")` skrevet på stedet, **inkludert i
`requireAnyRole` selv**, middlewaren som skulle vært den delte vakta.

⚠️ **Skaden var ikke gjentakelsen. Den var at policyen ikke kunne LESES.**

For å svare på «hvem ser en deltakers revisjonsspor» måtte man finne `auditService.ts:216`. For å
oppdage at svaret er fem roller mens `/api/reports` er to, måtte man tilfeldigvis lese begge — og
det var nøyaktig det nattskanningen gjorde, to måneder senere.

### Settene

Alle i `src/auth/roleSets.ts`, med `hasAnyRole(roles, SETT)` som eneste oppslag.

| Sett | Roller | Merknad |
|---|---|---|
| `ADMIN_ONLY` | ADMIN | drift og overstyring |
| `CONTENT_AUTHORS` | ADMIN, SMO | forfatting; ADMIN er aldri mindre privilegert enn SMO |
| `REVIEW_HANDLERS` | ADMIN, REVIEWER | vurderingskøen |
| `APPEAL_HANDLERS` | ADMIN, APPEAL_HANDLER | ankekøen |
| `DISCUSSION_MODERATORS` | ADMIN, SMO | slette andres innlegg |
| `REPORT_READERS` | ADMIN, REPORT_READER | analyse på tvers av organisasjonen |
| `SUBMISSION_AUDIT_READERS` | fem roller | **oppfølging av ett menneske** — se under |
| `MODULE_ADMIN_READERS` | fem roller | modul-lesing for admin-flatene |
| `PARTICIPANTS` | PARTICIPANT | ⚠️ medlemskapsutledning, ikke en vakt |

**Ingen tilgang ble endret.** Hvert sett er nøyaktig det kallstedet hadde — også der settene er
uenige. Å samle dem er første steg; å avgjøre om de *bør* være uenige er en produktbeslutning.

### Den «divergensen» som viste seg å være to roller

Nattskanningen meldte `SUBMISSION_AUDIT_READERS` (fem) mot `REPORT_READERS` (to) som et hull: «den
svakeste definisjonen ligger på den mest granulære ruta».

Produkteier 2026-08-23 avklarte at begge er riktige, og hvorfor:

- **SMO** er *«å regne som en lærer som har det praktiske pedagogiske ansvaret for oppfølging av
  kandidater»*
- **REPORT_READER** er *«potensielt kandidaters mentorer som skal kunne følge opp kompetansemål
  avtalt i eksempelvis medarbeidersamtaler»*

Settet er altså alle med et **oppfølgingsforhold** til en kandidat. `/api/reports` er noe annet:
analyse på tvers. At mentoren finnes begge steder og læreren bare det ene følger av nettopp det —
og `/api/cohort-status` sa dette allerede, med SMO inkludert med vilje.

⚠️ **Lærdom for skanninger:** to sett som er uenige er ikke automatisk en feil. Her var uenigheten
en policy ingen hadde skrevet ned. Kuren var `doc/DECISIONS.md`, ikke kode.

### Det som IKKE er løst

Begge begrunnelsene hviler på et **forhold** — «mine kandidater», «mine mentees» — og det forholdet
finnes ikke i datamodellen. Derfor ser hver av de fem rollene **alle** kandidater i **alle** kurs.
REVIEWER og APPEAL_HANDLER får også saker de ikke er tildelt.

Rollene er riktige; avgrensningen mangler. Det er et datamodellspørsmål (#1000), ikke et
rollespørsmål — og ⚠️ **innskrenkning må vente til forholdet finnes**, ellers gir avgrensningen null
tilgang til alle.

**Vakter:** `test/role-set-guard.test.js` — nekter nye innebygde rollesjekker (mutasjonsverifisert:
fanger `roles.includes("REVIEWER")` med fil, linje og hva man skal gjøre), krever at unntakslista
peker på filer som finnes, og **fester audit/report-forskjellen** i en egen test, så en framtidig
endring gjøres bevisst i stedet for å oppdages i en skanning.

---

## 28. «Er dette forsøket bestått?» — fem spørsmål, ett hjem (#978)

**Hjem:** `public/static/outcome.js` · **Vakt:** `test/outcome-derivation-guard.test.js`

Spørsmålet ble besvart åtte steder i klienten etter **tre** regelsett. Bare ett leste
`submissionStatus`, så samme innlevering kunne vises rød «Ikke bestått» på én flate og nøytral på en
annen i samme økt.

⚠️ **Kartleggingen viste at «bestått?» ikke er ett spørsmål.** En felles `erBestått()` ville vært å
gjenta feilen i motsatt retning: ett svar der det trengs flere.

| Inngang | Spørsmål | Teller statusen? |
|---|---|---|
| `deriveOutcome` | hva skal jeg vise? | ja — `UNDER_REVIEW` og `SCORED` er uavklart |
| `isAppealableFail` | kan hen anke? | ja, og krever `COMPLETED` |
| `isSettledPass` | skal vi feire? | ja |
| `hasPassingDecision` | finnes det alt en bestått? | **nei**, med vilje |
| `rawPassFailState` | hva sier vedtaket? | **nei** — praktikerflate |

**Flatene:**

| Fil | Inngang | Merknad |
|---|---|---|
| `participant.js` | `deriveOutcome`, `isSettledPass`, `isAppealableFail`, `hasPassingDecision` | resultatbanner, kortstyling, feiring, anke, autostart |
| `participant-completed.js` | `deriveOutcome`, `isAppealableFail` | ⚠️ se konfigurasjonsmerknaden |
| `profile.js` | `deriveOutcome` | ⚠️ se konfigurasjonsmerknaden |
| `review.js` | `rawPassFailState` | to formattere, én regel |
| `static/admin-content-calibration.js` | `rawPassFailState` | status i egen kolonne |

⚠️ **Konfigurasjonsmerknad.** `/api/modules/completed` filtrerer på `completedSubmissionStatuses`
(`config/module-completion.json`), i dag `["COMPLETED"]` alene. `profile.js` og
`participant-completed.js` kan derfor ikke motta en uavklart rad med dagens oppsett — konverteringen
er riktig, men uvirksom til nøkkelen utvides. Den ekte feilen på de flatene er at raden **forsvinner**
når en anke setter innleveringen tilbake til `UNDER_REVIEW`: #1002.

⚠️ **Aliaser er fella.** Første utkast av vakta lette etter `passFailTotal` og overså
`flowState.resultPassFail === true` i `participant.js` — samme verdi, annet navn, vakta grønn.
Regexen matcher nå ethvert navn som inneholder «passFail». Skrivinger (`passFailTotal:` i
`review.js` sine skjemafelt) er med vilje ikke fanget.

⚠️ **Regelen håndheves bare i klienten.** `appealService` krever ikke `COMPLETED`, så API-et
aksepterer fortsatt en anke på en innlevering under vurdering: #1002.
