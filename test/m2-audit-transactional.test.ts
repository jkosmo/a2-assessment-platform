import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";

// #803: audit writes now commit in the SAME transaction as the domain mutation they record. This proves
// the guarantee against a real Postgres: when the audit write fails, the domain mutation is rolled back
// (no divergence), and when it succeeds, both the domain change and the audit row are present. We force
// the failure by mocking recordAuditEvent to reject — it runs inside the command's runInTransaction, so a
// rejection must abort the whole transaction.
const recordAuditEvent = vi.fn();
vi.mock("../src/services/auditService.js", () => ({ recordAuditEvent }));

async function seedCourse(title: string) {
  const course = await prisma.course.create({ data: { title }, select: { id: true, title: true } });
  return course;
}

describe("audit writes are transactional with the domain mutation (#803)", () => {
  beforeEach(() => {
    recordAuditEvent.mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rolls back the domain mutation when the in-transaction audit write fails", async () => {
    const course = await seedCourse(`before-${Date.now()}-${Math.random()}`);
    // The audit write (inside updateCourse's runInTransaction) throws → the whole transaction aborts.
    recordAuditEvent.mockRejectedValueOnce(new Error("audit write failed"));

    const { updateCourse } = await import("../src/modules/course/courseCommands.js");
    await expect(updateCourse(course.id, { title: "after-should-not-persist" }, "actor-1")).rejects.toThrow(
      "audit write failed",
    );

    // Atomicity: the title change was rolled back with the failed audit — no divergence.
    const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id }, select: { title: true } });
    expect(persisted.title).toBe(course.title);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("commits the domain mutation together with the audit write on success", async () => {
    const course = await seedCourse(`before-${Date.now()}-${Math.random()}`);
    recordAuditEvent.mockResolvedValueOnce(undefined);

    const { updateCourse } = await import("../src/modules/course/courseCommands.js");
    const newTitle = `after-${Date.now()}-${Math.random()}`;
    await updateCourse(course.id, { title: newTitle }, "actor-1");

    const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id }, select: { title: true } });
    expect(persisted.title).toBe(newTitle);
    // The audit was recorded on the transaction client (2nd arg present).
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "course_updated", entityId: course.id }),
      expect.anything(),
    );
  });
});
