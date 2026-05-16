param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentName,
  [Parameter(Mandatory = $true)]
  [string]$Location,
  [string]$ResourceGroupName = "",
  [string]$AppNamePrefix = "a2-assessment-platform",
  [string]$AppServiceSkuName = "B1",
  [string]$CostCenter = "a2-assessment-platform",
  [string]$Owner = "engineering",
  [string]$PostgresAdministratorLogin = "a2platformadmin",
  [Parameter(Mandatory = $true)]
  [string]$PostgresAdministratorPassword,
  [string]$PostgresDatabaseName = "a2assessment",
  [string]$PostgresVersion = "16",
  [string]$PostgresSkuName = "Standard_B1ms",
  [string]$PostgresSkuTier = "Burstable",
  [int]$PostgresStorageSizeGB = 32,
  [int]$PostgresBackupRetentionDays = 7,
  [string]$PostgresGeoRedundantBackup = "Disabled",
  [string]$PostgresHighAvailabilityMode = "Disabled",
  [string]$AuthMode = "entra",
  [string]$EntraTenantId = "",
  [string]$EntraClientId = "",
  [string]$EntraAudience = "",
  [string]$EntraSyncGroupRoles = "false",
  [string]$EntraGroupRoleMapJson = "{}",
  [string]$LlmMode = "stub",
  [string]$LlmStubModelName = "stub-model-v1",
  [string]$AzureOpenAiEndpoint = "",
  [string]$AzureOpenAiApiKey = "",
  [string]$AzureOpenAiDeployment = "",
  [string]$AzureOpenAiApiVersion = "2024-10-21",
  [int]$AzureOpenAiTimeoutMs = 120000,
  [string]$AzureOpenAiTemperature = "0",
  [int]$AzureOpenAiMaxTokens = 1200,
  [string]$AzureOpenAiTokenLimitParameter = "auto",
  [string]$AzureOpenAiAuthoringTokenLimitParameter = "",
  [string]$SkipRoleAssignments = "false",
  [int]$AssessmentJobPollIntervalMs = 4000,
  [int]$AssessmentJobMaxAttempts = 3,
  [string]$ObservabilityAlertEmail = "",
  [int]$QueueBacklogAlertThreshold = 5,
  [int]$LatencyAlertThresholdSeconds = 3,
  [int]$AppealOverdueAlertThreshold = 1,
  [int]$AppealSlaMonitorIntervalMs = 600000,
  [string]$ParticipantNotificationChannel = "log",
  [string]$ParticipantNotificationWebhookUrl = "",
  [int]$ParticipantNotificationWebhookTimeoutMs = 5000,
  [string]$AcsEmailSenderDisplayName = "A2 Assessment Platform",
  [string]$BudgetContactEmail = "",
  [double]$MonthlyBudgetAmount = 30,
  [string]$ParserWorkerAuthKey = "",
  [string]$PackagePath = "",
  [string]$AzureFederatedClientId = "",
  [string]$AzureFederatedTenantId = "",
  [int]$DeploymentPollIntervalSeconds = 30,
  [string]$BackupVaultResourceGroup = "rg-a2-assessment-backup"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:lastAzureOidcRefreshAt = $null

# INCIDENT 2026-05-15: Windows zip (New-ZipArchiveFromDirectory / .NET ZipArchive) produces a
# package that Azure App Service cannot mount as Run-From-Package. The container starts but
# /home/site/wwwroot contains only hostingstart.html, causing "Application Error" on every request.
# GitHub Actions (Linux) uses `zip -r` which creates a compatible archive.
# => Deployments MUST run on Linux. Block here so the error is caught before the build starts.
if (-not ($IsLinux -or $IsMacOS)) {
  throw "deploy-environment.ps1 must run on Linux (e.g. GitHub Actions). " +
        "Windows builds a .NET ZipArchive that Azure App Service cannot mount as Run-From-Package, " +
        "resulting in an empty wwwroot and 'Application Error' for all users. " +
        "Trigger a deploy via GitHub Actions workflow_dispatch instead."
}

if (-not $ResourceGroupName) {
  $ResourceGroupName = "rg-a2-assessment-$EnvironmentName"
}

if ([string]::IsNullOrWhiteSpace($AuthMode)) {
  $AuthMode = "entra"
}

if (@("staging", "production") -contains $EnvironmentName -and $AuthMode -eq "mock") {
  throw "AUTH_MODE=mock is not allowed for shared Azure environments. Configure Entra settings and deploy with -AuthMode entra."
}

if ($AuthMode -eq "entra" -and ([string]::IsNullOrWhiteSpace($EntraTenantId) -or [string]::IsNullOrWhiteSpace($EntraClientId) -or [string]::IsNullOrWhiteSpace($EntraAudience))) {
  throw "ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_AUDIENCE are required when -AuthMode entra."
}

if (-not $ParserWorkerAuthKey) {
  $randomBytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $ParserWorkerAuthKey = ([System.BitConverter]::ToString($randomBytes)).Replace("-", "").ToLower()
  Write-Host "Generated ParserWorkerAuthKey (store securely for future re-deployments)."
}

