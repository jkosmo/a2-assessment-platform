# Shell / Advanced editor — feature parity checklist

> **Purpose**: Regression guard for the admin-content redesign (#293, #313–#317).
> Before merging any change to either mode, verify each item in the relevant column.
> Update this list whenever a new feature is added to either mode.

## Reading state

| Feature | Conversational shell (`/admin-content`) | Advanced editor (`/admin-content/advanced`) |
|---|:---:|:---:|
| List of modules with status badge | ✅ chat choices | ✅ module dropdown |
| Module title visible | ✅ preview pane | ✅ status section |
| Module description visible | ✅ preview pane | ✅ status section |
| Live version number visible | ✅ state rail `srLive` | ✅ state rail `srLive` |
| Draft version number visible | ✅ state rail `srEditing` | ✅ state rail `srEditing` |
| Unsaved-changes indicator | ✅ state rail `srChanges` | ✅ state rail `srChanges` |
| MCQ list preview | ✅ preview pane | ✅ content cards |
| Locale switching in preview | ✅ preview locale bar | ❌ not implemented (#315) |

## Editing state

| Feature | Conversational shell | Advanced editor |
|---|:---:|:---:|
| Edit module title/description | ✅ conversational chat | ✅ metadata card |
| Edit task text | ✅ conversational chat | ✅ content card |
| Edit guidance text | ✅ conversational chat | ✅ content card |
| Edit rubric criteria | ❌ not exposed in shell | ✅ rubric card |
| Edit MCQ set | ✅ conversational chat | ✅ MCQ card |
| Edit MCQ options individually | ✅ conversational chat | ✅ MCQ card |

## Persistence

| Feature | Conversational shell | Advanced editor |
|---|:---:|:---:|
| Save draft (explicit) | ✅ "Lagre utkast" action | ✅ "Lagre utkast" button |
| Publish draft | ✅ conversational confirm flow | ✅ "Publiser" button |
| Unpublish (revert to draft) | ❌ not in shell | ✅ advanced only |
| Import draft from JSON/file | ❌ not in shell | ✅ advanced only |
| Export module | ❌ not in shell | ✅ advanced only |
| Duplicate module | ❌ not in shell | ✅ advanced only |
| Delete module (soft-archive) | ❌ not in shell | ✅ advanced only |
| Create new module (shell/manual) | ❌ not in shell | ✅ advanced only |

## Navigation & UX safety

| Feature | Conversational shell | Advanced editor |
|---|:---:|:---:|
| Mode switch link | ✅ "Avansert redigering ↗" | ✅ "Enkel redigering ↗" |
| Unsaved-changes warning on switch | ❌ not implemented (#314) | ❌ not implemented (#314) |
| Confirmation before publish | ✅ conversational confirm | ✅ window.confirm dialog |
| Confirmation before unpublish | n/a | ✅ window.confirm dialog |
| Locale picker (UI language) | ✅ top bar | ✅ top bar |

## Accessibility

| Feature | Conversational shell | Advanced editor |
|---|:---:|:---:|
| Skip-nav link | ✅ | ✅ |
| ARIA live region on chat output | ✅ `aria-live="polite"` | n/a |
| ARIA labels on main sections | ✅ | partial (#317) |
| Keyboard-navigable chat choices | needs audit (#317) | n/a |
| Focus management after action | needs audit (#317) | needs audit (#317) |

---

## How to use this checklist during a PR review

1. Identify which cells your PR touches (any `✅` that could become `❌`).
2. Manually verify each affected cell in both modes.
3. If a gap is **intentional** (feature belongs in advanced only), note it in the PR description.
4. If a gap is **unintentional**, either fix it or open a follow-up issue before merging.
5. Update this file if the PR adds or removes features.
