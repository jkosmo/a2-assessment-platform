# CLAUDE.md — Critical context for AI agents

> **Maintained in sync with `AGENTS.md`** (which Codex reads). Any change to the invariants,
> tenant-split table, deploy discipline, or QA checklist sections MUST be applied to both
> files in the same commit. CLAUDE.md additionally covers orchestration, AI delegation flow,
> and Claude-specific guidance not relevant to other agents.

## ⚠️ CRITICAL: PRODUCTION AND STAGING USE DIFFERENT AZURE TENANTS

**THIS IS THE SINGLE MOST IMPORTANT THING TO KNOW BEFORE RUNNING ANY `az` CLI COMMANDS.**

| Environment | Azure Tenant ID | Subscription | Subscription Name |
|-------------|-----------------|--------------|-------------------|
| **staging** | `c6e381fa-eb4b-42ba-b358-fe83e1166c40` | `df46af7a-1806-4bda-a24b-0b3c112bd261` | Betale for forbruk |
| **production** | `a018856e-8cf2-4ec4-bbc8-ab18058027dc` | `5b3f760b-42d4-4d78-812c-c059278d1086` | Pay-As-You-Go (A-2) |

### WHY THIS MATTERS

The local Azure CLI defaults to the **staging tenant** (`c6e381fa-...`). If you run `az` commands to inspect production resources without switching subscription first, YOU WILL QUERY THE WRONG TENANT AND GET EMPTY OR MISLEADING RESULTS. This has caused multiple incidents where deployment hangs were misdiagnosed.

### MANDATORY PATTERN FOR PRODUCTION AZ COMMANDS

```powershell
# Always switch to production subscription before querying production resources
az account set --subscription 5b3f760b-42d4-4d78-812c-c059278d1086

# ... run az commands ...

# Switch back to staging when done
az account set --subscription df46af7a-1806-4bda-a24b-0b3c112bd261
```

### HOW TO VERIFY WHICH TENANT YOU ARE ON

```bash
az account show --query "{subscription:id,tenantId:tenantId,name:name}" -o table
```

- Tenant `c6e381fa-...` = staging
- Tenant `a018856e-...` = production

### ENTRA vs AZURE TENANT

`ENTRA_TENANT_ID` in GitHub environment variables is the **application authentication tenant** (for SSO login). The **Azure deployment tenant** is controlled by the `AZURE_TENANT_ID` **secret** in each GitHub environment. These happen to be the same values per environment, but they serve different purposes.

### ⛔ NEVER RUN THE DEPLOY SCRIPT LOCALLY ON WINDOWS

`scripts/azure/deploy-environment.ps1` **must only run on Linux** (i.e. GitHub Actions).

**Why:** On Windows the script falls back to .NET `ZipArchive` to build the deployment package. The resulting zip is not mountable by Azure App Service's Run-From-Package mechanism. The container starts, but `/home/site/wwwroot` contains only `hostingstart.html` — every request returns "Application Error". The root cause is invisible in GitHub Actions logs because the deploy step itself reports success.

**Symptom:** App shows "Application Error"; Kudu `ls /home/site/wwwroot/` returns only `hostingstart.html`; `/home/data/SitePackages/packagename.txt` points to the broken zip.

**Fix:** Trigger deployment via `gh workflow run deploy-azure.yml --ref main -f deploy_production=true`. Never run the deploy script from a Windows shell, even for a "quick fix".

The script now throws immediately if `$IsLinux` and `$IsMacOS` are both false.

### ACS EMAIL PROVISIONING IS SLOW

Both staging and production have `PARTICIPANT_NOTIFICATION_CHANNEL=acs_email`. The `Microsoft.Communication/emailServices/domains` resource takes **20–40 minutes to provision** on first creation or recreation. This is NORMAL. Do not cancel deploys just because they run 30+ minutes — check the ARM deployment operations first:

