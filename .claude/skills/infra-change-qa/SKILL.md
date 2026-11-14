---
name: infra-change-qa
description: Verification checklist for any change touching infra/ (Bicep), scripts/azure/ or .github/workflows/ — permissions and identity, ARM dependency chain, secret sync, production safety. Use before committing such a change; the prohibitions themselves stay in CLAUDE.md («Infra hard invariants»).
---

# Infra change QA

Moved from CLAUDE.md (2026-11-14) so it loads when infra is touched. The «Never» rules stay in CLAUDE.md, and
`scripts/lint-infra.sh` (CI) enforces several of them mechanically.

## Additional QA for infra changes (Bicep / PowerShell / GitHub Actions)

For any change touching `infra/`, `scripts/azure/`, or `.github/workflows/`, Claude MUST also verify:

**Permission and identity**
- Does this change `enableRbacAuthorization` on Key Vault? It must always be `true`, never coupled to a deploy flag.
- Are role assignment GUIDs seeded on `principalId`, not `App.id` or other mutable values?
- If App Services are deleted and recreated, do the managed identities still have KV access?

**ARM dependency chain**
- If a Bicep resource is made conditional (`= if (condition)`), do all child resources have explicit `dependsOn` on that resource?
- If switching a child resource's `parent:` from a deployed resource to an `existing` reference, is ARM ordering still guaranteed?

**Secret and credential sync**
- If a KV secret (e.g. `DATABASE-URL`) is updated, is the underlying resource (e.g. PostgreSQL) also updated with the same credential — or is the skip path explicitly handled to reuse the existing credential?

**Production safety**
- `SKIP_ROLE_ASSIGNMENTS` is no longer an active workaround — #404 closed 2026-05-19, the GitHub var is unset on both environments, deploys default to `false`, and role assignments are created normally on every deploy. The `skipRoleAssignments` Bicep param still exists and must remain functional (re-deploys that toggle it must succeed in either direction), but do not assume `true` is the current operational state.
- Does the change behave correctly with `skipRoleAssignments=false` (current operational default)?
- Do prod-destructive scripts assert the correct subscription before acting?

**ARM validation gap**
- A green ARM deploy does NOT prove runtime correctness. Verify MSI sidecar, KV reference resolution, and `/healthz` on staging before promoting to prod.
