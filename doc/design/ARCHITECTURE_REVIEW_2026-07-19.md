# Architecture Review — a2-assessment-platform (2026-07-19)

**Status:** draft for owner review. Cross-model review by Claude (Opus 4.8) + Codex 5.6.
No code was changed. This is a decision-grounding document, not a set of applied fixes.

## Method

Two independent reviews were run over the same ~100k-line codebase (36 Prisma models), then merged:

- **Claude** — a 33-agent fan-out: 6 Sonnet subsystem mappers (data, modules, api-auth, workers,
  client, infra) surfaced 54 candidate findings; the top 8 by severity were deep-dived by Opus 4.8;
  each resulting finding was **adversarially verified** (a separate agent tried to refute it against
  the code). 18 findings survived. Cost ~1.6M tokens.
- **Codex 5.6** — 3 independent read-only passes (security/access, data-model/scaling, workers/
  robustness), high reasoning, blind to Claude's findings. 29 findings with file:line evidence.

The two had **partially different scopes** (Codex covered security/data/workers deeply; Claude
covered all four dimensions incl. client + structural-debt). So convergence is strongest where they
overlapped, and each covered the other's blind spots. That asymmetry is itself useful — see
"Confidence tiers".

## Confidence tiers (read this first)

- **Cross-confirmed** — both models independently reached it. Highest confidence; treat as real.
- **Claude-verified** — survived Claude's adversarial refutation pass. High confidence.
- **Codex-reported** — single-model, evidence-cited, high-reasoning, but not independently
  re-verified. Medium-high; verify before large investment. (The deferred "Phase 4" — each model
  reviewing the other's report — would lift these; we stopped before it per plan.)

---

## Phase 4 — cross-model review outcome (each model audited the other)

Two directions were run after the initial report. Net: the findings hold up strongly, several
severities came **down**, one was **refuted**, and the two models **disagree on prioritization** — which
is itself the most useful output.

### 4b — Claude adversarially verified Codex's 15 unique findings
**13 CONFIRMED · 1 REFUTED · 1 PLAUSIBLE.**
- **Refuted:** *agent tokens can corrupt another author's course* — the framing assumes per-course
  ownership that **intentionally does not exist** (Course has no owner by design; modules do enforce
  ownership — the asymmetry is deliberate). Not a separate bug; it collapses into the SMO-ownership gap.
- **Plausible (not exploitable now):** *certification `status` free-text typo passes* — structurally
  true (`status String`, queried `!= "NOT_CERTIFIED"`), but the sole write path is TypeScript-union-typed,
  so a typo is a compile error, not runtime data. Latent (raw SQL / future untyped writer), low priority.
- **Severity corrections (Codex over-rated HIGH → medium):** restricted-course bypass, body-before-auth,
  asset IDOR, and SMO-scope are all real but medium — IDs are non-enumerable cuids, and SMO is
  horizontal privilege among already-trusted staff, not a participant-reachable escalation.

### 4a — Codex critiqued Claude's report
Agreed with the core; corrected several points:
- **XSS (#7) materially understated the defense** — a strict server-set `script-src 'self'` CSP with no
  inline scripts already exists (`securityHeaders.ts`), so 149 `innerHTML` sites are **not** 149 XSS
  surfaces. Real residual: a few raw-HTML UGC sinks + **markup/UI injection** via API-error strings
  interpolated into `innerHTML` (CSP blocks script, not markup). **→ #7 downgraded** below.
- **Concurrency fix (#2) was partly wrong** — appeal/manual-review already commit decision+status+audit
  in a transaction; adding one does nothing. The real fix is the **guarded state transition before**
  appending the decision + a **fencing token** on assessment; partial-unique indexes need **explicit SQL
  migrations** (Prisma can't model them).
- **Deploy topology (#1) is env-dependent** — the B1 SKU is supplied by CI, not code; app-only deploys
  skip the second restart. Real and verified structurally, but the precise "5–16 min" is operational,
  not code-guaranteed.
- **Things Claude missed (Codex-added):** (a) **Audit is not tamper-evident** — `payloadHash` excludes
  actor/timestamp, isn't chained or verified, and course-metadata updates emit no audit event at all;
  Claude wrongly listed the audit trail as "healthy". (b) **Interactive** endpoints repeat the unbounded
  fan-out (participant course list = 4 queries/course; admin list = 1/course) — can exhaust the
  10-connection pool with no scheduled job. (c) **Duplicated ~5k-line authoring controllers**
  (conversation vs advanced) — real drift risk, beyond "many HTML sinks".

### Reconciled priority (both models)
1. **Authorization & ownership gaps** (restricted-course bypass, asset IDOR, SMO un-scoped, PII-in-audit)
   — *current* confidentiality/integrity failures. Codex ranks these #1; Claude had them #5. **Promoted.**
2. **DB-enforced finalization + fencing + durable side-effects** (concurrency races + notification outbox)
   — with the corrected fix (guarded transition + fencing + SQL partial-unique, not "add a transaction").
3. **Audit integrity + bound DB fan-out** (tamper-evidence gap + interactive & scheduled unbounded scans).
4. **Deploy continuity** (slots, not `capacity>=2` — zip deploy + `az restart` recycle all instances).

Defense-in-depth items (client sanitizer scoped to raw-HTML sinks; shared rate-limit store) and the
structural cycle follow. `trust proxy` is **already fixed** (PR #775, in HEAD).

---

## Executive summary

The platform is **fundamentally well-structured**: clean per-domain repository/service layering,
immutable versioned content, an explicit capability→role map as the single source of truth for
authorization, a real compliance audit trail, SRI-pinned MSAL, mature auth resolver, strong SSRF
controls. Most teams this size do not have these. Both reviewers independently said so.

The health problem is **not the shape of the code** — it is a consistent pattern of **correctness and
cost invariants enforced by convention (JavaScript) rather than by the database or the platform**, and
that pattern breaks under exactly the conditions success brings: more concurrency, more data, more
deploys. Four systemic themes, each found by both models:

1. **Concurrency safety lives in JS, not the DB.** Claim/resolve/override paths (appeals, manual
   review) and assessment/MCQ finalization are read-then-write with no compare-and-swap and no
   partial-unique constraints — so two near-simultaneous actors both pass the guard and the second
   silently wins, producing **duplicate immutable decisions that corrupt the certification lineage**,
   duplicate LLM spend, and duplicate emails. The correct idiom (`tryLockPendingJob` guarded
   `updateMany`) already exists in-repo; it just is not applied uniformly.
2. **Unindexed full-table scans on unbounded tables.** Every daily reminder/retention scan and the
   participant-facing audit lookup loads whole tables into the Node heap and filters in memory, with
   N+1 per-row fan-out against a 10-connection pool. `AuditEvent` grows forever; the audit lookup is a
   **self-service DoS** reachable by any participant. Runs fine today, degrades linearly-to-unbounded.
3. **Non-atomic multi-writes / non-transactional audit.** Content import explicitly leaves partial
   state; audit writes commit separately from the domain change they record — undermining the exact
   integrity guarantee the system sells.
4. **Single-layer defenses where the threat model wants two** (security, below).

The single **HIGH** operational risk (Claude) is deploy topology; the largest **security/GDPR** class
(Codex) is access-control + PII-in-audit. Neither is "on fire" today — that is the trap.

---

## Cross-confirmed themes (highest confidence — both models, independently)

| Theme | Claude framing | Codex framing |
|---|---|---|
| **Concurrency: no DB-level CAS** | Appeal claim/resolve + manual-review claim/override races → duplicate decisions (verified) | Assessment lease not fenced; enqueue check-then-create; MCQ finalization non-atomic (workers #1/#8, data #1/#2) |
| **Audit growth / unindexed scans** | Participant audit LIKE-scan self-service DoS; reminder/retention full scans; N+1 (verified) | Audit `metadataJson` LIKE unindexable; retention unbatched delete; missing hot-table indexes (data #5/#6) |
| **Audit not transactional w/ domain write** | Structural: audit can diverge from reality under partial failure | Decisions/cert commit before completion audit (data #1) |
| **Import / multi-write partial state** | Structural debt: contracts by convention | Content import leaves half-imported DB+blob state (data #10) |

Where both models point at the same thing from different modules, it is a **systemic pattern**, not a
local bug — fix the pattern, not just the cited line.

---

## Top risks (merged, ranked)

### 1. [HIGH · strategic · Claude-verified] Every deploy takes the platform down 5–16 min
Single-instance **B1** App Service plan (`capacity:1`), all three apps on it, **no deployment slots,
no second instance**. Web is restarted in-place (5–8 min cold start); a full deploy restarts it twice
for KV refresh (~10–16 min). For an **exam platform, candidates mid-assessment get errors on every
deploy**. Shared plan also means a heavy parser/worker job can starve the web app with no deploy running.
`infra/azure/main.bicep:376-394`, `scripts/azure/deploy-environment.ps1:811-825`.
→ Move web to a slot-capable tier (S1/PremiumV3), warm-up-then-swap gated on `/healthz`; do KV refresh
against the staging slot; split parser/worker onto their own plan. Interim: `capacity>=2`.

### 2. [HIGH → systemic · moderate · Cross-confirmed] Read-then-write races corrupt decision lineage
Appeals + manual review (Claude, verified) **and** assessment jobs + MCQ finalization (Codex): all
read state, check a guard in JS, then unconditional update-by-id, with no partial-unique constraint on
active jobs/attempts. Under concurrency → **two immutable APPEAL_RESOLUTION/override decisions**, two
COMPLETED transitions, two emails; or two assessment jobs → duplicate LLM spend + decisions.
→ Guarded `updateMany` encoding preconditions in the WHERE (treat `count===0` as lost race → existing
`ConflictError`); wrap decision-write + status-flip in one transaction; add partial-unique indexes on
active `AssessmentJob(submissionId)` and open `MCQAttempt`. Apply the in-repo idiom uniformly. Add a
two-actor concurrency test.

### 3. [HIGH → data · moderate · Cross-confirmed] Unindexed audit lookup = self-service DoS on an unbounded table
`findSubmissionAuditEvents` matches a `metadataJson` substring via **LIKE (unindexable), no `take`**,
on `AuditEvent` which is retained forever and grows every view. At 5–20M rows each participant-reachable
`GET /audit/submissions/:id` is a multi-second seq scan holding a pool connection → a scripted refresh
from a few users saturates the 10-connection pool. `src/repositories/auditRepository.ts:25-51`.
→ Denormalize `submissionId` to a column, `@@index([submissionId, timestamp])`, indexed equality;
add `take`+pagination+rate-limit; revisit "retain indefinitely" for `submission_viewed`.

### 4. [HIGH → data · moderate · Cross-confirmed] Scheduled scans full-table + N+1, missing indexes
Recert/enrollment/class reminder scans and audit-retention delete: full seq scan, no date-window, no
covering index, discard >99% in memory, then N+1 per-row lookups; retention deletes unbatched in one
transaction (long locks, WAL bloat, blocks autovacuum). Codex adds specific missing indexes on
`MCQAttempt/MCQResponse/LLMEvaluation/CourseCompletion/CertificationStatus`.
→ Push date filters into SQL; add covering + hot-table indexes; day-match before per-row DB calls, then
batch survivors; bounded-batch deletes.

### 5. [MEDIUM · security · Codex-reported] Access-control gaps (Codex-unique — Claude's security pass was diluted across subsystems)
- **Restricted-course auth bypass**: course detail/section/read endpoints check only `published`, not
  enrollment → any authenticated participant with a course ID reads restricted section content
  (`src/routes/courses.ts:210/327/359`; the discussion path already has the right guard).
- **SMO is a de-facto global admin**: no ownership on courses/sections/classes → one compromised
  departmental author = org-wide participant enumeration + destructive edits to others' live content
  (`capabilities.ts:100`, `adminUsers.ts:8`).
- **Content-asset IDOR**; **agent token can modify any unpublished course** (no issuer binding).
→ Add `createdById`/org-scope + enforce in queries; centralize a `loadAccessibleCourse()` guard.

### 6. [MEDIUM · security/GDPR · Codex-reported] Pseudonymization leaves email in audit metadata
Pseudonymization scrubs only the `User` row; recert events persist original email in
`AuditEvent.metadataJson` (retained indefinitely) and logs → after a user is "pseudonymized" their
email is still directly searchable, contradicting the un-linkability claim.
`recertificationService.ts:189/238`, `auditRetentionService.ts:7`.
→ Never write email/name into durable audit metadata; use `userId`, resolve at read time; scrub legacy.

### 7. [LOW–MEDIUM · security · downgraded in Phase 4] Client trusts server sanitization, thin defense-in-depth
~149 `innerHTML` sites inject server-sanitized HTML (incl. shared UGC). **Phase-4 correction:** a strict
server-set `script-src 'self'` CSP with no inline scripts **already exists** (`securityHeaders.ts`), so
these are **not** 149 stored-XSS surfaces — CSP blocks script execution. Real residual is narrower:
a few raw-HTML UGC sinks, and **markup/UI injection** (not script) via API-error strings interpolated
into `innerHTML` (`admin-platform.js`, `profile.js`, `api-client.js`).
→ Scope a client sanitizer to the *few* raw-HTML sinks with a policy identical to the server's (a blanket
default DOMPurify would strip the currently-allowed section iframes/assets); stop interpolating raw error
strings into markup. SRI not needed for a locally-bundled dep.

### 8. [MEDIUM · robustness · Codex-reported] Worker durability gaps (Codex workers — operational depth)
- **Health always 200** even when a loop is permanently stuck (liveness≠readiness); both Azure alerts
  only check 200 → a wedged worker looks green forever.
- **Fire-and-forget** notification + course-completion after decision commit → SIGTERM/crash loses the
  email/completion with no retry (job already SUCCEEDED).
- **Graceful shutdown doesn't drain** in-flight ticks; **migration ordering**: new worker starts
  against a not-yet-migrated schema (`SKIP_MIGRATE=true`, web migrates).
→ Track `lastSuccessAt`/`runningSince`/consecutive-failures, return 503 on staleness; transactional
outbox for notifications; async drain on shutdown; migrate as an explicit phase before starting runtime.

### 9. [MEDIUM · security/data · Claude-verified] Rate limiting is both mis-keyed and un-shared
No `app.set('trust proxy')` → all anonymous clients collapse into **one** shared IP bucket (one noisy
client 429s everyone). And in-process **MemoryStore** → the LLM-cost cap silently becomes N× the moment
anyone scales out. `src/app.ts`, `src/middleware/rateLimiting.ts`.
→ `trust proxy` = 1 (quick win); shared store (Redis/Postgres) before any scale-out; loud assertion if
instances > 1.

### 10. [LOW–MEDIUM · structural · Claude-verified] Module cycle + unenforced contracts
`course ↔ adminContent` is a genuine bidirectional cycle masked by an over-wide `course/index.ts`
barrel; appeal/review duplicate assessment's orchestration; agent-scope is a hand-maintained regex that
must stay in sync with route files, unenforced.
→ Extract a shared kernel both depend on one-directionally; shrink the barrel; derive agent-scope from
the capability map.

**Also flagged (single-model, worth a look):** CSV formula injection in exports (Codex sec #7); PDF/DOCX
parse DoS in the web process (Codex sec #8); agent-token privilege-revocation gap after role removal
(Codex sec #9); parser-worker HMAC replayable / not body-bound (Codex sec #10); course-structure
duplicate-target and app-only invariants that a DB `CHECK`/enum would enforce (Codex data #7/#8);
certification `status` is free-text queried as `!= "NOT_CERTIFIED"` (a typo reads as passed).

---

## By dimension (Claude synthesis)

- **Robustness** — Invariants enforced in app code the runtime doesn't uphold under adversity;
  concurrency is the sharpest case, deploy-downtime the other. Both fixable with patterns the team
  already knows; both fail silently and only under load/deploys.
- **Security** — Perimeter genuinely strong; weakness is **defense-in-depth**: single-layer client
  sanitization, shared-bucket rate limiting, and unenforced manual contracts. Codex adds a real
  access-control/ownership + GDPR-in-audit class the perimeter strength masks.
- **Data & scaling** — The most findings and where cost is deferred: load-whole-table-then-filter, N+1,
  unbounded audit, MemoryStore scale ceiling. All standard, mostly moderate-effort fixes.
- **Structural debt** — Above average overall; debt concentrated in cross-cutting invariants by
  convention, the course↔adminContent cycle, and non-transactional audit (the most consequential —
  it undermines the system's own integrity claim).

## What's genuinely healthy (both models)

*(Phase-4 correction: the audit trail is **not** in this list — Codex showed it is not tamper-evident:
`payloadHash` excludes actor/timestamp and is neither chained nor verified, and some mutations (e.g.
course-metadata updates) emit no audit event. The audit **model** is fine; its **integrity guarantees**
are weaker than the initial report implied. See Phase 4 + top-risk #3.)*

Capability→role single source of truth · immutable versioned content + decision lineage · per-domain
repository layering with the correct CAS idiom already present · mature layered auth resolver + scoped
TTL agent tokens · staggered worker startup + graceful-ish shutdown (lessons from the #497 incident
encoded) · careful deploy tooling + isolated backup vault + atomic credential rotation · consistent
Prisma parameterization (no raw SQL), widespread Zod, strong SSRF controls · real client de-dup effort
(shared html-escape/i18n, pure derivation modules).

---

## Suggested sequencing

- **Quick wins (hours–days):** `trust proxy`; derive agent-scope from capability map; CSV formula
  escaping; certification passing-state query fix.
- **Moderate (the core correctness work):** apply guarded-`updateMany` + transactions + partial-unique
  indexes across all claim/resolve/assessment paths (#2); denormalize+index the audit lookup and add
  the scheduled-scan indexes + batching (#3, #4); client-side sanitizer (#7); shared rate-limit store
  (#9); transactional outbox for notifications (#8); PII out of audit metadata (#6).
- **Strategic (plan deliberately):** deploy topology → slots + tier + split plans (#1); course/
  adminContent kernel extraction (#10); worker health/liveness + drain overhaul (#8).

## Tracking — epics & issues

The findings are tracked in GitHub under milestone **M5 Stabilization**. This report is the rationale;
the issues are the work.

| Epic | Theme | Issues |
|---|---|---|
| **#778** | Object-level access control (authorization) `p1` | #785 restricted-course IDOR · #786 asset IDOR · #787 ownership scoping (design) · #788 body-before-auth DoS · #789 agent-token revocation gap |
| **#779** | Data integrity — DB-enforced concurrency `p1` | #790 appeal races · #791 manual-review races · #792 lease fencing · #793 enqueue partial-unique · #794 MCQ atomicity · #795 notification outbox · #796 import transaction |
| **#780** | Data-model scaling & performance `p2` | #797 audit-lookup DoS · #798 scheduled scans · #799 interactive fan-out · #800 hot-table indexes · #801 rate-limit store · #802 discussion pagination |
| **#781** | Audit integrity & compliance `p1` | #803 non-transactional audit · #804 tamper-evidence · #805 missing audit events · #806 PII-in-audit (GDPR) · #807 retention delete |
| **#782** | Runtime robustness & deploy continuity `p1` | #808 zero-downtime deploys · #809 liveness/readiness · #810 shutdown draining · #811 migration ordering · #812 external-call deadlines · #813 unhandled rejection |
| **#783** | Security defense-in-depth `p2` | #814 client sanitizer · #815 parse DoS · #816 parser HMAC replay · ✅ trust proxy (#775, 2.0.1) · ✅ CSV injection (#776, 2.0.2) |
| **#784** | Structural debt `p4` | #817 module cycle · #818 duplicated controllers · #819 agent-scope test · #820 cert-status enum (latent) |

## Caveats

- Codex-reported findings were subsequently **cross-verified in Phase 4** (13 CONFIRMED / 1 REFUTED /
  1 PLAUSIBLE); the refuted one (agent tokens corrupting another author's course) was folded into the
  SMO-ownership gap (#787), not tracked separately.
- Severities blend both models' judgments; where they differed the higher is shown with attribution.
- Baseline: code at 2026-07-19, **version 2.0.0** (post-#478 Tier 2). Two quick wins from this review
  are already shipped: `trust proxy` (#775 → 2.0.1) and CSV formula injection (#776 → 2.0.2).
