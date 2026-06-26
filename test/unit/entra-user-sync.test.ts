import { describe, expect, it } from "vitest";
import { mapGraphMemberToOrgSyncRecord } from "../../src/modules/orgSync/entraUserSyncService.js";

// #690: mapping a Graph group member to an org-sync upsert record. externalId = Entra object id so a
// later login (oid claim) reconciles to the same row.

describe("mapGraphMemberToOrgSyncRecord (#690)", () => {
  it("maps a normal user member with mail + department", () => {
    expect(
      mapGraphMemberToOrgSyncRecord({
        "@odata.type": "#microsoft.graph.user",
        id: "oid-1",
        displayName: "Kari Nordmann",
        mail: "kari@a-2.no",
        department: "Rådgivning",
        accountEnabled: true,
      }),
    ).toEqual({ externalId: "oid-1", email: "kari@a-2.no", name: "Kari Nordmann", department: "Rådgivning", activeStatus: true });
  });

  it("falls back to userPrincipalName when mail is missing", () => {
    const r = mapGraphMemberToOrgSyncRecord({ id: "oid-2", displayName: "Ola", userPrincipalName: "ola@a-2.no" });
    expect(r?.email).toBe("ola@a-2.no");
    expect(r?.department).toBeNull();
    expect(r?.activeStatus).toBe(true); // accountEnabled absent → default enabled
  });

  it("skips non-user members (groups/devices nested in the group)", () => {
    expect(mapGraphMemberToOrgSyncRecord({ "@odata.type": "#microsoft.graph.group", id: "g1", displayName: "Nested" })).toBeNull();
  });

  it("skips users with no id or no email", () => {
    expect(mapGraphMemberToOrgSyncRecord({ id: "", mail: "x@a-2.no" })).toBeNull();
    expect(mapGraphMemberToOrgSyncRecord({ id: "oid-3", mail: "", userPrincipalName: "" })).toBeNull();
  });

  it("marks a disabled account inactive", () => {
    const r = mapGraphMemberToOrgSyncRecord({ id: "oid-4", mail: "z@a-2.no", accountEnabled: false });
    expect(r?.activeStatus).toBe(false);
  });
});
