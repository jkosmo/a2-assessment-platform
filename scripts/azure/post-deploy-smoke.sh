#!/usr/bin/env bash
# Post-deploy /healthz smoke test (#436).
#
# Validates that web + worker + parser are reachable AFTER a deploy completes.
# Runs as a separate workflow step (independent of the deploy script's own
# Wait-Healthy logic) so a regression in either layer surfaces clearly in the
# GitHub Actions UI.
#
# Expectations:
#   - web /healthz:    200
#   - worker /healthz: 200 (body lists the 4 monitor names)
#   - parser /healthz: 401 (parser is auth-protected; 401 proves the app is running)
#
# Usage:
#   ./scripts/azure/post-deploy-smoke.sh <resource-group>
#
# Exit codes:
#   0  all endpoints healthy
#   1  any endpoint unhealthy (or RG enumeration failed)

set -euo pipefail

RG="${1:?Usage: post-deploy-smoke.sh <resource-group>}"

echo "Enumerating App Services in $RG..."
ALL_APPS=$(az webapp list --resource-group "$RG" --query "[].name" -o tsv)
if [ -z "$ALL_APPS" ]; then
  echo "::error::No App Services found in resource group $RG."
  exit 1
fi

# Match by role suffix: "-app-", "-worker-", "-parser-" (avoids matching e.g. "app"
# inside "platform-" or other tokens).
WEB=$(echo "$ALL_APPS" | grep -E -- "-app-" || true)
WORKER=$(echo "$ALL_APPS" | grep -E -- "-worker-" || true)
PARSER=$(echo "$ALL_APPS" | grep -E -- "-parser-" || true)

if [ -z "$WEB" ] || [ -z "$WORKER" ] || [ -z "$PARSER" ]; then
  echo "::error::Could not resolve all 3 app names in $RG. Got: web='$WEB' worker='$WORKER' parser='$PARSER'"
  echo "All App Services in RG:"
  echo "$ALL_APPS"
  exit 1
fi

echo "Resolved hosts:"
echo "  web:    $WEB"
echo "  worker: $WORKER"
echo "  parser: $PARSER"
echo

FAIL=0
# 6 attempts × (≤30s curl + 45s sleep) → ~6 min budget. Widened from 4 (#710 prod promote,
# run 28431321940): the prod WORKER cold-started 7s AFTER the 4th attempt (B1 worker restart
# took ~4 min), so a healthy deploy got a red smoke gate. Web/parser come up well within budget;
# the worker is the slow one. 6 attempts comfortably covers the observed B1 worker cold-start.
MAX_ATTEMPTS=6
SLEEP_BETWEEN=45

# An endpoint counts as healthy when curl returns the expected HTTP code. The deploy
# script's own Wait-Healthy guarantees the apps WERE healthy when the deploy returned,
# but a Key Vault reference refresh that fires shortly after can cycle the parser app
# (#436 follow-up — observed in run 26090019125 when parser cycled at 10:14:56 after
# Wait-Healthy said it was OK at 10:13:42, then re-stabilized at 10:23:25). Retrying
# absorbs that transient hiccup without masking a real outage.
check_endpoint() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local attempt
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    local body_file
    body_file=$(mktemp)
    local code
    # curl -w '%{http_code}' always emits a 3-digit code (000 on connection failure).
    # Pre-v1.1.58 follow-up: the previous `|| echo "000"` fallback double-printed
    # ("000000") whenever curl exited non-zero. With set -e on this is also a guard
    # — wrap in a subshell so an exit-1 from curl doesn't terminate the loop.
    code=$(curl -s -o "$body_file" -w '%{http_code}' --max-time 30 "$url" 2>/dev/null) || code="${code:-000}"
    if [ "$code" = "$expected" ]; then
      echo "  $label  → $code OK (attempt $attempt/$MAX_ATTEMPTS)"
      if [ "$label" = "worker" ]; then
        echo "  worker body: $(cat "$body_file")"
      fi
      rm -f "$body_file"
      return 0
    fi
    echo "  $label  attempt $attempt/$MAX_ATTEMPTS: got $code (expected $expected)"
    rm -f "$body_file"
    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
      sleep "$SLEEP_BETWEEN"
    fi
  done
  echo "::error::$label /healthz returned $code after $MAX_ATTEMPTS attempts (expected $expected)"
  FAIL=1
}

check_endpoint "web   " "https://${WEB}.azurewebsites.net/healthz" 200
check_endpoint "worker" "https://${WORKER}.azurewebsites.net/healthz" 200
check_endpoint "parser" "https://${PARSER}.azurewebsites.net/healthz" 401

if [ "$FAIL" -ne 0 ]; then
  echo "::error::Post-deploy smoke test FAILED for $RG."
  exit 1
fi

echo
echo "Post-deploy smoke test PASSED for $RG."
