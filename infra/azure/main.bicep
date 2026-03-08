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

@description('Optional email receiver for observability alerts.')
param observabilityAlertEmail string = ''

@description('Pending queue threshold for backlog alert.')
param queueBacklogAlertThreshold int = 5

@description('Average response time threshold in seconds for latency alert.')
param latencyAlertThresholdSeconds int = 3

@description('Overdue appeal count threshold for escalation alert.')
param appealOverdueAlertThreshold int = 1

@description('Appeal SLA monitor interval in milliseconds.')
param appealSlaMonitorIntervalMs int = 600000

var envCode = environmentName == 'production' ? 'prd' : 'stg'
var suffix = substring(uniqueString(subscription().subscriptionId, resourceGroup().name), 0, 6)
var appServicePlanName = toLower('${appNamePrefix}-${envCode}-plan-${suffix}')
var webAppName = toLower('${appNamePrefix}-${envCode}-app-${suffix}')
var appInsightsName = toLower('${appNamePrefix}-${envCode}-appi-${suffix}')
var logAnalyticsWorkspaceName = toLower('${appNamePrefix}-${envCode}-law-${suffix}')
var observabilityActionGroupName = toLower('${appNamePrefix}-${envCode}-ag-${suffix}')
var createObservabilityActionGroup = !empty(observabilityAlertEmail)
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
      appCommandLine: ''
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
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
          name: 'APPEAL_SLA_MONITOR_INTERVAL_MS'
          value: string(appealSlaMonitorIntervalMs)
        }
        {
          name: 'APPEAL_OVERDUE_ALERT_THRESHOLD'
          value: string(appealOverdueAlertThreshold)
        }
        {
          name: 'BOOTSTRAP_SEED'
          value: environmentName == 'production' ? 'false' : 'true'
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

output webAppName string = webApp.name
output appServicePlanName string = appServicePlan.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceName string = logAnalyticsWorkspace.name
