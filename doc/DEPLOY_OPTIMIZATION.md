# Deploy Optimization — Living Document

> **Purpose:** Track deploy time measurements, identified bottlenecks, and proposed optimizations. Updated by the post-deploy monitoring agent after each deploy. Redesign proposals go here before implementation.
>
> **Why this matters:** Deploy time is a stability parameter, not just a convenience metric. Long deploys create pressure to bundle changes, which increases blast radius per deploy. Target: staging deploy under 5 min, prod deploy under 10 min.

> ✅ **#431 fully resolved 2026-05-18.** Bundled-secret path validated end-to-end in production via v1.1.49 (`startup.mjs` now parses APP_RUNTIME_SECRETS before spawning Prisma subprocess). Prod's `Wait-Stable` confirmed 6/6 clean on `/version == 1.1.49`. Cold-start time on prod with bundled secrets + cloud-certs-off: ~5 min.
>
> ⚠️ **Pre-existing issue surfaced by v1.1.49 prod deploy:** the deploy SP lacks permission to create the backup vault resource group (`rg-a2-assessment-backup`). The app deploy itself succeeded cleanly — only the post-deploy backup vault step failed. This is **separate from #431** and relates to #404 (deploy SP role grant). Until granted, `deploy-azure.yml` to prod will report failure even when app deploy is clean.

---

## Active rollout plan (2026-05-17)

Sequenced to minimize deploy cycles. Each wave waits for the previous to stabilize.

