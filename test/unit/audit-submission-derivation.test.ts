import { describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "../../src/services/auditService.js";
import { auditActions } from "../../src/observability/auditEvents.js";

// #797: recordAuditEvent denormalizes the related submission id onto the AuditEvent.submissionId column so
// the participant trail read is an indexed equality lookup. Verify the derivation for each case.
function mockTx() {
  const create = vi.fn().mockResolvedValue({ id: "audit" });
  return { tx: { auditEvent: { create }, submission: {} } as never, create };
}

describe("recordAuditEvent denormalizes submissionId (#797)", () => {
  it("uses entityId when the event's entity IS the submission", async () => {
    const { tx, create } = mockTx();
    await recordAuditEvent(
      {
        entityType: "submission",
        entityId: "sub-1",
        action: auditActions.submission.created,
        metadata: { submissionId: "sub-1", moduleId: "m", moduleVersionId: "v" },
      },
      tx,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submissionId: "sub-1" }) }),
    );
  });

  it("uses metadata.submissionId when the entity is something else (e.g. a manual review)", async () => {
    const { tx, create } = mockTx();
    await recordAuditEvent(
      {
        entityType: "manual_review",
        entityId: "review-1",
        action: auditActions.manualReview.resolved,
        metadata: { submissionId: "sub-9", overrideDecisionId: "od", overrideDecision: null },
      },
      tx,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submissionId: "sub-9" }) }),
    );
  });

  it("leaves submissionId null for an unrelated event", async () => {
    const { tx, create } = mockTx();
    await recordAuditEvent(
      {
        entityType: "course",
        entityId: "course-1",
        action: auditActions.course.updated,
        metadata: { courseId: "course-1", changedFields: ["title"] },
      },
      tx,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submissionId: null }) }),
    );
  });
});