```bash
az account set --subscription 5b3f760b-42d4-4d78-812c-c059278d1086  # production
az deployment operation group list \
  --resource-group rg-a2-assessment-production \
  --name <deployment-name> \
  --query "[?properties.provisioningState!='Succeeded'].{resource:properties.targetResource.resourceType,state:properties.provisioningState}" \
  -o table
```

---

## Project overview

A2 Assessment Platform — Next.js + Prisma + PostgreSQL on Azure App Service.

- Infrastructure: `infra/azure/main.bicep`
- Deploy script: `scripts/azure/deploy-environment.ps1`
- CI/CD: `.github/workflows/deploy-azure.yml`
- Environments runbook: `doc/AZURE_ENVIRONMENTS.md`

## Workflow conventions

- Always bump `package.json` version and `doc/VERSIONS.md` in the same commit as code changes.
- Create GitHub issue → specify/plan → implement → test → document, in that order.
- Deploy cadence: staging and production both require manual `workflow_dispatch`. Push to `main` does NOT auto-deploy.

### Documentation is a MANDATORY step — not optional (standing order)

A feature is **not "done" until its documentation is updated**. Any change that adds or alters
user-facing behavior or API/route surface MUST, within the same feature arc, update **both**:

1. **Technical docs** — `doc/API_REFERENCE.md` (new/changed endpoints), `doc/route-map.md`
   (new pages/routes), and a short architecture note when a new data model or invariant is added.
2. **User / author docs** — how a SMO/author uses the feature, and what the participant sees;
   new user-facing capabilities get a guide (or a section in one) under `doc/`.

If docs cannot land in the same PR, open tracking doc issues (technical + user) in the **same
milestone** as the feature before it is considered complete. The "document" step must never
lapse silently — it is part of the definition of done.

### Tests are written WITH the feature, and run locally BEFORE deploy (standing order)

Retroactive tests are only regression guards — they do not prevent the first occurrence of a
bug. To actually shrink the deploy→manual-test→fix loop, the test must exist **when the feature
is built**, and must be runnable **without a staging deploy**:

1. **User-facing change ⇒ a browser e2e of the primary flow ships in the same PR.** Server/logic
   gets unit/integration tests as usual; anything in the **client layer** (i18n key resolution,
   `fetch`/header behavior incl. multipart, CSP, `<img>`/auth, rendering, CSS/layout) MUST be
   exercised by a Playwright e2e (`test/e2e/`) written alongside the feature — not afterwards.
   The class of bugs that cost us 3–4 manual rounds (FormData sent as JSON → 500, raw i18n keys,
   `<img>` 401, CSP `blob:`) all live in this layer and are invisible to supertest.
2. **Run the real client→server flow locally before deploying.** A staging deploy is an
   acceptance gate, not a debugging tool. Use `npm run dev` (local Postgres + `AUTH_MODE=mock`)
   to exercise the actual browser flow in seconds; deploy only once it passes locally.
3. A user-facing feature is **not "done"** until its e2e passes locally + in CI. Writing the test
   first (or at least alongside) forces you to run the real path early, which is where these
   integration bugs surface.

### Map the full UI surface before building/fixing (standing order)

Established 2026-06-21 after a retrospective: a wave of authoring/MCQ-only work produced **6 bugs
across 5 deploys (v1.3.37→1.3.42)**, almost all of the form *"correct fix, incomplete surface"* —
the fix landed in the one code path in the screenshot, while sibling paths produced the next bug.

1. **Enumerate every entry point and every surface before coding.** A behaviour usually appears in
   more than one place. Module creation has **two** entries (the library "create module" dialog
   `#348` → conversation regen, AND the conversation idle "new module"); a course certificate shows
   in **three** places (result banner, `/participant/completed`, `/profile`). `grep` the feature
   name / i18n label across **all** pages first, list the paths, and fix them in the same PR.
