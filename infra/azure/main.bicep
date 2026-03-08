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

@description('Auth mode for runtime.')
@allowed([
  'mock'
  'entra'
])
param authMode string = 'mock'

@description('Entra tenant id when authMode=entra.')
param entraTenantId string = ''

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

@description('Assessment worker polling interval in milliseconds.')
param assessmentJobPollIntervalMs int = 4000

@description('Assessment worker max attempts.')
param assessmentJobMaxAttempts int = 3

var envCode = environmentName == 'production' ? 'prd' : 'stg'
var suffix = substring(uniqueString(subscription().subscriptionId, resourceGroup().name), 0, 6)
var appServicePlanName = toLower('${appNamePrefix}-${envCode}-plan-${suffix}')
var webAppName = toLower('${appNamePrefix}-${envCode}-app-${suffix}')
var appInsightsName = toLower('${appNamePrefix}-${envCode}-appi-${suffix}')

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
    WorkspaceResourceId: null
    IngestionMode: 'ApplicationInsights'
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

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
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
      alwaysOn: false
      appCommandLine: 'npm run db:migrate:runtime && npm run start'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'NODE_ENV'
          value: environmentName == 'production' ? 'production' : 'development'
        }
        {
          name: 'DATABASE_URL'
          value: 'file:/home/site/data/app.db'
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
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
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

output webAppName string = webApp.name
output appServicePlanName string = appServicePlan.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString

