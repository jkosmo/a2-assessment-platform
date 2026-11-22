import { describe, expect, it, vi } from "vitest";
import { createClassRepository } from "../../src/modules/course/classRepository.js";

// #645/CL-1: class (cohort) persistence. Pure repository — mock the prisma client.

describe("class repository", () => {
  it("creates a MANUAL class with the given fields", async () => {
    const create = vi.fn().mockResolvedValue({ id: "class-1" });
    const repo = createClassRepository({ class: { create } } as never);

    await repo.createClass({ name: "Onboarding H2026", description: "Nye ansatte" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        // #963: eierskap skrives til ContentOwner av tjenesten, ikke som createdById her.
        data: { name: "Onboarding H2026", description: "Nye ansatte", kind: "MANUAL" },
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

  it("assigns a course to a class (a new assignment: no due-date update)", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn();
    const repo = createClassRepository({ courseGroupAssignment: { createMany, updateMany } } as never);
    const dueAt = new Date("2026-09-01T00:00:00.000Z");

    await expect(repo.assignCourseToClass("course-1", "class-1", dueAt, "admin-1")).resolves.toBeUndefined();

    expect(createMany).toHaveBeenCalledWith({
      data: [{ courseId: "course-1", classId: "class-1", dueAt, assignedById: "admin-1" }],
      skipDuplicates: true,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("an existing assignment only gets the new due date", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createClassRepository({ courseGroupAssignment: { createMany, updateMany } } as never);
    const dueAt = new Date("2026-09-01T00:00:00.000Z");

    await expect(repo.assignCourseToClass("course-1", "class-1", dueAt, "admin-1")).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith({ where: { courseId: "course-1", classId: "class-1" }, data: { dueAt } });
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
