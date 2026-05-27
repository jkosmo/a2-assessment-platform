# Pester v5 unit tests for scripts/azure/deploy-environment.helpers.ps1.
#
# Each helper exists because of a real bug we already shipped -- see
# doc/DEPLOY_OPTIMIZATION.md (2026-05-19 RAE/outputs/StrictMode cascade) for the
# narrative. The tests below pin the contract so a regression on any of the three
# helpers fails CI before the bad patch hits a deploy.

BeforeAll {
  # Enable the same StrictMode the production script uses -- these tests must catch
  # the exact PowerShell behavior that bit us in run 26082842024.
  Set-StrictMode -Version Latest
  $ErrorActionPreference = 'Stop'

  $helpersPath = Join-Path $PSScriptRoot '..\..\scripts\azure\deploy-environment.helpers.ps1'
  . $helpersPath
}

Describe 'Get-DeploymentOutputValue' {
  It 'returns $null when outputs object is $null' {
    Get-DeploymentOutputValue -Outputs $null -Name 'webAppName' | Should -BeNullOrEmpty
  }

  It 'returns $null when outputs is an empty PSCustomObject' {
    $empty = New-Object PSCustomObject
    Get-DeploymentOutputValue -Outputs $empty -Name 'webAppName' | Should -BeNullOrEmpty
  }

  It 'returns $null when the requested property is missing' {
    $other = [PSCustomObject]@{ someOther = [PSCustomObject]@{ value = 'x' } }
    Get-DeploymentOutputValue -Outputs $other -Name 'webAppName' | Should -BeNullOrEmpty
  }

  It 'unwraps ARM-shape { type, value } correctly' {
    $arm = [PSCustomObject]@{ webAppName = [PSCustomObject]@{ type = 'String'; value = 'a2-app-stg' } }
    Get-DeploymentOutputValue -Outputs $arm -Name 'webAppName' | Should -Be 'a2-app-stg'
  }

  It 'returns the raw value when the property is a plain scalar' {
    $raw = [PSCustomObject]@{ webAppName = 'a2-raw' }
    Get-DeploymentOutputValue -Outputs $raw -Name 'webAppName' | Should -Be 'a2-raw'
  }

  It 'does NOT throw under StrictMode when accessing missing properties (regression for run 26082842024)' {
    # This was the bug: $obj.foo.bar throws under StrictMode -Latest if $obj is null OR
    # $obj has no .foo. The helper must succeed silently.
    { Get-DeploymentOutputValue -Outputs $null -Name 'missing' } | Should -Not -Throw
    { Get-DeploymentOutputValue -Outputs (New-Object PSCustomObject) -Name 'missing' } | Should -Not -Throw
  }
}

Describe 'Test-DeploymentFailureIsIdempotent' {
  It 'returns $false when given $null' {
    Test-DeploymentFailureIsIdempotent -FailedOperations $null | Should -BeFalse
  }

  It 'returns $false when given an empty array' {
    Test-DeploymentFailureIsIdempotent -FailedOperations @() | Should -BeFalse
  }

  It 'returns $true when ALL failures are RoleAssignmentExists on roleAssignments' {
    $allRae = @(
      [PSCustomObject]@{ resourceType = 'Microsoft.Authorization/roleAssignments'; errorCode = 'RoleAssignmentExists' },
      [PSCustomObject]@{ resourceType = 'Microsoft.Authorization/roleAssignments'; errorCode = 'RoleAssignmentExists' },
      [PSCustomObject]@{ resourceType = 'Microsoft.Authorization/roleAssignments'; errorCode = 'RoleAssignmentExists' }
    )
    Test-DeploymentFailureIsIdempotent -FailedOperations $allRae | Should -BeTrue
  }

  It 'returns $false when ANY failure is non-RAE (mixed input)' {
    $mixed = @(
      [PSCustomObject]@{ resourceType = 'Microsoft.Authorization/roleAssignments'; errorCode = 'RoleAssignmentExists' },
      [PSCustomObject]@{ resourceType = 'Microsoft.Web/sites';                     errorCode = 'ResourceQuotaExceeded' }
    )
    Test-DeploymentFailureIsIdempotent -FailedOperations $mixed | Should -BeFalse
  }

  It 'returns $false when failure is on the right resource type but wrong errorCode' {
    $wrongCode = @(
      [PSCustomObject]@{ resourceType = 'Microsoft.Authorization/roleAssignments'; errorCode = 'AuthorizationFailed' }
    )
    Test-DeploymentFailureIsIdempotent -FailedOperations $wrongCode | Should -BeFalse
  }

  It 'returns $false when failure has the right errorCode but wrong resource type' {
    # Hypothetical -- RoleAssignmentExists code on some other resource type shouldn't be exempt.
    $wrongType = @(
      [PSCustomObject]@{ resourceType = 'Microsoft.KeyVault/vaults/secrets'; errorCode = 'RoleAssignmentExists' }
    )
    Test-DeploymentFailureIsIdempotent -FailedOperations $wrongType | Should -BeFalse
  }

  It 'matches the real failed-op shape from run 26082016139 (regression)' {
    # This is the exact JSON shape we get from
    # `az deployment operation group list --query "[?properties.provisioningState=='Failed'].{resourceType:..., errorCode:...}"`.
    $realShape = @(
      [PSCustomObject]@{ operationId='F71483A0CC0C165B'; resourceType='Microsoft.Authorization/roleAssignments'; errorCode='RoleAssignmentExists' },
      [PSCustomObject]@{ operationId='884B744D542D1017'; resourceType='Microsoft.Authorization/roleAssignments'; errorCode='RoleAssignmentExists' },
      [PSCustomObject]@{ operationId='E5B6E89894AE9A98'; resourceType='Microsoft.Authorization/roleAssignments'; errorCode='RoleAssignmentExists' }
    )
    Test-DeploymentFailureIsIdempotent -FailedOperations $realShape | Should -BeTrue
  }
}

