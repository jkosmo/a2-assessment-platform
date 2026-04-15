[CmdletBinding()]
param(
  [string]$EnvironmentName = "production",
  [string]$ResourceGroup = "rg-a2-assessment-production",
  [string]$ServerName = "a2-assessment-platform-prd-pg-hea5kl",
  [string]$DatabaseName = "a2assessment",
  [string]$AdminUsername = "a2platformadmin",
  [string]$AdminPassword,
  [string]$StorageAccountName = "a2prdrestorehea5kl",
  [string]$ContainerName = "logical-exports",
  [string]$ChangeLabel,
  [string]$IncidentOrChangeReference,
  [string]$OutputDirectory = ".artifacts/logical-exports",
  [switch]$SkipUpload
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Sanitize-Label {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return "manual-change"
  }

  $trimmed = $Value.Trim().ToLowerInvariant()
  return ($trimmed -replace "[^a-z0-9\\-]+", "-").Trim("-")
}

Require-Command "az"
Require-Command "pg_dump"

$resolvedOutputDirectory = Resolve-Path -LiteralPath $OutputDirectory -ErrorAction SilentlyContinue
if (-not $resolvedOutputDirectory) {
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $resolvedOutputDirectory = Resolve-Path -LiteralPath $OutputDirectory
}

$exportTimestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$safeChangeLabel = Sanitize-Label $ChangeLabel
$safeReference = Sanitize-Label $IncidentOrChangeReference
$baseFileName = "$EnvironmentName-$DatabaseName-$exportTimestamp-$safeChangeLabel"
$dumpPath = Join-Path $resolvedOutputDirectory "$baseFileName.dump"
$checksumPath = Join-Path $resolvedOutputDirectory "$baseFileName.sha256"
$manifestPath = Join-Path $resolvedOutputDirectory "$baseFileName.manifest.json"
$hostName = "$ServerName.postgres.database.azure.com"
$pgUser = if ($AdminUsername -match "@") { $AdminUsername } else { "$AdminUsername@$ServerName" }

if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  if (-not [string]::IsNullOrWhiteSpace($env:PGPASSWORD)) {
    $AdminPassword = $env:PGPASSWORD
  } else {
    $securePassword = Read-Host -AsSecureString "Enter PostgreSQL admin password for $pgUser"
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
      $AdminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  throw "Admin password is required."
}

Write-Host "Creating logical export for $EnvironmentName..."
Write-Host "Server: $ServerName"
Write-Host "Database: $DatabaseName"
Write-Host "Output: $dumpPath"

$previousPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE

try {
  $env:PGPASSWORD = $AdminPassword
  $env:PGSSLMODE = "require"

  & pg_dump `
    --host=$hostName `
    --port=5432 `
    --username=$pgUser `
    --format=custom `
    --compress=9 `
    --blobs `
    --no-owner `
    --no-privileges `
    --file=$dumpPath `
    $DatabaseName

  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed with exit code $LASTEXITCODE."
  }
} finally {
  $env:PGPASSWORD = $previousPassword
  $env:PGSSLMODE = $previousSslMode
}

$hash = Get-FileHash -Path $dumpPath -Algorithm SHA256
"$($hash.Hash.ToLowerInvariant()) *$([System.IO.Path]::GetFileName($dumpPath))" | Set-Content -Encoding ascii $checksumPath

$manifest = [ordered]@{
  exportedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  environment = $EnvironmentName
  resourceGroup = $ResourceGroup
  serverName = $ServerName
  hostName = $hostName
  databaseName = $DatabaseName
  dumpFormat = "pg_dump custom"
  dumpFile = [System.IO.Path]::GetFileName($dumpPath)
  sha256File = [System.IO.Path]::GetFileName($checksumPath)
  sha256 = $hash.Hash.ToLowerInvariant()
  changeLabel = $ChangeLabel
  changeReference = $IncidentOrChangeReference
  operator = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  storageAccount = if ($SkipUpload) { $null } else { $StorageAccountName }
  container = if ($SkipUpload) { $null } else { $ContainerName }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $manifestPath

$blobPrefix = "$EnvironmentName/$($safeReference)/$exportTimestamp"
if (-not $SkipUpload) {
  az storage container create `
    --account-name $StorageAccountName `
    --name $ContainerName `
    --auth-mode login `
    --public-access off `
    --output none | Out-Null

  foreach ($filePath in @($dumpPath, $checksumPath, $manifestPath)) {
    $blobName = "$blobPrefix/$([System.IO.Path]::GetFileName($filePath))"
    az storage blob upload `
      --account-name $StorageAccountName `
      --container-name $ContainerName `
      --name $blobName `
      --file $filePath `
      --auth-mode login `
      --overwrite true `
      --output none | Out-Null
  }
}

[pscustomobject]@{
  dumpPath = $dumpPath
  checksumPath = $checksumPath
  manifestPath = $manifestPath
  storageAccount = if ($SkipUpload) { $null } else { $StorageAccountName }
  container = if ($SkipUpload) { $null } else { $ContainerName }
  blobPrefix = if ($SkipUpload) { $null } else { $blobPrefix }
  sha256 = $hash.Hash.ToLowerInvariant()
} | Format-List
