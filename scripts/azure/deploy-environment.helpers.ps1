# Pure-logic helpers for deploy-environment.ps1, extracted so they can be unit-tested
# without spinning up Azure. The main script dot-sources this file near the top.
#
# All three helpers exist because Set-StrictMode -Version Latest makes naive PowerShell
# patterns throw on null inputs, and direct $obj.foo.bar access is a footgun once any
# layer of the input may be null (see doc/DEPLOY_OPTIMIZATION.md 2026-05-19 incident).

# Reads a named output from an ARM deployment outputs object. The outputs object has
# the shape `{ webAppName: { type: 'String', value: 'a2-app-stg' }, ... }` when emitted
# by a Succeeded deployment, but ARM returns null when the deployment ended Failed.
# Under StrictMode, $obj.foo.value throws when $obj is null or when $obj has no 'foo'
# property, so this helper probes PSObject.Properties first.
function Get-DeploymentOutputValue {
  param(
    [object]$Outputs,
    [Parameter(Mandatory)] [string]$Name
  )
  if ($null -eq $Outputs) { return $null }
  $prop = $Outputs.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $null }
  $val = $prop.Value
  if ($null -eq $val) { return $null }
  if ($val.PSObject.Properties['value']) { return $val.value }
  return $val
}

# Decides whether an ARM deployment failure should be treated as idempotency-safe.
# Returns $true ONLY when:
# - There is at least one failed operation (i.e. ARM actually said Failed), AND
# - EVERY failed operation is `Microsoft.Authorization/roleAssignments` with
#   errorCode `RoleAssignmentExists`.
# These are the failures we know are safe: the principalId+roleDefinitionId+scope
# tuple is already in place, so the new GUID name we tried to create represents
# the same RBAC fact as the existing assignment. Any other failure (or a mixed
# set) is NOT exempt and must cause the deploy to fail loudly.
function Test-DeploymentFailureIsIdempotent {
  param([object[]]$FailedOperations)
  if (-not $FailedOperations -or @($FailedOperations).Count -eq 0) { return $false }
  $nonIdempotent = @($FailedOperations | Where-Object {
    -not ($_.resourceType -eq 'Microsoft.Authorization/roleAssignments' -and $_.errorCode -eq 'RoleAssignmentExists')
  })
  return ($nonIdempotent.Count -eq 0)
}

# Resolves the 3 App Service names (web/worker/parser) from a mix of ARM deployment
# outputs and a fallback list of existing app names in the target resource group.
# Output values from ARM are preferred; any missing name is filled in by matching
# the env-code naming pattern (stg-app, stg-worker, stg-parser or prd-app, ...) in
# the fallback list.
# Returns a hashtable with keys web/worker/parser. Caller is responsible for
# verifying that none are still $null.
function Resolve-AppNames {
  param(
    [object]$ArmOutputs,
    [Parameter(Mandatory)] [ValidateSet('stg','prd')] [string]$EnvCode,
    [string[]]$ExistingAppNames = @()
  )
  $web = Get-DeploymentOutputValue $ArmOutputs 'webAppName'
  $worker = Get-DeploymentOutputValue $ArmOutputs 'workerAppName'
  $parser = Get-DeploymentOutputValue $ArmOutputs 'parserAppName'
  if (-not $web) { $web = (@($ExistingAppNames) | Where-Object { $_ -match "${EnvCode}-app" } | Select-Object -First 1) }
  if (-not $worker) { $worker = (@($ExistingAppNames) | Where-Object { $_ -match "${EnvCode}-worker" } | Select-Object -First 1) }
  if (-not $parser) { $parser = (@($ExistingAppNames) | Where-Object { $_ -match "${EnvCode}-parser" } | Select-Object -First 1) }
  return @{ web = $web; worker = $worker; parser = $parser }
}

# #410: extracts the URI-decoded password from a PostgreSQL connection string of the form
# postgresql://user:encodedPassword@host:5432/db?params (the shape main.bicep builds for the
# DATABASE-URL secret via uriComponent()). Returns $null when the input is empty, not a
# parseable URI, or has no password component. UnescapeDataString reverses any percent-encoding
# regardless of which encoder produced it, so this round-trips Bicep's uriComponent() output.
function Get-PostgresPasswordFromConnectionString {
  param([string]$ConnectionString)
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { return $null }
  $uri = $null
  try { $uri = [System.Uri]$ConnectionString } catch { return $null }
  if ($null -eq $uri) { return $null }
  $userInfo = $uri.UserInfo
  if ([string]::IsNullOrEmpty($userInfo)) { return $null }
  $sepIdx = $userInfo.IndexOf(':')
  if ($sepIdx -lt 0) { return $null }
  $encoded = $userInfo.Substring($sepIdx + 1)
  if ([string]::IsNullOrEmpty($encoded)) { return $null }
  return [System.Uri]::UnescapeDataString($encoded)
}

# #410 credential-drift guard (pure decision). Given the skip decision from the PostgreSQL
# property pre-flight and the passwords involved, returns the FINAL skipPostgresUpdate value.
# main.bicep writes the DATABASE-URL secret unconditionally but only updates the server when
# !skipPostgresUpdate -- so skipping while the password changed would leave Key Vault ahead of
# the server (drift; breaks the app on next restart). Rules:
# - Not skipping anyway -> $false.
# - Existing password unknown/empty -> $false (force update; never leave KV ahead of server).
# - Desired password differs from existing -> $false (rotation intended; force update so server
#   and Key Vault change atomically -- infra invariant #12).
# - Passwords match -> $true (skip is safe, no drift).
function Resolve-PostgresSkipForCredentialSafety {
  param(
    [bool]$RequestedSkip,
    [string]$ExistingPassword,
    [string]$DesiredPassword
  )
  if (-not $RequestedSkip) { return $false }
  if ([string]::IsNullOrEmpty($ExistingPassword)) { return $false }
  return ($ExistingPassword -eq $DesiredPassword)
}
