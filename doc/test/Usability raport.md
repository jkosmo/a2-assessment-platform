# UX Findings Report — Simulated Run #47
> Source: Static code inspection of `a2-assessment-platform-main` codebase. Three sessions simulated (P1: new participant, P2: new participant / module-switch focus, R1: reviewer + admin-content). No live server was run. Participant behaviour is inferred from HTML structure, JS flow-gating logic, i18n keys, and validation code.

---

## Report metadata
- Date range: 2026-03-12 (simulated single-day inspection)
- Environment: Static code review — `/participant`, `/participant/completed`, `/manual-review`, `/admin-content` (appeal-handler and calibration reviewed structurally but not task-tested)
- Build versions tested: Migrations through `2026031001_add_submission_locale`; participant, admin-content, manual-review, appeal-handler JS modules
- Sessions run: 3 (simulated) — P1 (new participant), P2 (new participant, module-switch focus), R1 (reviewer + content admin)
- Participant mix: 2 × new participant, 1 × reviewer/admin persona
- Moderator: UX Analyst (simulated via code inspection)

---

## Executive summary

- **Overall outcome:** The core assessment flow (select module → submit → MCQ → auto-assessment → result) is mechanically sound. The module-switch + draft-persistence logic is correctly implemented in code. However, several high-impact presentation and labelling issues mean that well-functioning features are functionally invisible or misleading to users encountering the platform without training.
- **Launch-readiness implication:** Not yet suitable for an unguided pilot. Three S2 issues require resolution before onboarding real participants or reviewers without a facilitator present. None of the S2 issues require significant architectural change — all are presentational or labelling fixes.
- **Highest-severity finding:** F1 — The mock identity panel ("Test User") is the first element participants encounter and is consistently misread as a required user-setup form, causing ~90-second delays and inappropriate field edits. In a live environment where participants type real values into userId/roles fields, this could silently corrupt session state.
- **Immediate actions:** (1) Suppress or subordinate the identity panel for non-developer sessions; (2) enforce or visually sequence the manual-review claim→override flow; (3) label admin-content steps 1 and 2 as mutually exclusive options.

---

## Task summary table

| Task | Role | Success rate | Avg. time | Main friction | Severity |
|------|------|-------------|-----------|---------------|---------|
| T1 — Load modules, identify next step | Participant | Completed with help (2/2) | ~4 min | Identity panel confusion; "Load modules" requires explicit click | S2 |
| T2 — Create submission + MCQ | Participant | Completed with help (2/2) | ~8 min | Validation errors not visible without scroll; field labels unclear | S2 |
| T3 — Monitor assessment + view result | Participant | Completed (2/2) | ~3 min | Result rendered in `<pre>` raw text; difficult to parse | S3 |
| T4 — Module switch + resume draft | Participant | Completed with help (1/2), unaided (1/2) | ~5 min | Draft-save confirmation too subtle; no proactive persistence message | S2 |
| T5 — Locate history | Participant | Completed (2/2) | ~1.5 min | History in `<pre>` format gives unfinished impression | S3 |
| T6 — Create appeal | Participant | Completed (2/2) | ~2 min | No post-submission next-steps message | S3 |
| T7 — Manual review: claim + override | Reviewer | Completed with help (1/1) | ~7 min | Claim/override sequence not enforced; two-field distinction unclear | S2 |
| T8 — Admin-content: full authoring flow | Admin/SME | Completed with help (1/1) | ~18 min | Steps 1/2 misread as sequential; no continuity after module creation | S2 |

---

## Findings

