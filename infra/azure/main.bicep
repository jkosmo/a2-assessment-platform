@description('Deployment environment name (staging or production).')
param environmentName string

@description('Primary deployment location.')
param location string = resourceGroup().location

@description('Global app name prefix. Must be lowercase alphanumeric and hyphen.')
param appNamePrefix string = 'a2-assessment-platform'

@description('App Service SKU name.')
@allowed([
  'B1'
  'S1'
  'P0v3'
])
param appServiceSkuName string = 'B1'

@description('Cost center tag value.')
param costCenter string = 'a2-assessment-platform'

@description('Deployment owner tag value.')
param owner string = 'engineering'

@description('Administrator login for Azure Database for PostgreSQL Flexible Server.')
param postgresAdministratorLogin string = 'a2platformadmin'

@description('Administrator password for Azure Database for PostgreSQL Flexible Server.')
@secure()
param postgresAdministratorPassword string

@description('Database name used by the application.')
param postgresDatabaseName string = 'a2assessment'

@description('PostgreSQL major version.')
param postgresVersion string = '16'

@description('PostgreSQL Flexible Server SKU name.')
param postgresSkuName string = 'Standard_B1ms'

@description('PostgreSQL Flexible Server SKU tier.')
@allowed([
  'Burstable'
  'GeneralPurpose'
  'MemoryOptimized'
])
param postgresSkuTier string = 'Burstable'

@description('PostgreSQL storage size in GiB.')
param postgresStorageSizeGB int = 32

@description('PostgreSQL backup retention in days.')
param postgresBackupRetentionDays int = 7

@description('PostgreSQL geo-redundant backup mode.')
@allowed([
  'Disabled'
  'Enabled'
])
param postgresGeoRedundantBackup string = 'Disabled'

@description('PostgreSQL high availability mode.')
@allowed([
  'Disabled'
  'SameZone'
  'ZoneRedundant'
])
param postgresHighAvailabilityMode string = 'Disabled'

@description('Auth mode for runtime.')
@allowed([
  'mock'
  'entra'
])
param authMode string = 'entra'

@description('Entra tenant id when authMode=entra.')
param entraTenantId string = ''

@description('Entra client id (SPA app registration) when authMode=entra.')
param entraClientId string = ''

@description('Entra audience when authMode=entra.')
param entraAudience string = ''

@description('Enable Entra group->role sync.')
param entraSyncGroupRoles bool = false

@description('Group mapping JSON string for Entra role sync.')
param entraGroupRoleMapJson string = '{}'

@description('LLM mode.')
@allowed([
  'stub'
  'azure_openai'
])
param llmMode string = 'stub'

@description('LLM stub model name.')
param llmStubModelName string = 'stub-model-v1'

@description('Azure OpenAI endpoint URL (for example https://resource.openai.azure.com).')
param azureOpenAiEndpoint string = ''

@description('Azure OpenAI API key.')
@secure()
param azureOpenAiApiKey string = ''

@description('Azure OpenAI deployment name.')
param azureOpenAiDeployment string = ''

@description('Azure OpenAI API version.')
param azureOpenAiApiVersion string = '2024-10-21'

@description('Azure OpenAI request timeout in milliseconds.')
param azureOpenAiTimeoutMs int = 120000

@description('Azure OpenAI temperature (0-2).')
param azureOpenAiTemperature string = '0'

@description('Azure OpenAI max output tokens.')
param azureOpenAiMaxTokens int = 1200

@description('Azure OpenAI token limit parameter strategy (max_tokens, max_completion_tokens, auto).')
@allowed([
  'max_tokens'
  'max_completion_tokens'
  'auto'
])
param azureOpenAiTokenLimitParameter string = 'auto'

@description('Token limit parameter for the authoring model. Overrides azureOpenAiTokenLimitParameter for content generation. Set to max_completion_tokens when using a reasoning model (o3/o4) for authoring.')
@allowed([
  'max_tokens'
  'max_completion_tokens'
  'auto'
  ''
])
param azureOpenAiAuthoringTokenLimitParameter string = ''

// #607: the Azure OpenAI account + model deployment, brought into IaC so the TPM capacity is
// codified/reproducible (previously provisioned + capacity-bumped manually via az).
@description('Azure OpenAI model deployment short name (appended after the env token: a2-assessment-<stg|prod>-<this>). Matches the existing deployment.')
param azureOpenAiModelDeploymentShortName string = 'gpt-4.1-mini'

@description('Azure OpenAI model name.')
param azureOpenAiModelName string = 'gpt-4.1-mini'

@description('Azure OpenAI model version.')
param azureOpenAiModelVersion string = '2025-04-14'

@description('Azure OpenAI deployment SKU (capacity tier).')
param azureOpenAiDeploymentSkuName string = 'GlobalStandard'

@description('Azure OpenAI deployment capacity (TPM units; 1 unit ~= 1K TPM). Raised to 100 during #479 so authoring stays fast with larger crawl source material.')
param azureOpenAiDeploymentCapacity int = 100

@description('Skip Key Vault secret role assignments. Set to true when the deployment SP lacks roleAssignments/write (e.g. has Contributor but not Owner). Existing assignments are preserved; missing ones will not be created. Default false.')
param skipRoleAssignments bool = false

@description('Escape-hatch salt for role assignment GUID seeds. Empty string in normal operation (default). Role assignment GUIDs are derived from subscription().subscriptionId + environmentName + a stable per-assignment suffix (#406), so the same environment always produces the same GUIDs — no salt is required for the normal recreate-RG flow. Bump to a new value (e.g. "a", "b") only in the rare case that you need to force-reset all GUIDs without changing environmentName, e.g. to recover from a corrupted role-assignment state. After bumping, manually delete orphaned role assignments (principalName == empty) in the resource group.')
param roleAssignmentSalt string = ''

