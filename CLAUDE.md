# CLAUDE.md — Critical context for AI agents

> **Maintained in sync with `AGENTS.md`** (which Codex reads). Any change to the invariants,
> tenant-split table, deploy discipline, or QA checklist sections MUST be applied to both
> files in the same commit. CLAUDE.md additionally covers orchestration, AI delegation flow,
> and Claude-specific guidance not relevant to other agents.

## ⚠️ CRITICAL: PRODUCTION AND STAGING USE DIFFERENT AZURE TENANTS

**THIS IS THE SINGLE MOST IMPORTANT THING TO KNOW BEFORE RUNNING ANY `az` CLI COMMANDS.**

| Environment | Azure Tenant ID | Subscription |
|-------------|-----------------|--------------|
| **staging** | `<STAGING_TENANT_ID>` | `<STAGING_SUBSCRIPTION_ID>` |
| **production** | `<PROD_TENANT_ID>` | `<PROD_SUBSCRIPTION_ID>` |

> ⚠️ **The concrete values are NOT in this repository.** It is public (GPL-3), and tenant +
> subscription + resource-group names + production hostnames + the operator account together
> describe the target precisely enough to make a phishing message read like it came from inside.
> No single one of them is a credential; the aggregate is the risk.
>
> Maintainers: the filled-in table is in `doc/ENVIRONMENTS.local.md` (gitignored). Everyone else:
> copy `doc/ENVIRONMENTS.example.md` and fill in your own.
>
> `test/environment-identifier-guard.test.js` fails the build if a real identifier reappears in a
> tracked file.

### WHY THIS MATTERS

The local Azure CLI defaults to the **staging tenant**. If you run `az` commands to inspect production resources without switching subscription first, YOU WILL QUERY THE WRONG TENANT AND GET EMPTY OR MISLEADING RESULTS. This has caused multiple incidents where deployment hangs were misdiagnosed.

### MANDATORY PATTERN FOR PRODUCTION AZ COMMANDS

```powershell
# Always switch to production subscription before querying production resources
az account set --subscription <PROD_SUBSCRIPTION_ID>

# ... run az commands ...

# Switch back to staging when done
az account set --subscription <STAGING_SUBSCRIPTION_ID>
```

### HOW TO VERIFY WHICH TENANT YOU ARE ON

```bash
az account show --query "{subscription:id,tenantId:tenantId,name:name}" -o table
```

Compare the output against the table in `doc/ENVIRONMENTS.local.md`.

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
az account set --subscription <PROD_SUBSCRIPTION_ID>  # production
az deployment operation group list \
  --resource-group <PROD_RESOURCE_GROUP> \
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

## Beslutninger som ikke kan leses ut av koden

`doc/DECISIONS.md` — regler der et annet valg ville vært like forsvarlig, og som derfor ikke kan
utledes fra implementasjonen. Skriv beslutningen dit **når den tas**, ikke etterpå.

Dette er en peker, ikke en ny regel: #938 tok en hel kveld fordi ingen kunne si hva regelen var
*ment* å være, og da måtte diskusjonen starte med å rekonstruere hensikten fra koden.

## Kompleksitetsskanning — MÅNEDLIG (standing order, 2026-08-21)

`doc/COMPLEXITY_SCAN.md` — seks agenter, seks områder, seks mønstre. Måler om kodebasen samler opp
slitasje: divergerende definisjoner, ueid policy, lag på lag, unåbare vakter, servertekst vist rått,
og løfter som ikke holdes.

Verdien er **trenden**, ikke funnene alene: gikk «hvor mange steder svarer på dette spørsmålet» opp
eller ned siden sist? Nullpunktet fra første kjøring (2026-08-21) står i fila.

⚠️ **Datoen for sist kjørt bor KUN i `doc/COMPLEXITY_SCAN.md`.** Ikke gjenta den her — to kopier av
samme faktum som må oppdateres i takt er nøyaktig feilklassen skanningen leter etter.
`scripts/ai-qa.ps1` leser datoen og sier fra når skanningen forfaller. Den blokkerer ikke.

Etter en kjøring: verifiser de tyngste funnene for hånd (agentene leser koden, de kjører den ikke),
skill defekt fra beslutning — beslutninger hører i `doc/DECISIONS.md` — og **oppdater datoen og
loggen**. Det siste er resetten; uten den finnes ingen trend.

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

### Test- og releasemetodikk — les den før du planlegger en runde (standing order, 2026-08-19)