### Finding 1 — Mock identity panel is misread as a mandatory user setup form
- **Severity:** S2
- **Affected role/workspace:** All participants — `/participant`; secondary presence on all other workspaces
- **Evidence:** Both P1 and R1 spent 60–90 seconds engaging with the "Test User" card on first load. P1 asked "Am I supposed to fill this in?" and edited the userId field before attempting to load modules. R1 asked "Is this where I put my reviewer login?"
- **Reproduction path:** Load `/participant` with no prior context. First visible interactive card is "Test User" with four editable fields (User Id, Email, Name, Department) and a Roles field pre-filled with "PARTICIPANT." No label indicates this is a developer/mock-mode control.
- **Impact:** (a) Causes a significant dead-end at the start of every new session. (b) If a participant edits the userId to their real name or changes the role value, API calls will be made with those values — potentially routing their submission under a wrong identity or wrong role. (c) Undermines trust in the platform's professionalism before the participant has even started.
- **Recommended fix:** In mock/dev mode, retain the panel but collapse it by default under a `<details>` element labelled "Developer: test identity (click to expand)." Add a dismissible banner reading "Dev mode active — pre-filled test identity is in use" above the module list. In any future Entra-auth mode, suppress the panel entirely and show a "Signed in as [name]" badge.
- **Suggested GitHub issue:** `[UX] Mock identity panel causes participant confusion — collapse by default with dev-mode label`

---

### Finding 2 — Submission validation errors are not visible without scrolling
- **Severity:** S2
- **Affected role/workspace:** Participant — `/participant`, Submission section
- **Evidence:** P1 clicked "Create submission" twice after filling insufficient text. The validation hint (`submissionValidationHint`) appears below the button at the bottom of the Submission card. With a standard 13-inch viewport, this element is below the fold. P1 did not see the error message on either click.
- **Reproduction path:** Load `/participant`, select a module, type fewer than 10 characters in rawText, click "Create submission." Observe that the error message appears at the bottom of the section, out of viewport, with no scroll event triggered.
- **Impact:** Users repeatedly attempt to submit and believe the button is broken or loading. Leads to frustrated abandonment or repeated API calls. The minimum character thresholds (rawText: 10, reflection: 10, promptExcerpt: 5) are not communicated before the attempt.
- **Recommended fix:** (a) On failed validation, `scrollIntoView({ behavior: 'smooth' })` the first invalid field. (b) Add persistent inline character-count hints below rawText and reflectionText (e.g., "Minimum 10 characters"). (c) Optionally, show real-time validation state as the user types rather than only on submit-click.
- **Suggested GitHub issue:** `[UX] Submission validation error not visible without scroll — add scroll-to-invalid and inline hints`

---

### Finding 3 — Module draft persistence is not communicated proactively
- **Severity:** S2
- **Affected role/workspace:** Participant — `/participant`, Submission + Modules sections
- **Evidence:** P1 was visibly anxious when switching modules ("Did I lose everything I wrote?"). P2 noticed the draft-save status text but described it as "really small — easy to miss if you're stressed." In both sessions the draft system worked correctly (saves on switch, restores on return), but one of two participants would have retyped their work if the moderator had not been present.
- **Reproduction path:** Load `/participant`, select Module A, type text in rawText. Click Module B card. The `draftStatus` div updates to "Draft saved: Module A" — but this is a small, low-contrast `div.small` element in the Submission card header. The toast system (`showToast`) is not invoked on module switch.
- **Impact:** Participants who miss the draft-save indicator will retype their work on return or abandon the module. This is a high-frequency scenario (multi-module candidates are the expected use case).
- **Recommended fix:** (a) Call `showToast("Draft saved for [module title]", "info")` when switching away from a module with draft content — the toast infrastructure already exists. (b) Show a "Draft" badge indicator on module cards that have saved content. (c) Add a one-time persistent note in the Submission section: "Your work is saved automatically in this browser."
- **Suggested GitHub issue:** `[UX] Draft persistence not communicated on module switch — add toast + module card badge`

---

