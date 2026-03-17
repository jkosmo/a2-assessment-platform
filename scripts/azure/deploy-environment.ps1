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

if (-not $webAppName) {
  throw "webAppName output missing from deployment."
}

$tempBasePath = Get-TempBasePath
$tmpRoot = Join-Path $tempBasePath "a2-assessment-deploy-$EnvironmentName"
if (Test-Path $tmpRoot) {
  Remove-Item $tmpRoot -Recurse -Force
}
New-Item -Path $tmpRoot -ItemType Directory | Out-Null

git archive --format=tar HEAD | tar -xf - -C $tmpRoot
Assert-LastExitCode "git archive + tar extract"

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

Write-Host "Deploying app package to Web App: $webAppName"
az webapp deploy `
  --resource-group $ResourceGroupName `
  --name $webAppName `
  --src-path $zipPath `
  --type zip `
  --track-status false `
  --restart true | Out-Null
Assert-LastExitCode "az webapp deploy"

$healthUrl = "https://$webAppName.azurewebsites.net/healthz"
$maxHealthChecks = 30
$healthCheckDelaySeconds = 5
$healthy = $false

Write-Host "Validating deployment health endpoint: $healthUrl"
for ($attempt = 1; $attempt -le $maxHealthChecks; $attempt++) {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -Method Get -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
      Write-Host "Health check succeeded on attempt $attempt."
      $healthy = $true
      break
    }
  } catch {
    Write-Host "Health check attempt $attempt/$maxHealthChecks failed; retrying..."
  }
  Start-Sleep -Seconds $healthCheckDelaySeconds
}

if (-not $healthy) {
  throw "Deployment package published, but health endpoint check failed at $healthUrl."
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

if ($env:GITHUB_OUTPUT) {
  Add-Content -Path $env:GITHUB_OUTPUT -Value "web_app_name=$webAppName"
  Add-Content -Path $env:GITHUB_OUTPUT -Value "web_app_url=https://$webAppName.azurewebsites.net"
  Add-Content -Path $env:GITHUB_OUTPUT -Value "resource_group=$ResourceGroupName"
}
