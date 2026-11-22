---
name: ai-delegation
description: Delegating implementation to Codex or Gemini with scripts/ai-draft.ps1 (when to delegate, which tier) and the mandatory QA checklist Claude runs on the result before committing.
---

# AI delegation workflow

Moved from CLAUDE.md (2026-11-14) so it loads only when delegating.

Use `scripts/ai-draft.ps1` to delegate implementation to Codex or Gemini, then Claude QAs.

## When to delegate

| Task size | Action |
|-----------|--------|
| < ~50 lines, single file | Claude handles directly |
| 50–300 lines, well-specified | Delegate with `Tier=medium` |
| Large feature / multi-file | Delegate with `Tier=complex` |
| Security-critical, auth, infra | Delegate with `Tier=security` (but raise scrutiny in QA) |

The tier → model mapping lives in `scripts/ai-draft.ps1` (`$codexModels` / `$geminiModels`).

## Mandatory QA checklist after delegation

After `ai-draft.ps1` finishes, Claude MUST:

1. `git diff HEAD` — read the full diff, verify logic and intent
2. `npx tsc --noEmit` — must be zero errors before proceeding
3. `npx vitest run test/unit/` — no new failures allowed
4. Check specifically for: fabricated constants/hashes, broken YAML in workflows, missing required config flags (e.g. `enableRbacAuthorization`), enum values that don't exist in schema
5. Verify `package.json` and `doc/VERSIONS.md` were bumped

Only after QA passes: commit, push, trigger CI/CD.
