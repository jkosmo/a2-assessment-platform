import { describe, expect, it, vi } from "vitest";
import { createClassRepository } from "../../src/modules/course/classRepository.js";

// #645/CL-1: class (cohort) persistence. Pure repository — mock the prisma client.

describe("class repository", () => {
  it("creates a MANUAL class with the given fields", async () => {
    const create = vi.fn().mockResolvedValue({ id: "class-1" });
    const repo = createClassRepository({ class: { create } } as never);

    await repo.createClass({ name: "Onboarding H2026", description: "Nye ansatte", createdById: "admin-1" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "Onboarding H2026", description: "Nye ansatte", kind: "MANUAL", createdById: "admin-1" },
      }),
    );
  });

  it("adds a member idempotently via upsert", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const repo = createClassRepository({ classMember: { upsert } } as never);

    await repo.addMember("class-1", "user-1", "admin-1");

    expect(upsert).toHaveBeenCalledWith({
      where: { classId_userId: { classId: "class-1", userId: "user-1" } },
      create: { classId: "class-1", userId: "user-1", addedById: "admin-1" },
      update: {},
    });
  });

  it("assigns a course to a class idempotently and updates the due date", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const repo = createClassRepository({ courseGroupAssignment: { upsert } } as never);
    const dueAt = new Date("2026-09-01T00:00:00.000Z");

    await repo.assignCourseToClass("course-1", "class-1", dueAt, "admin-1");

    expect(upsert).toHaveBeenCalledWith({
      where: { courseId_classId: { courseId: "course-1", classId: "class-1" } },
      create: { courseId: "course-1", classId: "class-1", dueAt, assignedById: "admin-1" },
      update: { dueAt },
    });
  });

  it("archives a class with a timestamp (soft delete)", async () => {
    const update = vi.fn().mockResolvedValue({});
    const repo = createClassRepository({ class: { update } } as never);

    await repo.archiveClass("class-1");

    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "class-1" });
    expect(call.data.archivedAt).toBeInstanceOf(Date);
  });
});