function Get-TempBasePath {
  $candidatePaths = @(
    $env:RUNNER_TEMP,
    $env:TEMP,
    $env:TMP,
    $env:TMPDIR
  )

  foreach ($candidate in $candidatePaths) {
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      return $candidate
    }
  }

  $systemTemp = [System.IO.Path]::GetTempPath()
  if (-not [string]::IsNullOrWhiteSpace($systemTemp)) {
    return $systemTemp
  }

  throw "Could not resolve a temporary directory for deployment packaging."
}

function Assert-LastExitCode([string]$stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw "$stepName failed with exit code $LASTEXITCODE."
  }
}

function Refresh-AzureCliOidcLogin([string]$reason = "") {
  if (
    [string]::IsNullOrWhiteSpace($AzureFederatedClientId) -or
    [string]::IsNullOrWhiteSpace($AzureFederatedTenantId) -or
    [string]::IsNullOrWhiteSpace($env:ACTIONS_ID_TOKEN_REQUEST_URL) -or
    [string]::IsNullOrWhiteSpace($env:ACTIONS_ID_TOKEN_REQUEST_TOKEN)
  ) {
    return
  }

  $now = Get-Date
  if ($script:lastAzureOidcRefreshAt -and ($now - $script:lastAzureOidcRefreshAt).TotalSeconds -lt 240) {
    return
  }

  $audience = "api://AzureADTokenExchange"
  $requestUri = "$env:ACTIONS_ID_TOKEN_REQUEST_URL&audience=$([System.Uri]::EscapeDataString($audience))"
  $message = if ($reason) { "Refreshing Azure CLI OIDC login: $reason" } else { "Refreshing Azure CLI OIDC login." }
  Write-Host $message

  $tokenResponse = Invoke-RestMethod `
    -Uri $requestUri `
    -Headers @{ Authorization = "bearer $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN" }

  if ([string]::IsNullOrWhiteSpace($tokenResponse.value)) {
    throw "GitHub OIDC token endpoint returned an empty token."
  }

  az login `
    --service-principal `
    --username $AzureFederatedClientId `
    --tenant $AzureFederatedTenantId `
    --federated-token $tokenResponse.value `
    --allow-no-subscriptions | Out-Null
  Assert-LastExitCode "az login OIDC refresh"

  az account set --subscription $SubscriptionId
  Assert-LastExitCode "az account set after OIDC refresh"
  $script:lastAzureOidcRefreshAt = Get-Date
}

function Wait-GroupDeployment([string]$ResourceGroup, [string]$DeploymentName) {
  $terminalStates = @("Succeeded", "Failed", "Canceled")
  $pollInterval = [Math]::Max(10, $DeploymentPollIntervalSeconds)

  while ($true) {
    Start-Sleep -Seconds $pollInterval
    Refresh-AzureCliOidcLogin "polling ARM deployment $DeploymentName"

    $state = (az deployment group show `
      --resource-group $ResourceGroup `
      --name $DeploymentName `
      --query "properties.provisioningState" `
      -o tsv 2>$null)

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($state)) {
      Write-Host "Deployment $DeploymentName is not readable yet; polling again in ${pollInterval}s."
      continue
    }

    Write-Host "Deployment $DeploymentName provisioningState=$state"
    if ($terminalStates -contains $state) {
      if ($state -ne "Succeeded") {
        Write-Host "Failed deployment operations:"
        az deployment operation group list `
          --resource-group $ResourceGroup `
          --name $DeploymentName `
          --query "[?properties.provisioningState=='Failed'].{operationId:operationId,status:properties.provisioningState,statusMessage:properties.statusMessage}" `
          -o json 2>$null | Write-Host
        throw "ARM deployment $DeploymentName ended with provisioningState=$state."
      }
      return
    }
  }
}

function New-ZipArchiveFromDirectory([string]$sourceDirectory, [string]$zipPath) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $sourceRoot = [System.IO.Path]::GetFullPath($sourceDirectory)
  $directorySeparator = [System.IO.Path]::DirectorySeparatorChar
  if (-not $sourceRoot.EndsWith($directorySeparator)) {
    $sourceRoot = "$sourceRoot$directorySeparator"
  }
  $zipFile = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
  try {
    $archive = New-Object System.IO.Compression.ZipArchive($zipFile, [System.IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      $files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File
      foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($sourceRoot.Length)
        $entryName = $relativePath.Replace([System.IO.Path]::DirectorySeparatorChar, '/').Replace([System.IO.Path]::AltDirectorySeparatorChar, '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    $zipFile.Dispose()
  }
}

function Invoke-WebAppDeploy([string]$ResourceGroup, [string]$AppName, [string]$ZipPath) {
  $maxAttempts = 5
  $delaySeconds = 15
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Refresh-AzureCliOidcLogin "deploying app package to $AppName"
    Write-Host "Deploying app package to $AppName (attempt $attempt/$maxAttempts)..."
    az webapp deploy `
      --resource-group $ResourceGroup `
      --name $AppName `
      --src-path $ZipPath `
      --type zip `
      --track-status false `
      --restart true `
      --timeout 600000 | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $maxAttempts) {
      Write-Host "Deploy attempt $attempt failed (exit $LASTEXITCODE); retrying in ${delaySeconds}s..."
      Start-Sleep -Seconds $delaySeconds
    }
  }
  throw "az webapp deploy to $AppName failed after $maxAttempts attempts."
}

