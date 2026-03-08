# Dev Tenant Auth Onboarding and Smoke Tests

## Purpose
Enable developers and testers to use real Entra authentication in dev, with a repeatable smoke-test checklist.

## Prerequisites
- Access to dev Entra tenant.
- Azure CLI installed.
- Permissions to create app registrations/groups (or pre-provisioned by platform owner).
- Local repository checkout and Node.js installed.

## 1) Bootstrap Entra objects
Run:

```powershell
pwsh ./scripts/entra/setup-dev-tenant-auth.ps1 -TenantId <DEV_TENANT_ID> -GrantAdminConsent
```

Output:
- Creates/reuses API and client app registrations.
- Creates/reuses service principals.
- Ensures API delegated scope `access_as_user`.
- Ensures client app delegated permission to API scope.
- Creates/reuses dev role groups.
- Produces `.env.entra.dev.generated` with required auth environment values.
- Produces `config/entra-group-role-map.generated.json` for explicit role mapping.

## 2) Apply environment config
1. Copy generated values into your local `.env`.
2. Ensure:
- `AUTH_MODE=entra`
- `ENTRA_TENANT_ID=<dev tenant>`
- `ENTRA_AUDIENCE=api://<api-app-client-id>`
- `ENTRA_SYNC_GROUP_ROLES=true`
- `ENTRA_GROUP_ROLE_MAP_FILE=config/entra-group-role-map.generated.json`

## 3) Add users/testers to groups
Add relevant users to dev groups:
- `a2-assessment-dev-participants`
- `a2-assessment-dev-admins`
- `a2-assessment-dev-reviewers`
- `a2-assessment-dev-appeal-handlers`
- `a2-assessment-dev-report-readers`

## 4) Run application
```powershell
npm install
npm run prisma:generate
npm run db:reset
npm run db:migrate
npm run prisma:seed
npm run dev
```

## 5) Auth smoke-test checklist (non-developer friendly)

### Test preconditions
- Tester user is added to at least one dev role group.
- Backend is running.
- Tester can obtain a bearer token for dev client app (via your chosen sign-in flow).

### Positive path
- Acquire token for dev client app and call:
- `GET /api/me`
- Expected: `200` and role list populated based on group mapping.
- Call:
- `GET /api/modules`
- Expected: `200` for authorized tester.

### Negative path
- Use user not assigned to mapped groups.
- Call:
- `GET /api/modules`
- Expected: `403 forbidden`.

### M1 flow path
- Create submission via UI (`/participant`) or API.
- Complete MCQ.
- Queue/run assessment.
- Verify result endpoint returns decision.

### Suggested curl examples
```bash
curl -H "Authorization: Bearer <TOKEN>" https://<BASE_URL>/api/me
curl -H "Authorization: Bearer <TOKEN>" https://<BASE_URL>/api/modules
```

## Troubleshooting quick guide
- **401 unauthorized**: Check `ENTRA_TENANT_ID`, token issuer, token validity.
- **401 audience mismatch**: Check `ENTRA_AUDIENCE` and API app identifier URI.
- **403 forbidden**: User authenticated but no mapped app role assignment.
- **No role sync**: Ensure `ENTRA_SYNC_GROUP_ROLES=true` and valid `ENTRA_GROUP_ROLE_MAP_JSON`.
- **Redirect URI errors**: Ensure URI exactly matches app registration.

## Ownership
- Platform/Security: Entra app/group baseline, consent, tenant guardrails.
- Engineering: claim mapping logic, API auth validation, app config.
- QA/Test lead: smoke-test execution and tester onboarding.
