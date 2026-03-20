# A2 Assessment Platform

Internal platform for delivering assessment modules, evaluating participant submissions, routing borderline cases to human review, and maintaining an auditable decision trail from first assessment to appeal resolution.

## What it does

- Module-based assessment with automated LLM evaluation and human review fallback
- Role-separated workspaces: participant, reviewer, appeal handler, calibrator, administrator
- Immutable decision lineage with audit events throughout the assessment lifecycle
- Configuration-driven behaviour; deployable to Azure App Service + PostgreSQL

## Stack

- Node.js 22 + TypeScript + Express
- Prisma ORM + PostgreSQL
- Azure App Service (hosting), Azure OpenAI (LLM), Microsoft Entra ID (auth)

---

## Documentation

| Document | Contents |
|---|---|
| [Getting Started](doc/GETTING_STARTED.md) | Local setup, PostgreSQL automation, running tests, manual workspace walkthroughs |
| [API Reference](doc/API_REFERENCE.md) | All routes with method, path, and required roles |
| [Config Reference](doc/CONFIG_REFERENCE.md) | All `config/*.json` files — fields, types, defaults, bounded context |
| [Architecture](doc/design/ARCHITECTURE.md) | System design, component overview, data model |
| [Domain Lifecycle](doc/DOMAIN_LIFECYCLE.md) | State machines: submission → assessment → review → appeal; RBAC ownership |
| [Operations Runbook](doc/OPERATIONS_RUNBOOK.md) | Startup sequence, migrations, worker health, failure diagnosis, tracing |
| [Observability Runbook](doc/OBSERVABILITY_RUNBOOK.md) | Structured log events, Azure Monitor alerts, KQL queries |
| [Azure Environments](doc/AZURE_ENVIRONMENTS.md) | Staging/production provisioning, GitHub secrets, environment variables |
| [Appeals Operating Model](doc/APPEALS_OPERATING_MODEL.md) | SLA, ownership model, escalation process |
| [Version History](doc/VERSIONS.md) | Release log |

### Design Notes

| Document | Contents |
|---|---|
| [M0 Borderline Routing](doc/design/M0_BORDERLINE_ROUTING.md) | Borderline/manual review routing baseline |
| [M0 Implementation Decisions](doc/design/M0_IMPLEMENTATION_DECISIONS.md) | Foundational architecture decisions |
| [M1 Implementation Decisions](doc/design/M1_IMPLEMENTATION_DECISIONS.md) | M1 decisions |
| [Assessment Decision Policy](doc/design/ASSESSMENT_DECISION_POLICY.md) | Decision engine policy rules |
| [I18N](doc/design/I18N.md) | Internationalisation baseline and translation workflow |
| [Org Sync Conflict Strategy](doc/design/ORG_SYNC_CONFLICT_STRATEGY.md) | Identity conflict handling during org sync |
| [Production PostgreSQL Backup and Recovery](doc/design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md) | Backup target architecture |
| [Dev Tenant Auth Target Design](doc/design/DEV_TENANT_AUTH_TARGET_DESIGN.md) | Entra auth setup |