function Restart-WebAppForKeyVaultReferences([string]$ResourceGroup, [string]$AppName) {
  Refresh-AzureCliOidcLogin "restarting $AppName"
  Write-Host "Restarting $AppName to refresh Key Vault references..."
  az webapp restart --resource-group $ResourceGroup --name $AppName | Out-Null
  Assert-LastExitCode "restart $AppName"
}

function Invoke-KeyVaultReferenceRefresh([string]$ResourceGroup, [string]$AppName) {
  $refreshUrl = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName/config/configreferences/appsettings/refresh?api-version=2022-03-01"
  az rest --method POST --url $refreshUrl -o none 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not refresh Key Vault references for $AppName yet; will poll current status."
  }
}

function Get-KeyVaultReferenceStatuses([string]$ResourceGroup, [string]$AppName) {
  $statusUrl = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName/config/configreferences/appsettings?api-version=2022-03-01"
  $statusJson = az rest --method GET --url $statusUrl -o json 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($statusJson)) {
    return @()
  }

  $statusResponse = $statusJson | ConvertFrom-Json
  return @($statusResponse.value |
    Where-Object { $_.properties.reference -like "@Microsoft.KeyVault*" } |
    ForEach-Object {
      [pscustomobject]@{
        AppName = $AppName
        Name = $_.name
        Status = $_.properties.status
        Details = $_.properties.details
      }
    })
}

function Wait-KeyVaultReferencesResolved([string]$ResourceGroup, [string[]]$AppNames, [int]$TimeoutSeconds = 90, [int]$DelaySeconds = 10) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ($true) {
    Refresh-AzureCliOidcLogin "checking Key Vault reference propagation"

    $unresolved = @()
    $checkedCount = 0
    foreach ($appName in $AppNames) {
      Invoke-KeyVaultReferenceRefresh -ResourceGroup $ResourceGroup -AppName $appName
      $references = @(Get-KeyVaultReferenceStatuses -ResourceGroup $ResourceGroup -AppName $appName)
      $checkedCount += $references.Count

      foreach ($reference in $references) {
        if ($reference.Status -ne "Resolved") {
          $suffix = if ($reference.Details) { " - $($reference.Details)" } else { "" }
          $unresolved += "$($reference.AppName)/$($reference.Name)=$($reference.Status)$suffix"
        }
      }
    }

    if ($checkedCount -eq 0) {
      Write-Host "No Key Vault app setting references reported by App Service; continuing without fixed wait."
      return
    }

    if ($unresolved.Count -eq 0) {
      Write-Host "Key Vault references resolved for all apps ($checkedCount references)."
      return
    }

    if ((Get-Date) -ge $deadline) {
      Write-Warning "Timed out waiting for Key Vault references to resolve: $($unresolved -join '; '). Continuing; health checks will validate startup."
      return
    }

    Write-Host "Waiting for Key Vault references to resolve: $($unresolved -join '; ')"
    Start-Sleep -Seconds $DelaySeconds
  }
}

function Copy-DeploymentSources([string]$destinationRoot) {
  $repoRoot = (git rev-parse --show-toplevel).Trim()
  Assert-LastExitCode "git rev-parse --show-toplevel"

  $status = git status --short
  Assert-LastExitCode "git status --short"
  if ($status) {
    Write-Host "Packaging deployment artifact from current working tree (includes uncommitted changes)."
  } else {
    Write-Host "Packaging deployment artifact from clean working tree."
  }

  $files = git ls-files --cached --others --exclude-standard
  Assert-LastExitCode "git ls-files"

  foreach ($relativePath in $files) {
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
      continue
    }

    $sourcePath = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      continue
    }

    $destinationPath = Join-Path $destinationRoot $relativePath
    $destinationDirectory = Split-Path -Path $destinationPath -Parent

    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
      New-Item -Path $destinationDirectory -ItemType Directory -Force | Out-Null
    }

    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  }
}

Write-Host "Deploying environment: $EnvironmentName"
Write-Host "Subscription: $SubscriptionId"
Write-Host "Resource group: $ResourceGroupName"

az account set --subscription $SubscriptionId
Assert-LastExitCode "az account set"

az group create `
  --name $ResourceGroupName `
  --location $Location `
  --tags environment=$EnvironmentName costCenter=$CostCenter owner=$Owner | Out-Null
Assert-LastExitCode "az group create"

# Query App Service outbound IPs for PostgreSQL firewall allowlist (#334)
$envCode = if ($EnvironmentName -eq "production") { "prd" } else { "stg" }
Write-Host "Querying App Service outbound IPs for PostgreSQL firewall allowlist..."

$existingWebApp = (az webapp list -g $ResourceGroupName --query "[?contains(name,'${envCode}-app')].name" -o tsv 2>$null)
$existingWorkerApp = (az webapp list -g $ResourceGroupName --query "[?contains(name,'${envCode}-worker')].name" -o tsv 2>$null)
$existingWebApp = if ($existingWebApp) { ($existingWebApp -split "`n")[0].Trim() } else { "" }
$existingWorkerApp = if ($existingWorkerApp) { ($existingWorkerApp -split "`n")[0].Trim() } else { "" }

