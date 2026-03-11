import { describe, expect, it, vi } from "vitest";
import { createAuditRepository } from "../../src/repositories/auditRepository.js";

describe("audit repository", () => {
  it("creates audit events through the Prisma client", async () => {
    const create = vi.fn().mockResolvedValue({ id: "audit-1" });
    const repository = createAuditRepository({
      auditEvent: {
        create,
      },
    } as never);

    await repository.createAuditEvent({
      entityType: "submission",
      entityId: "submission-1",
      action: "submission_created",
      actorId: "user-1",
      metadataJson: "{\"submissionId\":\"submission-1\"}",
      payloadHash: "hash-1",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        entityType: "submission",
        entityId: "submission-1",
        action: "submission_created",
        actorId: "user-1",
        metadataJson: "{\"submissionId\":\"submission-1\"}",
        payloadHash: "hash-1",
      },
    });
  });

  it("queries submission-scoped audit events with actor details", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = createAuditRepository({
      auditEvent: {
        findMany,
      },
    } as never);

    await repository.findSubmissionAuditEvents("submission-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
        include: expect.objectContaining({
          actor: expect.any(Object),
        }),
      }),
    );
  });
});
