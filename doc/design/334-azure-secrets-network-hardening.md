# Design: Azure secrets and network hardening before pilot

**Issue:** #334  
**Status:** Design  
**Date:** 2026-04-19  
**Findings:** INFRA-001 (CRITICAL), INFRA-002 (HIGH), INFRA-004 (LOW–MED)

---

## Problem

Three infrastructure findings from the 2026-04-18 pentest combine into a realistic attack chain:

1. **INFRA-001** — PostgreSQL Flexible Server has a `0.0.0.0/0.0.0.0` firewall rule named `allow-azure-services`. This lets any Azure VM or Cloud Shell in any tenant attempt a connection if they have valid credentials.
2. **INFRA-002** — `DATABASE_URL`, `AZURE_OPENAI_API_KEY`, and `AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING` are stored as plaintext in App Service configuration. Any Contributor on the resource group can read them via `az webapp config appsettings list`.
3. **INFRA-004** — Managed identity RBAC scope is not tracked in Bicep, so over-privileged grants are invisible until explicitly audited.

**Chain:** Contributor on RG → reads DATABASE_URL password from app settings → connects to PostgreSQL from any Azure Cloud Shell because of the 0.0.0.0 firewall rule.

---

## What is NOT changing

- App Service SKU and networking tier (no VNet integration, no private endpoints — out of scope for pilot)
- PostgreSQL SKU or version
- ACS or OpenAI resources themselves

The design is constrained to the cheapest safe configuration for pilot: outbound IP allowlisting + Key Vault references.

---

## Decision: PostgreSQL firewall approach

Two options were considered:

| Option | Pros | Cons |
|---|---|---|
| **A: App Service outbound IP allowlist** | No tier change, no VNet setup, works for Burstable SKU | IPs can change on App Service scale events; requires pipeline step to query IPs |
| **B: VNet integration + private endpoint** | IPs irrelevant, correct long-term architecture | Requires standard/premium tier, VNet resource, subnet delegation, DNS zone |

**Decision: Option A for pilot.** VNet integration is the right long-term target but requires an infrastructure tier change. For pilot, outbound IP allowlisting with explicit IPs in Bicep parameters eliminates the 0.0.0.0 rule while staying within current constraints. VNet private endpoint is a post-pilot item (V2-02).

---

## Decision: Key Vault secret storage

Two sub-options for DATABASE_URL:

| Option | Notes |
|---|---|
| **A: Store full connection string** | Bicep constructs `postgresql://user:pass@host/db` at deploy time, stores as KV secret, app reads it verbatim |
| **B: Store password only, construct URL at startup** | Requires app-side URL assembly from individual env vars |

**Decision: Option A.** Simpler for the app — environment contract is unchanged (`DATABASE_URL` env var still exists, just sourced from KV). No app code change needed.

---

## Proposed Bicep changes

### 1. Remove `allow-azure-services` firewall rule; replace with IP allowlist

```bicep
// Remove:
resource postgresFirewallAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = {
  name: 'allow-azure-services'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// Add parameter:
param dbAllowedIpAddresses array = []
// Each element: { name: string, startIpAddress: string, endIpAddress: string }

// Add loop:
resource postgresFirewallRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = [
  for ip in dbAllowedIpAddresses: {
    parent: postgresServer
    name: ip.name
    properties: { startIpAddress: ip.startIpAddress, endIpAddress: ip.endIpAddress }
  }
]
```

**Deployment pipeline step** (runs before `az deployment group create`):

```bash
WEB_IPS=$(az webapp show -n $WEB_APP_NAME -g $RG --query "outboundIpAddresses" -o tsv)
WORKER_IPS=$(az webapp show -n $WORKER_APP_NAME -g $RG --query "outboundIpAddresses" -o tsv)
# Build dbAllowedIpAddresses JSON array from comma-separated IPs
# Pass as --parameters dbAllowedIpAddresses="[...]"
```

The IP list is stored as a deployment parameter, not hardcoded in main.bicep. After a scale event that changes outbound IPs, the pipeline re-runs with the new IPs.

### 2. Add Azure Key Vault resource

```bicep
param keyVaultName string = toLower('${appNamePrefix}-${envCode}-kv-${suffix}')
// suffix must keep total name ≤ 24 chars

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: tenant().tenantId
    enableRbacAuthorization: true   // Use RBAC, not access policies
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: false    // Allow purge during pilot (enable post-pilot)
    publicNetworkAccess: 'Enabled'  // Required until VNet private endpoint added (V2-02)
  }
}
```