$dbAllowedIpAddresses = @()
$skipPostgresUpdate = $false
if ($existingWebApp -and $existingWorkerApp) {
  Write-Host "Found App Services: $existingWebApp, $existingWorkerApp"
  $webIps = (az webapp show -n $existingWebApp -g $ResourceGroupName --query "outboundIpAddresses" -o tsv).Split(",")
  $workerIps = (az webapp show -n $existingWorkerApp -g $ResourceGroupName --query "outboundIpAddresses" -o tsv).Split(",")
  $allIps = ($webIps + $workerIps) | Where-Object { $_ } | Sort-Object -Unique
  $i = 0
  foreach ($ip in $allIps) {
    $dbAllowedIpAddresses += @{ name = "app-outbound-$i"; startIpAddress = $ip; endIpAddress = $ip }
    $i++
  }
  Write-Host "Firewall rules: $i IPs"

  # Pre-flight: skip ARM firewall updates when existing rules already cover the
  # current App Service outbound IPs. Extra manual operator rules are allowed.
  $existingPgServer = (az postgres flexible-server list -g $ResourceGroupName --query "[0].name" -o tsv 2>$null)
  if ($existingPgServer) {
    # Use az rest to avoid az postgres firewall-rule CLI flag churn.
    $existingRulesJson = az rest --method GET `
      --url "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.DBforPostgreSQL/flexibleServers/$existingPgServer/firewallRules?api-version=2022-12-01" `
      -o json 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingRulesJson)) {
      $existingRulesResponse = $existingRulesJson | ConvertFrom-Json
      $existingRuleIps = @($existingRulesResponse.value |
        Where-Object { $_.properties.startIpAddress } |
        ForEach-Object { $_.properties.startIpAddress.Trim() } |
        Where-Object { $_ } |
        Sort-Object -Unique)
      $desiredIps = @($dbAllowedIpAddresses |
        ForEach-Object { $_.startIpAddress.Trim() } |
        Where-Object { $_ } |
        Sort-Object -Unique)
      $missingDesiredIps = @($desiredIps | Where-Object { $existingRuleIps -notcontains $_ })

      if ($missingDesiredIps.Count -eq 0) {
        Write-Host "PostgreSQL firewall rules already cover all $($desiredIps.Count) App Service outbound IPs ($($existingRuleIps.Count) total rules present) - skipping ARM update."
        $dbAllowedIpAddresses = @()
      } else {
        Write-Host "PostgreSQL firewall rules missing IPs ($($missingDesiredIps -join ', ')) - ARM will update them (serialised via @batchSize(1))."
      }
    } else {
      Write-Warning "Could not read existing PostgreSQL firewall rules; ARM will update them (serialised via @batchSize(1))."
    }
  }

  # Pre-flight: skip ARM PostgreSQL server/database update when existing properties
  # already match desired state, to avoid ServerIsBusy control-plane locks.
  $skipPostgresUpdate = $false
  if ($existingPgServer) {
    $pgJson = az rest --method GET `
      --url "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.DBforPostgreSQL/flexibleServers/${existingPgServer}?api-version=2023-12-01-preview" `
      -o json 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($pgJson)) {
      $pg = $pgJson | ConvertFrom-Json
      $skuMatch     = $pg.sku.name -eq $PostgresSkuName -and $pg.sku.tier -eq $PostgresSkuTier
      $versionMatch = $pg.properties.version -eq $PostgresVersion
      $storageMatch = $pg.properties.storage.storageSizeGB -eq [int]$PostgresStorageSizeGB
      $haMatch      = $pg.properties.highAvailability.mode -eq $PostgresHighAvailabilityMode
      $backupMatch  = $pg.properties.backup.backupRetentionDays -eq [int]$PostgresBackupRetentionDays -and
                      $pg.properties.backup.geoRedundantBackup -eq $PostgresGeoRedundantBackup
      if ($skuMatch -and $versionMatch -and $storageMatch -and $haMatch -and $backupMatch) {
        Write-Host "PostgreSQL server properties match desired state - skipping ARM server update."
        $skipPostgresUpdate = $true
      } else {
        Write-Host "PostgreSQL server properties differ from desired state - ARM will update server."
      }
    } else {
      Write-Warning "Could not read PostgreSQL server properties; ARM will update server."
    }
  }
} else {
  Write-Host "NOTE: App Services not yet deployed; dbAllowedIpAddresses will be empty on first deploy."
}

$ipParamsFile = Join-Path (Get-TempBasePath) "a2-ip-params-$EnvironmentName.json"
@{
  '$schema'      = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
  contentVersion = '1.0.0.0'
  parameters     = @{ dbAllowedIpAddresses = @{ value = $dbAllowedIpAddresses } }
} | ConvertTo-Json -Depth 10 | Set-Content -Path $ipParamsFile -Encoding UTF8

if ($ParticipantNotificationChannel -eq "acs_email") {
  Write-Host "Checking Microsoft.Communication provider registration (required for acs_email channel)..."
  $providerState = (az provider show --namespace Microsoft.Communication --query "registrationState" -o tsv 2>$null)
  if ($providerState -eq "Registered") {
    Write-Host "Microsoft.Communication provider is already registered."
  } else {
    Write-Host "Microsoft.Communication provider is not registered (state: $providerState). Attempting registration..."
    az provider register --namespace Microsoft.Communication 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Could not register Microsoft.Communication provider automatically. Register it manually: az provider register --namespace Microsoft.Communication --wait"
    } else {
      Write-Host "Registration initiated. If deploy fails, wait a few minutes for registration to complete and redeploy."
    }
  }
}

