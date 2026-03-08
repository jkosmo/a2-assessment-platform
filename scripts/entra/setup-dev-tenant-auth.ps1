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

function Ensure-AzLogin {
  try {
    $null = az account show | Out-Null
  } catch {
    Write-Host "Azure CLI not logged in. Running az login..."
    az login | Out-Null
  }
}

function Ensure-TenantContext([string]$tenantId) {
  az account set --tenant $tenantId
  $currentTenant = az account show --query tenantId -o tsv
  if ($currentTenant -ne $tenantId) {
    throw "Failed to switch to tenant $tenantId. Current tenant: $currentTenant"
  }
}

function Get-AppByName([string]$displayName) {
  $appId = az ad app list --display-name $displayName --query "[0].appId" -o tsv
  if ($appId) {
    return az ad app show --id $appId | ConvertFrom-Json
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

  return Get-AppByName -displayName $displayName
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

  return Get-AppByName -displayName $displayName
}

function Ensure-ApiScope([object]$apiApp) {
  $scopeValue = "access_as_user"
  $appObjectId = $apiApp.id
  $latest = az ad app show --id $apiApp.appId | ConvertFrom-Json
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

  az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" --headers "Content-Type=application/json" --body $body | Out-Null
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
  if (-not $sp) {
    Write-Host "Creating service principal for appId: $appId"
    az ad sp create --id $appId | Out-Null
  } else {
    Write-Host "Service principal already exists for appId: $appId"
  }
}

function Ensure-DevGroup([string]$displayName) {
  $groupId = az ad group list --filter "displayName eq '$displayName'" --query "[0].id" -o tsv
  if (-not $groupId) {
    Write-Host "Creating group: $displayName"
    $groupId = az ad group create --display-name $displayName --mail-nickname $displayName --query id -o tsv
  } else {
    Write-Host "Group exists: $displayName ($groupId)"
  }
  return $groupId
}

Ensure-AzLogin
Ensure-TenantContext -tenantId $TenantId

$apiApp = Ensure-ApiApp -displayName $ApiAppName -webRedirectUri $WebRedirectUri
$clientApp = Ensure-ClientApp -displayName $ClientAppName -spaRedirectUri $SpaRedirectUri

Ensure-ServicePrincipal -appId $apiApp.appId
Ensure-ServicePrincipal -appId $clientApp.appId

# Set identifier URI for API app to stable audience
$apiIdentifierUri = "api://$($apiApp.appId)"
az ad app update --id $apiApp.appId --identifier-uris $apiIdentifierUri | Out-Null
$scopeId = Ensure-ApiScope -apiApp $apiApp
Ensure-ClientApiPermission -clientAppId $clientApp.appId -apiAppId $apiApp.appId -scopeId $scopeId

if ($GrantAdminConsent) {
  try {
    az ad app permission admin-consent --id $clientApp.appId | Out-Null
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

New-Item -ItemType Directory -Path (Split-Path -Path $OutputRoleMapFile -Parent) -Force | Out-Null
$roleMapPretty | Set-Content -Path $OutputRoleMapFile -Encoding UTF8

$envContent = @"
AUTH_MODE=entra
ENTRA_TENANT_ID=$TenantId
ENTRA_AUDIENCE=$apiIdentifierUri
ENTRA_SYNC_GROUP_ROLES=true
ENTRA_GROUP_ROLE_MAP_JSON=$roleMapJson
ENTRA_GROUP_ROLE_MAP_FILE=$OutputRoleMapFile
"@

$envContent | Set-Content -Path $OutputEnvFile -Encoding UTF8

Write-Host ""
Write-Host "Dev tenant auth bootstrap complete."
Write-Host "API appId: $($apiApp.appId)"
Write-Host "Client appId: $($clientApp.appId)"
Write-Host "Audience: $apiIdentifierUri"
Write-Host "Scope: $apiIdentifierUri/access_as_user"
Write-Host "Role map written to: $OutputEnvFile"
Write-Host "Role map file: $OutputRoleMapFile"
