# Design: Conversational Admin Content Workspace

**Issue:** #294 (design prereq for #293 epic)
**Status:** Draft – awaiting approval before implementation starts
**Date:** 2026-04-15

---

## Problem Statement

The current `admin-content` workspace is functionally complete but cognitively demanding for
Subject Matter Owners (SMOs). The core issues:

1. **Sequential step load.** Creating or updating a module requires understanding eight
   sequential sections: module shell → rubric → prompt → MCQ → module version → publish.
   The ordering is not obvious without backend knowledge.

2. **Versioning opacity.** The append-only model is the right design, but the UI still
   requires the user to track version IDs manually and understand that clicking "Save"
   creates a new version rather than mutating the existing one.

3. **LLM generation is buried.** `POST /generate/module-draft` and `POST /generate/mcq`
   exist and work, but they are reached through an import/copy-prompt flow that requires
   the user to understand the JSON draft format first.

4. **No guided creation journey.** A first-time SMO has no onramp. There is no path that
   says "start here, give me source material, I will guide you through the rest."

The target experience is:
- SMO opens Admin Content and sees a workspace centered on the module, not on the steps.
- A chatbot panel guides the creation or editing journey in natural language.
- A preview panel shows the current module state at all times.
- Every destructive or publishing action requires explicit confirmation before it executes.
- The existing advanced editor remains reachable throughout the rollout.

---

## Options Considered

### Option A – Conversational shell over existing APIs (chosen)

Add a new shell UI with two panes: a live module preview and a guided chatbot.
The chatbot orchestrates the existing API commands (`adminContentCommands`, the 16
`/api/admin/content/*` endpoints) without changing them.

**Pros:**
- No backend changes in Slice 1 or 2; all mutations use existing validated endpoints.
- Append-only versioning is preserved unchanged.
- Fallback to the existing editor is trivial: just link to the current page.
- Risk is contained to the frontend and a new chat-intent layer.

**Cons:**
- Frontend complexity increases significantly.
- The chat-intent classifier (free-form edit commands) introduces a new LLM call path
  that needs its own validation, error handling, and token cost management.

### Option B – Full replacement of Admin Content

Rewrite `admin-content.html` and `admin-content.js` as a chat-first interface with no
fallback to the current form-based editor.

**Rejected.** Too risky as a first step. The existing editor covers edge cases (direct ID
inspection, benchmark examples, archive/restore) that are hard to replicate safely in
conversational form. A big-bang replacement would also make staged rollout impossible.

### Option C – Conversational assistance embedded in the current editor

Embed a chatbot sidebar in the existing editor page. The chat helps, but the user still
navigates the eight sections manually.

**Rejected.** This does not solve the core onboarding problem. SMOs still see all sections
simultaneously. The chatbot becomes a help widget rather than a guided workspace.

---

## Chosen Approach

**Conversational shell over existing APIs, phased by slice.**

The key architectural boundary:

> The LLM is never allowed to execute mutations directly.
> It classifies user intent into a typed `CommandIntent`. The application validates the
> intent, renders a confirmation where required, and executes the matching API call.

This keeps the system deterministic and auditable even under free-form input.

The phased rollout is defined in `ADMIN_CONTENT_EPIC_BRANCH_STRATEGY.md`.

---

