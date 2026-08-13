# scripts/ai-qa.ps1
#
# Cross-model QA gate: let Codex review a change AFTER the automated tests are green
# and BEFORE it is deployed to stage. The point is to catch the "correct fix, incomplete
# surface" and client-layer bugs that would otherwise cost a 16-22 min deploy plus a
# manual test round on staging.
#
# This is a REVIEW gate, not a replacement for the e2e (see CLAUDE.md standing orders).
# It runs the automated suites first and refuses to call Codex if they are red - a
# review of broken code is wasted tokens.
#
# Usage:
#   .\scripts\ai-qa.ps1                                  # review branch vs main
#   .\scripts\ai-qa.ps1 -Uncommitted                     # review the working tree
#   .\scripts\ai-qa.ps1 -Issue 896 -Focus "fanebytte med ulagrede endringer"
#   .\scripts\ai-qa.ps1 -SkipTests                       # tests already run in this session
#   .\scripts\ai-qa.ps1 -IncludeE2E                      # also run the admin-content e2e first
#   .\scripts\ai-qa.ps1 -DryRun                          # print the codex invocation only
#
# Output lands in .ai-qa/qa-<timestamp>.md (gitignored) and is echoed to the console.
#
# Notes:
# - Codex prints its banner to stderr, so PowerShell 5.1 may report a non-zero exit code
#   even on success. The output FILE is the source of truth, not $LASTEXITCODE.
# - The prompt is piped on stdin rather than passed as an argument: it avoids PS 5.1
#   quote mangling, and it also closes stdin (codex exec hangs on an open TTY stdin).

param(
    [string]$Base = 'main',

    [switch]$Uncommitted,

    [string]$Commit,

    [string]$Issue,

    [string]$Focus,

    [string]$Model = 'gpt-5.6-sol',

    [ValidateSet('low', 'medium', 'high', 'xhigh')]
    [string]$Effort = 'high',

    [switch]$SkipTests,

    [switch]$IncludeE2E,

    [string]$OutFile,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    # -----------------------------------------------------------------------
    # 0 - Preconditions
    # -----------------------------------------------------------------------
    $codexCmd = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $codexCmd) {
        Write-Host "codex CLI not found on PATH. Install with: npm install -g @openai/codex" -ForegroundColor Red
        exit 1
    }

    # -----------------------------------------------------------------------
    # 1 - Automated tests must be green before we spend a review on this
    # -----------------------------------------------------------------------
    if (-not $SkipTests) {
        $suites = @(
            @{ Name = 'Typecheck (tsc --noEmit)'; Args = @('run', 'lint') },
            @{ Name = 'Unit tests';               Args = @('run', 'test:unit') },
            @{ Name = 'DOM tests';                Args = @('run', 'test:dom') }
        )
        if ($IncludeE2E) {
            $suites += @{ Name = 'Admin-content e2e'; Args = @('run', 'test:e2e:admin-content') }
        }

        foreach ($suite in $suites) {
            Write-Host ""
            Write-Host "-- $($suite.Name) --" -ForegroundColor Cyan
            & npm @($suite.Args)
            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "$($suite.Name) failed. Fix it before asking for QA - a review of red code is wasted." -ForegroundColor Red
                exit 1
            }
        }
        Write-Host ""
        Write-Host "Automated suites green. Handing the diff to Codex." -ForegroundColor Green
    }
    else {
        Write-Host "-SkipTests set: assuming the automated suites are already green." -ForegroundColor Yellow
    }

    # -----------------------------------------------------------------------
    # 2 - Where the findings go
    # -----------------------------------------------------------------------
    $outDir = Join-Path $repoRoot '.ai-qa'
    if (-not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Path $outDir | Out-Null
    }
    if (-not $OutFile) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $OutFile = Join-Path $outDir "qa-$stamp.md"
    }

    # -----------------------------------------------------------------------
    # 3 - Review instructions - the repo's standing orders, as a checklist
    # -----------------------------------------------------------------------
    $issueLine = ''
    if ($Issue) {
        $issueLine = "Endringen hoerer til issue #$Issue. Les issuen (gh issue view $Issue) og vurder ogsaa om spesifikasjonen faktisk er oppfylt."
    }
    $focusLine = ''
    if ($Focus) {
        $focusLine = "Ekstra fokus fra forfatteren: $Focus"
    }

    $prompt = @"
Du er QA-gaten foran en staging-deploy i repoet a2-assessment-platform (Express + Prisma +
PostgreSQL, statisk frontend under public/, Azure App Service). De automatiserte testene er
allerede groenne. Din jobb er aa finne det som ellers foerst ville blitt oppdaget ved manuell
testing paa stage - hver treff sparer en deploy-runde paa 16-22 minutter.

$issueLine
$focusLine

