param(
  [Parameter(Mandatory = $true)]
  [string]$TenantId,
  [string]$ApiAppName = "a2-assessment-api-dev",
  [string]$ClientAppName = "a2-assessment-client-dev",
  [string]$SpaRedirectUri = "http://localhost:5173",
  [string]$WebRedirectUri = "http://localhost:3000/auth/callback",
  [string]$OutputEnvFile = ".env.entra.dev.generated",
  [string]$OutputRoleMapFile = "config/entra-group-role-map.generated.json",
  [switch]$GrantAdminConsent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-LastExitCode([string]$stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw "$stepName failed with exit code $LASTEXITCODE."
  }
}

function Get-RequiredProperty([object]$inputObject, [string]$propertyName, [string]$context) {
  if ($null -eq $inputObject) {
    throw "$context is null. Verify Azure CLI output and tenant permissions."
  }

  $property = $inputObject.PSObject.Properties[$propertyName]
  if ($null -eq $property) {
    $serialized = $inputObject | ConvertTo-Json -Depth 8 -Compress
    throw "$context is missing property '$propertyName'. Value: $serialized"
  }

  $value = [string]$property.Value
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$context property '$propertyName' is empty."
  }

  return $value
}

function Ensure-AzLogin {
  try {
    $null = az account list --all | Out-Null
    Assert-LastExitCode "az account list --all"
  } catch {
    Write-Host "Azure CLI not logged in. Running az login..."
    az login --allow-no-subscriptions | Out-Null
    Assert-LastExitCode "az login --allow-no-subscriptions"
  }
}

function Ensure-TenantContext([string]$tenantId) {
  Write-Host "Authenticating to tenant: $tenantId"
  az login --tenant $tenantId --allow-no-subscriptions | Out-Null
  Assert-LastExitCode "az login --tenant $tenantId --allow-no-subscriptions"

  $tenantList = az account tenant list --query "[].tenantId" -o tsv
  Assert-LastExitCode "az account tenant list"
  $tenantIds = @($tenantList -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if (-not ($tenantIds -contains $tenantId)) {
    throw "Tenant $tenantId not available in current Azure CLI context."
  }

  $tenantSubscriptions = az account list --all --query "[?tenantId=='$tenantId'].id" -o tsv
  Assert-LastExitCode "az account list --all (tenant filter)"
  $subscriptionIds = @($tenantSubscriptions -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })

  if ($subscriptionIds.Count -gt 0) {
    az account set --subscription $subscriptionIds[0]
    Assert-LastExitCode "az account set --subscription $($subscriptionIds[0])"
    Write-Host "Using subscription: $($subscriptionIds[0])"
  } else {
    Write-Host "No subscriptions found in tenant $tenantId. Continuing with tenant-scoped Entra operations."
  }
}

function Get-AppByName([string]$displayName) {
  $appId = az ad app list --display-name $displayName --query "[0].appId" -o tsv
  Assert-LastExitCode "az ad app list --display-name $displayName"
  if ($appId) {
    $app = az ad app show --id $appId | ConvertFrom-Json
    Assert-LastExitCode "az ad app show --id $appId"
    return $app
  }
  return $null
}

function Ensure-ApiApp([string]$displayName, [string]$webRedirectUri) {
  $existing = Get-AppByName -displayName $displayName
  if ($existing) {
    Write-Host "Using existing API app: $displayName ($($existing.appId))"
    return $existing
  }

  Write-Host "Creating API app: $displayName"
  az ad app create `
    --display-name $displayName `
    --sign-in-audience AzureADMyOrg `
    --web-redirect-uris $webRedirectUri | Out-Null
  Assert-LastExitCode "az ad app create (API)"

  $created = Get-AppByName -displayName $displayName
  if (-not $created) {
    throw "API app '$displayName' was not found after creation."
  }

  return $created
}

function Ensure-ClientApp([string]$displayName, [string]$spaRedirectUri) {
  $existing = Get-AppByName -displayName $displayName
  if ($existing) {
    Write-Host "Using existing client app: $displayName ($($existing.appId))"
    return $existing
  }

  Write-Host "Creating client app: $displayName"
  az ad app create `
    --display-name $displayName `
    --sign-in-audience AzureADMyOrg `
    --spa-redirect-uris $spaRedirectUri | Out-Null

  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Client app creation with --spa-redirect-uris failed. Retrying without SPA redirect URI."
    az ad app create `
      --display-name $displayName `
      --sign-in-audience AzureADMyOrg | Out-Null
    Assert-LastExitCode "az ad app create (client fallback)"
  }

  $created = Get-AppByName -displayName $displayName
  if (-not $created) {
    throw "Client app '$displayName' was not found after creation."
  }

  $clientAppId = Get-RequiredProperty -inputObject $created -propertyName "appId" -context "Client app"
  az ad app update --id $clientAppId --spa-redirect-uris $spaRedirectUri | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not set SPA redirect URI via az ad app update. Configure redirect URI manually if needed."
  }

  return $created
}

