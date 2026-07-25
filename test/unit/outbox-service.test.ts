import { beforeEach, describe, expect, it, vi } from "vitest";

// #795-followup: a hung delivery must not wedge the worker — processNextOutboxEvent bounds each delivery
// with OUTBOX_DELIVERY_TIMEOUT_MS, and on timeout retries the row instead of hanging forever.

const findFirst = vi.fn();
const updateMany = vi.fn();
const notifyAssessmentResult = vi.fn();
const checkAndIssueCourseCompletions = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { outboxEvent: { findFirst, updateMany } },
}));
vi.mock("../../src/modules/certification/index.js", () => ({ notifyAssessmentResult }));
vi.mock("../../src/modules/course/index.js", () => ({ checkAndIssueCourseCompletions }));

describe("outbox delivery timeout (#795-followup)", () => {
  beforeEach(() => {
    vi.resetModules();
    findFirst.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    notifyAssessmentResult.mockReset();
    checkAndIssueCourseCompletions.mockReset();
    process.env.OUTBOX_DELIVERY_TIMEOUT_MS = "30"; // 30ms deadline for the test
  });

  it("retries (does not hang) when a delivery exceeds the deadline", async () => {
    findFirst.mockResolvedValue({
      id: "evt-1",
      type: "assessment_notification",
      payloadJson: JSON.stringify({
        submissionId: "s1",
        submittedAt: new Date().toISOString(),
        recipientEmail: "a@b.test",
        recipientName: "A",
        moduleTitle: "M",
        moduleId: "m1",
        passFailTotal: true,
        locale: "en-GB",
      }),
      attempts: 0,
      maxAttempts: 5,
      availableAt: new Date(Date.now() - 1000),
    });
    // The delivery hangs forever — only the deadline can end it.
    notifyAssessmentResult.mockReturnValue(new Promise(() => {}));

    const { processNextOutboxEvent } = await import("../../src/modules/outbox/outboxService.js");
    const processed = await processNextOutboxEvent("worker-1", 60_000);

    expect(processed).toBe(true);
    // The last updateMany is the retry terminal write: still pending (attempts 1 < max), error recorded.
    const retryCall = updateMany.mock.calls.at(-1)?.[0];
    expect(retryCall.data.status).toBe("pending");
    expect(retryCall.data.attempts).toBe(1);
    expect(retryCall.data.lastError).toMatch(/exceeded/);
  });
});
