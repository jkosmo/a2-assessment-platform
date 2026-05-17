# Deploy Optimization — Living Document

> **Purpose:** Track deploy time measurements, identified bottlenecks, and proposed optimizations. Updated by the post-deploy monitoring agent after each deploy. Redesign proposals go here before implementation.
>
> **Why this matters:** Deploy time is a stability parameter, not just a convenience metric. Long deploys create pressure to bundle changes, which increases blast radius per deploy. Target: staging deploy under 5 min, prod deploy under 10 min.

---

## Active rollout plan (2026-05-17)

Sequenced to minimize deploy cycles. Each wave waits for the previous to stabilize.

| Wave | Scope | Issues | Deploys | Status |
|------|-------|--------|---------|--------|
| 1 | actionlint in CI | #426 | 0 (CI only) | pending |
| 2 | Bicep timeout fix (v1.1.41 already in main) | #427 | 1 (stg+prd) | pending |
| 3 | P1 artifact reuse | (P1 below) | 1 (stg+prd) | pending |
| 4 | KV RBAC → split workflow → grant SP role | #428, #425, #404 | 3–4 deploys, spread weeks | deferred |

**Discipline rules** are authoritative in [CLAUDE.md § Deploy discipline](../CLAUDE.md#deploy-discipline--established-2026-05-17). Summary:
- Max one structural change per deploy
- CI-only fixes before any prod deploy
- One released version per confirmed fix, not per attempt
- Read platform `docker.log` before app `default_docker.log` when diagnosing hangs
- Verify lock hypotheses with `pg_stat_activity` before acting
- Use `Monitor` (read-only) for deploy observation, not `Agent`
- Occam's razor before exotic hypotheses

---

## Measured deploy times

| Date | Run | Environment | Duration | Outcome | Notes |
|------|-----|-------------|----------|---------|-------|
| 2026-05-17 | 25983751451 | staging | 4m | failure | RoleAssignmentExists — aborted early |
| 2026-05-17 | 25984078289 | staging | 16m | success | v1.1.34 bicep fix |
| 2026-05-17 | 25984407821 | staging+prod | 17m+ | in progress | v1.1.34 prod deploy |
| 2026-05-17 | 25985553582 | CI only | 1m15s | success | v1.1.36 — infra-lint 4s, verify 1m11s; no deploy triggered |
| 2026-05-17 | 25985699851 | staging | 14m36s | failure+manual-fix | v1.1.37 — Wait-Stable 3 consecutive failures (checks 5-7); app deployed correctly, manual restart resolved; web+worker healthy at 08:44 UTC |
| 2026-05-17 | 25987069247 | staging | 32m34s | success | v1.1.38 — first staging deploy with env.ts ACS fix; Wait-Healthy took ~6 min (MSI sidecar resolving 10 KV refs on B1) |
| 2026-05-17 | 25987845377 | prod | 14m59s | failure | v1.1.40 — Wait-Stable failed 3 consecutive; actual root cause: `WEBSITES_CONTAINER_START_TIME_LIMIT=300` killed container at exactly 300s. Manual override to 600s + restart recovered prod. See #427 |
| 2026-05-17 | (manual) | prod | n/a | recovered | `az webapp config appsettings set WEBSITES_CONTAINER_START_TIME_LIMIT=600` + container restart; healthy at 10:59 UTC; v1.1.41 in main locks this into Bicep |

---

## Known bottlenecks

### 1. ACS email provisioning — 20–40 min (conditional, VERIFIED safe)
`Microsoft.Communication/emailServices/domains` takes 20–40 min to provision on first creation or recreation. Bicep is idempotent so this should only occur on environment creation.

**Status (2026-05-17):** Verified working correctly. Prod ARM deploy on 2026-05-17 completed in ~7 min total with all ACS resources reported `Succeeded` immediately (no-change detection working). P3 below is **resolved**.

### 2. Post-deploy web app instability — ROOT CAUSE FOUND 2026-05-17 (#427)
**Confirmed root cause:** `WEBSITES_CONTAINER_START_TIME_LIMIT=300` on prod (vs 600 on staging). Cold-start exceeds 300s because:

- ~1 min: SSH service starts
- ~2 min: cert update (`WEBSITES_INCLUDE_CLOUD_CERTS not set to true` → slow path)
- ~1 min: Prisma migrate startup (connection + schema load, even with zero pending migrations)
- ~1 min: 10 KV references resolve via MSI sidecar on B1

Azure terminates the container at exactly 300s (`Site startup probe failed after 300 seconds` in platform docker.log). Subsequent manual restarts succeed because warm starts skip the 2-minute cert update path.

**Why earlier hypotheses were wrong:**
- ❌ B1 memory pressure — no OOM events in any logs
- ❌ Prisma migration blocking event loop — migrations table shows all completed yesterday, no pending
- ❌ MSI sidecar cycling — KV refs resolved successfully each time
- ❌ Lock contention on ModuleVersion — verified via pg_locks query, no locks

**Diagnostic key:** read `LogFiles/*_docker.log` (platform-level) BEFORE `*_default_docker.log` (app-level). The platform log tells you what Azure thinks happened; the app log only shows what the app got to say before being killed.

**Fix:** v1.1.41 in main sets timeout to 600s for all envs in Bicep. Needs to be deployed (Wave 2 in #427).

### 3. App restart + warmup — 236–295s (~4 min) on B1
After zip deploy, App Service restarts the container. MSI sidecar must start and resolve all Key Vault references before Node.js starts. Currently 10 KV references × round-trip latency on shared B1 CPU.

- `alwaysOn: true` is already set — this is not idle cold-start, it is deploy-induced restart
- `WEBSITES_CONTAINER_START_TIME_LIMIT`: 600s for all envs (after v1.1.41)
- `WEBSITES_INCLUDE_CLOUD_CERTS` not explicitly set — defaulting to slow cert update path (~2 min). Worth investigating if setting it explicitly removes the 2-min penalty.

### 3. Build package step — ~3 min
`npm ci` + `prisma:generate` + `tsc` + `npm prune` + `zip`. Runs separately for staging and prod (no artifact reuse between jobs).

**Optimization opportunity:** Build once, deploy to both. A single build artifact could be uploaded to GitHub artifacts and downloaded by the prod job, eliminating the second full build.

### 4. No staging skip for prod-only deploys — fixed in v1.1.35
Previously, `deploy_production=true` always re-ran the full staging deploy even when staging was already verified. Fixed: `skip_staging=true` input added.

---

## Optimization proposals

### P1 — Reuse build artifact between staging and prod jobs
**Effort:** Medium | **Risk:** Low | **Expected gain:** ~3 min off prod deploy

Current: staging builds a zip, prod builds a separate zip from the same commit.  
Proposed: Add a `build` job that runs first, uploads zip as GitHub artifact, both staging and prod download and deploy it.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - ... npm ci, build, zip ...
      - uses: actions/upload-artifact@v4
        with:
          name: deployment-package
          path: ${{ runner.temp }}/a2-assessment.zip

  deploy-staging:
    needs: build
    steps:
      - uses: actions/download-artifact@v4
        with: { name: deployment-package }
```

**Security consideration:** Artifact is scoped to the workflow run. No additional exposure vs. current approach.

### ~~P2 — Reduce KV references from 10 to 4~~ — INVALID (2026-05-17)
Audited the 10 KV references. All are genuine secrets (DB credentials, API keys, connection strings, webhook auth tokens). None can be moved out of KV without weakening the security posture. **Rejected.**

### ~~P3 — Verify ACS no-change detection~~ — VERIFIED (2026-05-17)
Confirmed working. Prod ARM deploy on run 25987845377 completed in 7 min total with `emailServices/domains` reported `Succeeded` immediately (no provisioning delay). **Closed.**

### P4 — Parallel staging + prod deploys (longer term)
**Effort:** High | **Risk:** Medium | **Expected gain:** Full staging duration off the critical path

If we trust the build artifact (P1) and have high confidence in the code, staging and prod could deploy in parallel from the same artifact. Staging would serve as a canary rather than a gate.

**Security consideration:** Removes the staging-as-gate model. Only appropriate after we have reliable automated smoke tests that can catch regressions independently of deploy order.

### P5 — Set WEBSITES_INCLUDE_CLOUD_CERTS explicitly (investigation)
**Effort:** Low (one app setting) | **Risk:** Low | **Expected gain:** up to ~2 min off cold start

Currently the platform log shows `WEBSITES_INCLUDE_CLOUD_CERTS is not set to true` and then performs a 2+ minute cert rehash. Setting this to `false` explicitly (we don't need the extra certs) may skip the rehash entirely.

Test on staging first; verify Azure CLI / outbound HTTPS still works after.

---

## Security checks that must stay

These checks add time but are non-negotiable:

- ARM What-If on PRs (bicep-whatif.yml) — catches destructive infra changes before merge
- `/healthz` smoke test after every deploy — the May 2026 staging outage was undetected without this
- Azure OIDC login — no stored credentials
- `npm ci --ignore-scripts` — supply chain protection

---

## Agent instructions

The post-deploy monitoring agent should append a row to the **Measured deploy times** table after each deploy, and flag any new bottleneck observed in logs (slow steps, unexpected resource provisioning, warmup regressions).
