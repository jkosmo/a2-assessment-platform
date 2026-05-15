# scripts/ai-draft.ps1
#
# Orchestrate Codex or Gemini to draft code changes, then run automated QA.
#
# Usage:
#   .\scripts\ai-draft.ps1 -Task "Legg til rate-limiting på POST /api/modules" -Tier medium
#   .\scripts\ai-draft.ps1 -Task "..." -Tier security -Agent gemini
#   .\scripts\ai-draft.ps1 -Task "..." -DryRun   # vis kommando uten å kjøre
#
# Tier-matrise:
#   simple   — boilerplate, tester, små CRUD-endringer
#   medium   — nye features, refactoring (DEFAULT)
#   complex  — flerfil-arkitektur, migrasjoner
#   security — sikkerhetskritisk, auth, infra

param(
    [Parameter(Mandatory)]
    [string]$Task,

    [ValidateSet('simple', 'medium', 'complex', 'security')]
    [string]$Tier = 'medium',

    [ValidateSet('codex', 'gemini', 'auto')]
    [string]$Agent = 'codex',

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Modell-matrise
# ---------------------------------------------------------------------------
$codexMatrix = @{
    simple   = @{ model = 'o4-mini'; effort = 'low'    }
    medium   = @{ model = 'o4-mini'; effort = 'high'   }
    complex  = @{ model = 'o3';      effort = 'medium' }
    security = @{ model = 'o3';      effort = 'xhigh'  }
}
$geminiMatrix = @{
    simple   = 'gemini-2.5-flash'
    medium   = 'gemini-2.5-flash'
    complex  = 'gemini-2.5-pro'
    security = 'gemini-2.5-pro'
}

# Auto-velg agent: Gemini ved complex/security (stort kontekstvindu hjelper),
# Codex ellers (presis filredigering med sandbox-beskyttelse).
if ($Agent -eq 'auto') {
    $Agent = if ($Tier -in 'complex', 'security') { 'gemini' } else { 'codex' }
}

# ---------------------------------------------------------------------------
# Bygg prompt med prosjekt-kontekst
# ---------------------------------------------------------------------------
$promptPreamble = @"
Du jobber i repositoriet a2-assessment-platform (Next.js + Prisma + PostgreSQL pa Azure App Service).
Konvensjoner: TypeScript strict, Zod-validering pa alle request-body, ingen ukommentert kode,
bumpe package.json versjon og doc/VERSIONS.md i samme commit som kodeendringer.
Kjor IKKE tester eller git-kommandoer — bare rediger filer.

OPPGAVE:
$Task
"@

# ---------------------------------------------------------------------------
# Kjør agent
# ---------------------------------------------------------------------------
Write-Host "`n=== AI-DRAFT ===" -ForegroundColor Cyan
Write-Host "Agent : $Agent" -ForegroundColor Cyan
Write-Host "Tier  : $Tier" -ForegroundColor Cyan

if ($Agent -eq 'codex') {
    $m = $codexMatrix[$Tier]
    $codexCmd = "codex exec --sandbox workspace-write -m `"$($m.model)`" -c model_reasoning_effort=`"$($m.effort)`" `"$promptPreamble`""
    Write-Host "Modell: $($m.model), effort=$($m.effort)" -ForegroundColor Cyan
    Write-Host "`nKjorer: codex exec --sandbox workspace-write -m $($m.model) -c model_reasoning_effort=$($m.effort) [prompt]`n"
    if (-not $DryRun) {
        codex exec --sandbox workspace-write -m "$($m.model)" -c "model_reasoning_effort=`"$($m.effort)`"" "$promptPreamble"
    }
} else {
    $model = $geminiMatrix[$Tier]
    Write-Host "Modell: $model" -ForegroundColor Cyan
    Write-Host "`nKjorer: gemini --approval-mode yolo -m $model -p [prompt]`n"
    if (-not $DryRun) {
        gemini --approval-mode yolo -m "$model" -p "$promptPreamble"
    }
}

if ($DryRun) {
    Write-Host "`n[DryRun] Ingen endringer gjort." -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------------------
# Automatisk QA etter agent er ferdig
# ---------------------------------------------------------------------------
Write-Host "`n=== QA-RAPPORT ===" -ForegroundColor Cyan

Write-Host "`n--- git diff --stat ---" -ForegroundColor Yellow
git diff --stat HEAD

Write-Host "`n--- TypeScript ---" -ForegroundColor Yellow
$tscResult = npx tsc --noEmit 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "OK — ingen TypeScript-feil" -ForegroundColor Green
} else {
    Write-Host "FEIL:" -ForegroundColor Red
    Write-Host $tscResult
}

Write-Host "`n--- Enhetstester ---" -ForegroundColor Yellow
npx vitest run test/unit/ 2>&1 | Select-String -Pattern 'Test Files|Tests |failed|passed' | Select-Object -Last 3

Write-Host "`n=== Klar for Claude-gjennomgang ===" -ForegroundColor Cyan
Write-Host "Kjor: git diff HEAD for full diff"
