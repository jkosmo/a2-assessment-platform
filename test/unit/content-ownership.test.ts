import { describe, expect, it } from "vitest";
import { decideOwnershipAccess } from "../../src/modules/content/contentOwnershipService.js";

// #787 slice 2: pins the ownership access matrix (the pure decision the guard is built on).
describe("decideOwnershipAccess (#787)", () => {
  it("ADMINISTRATOR is always allowed — owner or not, owned or unowned", () => {
    expect(decideOwnershipAccess({ isAdmin: true, ownerUserIds: [], actorUserId: "u1" })).toBe("allow");
    expect(decideOwnershipAccess({ isAdmin: true, ownerUserIds: ["u2"], actorUserId: "u1" })).toBe("allow");
  });

  it("an owner (in the set) is allowed", () => {
    expect(decideOwnershipAccess({ isAdmin: false, ownerUserIds: ["u1", "u2"], actorUserId: "u2" })).toBe("allow");
  });

  it("a non-owner on owned content is denied as not_owner", () => {
    expect(decideOwnershipAccess({ isAdmin: false, ownerUserIds: ["u1"], actorUserId: "u2" })).toBe("not_owner");
  });

  it("unowned content is admin-only (unowned) for a non-admin", () => {
    expect(decideOwnershipAccess({ isAdmin: false, ownerUserIds: [], actorUserId: "u1" })).toBe("unowned");
  });
});