function Ensure-ApiScope([object]$apiApp) {
  $scopeValue = "access_as_user"
  $appObjectId = Get-RequiredProperty -inputObject $apiApp -propertyName "id" -context "API app"
  $apiAppId = Get-RequiredProperty -inputObject $apiApp -propertyName "appId" -context "API app"
  $latest = az ad app show --id $apiAppId | ConvertFrom-Json
  Assert-LastExitCode "az ad app show --id $apiAppId"
  $existingScopes = @($latest.api.oauth2PermissionScopes)
  $existing = $existingScopes | Where-Object { $_.value -eq $scopeValue }
  if ($existing) {
    Write-Host "API scope already exists: $scopeValue"
    return [string]$existing[0].id
  }

  $scopeId = [guid]::NewGuid().ToString()
  $newScope = @{
    id = $scopeId
    value = $scopeValue
    type = "User"
    isEnabled = $true
    adminConsentDisplayName = "Access A2 Assessment API"
    adminConsentDescription = "Allows the application to access A2 Assessment API on behalf of signed-in users."
    userConsentDisplayName = "Access A2 Assessment API"
    userConsentDescription = "Allows the application to access A2 Assessment API."
  }

  $scopePayload = @($existingScopes + @($newScope))
  $body = @{
    api = @{
      requestedAccessTokenVersion = 2
      oauth2PermissionScopes = $scopePayload
    }
  } | ConvertTo-Json -Depth 12 -Compress

  $payloadFile = [System.IO.Path]::GetTempFileName()
  try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($payloadFile, $body, $utf8NoBom)

    az rest `
      --method PATCH `
      --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
      --headers "Content-Type=application/json" `
      --body "@$payloadFile" | Out-Null
    Assert-LastExitCode "az rest PATCH applications/$appObjectId"
  } finally {
    if (Test-Path $payloadFile) {
      Remove-Item -Path $payloadFile -Force -ErrorAction SilentlyContinue
    }
  }
  Write-Host "Created API scope: $scopeValue ($scopeId)"
  return $scopeId
}

function Ensure-ClientApiPermission([string]$clientAppId, [string]$apiAppId, [string]$scopeId) {
  try {
    az ad app permission add --id $clientAppId --api $apiAppId --api-permissions "$scopeId=Scope" | Out-Null
    Write-Host "Ensured client delegated permission to API scope."
  } catch {
    Write-Warning "Could not add client permission automatically. Error: $($_.Exception.Message)"
  }
}

function Ensure-ServicePrincipal([string]$appId) {
  $sp = az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv
  Assert-LastExitCode "az ad sp list --filter appId eq '$appId'"
  if (-not $sp) {
    Write-Host "Creating service principal for appId: $appId"
    az ad sp create --id $appId | Out-Null
    Assert-LastExitCode "az ad sp create --id $appId"
  } else {
    Write-Host "Service principal already exists for appId: $appId"
  }
}

function Ensure-DevGroup([string]$displayName) {
  $groupId = az ad group list --filter "displayName eq '$displayName'" --query "[0].id" -o tsv
  Assert-LastExitCode "az ad group list --filter displayName eq '$displayName'"
  if (-not $groupId) {
    Write-Host "Creating group: $displayName"
    $groupId = az ad group create --display-name $displayName --mail-nickname $displayName --query id -o tsv
    Assert-LastExitCode "az ad group create --display-name $displayName"
  } else {
    Write-Host "Group exists: $displayName ($groupId)"
  }
  return $groupId
}

function Write-FileUtf8NoBom([string]$filePath, [string]$content) {
  $directory = Split-Path -Path $filePath -Parent
  if (-not [string]::IsNullOrWhiteSpace($directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $fullPath = [System.IO.Path]::GetFullPath($filePath)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($fullPath, $content, $utf8NoBom)
}

Ensure-AzLogin
Ensure-TenantContext -tenantId $TenantId

$apiApp = Ensure-ApiApp -displayName $ApiAppName -webRedirectUri $WebRedirectUri
$clientApp = Ensure-ClientApp -displayName $ClientAppName -spaRedirectUri $SpaRedirectUri

$apiAppId = Get-RequiredProperty -inputObject $apiApp -propertyName "appId" -context "API app"
$clientAppId = Get-RequiredProperty -inputObject $clientApp -propertyName "appId" -context "Client app"

Ensure-ServicePrincipal -appId $apiAppId
Ensure-ServicePrincipal -appId $clientAppId

# Set identifier URI for API app to stable audience
$apiIdentifierUri = "api://$apiAppId"
az ad app update --id $apiAppId --identifier-uris $apiIdentifierUri | Out-Null
Assert-LastExitCode "az ad app update --id $apiAppId --identifier-uris $apiIdentifierUri"
$scopeId = Ensure-ApiScope -apiApp $apiApp
Ensure-ClientApiPermission -clientAppId $clientAppId -apiAppId $apiAppId -scopeId $scopeId

if ($GrantAdminConsent) {
  try {
    az ad app permission admin-consent --id $clientAppId | Out-Null
    Assert-LastExitCode "az ad app permission admin-consent --id $clientAppId"
    Write-Host "Admin consent granted for client app."
  } catch {
    Write-Warning "Could not grant admin consent automatically. Error: $($_.Exception.Message)"
  }
}

# Optional: add delegated permission from client app to API app can be added in tenant portal
# if scope exposure is customized later.

$groups = @{
  PARTICIPANT = Ensure-DevGroup "a2-assessment-dev-participants"
  ADMINISTRATOR = Ensure-DevGroup "a2-assessment-dev-admins"
  REVIEWER = Ensure-DevGroup "a2-assessment-dev-reviewers"
  APPEAL_HANDLER = Ensure-DevGroup "a2-assessment-dev-appeal-handlers"
  REPORT_READER = Ensure-DevGroup "a2-assessment-dev-report-readers"
}

$roleMap = @{
  $groups.PARTICIPANT = "PARTICIPANT"
  $groups.ADMINISTRATOR = "ADMINISTRATOR"
  $groups.REVIEWER = "REVIEWER"
  $groups.APPEAL_HANDLER = "APPEAL_HANDLER"
  $groups.REPORT_READER = "REPORT_READER"
}

$roleMapJson = $roleMap | ConvertTo-Json -Compress
$roleMapPretty = $roleMap | ConvertTo-Json -Depth 5

Write-FileUtf8NoBom -filePath $OutputRoleMapFile -content $roleMapPretty

$envContent = @"
AUTH_MODE=entra
ENTRA_TENANT_ID=$TenantId
ENTRA_AUDIENCE=$apiIdentifierUri
ENTRA_SYNC_GROUP_ROLES=true
ENTRA_GROUP_ROLE_MAP_JSON=$roleMapJson
ENTRA_GROUP_ROLE_MAP_FILE=$OutputRoleMapFile
"@

Write-FileUtf8NoBom -filePath $OutputEnvFile -content $envContent

Write-Host ""
Write-Host "Dev tenant auth bootstrap complete."
Write-Host "API appId: $apiAppId"
Write-Host "Client appId: $clientAppId"
Write-Host "Audience: $apiIdentifierUri"
Write-Host "Scope: $apiIdentifierUri/access_as_user"
Write-Host "Environment file written to: $OutputEnvFile"
Write-Host "Role map file: $OutputRoleMapFile"