@description('Skip PostgreSQL server and database ARM update when existing properties already match desired state. Set automatically by the deploy script pre-flight check to avoid ServerIsBusy control-plane locks on unchanged servers.')
param skipPostgresUpdate bool = false

@description('Assessment worker polling interval in milliseconds.')
param assessmentJobPollIntervalMs int = 4000

@description('Assessment worker max attempts.')
param assessmentJobMaxAttempts int = 3

@description('Optional email receiver for observability alerts.')
param observabilityAlertEmail string = ''

@description('Pending queue threshold for backlog alert.')
param queueBacklogAlertThreshold int = 5

@description('Average response time threshold in seconds for latency alert.')
param latencyAlertThresholdSeconds int = 3

@description('Unhandled runtime error count threshold within the alert window.')
param unhandledRuntimeErrorAlertThreshold int = 2

@description('Notification failure count threshold within the alert window.')
param notificationFailureAlertThreshold int = 1

@description('Overdue appeal count threshold for escalation alert.')
param appealOverdueAlertThreshold int = 1

@description('Appeal SLA monitor interval in milliseconds.')
param appealSlaMonitorIntervalMs int = 600000

@description('Participant notification delivery channel.')
@allowed([
  'disabled'
  'log'
  'webhook'
  'acs_email'
])
param participantNotificationChannel string = 'log'

@description('Optional webhook endpoint for participant notifications.')
@secure()
param participantNotificationWebhookUrl string = ''

@description('Webhook timeout in milliseconds for participant notifications.')
param participantNotificationWebhookTimeoutMs int = 5000

@description('Display name used as the sender name in ACS email notifications.')
param acsEmailSenderDisplayName string = 'A2 Assessment Platform'

@description('Allowed outbound IP address ranges for PostgreSQL firewall. Each element: { name: string, startIpAddress: string, endIpAddress: string }. Query from App Service outbound IPs before deploying.')
param dbAllowedIpAddresses array = []

@description('HMAC shared secret for service-to-service auth between web/worker apps and the parser worker. Must be a random 32-byte hex string.')
@secure()
param parserWorkerAuthKey string

@description('Object ID of the deploy service principal (CI/CD). When non-empty, grants it Key Vault Secrets User on the DATABASE-URL secret so the deploy-environment.ps1 pre-flight (#410) can read the existing password, detect rotation, and skip unchanged PostgreSQL server updates (avoids ServerIsBusy). Without it the #410 guard cannot read the secret and conservatively forces a server update on every deploy. The deploy SP has User Access Administrator, so it creates this assignment for itself. Set per environment via the DEPLOY_PRINCIPAL_ID variable; empty = skip the grant. See #470.')
param deployPrincipalId string = ''