Prioriter disse feilklassene, i denne rekkefoelgen:

1. UFULLSTENDIG FLATE. Repoets vanligste feil er "riktig fiks, ufullstendig flate": endringen
   treffer den ene kodestien i skjermbildet, mens soesterstier gaar i stykker. Sjekk
   doc/FEATURE_SURFACE_MAP.md og let etter andre inngangsporter til den samme oppfoerselen
   (modulopprettelse har to innganger, modultype velges tre steder, livssyklus finnes paa tre
   entiteter). Nevn konkret hvilken flate som mangler.

2. KLIENTLAGET, som supertest ikke ser: i18n-noekler som rendres raatt i stedet for aa slaa opp,
   fetch/headere (inkl. multipart sendt som JSON), CSP, <img> mot autentiserte endepunkter,
   rendering og CSS.

3. .hidden-fella. Betinget synlighet MAA bruke setHidden(el, on) fra public/static/dom-visibility.js
   eller inline style.display. Klassen .hidden / attributtet [hidden] taper cascaden mot elementer
   som har en display-settende klasse (.row/.card/.content-card/grid), og elementet skjules aldri.

4. LOKALISERING. Skillet mellom ren streng (= uoversatt) og lokalisert objekt maa overleve
   (#892). Se etter kode som fyller alle tre spraak med samme kildetekst, og etter forveksling
   av currentLocale / previewLocale / editingLocale.

5. BACKEND-HYGIENE: Zod-validering paa alle request-body, eierskaps- og rollesjekk paa nye
   endepunkter, og expand/contract-sikre migrasjoner (additivt i denne deployen, destruktivt
   foerst i neste).

6. LEVERANSEKRAV: er package.json og doc/VERSIONS.md bumpet? Er e2e for hovedflyten med i samme
   endring? Er doc/API_REFERENCE.md og doc/route-map.md oppdatert hvis rute- eller API-flaten
   endret seg?

Slik vil jeg ha svaret:

- Rangert liste med funn, alvorligst foerst. For hvert funn: fil:linje, hva som er galt, og et
  KONKRET scenario der det feiler (input eller klikkrekkefoelge -> feil resultat). Ingen funn uten
  et scenario.
- Faa og sikre funn slaar mange usikre. Ikke gjenfortell diffen. Ikke stilkommentarer.
- Avslutt med en linje "VERDIKT: GO" eller "VERDIKT: NO-GO" for staging-deploy, med en setnings
  begrunnelse.
- Deretter en kort liste "Ikke verifiserbart statisk" over det som fortsatt maa sjekkes manuelt
  paa stage. Vaer aerlig her - det er den lista jeg planlegger den manuelle testingen etter.

Svar paa norsk.
"@

    # -----------------------------------------------------------------------
    # 4 - Invoke Codex
    # -----------------------------------------------------------------------
    $codexArgs = @('exec', 'review')
    if ($Uncommitted) {
        $codexArgs += '--uncommitted'
    }
    elseif ($Commit) {
        $codexArgs += @('--commit', $Commit)
    }
    else {
        $codexArgs += @('--base', $Base)
    }
    if ($Issue) {
        $codexArgs += @('--title', "QA #$Issue")
    }
    $codexArgs += @('-m', $Model, '-c', "model_reasoning_effort=$Effort", '-o', $OutFile)

    if ($DryRun) {
        Write-Host ""
        Write-Host "codex $($codexArgs -join ' ')" -ForegroundColor Yellow
        Write-Host "--- prompt on stdin ---"
        Write-Host $prompt
        exit 0
    }

    Write-Host ""
    Write-Host "Running: codex $($codexArgs -join ' ')" -ForegroundColor Cyan
    Write-Host "This takes a few minutes at effort=$Effort." -ForegroundColor DarkGray

    $prompt | & codex @codexArgs

    # Codex writes its banner to stderr; PS 5.1 may report failure on a successful run.
    # The output file is the source of truth.
    if (-not (Test-Path $OutFile)) {
        Write-Host ""
        Write-Host "No output file at $OutFile - the review did not complete." -ForegroundColor Red
        exit 1
    }
    $findings = Get-Content $OutFile -Raw
    if (-not $findings -or $findings.Trim().Length -eq 0) {
        Write-Host ""
        Write-Host "Output file is empty - the review did not complete." -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "---------------- QA findings ----------------" -ForegroundColor Green
    Write-Host $findings
    Write-Host "---------------------------------------------" -ForegroundColor Green
    Write-Host "Saved to $OutFile"
    Write-Host ""
    Write-Host "Reminder: a GO here is a review verdict, not a test result. The e2e for the" -ForegroundColor DarkGray
    Write-Host "primary flow still has to pass locally before the stage deploy." -ForegroundColor DarkGray
}
finally {
    Pop-Location
}
