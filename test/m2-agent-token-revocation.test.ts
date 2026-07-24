import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { env } from "../src/config/env.js";
import {
  issueAgentAuthoringToken,
  revokeAllAgentTokensForUser,
} from "../src/auth/agentAuthoringTokenService.js";
import { syncEntraGroupRoles, resetGroupSyncThrottle } from "../src/repositories/userRepository.js";
import type { AuthPrincipal } from "../src/auth/principal.js";

// #789: an agent-authoring token freezes the issuer's roles at issuance, so a role removed afterwards
// stays authoring-capable until expiry. Outstanding tokens must be revoked when the user's roles change.
async function makeUser(tag: string) {
  return prisma.user.create({
    data: { externalId: `${tag}-${Date.now()}`, name: tag, email: `${tag}-${Date.now()}@x.test` },
    select: { id: true },
  });
}

describe("agent-token revocation on role change (#789)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("revokeAllAgentTokensForUser revokes only the user's active tokens and audits each", async () => {
    const user = await makeUser("rev");
    const other = await makeUser("other");
    const a = await issueAgentAuthoringToken({ userId: user.id, roles: ["SUBJECT_MATTER_OWNER"] });
    const b = await issueAgentAuthoringToken({ userId: user.id, roles: ["SUBJECT_MATTER_OWNER"] });
    const untouched = await issueAgentAuthoringToken({ userId: other.id, roles: ["SUBJECT_MATTER_OWNER"] });

    const count = await revokeAllAgentTokensForUser(user.id, "unit_test");
    expect(count).toBe(2);

    expect((await prisma.agentAuthoringToken.findUnique({ where: { id: a.record.id } }))?.revokedAt).not.toBeNull();
    expect((await prisma.agentAuthoringToken.findUnique({ where: { id: b.record.id } }))?.revokedAt).not.toBeNull();
    // a different user's token is untouched
    expect((await prisma.agentAuthoringToken.findUnique({ where: { id: untouched.record.id } }))?.revokedAt).toBeNull();

    const audits = await prisma.auditEvent.findMany({ where: { action: "agent_authoring_token_revoked", entityId: { in: [a.record.id, b.record.id] } } });
    expect(audits.length).toBe(2);
    expect(JSON.parse(audits[0].metadataJson).reason).toBe("unit_test");

    // idempotent — a second call revokes nothing
    expect(await revokeAllAgentTokensForUser(user.id, "unit_test")).toBe(0);
  });

  it("syncEntraGroupRoles revokes outstanding tokens when a group-synced role is removed", async () => {
    const original = env.ENTRA_SYNC_GROUP_ROLES;
    (env as { ENTRA_SYNC_GROUP_ROLES: boolean }).ENTRA_SYNC_GROUP_ROLES = true;
    try {
      const user = await makeUser("sync");
      // A role the user currently holds via group sync.
      await prisma.roleAssignment.create({
        data: { userId: user.id, appRole: "SUBJECT_MATTER_OWNER", validFrom: new Date(Date.now() - 60_000), createdBy: "entra-group-sync" },
      });
      const token = await issueAgentAuthoringToken({ userId: user.id, roles: ["SUBJECT_MATTER_OWNER"] });

      resetGroupSyncThrottle();
      // Principal now carries NO groups → desired roles empty → the SMO assignment is revoked.
      const principal = { userId: user.id, email: "x@x.test", name: "x", roles: [], groupIds: [] } as unknown as AuthPrincipal;
      await syncEntraGroupRoles(user.id, principal, new Date());

      expect((await prisma.agentAuthoringToken.findUnique({ where: { id: token.record.id } }))?.revokedAt).not.toBeNull();
    } finally {
      (env as { ENTRA_SYNC_GROUP_ROLES: boolean }).ENTRA_SYNC_GROUP_ROLES = original;
    }
  });
});
