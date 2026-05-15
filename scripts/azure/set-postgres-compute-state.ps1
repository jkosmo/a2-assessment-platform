param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentName,
  [Parameter(Mandatory = $true)]
  [ValidateSet("start", "stop")]
  [string]$Action,
  [string]$ResourceGroupName = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-LastExitCode([string]$stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw "$stepName failed with exit code $LASTEXITCODE."
  }
}

function Wait-PostgresState([string]$resourceGroupName, [string]$serverName, [string]$expectedState) {
  $maxChecks = 36
  for ($attempt = 1; $attempt -le $maxChecks; $attempt++) {
    $state = (az postgres flexible-server show `
      --resource-group $resourceGroupName `
      --name $serverName `
      --query "state" `
      --output tsv).Trim()
    Assert-LastExitCode "az postgres flexible-server show $serverName"

    if ($state -eq $expectedState) {
      Write-Host "PostgreSQL server $serverName reached state '$expectedState'."
      return
    }

    Write-Host "Waiting for PostgreSQL server $serverName to reach '$expectedState' ($attempt/$maxChecks). Current state: '$state'."
    Start-Sleep -Seconds 10
  }

  throw "PostgreSQL server $serverName did not reach expected state '$expectedState'."
}

if ($EnvironmentName -ne "staging") {
  throw "set-postgres-compute-state.ps1 only supports the staging environment."
}

if (-not $ResourceGroupName) {
  $ResourceGroupName = "rg-a2-assessment-$EnvironmentName"
}

az account set --subscription $SubscriptionId
Assert-LastExitCode "az account set"

$serverNames = @(az postgres flexible-server list `
  --resource-group $ResourceGroupName `
  --query "[?tags.environment=='$EnvironmentName'].name" `
  --output tsv)
Assert-LastExitCode "az postgres flexible-server list"

if ($serverNames.Count -eq 0) {
  Write-Host "No PostgreSQL flexible servers found for environment '$EnvironmentName' in resource group '$ResourceGroupName'."
  exit 0
}

$expectedState = if ($Action -eq "start") { "Ready" } else { "Stopped" }

foreach ($serverName in $serverNames) {
  $serverName = $serverName.Trim()
  if (-not $serverName) {
    continue
  }

  $currentState = (az postgres flexible-server show `
    --resource-group $ResourceGroupName `
    --name $serverName `
    --query "state" `
    --output tsv).Trim()
  Assert-LastExitCode "az postgres flexible-server show $serverName"

  if ($currentState -eq $expectedState) {
    Write-Host "PostgreSQL server $serverName already in state '$expectedState'."
    continue
  }

  Write-Host "$Action PostgreSQL server: $serverName"
  az postgres flexible-server $Action `
    --resource-group $ResourceGroupName `
    --name $serverName `
    --output none
  Assert-LastExitCode "az postgres flexible-server $Action $serverName"

  Wait-PostgresState -resourceGroupName $ResourceGroupName -serverName $serverName -expectedState $expectedState
}
