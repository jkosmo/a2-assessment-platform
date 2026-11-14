---
name: deploy-runbook
description: How to deploy the A2 Assessment Platform — which GitHub workflow to use (deploy-app vs deploy-azure), promoting a stage-verified git_ref to prod while main advances, and the pre-merge production Bicep what-if. Use before triggering any stage or prod deploy.
---

# Deploy runbook

Moved from CLAUDE.md (2026-11-14) so it loads only when deploying. The prohibitions (never run the deploy script
locally, infra invariants, deploy discipline) stay in CLAUDE.md.

## Which deploy workflow to use

| Type of change | Use workflow | Why |
|----------------|--------------|-----|
| Code-only (no `infra/`, no Bicep, no workflow YAML) | `.github/workflows/deploy-app.yml` | ~6 min faster (~16 min vs ~22 min) — skips ARM, KV-ref wait, explicit restart |
| Anything touching `infra/azure/*.bicep` | `.github/workflows/deploy-azure.yml` | Full deploy — applies Bicep changes |
| Changes to `.github/workflows/*.yml` | `.github/workflows/deploy-azure.yml` | Workflow changes only take effect on next deploy from main; use full deploy to be safe |
| Changes to `scripts/azure/deploy-environment.ps1` | Either | Both workflows use the same script; the change auto-picks via main |
| Secret rotation requiring KV-ref refresh | `.github/workflows/deploy-azure.yml` | KV-ref propagation + container restart needed |

## Promoting a verified version to prod while `main` advances

Both deploy workflows accept a `git_ref` input. The workflow is still **triggered from `main`** (all
`ref_name == default_branch` gating and the production-environment approval gate stay intact), but the
checkout/build uses the pinned ref instead of `main` HEAD. This decouples "what's verified on stage and
promoted to prod" from "what's currently on `main`" — so feature work can keep flowing to local/stage on
`main` without dragging unverified commits into a prod promotion.

**Flow:**
1. Tag the stage-verified commit: `git tag v1.3.67 <sha> && git push origin v1.3.67`.
2. Promote that tag to prod (skipping a redundant stage redeploy):
   `gh workflow run deploy-app.yml --ref main -f git_ref=v1.3.67 -f deploy_production=true -f skip_staging=true`
3. `main` keeps moving; stage deploys still default to `main` HEAD (empty `git_ref`).

Use `deploy-app.yml` for code-only promotions. For infra, leave `git_ref` empty (pinning an old tag would
also re-apply that ref's Bicep). `/version` on prod reflects the deployed tag — verify it after promotion.

## Pre-merge Bicep what-if (production)

Before merging a PR that touches `infra/azure/*.bicep` or `scripts/azure/deploy-environment.ps1`, run a production what-if to see the ARM diff:

```bash
gh workflow run bicep-whatif-prod.yml -f pr_number=<PR_NUMBER>
```

The diff is posted as a PR comment. Staging what-if runs automatically on PR; prod what-if is manual because the production GitHub environment has approval gates that would block PR-time auto-runs (#419).