Describe 'Resolve-AppNames' {
  BeforeAll {
    # Pester v5: variables defined directly inside Describe (outside It / BeforeAll) are
    # in DISCOVERY scope, not run-time scope, so the It blocks below would see them as
    # $null. Putting fixtures here makes them available during It execution.
    $script:stagingApps = @(
      'a2-assessment-platform-stg-app-x6eyx4',
      'a2-assessment-platform-stg-worker-x6eyx4',
      'a2-assessment-platform-stg-parser-x6eyx4'
    )
    $script:prodApps = @(
      'a2-assessment-platform-prd-app-hea5kl',
      'a2-assessment-platform-prd-worker-hea5kl',
      'a2-assessment-platform-prd-parser-hea5kl'
    )
  }

  It 'prefers ARM outputs when all three are present' {
    $outputs = [PSCustomObject]@{
      webAppName    = [PSCustomObject]@{ value = 'a2-from-outputs-app' }
      workerAppName = [PSCustomObject]@{ value = 'a2-from-outputs-worker' }
      parserAppName = [PSCustomObject]@{ value = 'a2-from-outputs-parser' }
    }
    $result = Resolve-AppNames -ArmOutputs $outputs -EnvCode 'stg' -ExistingAppNames $script:stagingApps
    $result.web    | Should -Be 'a2-from-outputs-app'
    $result.worker | Should -Be 'a2-from-outputs-worker'
    $result.parser | Should -Be 'a2-from-outputs-parser'
  }

  It 'falls back to RG enumeration for all three when ARM outputs is $null' {
    $result = Resolve-AppNames -ArmOutputs $null -EnvCode 'stg' -ExistingAppNames $script:stagingApps
    $result.web    | Should -Be 'a2-assessment-platform-stg-app-x6eyx4'
    $result.worker | Should -Be 'a2-assessment-platform-stg-worker-x6eyx4'
    $result.parser | Should -Be 'a2-assessment-platform-stg-parser-x6eyx4'
  }

  It 'fills in only the missing names from RG enumeration (partial-outputs case)' {
    # webAppName in outputs; worker/parser missing -- both should be filled by enumeration.
    $partial = [PSCustomObject]@{
      webAppName = [PSCustomObject]@{ value = 'a2-from-outputs-app' }
    }
    $result = Resolve-AppNames -ArmOutputs $partial -EnvCode 'stg' -ExistingAppNames $script:stagingApps
    $result.web    | Should -Be 'a2-from-outputs-app'                            # from outputs
    $result.worker | Should -Be 'a2-assessment-platform-stg-worker-x6eyx4'       # from fallback
    $result.parser | Should -Be 'a2-assessment-platform-stg-parser-x6eyx4'       # from fallback
  }

  It 'returns null for names that are missing from BOTH outputs and the existing-name list' {
    $result = Resolve-AppNames -ArmOutputs $null -EnvCode 'stg' -ExistingAppNames @('some-unrelated-app')
    $result.web    | Should -BeNullOrEmpty
    $result.worker | Should -BeNullOrEmpty
    $result.parser | Should -BeNullOrEmpty
  }

  It 'matches "prd" pattern when EnvCode is prd' {
    $result = Resolve-AppNames -ArmOutputs $null -EnvCode 'prd' -ExistingAppNames $script:prodApps
    $result.web    | Should -Be 'a2-assessment-platform-prd-app-hea5kl'
    $result.worker | Should -Be 'a2-assessment-platform-prd-worker-hea5kl'
    $result.parser | Should -Be 'a2-assessment-platform-prd-parser-hea5kl'
  }

  It 'does NOT throw under StrictMode when ArmOutputs is null (regression for run 26082842024)' {
    { Resolve-AppNames -ArmOutputs $null -EnvCode 'stg' -ExistingAppNames @() } | Should -Not -Throw
  }
}

