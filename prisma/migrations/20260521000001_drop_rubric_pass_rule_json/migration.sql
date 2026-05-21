-- Drop the unused RubricVersion.passRuleJson column.
--
-- This column has been written to but never read by the assessment decision
-- logic since the 2aa216a refactor ("forenkle vurderingsmodell til én terskel").
-- All real pass/fail thresholds live in ModuleVersion.assessmentPolicyJson
-- (assessmentPolicy.passRules) and are consumed by decisionService.ts.
-- See #446 for the audit and rationale.
--
-- Data loss: values stored in passRuleJson are dropped. Confirmed unused by
-- grep over src/modules/assessment/ — no consumer of this column exists.

ALTER TABLE "RubricVersion" DROP COLUMN IF EXISTS "passRuleJson";
