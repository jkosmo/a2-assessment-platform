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

## LLM Latency Strategy

### Why this needs explicit design

LLM calls in this workspace take measurably longer than users expect from a UI interaction.
The current `callLlm` implementation is fully blocking (`await response.json()`,
`max_completion_tokens: 4000`, no streaming). Realistic round-trip times on Azure OpenAI:

| Call type | Typical latency | Worst case |
|-----------|----------------|------------|
| `generate_draft` (module task + guidance) | 5–12 s | 20 s |
| `generate_mcq` (10 questions) | 8–18 s | 30 s |
| Translation (all three locales) | 4–10 s | 15 s |
| Intent classifier (Slice 3, short prompt) | 0.5–2 s | 4 s |

A blocking spinner that freezes the workspace for 10–20 seconds will feel broken.
The design must ensure the user can work continuously regardless of generation state.

### Core rule

> A generation call in flight must never prevent the user from reading, navigating,
> or manually editing the current draft.

### Per call-type strategy

#### Content generation (`generate_draft`, `generate_mcq`)

These are the slowest calls and the most common in the authoring workflow.

**Approach: non-blocking background generation.**

1. User triggers generation (source material submitted, certificationLevel selected).
2. Chat pane immediately shows a progress card:
   ```
   Genererer modulutkast…
   ████████░░░░░░░░░░  dette kan ta 10–20 sekunder
   [Avbryt]
   ```
3. The rest of the UI remains fully interactive: user can switch preview locale,
   read existing draft, or manually edit any content card via the existing dialogs.
4. When generation completes, the preview pane highlights the new fields and the chat
   pane shows a summary: "Utkast klart – taskText og guidanceText er oppdatert."
5. The user must explicitly accept ("Bruk dette utkastet") before draft state is updated.
   This prevents partial overwrites if the user has manually edited fields while waiting.

**Abort:** The Avbryt button calls `AbortController.abort()` on the in-flight fetch.
The backend route forwards the `AbortSignal` to the Azure OpenAI call if Node 18+ supports it;
otherwise the request completes server-side but the result is discarded on the frontend.

#### MCQ generation

Same non-blocking pattern as above. The progress card shows question count:
"Genererer 10 flervalgsspørsmål…"

After completion, the chat pane shows a preview of the first two questions before the user
accepts. This lets the user quickly assess quality before committing.

#### Translation (Slice 3)

Translation operates on fields that are already written. Non-blocking is critical here
because the user may be working in another locale while translation runs.

Translation runs per field or per locale, not as a single monolithic call. This allows:
- Showing partial results as each field completes.
- Letting the user abort mid-translation without losing partial output.

Each translated field is shown in the preview immediately as it arrives, marked
"Oversatt – ikke lagret" until the user accepts.

#### Intent classification (Slice 3, fast path)

The intent classifier has a short, constrained prompt and small output.
Expected latency: 0.5–2 s. This is fast enough to stay in the synchronous user flow.

Strategy:
- Show a brief "Tolker kommando…" indicator in the chat pane (not a full spinner).
- If the response takes more than 2 s, upgrade to a visible progress state.
- If classification returns `{ type: "unknown" }`, the chatbot asks the user to rephrase
  immediately — no retry loop.

### Streaming (future enhancement, not in Slice 1–2)

The current `callLlm` function returns a parsed JSON object. Azure OpenAI supports
`stream: true`, which returns token-by-token via Server-Sent Events.

Streaming is not implemented in the current backend. Adding it requires:
1. New SSE-capable route (or upgrade of `/generate/module-draft`).
2. Frontend `EventSource` or `fetch` with `ReadableStream` consumer.
3. Partial JSON buffering until a complete object is available for validation.

Streaming would improve perceived responsiveness for generation (visible typing effect)
but adds implementation complexity. It is deferred to a post-Slice-2 enhancement.
The non-blocking async pattern above covers the latency problem sufficiently for MVP.

### What does NOT change because of this

- All mutations (save draft, publish) remain synchronous in the user flow.
  These are fast API calls (< 1 s) and confirmation gates already handle the pause naturally.
- The intent classifier result is always validated before any mutation executes.
  Optimistic execution of mutations (apply before classification confirms) is not permitted.

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

1. **New page URL.** Should the conversational workspace live at `/admin-content-v2` during
   rollout, or replace `/admin-content` immediately with the advanced editor accessible at
   `/admin-content/advanced`? The current plan assumes `/admin-content-v2` for now.

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

5. **Streaming priority.** The non-blocking async pattern is the MVP plan. If SMO
   feedback shows that the progress card is not reassuring enough during 10–20 s waits,
   streaming should be prioritised before Slice 3. This requires a new SSE endpoint and
   frontend stream consumer. Decision point: after first SMO usability test on Slice 2.

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
- [ ] Approved by user before implementation of #295 begins

---

## References

- GitHub epic: #293
- Branch strategy: [ADMIN_CONTENT_EPIC_BRANCH_STRATEGY.md](ADMIN_CONTENT_EPIC_BRANCH_STRATEGY.md)
- AI workflow: [AI_WORKFLOW.md](AI_WORKFLOW.md)
- Previous editor design: [ADMIN_CONTENT_DIALOG_REDESIGN.md](ADMIN_CONTENT_DIALOG_REDESIGN.md) (issue #135, closed)
- LLM generation service: `src/modules/adminContent/llmContentGenerationService.ts`
- Existing API endpoints: `src/routes/adminContent.ts`
