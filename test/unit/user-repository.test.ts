import { afterEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: {
    user: {
      findUnique,
      create,
      update,
    },
    roleAssignment: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    ENTRA_GROUP_ROLE_MAP_FILE: "",
    ENTRA_GROUP_ROLE_MAP_JSON: "",
    ENTRA_SYNC_GROUP_ROLES: false,
  },
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("user repository", () => {
  it("recovers from a concurrent create on email/externalId collision", async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-1" });
    create.mockRejectedValueOnce({ code: "P2002" });
    update.mockResolvedValueOnce({
      id: "user-1",
      externalId: "participant-1",
      email: "participant@company.com",
    });

    const { upsertUserFromPrincipal } = await import("../../src/repositories/userRepository.js");

    const result = await upsertUserFromPrincipal({
      externalId: "participant-1",
      email: "participant@company.com",
      name: "Platform Participant",
      department: "Consulting",
      tokenRoles: ["PARTICIPANT"],
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        externalId: "participant-1",
        email: "participant@company.com",
        name: "Platform Participant",
        department: "Consulting",
        activeStatus: true,
      },
    });
    expect(result).toEqual({
      id: "user-1",
      externalId: "participant-1",
      email: "participant@company.com",
    });
  });

  it("rethrows non-unique create failures", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(new Error("disk I/O error"));

    const { upsertUserFromPrincipal } = await import("../../src/repositories/userRepository.js");

    await expect(
      upsertUserFromPrincipal({
        externalId: "participant-1",
        email: "participant@company.com",
        name: "Platform Participant",
        department: "Consulting",
        tokenRoles: ["PARTICIPANT"],
      }),
    ).rejects.toThrow("disk I/O error");
  });
});