var envCode = environmentName == 'production' ? 'prd' : 'stg'
var suffix = substring(uniqueString(subscription().subscriptionId, resourceGroup().name), 0, 6)
var appServicePlanName = toLower('${appNamePrefix}-${envCode}-plan-${suffix}')
var webAppName = toLower('${appNamePrefix}-${envCode}-app-${suffix}')
var workerAppName = toLower('${appNamePrefix}-${envCode}-worker-${suffix}')
var parserAppName = toLower('${appNamePrefix}-${envCode}-parser-${suffix}')
var appInsightsName = toLower('${appNamePrefix}-${envCode}-appi-${suffix}')
var logAnalyticsWorkspaceName = toLower('${appNamePrefix}-${envCode}-law-${suffix}')
var observabilityActionGroupName = toLower('${appNamePrefix}-${envCode}-ag-${suffix}')
var postgresServerName = toLower('${appNamePrefix}-${envCode}-pg-${suffix}')
// 600s for all environments. Prod previously had 300s which terminated the container before
// Express bound to the port on cold start (cert update + Prisma migrate + KV ref resolution
// totals 5+ minutes on B1). See #427.
var appServiceStartupTimeLimitSeconds = '600'
var createObservabilityActionGroup = !empty(observabilityAlertEmail)
var createNotificationDeliveryAlert = participantNotificationChannel == 'acs_email' || participantNotificationChannel == 'webhook'
var acsEmailServiceName = toLower('${appNamePrefix}-${envCode}-email-${suffix}')
var acsName = toLower('${appNamePrefix}-${envCode}-acs-${suffix}')
var createAcsEmail = participantNotificationChannel == 'acs_email'
var postgresHost = '${postgresServerName}.postgres.database.azure.com'
var keyVaultName = 'a2-${envCode}-kv-${suffix}'
// #607: the Azure OpenAI account uses a DISTINCT env token (stg / prod) — NOT envCode (stg / prd) —
// plus a -weu region tag, matching the names it was provisioned with before being brought into IaC.
// Reproduces a2-assessment-stg-openai-weu-x6eyx4 (staging) and a2-assessment-prod-openai-weu-hea5kl (prod).
var openAiEnvToken = environmentName == 'production' ? 'prod' : 'stg'
var openAiAccountName = toLower('a2-assessment-${openAiEnvToken}-openai-weu-${suffix}')
var openAiModelDeploymentName = 'a2-assessment-${openAiEnvToken}-${azureOpenAiModelDeploymentShortName}'
// Storage account for course learning-section assets (#483/F4). Storage account names must be
// 3-24 chars, lowercase alphanumeric only (no hyphens), globally unique.
var courseAssetsStorageName = toLower('a2${envCode}assets${suffix}')
var courseAssetsContainerName = 'course-assets'
// connection_limit/pool_timeout: Prisma defaults the pool to (cores*2+1) = 3 on the 1-core B1 app,
// which starved under real concurrent participant load (P2024 "Timed out fetching a connection").
// Set explicitly so web+worker+parser stay well under Postgres max_connections (50): 3 apps × 10 = 30.
var postgresConnectionString = 'postgresql://${uriComponent(postgresAdministratorLogin)}:${uriComponent(postgresAdministratorPassword)}@${postgresHost}:5432/${postgresDatabaseName}?schema=public&sslmode=require&connection_limit=10&pool_timeout=20'
var llmFailureAlertQuery = '''
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(5m)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has '"event":"llm_evaluation_failed"'
'''
var queueBacklogAlertQueryTemplate = '''
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(10m)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has '"event":"assessment_queue_backlog"'
| extend pendingJobs = toint(extract('"pendingJobs":([0-9]+)', 1, raw))
| where isnotnull(pendingJobs)
| summarize maxPendingJobs = max(pendingJobs)
| where maxPendingJobs >= __THRESHOLD__
'''
var queueBacklogAlertQuery = replace(queueBacklogAlertQueryTemplate, '__THRESHOLD__', string(queueBacklogAlertThreshold))
var appealOverdueAlertQueryTemplate = '''
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(10m)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has '"event":"appeal_overdue_detected"'
| extend overdueAppeals = toint(extract('"overdueAppeals":([0-9]+)', 1, raw))
| where isnotnull(overdueAppeals)
| summarize maxOverdueAppeals = max(overdueAppeals)
| where maxOverdueAppeals >= __THRESHOLD__
'''
var appealOverdueAlertQuery = replace(appealOverdueAlertQueryTemplate, '__THRESHOLD__', string(appealOverdueAlertThreshold))
var unhandledRuntimeErrorAlertQueryTemplate = '''
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(5m)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has '"event":"unhandled_error"'
    or raw has '"event":"unhandled_rejection"'
    or raw has '"event":"uncaught_exception"'
| summarize errorCount = count()
| where errorCount >= __THRESHOLD__
'''
var unhandledRuntimeErrorAlertQuery = replace(unhandledRuntimeErrorAlertQueryTemplate, '__THRESHOLD__', string(unhandledRuntimeErrorAlertThreshold))
var notificationFailureAlertQueryTemplate = '''
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(10m)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has '"event":"participant_notification_failed"'
    or raw has '"event":"participant_notification_pipeline_failed"'
    or raw has '"event":"recertification_reminder_failed"'
| summarize failureCount = count()
| where failureCount >= __THRESHOLD__
'''
var notificationFailureAlertQuery = replace(notificationFailureAlertQueryTemplate, '__THRESHOLD__', string(notificationFailureAlertThreshold))

resource acsEmailService 'Microsoft.Communication/emailServices@2023-04-01' = if (createAcsEmail) {
  name: acsEmailServiceName
  location: 'global'
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    dataLocation: 'Europe'
  }
}

resource acsEmailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = if (createAcsEmail) {
  parent: acsEmailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
  }
}

resource acsService 'Microsoft.Communication/communicationServices@2023-04-01' = if (createAcsEmail) {
  name: acsName
  location: 'global'
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    dataLocation: 'Europe'
    linkedDomains: [acsEmailDomain.id]
  }
}

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    IngestionMode: 'LogAnalytics'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: appServiceSkuName
    tier: appServiceSkuName == 'B1' ? 'Basic' : (appServiceSkuName == 'S1' ? 'Standard' : 'PremiumV3')
    capacity: 1
  }
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    reserved: true
    perSiteScaling: false
  }
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = if (!skipPostgresUpdate) {
  name: postgresServerName
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  sku: {
    name: postgresSkuName
    tier: postgresSkuTier
  }
  properties: {
    administratorLogin: postgresAdministratorLogin
    administratorLoginPassword: postgresAdministratorPassword
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    availabilityZone: '1'
    backup: {
      backupRetentionDays: postgresBackupRetentionDays
      geoRedundantBackup: postgresGeoRedundantBackup
    }
    createMode: 'Create'
    highAvailability: {
      mode: postgresHighAvailabilityMode
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: postgresStorageSizeGB
      type: 'Premium_LRS'
    }
    version: postgresVersion
  }
}

// Always-present reference used by child resources and outputs so they work
// regardless of whether skipPostgresUpdate suppressed the server deployment.
resource postgresServerRef 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' existing = {
  name: postgresServerName
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2022-12-01' = if (!skipPostgresUpdate) {
  parent: postgresServerRef
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// @batchSize(1) serialises firewall-rule ARM operations so they don't compete for
// the PostgreSQL control-plane lock. Parallel updates cause one rule to hang
// indefinitely waiting for a lock held by a sibling operation.
@batchSize(1)
resource postgresFirewallRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = [
  for ip in dbAllowedIpAddresses: {
    parent: postgresServerRef
    name: ip.name
    properties: {
      startIpAddress: ip.startIpAddress
      endIpAddress: ip.endIpAddress
    }
  }
]

// ---------------------------------------------------------------------------
// Key Vault — secrets storage (INFRA-002)
// ---------------------------------------------------------------------------

// Only deploy the vault resource when the SP has Owner-level permissions (skipRoleAssignments=false).
// Setting enableRbacAuthorization requires Microsoft.Authorization/roleAssignments/write, which
// Contributor-only SPs (production) do not have. The vault is already correctly configured from
// initial provisioning; secrets are updated via keyVaultRef regardless.
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = if (!skipRoleAssignments) {
  name: keyVaultName
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: environmentName == 'production' ? true : null
    publicNetworkAccess: 'Enabled'
  }
}

