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
  [string]$AuthMode = "mock",
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
  [string]$ParserWorkerAuthKey = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ResourceGroupName) {
  $ResourceGroupName = "rg-a2-assessment-$EnvironmentName"
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
    Write-Host "Deploying app package to $AppName (attempt $attempt/$maxAttempts)..."
    az webapp deploy `
      --resource-group $ResourceGroup `
      --name $AppName `
      --src-path $ZipPath `
      --type zip `
      --track-status false `
      --restart true | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $maxAttempts) {
      Write-Host "Deploy attempt $attempt failed (exit $LASTEXITCODE); retrying in ${delaySeconds}s..."
      Start-Sleep -Seconds $delaySeconds
    }
  }
  throw "az webapp deploy to $AppName failed after $maxAttempts attempts."
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
} else {
  Write-Host "NOTE: App Services not yet deployed — dbAllowedIpAddresses will be empty on first deploy."
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

$deploymentName = "a2-assessment-$EnvironmentName-$(Get-Date -Format 'yyyyMMddHHmmss')"

$entraSyncGroupRolesBool = $false
if ($EntraSyncGroupRoles.ToLowerInvariant() -eq "true") {
  $entraSyncGroupRolesBool = $true
}

$deployment = az deployment group create `
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
  --query properties.outputs | ConvertFrom-Json
Assert-LastExitCode "az deployment group create"

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
$tmpRoot = Join-Path $tempBasePath "a2-assessment-deploy-$EnvironmentName"
if (Test-Path $tmpRoot) {
  Remove-Item $tmpRoot -Recurse -Force
}
New-Item -Path $tmpRoot -ItemType Directory | Out-Null

Copy-DeploymentSources -destinationRoot $tmpRoot

Push-Location $tmpRoot
try {
  Write-Host "Building deployment artifact in: $tmpRoot"
  npm ci
  Assert-LastExitCode "npm ci"
  npm run prisma:generate
  Assert-LastExitCode "npm run prisma:generate"
  npm run build
  Assert-LastExitCode "npm run build"
  npm prune --omit=dev
  Assert-LastExitCode "npm prune --omit=dev"
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

# Staging runs web, worker, and parser on the same small App Service plan.
# Deploy the user-facing web app last so the plan can absorb worker/parser churn first.
Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $workerAppName -ZipPath $zipPath
Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $parserAppName -ZipPath $zipPath
Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $webAppName -ZipPath $zipPath

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
  throw "Deployment package published, but health endpoint check failed at $Url.$finalStateSuffix"
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
  $versionResponse = Invoke-RestMethod -Uri "https://$webAppName.azurewebsites.net/version" -TimeoutSec 10
  $deployedVersion = $versionResponse.version
  if ($deployedVersion -ne $packageVersion) {
    Write-Warning "Version mismatch: expected $packageVersion but /version returned '$deployedVersion'. Restarting web app once..."
    az webapp restart --name $webAppName --resource-group $ResourceGroupName | Out-Null
    Start-Sleep -Seconds 30
    $versionResponse = Invoke-RestMethod -Uri "https://$webAppName.azurewebsites.net/version" -TimeoutSec 10
    if ($versionResponse.version -ne $packageVersion) {
      throw "Version still wrong after restart: got '$($versionResponse.version)', expected '$packageVersion'"
    }
    Write-Host "Version confirmed after restart: $($versionResponse.version)"
  } else {
    Write-Host "Version confirmed: $deployedVersion"
  }
} catch [System.Net.WebException] {
  Write-Warning "Could not verify /version endpoint: $($_.Exception.Message). Verify manually."
}

if ($AuthMode -eq "entra" -and $EntraClientId) {
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
