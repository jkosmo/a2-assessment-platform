# Dev Tenant Auth Target Design (Issue #37)

## Purpose
Define the target authentication design for shared development and testing using Microsoft Entra ID, with strict isolation from production identity objects.

## Scope
- API authentication for backend (`AUTH_MODE=entra`).
- Entra app registration topology (API app + client app).
- Token issuer/audience contract.
- Group-to-role model for application RBAC.
- Naming conventions and ownership.
- Rollout plan from `AUTH_MODE=mock` to `AUTH_MODE=entra`.

Out of scope:
- Production tenant rollout.
- Full automation scripts (handled by follow-up issue #40).
- Final group-to-role code implementation (handled by follow-up issue #38).

## Target Architecture

### Components
1. **Dev tenant (Entra ID)**
- Separate directory from production.
- Separate app registrations and groups.

2. **Assessment API app registration (confidential resource)**
- Exposes API scope for client app.
- Tokens to backend must match this audience.

3. **Assessment client app registration (public client / SPA)**
- Requests tokens for Assessment API scope.
- Used by developers/testers for sign-in.

4. **Backend service**
- Validates JWT issuer and audience.
- Resolves user identity and role assignments in database.

5. **App database**
- `User` and `RoleAssignment` remain source of truth for effective app roles.
- Entra claims/groups are mapped to app roles through configured mapping.

## OAuth and Token Contract
- Tenant mode: single-tenant (`AzureADMyOrg`) for dev tenant.
- Issuer: `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/v2.0`.
- Audience: `ENTRA_AUDIENCE` (API App ID URI, e.g. `api://<api-client-id>`).
- Recommended interactive flow for clients: Authorization Code with PKCE.

## Required Entra Objects

### App Registrations
1. `a2-assessment-api-dev`
- Type: web/API app registration.
- Purpose: resource API for backend audience validation.
- Needs:
- Exposed scope: `access_as_user`.
- Optional app roles if using token role claims later.

2. `a2-assessment-client-dev`
- Type: SPA/public client registration.
- Purpose: interactive user sign-in for dev/test.
- Needs:
- Redirect URIs for local and shared dev UI.
- API permission to `a2-assessment-api-dev/access_as_user`.

### Enterprise Apps / Service Principals
- Service principals for both app registrations in dev tenant.

### Security Groups (recommended baseline)
- `a2-assessment-dev-participants`
- `a2-assessment-dev-admins`
- `a2-assessment-dev-reviewers`
- `a2-assessment-dev-appeal-handlers`
- `a2-assessment-dev-report-readers`

Groups are used for onboarding scale and mapped to app roles.

## Naming Convention
- Pattern: `a2-assessment-{component}-{env}`
- Examples:
- `a2-assessment-api-dev`
- `a2-assessment-client-dev`
- `a2-assessment-dev-admins`

## Ownership Model
- **Identity owner (Platform/Security):**
- App registrations, app secrets/certs, consent model, tenant policies.
- **Application owner (Engineering):**
- Audience/issuer config, claim mapping logic, role assignment mapping.
- **Test lead / QA owner:**
- Tester onboarding to dev groups and smoke-test execution.

## Environment Separation Policy
- Dev tenant and prod tenant must use separate:
- app registrations
- service principals
- groups
- secrets/certificates
- consent approvals
- No production app IDs, secrets, or tenant IDs are allowed in dev config.
- No cross-tenant token acceptance in API validation.

## Configuration Model
Required environment values in app:
- `AUTH_MODE=entra`
- `ENTRA_TENANT_ID=<dev-tenant-id>`
- `ENTRA_AUDIENCE=<api-app-id-uri>`

Future config (issue #38):
- `ENTRA_GROUP_ROLE_MAP_JSON` or equivalent config source
- mapping Entra group/object IDs -> app roles

## Rollout Plan (mock -> entra)
1. **Phase A: Prepare**
- Keep local default as `AUTH_MODE=mock`.
- Create dev app registrations and groups in Entra.
- Document values and onboarding steps.

2. **Phase B: Shared dev enablement**
- Enable `AUTH_MODE=entra` in shared dev environment.
- Validate issuer/audience and sign-in for test users.
- Keep mock mode available only for local fallback.

3. **Phase C: Role mapping and hardening**
- Implement group-to-role mapping (#38).
- Add auth smoke-test checklist and troubleshooting docs (#39).
- Enforce periodic review of group membership.

## Risks and Mitigations
- **Risk:** Wrong audience/issuer leads to auth failures.
- Mitigation: fixed env validation + smoke tests + jwt claim checks.
- **Risk:** Role drift between Entra groups and app roles.
- Mitigation: central mapping config + automated validation tests.
- **Risk:** Dev/prod identity leakage.
- Mitigation: strict tenant isolation policy and naming conventions.

## Acceptance Criteria Mapping for #37
- Design document exists with architecture and rollout: **covered**.
- Required Entra objects + naming + ownership: **covered**.
- Explicit dev/prod separation policy: **covered**.
- Rollout from mock to entra: **covered**.

