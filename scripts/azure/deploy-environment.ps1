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
  [double]$MonthlyBudgetAmount = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ResourceGroupName) {
  $ResourceGroupName = "rg-a2-assessment-$EnvironmentName"
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
  --query properties.outputs | ConvertFrom-Json
Assert-LastExitCode "az deployment group create"

$webAppName = $deployment.webAppName.value
$workerAppName = $deployment.workerAppName.value
$postgresServerName = $deployment.postgresServerName.value
$postgresDatabaseName = $deployment.postgresDatabaseName.value

if (-not $webAppName) {
  throw "webAppName output missing from deployment."
}
if (-not $workerAppName) {
  throw "workerAppName output missing from deployment."
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
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($tmpRoot, $zipPath)
}

Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $webAppName -ZipPath $zipPath
Invoke-WebAppDeploy -ResourceGroup $ResourceGroupName -AppName $workerAppName -ZipPath $zipPath

function Wait-Healthy {
  param([string]$Url, [string]$Label)
  $maxChecks = 30
  $delaySeconds = 5
  Write-Host "Validating deployment health endpoint: $Url"
  for ($attempt = 1; $attempt -le $maxChecks; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 10
      if ($response.StatusCode -eq 200) {
        Write-Host "$Label health check succeeded on attempt $attempt."
        return
      }
    } catch {
      Write-Host "$Label health check attempt $attempt/$maxChecks failed; retrying..."
    }
    Start-Sleep -Seconds $delaySeconds
  }
  throw "Deployment package published, but health endpoint check failed at $Url."
}

Wait-Healthy -Url "https://$webAppName.azurewebsites.net/healthz" -Label "Web App"
Wait-Healthy -Url "https://$workerAppName.azurewebsites.net/healthz" -Label "Worker App"

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