## Workspace Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Admin Content                          [Advanced editor ↗]  │
├──────────────────────┬───────────────────────────────────────┤
│  PREVIEW             │  CHAT                                  │
│                      │                                        │
│  [locale: nb ▾]      │  ┌──────────────────────────────────┐ │
│                      │  │ Module: Modul A                   │ │
│  Module: Modul A     │  │ Status: Live – Module v3          │ │
│  Status: Live        │  │                                   │ │
│  Version chain:      │  │ Hva vil du gjøre?                 │ │
│    Module v3         │  │  [Rediger eksisterende modul]     │ │
│    Rubric v2         │  │  [Opprett ny modul]               │ │
│    Prompt v3         │  │  [Arkiver / gjenopprett]          │ │
│    MCQ v2            │  └──────────────────────────────────┘ │
│                      │  [____________________________] [Send] │
│  [Task text...]      │                                        │
│  [Guidance...]       │                                        │
│  [MCQ preview...]    │                                        │
└──────────────────────┴───────────────────────────────────────┘
```

The preview pane renders the module as a participant-facing summary (not raw fields).
The chat pane handles the active session.

On narrow screens the layout stacks vertically: chat above, preview below.

---

## State Model

### Session states

| State | Meaning |
|-------|---------|
| `idle` | No module selected. Chatbot presents module picker or new-module option. |
| `module-loaded` | A module is selected and preview shows current published state. |
| `draft-pending` | Chat commands have updated the local draft but nothing is saved to the backend yet. |
| `awaiting-confirmation` | A guarded command is pending. Chatbot shows a confirmation card. User must confirm or cancel. |
| `generating` | An LLM generation call is in flight. Preview shows a loading state. |
| `saving` | A confirmed command is being sent to the API. |

State transitions:

```
idle → module-loaded (user selects module or creates shell)
module-loaded → draft-pending (user applies an edit command)
module-loaded → awaiting-confirmation (user triggers guarded action)
draft-pending → awaiting-confirmation (user triggers save or publish)
awaiting-confirmation → saving (user confirms)
awaiting-confirmation → module-loaded (user cancels)
saving → module-loaded (API success)
module-loaded → generating (user requests LLM draft)
generating → draft-pending (LLM draft applied to local state)
```

### Draft state storage

Draft state lives in JavaScript memory only (matching the pattern established by the
existing dialog-based editor in #135). It is not persisted to `sessionStorage` in MVP.

A "Ulagret utkast"-badge is shown in the preview pane whenever `draft-pending` is active.

---

## Command Model

### Command types

All actions available via chat are typed. Free-form user input in edit mode is mapped to
a `CommandIntent` before any execution happens.

```typescript
type CommandIntent =
  | { type: "select_module"; moduleId: string }
  | { type: "create_module_shell"; title: LocaleObject; certificationLevel: string }
  | { type: "update_field"; card: ContentCard; locale: SupportedLocale; value: string }
  | { type: "generate_draft"; sourceMaterial: string; certificationLevel: CertificationLevel; locale: SupportedLocale }
  | { type: "generate_mcq"; sourceMaterial: string; certificationLevel: CertificationLevel; questionCount: number }
  | { type: "preview_locale"; locale: SupportedLocale }
  | { type: "save_draft" }
  | { type: "publish_version"; moduleVersionId: string }
  | { type: "unpublish_module"; moduleId: string }
  | { type: "archive_module"; moduleId: string }
  | { type: "restore_module"; moduleId: string }
  | { type: "delete_module"; moduleId: string }
  | { type: "unknown"; rawInput: string };
