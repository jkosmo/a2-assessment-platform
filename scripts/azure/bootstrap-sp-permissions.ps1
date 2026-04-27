param(
  [string]$SubscriptionId = "5b3f760b-42d4-4d78-812c-c059278d1086",
  [string]$ResourceGroupName = "rg-a2-assessment-production",
  [string]$Location = "norwayeast",
  [string]$ServicePrincipalObjectId = "cba285e6-680c-4e00-abd1-ac0eaa2d313a",
  [string]$TenantId = "a018856e-8cf2-4ec4-bbc8-ab18058027dc"
)

# Run once by a subscription Owner/Admin before the first production deploy.
# Grants the GitHub Actions service principal User Access Administrator on the
# production resource group so that Bicep roleAssignments/write succeeds during
# Key Vault managed-identity role assignment creation.
#
# This step cannot be performed by the deploy workflow itself because the SP
# lacks roleAssignments/write until after this script runs.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$userAccessAdminRoleId = "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9"

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

Write-Host "Ensuring resource group $ResourceGroupName exists in $Location..."
$rgExists = az group exists --name $ResourceGroupName | ConvertFrom-Json
if (-not $rgExists) {
  az group create --name $ResourceGroupName --location $Location | Out-Null
  Write-Host "Resource group created."
} else {
  Write-Host "Resource group already exists."
}

$rgId = (az group show --name $ResourceGroupName --query id -o tsv).Trim()
if (-not $rgId) { throw "Could not retrieve resource group ID" }

$assignmentGuid = (node -e "const {randomUUID}=require('crypto');console.log(randomUUID())").Trim()

Write-Host "Granting User Access Administrator to SP $ServicePrincipalObjectId on $ResourceGroupName..."
$body = @{
  properties = @{
    roleDefinitionId = "/subscriptions/$SubscriptionId/providers/Microsoft.Authorization/roleDefinitions/$userAccessAdminRoleId"
    principalId      = $ServicePrincipalObjectId
    principalType    = "ServicePrincipal"
  }
} | ConvertTo-Json -Compress

$result = az rest --method PUT `
  --uri "https://management.azure.com${rgId}/providers/Microsoft.Authorization/roleAssignments/${assignmentGuid}?api-version=2022-04-01" `
  --body $body 2>&1

if ($LASTEXITCODE -ne 0) {
  # Idempotent: already-exists is not an error
  if ($result -match "RoleAssignmentExists") {
    Write-Host "Role assignment already exists — nothing to do."
  } else {
    throw "Failed to create role assignment: $result"
  }
} else {
  Write-Host "Role assignment created successfully."
}

Write-Host ""
Write-Host "Bootstrap complete. GitHub Actions SP $ServicePrincipalObjectId now has"
Write-Host "User Access Administrator on resource group $ResourceGroupName."
Write-Host "You can now trigger the production deploy workflow."