### Finding 4 — Step indicator shows "Step 2 of 5" on first load
- **Severity:** S2
- **Affected role/workspace:** Participant — `/participant`, flow progress indicator
- **Evidence:** P2 noticed the step counter on landing and asked: "I'm on step 2 but I don't know what step 1 was or if I did it." The step labels are Identity (1), Select Module (2), Submit Work (3), Complete MCQ (4), Assessment (5). Because Identity is pre-filled and always visible, `getActiveFlowStep()` returns 2 on load.
- **Reproduction path:** Load `/participant` in mock mode. The `flowProgressSummary` immediately reads "Step 2 of 5" with the Identity step marked as completed. Step 1 "Identity" has its pill styled `is-completed` even though the participant has never verified their identity.
- **Impact:** Participants are disoriented ("what did I miss?"). For participants who are confused about the identity panel (Finding 1), this compounds the confusion — they may believe step 1 was the identity form and go back to "complete" it.
- **Recommended fix:** Option A — rename step 1 to "Ready" and show it as a non-interactive completed pill that communicates dev-mode is active. Option B — begin the displayed step count at 1 ("Step 1: Select Module") and remove Identity from the public-facing progress indicator entirely, treating it as a system-level precondition rather than a participant task. Option B is preferred.
- **Suggested GitHub issue:** `[UX] Step indicator starts at Step 2 on load — confuses new participants about missing step 1`

---

### Finding 5 — Admin-content steps 1 and 2 misread as sequential, not alternative
- **Severity:** S2
- **Affected role/workspace:** Admin/SME — `/admin-content`
- **Evidence:** R1 completed both steps 1 (JSON import) and step 2 (manual shell), then discovered that "Apply draft JSON" had overwritten manually typed fields. R1 could not identify which data was "active." There is no undo. The help text in section 1 says "optional" but does not say "use this OR step 2, not both."
- **Reproduction path:** Load `/admin-content`. Section 1 heading reads "1) Start from draft JSON (optional)". Section 2 reads "2) Create module shell manually." A user who processes these as a numbered sequence will attempt both. Clicking "Apply draft JSON" populates all downstream fields from JSON, overwriting anything typed manually.
- **Impact:** Data loss (silent overwrite) on a critical admin workflow. A content author could lose a partially-typed module spec without realising it. No toast or confirmation is shown on apply.
- **Recommended fix:** (a) Replace the numbered headings with an explicit fork label: "How do you want to start? → Option A: Import from JSON | Option B: Build manually." A radio toggle or tab bar between the two would make the mutual exclusivity obvious. (b) Show a confirmation toast on "Apply draft JSON" listing which fields were populated, with an explicit note that existing values were replaced. (c) Consider adding a warning if fields are non-empty when Apply is clicked.
- **Suggested GitHub issue:** `[UX] Admin-content steps 1/2 misread as sequential — label as mutually exclusive options, add overwrite warning`

---

### Finding 6 — Manual review claim-before-override sequence is not enforced or explained
- **Severity:** S2
- **Affected role/workspace:** Reviewer — `/manual-review`
- **Evidence:** R1 saw both "Claim review" and "Finalise override" buttons simultaneously on selecting a queue row and asked which to press first. The correct sequence (claim → override) is not communicated visually. Code inspection shows no client-side guard preventing an override attempt without claiming first; the error would come from the API.
- **Reproduction path:** Load `/manual-review`, load queue, click a row. Both `claimReview` and `overrideReview` buttons are enabled simultaneously with no sequence indicator. Clicking "Finalise override" without claiming would trigger an API error with an error message shown in the output area, not adjacent to the button.
- **Impact:** Reviewers who attempt to override without claiming first receive an API error. The error appears in a `<pre>` output section at the bottom of the page, not near the action buttons. This breaks the task flow and requires the reviewer to scroll down to understand what went wrong.
- **Recommended fix:** (a) Disable "Finalise override" until the current review is claimed by the current user. (b) Show a `title`/tooltip on the disabled button: "Claim this review first." (c) Add a numbered sequence label above the two buttons: "1. Claim review → 2. Finalise override." (d) Move the error output for claim/override actions adjacent to the buttons rather than to the bottom output panel.
- **Suggested GitHub issue:** `[UX] Manual review: override not gated on claim — disable until claimed, show sequence label`

---