```

`ContentCard` maps to the seven content areas from the existing editor:
`moduleDetails`, `versionDetails`, `rubric`, `assessmentPolicy`, `prompt`, `mcq`, `submissionSchema`.

### Safe commands (execute immediately, no confirmation)

- `select_module` – loads module into preview
- `create_module_shell` – creates the module container via `POST /modules`
- `update_field` – updates local draft state only (no API call)
- `generate_draft` – calls `POST /generate/module-draft`, populates draft state
- `generate_mcq` – calls `POST /generate/mcq`, populates draft state
- `preview_locale` – switches the preview language

### Guarded commands (require explicit user confirmation before API call)

| Command | Confirmation message shown |
|---------|---------------------------|
| `save_draft` | Shows version chain that will be created |
| `publish_version` | Shows which version chain goes live |
| `unpublish_module` | Shows module name and current live version |
| `archive_module` | Shows module name and warns about participant impact |
| `restore_module` | Shows module name |
| `delete_module` | Shows module name and requires typing the name to confirm |

### LLM intent classification (Phase 2 – #297)

In Slice 1 (#295), the chatbot uses **structured button choices** only. There is no
free-form intent classification in MVP. This reduces risk and keeps Slice 1 deterministic.

In Slice 3 (#297), free-form text commands are introduced. The intent classifier is a
separate LLM call to Azure OpenAI that returns a `CommandIntent` JSON object. The system
prompt constrains the classifier to the defined command set only. Unrecognised or ambiguous
input maps to `{ type: "unknown" }` and the chatbot asks the user to clarify.

The classifier must never receive the module's content as context — only the command
vocabulary and the current session state. This prevents the classifier from hallucinating
field values.

---

## LLM Latency and Call Management

### Non-negotiable requirement

> **The UI must never lock or become unresponsive because of an LLM call.**
> This applies without exception. All LLM calls execute in the background.
> The user must always be able to read, navigate, edit, and cancel while any call is in flight.

This is a hard design constraint, not a guideline. Any implementation that violates it —
even briefly — is a defect.

### Latency profile

The current `callLlm` is fully blocking (`await response.json()`, `max_completion_tokens: 4000`,
no streaming). Realistic round-trip times on Azure OpenAI:

| Call type | Typical | Worst case | Trigger |
|-----------|---------|------------|---------|
| `generate_draft` | 5–12 s | 20 s | Explicit user action |
| `generate_mcq` | 8–18 s | 30 s | Explicit user action |
| Translation per locale | 3–8 s | 15 s | Explicit user action |
| Intent classifier | 0.5–2 s | 4 s | Each free-form message |

### Call trigger discipline

LLM calls must only be triggered by **explicit user actions** — never automatically.

Forbidden triggers:
- Auto-generate on paste or on text input change.
- Auto-translate when the user switches locale.
- Re-classify on every keystroke in the chat input.

Required trigger pattern:
- Generation: user clicks a clearly labelled action button ("Generer utkast", "Generer spørsmål").
- Translation: user explicitly requests translation after source-locale content is complete.
- Classification: user submits a message (Enter or Send button) — not before.

This rule prevents unnecessary calls, keeps costs predictable, and avoids the user being
surprised by background activity they did not request.

### Single active call per type

At most one generation call and one classification call may be in flight simultaneously.

```
State:  [ generationInFlight: boolean, classifierInFlight: boolean ]
```

**If the user triggers a new generation while one is already running:**
- Cancel the in-flight call via `AbortController.abort()`.
- Start the new call immediately.
- Inform the user: "Forrige generering ble avbrutt – starter ny."

Rationale: the new call supersedes the old one. Queuing would leave the user waiting for
a result based on inputs they have already changed.

**If the user submits a new chat message while the classifier is running:**
- Queue the new message. Process it when the classifier is free.
- Show a brief "behandler…" indicator in the chat input.
- Do not allow the user to submit a third message until the queued one is processed.
  This caps the queue depth at 1 and prevents call chains from building up.

**Mutations (save, publish, etc.) are never queued.** They are always initiated explicitly
by the user through a confirmation gate and execute synchronously against the API (< 1 s).
A mutation cannot be triggered while a generation is in flight — the confirmation button
is disabled until the generation resolves or is cancelled.

### Per call-type behaviour

#### Content generation (`generate_draft`, `generate_mcq`)

1. User clicks the generation action button.
2. Button becomes "Avbryt" immediately. Chat pane shows a non-modal progress card:
   ```
   Genererer modulutkast…  [Avbryt]
   ```
   The progress card is informational only — it does not overlay or disable anything else.
3. The user may continue working: switch preview locale, edit content cards, read the draft.
4. On completion, the chat pane shows a result card:
   ```
   Utkast klart.  [Bruk dette utkastet]  [Forkast]
   ```
   The existing draft is untouched until the user chooses "Bruk dette utkastet".
   This explicit accept step prevents a completed call from overwriting manual edits
   made while the call was running.
5. On abort (user or network): progress card is replaced by "Generering avbrutt."
   No draft state is changed.

#### Translation (Slice 3)

Translation is triggered per locale, not for all locales in one call.
The user explicitly selects which target locale to translate into.

Each locale translation runs as a separate call. Results appear in the preview as they
complete, marked "Oversatt – ikke godkjent" until the user accepts each one.
The user can accept, reject, or edit each translated locale independently.

#### Intent classification (Slice 3)

The classifier has a short, constrained prompt and a small, typed output.
Expected latency: 0.5–2 s. The call is triggered on message submit only.

The user sees a brief "tolker…" indicator next to the sent message — not a full spinner.
The chat input is disabled until the classifier responds (at most a 2 s wait).
If the classifier returns `{ type: "unknown" }`, the chatbot asks the user to rephrase.
No retry loop.

### Model cost and capability tiering

Not all calls require the same model quality. The design defines tiers by requirement —
specific model choices are deferred to implementation, where concrete quality and latency
evidence will inform the decision. A call type may also justify a larger or more capable
model than the default tier if testing reveals a real need.

| Call type | Tier | Quality requirement | Speed requirement | Frequency |
|-----------|------|-------------------|------------------|-----------|
| `generate_draft` | High | Creative, domain-aware, long output | Low – runs in background | Low – one per authoring session |
| `generate_mcq` | High | Subtle distractors, strict option parity | Low – runs in background | Low – one per authoring session |
| Translation | Medium | Accurate and fluent, less creative | Medium – user is waiting for locale switch | Medium – one per locale per save |
| Intent classifier | Low | Reliable JSON output, constrained vocabulary | High – user is blocked until resolved | High – every free-form message |

**Tier definitions:**
- **High:** Prioritise quality over speed. These calls run in the background and the user
  is not blocked, so a slower but more capable model is acceptable. Do not substitute for
  cost or speed alone — output quality directly affects assessment content participants see.
- **Medium:** Balance quality and speed. The user has explicitly requested translation and
  is aware of the wait, but perceptible latency should be minimised. Validate quality
  against representative field values before committing to a model.
- **Low:** Prioritise speed and reliability of structured output. The user is directly
  blocked until the classifier responds. A model that is slightly less capable but
  consistently fast is preferable to a slower, higher-capability model here.

Specific model selection for each tier happens at implementation time, informed by
quality testing on real module content. The choice should be revisited whenever a new
model becomes available in the Azure OpenAI deployment or when production evidence
shows quality drift.

**Backend implication:** `callLlm` currently reads a single `AZURE_OPENAI_DEPLOYMENT` env var.
Supporting tiering requires either:
- A `deployment` parameter override on `callLlm` per call site, or
- Separate env vars: `AZURE_OPENAI_DEPLOYMENT_GENERATION`, `AZURE_OPENAI_DEPLOYMENT_FAST`.

This is a backend change scoped to Slice 2 (when translation is added) and Slice 3
(when the intent classifier is added). Slice 1 uses the existing single deployment.

### Streaming

The current `callLlm` awaits the full JSON response before returning. Azure OpenAI
supports `stream: true` with token-by-token SSE output, but streaming structured JSON
requires buffering until the object is complete before validation can run.

Streaming is **not required for the non-blocking design** — the progress card pattern
satisfies the non-negotiable requirement without it. Streaming would add perceived
responsiveness (visible typing effect during generation) but is a non-trivial backend
change (new SSE route, `ReadableStream` consumer on the frontend, partial JSON buffering).

Decision point: evaluate streaming after the first SMO usability session on Slice 2.
If users express that the progress card does not give enough feedback during 10–20 s waits,
streaming is prioritised before Slice 3. Otherwise it remains a post-Slice-5 enhancement.

---

## Multilingual Content Strategy

### Source locale

The user selects a **source locale** at session start (defaulting to the UI locale). The
source locale is the primary language for LLM generation and manual editing in that session.

### LLM generation locale

`generateModuleDraft` and `generateMcqQuestions` already accept a `locale` parameter
(`en-GB | nb | nn`). The chatbot passes the source locale to all generation calls.

### Translation to other locales

The chatbot can offer auto-translation of source-locale content to the remaining locales.
This is a separate explicit step that the user must request — it is never automatic.

Translation is also an LLM call. It maps to a `translate_field` command (Phase 2):

```typescript
| { type: "translate_field"; card: ContentCard; sourceLocale: SupportedLocale; targetLocales: SupportedLocale[] }
```

The translated output populates draft state and is shown in the preview before saving.

### Structural parity validation before save

Before `save_draft` executes, the app validates that all required fields are non-empty for
all three locales. If any required locale field is missing, the chatbot shows a specific
gap message and blocks the save until resolved.

The parity rule is: either all three locales are filled, or only the source locale is
filled (single-locale module). A partial fill — some locales present, some empty — is an
error.

---

## Safety Model for Destructive and Publishing Actions

### Principle

The chatbot never executes guarded commands without a visible confirmation card.
The confirmation card shows:

1. The action name in plain language.
2. The exact data that will change (module name, version chain, status).
3. Two buttons: **Confirm** and **Cancel**.

Pressing **Confirm** sets the session state to `saving` and dispatches the API call.
Pressing **Cancel** returns to `module-loaded` or `draft-pending` without side effects.

### Delete confirmation

Delete is additionally hardened: the confirmation card requires the user to type the
module title before the **Confirm** button becomes active.

### Publish safety

Before confirming publish, the chatbot shows:

```
Du er i ferd med å publisere:
  Modul v4 – Rubrikk v3, Prompt v4, MCQ v3