// Always-present reference so secrets and outputs resolve regardless of skipRoleAssignments.
resource keyVaultRef 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource kvSecretDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVaultRef
  name: 'DATABASE-URL'
  properties: {
    value: postgresConnectionString
  }
  dependsOn: [keyVault]
}

resource kvSecretOpenAiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(azureOpenAiApiKey)) {
  parent: keyVaultRef
  name: 'AZURE-OPENAI-API-KEY'
  properties: {
    value: azureOpenAiApiKey
  }
  dependsOn: [keyVault]
}

resource kvSecretAcsConnection 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (createAcsEmail) {
  parent: keyVaultRef
  name: 'ACS-CONNECTION-STRING'
  properties: {
    // Resource is the same `if (createAcsEmail)` condition, so non-null assertion is sound.
    value: acsService!.listKeys().primaryConnectionString
  }
  dependsOn: [keyVault]
}

resource kvSecretParserWorkerAuthKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVaultRef
  name: 'PARSER-WORKER-AUTH-KEY'
  properties: {
    value: parserWorkerAuthKey
  }
  dependsOn: [keyVault]
}

resource kvSecretParticipantNotificationWebhookUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(participantNotificationWebhookUrl)) {
  parent: keyVaultRef
  name: 'PARTICIPANT-NOTIFICATION-WEBHOOK-URL'
  properties: {
    value: participantNotificationWebhookUrl
  }
  dependsOn: [keyVault]
}

// Bundled secret: one KV reference resolves all five runtime secrets in a single MSI sidecar
// round-trip on container start, instead of 5 serial round-trips. Saves ~1.5-2.5 min of
// cold-start time on B1 (#431). The env.ts startup parser unpacks this JSON into individual
// process.env vars before zod validation, so the rest of the app sees the same env shape.
var appRuntimeSecretsBundle = string({
  DATABASE_URL: postgresConnectionString
  AZURE_OPENAI_API_KEY: azureOpenAiApiKey
  AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING: createAcsEmail ? acsService!.listKeys().primaryConnectionString : ''
  PARSER_WORKER_AUTH_KEY: parserWorkerAuthKey
  PARTICIPANT_NOTIFICATION_WEBHOOK_URL: participantNotificationWebhookUrl
})

resource kvSecretAppRuntime 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVaultRef
  name: 'APP-RUNTIME-SECRETS'
  properties: {
    value: appRuntimeSecretsBundle
  }
  dependsOn: [keyVault]
}

// Course learning-section assets (#483/F4). Private blob storage; the web app's managed
// identity authenticates via AAD (Storage Blob Data Contributor), so NO account key or SAS
// exists — nothing to rotate or leak (consistent with the KV-RBAC invariants). Assets are
// served through an authenticated app proxy, never via public blob access.
resource courseAssetsStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: courseAssetsStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
}

resource courseAssetsBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: courseAssetsStorage
  name: 'default'
}

// #607: Azure OpenAI account + model deployment, brought into IaC so the TPM capacity is codified
// and reproducible (previously provisioned + capacity-bumped manually via az). The names match the
// already-deployed resources EXACTLY (see openAiAccountName/openAiModelDeploymentName), so an
// Incremental deploy ADOPTS them rather than creating new ones. location/sku/customSubDomain are
// pinned to the live values (westeurope, S0) — ALWAYS verify via what-if before deploying that the
// diff is "Modify/NoChange", never "Create", which would mean a name mismatch.
resource openAiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAiAccountName
  location: 'westeurope'
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: openAiAccountName
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
}

resource openAiModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAiAccount
  name: openAiModelDeploymentName
  sku: {
    name: azureOpenAiDeploymentSkuName
    capacity: azureOpenAiDeploymentCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: azureOpenAiModelName
      version: azureOpenAiModelVersion
    }
    // #607: pin the live content-filter policy and version-upgrade behaviour so adoption does NOT
    // strip them (what-if confirmed both staging and prod currently have exactly these values).
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

resource courseAssetsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: courseAssetsBlobService
  name: courseAssetsContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node scripts/runtime/startup.mjs'
      alwaysOn: true
      healthCheckPath: '/healthz'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
  }
}