# Production: trigger pre-deploy backup on any existing vault before changing infra.
# This is best-effort - a failure here is logged as a warning and does not abort the deploy.
if ($EnvironmentName -eq "production") {
  Write-Host "Checking for existing backup vault in $ResourceGroupName (pre-deploy snapshot)..."
  $preDeployVaultName = (az dataprotection backup-vault list --resource-group $ResourceGroupName --query "[0].name" -o tsv 2>$null)
  if ($preDeployVaultName -and $preDeployVaultName.Trim()) {
    $preDeployVaultName = $preDeployVaultName.Trim()
    $preDeployInstance = (az dataprotection backup-instance list --vault-name $preDeployVaultName --resource-group $ResourceGroupName --query "[0].name" -o tsv 2>$null)
    if ($preDeployInstance -and $preDeployInstance.Trim()) {
      $preDeployInstance = $preDeployInstance.Trim()
      Write-Host "Triggering pre-deploy backup: vault='$preDeployVaultName' instance='$preDeployInstance'..."
      $adhocOut = (az dataprotection backup-instance adhoc-backup `
        --vault-name $preDeployVaultName `
        --resource-group $ResourceGroupName `
        --backup-instance-name $preDeployInstance `
        --rule-name BackupDaily 2>&1)
      if ($LASTEXITCODE -eq 0) {
        Write-Host "Pre-deploy backup triggered successfully (runs asynchronously)."
      } else {
        Write-Warning "Pre-deploy backup trigger failed (non-blocking): $adhocOut"
      }
    } else {
      Write-Host "No backup instances registered in vault '$preDeployVaultName'; skipping pre-deploy snapshot."
    }
  } else {
    Write-Host "No existing backup vault found in $ResourceGroupName; skipping pre-deploy snapshot."
  }
}

$deploymentName = "a2-assessment-$EnvironmentName-$(Get-Date -Format 'yyyyMMddHHmmss')"

$entraSyncGroupRolesBool = $false
if ($EntraSyncGroupRoles.ToLowerInvariant() -eq "true") {
  $entraSyncGroupRolesBool = $true
}

az deployment group create `
  --resource-group $ResourceGroupName `
  --name $deploymentName `
  --template-file infra/azure/main.bicep `
  --parameters environmentName=$EnvironmentName `
              location=$Location `
              appNamePrefix=$AppNamePrefix `
              appServiceSkuName=$AppServiceSkuName `
              costCenter=$CostCenter `
              owner=$Owner `
              postgresAdministratorLogin=$PostgresAdministratorLogin `
              postgresAdministratorPassword=$PostgresAdministratorPassword `
              postgresDatabaseName=$PostgresDatabaseName `
              postgresVersion=$PostgresVersion `
              postgresSkuName=$PostgresSkuName `
              postgresSkuTier=$PostgresSkuTier `
              postgresStorageSizeGB=$PostgresStorageSizeGB `
              postgresBackupRetentionDays=$PostgresBackupRetentionDays `
              postgresGeoRedundantBackup=$PostgresGeoRedundantBackup `
              postgresHighAvailabilityMode=$PostgresHighAvailabilityMode `
              authMode=$AuthMode `
              entraTenantId=$EntraTenantId `
              entraClientId=$EntraClientId `
              entraAudience=$EntraAudience `
              entraSyncGroupRoles=$entraSyncGroupRolesBool `
              entraGroupRoleMapJson=$EntraGroupRoleMapJson `
              llmMode=$LlmMode `
              llmStubModelName=$LlmStubModelName `
              azureOpenAiEndpoint=$AzureOpenAiEndpoint `
              azureOpenAiApiKey=$AzureOpenAiApiKey `
              azureOpenAiDeployment=$AzureOpenAiDeployment `
              azureOpenAiApiVersion=$AzureOpenAiApiVersion `
              azureOpenAiTimeoutMs=$AzureOpenAiTimeoutMs `
              azureOpenAiTemperature=$AzureOpenAiTemperature `
              azureOpenAiMaxTokens=$AzureOpenAiMaxTokens `
              azureOpenAiTokenLimitParameter=$AzureOpenAiTokenLimitParameter `
              azureOpenAiAuthoringTokenLimitParameter=$AzureOpenAiAuthoringTokenLimitParameter `
              skipRoleAssignments=$SkipRoleAssignments `
              skipPostgresUpdate=$skipPostgresUpdate `
              assessmentJobPollIntervalMs=$AssessmentJobPollIntervalMs `
              assessmentJobMaxAttempts=$AssessmentJobMaxAttempts `
              observabilityAlertEmail=$ObservabilityAlertEmail `
              queueBacklogAlertThreshold=$QueueBacklogAlertThreshold `
              latencyAlertThresholdSeconds=$LatencyAlertThresholdSeconds `
              appealOverdueAlertThreshold=$AppealOverdueAlertThreshold `
              appealSlaMonitorIntervalMs=$AppealSlaMonitorIntervalMs `
              participantNotificationChannel=$ParticipantNotificationChannel `
              participantNotificationWebhookUrl=$ParticipantNotificationWebhookUrl `
              participantNotificationWebhookTimeoutMs=$ParticipantNotificationWebhookTimeoutMs `
              acsEmailSenderDisplayName=$AcsEmailSenderDisplayName `
              parserWorkerAuthKey=$ParserWorkerAuthKey `
  --parameters "@$ipParamsFile" `
  --no-wait | Out-Null
