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
#   .\scripts\ai-qa.ps1 -ShowLog                         # stream codex's own output too
#   .\scripts\ai-qa.ps1 -DryRun                          # print the codex invocation only
#
# Findings land in .ai-qa/qa-<timestamp>.md, codex's own chatter in the matching .log
# (both gitignored). Only the findings are printed.
#
# Exit codes, so a wrapper can gate on this:
#   0  review completed, verdict GO
#   1  could not review (suites red, codex missing, no usable output)
#   2  review completed but is missing the verdict or the manual-test list - not a pass
#   3  review completed, verdict NO-GO
#
# Notes:
# - Codex prints its banner to stderr, so PowerShell 5.1 may report a non-zero exit code
#   even on success. The output FILE is the source of truth, not $LASTEXITCODE - but it
#   only counts if THIS run wrote it (see the staleness guard below).
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

    [switch]$ShowLog,

    [string]$OutFile,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    # -----------------------------------------------------------------------
    # 1 - Where the findings go
    # -----------------------------------------------------------------------
    $outDir = Join-Path $repoRoot '.ai-qa'
    if (-not $OutFile) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $OutFile = Join-Path $outDir "qa-$stamp.md"
    }
    # Append rather than swap the extension: -OutFile "run.log" would otherwise make the
    # codex session log and the findings file the same path, and the log could then pass
    # the freshness check and be reported as the review.
    $logFile = "$OutFile.log"
    $verdictFile = "$OutFile.verdict"

    # -----------------------------------------------------------------------
    # 2 - The repo's standing orders, as a checklist for pass two
    #
    # This canNOT be handed to `codex exec review`: that subcommand rejects a PROMPT
    # together with --base/--uncommitted outright ("the argument '[PROMPT]' cannot be
    # used with '--base <BRANCH>'"), and silently ignores a piped one. Pass one is
    # therefore the built-in, project-blind reviewer; everything this repo knows about
    # its own failure modes goes into pass two, which also produces the verdict.
    # -----------------------------------------------------------------------
    $issueLine = ''
    if ($Issue) {
        $issueLine = "Endringen hoerer til issue #$Issue. Les issuen (gh issue view $Issue) og vurder ogsaa om spesifikasjonen faktisk er oppfylt."
    }
    $focusLine = ''
    if ($Focus) {
        $focusLine = "Ekstra fokus fra forfatteren: $Focus"
    }

    $checklist = @"
Rollen din: du er QA-gaten foran en staging-deploy i repoet a2-assessment-platform (Express +
Prisma + PostgreSQL, statisk frontend under public/, Azure App Service). De automatiserte testene
er allerede groenne. Jobben din er aa finne det som ellers foerst ville blitt oppdaget ved manuell
testing paa stage - hvert treff sparer en deploy-runde paa 16-22 minutter.

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

For hvert funn: fil:linje, hva som er galt, og et KONKRET scenario der det feiler (input eller
klikkrekkefoelge -> feil resultat). Ingen funn uten et scenario. Faa og sikre funn slaar mange
usikre. Ikke gjenfortell diffen. Ikke stilkommentarer.

