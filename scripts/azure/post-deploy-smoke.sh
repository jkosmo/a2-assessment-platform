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

check_endpoint() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local body_file
  body_file=$(mktemp)
  local code
  code=$(curl -s -o "$body_file" -w '%{http_code}' --max-time 30 "$url" || echo "000")
  if [ "$code" = "$expected" ]; then
    echo "  $label  → $code OK"
    if [ "$label" = "worker" ]; then
      echo "  worker body: $(cat "$body_file")"
    fi
  else
    echo "::error::$label /healthz returned $code (expected $expected)"
    echo "  body: $(head -c 500 "$body_file")"
    FAIL=1
  fi
  rm -f "$body_file"
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
