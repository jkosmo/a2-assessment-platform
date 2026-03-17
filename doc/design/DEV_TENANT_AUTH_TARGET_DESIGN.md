# Dev Tenant Auth Target Design (Issue #37)

## Purpose
Define the target authentication design for shared development and testing using Microsoft Entra ID, with strict isolation from production identity objects.

## Scope
- API authentication for backend (`AUTH_MODE=entra`).
- Entra app registration topology (single combined registration).
- Token issuer/audience contract (v1 and v2 supported).
- App role model for application RBAC.
- Naming conventions and ownership.
- Rollout plan from `AUTH_MODE=mock` to `AUTH_MODE=entra`.

Out of scope:
- Production tenant rollout.
- Full automation scripts (handled by follow-up issue #40).
- Group-to-role mapping (`ENTRA_SYNC_GROUP_ROLES`) — handled separately.

## Target Architecture

### Components
1. **Tenant (Entra ID)**
- Separate directory from production.
- Single combined app registration per environment.

2. **Assessment app registration (SPA + API combined)**
- Exposes API scope (`access_as_user`) for backend audience validation.
- SPA redirect URIs registered for all workspace paths.
- App roles defined directly on the registration (assigned per user or group).
- Tokens to backend must match this audience.

3. **Backend service**
- Validates JWT issuer and audience.
- Merges app roles from JWT token with any DB-assigned roles.

4. **App database**
- `User` and `RoleAssignment` supplement Entra app roles.
- Effective roles = union of token roles and DB roles.

5. **Frontend (MSAL.js)**
- Initialised from `/participant/config` (`clientId`, `authority`, `scopes`).
- Authorization Code with PKCE flow.
- `acquireTokenSilent` before each API call; redirect fallback on expiry.
- Bearer token sent as `Authorization: Bearer <token>`.

## OAuth and Token Contract
- Tenant mode: single-tenant (`AzureADMyOrg`).
- Issuer: both v1 (`https://sts.windows.net/{ENTRA_TENANT_ID}/`) and v2 (`https://login.microsoftonline.com/{ENTRA_TENANT_ID}/v2.0`) accepted.
- Audience: `ENTRA_AUDIENCE` (Application ID URI, e.g. `api://<client-id>`).
- Interactive flow: Authorization Code with PKCE.
- Token scope: `api://<client-id>/.default`.

## Role Model
App roles are defined on the app registration and assigned per user via Enterprise Applications → Users and groups:

| Role value | Description |
|---|---|
| `ADMINISTRATOR` | Full platform access |
| `SUBJECT_MATTER_OWNER` | Module and content management |
| `REVIEWER` | Manual review queue |
| `APPEAL_HANDLER` | Appeal queue |
| `REPORT_READER` | Results workspace |
| `PARTICIPANT` | Assessment participant |

Role values must match exactly (case-sensitive). Invalid role names from the token are silently discarded.

## Required Entra Objects

### App Registration
- Name: `a2-assessment-platform-{env}` (e.g. `a2-assessment-platform-stage`)
- Type: Single-page application (SPA)
- Redirect URIs: all workspace paths (`/participant`, `/participant/completed`, `/manual-review`, `/appeal-handler`, `/calibration`, `/admin-content`)
- Expose an API: scope `access_as_user`, Application ID URI `api://<client-id>`
- App roles: all six role values listed above

### User assignment
- Via Enterprise Applications → Users and groups → Assign role
- Guest users (B2B invite) are supported — roles assigned in the same way

### Security Groups (optional, for scale)
- `a2-assessment-{env}-participants`
- `a2-assessment-{env}-admins`
- `a2-assessment-{env}-reviewers`
- `a2-assessment-{env}-appeal-handlers`
- `a2-assessment-{env}-report-readers`

Groups can be used when `ENTRA_SYNC_GROUP_ROLES=true` — see group role mapping config.

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
- `ENTRA_TENANT_ID=<tenant-id>`
- `ENTRA_CLIENT_ID=<application-client-id>`
- `ENTRA_AUDIENCE=<api-app-id-uri>` (e.g. `api://<client-id>`)

Optional (group-based role mapping):
- `ENTRA_SYNC_GROUP_ROLES=true`
- `ENTRA_GROUP_ROLE_MAP_JSON={"<group-id>":"ADMINISTRATOR",...}`

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

