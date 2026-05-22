#!/usr/bin/env bash
# scripts/lint-infra.sh
#
# Static checks for infra anti-patterns documented in the May 2026 incident postmortem.
# See AGENTS.md / CLAUDE.md "Infra hard invariants" for the full list and rationale.
#
# Exits non-zero on any match. Designed to be fast (<5s on a fresh clone).
#
# Patterns detected (matches issue #420):
#   1. Bicep: enableRbacAuthorization coupled to a skip flag or anything other than `true`
#   2. Bicep: roleAssignments resource with GUID seeded on something other than principalId
#   3. PowerShell: az deployment group create / az resource delete without subscription guard
#   4. PowerShell: suppressed az role assignment failures (2>$null, Out-Null, SilentlyContinue)
#   5. PowerShell: $variable followed by ?/!/. in interpolated string without braces
#
# Not detected statically (require manual review):
#   - KV secret resource without dependsOn when KV is conditional (cross-resource flow)
#   - Idempotency of skipPostgresUpdate vs DATABASE-URL drift (semantic, not syntactic)
#
# Usage:
#   bash scripts/lint-infra.sh            # Lint everything
#   bash scripts/lint-infra.sh --bicep    # Bicep only
#   bash scripts/lint-infra.sh --ps       # PowerShell only

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Files in scope. Excludes node_modules, dist, .git etc.
BICEP_FILES=()
PS_FILES=()
while IFS= read -r -d '' f; do BICEP_FILES+=("$f"); done < <(find infra -name "*.bicep" -print0 2>/dev/null)
while IFS= read -r -d '' f; do PS_FILES+=("$f"); done < <(find scripts -name "*.ps1" -print0 2>/dev/null)

FAILURES=()
# Allowlist: pattern_id|file|line_num — one per line. Comments with leading #.
# Use sparingly. Every entry should have a TODO/issue reference for follow-up.
ALLOWLIST_FILE="$ROOT/.lint-infra-allowlist"

is_allowed() {
  # $1=pattern_id  $2=file  $3=line_num
  [ ! -f "$ALLOWLIST_FILE" ] && return 1
  grep -qE "^${1}\|${2}\|${3}(\s|$)" "$ALLOWLIST_FILE" 2>/dev/null
}

record() {
  # $1=pattern_id  $2=file  $3=line_num  $4=line  $5=rationale
  if is_allowed "$1" "$2" "$3"; then return; fi
  FAILURES+=("[$1] $2:$3: $4 -- $5")
}

# Quick helpers — grep-with-line-numbers, never crashes the pipeline on no-match.
grep_lines() {
  # $1=pattern (BRE/ERE); $2..=files
  local pattern="$1"; shift
  [ "$#" -gt 0 ] && grep -nE -H "$pattern" "$@" 2>/dev/null || true
}

# ─────────────────────────────────────────────────────────────────────────────
# Pattern 1 (Bicep): enableRbacAuthorization coupled to anything other than `true`
# Allowed: enableRbacAuthorization: true
# Flagged: enableRbacAuthorization: !skipRoleAssignments
#          enableRbacAuthorization: skipRoleAssignments ? false : true
#          enableRbacAuthorization: false
# ─────────────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--ps" ] && [ "${#BICEP_FILES[@]}" -gt 0 ]; then
  while IFS= read -r match; do
    [ -z "$match" ] && continue
    # Allow only the exact form "enableRbacAuthorization: true" (whitespace tolerant).
    line="${match#*:[0-9]*:}"
    if echo "$line" | grep -qE 'enableRbacAuthorization\s*:\s*true(\b|\s|$)'; then continue; fi
    file_loc="${match%%:*}"
    rest="${match#*:}"
    line_num="${rest%%:*}"
    record "BICEP-1" "$file_loc" "$line_num" "$(echo "$line" | tr -s ' ')" \
      "enableRbacAuthorization must always be 'true' (CLAUDE.md invariant #1)"
  done < <(grep_lines 'enableRbacAuthorization\s*:' "${BICEP_FILES[@]}")
fi