Assert-LastExitCode "az deployment group create"

Wait-GroupDeployment $ResourceGroupName $deploymentName
Refresh-AzureCliOidcLogin "reading ARM deployment outputs"

$deployment = az deployment group show `
  --resource-group $ResourceGroupName `
  --name $deploymentName `
  --query properties.outputs | ConvertFrom-Json
Assert-LastExitCode "az deployment group show"

$webAppName = $deployment.webAppName.value
$workerAppName = $deployment.workerAppName.value
$parserAppName = $deployment.parserAppName.value
$postgresServerName = $deployment.postgresServerName.value
$postgresDatabaseName = $deployment.postgresDatabaseName.value

if (-not $webAppName) {
  throw "webAppName output missing from deployment."
}
if (-not $workerAppName) {
  throw "workerAppName output missing from deployment."
}
if (-not $parserAppName) {
  throw "parserAppName output missing from deployment."
}

$tempBasePath = Get-TempBasePath
if ($PackagePath) {
  $zipPath = [System.IO.Path]::GetFullPath($PackagePath)
  if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
    throw "PackagePath does not exist: $zipPath"
  }
  Write-Host "Using prebuilt deployment package: $zipPath"
} else {
  $tmpRoot = Join-Path $tempBasePath "a2-assessment-deploy-$EnvironmentName"
  if (Test-Path $tmpRoot) {
    Remove-Item $tmpRoot -Recurse -Force
  }
  New-Item -Path $tmpRoot -ItemType Directory | Out-Null

  Copy-DeploymentSources -destinationRoot $tmpRoot

  Push-Location $tmpRoot
  try {
    Write-Host "Building deployment artifact in: $tmpRoot"
    npm ci --ignore-scripts
    Assert-LastExitCode "npm ci --ignore-scripts"
    npm run prisma:generate
    Assert-LastExitCode "npm run prisma:generate"
    npm run build
    Assert-LastExitCode "npm run build"
    npm prune --omit=dev --ignore-scripts
    Assert-LastExitCode "npm prune --omit=dev --ignore-scripts"
  } finally {
    Pop-Location
  }

  $zipPath = Join-Path $tempBasePath "a2-assessment-$EnvironmentName.zip"
  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }

  if ($IsLinux -or $IsMacOS) {
    Push-Location $tmpRoot
    try {
      zip -r -q $zipPath .
      Assert-LastExitCode "zip package"
    } finally {
      Pop-Location
    }
  } else {
    New-ZipArchiveFromDirectory -sourceDirectory $tmpRoot -zipPath $zipPath
  }
}

Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $workerAppName -ZipPath $zipPath
Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $parserAppName -ZipPath $zipPath
Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $webAppName -ZipPath $zipPath

# Key Vault RBAC role assignments for managed identities can take 30-120 s to
# propagate. Keep App Service settings as Key Vault references and refresh the
# apps after propagation instead of writing raw secret values into app settings.
Write-Host "Waiting for Key Vault RBAC propagation before refreshing app runtimes..."
Wait-KeyVaultReferencesResolved -ResourceGroup $ResourceGroupName -AppNames @($workerAppName, $parserAppName, $webAppName)
Restart-WebAppForKeyVaultReferences -ResourceGroup $ResourceGroupName -AppName $workerAppName
Restart-WebAppForKeyVaultReferences -ResourceGroup $ResourceGroupName -AppName $parserAppName
Restart-WebAppForKeyVaultReferences -ResourceGroup $ResourceGroupName -AppName $webAppName

function Get-WebAppState {
  param([string]$ResourceGroup, [string]$AppName)
  try {
    $state = (az webapp show --resource-group $ResourceGroup --name $AppName --query "state" -o tsv 2>$null).Trim()
    if ($LASTEXITCODE -eq 0) {
      return $state
    }
  } catch {
    # Best-effort diagnostics only.
  }
  return ""
}

function Test-HealthEndpoint {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 10
    return @{
      Success = ($response.StatusCode -eq 200)
      StatusCode = $response.StatusCode
      Error = ""
    }
  } catch {
    $statusCode = ""
    try {
      $statusCode = [int]$_.Exception.Response.StatusCode
    } catch {
      $statusCode = ""
    }
    return @{
      Success = $false
      StatusCode = $statusCode
      Error = $_.Exception.Message
    }
  }
}

function Wait-Healthy {
  param(
    [string]$Url,
    [string]$Label,
    [string]$AppName,
    [string]$ResourceGroup
  )

  $phases = @(
    @{ Name = "initial"; MaxChecks = 30; DelaySeconds = 5 },
    @{ Name = "extended"; MaxChecks = 24; DelaySeconds = 10 }
  )

  Write-Host "Validating deployment health endpoint: $Url"
  foreach ($phase in $phases) {
    for ($attempt = 1; $attempt -le $phase.MaxChecks; $attempt++) {
      $result = Test-HealthEndpoint -Url $Url
      if ($result.Success) {
        Write-Host "$Label health check succeeded during $($phase.Name) validation on attempt $attempt."
        return
      }

      $statusSuffix = if ($result.StatusCode) { " (status $($result.StatusCode))" } else { "" }
      if ($attempt -eq $phase.MaxChecks -and $phase.Name -eq "initial") {
        $appState = Get-WebAppState -ResourceGroup $ResourceGroup -AppName $AppName
        if ($appState) {
          Write-Warning "$Label did not respond healthy during initial validation$statusSuffix. App Service state is '$appState'. Entering extended recovery window."
        } else {
          Write-Warning "$Label did not respond healthy during initial validation$statusSuffix. Entering extended recovery window."
        }
      } else {
        Write-Host "$Label health check attempt $attempt/$($phase.MaxChecks) in $($phase.Name) validation failed$statusSuffix; retrying..."
      }
      Start-Sleep -Seconds $phase.DelaySeconds
    }
  }

  $finalState = Get-WebAppState -ResourceGroup $ResourceGroup -AppName $AppName
  $finalStateSuffix = if ($finalState) { " Final App Service state: '$finalState'." } else { "" }
  throw "Deployment package published, but health endpoint check failed at ${Url}${finalStateSuffix}"
}

function Wait-Stable {
  param(
    [string]$Url,
    [string]$Label,
    [int]$RequiredSuccesses = 6,
    [int]$DelaySeconds = 10
  )

  Write-Host "Confirming $Label remains healthy after deployment..."
  for ($attempt = 1; $attempt -le $RequiredSuccesses; $attempt++) {
    $result = Test-HealthEndpoint -Url $Url
    if (-not $result.Success) {
      $statusSuffix = if ($result.StatusCode) { " (status $($result.StatusCode))" } else { "" }
      throw "$Label became unhealthy during post-deploy stability validation$statusSuffix at $Url"
    }

    Write-Host "$Label stability check $attempt/$RequiredSuccesses succeeded."
    if ($attempt -lt $RequiredSuccesses) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

# App Service has occasionally reported a healthy /healthz immediately after zip deploy while still
# serving the previous package/version for a short period. We always verify /version to confirm
# the new package is live, and restart once if it isn't.
Wait-Healthy -Url "https://$webAppName.azurewebsites.net/healthz" -Label "Web App" -AppName $webAppName -ResourceGroup $ResourceGroupName
Wait-Healthy -Url "https://$workerAppName.azurewebsites.net/healthz" -Label "Worker App" -AppName $workerAppName -ResourceGroup $ResourceGroupName
Wait-Healthy -Url "https://$parserAppName.azurewebsites.net/health" -Label "Parser App" -AppName $parserAppName -ResourceGroup $ResourceGroupName
Wait-Stable -Url "https://$webAppName.azurewebsites.net/healthz" -Label "Web App"

$packageVersion = (Get-Content (Join-Path $PSScriptRoot '..\..\package.json') | ConvertFrom-Json).version
Write-Host "Verifying deployed version is $packageVersion..."
try {
  $versionResponse = Invoke-RestMethod -Uri "https://$webAppName.azurewebsites.net/version" -TimeoutSec 20
  $deployedVersion = $versionResponse.version
  if ($deployedVersion -ne $packageVersion) {
    Write-Warning "Version mismatch: expected $packageVersion but /version returned '$deployedVersion'. Restarting web app once..."
    az webapp restart --name $webAppName --resource-group $ResourceGroupName | Out-Null
    Start-Sleep -Seconds 75
    try {
      $versionResponse = Invoke-RestMethod -Uri "https://$webAppName.azurewebsites.net/version" -TimeoutSec 30
      if ($versionResponse.version -ne $packageVersion) {
        Write-Warning "Version still '$($versionResponse.version)' after restart (expected '$packageVersion'). App is healthy; verify /version manually."
      } else {
        Write-Host "Version confirmed after restart: $($versionResponse.version)"
      }
    } catch {
      Write-Warning "Could not reach /version after restart: $($_.Exception.Message). App passed health checks; verify /version manually."
    }
  } else {
    Write-Host "Version confirmed: $deployedVersion"
  }
} catch {
  Write-Warning "Could not verify /version endpoint: $($_.Exception.Message). Verify manually."
}

if ($AuthMode -eq "entra" -and $EntraClientId) {
  Refresh-AzureCliOidcLogin "updating Entra SPA redirect URI"
  $spaRedirectUri = "https://$webAppName.azurewebsites.net/admin-content"
  Write-Host "Updating SPA redirect URI on Entra app registration $EntraClientId to: $spaRedirectUri"
  try {
    $appObjectId = (az ad app show --id $EntraClientId --query id -o tsv 2>&1).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $appObjectId) {
      Write-Warning "Could not resolve app object ID for $EntraClientId (exit $LASTEXITCODE). Configure SPA redirect URI manually in the Azure portal."
    } else {
      $body = '{"spa":{"redirectUris":["' + $spaRedirectUri + '"]}}'
      $result = az rest --method PATCH `
        --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
        --headers "Content-Type=application/json" `
        --body $body 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Host "SPA redirect URI updated."
      } else {
        Write-Warning "Could not update SPA redirect URI automatically (exit $LASTEXITCODE): $result. Configure manually in Azure portal."
      }
    }
  } catch {
    Write-Warning "Could not update SPA redirect URI automatically: $($_.Exception.Message). Configure manually in Azure portal."
  }
}

# Production: ensure backup vault exists in isolated resource group that survives
# teardown of the main application resource group.
if ($EnvironmentName -eq "production") {
  Refresh-AzureCliOidcLogin "deploying backup vault"
  Write-Host "Ensuring backup vault resource group '$BackupVaultResourceGroup' exists..."
  az group create `
    --name $BackupVaultResourceGroup `
    --location $Location `
    --tags environment=$EnvironmentName costCenter=$CostCenter owner=$Owner | Out-Null
  Assert-LastExitCode "az group create (backup vault RG)"

  $pgSuffix = ($postgresServerName -split "-")[-1]
  Write-Host "Deploying backup vault (suffix=$pgSuffix) to $BackupVaultResourceGroup..."
  $vaultDeployName = "a2-backup-vault-$EnvironmentName-$(Get-Date -Format 'yyyyMMddHHmmss')"
  az deployment group create `
    --resource-group $BackupVaultResourceGroup `
    --name $vaultDeployName `
    --template-file "$PSScriptRoot/../../infra/azure/backup-vault.bicep" `
    --parameters environmentName=$EnvironmentName suffix=$pgSuffix location=$Location costCenter=$CostCenter owner=$Owner | Out-Null
  Assert-LastExitCode "backup vault deployment"

  $vaultDeployment = az deployment group show `
    --resource-group $BackupVaultResourceGroup `
    --name $vaultDeployName `
    --query properties.outputs | ConvertFrom-Json
  Assert-LastExitCode "az deployment group show (backup vault)"

  $backupVaultName = $vaultDeployment.vaultName.value
  $vaultPrincipalId = $vaultDeployment.vaultPrincipalId.value
  $backupPolicyId = $vaultDeployment.policyId.value

  $pgServerId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.DBforPostgreSQL/flexibleServers/$postgresServerName"
  Write-Host "Assigning backup roles to vault MSI $vaultPrincipalId on $postgresServerName..."
  # Role assignments are idempotent; suppress "already exists" warnings.
  az role assignment create --role "Reader" --assignee $vaultPrincipalId --scope $pgServerId 2>&1 | Out-Null
  az role assignment create `
    --role "PostgreSQL Flexible Server Long Term Retention Backup Role" `
    --assignee $vaultPrincipalId `
    --scope $pgServerId 2>&1 | Out-Null
  Write-Host "Backup role assignments applied."

  $existingBkpInstance = (az dataprotection backup-instance list `
    --vault-name $backupVaultName `
    --resource-group $BackupVaultResourceGroup `
    --query "[?properties.dataSourceInfo.resourceName=='$postgresServerName'].name" `
    -o tsv 2>$null)
  if (-not ($existingBkpInstance -and $existingBkpInstance.Trim())) {
    Write-Host "Registering PostgreSQL server '$postgresServerName' as backup instance in vault '$backupVaultName'..."
    $instanceJson = @{
      properties = @{
        dataSourceInfo = @{
          datasourceType   = "Microsoft.DBforPostgreSQL/flexibleServers"
          objectType       = "Datasource"
          resourceID       = $pgServerId
          resourceLocation = $Location
          resourceName     = $postgresServerName
          resourceType     = "Microsoft.DBforPostgreSQL/flexibleServers"
          resourceUri      = ""
        }
        policyInfo = @{ policyId = $backupPolicyId }
        objectType = "BackupInstance"
      }
    } | ConvertTo-Json -Depth 10
    $instanceJsonPath = Join-Path (Get-TempBasePath) "a2-backup-instance-$EnvironmentName.json"
    [System.IO.File]::WriteAllText($instanceJsonPath, $instanceJson, [System.Text.Encoding]::UTF8)
    az dataprotection backup-instance create `
      --vault-name $backupVaultName `
      --resource-group $BackupVaultResourceGroup `
      --backup-instance "@$instanceJsonPath" 2>&1 | Write-Host
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Backup instance registered."
    } else {
      Write-Warning "Backup instance registration failed - run az dataprotection backup-instance create manually. See doc/PRODUCTION_RESTORE_RUNBOOK.md."
    }
  } else {
    Write-Host "Backup instance already registered: $($existingBkpInstance.Trim())"
  }
}

if ($BudgetContactEmail) {
  & "$PSScriptRoot/configure-cost-guardrails.ps1" `
    -SubscriptionId $SubscriptionId `
    -EnvironmentName $EnvironmentName `
    -MonthlyBudgetAmount $MonthlyBudgetAmount `
    -BudgetContactEmail $BudgetContactEmail
}

Write-Host "Deployment complete."
Write-Host "Web App URL: https://$webAppName.azurewebsites.net"
Write-Host "Worker App URL: https://$workerAppName.azurewebsites.net"
Write-Host "PostgreSQL server: $postgresServerName"
Write-Host "PostgreSQL database: $postgresDatabaseName"

if ($env:GITHUB_OUTPUT) {
  Add-Content -Path $env:GITHUB_OUTPUT -Value "web_app_name=$webAppName"
  Add-Content -Path $env:GITHUB_OUTPUT -Value "web_app_url=https://$webAppName.azurewebsites.net"
  Add-Content -Path $env:GITHUB_OUTPUT -Value "resource_group=$ResourceGroupName"
  Add-Content -Path $env:GITHUB_OUTPUT -Value "postgres_server_name=$postgresServerName"
  Add-Content -Path $env:GITHUB_OUTPUT -Value "postgres_database_name=$postgresDatabaseName"
}

exit 0