Nåværende live-versjon (Modul v3) vil erstattes.
Nye innleveringer vil bruke den nye versjonen.
Eksisterende innleveringer påvirkes ikke.

[Publiser]   [Avbryt]
```

This mirrors the existing module status card wording to maintain consistency.

### Audit trail

Existing `recordAuditEvent` calls in `adminContentCommands.ts` cover all mutations.
No new audit instrumentation is required in Slice 1–2.

---

## Rollout Strategy

| Phase | What changes | Fallback |
|-------|-------------|---------|
| Slice 1 – Shell (#295) | New shell with preview + structured chatbot. Existing editor reachable via "Advanced editor" link. | Link always visible. |
| Slice 2 – Draft creation (#296) | Source-material intake and LLM draft via chatbot. | Import flow in existing editor still works. |
| Slice 3 – Edit loop (#297) | Free-form text edit commands with intent classifier. | User can switch to advanced editor at any point. |
| Slice 4 – CRUD/publish (#298) | Full CRUD and publish via chatbot. | Advanced editor fallback link may be moved to secondary position. |
| Slice 5 – Rollout (#299) | Testing, docs, coexistence review. | Evaluate whether advanced editor link can be removed. |

The advanced editor link is never removed without an explicit decision recorded in this
document. The current plan keeps it accessible throughout all slices.

---

## Implementation Notes for Slice 1 (#295)

The shell can be implemented as:

**Option 1 – New HTML file** (`admin-content-v2.html`)
- Clean separation from `admin-content.html`
- Easier to iterate without touching the working editor
- Requires a new route or a redirect

**Option 2 – New section in the existing file** with a toggle
- Keeps everything in one file
- Increases complexity of an already large file (4408 lines JS + 949 lines HTML)

**Recommendation: Option 1.** A new file avoids entangling new and old code.
The new file imports the same API client and i18n utilities.
The existing editor at `/admin-content` stays unchanged during rollout.

The split-pane layout should be CSS Grid:
```css
.workspace-shell {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: var(--space-2);
  min-height: 80vh;
}
@media (max-width: 900px) {
  .workspace-shell { grid-template-columns: 1fr; }
}
```

---

## Open Questions

1. **New page URL.** ~~Should the conversational workspace live at `/admin-content-v2` during
   rollout, or replace `/admin-content` immediately with the advanced editor accessible at
   `/admin-content/advanced`?~~ **Decided 2026-04-15:** The new workspace takes over
   `/admin-content`. The existing advanced editor moves to `/admin-content/advanced` and
   remains linked from the new workspace throughout rollout.

2. **Intent classifier model.** When free-form intent classification is introduced (#297),
   should it use the same Azure OpenAI deployment as content generation, or a faster/cheaper
   model? The classifier prompt is simpler than content generation. Defer decision to #297.

3. **sessionStorage for draft persistence.** If the user refreshes during a `draft-pending`
   session, the draft is lost. SessionStorage backup was deferred in #135 (existing editor).
   The same decision applies here. Revisit in #299 based on SMO feedback.

4. **Preview rendering depth.** In Slice 1, the preview can show module title, status badge,
   and version chain. Should it also render the full MCQ question set and task text in MVP,
   or is the status summary sufficient? Recommendation: task text + status chain in Slice 1,
   full MCQ in Slice 3 when the edit loop is live.

5. **`callLlm` deployment parameter.** Tiering requires a `deployment` override on
   `callLlm`. Should this be a parameter on the function signature, or separate env vars
   per tier? Separate env vars keep config explicit but add operational overhead.
   A parameter is more flexible but requires all call sites to specify a tier.
   Decide when scoping Slice 2 backend work.

---

## Acceptance Criteria for This Document

- [x] Problem statement is documented
- [x] Options are analysed with explicit rejection rationale
- [x] Phased rollout over big-bang replacement is recommended
- [x] Command model and LLM safety boundary are documented
- [x] Multilingual authoring and translation handling are documented
- [x] State model covers all session transitions
- [x] Safety model for guarded actions is documented
- [x] Fallback/rollback plan is documented
- [x] Open unknowns are listed
- [x] Approved by user before implementation of #295 begins (2026-04-15)

---

## References

- GitHub epic: #293
- Branch strategy: [ADMIN_CONTENT_EPIC_BRANCH_STRATEGY.md](ADMIN_CONTENT_EPIC_BRANCH_STRATEGY.md)
- AI workflow: [AI_WORKFLOW.md](AI_WORKFLOW.md)
- Previous editor design: [ADMIN_CONTENT_DIALOG_REDESIGN.md](ADMIN_CONTENT_DIALOG_REDESIGN.md) (issue #135, closed)
- LLM generation service: `src/modules/adminContent/llmContentGenerationService.ts`
- Existing API endpoints: `src/routes/adminContent.ts`
