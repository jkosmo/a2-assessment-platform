# Azure Preparation Plan

## Context
- Repository: `a2-assessment-platform`
- Scope: Issue `#42` (automated Azure staging/production provisioning, low-cost baseline, separate resource groups)
- Execution mode: preparation and automation artifacts (no live deployment in this change)

## Decisions
- Deployment style: Azure CLI + Bicep (resource group scoped) orchestrated by GitHub Actions.
- Runtime target: Azure App Service Linux (Node 22) for low-complexity operations.
- Environment separation: dedicated RG per environment (`staging`, `production`).
- Cost baseline: small dedicated plan (`B1`), single instance, tags + optional budget automation.
- Release flow: auto deploy staging on `main`; production deployment requires GitHub Environment approval.

## Planned Artifacts
- `infra/azure/main.bicep`
- `scripts/azure/deploy-environment.ps1`
- `scripts/azure/configure-cost-guardrails.ps1`
- `.github/workflows/deploy-azure.yml`
- `.azure/environments/*.env.example`
- `doc/AZURE_ENVIRONMENTS.md`

## Security and Ops
- Use OIDC-based `azure/login` in workflow (no stored secrets for passwords).
- Environment-specific settings via workflow variables/secrets.
- Cost tracking tags and optional budget configuration script.

## Status
- [x] Plan created
- [x] User requested implementation
- [ ] Infrastructure artifacts implemented
- [ ] Workflow implemented
- [ ] Documentation completed

