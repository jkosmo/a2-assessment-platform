param(
  [string]$SubscriptionId = "5b3f760b-42d4-4d78-812c-c059278d1086",
  [string]$ResourceGroupName = "rg-a2-assessment-production",
  [string]$BackupResourceGroupName = "rg-a2-assessment-backup",
  [string]$Location = "norwayeast",
  [string]$ServicePrincipalObjectId = "cba285e6-680c-4e00-abd1-ac0eaa2d313a",
  [string]$TenantId = "a018856e-8cf2-4ec4-bbc8-ab18058027dc"
)

# One-shot bootstrap, idempotent: brings the GitHub Actions service principal into the state
# the deploy workflow expects. Run by a subscription Owner before the first deploy of a new
# environment, OR after the resource group(s) are deleted and recreated.
#
# What this grants:
#   - Main RG (e.g. rg-a2-assessment-production): Role Based Access Control Administrator
#     (lets Bicep create Key Vault role assignments for managed identities -- #404).
#   - Backup RG (e.g. rg-a2-assessment-backup): Contributor (lets deploy create the backup
#     vault and PostgreSQL backup policy -- #439). Backup vault must live in a DIFFERENT RG
#     from the workloads it protects (Azure Backup Vault constraint).
#
# Both grants are necessary; #404 covered the main RG, #439 covered the backup RG. They are
# now in the same script so a future RG-recreate doesn't require remembering both.
#
# This script cannot be performed by the deploy workflow itself because the SP lacks
# roleAssignments/write until after this runs.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$rbacAdministratorRoleId = "f1a07417-d97a-45cb-824c-7a7467783830"
$contributorRoleId       = "b24988ac-6180-42a0-ab88-20f7382dd24c"

function Ensure-ResourceGroup {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$Location
  )
  $exists = az group exists --name $Name | ConvertFrom-Json
  if (-not $exists) {
    Write-Host "Creating resource group $Name in $Location..."
    az group create --name $Name --location $Location --tags environment=production owner=engineering costCenter=a2-assessment-platform | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "az group create $Name failed" }
  } else {
    Write-Host "Resource group $Name already exists."
  }
  $id = (az group show --name $Name --query id -o tsv).Trim()
  if (-not $id) { throw "Could not retrieve resource group id for $Name." }
  return $id
}

function Grant-RoleOnScope {
  param(
    [Parameter(Mandatory)] [string]$Scope,
    [Parameter(Mandatory)] [string]$RoleDefinitionId,
    [Parameter(Mandatory)] [string]$RoleDisplayName,
    [Parameter(Mandatory)] [string]$PrincipalObjectId
  )
  Write-Host "Granting '$RoleDisplayName' to SP $PrincipalObjectId on $Scope..."
  # az role assignment create is the documented CLI command and handles its own
  # GUID generation. The previous `az rest --method PUT --body $body` form (used
  # in earlier versions of this script) failed with "Unsupported Media Type"
  # because az rest does not auto-set Content-Type for the body — verified
  # against rg-a2-assessment-backup on 2026-05-19.
  $result = az role assignment create `
    --assignee $PrincipalObjectId `
    --role $RoleDefinitionId `
    --scope $Scope 2>&1

  if ($LASTEXITCODE -ne 0) {
    if ("$result" -match "RoleAssignmentExists|already exists") {
      Write-Host "  -> Already granted (idempotent)."
    } else {
      throw "Failed to grant '$RoleDisplayName' on $Scope`: $result"
    }
  } else {
    Write-Host "  -> Granted."
  }
}

# --- main ---

Write-Host "Authenticating to tenant $TenantId..."
az login --use-device-code --tenant $TenantId
if ($LASTEXITCODE -ne 0) { throw "az login failed" }

az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw "az account set failed" }

Write-Host "Verifying service principal $ServicePrincipalObjectId exists in tenant..."
az ad sp show --id $ServicePrincipalObjectId --query id -o tsv 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Service principal $ServicePrincipalObjectId not found in tenant $TenantId. Create the app registration with federated identity credential for GitHub Actions first."
}
Write-Host "Service principal verified."

# 1. Main RG: ensure exists + grant RBAC Admin (for Key Vault role assignment creation)
$mainRgId = Ensure-ResourceGroup -Name $ResourceGroupName -Location $Location
Grant-RoleOnScope `
  -Scope $mainRgId `
  -RoleDefinitionId $rbacAdministratorRoleId `
  -RoleDisplayName "Role Based Access Control Administrator" `
  -PrincipalObjectId $ServicePrincipalObjectId

# 2. Backup RG: ensure exists + grant Contributor (for backup vault + PostgreSQL backup policy)
$backupRgId = Ensure-ResourceGroup -Name $BackupResourceGroupName -Location $Location
Grant-RoleOnScope `
  -Scope $backupRgId `
  -RoleDefinitionId $contributorRoleId `
  -RoleDisplayName "Contributor" `
  -PrincipalObjectId $ServicePrincipalObjectId

Write-Host ""
Write-Host "Bootstrap complete. GitHub Actions SP $ServicePrincipalObjectId now has:"
Write-Host "  - Role Based Access Control Administrator on $ResourceGroupName"
Write-Host "  - Contributor on $BackupResourceGroupName"
Write-Host ""
Write-Host "You can now trigger the deploy workflow."