Svar paa norsk.
"@

    # -----------------------------------------------------------------------
    # 3 - Build the invocation
    # -----------------------------------------------------------------------
    # No PROMPT here, by force: codex rejects one alongside a scope flag. Pass one gets
    # the diff and nothing else; the checklist rides along in pass two.
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
    $codexArgs += @('-m', $Model, '-c', "model_reasoning_effort=$Effort", '-o', $OutFile)

    # -DryRun is a diagnostic: it must not run the suites, and must not require codex
    # to be installed. Keep it ahead of every precondition and side effect.
    if ($DryRun) {
        Write-Host ""
        Write-Host "PASS 1: codex $($codexArgs -join ' ')" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "PASS 2 prompt (checklist + verdict, on stdin):" -ForegroundColor Yellow
        Write-Host $checklist
        exit 0
    }

    # -----------------------------------------------------------------------
    # 4 - Preconditions
    # -----------------------------------------------------------------------
    $codexCmd = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $codexCmd) {
        Write-Host "codex CLI not found on PATH. Install with: npm install -g @openai/codex" -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Path $outDir | Out-Null
    }

    # -----------------------------------------------------------------------
    # 5 - Automated tests must be green before we spend a review on this
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
    # 6 - Invoke Codex
    #
    # Staleness guard: a reused -OutFile must never be mistaken for this run's result.
    # Delete it up front, then require a file written after we started - otherwise a
    # failed invocation (auth, model, network) would re-print an older "VERDIKT: GO".
    # -----------------------------------------------------------------------
    if (Test-Path $OutFile) {
        Remove-Item $OutFile -Force
    }
    $startedAt = Get-Date

    Write-Host ""
    Write-Host "Pass 1/2 - built-in review: codex $($codexArgs -join ' ')" -ForegroundColor Cyan
    Write-Host "This takes a few minutes at effort=$Effort. Codex log: $logFile" -ForegroundColor DarkGray

    # Codex is chatty on both streams; keep the console for the findings. EAP is relaxed
    # so PS 5.1 does not turn banner-on-stderr into a terminating NativeCommandError.
    # Empty stdin is deliberate: codex exec hangs on an open TTY stdin, and this
    # subcommand will not accept a prompt anyway.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    if ($ShowLog) {
        '' | & codex @codexArgs 2>&1 | Tee-Object -FilePath $logFile
    }
    else {
        '' | & codex @codexArgs 2>&1 | Out-File -FilePath $logFile -Encoding utf8
    }
    $codexExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap

    if (-not (Test-Path $OutFile)) {
        Write-Host ""
        Write-Host "No findings file at $OutFile - the review did not complete (codex exit $codexExit)." -ForegroundColor Red
        Write-Host "See $logFile for what codex said." -ForegroundColor Red
        exit 1
    }
    if ((Get-Item $OutFile).LastWriteTime -lt $startedAt) {
        Write-Host ""
        Write-Host "Findings file at $OutFile predates this run - refusing to report a stale review." -ForegroundColor Red
        exit 1
    }
    # UTF8 explicitly: PS 5.1 decodes a BOM-less UTF-8 file with the legacy code page,
    # which turns every Norwegian character in the report into mojibake.
    $findings = Get-Content $OutFile -Raw -Encoding UTF8
    if (-not $findings -or $findings.Trim().Length -eq 0) {
        Write-Host ""
        Write-Host "Findings file is empty - the review did not complete (codex exit $codexExit)." -ForegroundColor Red
        Write-Host "See $logFile for what codex said." -ForegroundColor Red
        exit 1
    }

    # -----------------------------------------------------------------------
    # 7 - Pass two: the repo's own checklist, plus the verdict and test plan
    #
    # Pass one is project-blind (it takes no instructions). This pass carries what
    # this repo knows about its own failure modes, sees pass one's findings so it
    # does not repeat them, and owns the output contract.
    # -----------------------------------------------------------------------
    $scopeCmd = "git diff $Base...HEAD"
    $scope = "endringene mot $Base"
    if ($Uncommitted) {
        $scopeCmd = 'git status --short; git diff HEAD'
        $scope = 'de ucommittede endringene i arbeidskopien'
    }
    elseif ($Commit) {
        $scopeCmd = "git show $Commit"
        $scope = "endringene i commit $Commit"
    }

    $verdictPrompt = @"
$checklist

ARBEIDSMAATE: se paa $scope selv - start med "$scopeCmd" - og les de beroerte filene og deres
soesterfiler. En foerste, prosjektblind gjennomgang er allerede kjoert, og funnene staar nederst.
Ikke gjenta dem; let etter det den ikke kunne vite, altsaa punktene i sjekklista over.

Svaret MAA vaere paa norsk og slutte med noeyaktig disse to seksjonene:

VERDIKT: GO
eller
VERDIKT: NO-GO
Foelg linjen med en setnings begrunnelse. NO-GO betyr at minst ett funn boer fikses foer deploy -
vurder bade dine egne funn og de fra foerste gjennomgang.