Describe 'Get-PostgresPasswordFromConnectionString' {
  It 'returns $null for $null / empty / whitespace input' {
    Get-PostgresPasswordFromConnectionString -ConnectionString $null | Should -BeNullOrEmpty
    Get-PostgresPasswordFromConnectionString -ConnectionString '' | Should -BeNullOrEmpty
    Get-PostgresPasswordFromConnectionString -ConnectionString '   ' | Should -BeNullOrEmpty
  }

  It 'returns $null when the string is not a parseable URI' {
    Get-PostgresPasswordFromConnectionString -ConnectionString 'not a uri at all' | Should -BeNullOrEmpty
  }

  It 'returns $null when there is no userinfo / no password component' {
    Get-PostgresPasswordFromConnectionString -ConnectionString 'postgresql://host:5432/db' | Should -BeNullOrEmpty
    Get-PostgresPasswordFromConnectionString -ConnectionString 'postgresql://justuser@host:5432/db' | Should -BeNullOrEmpty
  }

  It 'extracts a simple password' {
    $cs = 'postgresql://a2admin:SimplePw123@host.postgres.database.azure.com:5432/a2db?sslmode=require'
    Get-PostgresPasswordFromConnectionString -ConnectionString $cs | Should -Be 'SimplePw123'
  }

  It 'URI-decodes a password with special characters (matches Bicep uriComponent round-trip)' {
    $pw = 'P@ss:w0rd/it' + "'" + 's me!#&='
    $enc = [System.Uri]::EscapeDataString($pw)
    $cs = "postgresql://a2admin:${enc}@host.postgres.database.azure.com:5432/a2db?schema=public&sslmode=require"
    Get-PostgresPasswordFromConnectionString -ConnectionString $cs | Should -Be $pw
  }

  It 'does NOT throw under StrictMode on malformed input' {
    { Get-PostgresPasswordFromConnectionString -ConnectionString $null } | Should -Not -Throw
    { Get-PostgresPasswordFromConnectionString -ConnectionString 'garbage' } | Should -Not -Throw
  }
}

Describe 'Resolve-PostgresSkipForCredentialSafety' {
  It 'returns $false when skip was not requested (regardless of passwords)' {
    Resolve-PostgresSkipForCredentialSafety -RequestedSkip $false -ExistingPassword 'x' -DesiredPassword 'x' | Should -BeFalse
  }

  It 'returns $true when skipping and passwords match (skip is safe)' {
    Resolve-PostgresSkipForCredentialSafety -RequestedSkip $true -ExistingPassword 'samePw' -DesiredPassword 'samePw' | Should -BeTrue
  }

  It 'returns $false when skipping but desired password differs (rotation intended)' {
    Resolve-PostgresSkipForCredentialSafety -RequestedSkip $true -ExistingPassword 'oldPw' -DesiredPassword 'newPw' | Should -BeFalse
  }

  It 'returns $false when skipping but existing password is unknown (null/empty -> force update)' {
    Resolve-PostgresSkipForCredentialSafety -RequestedSkip $true -ExistingPassword $null -DesiredPassword 'newPw' | Should -BeFalse
    Resolve-PostgresSkipForCredentialSafety -RequestedSkip $true -ExistingPassword '' -DesiredPassword 'newPw' | Should -BeFalse
  }

  It 'does NOT throw under StrictMode when existing password is null' {
    { Resolve-PostgresSkipForCredentialSafety -RequestedSkip $true -ExistingPassword $null -DesiredPassword 'x' } | Should -Not -Throw
  }
}