`doc/TEST_AND_RELEASE_PLAYBOOK.md` fanger arbeidsmåten fra release 2.22.x, med **hva hver teknikk
faktisk fanget** som begrunnelse. Den erstatter ikke ordrene under; den forklarer hvordan de
utføres uten å gjenoppdage det hver gang.

De fire som sparer mest tid:

1. **Mutasjonsverifisering.** Reverser fiksen, se testen bli rød, sjekk at den ble rød på riktig
   assertion. En test som er grønn både med og uten fiksen er verre enn ingen test.
2. **Kontrollcase.** En test som bekrefter at noe blokkeres trenger en makker som bekrefter at det
   riktige slipper gjennom — ellers vet du ikke om du målte regelen din eller en annen.
3. **Dekningsvakt slår hardkodet liste.** En liste over «alle stedene som må gjøre X» kan ikke
   oppdage stedet ingen tenkte på. La testen finne kallerne; unntak skal være eksplisitte.
4. **Tre testlag svarer på tre forskjellige spørsmål** — mocket e2e (gjør klienten riktig?),
   `npm run test:stage` (er artefaktet det vi tror?), og autentisert mot reelle data (hva finnes
   der faktisk?). **En mocket e2e kan aldri fange at mocken er feil** — manuell test hører hjemme
   nøyaktig der.

### Parallelle agenter: ikke på tilgrensende flater (standing order, 2026-08-23)

Fire agenter jobbet parallelt på #941-epicen 2026-08-23, hver i egen worktree, hver med en eksplisitt
sperreliste over de andres filer. **Sperrelistene virket** — ingen kollisjon i arbeidstreet, og da én
agent trengte en linje i en sperret fil, rapporterte den nøyaktig hvilken i stedet for å gjette.

⚠️ **Det som IKKE virket var semantisk nærhet.** Agent 4 skrev i rapporten sin at
`resolveCourseAudience` hopper over ENTRA-klasser. Jeg leste det, integrerte arbeidet, og koblet
likevel ikke det til at nevneren i rapporten dermed krymper for Entra-tildelte kurs. QA-porten fant
regresjonen i neste runde.

**Regelen:** to agenter skal ikke samtidig endre **betydningen av samme begrep**, selv når de rører
ulike filer. «Hvem er med i kurset», «kan deltakeren bruke dette», «er dette bestått» — dette er
begreper, ikke filer, og en sperreliste over filer fanger dem ikke.

Praktisk:

1. **Del opp etter begrep, ikke etter mappe.** Overlapper to saker i begrep, kjør dem etter
   hverandre — også når filene er disjunkte.
