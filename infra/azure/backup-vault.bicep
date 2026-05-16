@description('Deployment environment name (staging or production).')
param environmentName string

@description('Deployment location.')
param location string = resourceGroup().location

@description('Global app name prefix. Must be lowercase alphanumeric and hyphen.')
param appNamePrefix string = 'a2-assessment-platform'

@description('Cost center tag value.')
param costCenter string = 'a2-assessment-platform'

@description('Deployment owner tag value.')
param owner string = 'engineering'

@description('6-character suffix matching the application resource group naming suffix (from uniqueString).')
param suffix string

var envCode = environmentName == 'production' ? 'prd' : 'stg'
var vaultName = toLower('${appNamePrefix}-${envCode}-bkv-${suffix}')

resource backupVault 'Microsoft.DataProtection/backupVaults@2023-12-01' = {
  name: vaultName
  location: location
  tags: {
    environment: environmentName
    costCenter: costCenter
    owner: owner
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    storageSettings: [
      {
        datastoreType: 'VaultStore'
        type: 'LocallyRedundant'
      }
    ]
    securitySettings: {
      softDeleteSettings: {
        state: 'AlwaysOn'
        retentionDurationInDays: 14
      }
    }
  }
}

resource backupPolicy 'Microsoft.DataProtection/backupVaults/backupPolicies@2023-12-01' = {
  parent: backupVault
  name: 'daily-pg-policy'
  properties: {
    policyRules: [
      {
        name: 'BackupDaily'
        objectType: 'AzureBackupRule'
        backupParameters: {
          backupType: 'Full'
          objectType: 'AzureBackupParams'
        }
        dataStore: {
          dataStoreType: 'VaultStore'
          objectType: 'DataStoreInfoBase'
        }
        trigger: {
          objectType: 'ScheduleBasedTriggerContext'
          schedule: {
            repeatingTimeIntervals: [
              'R/2021-08-15T02:00:00+00:00/P1D'
            ]
            timeZone: 'UTC'
          }
          taggingCriteria: [
            {
              isDefault: true
              tagInfo: {
                id: 'Default_'
                tagName: 'Default'
              }
              taggingPriority: 99
            }
          ]
        }
      }
      {
        name: 'Default'
        objectType: 'AzureRetentionRule'
        isDefault: true
        lifecycles: [
          {
            deleteAfter: {
              duration: 'P3M'
              objectType: 'AbsoluteDeleteOption'
            }
            sourceDataStore: {
              dataStoreType: 'VaultStore'
              objectType: 'DataStoreInfoBase'
            }
            targetDataStoreCopySettings: []
          }
        ]
      }
    ]
    datasourceTypes: [
      'Microsoft.DBforPostgreSQL/flexibleServers'
    ]
    objectType: 'BackupPolicy'
  }
}

output vaultName string = backupVault.name
output vaultPrincipalId string = backupVault.identity.principalId
output policyId string = backupPolicy.id
