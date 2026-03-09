# Phase 2 Design Note: Advanced Reporting Model and BI Layer (#30)

## Context
Issue #30 requires deeper analytics beyond operational reports, including semantic KPIs, trend/cohort analysis, and reporting-pipeline data quality checks.

## Chosen approach
- Add a config-driven analytics model (`config/reporting-analytics.json`) for:
  - KPI definitions
  - allowed trend granularities
  - cohort dimensions
  - data-quality thresholds
- Extend reporting service with new analytics endpoints:
  - semantic KPI model
  - historical trends
  - cohorts
  - data-quality checks
- Reuse existing data model (submissions, decisions, LLM evaluations, appeals, certifications) to avoid schema migration.

## Tradeoffs
- This implementation is API-first and BI-ready but does not yet include direct external warehouse connectors.
- Cohort/trend aggregation is done at service level for current scale; can be moved to warehouse materializations later.

## Rollout/rollback
- Safe rollout via additive endpoints.
- Thresholds and dimensions are adjustable through config.
- Rollback is straightforward: remove endpoints and config loader.
