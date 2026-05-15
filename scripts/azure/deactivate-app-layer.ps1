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
  try {
    az resource update --ids $resourceId --set properties.enabled=false --output none
    Assert-LastExitCode "az resource update $label"
    return
  } catch {
    $message = $_.Exception.Message
    if ($message -like "*ResourceNotFound*") {
      Write-Warning "$label could not be updated because its scoped resource is already gone. Continuing."
      return
    }

    throw
  }
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

$resources = az resource list --resource-group $ResourceGroupName --output json | ConvertFrom-Json
Assert-LastExitCode "az resource list"

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