2. **E2e must follow the documented/recommended user journey — not the code path you happened to
   build.** A green e2e that exercises the convenient path gives false confidence when users take a
   different one. (We shipped a module-type step into a flow users don't use; the e2e passed.)
3. **For "move/reorder a step" changes, grep where else that sequence occurs** before editing
   (scenario/source ordering lived in new-module + regen + external-LLM handoff — only one was
   fixed at first).
4. **Conditional visibility: use `setHidden(el, on)` (`public/static/dom-visibility.js`), never the
   `.hidden` class or `[hidden]` attribute on an element that has a `display`-setting class**
   (`.row`/`.inline`/`.card`/`.content-card`/`.module-brief`/`.summary-grid`…). `.hidden` is
   `display:none` without `!important` and loses the cascade to those class rules, so the element
   never hides. This is a **recurring** trap — assume any `.row`/`.card`/grid element needs
   `setHidden` / inline `style.display`, and assert it actually hides in the e2e.

### Which deploy workflow to use

| Type of change | Use workflow | Why |
|----------------|--------------|-----|
| Code-only (no `infra/`, no Bicep, no workflow YAML) | `.github/workflows/deploy-app.yml` | ~6 min faster (~16 min vs ~22 min) — skips ARM, KV-ref wait, explicit restart |
| Anything touching `infra/azure/*.bicep` | `.github/workflows/deploy-azure.yml` | Full deploy — applies Bicep changes |
| Changes to `.github/workflows/*.yml` | `.github/workflows/deploy-azure.yml` | Workflow changes only take effect on next deploy from main; use full deploy to be safe |
| Changes to `scripts/azure/deploy-environment.ps1` | Either | Both workflows use the same script; the change auto-picks via main |
| Secret rotation requiring KV-ref refresh | `.github/workflows/deploy-azure.yml` | KV-ref propagation + container restart needed |

### Pre-merge Bicep what-if (production)

Before merging a PR that touches `infra/azure/*.bicep` or `scripts/azure/deploy-environment.ps1`, run a production what-if to see the ARM diff:

```bash
gh workflow run bicep-whatif-prod.yml -f pr_number=<PR_NUMBER>
```

The diff is posted as a PR comment. Staging what-if runs automatically on PR; prod what-if is manual because the production GitHub environment has approval gates that would block PR-time auto-runs (#419).

## AI delegation workflow (Claude orchestrates, Codex/Gemini drafts)

Use `scripts/ai-draft.ps1` to delegate implementation to Codex or Gemini, then Claude QAs.

### When to delegate

| Task size | Action |
|-----------|--------|
| < ~50 lines, single file | Claude handles directly |
| 50–300 lines, well-specified | Delegate with `Tier=medium` |
| Large feature / multi-file | Delegate with `Tier=complex` |
| Security-critical, auth, infra | Delegate with `Tier=security` (but raise scrutiny in QA) |

### Model selection matrix

| Tier | Codex model | Codex effort | Gemini model |
|------|-------------|--------------|--------------|
| simple | o4-mini | low | gemini-2.5-flash |
| medium | o4-mini | high | gemini-2.5-flash |
| complex | o3 | medium | gemini-2.5-pro |
| security | o3 | xhigh | gemini-2.5-pro |

**Agent auto-selection:** Codex for simple/medium (precise file edits, sandbox protection).
Gemini for complex/security (larger context window helps with multi-file analysis).

### Mandatory QA checklist after delegation

After `ai-draft.ps1` finishes, Claude MUST:

1. `git diff HEAD` — read the full diff, verify logic and intent
2. `npx tsc --noEmit` — must be zero errors before proceeding
3. `npx vitest run test/unit/` — no new failures allowed
4. Check specifically for: fabricated constants/hashes, broken YAML in workflows, missing required config flags (e.g. `enableRbacAuthorization`), enum values that don't exist in schema
5. Verify `package.json` and `doc/VERSIONS.md` were bumped

Only after QA passes: commit, push, trigger CI/CD.

### Additional QA for infra changes (Bicep / PowerShell / GitHub Actions)

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

---

## ⛔ Infra hard invariants — NEVER violate

These rules exist because their violation caused or worsened the May 2026 production incident.

1. **Never** change `enableRbacAuthorization` based on `skipRoleAssignments` or any deploy flag. Key Vault must always use RBAC authorization.
2. **Never** make production deployability depend on deleting or recreating managed identities.
3. **Never** update a credential secret (e.g. `DATABASE-URL`) unless the underlying resource (e.g. PostgreSQL server) is updated with the same credential in the same deploy — or the existing credential is explicitly read and reused.
4. **Never** make a Bicep resource conditional (`= if (condition)`) without adding `dependsOn: [conditionalResource]` to all child resources that previously used it as `parent:`.
5. **Never** switch a child resource's `parent:` from a deployed resource to an `existing` reference without verifying ARM ordering is preserved via `dependsOn`.
6. **Never** suppress `az role assignment` failures in production.
7. **Never** treat successful ARM validation or a green deploy step as proof of runtime correctness — always verify `/healthz` and smoke test.
8. **Never** run prod-destructive scripts without first asserting the correct subscription (`az account show`) and resource group.
9. **Always** include rollback notes for infra changes in the PR description.
10. **Always** verify staging `/healthz` is healthy before triggering a production deploy.
11. **Always** propose `az deployment group what-if` output for staging (and prod) before implementing non-trivial Bicep changes. ARM what-if is the only check that catches schema drift before deploy.
12. **Always** apply credential changes atomically: a KV secret and the underlying resource (PostgreSQL server, Storage account, etc.) must be updated in the same deploy, or one must explicitly re-read the existing value. Drift between KV and the underlying resource is silent until the next app restart.

---

## Deploy discipline — established 2026-05-17

These rules exist because their violation cost ~2 hours of misdiagnosis on 2026-05-17, when chaining workflow YAML fixes (v1.1.39 → v1.1.40) and root-cause hypotheses (env.ts → Prisma locks → container timeout) burned five deploy cycles before landing on the real fix.

See `doc/DEPLOY_OPTIMIZATION.md` for the full incident narrative and wave-based rollout plan.

### Process rules

1. **Max one structural change per deploy.** Either one Bicep variable, OR one workflow YAML change — never both. Bundling creates ambiguity when the deploy fails: you can't tell which change caused the failure.
2. **CI-only fixes before prod fixes.** If a fix can be validated in CI (e.g. `actionlint`, type check, unit tests), ship it BEFORE any deploy that depends on the workflow being correct. Saves whole 45-min deploy cycles.
3. **One released version per confirmed fix, not per attempt.** Don't bump `package.json` version for every failed-attempt commit. Wait for the fix to be confirmed correct, then bump. Failed attempts can be additional commits on the same in-progress version.
4. **Never push Bicep or workflow changes that another commit could be bundled with.** Push-to-main does not auto-deploy, but the next manual deploy will include all pending main commits. Coordinate timing or stage the change in a branch until ready.

### Diagnostic rules

5. **When a deploy hangs, read the platform log first.** `LogFiles/*_docker.log` (Azure's view of the container lifecycle: pulls, mounts, probes, terminations) BEFORE `LogFiles/*_default_docker.log` (app stdout/stderr). The platform log tells you what Azure thinks happened; the app log only shows what the app got to say before being killed.
6. **Verify lock/concurrency hypotheses with `pg_stat_activity` before acting.** Restarting workers "to break a lock" creates noise and may hide the real problem. Querying `pg_stat_activity` and `pg_locks` takes 30 seconds and either confirms or refutes the hypothesis.
7. **Use `Monitor` (read-only) for deploy observation, not `Agent`.** Agent subprocesses can have side effects (e.g. triggering follow-up deploys). Monitor only watches. Agent-based monitoring caused 3 spurious workflow runs on 2026-05-17 because agents kept firing `gh workflow run` after they were stopped.
8. **Occam's razor before exotic hypotheses.** If the same failure happens in two different tenants in two different regions, it is almost certainly in our code or config — not in Azure. Verify shared variables (env vars, app settings, Bicep) before blaming external systems.
