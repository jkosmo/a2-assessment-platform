# Entra user sync (#690) — runbook

Imports the members of an Entra group (the **employee** group «Alle i A-2 Norge», ~61 people) into
the platform's `User` table so they are **searchable/assignable for class membership before their
first login**. Reconciliation key is `externalId = Entra object id` (the `oid` claim), so a later
login maps to the same row.

> Why this exists: the platform provisions users **just-in-time on login**. Before #690, only people
> who had logged in were searchable. The tenant has 246 objects but only ~61 are real employees
> (the rest are guests/external/customer/service accounts), so a blanket import is wrong — we scope
> to the employee group.

## Components (shipped)
- Service `src/modules/orgSync/entraUserSyncService.ts` — Graph pull (managed identity) → map →
  `applyOrgDeltaSync` (upsert). Skips non-user/disabled/no-email members.
- Endpoint `POST /api/admin/sync/org/entra` (ADMINISTRATOR) — run on demand.
- Admin button **«Synk brukere fra Entra»** on `/admin-content/classes` (ADMINISTRATOR only).
- Scheduled `EntraUserSyncMonitor` (worker, default every 24h) — only runs when configured.

## Config (per environment)
| Setting | Value |
|---|---|
| `ENTRA_USER_SYNC_GROUP_ID` | prod «Alle i A-2 Norge» = `8bab5ab4-c7db-4c9c-baad-316e1ff63504` |
| `ENTRA_USER_SYNC_INTERVAL_MS` | optional, default `86400000` (24h) |

Set as a (non-secret) app setting on **both web and worker** apps. Add to `infra/azure/main.bicep`
for durability (a manual `az` value is wiped by a full infra deploy — see #687 pattern).

## ⚠️ One-time Entra admin step — Graph permission + consent (BLOCKER)
The app calls Graph as its **managed identity** (`DefaultAzureCredential`). That identity must hold
the Graph **application** permissions, granted by an Entra **admin** (Privileged Role / Global Admin).
Until this is done, the sync returns 403 and imports nobody.

Grant `GroupMember.Read.All` (and `User.Read.All` for `department`/`accountEnabled`) to the web app's
managed identity (run against the **production** tenant):

```bash
az account set --subscription 5b3f760b-42d4-4d78-812c-c059278d1086   # prod

MI=$(az webapp identity show -n a2-assessment-platform-prd-app-hea5kl -g rg-a2-assessment-production --query principalId -o tsv)
GRAPH=$(az ad sp list --filter "appId eq '00000003-0000-0000-c000-000000000000'" --query "[0].id" -o tsv)

# GroupMember.Read.All
az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$MI/appRoleAssignments" \
  --headers "Content-Type=application/json" \
  --body "{\"principalId\":\"$MI\",\"resourceId\":\"$GRAPH\",\"appRoleId\":\"98830695-27a2-44f7-8c18-0c3ebc9698f6\"}"
# User.Read.All
az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$MI/appRoleAssignments" \
  --headers "Content-Type=application/json" \
  --body "{\"principalId\":\"$MI\",\"resourceId\":\"$GRAPH\",\"appRoleId\":\"df021288-bdef-4463-88db-98f22de89214\"}"
```

(App-role ids: `GroupMember.Read.All` = `98830695-27a2-44f7-8c18-0c3ebc9698f6`, `User.Read.All` =
`df021288-bdef-4463-88db-98f22de89214` — verify against the Graph SP's `appRoles` if Microsoft
changes them.) Repeat for the worker app's managed identity if the scheduled monitor runs there.

## Stopgap: manual export + import (no Graph consent needed) ✅ works today
Granting the managed identity the Graph app role requires an Entra **directory** role (Privileged
Role Administrator / Global Admin) — **subscription Owner is NOT enough** (verified 2026-06-26: the
`az rest` POST returned `Authorization_RequestDenied` for a subscription-Owner). Until that consent
is granted, seed the users with an **admin's own delegated access**:

1. **Export** the group's members (any directory member can read group membership):
   ```bash
   az account set --subscription 5b3f760b-42d4-4d78-812c-c059278d1086   # prod
   az ad group member list --group 8bab5ab4-c7db-4c9c-baad-316e1ff63504 \
     --query "[].{externalId:id, email:mail, name:displayName, upn:userPrincipalName}" -o json > members.json
   ```
   Shape the file as `{ "source": "entra_manual_export", "users": [ {externalId, email, name, activeStatus:true}, … ] }`
   (use `upn` as `email` when `mail` is null). `externalId` MUST be the Entra object id (`oid`) so a
   later SSO login reconciles to the same row. (Note: `az` on Windows writes the file as cp1252 — re-
   encode to UTF-8 so names with æ/ø/å/é survive.)
2. **Import** in the app: Innholdsforvaltning → **Klasser** → **«Importer brukere fra fil»**
   (ADMINISTRATOR), pick the JSON. It POSTs to the existing admin-only `POST /api/admin/sync/org/delta`
   (same `applyOrgDeltaSync` upsert as the automatic path) — no managed-identity Graph permission needed.

This is a manual stopgap (re-run when the roster changes). The automatic Graph sync below is the
durable path once consent is granted.

## Run it
- **On demand:** Innholdsforvaltning → **Klasser** → **«Synk brukere fra Entra»** (admin), or
  `POST /api/admin/sync/org/entra`.
- **Scheduled:** the worker runs it every `ENTRA_USER_SYNC_INTERVAL_MS` once `ENTRA_USER_SYNC_GROUP_ID`
  is set. Status is exposed in the worker `/healthz` (`workers.entraUserSyncMonitor`).

## Notes / follow-ups
- v1 **upserts** (add/update). It does not deactivate users who leave the group — track as a follow-up
  if departures must propagate.
- Same Graph-permission pattern unlocks **CL-5** (Entra-linked classes, `Group.Read.All`).
