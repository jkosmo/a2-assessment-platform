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
param authMode string = 'mock'

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
var appServiceStartupTimeLimitSeconds = environmentName == 'production' ? '300' : '600'
var createObservabilityActionGroup = !empty(observabilityAlertEmail)
var createNotificationDeliveryAlert = participantNotificationChannel == 'acs_email' || participantNotificationChannel == 'webhook'
var acsEmailServiceName = toLower('${appNamePrefix}-${envCode}-email-${suffix}')
var acsName = toLower('${appNamePrefix}-${envCode}-acs-${suffix}')
var createAcsEmail = participantNotificationChannel == 'acs_email'
var postgresHost = '${postgresServerName}.postgres.database.azure.com'
var keyVaultName = 'a2-${envCode}-kv-${suffix}'
var postgresConnectionString = 'postgresql://${uriComponent(postgresAdministratorLogin)}:${uriComponent(postgresAdministratorPassword)}@${postgresHost}:5432/${postgresDatabaseName}?schema=public&sslmode=require'
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

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
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

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2022-12-01' = {
  parent: postgresServer
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresFirewallRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = [
  for ip in dbAllowedIpAddresses: {
    parent: postgresServer
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

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
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
    enableRbacAuthorization: false
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

resource kvSecretDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'DATABASE-URL'
  properties: {
    value: postgresConnectionString
  }
}

resource kvSecretOpenAiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(azureOpenAiApiKey)) {
  parent: keyVault
  name: 'AZURE-OPENAI-API-KEY'
  properties: {
    value: azureOpenAiApiKey
  }
}

resource kvSecretAcsConnection 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (createAcsEmail) {
  parent: keyVault
  name: 'ACS-CONNECTION-STRING'
  properties: {
    value: acsService.listKeys().primaryConnectionString
  }
}

resource kvSecretParserWorkerAuthKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'PARSER-WORKER-AUTH-KEY'
  properties: {
    value: parserWorkerAuthKey
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
      appSettings: [
        {
          name: 'PROCESS_ROLE'
          value: 'web'
        }
        {
          name: 'SKIP_MIGRATE'
          value: environmentName == 'production' ? 'false' : 'true'
        }
        {
          name: 'NODE_ENV'
          value: environmentName == 'production' ? 'production' : 'development'
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
          name: 'DATABASE_URL'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=DATABASE-URL)'
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
          name: 'AZURE_OPENAI_API_KEY'
          value: !empty(azureOpenAiApiKey) ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=AZURE-OPENAI-API-KEY)' : ''
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
          name: 'PARTICIPANT_NOTIFICATION_WEBHOOK_URL'
          value: participantNotificationWebhookUrl
        }
        {
          name: 'PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS'
          value: string(participantNotificationWebhookTimeoutMs)
        }
        {
          name: 'AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING'
          value: createAcsEmail ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=ACS-CONNECTION-STRING)' : ''
        }
        {
          name: 'ACS_EMAIL_SENDER'
          value: createAcsEmail ? 'DoNotReply@${acsEmailDomain.properties.mailFromSenderDomain}' : ''
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
      ]
    }
  }
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
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
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
          value: environmentName == 'production' ? 'production' : 'development'
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
          name: 'DATABASE_URL'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=DATABASE-URL)'
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
          name: 'AZURE_OPENAI_API_KEY'
          value: !empty(azureOpenAiApiKey) ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=AZURE-OPENAI-API-KEY)' : ''
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
          name: 'PARTICIPANT_NOTIFICATION_WEBHOOK_URL'
          value: participantNotificationWebhookUrl
        }
        {
          name: 'PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS'
          value: string(participantNotificationWebhookTimeoutMs)
        }
        {
          name: 'AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING'
          value: createAcsEmail ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=ACS-CONNECTION-STRING)' : ''
        }
        {
          name: 'ACS_EMAIL_SENDER'
          value: createAcsEmail ? 'DoNotReply@${acsEmailDomain.properties.mailFromSenderDomain}' : ''
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
      ]
    }
  }
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
      appSettings: [
        {
          name: 'APP_ROLE'
          value: 'parser'
        }
        {
          name: 'NODE_ENV'
          value: environmentName == 'production' ? 'production' : 'development'
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
      ]
    }
  }
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
// Key Vault RBAC — Key Vault Secrets User for both app identities (INFRA-002)
// ---------------------------------------------------------------------------

// Access policies grant managed identities read access to Key Vault secrets.
// Uses access policy mode (not RBAC) so the deploy SP only needs Contributor — no User Access Administrator required.
resource kvAccessPolicies 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  parent: keyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: tenant().tenantId
        objectId: webApp.identity.principalId
        permissions: { secrets: ['get'] }
      }
      {
        tenantId: tenant().tenantId
        objectId: workerApp.identity.principalId
        permissions: { secrets: ['get'] }
      }
      {
        tenantId: tenant().tenantId
        objectId: parserApp.identity.principalId
        permissions: { secrets: ['get'] }
      }
    ]
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

output webAppName string = webApp.name
output workerAppName string = workerApp.name
output parserAppName string = parserApp.name
output appServicePlanName string = appServicePlan.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceName string = logAnalyticsWorkspace.name
output postgresServerName string = postgresServer.name
output postgresDatabaseName string = postgresDatabase.name
output keyVaultName string = keyVault.name
