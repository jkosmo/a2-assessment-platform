param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentName,
  [string]$ResourceGroupName = "",
  [bool]$DisableAlerts = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-LastExitCode([string]$stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw "$stepName failed with exit code $LASTEXITCODE."
  }
}

function Wait-ResourceDeleted([string]$resourceId, [string]$label) {
  $maxChecks = 24
  for ($attempt = 1; $attempt -le $maxChecks; $attempt++) {
    $resourceExists = $true
    try {
      az resource show --ids $resourceId --output none 2>$null | Out-Null
      $resourceExists = ($LASTEXITCODE -eq 0)
    } catch {
      $resourceExists = $false
    }

    if (-not $resourceExists) {
      Write-Host "$label is deleted."
      return
    }

    Write-Host "Waiting for $label deletion to finish ($attempt/$maxChecks)..."
    Start-Sleep -Seconds 5
  }

  throw "$label still exists after waiting for deletion to complete."
}

function Invoke-AzResourceUpdateBestEffort([string]$resourceId, [string]$label) {
  $escapedResourceId = $resourceId.Replace('"', '\"')
  $command = "az resource update --ids ""$escapedResourceId"" --set properties.enabled=false --output none"
  $result = cmd /d /c $command 2>&1
  if ($LASTEXITCODE -eq 0) {
    return
  }

  $message = ($result | Out-String)
  if ($message -like "*ResourceNotFound*") {
    Write-Warning "$label could not be updated because its scoped resource is already gone. Continuing."
    return
  }

  throw "az resource update $label failed: $message"
}

if ($EnvironmentName -ne "staging") {
  throw "deactivate-app-layer.ps1 only supports the staging environment."
}

if (-not $ResourceGroupName) {
  $ResourceGroupName = "rg-a2-assessment-$EnvironmentName"
}

Write-Host "Deactivating app layer for environment: $EnvironmentName"
Write-Host "Subscription: $SubscriptionId"
Write-Host "Resource group: $ResourceGroupName"

az account set --subscription $SubscriptionId
Assert-LastExitCode "az account set"

# Safety guards (#414) — refuse to act if the current Azure context doesn't match what
# the caller declared. The May 2026 incident was a workflow that ran against the wrong
# subscription/RG with no checks. Belt-and-suspenders with the workflow-level guard.
$currentSubscription = (az account show --query id -o tsv).Trim()
if ($currentSubscription -ne $SubscriptionId) {
  throw "SAFETY ABORT: az account context is '$currentSubscription' but caller declared SubscriptionId='$SubscriptionId'. Refusing to delete resources in unknown context."
}

$rgInfo = az group show --name $ResourceGroupName --query "{tags:tags,location:location}" -o json 2>$null | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $rgInfo) {
  throw "SAFETY ABORT: resource group '$ResourceGroupName' not found in subscription '$SubscriptionId'. Refusing to proceed."
}

$rgEnvTag = $null
if ($rgInfo.tags -and $rgInfo.tags.PSObject.Properties.Match('environment').Count -gt 0) {
  $rgEnvTag = $rgInfo.tags.environment
}
if (-not $rgEnvTag) {
  throw "SAFETY ABORT: resource group '$ResourceGroupName' is missing the 'environment' tag. Refusing to act on an unidentified RG."
}
if ($rgEnvTag -ne $EnvironmentName) {
  throw "SAFETY ABORT: resource group '$ResourceGroupName' has environment tag '$rgEnvTag' but caller declared EnvironmentName='$EnvironmentName'. Resource group tag is the source of truth — refusing to act on mismatched environments."
}
Write-Host "Safety guard passed: subscription='$currentSubscription', RG='$ResourceGroupName', environment tag='$rgEnvTag'."

$resources = az resource list --resource-group $ResourceGroupName --output json | ConvertFrom-Json
Assert-LastExitCode "az resource list"

# Log resource inventory before any destructive action. If something looks wrong below
# (e.g. resource counts don't match expectations), operator has the full pre-state
# in the GitHub Actions log.
Write-Host "Resource inventory in $ResourceGroupName before deactivation:"
$resources | ForEach-Object { Write-Host "  - [$($_.type)] $($_.name)" }

$webApps = @($resources | Where-Object { $_.type -ieq "Microsoft.Web/sites" })
$appServicePlans = @($resources | Where-Object { $_.type -ieq "Microsoft.Web/serverfarms" })
$scheduledQueryRules = @($resources | Where-Object { $_.type -ieq "Microsoft.Insights/scheduledQueryRules" })
$metricAlerts = @($resources | Where-Object { $_.type -ieq "Microsoft.Insights/metricAlerts" })

if ($DisableAlerts) {
  foreach ($rule in $scheduledQueryRules) {
    Write-Host "Disabling scheduled query rule: $($rule.name)"
    Invoke-AzResourceUpdateBestEffort -resourceId $rule.id -label "scheduled query rule $($rule.name)"
  }

  foreach ($alert in $metricAlerts) {
    Write-Host "Disabling metric alert: $($alert.name)"
    Invoke-AzResourceUpdateBestEffort -resourceId $alert.id -label "metric alert $($alert.name)"
  }
}

foreach ($webApp in $webApps) {
  Write-Host "Deleting web app: $($webApp.name)"
  az webapp delete `
    --resource-group $ResourceGroupName `
    --name $webApp.name `
    --output none
  Assert-LastExitCode "az webapp delete $($webApp.name)"
  Wait-ResourceDeleted -resourceId $webApp.id -label "Web app $($webApp.name)"
}

foreach ($plan in $appServicePlans) {
  Write-Host "Deleting App Service plan: $($plan.name)"
  az appservice plan delete `
    --resource-group $ResourceGroupName `
    --name $plan.name `
    --yes `
    --output none
  Assert-LastExitCode "az appservice plan delete $($plan.name)"
  Wait-ResourceDeleted -resourceId $plan.id -label "App Service plan $($plan.name)"
}

$postgresServers = @($resources | Where-Object { $_.type -ieq "Microsoft.DBforPostgreSQL/flexibleServers" })
if ($postgresServers.Count -gt 0) {
  Write-Host "Stopping preserved PostgreSQL compute..."
  & "$PSScriptRoot/set-postgres-compute-state.ps1" `
    -SubscriptionId $SubscriptionId `
    -EnvironmentName $EnvironmentName `
    -Action "stop" `
    -ResourceGroupName $ResourceGroupName

  Write-Host "PostgreSQL server preserved:"
  foreach ($server in $postgresServers) {
    Write-Host "  - $($server.name)"
  }
}

Write-Host "App layer deactivated."
Write-Host "Deleted web apps: $($webApps.Count)"
Write-Host "Deleted App Service plans: $($appServicePlans.Count)"
Write-Host "Disabled scheduled query rules: $($scheduledQueryRules.Count)"
Write-Host "Disabled metric alerts: $($metricAlerts.Count)"