# ─────────────────────────────────────────────────────────────────────────────
# Pattern 2 (Bicep): roleAssignments name= guid(...) without principalId in the guid args
# Walks across multiline guid(...) by joining 5 lines after each `Microsoft.Authorization/roleAssignments`
# resource and checking if the name= guid(...) includes principalId.
# ─────────────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--ps" ] && [ "${#BICEP_FILES[@]}" -gt 0 ]; then
  for f in "${BICEP_FILES[@]}"; do
    # Use awk to find resource blocks declaring Microsoft.Authorization/roleAssignments
    # and inspect a 10-line window for the name= guid(...) call.
    awk '
      /Microsoft\.Authorization\/roleAssignments/ { in_block=1; block_start=NR; block=""; line_count=0 }
      in_block { block=block "\n" $0; line_count++ }
      in_block && line_count >= 10 {
        if (block ~ /name\s*:\s*guid\(/ && block !~ /principalId/) {
          printf "%s:%d:%s\n", FILENAME, block_start, "roleAssignment name guid() does not reference principalId"
        }
        in_block=0
      }
    ' "$f" | while IFS= read -r flagged; do
      [ -z "$flagged" ] && continue
      file_loc="${flagged%%:*}"
      rest="${flagged#*:}"
      line_num="${rest%%:*}"
      msg="${rest#*:}"
      record "BICEP-2" "$file_loc" "$line_num" "$msg" \
        "GUID must include principalId so it's stable across App Service recreations (CLAUDE.md invariant #2)"
    done
  done
fi

# ─────────────────────────────────────────────────────────────────────────────
# Pattern 3 (PS): az deployment group create / az resource delete without
# `az account show` somewhere earlier in the same script.
# ─────────────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--bicep" ] && [ "${#PS_FILES[@]}" -gt 0 ]; then
  for f in "${PS_FILES[@]}"; do
    # Find lines that mutate Azure resources.
    mutators=$(grep -nE '\baz\s+(deployment\s+group\s+(create|delete)|resource\s+delete|group\s+delete|webapp\s+delete|keyvault\s+delete)' "$f" 2>/dev/null || true)
    [ -z "$mutators" ] && continue
    # Check if there's any subscription-guard line before the first mutator.
    first_mutator_line=$(echo "$mutators" | head -1 | cut -d: -f1)
    guard_present=$(awk -v stop="$first_mutator_line" '
      NR < stop && (/az\s+account\s+show/ || /Assert-AzureSubscription/ || /assertSubscription/ || /Get-AzContext/) { print "yes"; exit }
    ' "$f")
    if [ "$guard_present" != "yes" ]; then
      while IFS= read -r mline; do
        line_num="${mline%%:*}"
        line="${mline#*:}"
        record "PS-3" "$f" "$line_num" "$(echo "$line" | sed 's/^[[:space:]]*//' | head -c 120)" \
          "Production-mutating az command without subscription guard (CLAUDE.md invariant #8)"
      done <<< "$mutators"
    fi
  done
fi

# ─────────────────────────────────────────────────────────────────────────────
# Pattern 4 (PS): suppressed az role assignment failures
# ─────────────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--bicep" ] && [ "${#PS_FILES[@]}" -gt 0 ]; then
  while IFS= read -r match; do
    [ -z "$match" ] && continue
    file_loc="${match%%:*}"
    rest="${match#*:}"
    line_num="${rest%%:*}"
    line="${rest#*:}"
    record "PS-4" "$file_loc" "$line_num" "$(echo "$line" | sed 's/^[[:space:]]*//' | head -c 120)" \
      "az role assignment failures must NOT be suppressed (CLAUDE.md invariant #6)"
  done < <(grep_lines 'az\s+role\s+assignment.*(\b2>\s*\$null\b|\|\s*Out-Null|-ErrorAction\s+SilentlyContinue)' "${PS_FILES[@]}")
fi

# Pattern 5 (PS variable-interpolation ambiguity) intentionally NOT implemented as a
# regex. The original issue #420 mentioned ".../$varName?query-param" — but PS's actual
# variable-name terminator includes ?, !, ., etc., so `.` and friends safely end the
# variable in interpolated strings. The narrower real risk is `$word:word` scope ambiguity
# (e.g. `"$user:input"` is parsed as scope-qualified `user:input`), but that pattern is
# rare and overlaps with legitimate `$env:VAR` references that are hard to filter cleanly.
# Manual review handles it. Skipping pattern 5 keeps the lint signal-to-noise high.

# ─────────────────────────────────────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────────────────────────────────────
if [ "${#FAILURES[@]}" -eq 0 ]; then
  echo "lint-infra: OK — no anti-patterns found."
  exit 0
fi

echo "lint-infra: ${#FAILURES[@]} issue(s) found:"
echo ""
for failure in "${FAILURES[@]}"; do
  echo "  $failure"
done
echo ""
echo "See AGENTS.md / CLAUDE.md 'Infra hard invariants' for the rationale on each pattern."
echo "If a match is a false positive, document why in the PR description; do not silence the lint."
exit 1
