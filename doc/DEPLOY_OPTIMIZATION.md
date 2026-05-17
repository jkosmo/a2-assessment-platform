# Deploy Optimization — Living Document

> **Purpose:** Track deploy time measurements, identified bottlenecks, and proposed optimizations. Updated by the post-deploy monitoring agent after each deploy. Redesign proposals go here before implementation.
>
> **Why this matters:** Deploy time is a stability parameter, not just a convenience metric. Long deploys create pressure to bundle changes, which increases blast radius per deploy. Target: staging deploy under 5 min, prod deploy under 10 min.

---

## Measured deploy times

| Date | Run | Environment | Duration | Outcome | Notes |
|------|-----|-------------|----------|---------|-------|
| 2026-05-17 | 25983751451 | staging | 4m | failure | RoleAssignmentExists — aborted early |
| 2026-05-17 | 25984078289 | staging | 16m | success | v1.1.34 bicep fix |
| 2026-05-17 | 25984407821 | staging+prod | 17m+ | in progress | v1.1.34 prod deploy |
| 2026-05-17 | 25985553582 | CI only | 1m15s | success | v1.1.36 — infra-lint 4s, verify 1m11s; no deploy triggered |
| 2026-05-17 | 25985699851 | staging | 14m36s | failure+manual-fix | v1.1.37 — Wait-Stable 3 consecutive failures (checks 5-7); app deployed correctly, manual restart resolved; web+worker healthy at 08:44 UTC |

---

## Known bottlenecks

### 1. ACS email provisioning — 20–40 min (conditional)
`Microsoft.Communication/emailServices/domains` takes 20–40 min to provision on first creation or recreation. Bicep is idempotent so this should only occur on environment creation — but needs verification that ARM is correctly detecting no-change state on subsequent deploys and skipping the wait.

**Risk:** If ARM re-evaluates the domain resource on every deploy (even no-change), this adds 20–40 min to every deploy.

**Investigation needed:** Check ARM operation logs to confirm `emailServices/domains` is `noChange` or `succeeded` immediately on re-deploys where the domain already exists.

### 2. Post-deploy web app instability — requires manual restart (recurring)
Observed 2026-05-17 prod deploy (run 25984407821): initial `/healthz` passed on attempt 1, but web app returned 504 during stability check 3/6 (~30s later). Manual `az webapp restart` resolved it. User confirms this is a recurring pattern.

**Root cause unknown.** Candidates:
- B1 memory pressure: app starts, serves first requests, OOM-kills and restarts
- Prisma migration (`SKIP_MIGRATE=false` in prod) blocking event loop during first requests
- MSI sidecar cycling during the stability window, temporarily breaking KV reference resolution

**Current workaround:** Manual restart after deploy if stability check fails.  
**Proper fix:** Diagnose root cause — add memory metrics monitoring, check if failure correlates with Prisma migration timing.

**Stability check failure is the deploy script failing** (line 764) — the app was actually deployed correctly but the script reports failure. This means prod is actually on the new version after a manual restart, even when the workflow shows red.

### 3. App restart + warmup — 236–295s (~4 min) on B1
After zip deploy, App Service restarts the container. MSI sidecar must start and resolve all Key Vault references before Node.js starts. Currently 10 KV references × round-trip latency on shared B1 CPU.

- `alwaysOn: true` is already set — this is not idle cold-start, it is deploy-induced restart
- `WEBSITES_CONTAINER_START_TIME_LIMIT`: 300s (prod), 600s (staging)
- MSI sidecar crash observed 2026-05-16 — may be B1 memory pressure (see #423)

**Related issue:** #422

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

### P2 — Reduce KV references from 10 to 4
**Effort:** Low (Bicep only) | **Risk:** Low | **Expected gain:** ~1–2 min off warmup

Move non-secret values out of Key Vault into direct App Service app settings:
- Keep in KV: `DATABASE-URL`, `AZURE-OPENAI-API-KEY`, `ACS-CONNECTION-STRING`, `PARSER-WORKER-AUTH-KEY`
- Move to direct settings: `ASSESSMENT_JOB_POLL_INTERVAL_MS`, `APPEAL_SLA_MONITOR_INTERVAL_MS`, and similar operational config

**Trade-off:** Moved values become visible in Azure Portal to anyone with App Service read access.

**Related issue:** #422

### P3 — Verify ACS no-change detection
**Effort:** Low (investigation) | **Risk:** None | **Expected gain:** 0–40 min depending on finding

Check ARM operation logs after a successful deploy to confirm `emailServices/domains` is a no-op when already provisioned. If ARM is re-waiting on every deploy, we may need to gate the ACS resource creation more tightly in Bicep.

### P4 — Parallel staging + prod deploys (longer term)
**Effort:** High | **Risk:** Medium | **Expected gain:** Full staging duration off the critical path

If we trust the build artifact (P1) and have high confidence in the code, staging and prod could deploy in parallel from the same artifact. Staging would serve as a canary rather than a gate.

**Security consideration:** Removes the staging-as-gate model. Only appropriate after we have reliable automated smoke tests that can catch regressions independently of deploy order.

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
