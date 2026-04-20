#!/usr/bin/env bash
# Deploy main.bicep to a resource group.
# Usage: ./infra/azure/deploy.sh <resource-group> <environment-name> [extra bicep params...]
#
# This script queries the App Service outbound IPs before deploying so that
# the PostgreSQL firewall allowlist (dbAllowedIpAddresses) is always current.
# Run it instead of calling 'az deployment group create' directly.
#
# Prerequisites: az CLI logged in, jq installed.

set -euo pipefail

RG="${1:?Resource group name required}"
ENV="${2:?Environment name required (staging|production)}"
shift 2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BICEP_FILE="$SCRIPT_DIR/main.bicep"

echo "==> Resolving App Service names for environment: $ENV"
ENV_CODE=$([ "$ENV" = "production" ] && echo "prd" || echo "stg")
SUFFIX=$(az group show -n "$RG" --query "tags.suffix" -o tsv 2>/dev/null || true)

# Derive app names from resource group (same naming convention as Bicep)
WEB_APP=$(az webapp list -g "$RG" --query "[?contains(name,'${ENV_CODE}-app')].name" -o tsv | head -1)
WORKER_APP=$(az webapp list -g "$RG" --query "[?contains(name,'${ENV_CODE}-worker')].name" -o tsv | head -1)

if [ -z "$WEB_APP" ] || [ -z "$WORKER_APP" ]; then
  echo "NOTE: App Services not yet deployed — skipping IP query. dbAllowedIpAddresses will be empty on first deploy."
  DB_ALLOWED_IPS="[]"
else
  echo "==> Querying outbound IPs for: $WEB_APP, $WORKER_APP"
  WEB_IPS=$(az webapp show -n "$WEB_APP" -g "$RG" --query "outboundIpAddresses" -o tsv)
  WORKER_IPS=$(az webapp show -n "$WORKER_APP" -g "$RG" --query "outboundIpAddresses" -o tsv)

  ALL_IPS=$(echo "${WEB_IPS},${WORKER_IPS}" | tr ',' '\n' | sort -u)

  # Build JSON array: [{ name, startIpAddress, endIpAddress }]
  DB_ALLOWED_IPS="["
  FIRST=true
  i=0
  while IFS= read -r ip; do
    [ -z "$ip" ] && continue
    [ "$FIRST" = true ] && FIRST=false || DB_ALLOWED_IPS+=","
    DB_ALLOWED_IPS+="{\"name\":\"app-outbound-${i}\",\"startIpAddress\":\"${ip}\",\"endIpAddress\":\"${ip}\"}"
    ((i++)) || true
  done <<< "$ALL_IPS"
  DB_ALLOWED_IPS+="]"

  echo "==> Firewall rules: $i IPs"
fi

echo "==> Deploying $BICEP_FILE to $RG"
az deployment group create \
  --resource-group "$RG" \
  --template-file "$BICEP_FILE" \
  --parameters environmentName="$ENV" \
  --parameters dbAllowedIpAddresses="$DB_ALLOWED_IPS" \
  "$@"

echo "==> Deploy complete."

echo ""
echo "==> RBAC audit (INFRA-004) — run manually after deploy:"
echo ""
echo "    WEB_PRINCIPAL=\$(az webapp identity show -n <web-app-name> -g $RG --query principalId -o tsv)"
echo "    WORKER_PRINCIPAL=\$(az webapp identity show -n <worker-app-name> -g $RG --query principalId -o tsv)"
echo "    az role assignment list --assignee \$WEB_PRINCIPAL --all -o table"
echo "    az role assignment list --assignee \$WORKER_PRINCIPAL --all -o table"
echo ""
echo "    Expected: Key Vault Secrets User on the KV only."
echo "    Remove any RG- or subscription-level grants not tracked in Bicep."