// #416: App settings extracted into a separate child resource that depends on the bundled KV
// secret AND the web MSI's read-role assignment, so KV references only resolve after the role
// exists (the May 2026 MSI-sidecar crash root cause). This breaks the dependency cycle —
// webAppRuntimeSecretReader needs webApp.identity.principalId, so webApp itself cannot depend
// on its own role assignment. The settings array is unchanged; toObject() converts it to the
// flat map the config resource requires.
resource webAppSettingsConfig 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: webApp
  name: 'appsettings'
  dependsOn: [
    kvSecretAppRuntime
    webAppRuntimeSecretReader
  ]
  properties: toObject([
        {
          name: 'PROCESS_ROLE'
          value: 'web'
        }
        {
          // Course-asset blob storage (#483/F4). Endpoint only — auth is via MSI
          // (DefaultAzureCredential), so no key/connection-string is stored.
          name: 'COURSE_ASSETS_BLOB_ENDPOINT'
          value: courseAssetsStorage.properties.primaryEndpoints.blob
        }
        {
          name: 'COURSE_ASSETS_CONTAINER'
          value: courseAssetsContainerName
        }
        {
          name: 'SKIP_MIGRATE'
          // Web always runs prisma migrate deploy on startup. Worker keeps SKIP_MIGRATE=true
          // (see worker app definition below) — worker shouldn't run migrations because web
          // already does. This was per-env conditional before, but stage having
          // SKIP_MIGRATE=true meant migrations were only ever tested in prod, which contributed
          // to the 2026-05-21 incident where the #446 drop-column migration silently never ran
          // on stage. Migrations on stage should behave like prod. See v1.1.74 release notes.
          value: 'false'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'PORT'
          value: '8080'
        }
        {
          name: 'WEBSITES_PORT'
          value: '8080'
        }
        {
          name: 'WEBSITE_WARMUP_PATH'
          value: '/healthz'
        }
        {
          name: 'WEBSITES_CONTAINER_START_TIME_LIMIT'
          value: appServiceStartupTimeLimitSeconds
        }
        {
          // Skip Linux App Service base image cert-store rehash on cold start.
          // We use Azure CA-signed endpoints (Postgres, KV, ACS, Graph, OpenAI),
          // which are already in the base node:22-lts image. Saves ~2 min cold start. #430
          name: 'WEBSITES_INCLUDE_CLOUD_CERTS'
          value: 'false'
        }
        {
          // Bundled secrets (#431 Stage 2): single KV ref resolves all 5 sensitive values
          // in one MSI sidecar round-trip on container start, saving ~1.5-2.5 min of cold
          // start vs the previous 5 individual KV refs. env.ts startup parser unpacks the
          // JSON into individual process.env vars before zod validation.
          name: 'APP_RUNTIME_SECRETS'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=APP-RUNTIME-SECRETS)'
        }
        {
          name: 'AUTH_MODE'
          value: authMode
        }
        {
          name: 'ENTRA_TENANT_ID'
          value: entraTenantId
        }
        {
          name: 'ENTRA_CLIENT_ID'
          value: entraClientId
        }
        {
          name: 'ENTRA_AUDIENCE'
          value: entraAudience
        }
        {
          name: 'ENTRA_SYNC_GROUP_ROLES'
          value: string(entraSyncGroupRoles)
        }
        {
          name: 'ENTRA_GROUP_ROLE_MAP_JSON'
          value: entraGroupRoleMapJson
        }
        {
          name: 'LLM_MODE'
          value: llmMode
        }
        {
          name: 'LLM_STUB_MODEL_NAME'
          value: llmStubModelName
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: azureOpenAiEndpoint
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT'
          value: azureOpenAiDeployment
        }
        {
          name: 'AZURE_OPENAI_API_VERSION'
          value: azureOpenAiApiVersion
        }
        {
          name: 'AZURE_OPENAI_TIMEOUT_MS'
          value: string(azureOpenAiTimeoutMs)
        }
        {
          name: 'AZURE_OPENAI_TEMPERATURE'
          value: azureOpenAiTemperature
        }
        {
          name: 'AZURE_OPENAI_MAX_TOKENS'
          value: string(azureOpenAiMaxTokens)
        }
        {
          name: 'AZURE_OPENAI_TOKEN_LIMIT_PARAMETER'
          value: azureOpenAiTokenLimitParameter
        }
        {
          name: 'AZURE_OPENAI_AUTHORING_TOKEN_LIMIT_PARAMETER'
          value: azureOpenAiAuthoringTokenLimitParameter
        }
        {
          name: 'ASSESSMENT_RULES_FILE'
          value: 'config/assessment-rules.json'
        }
        {
          name: 'ASSESSMENT_JOB_POLL_INTERVAL_MS'
          value: string(assessmentJobPollIntervalMs)
        }
        {
          name: 'ASSESSMENT_JOB_MAX_ATTEMPTS'
          value: string(assessmentJobMaxAttempts)
        }
        {
          name: 'APPEAL_SLA_MONITOR_INTERVAL_MS'
          value: string(appealSlaMonitorIntervalMs)
        }
        {
          name: 'APPEAL_OVERDUE_ALERT_THRESHOLD'
          value: string(appealOverdueAlertThreshold)
        }
        {
          name: 'PARTICIPANT_NOTIFICATION_CHANNEL'
          value: participantNotificationChannel
        }
        {
          name: 'PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS'
          value: string(participantNotificationWebhookTimeoutMs)
        }
        {
          name: 'ACS_EMAIL_SENDER'
          value: createAcsEmail ? 'DoNotReply@${acsEmailDomain!.properties.mailFromSenderDomain}' : ''
        }
        {
          name: 'ACS_EMAIL_SENDER_DISPLAY_NAME'
          value: acsEmailSenderDisplayName
        }
        {
          name: 'BOOTSTRAP_SEED'
          value: environmentName == 'production' ? 'false' : 'true'
        }
        {
          name: 'PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK'
          value: 'false'
        }
        {
          name: 'PARSER_WORKER_URL'
          value: 'https://${parserApp.properties.defaultHostName}'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
  ], (entry) => entry.name, (entry) => entry.value)
}

resource webAppDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: '${webAppName}-diagnostics'
  scope: webApp
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logs: [
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

resource workerApp 'Microsoft.Web/sites@2023-12-01' = {
  name: workerAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node scripts/runtime/startup.mjs'
      alwaysOn: true
      // Worker exposes the same /healthz endpoint as web. Without this, Azure can't
      // auto-replace unhealthy instances and worker failures stay invisible until
      // queue depth or job staleness becomes user-facing. (#413)
      healthCheckPath: '/healthz'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
  }
}

