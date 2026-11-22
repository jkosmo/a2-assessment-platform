---
name: deploy-runbook
description: How to deploy the A2 Assessment Platform — which GitHub workflow to use (deploy-app vs deploy-azure), promoting a stage-verified git_ref to prod while main advances, and the pre-merge production Bicep what-if. Use before triggering any stage or prod deploy.
---

# Deploy runbook

Moved from CLAUDE.md (2026-11-14) so it loads only when deploying. The prohibitions (never run the deploy script
locally, infra invariants, deploy discipline) stay in CLAUDE.md.

## Stage is not in Azure (since 2026-11-22)

The Azure stage app layer (App Services, plan, PostgreSQL, alerts, availability tests) was removed to save about
560 of 570 kr a month. Blob, OpenAI, ACS and Key Vault in the stage resource group remain, and the self-hosted stage
uses them. Stage now runs on a self-hosted server under a resource cap that mimics what the apps get on prod's B1 plan:
one core, and 640 MB shared by web, worker and parser. B1 has 1.75 GB, but the platform itself uses ~1.2 GB of it
(measured 2026-11-22), so the apps share ~600 MB. The app directory is read-only, like Run-From-Package.

- **Stage deploy:** `srv utrull a2 <full sha>` over SSH. The exact commands, the address and what needs the owner's
  password are in `doc/ENVIRONMENTS.local.md`. Never put the address in a tracked file.
- **Stage tests:** `npm run test:stage` reads the address from `STAGE_BASE_URL` or `baseUrl` in the gitignored
  `.stage-service.json` (`scripts/test/stage-base-url.mjs`). Run file by file.
- **Prod deploy: always `skip_staging=true`.** Without it `deploy-app.yml` fails in the stage job (prod is skipped),
  and `deploy-azure.yml` would recreate the whole Azure stage, cost included.
- **Infra changes** (Bicep, workflows, `scripts/azure`) can no longer be tried on an Azure stage first. Run the prod
  what-if (below), deploy outside working hours, and watch `/version` and `/healthz` on web and worker. If an Azure
  stage is ever needed again: `activate-staging-app-layer` (untested; starts with an empty database).

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
3. `main` keeps moving. A full SHA works as `git_ref` too (a short SHA fails the checkout).

Use `deploy-app.yml` for code-only promotions. For infra, leave `git_ref` empty (pinning an old tag would
also re-apply that ref's Bicep). `/version` on prod reflects the deployed tag — verify it after promotion.

## Pre-merge Bicep what-if (production)

Before merging a PR that touches `infra/azure/*.bicep` or `scripts/azure/deploy-environment.ps1`, run a production what-if to see the ARM diff:

```bash
gh workflow run bicep-whatif-prod.yml -f pr_number=<PR_NUMBER>
```

The diff is posted as a PR comment. Staging what-if runs automatically on PR; prod what-if is manual because the production GitHub environment has approval gates that would block PR-time auto-runs (#419).
