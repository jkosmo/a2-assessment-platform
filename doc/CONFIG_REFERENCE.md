# Config File Reference

All config files live in `config/` at the project root. They are loaded at startup and cached in memory. Changes require a process restart.

---

## assessment-rules.json

**Loaded by:** `src/config/assessmentRules.ts`
**Env override:** `ASSESSMENT_RULES_FILE` (default: `config/assessment-rules.json`)
**Used by:** `decisionService`, `assessmentJobService`, `assessmentRedFlagPolicy`, `sensitiveDataMaskingService`, `secondaryAssessmentService`, `recertificationService`, `mcqService`

Core decision engine configuration. Controls pass/fail thresholds, manual review routing, red flag handling, MCQ quality gating, sensitive data masking patterns, secondary assessment triggers, and recertification validity.

### Sections

**`thresholds`** - Minimum scores for a passing outcome.

| Field | Type | Description |
|---|---|---|
| `totalMin` | `number (0-100)` | Minimum combined score (practical + MCQ) to pass |
| `practicalMinPercent` | `number (0-100)` | Minimum practical component percentage |
| `mcqMinPercent` | `number (0-100)` | Minimum MCQ percentage score |

**`weights`** - Maximum raw scores for each component.

| Field | Type | Description |
|---|---|---|
| `practicalMaxScore` | `number (>=1)` | Max possible practical score (used to compute scaled totals) |
| `mcqMaxScore` | `number (>=1)` | Max possible MCQ score |

**`manualReview`** - Rules for routing to human review.

| Field | Type | Description |
|---|---|---|
| `borderlineWindow.min` | `number` | Lower bound of borderline score window (inclusive) |
| `borderlineWindow.max` | `number` | Upper bound of borderline score window (inclusive) |
| `redFlagSeverities` | `string[]` | LLM red flag severities that trigger manual review |
| `redFlagCodes` | `string[]` | Specific LLM red flag codes that trigger manual review |

**`llmDecisionReliability`** - Canonicalisation of LLM-produced red flag codes.

| Field | Type | Description |
|---|---|---|
| `unknownRedFlagHandling` | `"downgrade_to_unclassified" \| "keep_as_is"` | How to handle red flag codes not in `canonicalRedFlags` |
| `unknownRedFlagCanonicalCode` | `string` | Canonical code to use when downgrading unknown flags |
| `canonicalRedFlags` | `Record<string, string[]>` | Map from canonical code to accepted LLM synonyms |

**`mcqQuality`** *(optional, has defaults)* - Quality thresholds for MCQ item analysis.

| Field | Default | Description |
|---|---|---|
| `minAttemptCount` | `5` | Minimum attempts before item statistics are considered reliable |
| `difficultyMin` | `0.2` | Minimum acceptable item difficulty index |
| `difficultyMax` | `0.9` | Maximum acceptable item difficulty index |
| `discriminationMin` | `0.1` | Minimum acceptable discrimination index |

**`sensitiveData`** *(optional, has defaults)* - Regex-based masking rules applied before LLM evaluation.

| Field | Default | Description |
|---|---|---|
| `enabledByDefault` | `false` | Whether masking is active for modules not in `moduleOverrides` |
| `moduleOverrides` | `{}` | Per-module enable/disable overrides (`{ "module-id": true }`) |
| `rules[].id` | - | Rule identifier |
| `rules[].pattern` | - | Regex pattern (JavaScript syntax) |
| `rules[].flags` | - | Regex flags (for example `"gi"`) |
| `rules[].replacement` | - | Replacement string (for example `"[MASKED_EMAIL]"`) |

**`secondaryAssessment`** *(optional, has defaults)* - Triggers and disagreement thresholds for secondary LLM evaluation.

| Field | Default | Description |
|---|---|---|
| `enabledByDefault` | `true` | Whether secondary assessment runs by default |
| `moduleOverrides` | `{}` | Per-module overrides |
| `triggerRules.manualReviewRecommended` | `true` | Trigger secondary if primary recommends manual review |
| `triggerRules.confidenceNotePatterns` | `["medium confidence", "low confidence"]` | LLM note strings that trigger secondary |
| `triggerRules.redFlagCodes` | `[]` | Red flag codes that trigger secondary |
| `triggerRules.redFlagSeverities` | `["medium", "high"]` | Red flag severities that trigger secondary |
| `disagreementRules.practicalScoreDeltaMin` | `8` | Score delta that counts as significant disagreement |
| `disagreementRules.rubricTotalDeltaMin` | `3` | Rubric total delta that counts as significant disagreement |
| `disagreementRules.passFailMismatch` | `true` | Flag when primary and secondary disagree on pass/fail |
| `disagreementRules.manualReviewRecommendationMismatch` | `true` | Flag when primary and secondary disagree on manual review |

**`recertification`** *(optional, has defaults)* - Validity and reminder schedule for completed certifications.

| Field | Default | Description |
|---|---|---|
| `validityDays` | `365` | Days a certification is valid before recertification is required |
| `dueOffsetDays` | `30` | Days before expiry when "due" state activates |
| `dueSoonDays` | `14` | Days before expiry when "due soon" state activates |
| `reminderDaysBefore` | `[30, 7, 1]` | Days before expiry to send reminder notifications |

---

## benchmark-examples.json

**Loaded by:** `src/config/benchmarkExamples.ts`
**Path:** hard-coded to `config/benchmark-examples.json`
**Used by:** `adminContentService`