// #416: worker app settings extracted to a separate child resource (see webAppSettingsConfig
// for the full rationale — breaks the MSI role-assignment dependency cycle).
resource workerAppSettingsConfig 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: workerApp
  name: 'appsettings'
  dependsOn: [
    kvSecretAppRuntime
    workerAppRuntimeSecretReader
  ]
  properties: toObject([
        {
          name: 'PROCESS_ROLE'
          value: 'worker'
        }
        {
          name: 'SKIP_MIGRATE'
          value: 'true'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'PORT'
          value: '8080'
        }
        {
          name: 'WEBSITES_PORT'
          value: '8080'
        }
        {
          name: 'WEBSITES_CONTAINER_START_TIME_LIMIT'
          value: appServiceStartupTimeLimitSeconds
        }
        {
          // Skip Linux App Service base image cert-store rehash on cold start.
          // We use Azure CA-signed endpoints (Postgres, KV, ACS, Graph, OpenAI),
          // which are already in the base node:22-lts image. Saves ~2 min cold start. #430
          name: 'WEBSITES_INCLUDE_CLOUD_CERTS'
          value: 'false'
        }
        {
          // Bundled secrets (#431) — see web app comment above for rationale.
          name: 'APP_RUNTIME_SECRETS'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=APP-RUNTIME-SECRETS)'
        }
        {
          name: 'AUTH_MODE'
          value: authMode
        }
        {
          name: 'ENTRA_TENANT_ID'
          value: entraTenantId
        }
        {
          name: 'ENTRA_CLIENT_ID'
          value: entraClientId
        }
        {
          name: 'ENTRA_AUDIENCE'
          value: entraAudience
        }
        {
          name: 'LLM_MODE'
          value: llmMode
        }
        {
          name: 'LLM_STUB_MODEL_NAME'
          value: llmStubModelName
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: azureOpenAiEndpoint
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT'
          value: azureOpenAiDeployment
        }
        {
          name: 'AZURE_OPENAI_API_VERSION'
          value: azureOpenAiApiVersion
        }
        {
          name: 'AZURE_OPENAI_TIMEOUT_MS'
          value: string(azureOpenAiTimeoutMs)
        }
        {
          name: 'AZURE_OPENAI_TEMPERATURE'
          value: azureOpenAiTemperature
        }
        {
          name: 'AZURE_OPENAI_MAX_TOKENS'
          value: string(azureOpenAiMaxTokens)
        }
        {
          name: 'AZURE_OPENAI_TOKEN_LIMIT_PARAMETER'
          value: azureOpenAiTokenLimitParameter
        }
        {
          name: 'AZURE_OPENAI_AUTHORING_TOKEN_LIMIT_PARAMETER'
          value: azureOpenAiAuthoringTokenLimitParameter
        }
        {
          name: 'ASSESSMENT_RULES_FILE'
          value: 'config/assessment-rules.json'
        }
        {
          name: 'ASSESSMENT_JOB_POLL_INTERVAL_MS'
          value: string(assessmentJobPollIntervalMs)
        }
        {
          name: 'ASSESSMENT_JOB_MAX_ATTEMPTS'
          value: string(assessmentJobMaxAttempts)
        }
        {
          name: 'APPEAL_SLA_MONITOR_INTERVAL_MS'
          value: string(appealSlaMonitorIntervalMs)
        }
        {
          name: 'APPEAL_OVERDUE_ALERT_THRESHOLD'
          value: string(appealOverdueAlertThreshold)
        }
        {
          name: 'PARTICIPANT_NOTIFICATION_CHANNEL'
          value: participantNotificationChannel
        }
        {
          name: 'PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS'
          value: string(participantNotificationWebhookTimeoutMs)
        }
        {
          name: 'ACS_EMAIL_SENDER'
          value: createAcsEmail ? 'DoNotReply@${acsEmailDomain!.properties.mailFromSenderDomain}' : ''
        }
        {
          name: 'ACS_EMAIL_SENDER_DISPLAY_NAME'
          value: acsEmailSenderDisplayName
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
  ], (entry) => entry.name, (entry) => entry.value)
}

resource workerAppDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: '${workerAppName}-diagnostics'
  scope: workerApp
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logs: [
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Parser worker App Service — no DB or AI secrets (INFRA-341)
// ---------------------------------------------------------------------------

resource parserApp 'Microsoft.Web/sites@2023-12-01' = {
  name: parserAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node scripts/runtime/parserStartup.mjs'
      alwaysOn: true
      healthCheckPath: '/health'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
  }
}

// #416: parser app settings extracted to a separate child resource (see webAppSettingsConfig
// for the full rationale). Parser only references the PARSER-WORKER-AUTH-KEY secret.
resource parserAppSettingsConfig 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: parserApp
  name: 'appsettings'
  dependsOn: [
    kvSecretParserWorkerAuthKey
    parserAppParserAuthSecretReader
  ]
  properties: toObject([
        {
          name: 'APP_ROLE'
          value: 'parser'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'PORT'
          value: '8080'
        }
        {
          name: 'WEBSITES_PORT'
          value: '8080'
        }
        {
          name: 'WEBSITE_WARMUP_PATH'
          value: '/health'
        }
        {
          name: 'WEBSITES_CONTAINER_START_TIME_LIMIT'
          value: appServiceStartupTimeLimitSeconds
        }
        {
          // Skip Linux App Service base image cert-store rehash on cold start.
          // We use Azure CA-signed endpoints (Postgres, KV, ACS, Graph, OpenAI),
          // which are already in the base node:22-lts image. Saves ~2 min cold start. #430
          name: 'WEBSITES_INCLUDE_CLOUD_CERTS'
          value: 'false'
        }
        {
          name: 'PARSER_WORKER_AUTH_KEY'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=PARSER-WORKER-AUTH-KEY)'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
  ], (entry) => entry.name, (entry) => entry.value)
}

