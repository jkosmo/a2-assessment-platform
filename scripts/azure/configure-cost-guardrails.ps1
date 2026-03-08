param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentName,
  [double]$MonthlyBudgetAmount = 30,
  [string]$BudgetContactEmail = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $BudgetContactEmail) {
  Write-Host "No BudgetContactEmail provided. Skipping budget configuration."
  exit 0
}

$startDate = (Get-Date -Day 1 -Hour 0 -Minute 0 -Second 0).ToString("yyyy-MM-dd")
$endDate = (Get-Date).AddYears(1).ToString("yyyy-MM-dd")
$budgetName = "a2-assessment-$EnvironmentName-budget"

$notification = @{
  enabled = $true
  operator = "GreaterThan"
  threshold = 80
  thresholdType = "Actual"
  contactEmails = @($BudgetContactEmail)
}

Write-Host "Configuring budget $budgetName on subscription $SubscriptionId..."

az consumption budget create `
  --subscription $SubscriptionId `
  --budget-name $budgetName `
  --amount $MonthlyBudgetAmount `
  --category cost `
  --time-grain Monthly `
  --start-date $startDate `
  --end-date $endDate `
  --notifications "{`"default80`":$(($notification | ConvertTo-Json -Compress))}" | Out-Null

Write-Host "Budget configured: $budgetName"