IKKE VERIFISERBART STATISK:
- punktliste over det en person faktisk maa klikke gjennom paa stage for aa avdekke resten.
Dette blir den reelle testplanen for den manuelle runden, saa vaer konkret (hvilken side, hvilken
handling, hva som skal skje) og utelat alt som allerede er dekket av automatiske tester. Skriv
"- ingenting" hvis testene faktisk dekker alt.

FUNN FRA FOERSTE, PROSJEKTBLINDE GJENNOMGANG:
$findings
"@

    Write-Host ""
    Write-Host "Pass 2/2 - repo checklist, verdict and manual test plan..." -ForegroundColor Cyan
    if (Test-Path $verdictFile) {
        Remove-Item $verdictFile -Force
    }
    $ErrorActionPreference = 'Continue'
    $verdictPrompt | & codex exec --sandbox read-only -m $Model -c "model_reasoning_effort=$Effort" -o $verdictFile 2>&1 |
        Out-File -FilePath $logFile -Encoding utf8 -Append
    $ErrorActionPreference = $prevEap

    $verdict = ''
    if ((Test-Path $verdictFile) -and ((Get-Item $verdictFile).LastWriteTime -ge $startedAt)) {
        $verdict = Get-Content $verdictFile -Raw -Encoding UTF8
    }

    Write-Host ""
    Write-Host "---------------- QA findings ----------------" -ForegroundColor Green
    Write-Host $findings
    if ($verdict -and $verdict.Trim().Length -gt 0) {
        Write-Host $verdict
        Add-Content -Path $OutFile -Value "`r`n$verdict" -Encoding UTF8
    }
    Write-Host "---------------------------------------------" -ForegroundColor Green
    Write-Host "Saved to $OutFile"

    # Both closing sections are mandatory: a verdict without the manual test plan drops
    # the very thing that replaces a stage round. Match at line start, so the words
    # merely being quoted inside a finding does not satisfy the check.
    # The manual-test section must have a BODY, not just its heading: a pass-two run cut
    # short right after printing the heading would otherwise read as a complete review
    # with an empty test plan - the exact outcome exit code 2 exists to prevent.
    $missing = @()
    if ($verdict -notmatch '(?m)^\s*VERDIKT:\s*(GO|NO-GO)') { $missing += 'VERDIKT' }
    # The colon is required, not optional: with ':?' the trailing '\S' happily matched the
    # colon itself, so a bare heading passed - verified against both cases before landing.
    # (\r?\n[ \t]*)+ rather than a single newline: the model usually leaves a BLANK line
    # between the heading and its first bullet, and the stricter pattern reported a complete
    # review as incomplete. Table-tested against heading-only, heading+blank, blank-then-item,
    # item-directly-under, same-line and quoted-mention.
    if ($verdict -notmatch '(?im)^[ \t]*IKKE VERIFISERBART STATISK[ \t]*:[ \t]*(\S|(\r?\n[ \t]*)+\S)') { $missing += 'IKKE VERIFISERBART STATISK' }
    if ($missing.Count -gt 0) {
        Write-Host ""
        Write-Host "Incomplete review - missing: $($missing -join ', ')." -ForegroundColor Red
        Write-Host "Judge the findings and plan the stage round yourself; do not treat this as a pass." -ForegroundColor Red
        exit 2
    }
    Write-Host ""
    Write-Host "Reminder: a GO here is a review verdict, not a test result. The e2e for the" -ForegroundColor DarkGray
    Write-Host "primary flow still has to pass locally before the stage deploy." -ForegroundColor DarkGray

    if ($verdict -match '(?m)^\s*VERDIKT:\s*NO-GO') {
        exit 3
    }
    # Explicit: falling off the end would leave codex's own $LASTEXITCODE - which this
    # script deliberately tolerates as non-zero - visible to a caller as the gate's status.
    exit 0
}
finally {
    Pop-Location
}