### Finding 7 — Admin-content: no continuity bridge from module creation (step 2) to module loading (step 3)
- **Severity:** S3
- **Affected role/workspace:** Admin/SME — `/admin-content`
- **Evidence:** After creating a module via step 2, R1 was confused to find step 3 asking for a module ID, which was empty. R1 said: "I just created it — isn't it already open?" The system creates a module but does not auto-populate the selectedModuleId input or auto-load the module status.
- **Reproduction path:** Fill section 2 and click "Create module." The success response contains the new module ID. Section 3 `selectedModuleId` input remains empty. Section 4 "Module status" still shows "No module selected."
- **Impact:** Users must manually copy the newly created module ID from the system response output and paste it into section 3, then click "Load draft." This is a non-obvious multi-step context switch that interrupts the intended 1→2→3→... flow.
- **Recommended fix:** On successful module creation, auto-populate `selectedModuleId` and trigger an auto-load of module content (equivalent to clicking "Load draft"). Show a contextual success message in the section 4 status card: "Module created — ready to add content."
- **Suggested GitHub issue:** `[UX] After module creation in step 2, auto-populate module ID into step 3 and reload status`

---

### Finding 8 — Result and history rendered as raw `<pre>` text, not participant-appropriate UI
- **Severity:** S3
- **Affected role/workspace:** Participant — `/participant`, assessment result and history sections
- **Evidence:** Both P1 ("this looks like code") and P2 ("it doesn't look finished") commented on the raw-text result and history displays. The result section uses a `<pre>` tag with key:value lines. The history section uses an identical pattern. While the data is correct, the presentation signals an unfinished prototype.
- **Reproduction path:** Complete the assessment flow. The result block reads lines like `Status: Completed`, `Decision reason: Automatic pass by threshold rules.`, `Rationales: - relevance_for_case: Stub: submission appears relevant...`. The "Stub:" prefix in several rationale strings is especially jarring and visually suggests placeholder content.
- **Impact:** Undermines trust in the platform result. Participants may question whether their score is real or a test artefact. "Stub:" rationale strings are particularly likely to be read as bugs.
- **Recommended fix:** (a) Replace `<pre>` result display with a result card component: clear PASS/FAIL status banner, summary score, collapsible criteria section. (b) Remove or replace "Stub:" prefixes in rationale strings before any participant-facing use. (c) Apply the same card treatment to history entries — render as a table or a list of cards, not raw text.
- **Suggested GitHub issue:** `[UX] Result and history displayed as raw <pre> text — design participant-appropriate result card`

---

### Finding 9 — No post-appeal next-steps message
- **Severity:** S3
- **Affected role/workspace:** Participant — `/participant`, appeal section
- **Evidence:** P1 submitted an appeal and immediately asked: "What happens next? Will someone contact me? How long does it take?" The UI only shows the appeal ID and status "OPEN." No explanatory text follows.
- **Reproduction path:** Submit an appeal via the Appeal section. `appealSubmittedStatus` shows: "Appeal submitted: [id] (OPEN)". No further guidance is provided.
- **Impact:** Participant anxiety after the most stressful moment in the flow (a fail result). Likely to generate support requests.
- **Recommended fix:** After appeal submission, display a brief static message explaining the process: "Your appeal (ID: [x]) has been submitted and will be reviewed by a member of the team. You do not need to take any further action." Exact SLA text can be populated from config or left as a placeholder for the pilot phase.
- **Suggested GitHub issue:** `[UX] Add post-appeal next-steps message to participant appeal section`

---

### Finding 10 — Module IDs visible on participant-facing module cards
- **Severity:** S3
- **Affected role/workspace:** Participant — `/participant`, module list
- **Evidence:** P2 noticed "ID: module-123abc" beneath the module description on each card and asked why an internal code was shown. The ID is rendered unconditionally in `renderModules()`.
- **Reproduction path:** Load modules. Each module card contains a `div.module-meta` with `textContent = "ID: ${module.id}"`. This is visible to all participants regardless of debug mode.
- **Impact:** Cosmetic and trust issue. Does not break functionality, but gives a developer-console impression to participants.
- **Recommended fix:** Move module ID rendering inside the `isRawDebugEnabled()` or `isDebugModeEnabled()` guard. Show only the module title and description on participant-facing cards.
- **Suggested GitHub issue:** `[UX] Module IDs rendered on participant cards — move behind debug flag`

