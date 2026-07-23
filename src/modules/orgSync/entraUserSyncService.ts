import { DefaultAzureCredential } from "@azure/identity";
import { env } from "../../config/env.js";
import { ValidationError } from "../../errors/AppError.js";
import { fetchWithDeadlineAndRetry, withTimeout } from "../../clients/externalCall.js";
import { applyOrgDeltaSync } from "./orgSyncService.js";

// #690: import the members of a configured Entra group (e.g. "Alle i A-2 Norge", ~61 employees) into
// the platform as users, so they are searchable/assignable for class membership BEFORE they ever log
// in. Reuses the org-sync delta upsert (keyed by externalId = Entra object id) so a later login maps
// to the same row. Auth is the app's managed identity (DefaultAzureCredential) — the identity must
// hold the Graph application permission GroupMember.Read.All (+ User.Read.All). See the runbook.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

interface GraphMember {
  "@odata.type"?: string;
  id?: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  department?: string | null;
  accountEnabled?: boolean | null;
}

export interface EntraUserSyncRecord {
  externalId: string;
  email: string;
  name: string;
  department: string | null;
  activeStatus: boolean;
}

/**
 * Maps a Graph group member to an org-sync record, or null if it is not a usable user (not a user
 * object, or missing the id/email needed to provision and later reconcile on login).
 */
export function mapGraphMemberToOrgSyncRecord(member: GraphMember): EntraUserSyncRecord | null {
  if (member["@odata.type"] && member["@odata.type"] !== "#microsoft.graph.user") return null;
  const externalId = member.id?.trim();
  const email = (member.mail ?? member.userPrincipalName ?? "").trim();
  const name = (member.displayName ?? "").trim() || email;
  if (!externalId || !email) return null;
  return {
    externalId,
    email,
    name,
    department: member.department?.trim() || null,
    // Default missing accountEnabled to true (the value is only present with User.Read.All; absence
    // shouldn't deactivate a member of the employee group).
    activeStatus: member.accountEnabled !== false,
  };
}

async function getGraphToken(): Promise<string> {
  // #812: token acquisition (IMDS / managed identity) can hang — bound it so it can't wedge the sync tick.
  const token = await withTimeout(
    new DefaultAzureCredential().getToken(GRAPH_SCOPE),
    env.ENTRA_GRAPH_TIMEOUT_MS,
    "graph_token",
  );
  if (!token?.token) throw new Error("Could not acquire a Microsoft Graph token (managed identity).");
  return token.token;
}

async function fetchAllGroupMembers(groupId: string, accessToken: string): Promise<GraphMember[]> {
  const members: GraphMember[] = [];
  let url: string | null =
    `${GRAPH_BASE}/groups/${encodeURIComponent(groupId)}/members` +
    `?$select=id,displayName,mail,userPrincipalName,department,accountEnabled&$top=100`;
  while (url) {
    // #812: idempotent GET → per-request deadline + bounded retry with backoff, so a hung or transiently
    // failing Graph page can't wedge the Entra sync tick.
    const response = await fetchWithDeadlineAndRetry(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { timeoutMs: env.ENTRA_GRAPH_TIMEOUT_MS, label: "graph_group_members" },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Graph group members request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const page = (await response.json()) as { value?: GraphMember[]; "@odata.nextLink"?: string };
    if (Array.isArray(page.value)) members.push(...page.value);
    url = page["@odata.nextLink"] ?? null;
  }
  return members;
}

export interface EntraUserSyncResult {
  groupId: string;
  fetchedMembers: number;
  importedUsers: number;
  run: Awaited<ReturnType<typeof applyOrgDeltaSync>>;
}

/**
 * Pulls the configured Entra group's members and upserts them as platform users. Throws a clear
 * ValidationError when not configured, so the admin endpoint returns a helpful 400.
 */
export async function syncEntraUsersFromGroup(actorId: string): Promise<EntraUserSyncResult> {
  const groupId = env.ENTRA_USER_SYNC_GROUP_ID;
  if (!groupId) {
    throw new ValidationError("Entra user sync is not configured (ENTRA_USER_SYNC_GROUP_ID is unset).");
  }

  const accessToken = await getGraphToken();
  const members = await fetchAllGroupMembers(groupId, accessToken);
  const users = members
    .map(mapGraphMemberToOrgSyncRecord)
    .filter((record): record is EntraUserSyncRecord => record !== null);

  const run = await applyOrgDeltaSync({ source: "entra_group_sync", users, actorId });
  return { groupId, fetchedMembers: members.length, importedUsers: users.length, run };
}
