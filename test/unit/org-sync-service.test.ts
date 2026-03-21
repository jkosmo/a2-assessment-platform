import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgSyncConfig = vi.fn();
const findUserForOrgSyncByExternalId = vi.fn();
const findUserForOrgSyncByEmail = vi.fn();
const updateUserForOrgSync = vi.fn();
const createUserForOrgSync = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("node:crypto", () => ({
  randomUUID: () => "org-sync-run-1",
}));

vi.mock("../../src/config/orgSync.js", () => ({
  getOrgSyncConfig,
}));

vi.mock("../../src/repositories/userRepository.js", () => ({
  findUserForOrgSyncByExternalId,
  findUserForOrgSyncByEmail,
  updateUserForOrgSync,
  createUserForOrgSync,
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("org sync service", () => {
  beforeEach(() => {
    getOrgSyncConfig.mockReset();
    findUserForOrgSyncByExternalId.mockReset();
    findUserForOrgSyncByEmail.mockReset();
    updateUserForOrgSync.mockReset();
    createUserForOrgSync.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
  });

  it("creates and updates users during delta sync while recording completion summary", async () => {
    getOrgSyncConfig.mockReturnValue({
      conflictStrategy: "update_email_match",
      defaultActiveStatus: true,
      allowDepartmentOverwrite: true,
      allowManagerOverwrite: true,
    });
    findUserForOrgSyncByExternalId
      .mockResolvedValueOnce({
        id: "user-1",
        name: "Existing User",
        email: "existing@company.com",
        department: "Old Dept",
        manager: "Old Manager",
        activeStatus: true,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    findUserForOrgSyncByEmail
      .mockResolvedValueOnce({
        id: "user-1",
        email: "existing@company.com",
      })
      .mockResolvedValueOnce({
        id: "user-2",
        name: "Email Match User",
        email: "email.match@company.com",
        department: "Sales",
        manager: "Manager B",
        activeStatus: true,
      })
      .mockResolvedValueOnce(null);

    const { applyOrgDeltaSync } = await import("../../src/modules/orgSync/index.js");

    const result = await applyOrgDeltaSync({
      source: "hr-feed",
      actorId: "admin-1",
      users: [
        {
          externalId: "ext-1",
          email: "existing@company.com",
          name: "Existing User Updated",
          department: "Engineering",
          manager: "Manager A",
          activeStatus: false,
        },
        {
          externalId: "ext-2",
          email: "email.match@company.com",
          name: "Email Match User Updated",
          department: "Product",
          manager: "Manager C",
        },
        {
          externalId: "ext-3",
          email: "new.user@company.com",
          name: "New User",
          department: "Finance",
        },
      ],
    });

    expect(updateUserForOrgSync).toHaveBeenNthCalledWith(1, "user-1", {
      email: "existing@company.com",
      name: "Existing User Updated",
      department: "Engineering",
      manager: "Manager A",
      activeStatus: false,
    });
    expect(updateUserForOrgSync).toHaveBeenNthCalledWith(2, "user-2", {
      externalId: "ext-2",
      email: "email.match@company.com",
      name: "Email Match User Updated",
      department: "Product",
      manager: "Manager C",
      activeStatus: true,
    });
    expect(createUserForOrgSync).toHaveBeenCalledWith({
      externalId: "ext-3",
      email: "new.user@company.com",
      name: "New User",
      department: "Finance",
      manager: null,
      activeStatus: true,
    });
    expect(result).toMatchObject({
      runId: "org-sync-run-1",
      source: "hr-feed",
      userCount: 3,
      createdCount: 1,
      updatedCount: 2,
      skippedConflictCount: 0,
      failedCount: 0,
      errors: [],
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "org_sync",
        entityId: "org-sync-run-1",
        action: "org_sync_completed",
      }),
    );
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "org_sync_delta_completed",
      expect.objectContaining({
        runId: "org-sync-run-1",
        createdCount: 1,
        updatedCount: 2,
      }),
      "info",
    );
  });

  it("records failed conflicting records when strict conflict handling is enabled", async () => {
    getOrgSyncConfig.mockReturnValue({
      conflictStrategy: "fail_conflict",
      defaultActiveStatus: true,
      allowDepartmentOverwrite: true,
      allowManagerOverwrite: true,
    });
    findUserForOrgSyncByExternalId.mockResolvedValue({
      id: "user-1",
      name: "Existing User",
      email: "existing@company.com",
      department: "Operations",
      manager: "Manager A",
      activeStatus: true,
    });
    findUserForOrgSyncByEmail.mockResolvedValue({
      id: "user-2",
      name: "Different User",
      email: "conflict@company.com",
      department: "Finance",
      manager: "Manager B",
      activeStatus: true,
    });

    const { applyOrgDeltaSync } = await import("../../src/modules/orgSync/index.js");

    const result = await applyOrgDeltaSync({
      source: "hr-feed",
      actorId: "admin-1",
      users: [
        {
          externalId: "ext-1",
          email: "conflict@company.com",
          name: "Conflict User",
          department: "Conflict Dept",
        },
      ],
    });

    expect(updateUserForOrgSync).not.toHaveBeenCalled();
    expect(createUserForOrgSync).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      createdCount: 0,
      updatedCount: 0,
      skippedConflictCount: 0,
      failedCount: 1,
      errors: [
        {
          externalId: "ext-1",
          email: "conflict@company.com",
          reason: "Email conflicts with a different external ID.",
        },
      ],
    });
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "org_sync_delta_failed_record",
      expect.objectContaining({
        runId: "org-sync-run-1",
        externalId: "ext-1",
        email: "conflict@company.com",
      }),
      "error",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "org_sync",
        entityId: "org-sync-run-1",
        action: "org_sync_record_failed",
      }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "org_sync",
        entityId: "org-sync-run-1",
        action: "org_sync_completed",
      }),
    );
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "org_sync_delta_completed",
      expect.objectContaining({
        failedCount: 1,
      }),
      "error",
    );
  });
});