### 3. Store secrets in Key Vault

```bicep
resource kvSecretDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'DATABASE-URL'
  properties: { value: postgresConnectionString }
}

resource kvSecretOpenAiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-OPENAI-API-KEY'
  properties: { value: azureOpenAiApiKey }
}

resource kvSecretAcsConnection 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (createAcsEmail) {
  parent: keyVault
  name: 'ACS-CONNECTION-STRING'
  properties: { value: acsService.listKeys().primaryConnectionString }
}
```

Note: `postgresConnectionString` and `azureOpenAiApiKey` are still Bicep parameters (they must be provided at deploy time). They transit through Bicep only to be stored in KV — they never appear in the deployed app settings.

### 4. Grant managed identities Key Vault Secrets User role

```bicep
// Built-in role: Key Vault Secrets User = 4633458b-17de-408a-b874-0445c86b69e0
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e0'

resource webAppKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, webApp.id, keyVaultSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerAppKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, workerApp.id, keyVaultSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

### 5. Replace plaintext app settings with Key Vault references

```bicep
// Before:
{ name: 'DATABASE_URL', value: postgresConnectionString }
{ name: 'AZURE_OPENAI_API_KEY', value: azureOpenAiApiKey }
{ name: 'AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING', value: acsService.listKeys().primaryConnectionString }

// After:
{ name: 'DATABASE_URL', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=DATABASE-URL)' }
{ name: 'AZURE_OPENAI_API_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=AZURE-OPENAI-API-KEY)' }
{ name: 'AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING', value: createAcsEmail ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=ACS-CONNECTION-STRING)' : '' }
```

App Service resolves these references at startup using the managed identity. If resolution fails, the app setting shows as `Microsoft.KeyVault reference is invalid` in the portal and the app sees a blank value — this is detectable and alertable.

---

## INFRA-004: Managed identity RBAC audit

This is a procedural step, not a Bicep change. Before closing #334:

```bash
# Get principal IDs from deployed app services
WEB_PRINCIPAL=$(az webapp identity show -n $WEB_APP_NAME -g $RG --query principalId -o tsv)
WORKER_PRINCIPAL=$(az webapp identity show -n $WORKER_APP_NAME -g $RG --query principalId -o tsv)

# List all role assignments
az role assignment list --assignee $WEB_PRINCIPAL --all -o table
az role assignment list --assignee $WORKER_PRINCIPAL --all -o table
```

**Expected grants after this change:**
- Both identities: `Key Vault Secrets User` on the Key Vault (tracked in Bicep)
- Web identity: whatever is needed for App Insights / Storage (verify scope is resource-specific, not RG or subscription)
- Worker identity: same

Any RG-level or subscription-level grants not tracked in Bicep must be removed or justified before closing.

---

## Deployment sequence

Order matters — secrets must exist in KV before app settings reference them, and the managed identity role must be assigned before the app starts resolving KV references.

1. **Deploy Key Vault** (new resource, no dependencies)
2. **Store secrets** in KV (depends on step 1)
3. **Assign managed identity roles** (depends on step 1 and step 2)
4. **Update app settings** to KV references (depends on step 3)
5. **Remove `allow-azure-services` firewall rule; add IP allowlist rules** (independent, can run in parallel with 1–4)
6. **Run RBAC audit** and document expected vs actual grants

Steps 1–4 are a single Bicep deployment (Bicep handles the dependency ordering via `dependsOn` and `parent`). Step 5 is part of the same deployment. Step 6 is post-deploy.

---

## Rollback plan

If KV reference resolution fails on deploy:
1. App Service shows `WEBSITE_AUTH_ENCRYPTION_KEY__status: Invalid` for affected settings
2. Restore plaintext values temporarily in app settings (portal or CLI) while diagnosing
3. Root cause is always one of: managed identity not yet assigned, KV soft-delete blocking recreation, network access policy on KV

---

## Files affected

- `infra/azure/main.bicep` — all changes
- `infra/azure/` — possible new `deploy.sh` or pipeline script for IP query step

## Out of scope for this issue

- VNet integration / private endpoint for PostgreSQL (post-pilot, V2-02)
- Purge protection (enable post-pilot when KV is established)
- Rotating the database password itself (separate operational task)
- Moving `ENTRA_CLIENT_SECRET` to KV (currently only used in mock auth mode; verify and add if used in production)