| Wave | Scope | Issues | Deploys | Status |
|------|-------|--------|---------|--------|
| 1 | actionlint in CI | #426 | 0 (CI only) | ✓ done (v1.1.42) |
| 2 | Bicep timeout fix | #427 | 1 (stg+prd) | ✓ done (v1.1.41+42, prod on 1.1.42) |
| 2.5 | Deploy script verification bugs | #429 | 1 (stg only — script change auto-picks for prod) | ✓ done (v1.1.43) |
| 3 | WEBSITES_INCLUDE_CLOUD_CERTS | #430 | 1 deploy | ✓ done on staging (v1.1.44, **not deployed to prod** — cascade risk) |
| 3 (+secondary goal) | Split workflow (infra vs app) | #425 | 1+ deploy | ✓ done on staging (v1.1.45, **not deployed to prod** — deploy-tooling change auto-picks via main) |
| 4 | KV RBAC → grant SP role | #428, #404 | 2 deploys | deferred |

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
| 2026-05-17 | 25989345754/25989386807 | CI only | 1m+6s | success | v1.1.42 — Wave 1 actionlint integration; shellcheck disabled to avoid style-warning noise |
| 2026-05-17 | 25989438848 | staging | 12m33s | success | v1.1.42 — Wave 2 with Bicep timeout fix; 20 min faster than 2026-05-17 staging (32m) thanks to ARM no-change + v1.1.41 timeout |
| 2026-05-17 | 25989764900 | prod | 15m59s | failure+app-recovered | v1.1.42 — Wait-Stable failed 3 consecutive at attempt 5-7; VNETFailure during restart triggered second cold start; app actually came up healthy on v1.1.42 at 12:02 UTC. Script reported failure but deploy succeeded. See #429 Bug 3 for the Wait-Stable tolerance issue |
| 2026-05-17 | 25990441607 | staging | 19m57s | failure+app-recovered | v1.1.43 first attempt — Wait-Stable correctly waited for /version match but timed out at 15 failures (~9 min). App came up healthy 60-90s after script gave up. Hotfix d5a90cb bumped tolerance to 30 |
| 2026-05-17 | 25990996032 | staging | 22m15s | success | v1.1.43 + tolerance=30 hotfix — first **truly clean** deploy with no false reports. Version-aware Wait-Stable correctly waited for new container cold-start. Wave 2.5 complete |
| 2026-05-17 | 25991581849 | staging | 31m46s | success+cascade | v1.1.44 — WEBSITES_INCLUDE_CLOUD_CERTS=false. Cascading container restart added ~9 min (Azure-side, SiteStartupCancelled at 13:22; new container at 13:25 succeeded). App on 1.1.44 confirmed |
| 2026-05-17 | 25992327380 | staging | **16m18s** | success | v1.1.45 — **first app-only deploy via new deploy-app.yml**. Skipped ARM/Bicep, Wait-KV, restart. ~6 min faster than v1.1.43 full deploy. Wave 3 complete |
| 2026-05-17 | 25997727280 | staging | 12m54s | success | v1.1.46 — MCQ count fix (#424). deploy-app.yml — even faster than first measurement |
| 2026-05-17 | 25998074546 | **prod** | **15m0s** | success | v1.1.46 — **first clean prod deploy via deploy-app.yml**. No false alarms. MCQ fix live |
| 2026-05-17 | 25998477632 | staging | 29m44s | success | v1.1.47 (#431 Stage 1) — bundled secret added alongside individual refs. Validates bundle path works |
| 2026-05-17 | 25999563382 | staging | 29m51s | success | v1.1.48 (#431 Stage 2) — individual KV refs removed. **Cold-start 4m37s** vs ~6-9 min baseline |
| 2026-05-17 | 26001359725 | **prod** | 33m54s | **failure** | v1.1.48 (#431 Stage 2) — Prisma subprocess can't see bundled secret (prod has SKIP_MIGRATE=false). App crash-looped on `Environment variable not found: DATABASE_URL`. Recovered by manually re-adding DATABASE_URL KV ref via `az webapp config appsettings set`. Prod on v1.1.48 confirmed at 20:51 UTC after ~4 min cold-start |
| 2026-05-18 | 26014263032 | staging | 22m47s | success | v1.1.49 — startup.mjs parses bundled secret before Prisma subprocess. SKIP_MIGRATE=true here so Prisma not exercised, but app starts cleanly |
| 2026-05-18 | (manual restart) | staging | 96s cold-start | success | v1.1.49 + SKIP_MIGRATE=false temporarily — **validated Prisma subprocess path**. New container with 96-second cold-start (best ever measured) |
| 2026-05-18 | 26015191246 | **prod** | 34m1s (clean app deploy + backup-vault permission failure) | mixed | v1.1.49 — **bundled secret + Prisma subprocess fix fully working in prod**. `Wait-Stable confirmed 6/6` clean on /version==1.1.49. Backup vault RG creation failed at end with AuthorizationFailed (#404 territory, pre-existing). App is on v1.1.49 healthy |
| 2026-05-19 | 26082016139 | staging | 4m (early fail) | failure | v1.1.57 #406 stable GUIDs — staging KV already had 10 role assignments from 2026-05-15 with OLD unstable-GUID seeds; ARM blocked with 10× `RoleAssignmentExists` (PUT not idempotent for principal+role+scope tuple). Prod job skipped (gated on staging) |
| 2026-05-19 | 26082568457 | staging | 4m (early fail) | failure | v1.1.58 patch 1 (Wait-GroupDeployment idempotency) — WARN fired correctly for the 10 RAE failures, but immediately after, ARM emits no outputs when state=Failed → script threw on `webAppName output missing` |
| 2026-05-19 | 26082842024 | staging | 4m (early fail) | failure | v1.1.58 patch 2 (b579618 outputs-fallback) — SAME error, the fallback `if (-not $webAppName)` check never ran because `$deployment.webAppName.value` threw FIRST under `Set-StrictMode -Version Latest` (line 70) when $deployment was null |
| 2026-05-19 | 26083148230 | staging+prod | staging 18m success, prod 31m (clean app deploy + backup-vault permission failure) | mixed | v1.1.58 patch 3 (f9b39f0 `Get-DeploymentOutputValue` StrictMode-safe helper) — full v1.1.58 trio working. Staging WARN succeeded; **prod KV flipped to RBAC, 10 stable-GUID role assignments created, web 200, worker 200 (4 monitors cycling), parser 401**. Tail-end fail on `az group create rg-a2-assessment-backup` — SP can't create RGs at subscription scope. See #439 |

---

## 2026-05-19 — v1.1.57 RAE / outputs cascade (incident narrative)

A 4-run / ~30-min cascade that started with a "clean" #406 implementation and unfolded three layered failures before reaching green. Worth keeping as reference for the next agent doing similar work — each layer was a different category of trap.

### Layer 1: ARM PUT for roleAssignments is NOT idempotent

#406 replaced unstable GUID seeds (`guid(secret.id, app.id, role)`) with stable ones (`guid(subscription, env, suffix)`). Bicep was correct. ARM was the surprise.

**The trap:** `Microsoft.Authorization/roleAssignments` does not behave like other ARM resources. PUT with a deterministic GUID name does NOT update-in-place if an assignment with the SAME (principalId, roleDefinitionId, scope) tuple already exists — ARM returns `RoleAssignmentExists` 409. The new GUID name and old GUID name are different ARM resources, but they map to the same RBAC fact, so ARM rejects the new one.

Staging had 10 role assignments under the OLD GUIDs from the 2026-05-15 deploy. The first attempt to deploy #406's stable-GUID Bicep tried to create 10 "new" role assignments, ARM rejected each.

**Fix:** `Wait-GroupDeployment` exempts the specific shape (`resourceType=Microsoft.Authorization/roleAssignments` AND `errorCode=RoleAssignmentExists`) — if ALL failures match, log a WARN and return. Any other failure still throws with the non-exempt operations listed for triage.

**Generalized lesson:** When migrating ARM resource naming, the principal+role+scope tuple matters more than the GUID name for role assignments. Either run an orphan-cleanup before the deploy, or accept that existing environments will WARN forever (functionally correct, cosmetically noisy) until cleaned up manually.

### Layer 2: ARM outputs not emitted when state=Failed

After layer 1's fix, `Wait-GroupDeployment` returned silently. The very next line was `$deployment = az deployment group show --query properties.outputs | ConvertFrom-Json`. ARM returns `null` for outputs when deployment ended in `Failed` state, even if we treated it as success.

**The trap:** Treating a Failed deployment as Succeeded (correctly!) in one layer doesn't mean downstream code that depends on outputs is safe.

**Fix:** Defensively parse the outputs JSON. If any of webAppName/workerAppName/parserAppName comes back null, fall back to `az webapp list --query "[?contains(name, '${envCode}-app')] | [0].name"` using the same naming-pattern matching that the skip-infra path already uses (lines 426-441).

### Layer 3: StrictMode property access is a footgun

The fallback from layer 2 was logically correct but never ran. The line `$webAppName = $deployment.webAppName.value` threw FIRST, before the `if (-not $webAppName)` check that would have triggered the fallback.

**The trap:** `Set-StrictMode -Version Latest` (line 70 of the script) causes ALL property access on null or on a PSCustomObject without the property to throw. A null-check on the RESULT of the access is too late.

**Fix:** Introduce `Get-DeploymentOutputValue` helper that probes `$obj.PSObject.Properties[name]` first. Returns `$null` cleanly for 5 input shapes (null, empty PSCustomObject, missing property, ARM-shape `{value: x}`, raw scalar). Validated locally against all 5.

**Generalized lesson:** Under `StrictMode -Version Latest`, treat `$obj.foo.bar` as throwing unless both `$obj` and `$obj.foo` have been verified to be non-null in the current scope. The compiler doesn't help; only runtime tests do. Hence #434 (Pester unit tests for this script).

### Layer 4 (still open as #439): backup vault RG permission gap

Run 26083148230 reached the END of the prod deploy: web /healthz 200 at 08:16, worker /healthz 200 at 08:23. Then failed at 08:24 with `AuthorizationFailed` on `rg-a2-assessment-backup` — the deploy SP only has Contributor on `rg-a2-assessment-production`, not at subscription scope, so it can't create the backup RG. Functionally, prod is in the desired state; this last permission gap blocks the deploy from reporting clean success.

**Fix path (tracked in #439):** Pre-create `rg-a2-assessment-backup` and grant the SP Contributor on it. Should also be part of #437's bootstrap script.

### Why this cost 3 deploy cycles

Each layer's symptom looked similar to the next:
- Layer 1 → layer 2: "deploy script throws after WARN" — looked like the WARN was wrong
- Layer 2 → layer 3: "deploy script throws after WARN, fallback didn't fire" — looked like the fallback was missing
- Only when I traced exactly which line threw did I realize StrictMode was the actual blocker

**The discipline rule we re-learned (already in CLAUDE.md):** "verify locally before pushing". The Get-DeploymentOutputValue function was validated against 5 input shapes locally and passed all 5. The earlier Wait-GroupDeployment idempotency exemption was validated against the actual failed-ops JSON shape. Without those local tests, the cascade would have been longer.

**Process improvement that would have caught all three layers:** Pester unit tests for the script (#434). All 3 fixes have validated test inputs already documented in the issue; converting them to a Pester suite is mechanical.

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