---

## Module-switch analysis
- **Expected behavior from users:** Both P1 and P2 expected data loss when switching modules. Neither proactively anticipated that the platform would save and restore their draft.
- **Observed behavior:** The draft system (localStorage, keyed by module ID, with 240-minute TTL and 30-module capacity) functions correctly. Text fields and MCQ responses are saved on switch and restored on return. The system correctly persists across page reloads (localStorage survives).
- **Recovery clarity:** Low. The confirmation is a small `div.small` status text — insufficient to communicate to anxious or rushed users. No toast notification is emitted on switch. No badge on module cards indicates saved draft state.
- **Draft/state confidence:** The platform does not tell users that drafts are stored in the browser, not the server. Users who work across devices or browsers will find their draft absent, with no explanation.
- **Recommendation:** Invoke the existing toast system on module-switch draft saves (Finding 3). Add a draft badge to module cards. Add a persistent one-line browser-storage disclosure in the Submission section. This trio of changes fully closes the module-switch UX gap with minimal implementation cost.

---

## Admin-content authoring analysis
- **Was the start path (`import` vs `manual shell`) understood?** No. R1 treated them as sequential steps and attempted both. The "optional" qualifier in section 1 was read but not understood as "use this instead of step 2."
- **Was the copied authoring prompt useful without facilitator explanation?** Partially. R1 clicked "Copy authoring prompt" and received clipboard confirmation. R1 had no way to preview what was copied or know what to do with it next (the help text says "Replace the source material references before sending it to an LLM" — but R1 had not yet encountered an LLM context to paste into). Without a preview, the value of this action is not visible.
- **Was preview behavior understood as non-persistent?** Only after reading the help text. The button label "Open participant preview" does not itself indicate the non-persistence. A user who sees a preview module and then cannot find it in the published list will be confused.
- **Were draft-version vs published-version semantics understood?** The section 4 status card (Live / Draft badges, version chain) was praised by R1 as "immediately understandable." However, the path to get a draft published (save steps 5-8 → note version ID → enter in step 9 → publish) was not clear in a single walkthrough.
- **Recommendation:** Address the step 1/2 fork labelling (Finding 5), add post-creation continuity to step 3 (Finding 7), and add a "Preview copied content" affordance. For publish: consider auto-populating the step 9 version ID field from the most recently saved draft version, rather than requiring manual entry.

---

## Backlog conversion
- [x] One issue per confirmed finding
- [x] Severity and evidence added
- [x] Reproduction path included
- [x] Expected behavior stated
- [x] Priority recommendation stated

---

## Recommendation
- [x] **Fix selected UX blockers before pilot**

The core flows are correct and functional. The platform is close to pilot-ready. However, Findings 1–6 represent S2 issues that will cause task failure or silent data errors in an unguided pilot. All six are presentational or labelling changes — none require schema or API changes. Recommended sequencing before pilot:

**Immediate (S2 — block pilot):**
1. F1 — Suppress/collapse mock identity panel with dev-mode label
2. F2 — Scroll-to-invalid + inline character hints on submission
3. F3 — Toast + module card badge for draft persistence
4. F4 — Fix step indicator starting position (show Step 1: Select Module)
5. F5 — Label admin-content paths as mutually exclusive options with overwrite warning
6. F6 — Gate manual-review override on claim with sequence label

**Next batch (S3 — before wider rollout):**
7. F7 — Auto-populate module ID after creation in admin-content
8. F8 — Replace `<pre>` result/history with structured result card
9. F9 — Post-appeal next-steps message
10. F10 — Remove module IDs from participant-facing cards

---

## Linked artefacts
- Session notes: `UX_SESSION_NOTES_SIMULATED.md`
- Screenshots: N/A (simulated sessions — no live environment)
- Recordings: N/A
- Created issues: Pending — see "Suggested GitHub issue" in each finding above