Validation constraints for benchmark example entries uploaded via the admin content workspace.

| Field | Default | Description |
|---|---|---|
| `maxExamplesPerVersion` | `20` | Maximum benchmark examples per module version |
| `maxTextLength` | `4000` | Maximum character length per example text field |
| `requiredFields` | `["anchorId", "input", "expectedOutcome"]` | Fields that must be present in every example |

---

## entra-group-role-map.example.json / entra-group-role-map.generated.json

**Loaded by:** `src/auth/authenticate.ts`
**Env vars:** `ENTRA_GROUP_ROLE_MAP_JSON` (inline JSON string) or `ENTRA_GROUP_ROLE_MAP_FILE` (path to a file)
**Used by:** `authenticate` middleware (Entra auth mode only)

Maps Azure Entra group object IDs to platform roles. Used to derive a user's roles from their Entra group memberships during authentication.

`entra-group-role-map.example.json` is a committed template with placeholder GUIDs - copy and populate it for each environment.

`entra-group-role-map.generated.json` is generated from the actual tenant and **must not be committed** to source control (contains real group GUIDs).

**Format:**

```json
{
  "<entra-group-object-id>": "PARTICIPANT",
  "<entra-group-object-id>": "ADMINISTRATOR"
}
```

**Available roles:** `PARTICIPANT`, `ADMINISTRATOR`, `REVIEWER`, `APPEAL_HANDLER`, `REPORT_READER`, `SUBJECT_MATTER_OWNER`

---

## module-completion.json

**Loaded by:** `src/config/moduleCompletion.ts`
**Path:** hard-coded to `config/module-completion.json`
**Used by:** `submissions` route, `moduleCompletionPolicyService`

Controls how completed modules are displayed and paginated in the participant workspace.

| Field | Description |
|---|---|
| `completedSubmissionStatuses` | Submission statuses considered "completed" for history display |
| `hideCompletedInAvailableByDefault` | Whether completed modules are hidden from the available modules list by default |
| `defaultCompletedHistoryLimit` | Default page size for completed module history |
| `maxCompletedHistoryLimit` | Hard cap on completed module history page size |

---

## org-sync.json

**Loaded by:** `src/config/orgSync.ts`
**Path:** hard-coded to `config/org-sync.json`
**Used by:** `orgSyncService`

Controls how user records are reconciled when the org sync job runs (triggered via `POST /api/admin/sync/org`).

| Field | Description |
|---|---|
| `conflictStrategy` | How to resolve conflicts when a user exists with a different identity. `"merge_by_email"` matches on email and updates the record. |
| `allowDepartmentOverwrite` | Whether the sync job may overwrite the user's stored department |
| `allowManagerOverwrite` | Whether the sync job may overwrite the user's stored manager |
| `defaultActiveStatus` | Active status assigned to newly created users during sync |

---

## participant-console.json

**Loaded by:** `src/config/participantConsole.ts`
**Env override:** `PARTICIPANT_CONSOLE_CONFIG_FILE` (default: `config/participant-console.json`)
**Used by:** `/participant/config` runtime config endpoint and frontend workspaces

Large composite config that drives browser-side runtime behavior. It no longer owns the canonical workspace navigation contract; navigation is derived from `src/config/capabilities.ts` and merged with runtime-tunable settings here.

### Sections

**`mockRolePresets`** - Roles available in the mock-mode role switcher (dev/test only).

**`drafts`** - Local storage draft settings for the participant workspace.

| Field | Description |
|---|---|
| `storageKey` | localStorage key for draft state |
| `ttlMinutes` | Draft time-to-live in minutes |
| `maxModules` | Maximum number of modules with saved draft state |

**`flow`** - Assessment polling behaviour in the participant workspace.

| Field | Description |
|---|---|
| `autoStartAfterMcq` | Whether assessment starts automatically after MCQ submission |
| `pollIntervalSeconds` | How often the frontend polls for assessment status |
| `maxWaitSeconds` | Maximum time to wait before showing a timeout message |

**`manualReviewWorkspace` / `appealWorkspace`** - Queue filter defaults and page sizes used inside the combined `/review` workspace.

**`calibrationWorkspace`** - Calibration access roles, default filters, and signal quality thresholds (pass rate, manual review rate, benchmark coverage). `accessRoles` is the explicit runtime-configurable exception that influences both `/api/calibration` protection and `/calibration` navigation visibility.

**`identityDefaults`** - Default mock identities for each role used in development and integration testing.

---

## reporting-analytics.json

**Loaded by:** `src/config/reportingAnalytics.ts`
**Path:** hard-coded to `config/reporting-analytics.json`
**Used by:** `reportingService`

Defines KPI calculations, trend granularities, and data quality thresholds for the reporting endpoints.

**`kpiDefinitions`** - Named metrics surfaced in the reporting API. Each entry has `id`, `label`, and a `formula` string describing the calculation.

**`trends`** - Allowed time granularities for trend data (`day`, `week`, `month`) and the default.

**`cohorts`** - Allowed grouping dimensions for cohort analysis (`month`, `department`) and the default.

**`dataQuality`** - Thresholds that flag data quality warnings in reports.

| Field | Description |
|---|---|
| `maxMissingDecisionRate` | Maximum acceptable fraction of submissions without a decision |
| `maxDecisionWithoutEvaluationRate` | Maximum acceptable fraction of decisions without an LLM evaluation |