resource parserAppDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: '${parserAppName}-diagnostics'
  scope: parserApp
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logs: [
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Key Vault RBAC - secret-scoped read access for managed identities
// ---------------------------------------------------------------------------

var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
// Storage Blob Data Contributor — lets the web app's MSI read/write course-asset blobs (#483/F4).
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

// #470: grant the deploy service principal read on the DATABASE-URL secret so the
// deploy-environment.ps1 pre-flight (#410) can compare the existing password and skip the
// PostgreSQL server update when unchanged (avoids ServerIsBusy on routine deploys). Without
// this the guard gets kvRead=secret-read-failed and conservatively forces the update every
// deploy. The deploy SP has User Access Administrator, so it creates this assignment itself.
// Self-heals: the pre-flight runs before this deploy applies, so the FIRST deploy after this
// change still forces the update; subsequent deploys read and skip. Conditional on a non-empty
// objectId (DEPLOY_PRINCIPAL_ID per environment).
resource deployPrincipalDatabaseSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && !empty(deployPrincipalId)) {
  scope: kvSecretDatabaseUrl
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'deployPrincipal-databaseUrl-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'deployPrincipal-databaseUrl-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: deployPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Role assignments for bundled secret (#431). Web and worker apps need read access to the
// bundled APP-RUNTIME-SECRETS so MSI sidecar can resolve the single KV reference at startup.
resource webAppRuntimeSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: kvSecretAppRuntime
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'webApp-appRuntime-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'webApp-appRuntime-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerAppRuntimeSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: kvSecretAppRuntime
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'workerApp-appRuntime-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'workerApp-appRuntime-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Web app MSI → read/write course-asset blobs (#483/F4). No account key exists
// (allowSharedKeyAccess=false), so this AAD role is the only access path.
resource webAppCourseAssetsContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: courseAssetsStorage
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'webApp-courseAssets-blobContributor') : guid(subscription().subscriptionId, environmentName, 'webApp-courseAssets-blobContributor', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webAppDatabaseSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: kvSecretDatabaseUrl
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'webApp-databaseUrl-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'webApp-databaseUrl-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerAppDatabaseSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: kvSecretDatabaseUrl
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'workerApp-databaseUrl-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'workerApp-databaseUrl-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webAppOpenAiSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && !empty(azureOpenAiApiKey)) {
  scope: kvSecretOpenAiKey
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'webApp-openAiKey-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'webApp-openAiKey-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerAppOpenAiSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && !empty(azureOpenAiApiKey)) {
  scope: kvSecretOpenAiKey
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'workerApp-openAiKey-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'workerApp-openAiKey-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webAppAcsSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && createAcsEmail) {
  scope: kvSecretAcsConnection
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'webApp-acsConnection-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'webApp-acsConnection-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerAppAcsSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && createAcsEmail) {
  scope: kvSecretAcsConnection
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'workerApp-acsConnection-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'workerApp-acsConnection-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webAppNotificationWebhookSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && !empty(participantNotificationWebhookUrl)) {
  scope: kvSecretParticipantNotificationWebhookUrl
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'webApp-notifWebhook-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'webApp-notifWebhook-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerAppNotificationWebhookSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && !empty(participantNotificationWebhookUrl)) {
  scope: kvSecretParticipantNotificationWebhookUrl
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'workerApp-notifWebhook-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'workerApp-notifWebhook-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webAppParserAuthSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: kvSecretParserWorkerAuthKey
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'webApp-parserAuth-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'webApp-parserAuth-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource parserAppParserAuthSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  scope: kvSecretParserWorkerAuthKey
  name: empty(roleAssignmentSalt) ? guid(subscription().subscriptionId, environmentName, 'parserApp-parserAuth-kvSecretsUser') : guid(subscription().subscriptionId, environmentName, 'parserApp-parserAuth-kvSecretsUser', roleAssignmentSalt)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: parserApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource observabilityActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (createObservabilityActionGroup) {
  name: observabilityActionGroupName
  location: 'global'
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    enabled: true
    groupShortName: 'a2obs${envCode}'
    emailReceivers: [
      {
        name: 'primary-email'
        emailAddress: observabilityAlertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource latencyMetricAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: toLower('${appNamePrefix}-${envCode}-latency-${suffix}')
  location: 'global'
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    description: 'Average response time is above threshold.'
    severity: 2
    enabled: true
    scopes: [
      webApp.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'high-latency'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'AverageResponseTime'
          operator: 'GreaterThan'
          threshold: latencyAlertThresholdSeconds
          timeAggregation: 'Average'
        }
      ]
    }
    autoMitigate: true
    actions: createObservabilityActionGroup
      ? [
          {
            actionGroupId: observabilityActionGroup.id
          }
        ]
      : []
  }
}

resource llmFailureAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: toLower('${appNamePrefix}-${envCode}-llmfail-${suffix}')
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    displayName: 'LLM evaluation failures detected'
    description: 'Detects llm_evaluation_failed events from runtime logs.'
    severity: 2
    enabled: true
    scopes: [
      logAnalyticsWorkspace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: llmFailureAlertQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: createObservabilityActionGroup ? [observabilityActionGroup.id] : []
    }
  }
}

resource queueBacklogAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: toLower('${appNamePrefix}-${envCode}-queue-${suffix}')
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    displayName: 'Assessment queue backlog is above threshold'
    description: 'Detects sustained assessment queue backlog from runtime logs.'
    severity: 2
    enabled: true
    scopes: [
      logAnalyticsWorkspace.id
    ]
    evaluationFrequency: 'PT10M'
    windowSize: 'PT10M'
    criteria: {
      allOf: [
        {
          query: queueBacklogAlertQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: createObservabilityActionGroup ? [observabilityActionGroup.id] : []
    }
  }
}