2. **Maks to agenter som kjører tester samtidig.** De deler én lokal Postgres; utover to får du
   tilfeldige røde tester og bruker tiden på å avkrefte dem (#994).
3. **Flaskehalsen er gjennomgangen, ikke agentene.** Fire leveranser skal rebases, forenes,
   integrasjonstestes og gjennom QA-porten av én person. Fem agenter gir fem bunter i kø.
4. **Les agentenes «funnet, men ikke fikset»-liste som en risikoliste**, ikke som en restanse. Det
   er der neste regresjon står beskrevet før den skjer — den sto der denne gangen.

### Når QA-porten går i løkke

Finner porten funn i fiksen mot forrige runde, er det sjelden porten som tar feil. Sjekk i stedet om
endringene **endrer betydningen av et delt felt**: da må hver leser gjennomgås, og «rett utregningen
der den er» vil fortsette å feile.

Kuren som har holdt i dette repoet er #958-formen: flytt avgjørelsen til skriveren, slik at leserne
ikke *kan* avvike. Kuren som har feilet tre ganger er å rette utregningen på stedet som feilet.

Porten klassifiserer nå hvert funn — `[REGRESJON]`, `[UFULLSTENDIG]`, `[EKSISTERENDE]`,
`[DOKUMENTASJON]` — nettopp for at man skal kunne stoppe løkka rasjonelt: en regresjon stopper en
deploy, en eksisterende feil blir en sak.

### Cross-model QA gate before every stage deploy (standing order, 2026-08-13)

A stage deploy costs 16–22 min plus a manual test round. The automated suites catch what they were
written for; the recurring loss is the class they were *not* written for — "correct fix, incomplete
surface" and client-layer integration. So: **once the automated suites are green and before the
stage deploy, run a cross-model review.**

```powershell
.\scripts\ai-qa.ps1 -Issue 896                    # branch vs main
.\scripts\ai-qa.ps1 -Uncommitted -SkipTests       # working tree, suites already green this session
.\scripts\ai-qa.ps1 -IncludeE2E                   # also run the admin-content e2e first
```

The script runs `lint` + `test:unit` + `test:dom` first and **refuses to call Codex if any is red**
(reviewing broken code is wasted tokens). It then runs `codex exec review` (default `gpt-5.6-sol`,
reasoning effort `high`) with this file's standing orders as the checklist, then a short second
pass for the verdict and the manual-test list, and writes both to `.ai-qa/qa-<timestamp>.md`
(gitignored). Exit codes so a wrapper can gate on it: `0` GO · `1` could not review · `2` review
incomplete (missing verdict or manual-test list — not a pass) · `3` NO-GO.

1. **NO-GO means fix before deploying.** The whole point is to spend the round here rather than on
   stage.
2. **A GO is a review verdict, not a test result.** The e2e for the primary flow must still pass
   locally — the standing order above is unchanged, not replaced.
3. **The "Ikke verifiserbart statisk" list at the end of the review is the manual test plan** for
   that stage round. Test that list, not the whole app.
4. A finding that exposes a *systematic* gap belongs in `doc/FEATURE_SURFACE_MAP.md`, not only in
   the fix.

Gotchas: codex writes its banner to stderr, so PowerShell 5.1 may report a non-zero exit code even
on success — **the output file is the source of truth**, not `$LASTEXITCODE`. The prompt is piped on
stdin, which both avoids PS 5.1 quote mangling and closes stdin (`codex exec` hangs on an open TTY
stdin). Requires `npm install -g @openai/codex`; auth comes from the existing ChatGPT login.

### Map the full UI surface before building/fixing (standing order)

Established 2026-06-21 after a retrospective: a wave of authoring/MCQ-only work produced **6 bugs
across 5 deploys (v1.3.37→1.3.42)**, almost all of the form *"correct fix, incomplete surface"* —
the fix landed in the one code path in the screenshot, while sibling paths produced the next bug.

1. **Enumerate every entry point and every surface before coding.** A behaviour usually appears in
   more than one place. Module creation has **two** entries (the library "create module" dialog
   `#348` → conversation regen, AND the conversation idle "new module"); a course certificate shows
   in **three** places (result banner, `/participant/completed`, `/profile`). **First check
   `doc/FEATURE_SURFACE_MAP.md`** — it catalogues the known distributed behaviours with every
   surface + guard test. If the behaviour is there, change all listed surfaces in the same PR; if
   not, `grep` the feature name / i18n label across **all** pages, fix them together, and **add the
   entry to the map**.
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

### Use deploy-wait time to improve test coverage (standing order)

Established 2026-06-22. A deploy cycle is ~16–22 min of otherwise-idle waiting. **By default, while
waiting for any deploy (or other long-running background job) to finish, work on improving test
coverage** — unless the user has given a different instruction for that wait.

- Writing tests is a **safe, additive** activity: it does not change production behaviour, so it
  never destabilises an in-flight deploy or the change being verified.
- Prefer **characterization tests that pin current behaviour** on the highest-risk *untested*
  surfaces — especially the client layer (invisible to supertest), per the surface map / coverage
  baseline (`doc/design/TEST_COVERAGE_BASELINE_599.md`, EPIC #595).
- Test-only changes need **no version bump** (nothing shipped changes) and can land in their own
  small PR; they must still pass CI before merge.
- Do **not** start a refactor or behavioural change as a "wait filler" — only tests (and test-
  adjacent docs). Refactoring during a wait reintroduces the very risk this avoids.

### Which deploy workflow to use

| Type of change | Use workflow | Why |
|----------------|--------------|-----|
| Code-only (no `infra/`, no Bicep, no workflow YAML) | `.github/workflows/deploy-app.yml` | ~6 min faster (~16 min vs ~22 min) — skips ARM, KV-ref wait, explicit restart |
| Anything touching `infra/azure/*.bicep` | `.github/workflows/deploy-azure.yml` | Full deploy — applies Bicep changes |
| Changes to `.github/workflows/*.yml` | `.github/workflows/deploy-azure.yml` | Workflow changes only take effect on next deploy from main; use full deploy to be safe |
| Changes to `scripts/azure/deploy-environment.ps1` | Either | Both workflows use the same script; the change auto-picks via main |
| Secret rotation requiring KV-ref refresh | `.github/workflows/deploy-azure.yml` | KV-ref propagation + container restart needed |

### Promoting a verified version to prod while `main` advances

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

### Pre-merge Bicep what-if (production)

Before merging a PR that touches `infra/azure/*.bicep` or `scripts/azure/deploy-environment.ps1`, run a production what-if to see the ARM diff:

```bash
gh workflow run bicep-whatif-prod.yml -f pr_number=<PR_NUMBER>
```

The diff is posted as a PR comment. Staging what-if runs automatically on PR; prod what-if is manual because the production GitHub environment has approval gates that would block PR-time auto-runs (#419).

## Agent skills (repo-canonical)

Repo-canonical agent skills live under `skills/`; Claude Code discovers them via thin
pointers in `.claude/skills/`. The `skills/` copy is the source of truth — edit there only.

- **`skills/a2-authoring-api/`** — build draft courses/modules/sections from conversation
  context via the Agent Authoring API (EPIC #647). Validate-first, draft-only, returns
  admin-UI links; NEVER calls publish endpoints. Distributable zip:
  `npm run skill:package` → `dist/skills/a2-authoring-api-v<version>.zip`.

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
13. **Always** keep DB migrations expand/contract-safe (#811) — see Deploy discipline → Process rule 5. Both web and worker run `prisma migrate deploy` on startup, so old containers run against the new schema and new code runs briefly against the old schema during a rollout. Additive within a deploy; drop/rename in a follow-up; never both on the same object in one deploy.

---

## Deploy discipline — established 2026-05-17

These rules exist because their violation cost ~2 hours of misdiagnosis on 2026-05-17, when chaining workflow YAML fixes (v1.1.39 → v1.1.40) and root-cause hypotheses (env.ts → Prisma locks → container timeout) burned five deploy cycles before landing on the real fix.

See `doc/DEPLOY_OPTIMIZATION.md` for the full incident narrative and wave-based rollout plan.

### Process rules

1. **Max one structural change per deploy.** Either one Bicep variable, OR one workflow YAML change — never both. Bundling creates ambiguity when the deploy fails: you can't tell which change caused the failure.
2. **CI-only fixes before prod fixes.** If a fix can be validated in CI (e.g. `actionlint`, type check, unit tests), ship it BEFORE any deploy that depends on the workflow being correct. Saves whole 45-min deploy cycles.
3. **One released version per confirmed fix, not per attempt.** Don't bump `package.json` version for every failed-attempt commit. Wait for the fix to be confirmed correct, then bump. Failed attempts can be additional commits on the same in-progress version.
4. **Never push Bicep or workflow changes that another commit could be bundled with.** Push-to-main does not auto-deploy, but the next manual deploy will include all pending main commits. Coordinate timing or stage the change in a branch until ready.
5. **Migrations MUST be expand/contract-safe (#811).** Both web AND worker now run `prisma migrate deploy` on startup (`SKIP_MIGRATE=false` on both; Prisma advisory-locks concurrent deploys). But during a rollout, OLD containers still run against the NEW schema, and new code runs briefly against the OLD schema before its own migrate finishes. So: **expand within a deploy** (additive only — add columns/tables/indexes), and **contract in a follow-up deploy** (drop/rename only after all code using the object is gone). Never combine an additive and a destructive change to the same object in one deploy — a destructive migration bundled with code that still reads the dropped object breaks old containers mid-rollout (the 2026-05-21 incident class). See `doc/OPERATIONS_RUNBOOK.md` → "Migrations and Schema Changes".

### Diagnostic rules

5. **When a deploy hangs, read the platform log first.** `LogFiles/*_docker.log` (Azure's view of the container lifecycle: pulls, mounts, probes, terminations) BEFORE `LogFiles/*_default_docker.log` (app stdout/stderr). The platform log tells you what Azure thinks happened; the app log only shows what the app got to say before being killed.
6. **Verify lock/concurrency hypotheses with `pg_stat_activity` before acting.** Restarting workers "to break a lock" creates noise and may hide the real problem. Querying `pg_stat_activity` and `pg_locks` takes 30 seconds and either confirms or refutes the hypothesis.
7. **Use `Monitor` (read-only) for deploy observation, not `Agent`.** Agent subprocesses can have side effects (e.g. triggering follow-up deploys). Monitor only watches. Agent-based monitoring caused 3 spurious workflow runs on 2026-05-17 because agents kept firing `gh workflow run` after they were stopped.
8. **Occam's razor before exotic hypotheses.** If the same failure happens in two different tenants in two different regions, it is almost certainly in our code or config — not in Azure. Verify shared variables (env vars, app settings, Bicep) before blaming external systems.