resource appealOverdueAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: toLower('${appNamePrefix}-${envCode}-appeal-${suffix}')
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    displayName: 'Overdue appeals detected'
    description: 'Detects overdue appeals and triggers escalation alerting.'
    severity: 2
    enabled: true
    scopes: [
      logAnalyticsWorkspace.id
    ]
    evaluationFrequency: 'PT10M'
    windowSize: 'PT10M'
    criteria: {
      allOf: [
        {
          query: appealOverdueAlertQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: createObservabilityActionGroup ? [observabilityActionGroup.id] : []
    }
  }
}

resource workerHealthAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: toLower('${appNamePrefix}-${envCode}-worker-health')
  location: 'global'
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    description: 'Worker app health check status indicates an unhealthy worker instance.'
    severity: 1
    enabled: true
    scopes: [
      workerApp.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'worker-health-check-status'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'HealthCheckStatus'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
        }
      ]
    }
    autoMitigate: true
    actions: createObservabilityActionGroup
      ? [
          {
            actionGroupId: observabilityActionGroup.id
          }
        ]
      : []
  }
}

resource unhandledRuntimeErrorAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: toLower('${appNamePrefix}-${envCode}-runtime-errors')
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    displayName: 'Unhandled runtime errors detected'
    description: 'Detects repeated unhandled runtime errors, rejections, or uncaught exceptions from runtime logs.'
    severity: 1
    enabled: true
    scopes: [
      logAnalyticsWorkspace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: unhandledRuntimeErrorAlertQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: createObservabilityActionGroup ? [observabilityActionGroup.id] : []
    }
  }
}

resource notificationFailureAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = if (createNotificationDeliveryAlert) {
  name: toLower('${appNamePrefix}-${envCode}-notification-failures')
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    displayName: 'Participant notification delivery failures detected'
    description: 'Detects participant notification or recertification reminder delivery failures from runtime logs.'
    severity: 2
    enabled: true
    scopes: [
      logAnalyticsWorkspace.id
    ]
    evaluationFrequency: 'PT10M'
    windowSize: 'PT10M'
    criteria: {
      allOf: [
        {
          query: notificationFailureAlertQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: createObservabilityActionGroup ? [observabilityActionGroup.id] : []
    }
  }
}

// #405 part 3 — external availability ping of /healthz. Unlike the internal HealthCheckStatus
// metric alerts (which silence when the App Service resource disappears), this Application Insights
// availability test runs from outside Azure and keeps reporting — so it fires even if the whole
// App Service is deleted (the May 2026 incident scenario). Gated on createObservabilityActionGroup
// so it lands in any environment that has an alert receiver wired (stage included → testable there).
resource healthzAvailabilityTest 'Microsoft.Insights/webtests@2022-06-15' = if (createObservabilityActionGroup) {
  name: toLower('${appNamePrefix}-${envCode}-healthz-ping')
  location: location
  kind: 'standard'
  tags: {
    // REQUIRED association with the App Insights component — without this the portal Availability
    // blade and the metric alert cannot resolve the test.
    'hidden-link:${appInsights.id}': 'Resource'
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    SyntheticMonitorId: toLower('${appNamePrefix}-${envCode}-healthz-ping')
    Name: '${appNamePrefix}-${envCode} /healthz availability'
    Description: 'External ping of /healthz from EMEA — fires even if the App Service is deleted (#405).'
    Enabled: true
    Frequency: 300
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [
      { Id: 'emea-nl-ams-azr' }
      { Id: 'emea-gb-db3-azr' }
    ]
    Request: {
      RequestUrl: 'https://${webApp.properties.defaultHostName}/healthz'
      HttpVerb: 'GET'
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
    }
  }
}

// Fires when both external test locations report /healthz unreachable. failedLocationCount=2 of 2
// avoids single-location flapping while still catching a real outage (app down/deleted → all fail).
resource healthzAvailabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (createObservabilityActionGroup) {
  name: toLower('${appNamePrefix}-${envCode}-healthz-availability')
  location: 'global'
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  properties: {
    description: 'External /healthz availability test is failing — the app is unreachable from outside Azure (fires even if the App Service was deleted). See #405.'
    severity: 1
    enabled: true
    scopes: [
      healthzAvailabilityTest.id
      appInsights.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: healthzAvailabilityTest.id
      componentId: appInsights.id
      failedLocationCount: 2
    }
    actions: [
      {
        actionGroupId: observabilityActionGroup.id
      }
    ]
  }
}

// Production resource group CanNotDelete lock (#405). Blocks all DELETE operations on
// resources in the prod RG. The May 2026 incident where a staging deactivate workflow
// targeted production resources would have been blocked here with a 409 Conflict before
// any damage. Removal requires Owner-level intentional unlock via Azure portal or `az lock delete`.
resource productionResourceGroupLock 'Microsoft.Authorization/locks@2020-05-01' = if (environmentName == 'production') {
  name: 'rg-production-do-not-delete'
  scope: resourceGroup()
  properties: {
    level: 'CanNotDelete'
    notes: 'Production safety lock — remove only for intentional teardown. See #405.'
  }
}

output webAppName string = webApp.name
output workerAppName string = workerApp.name
output parserAppName string = parserApp.name
output appServicePlanName string = appServicePlan.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceName string = logAnalyticsWorkspace.name
output postgresServerName string = postgresServerRef.name
output postgresDatabaseName string = postgresDatabaseName
output keyVaultName string = keyVaultRef.name
