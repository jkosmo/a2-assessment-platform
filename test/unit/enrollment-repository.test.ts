import { describe, expect, it, vi } from "vitest";
import { createEnrollmentRepository } from "../../src/modules/course/enrollmentRepository.js";

describe("enrollment repository", () => {
  it("upserts an enrollment and clears revokedAt on re-assignment", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "enrollment-1" });
    const repository = createEnrollmentRepository({
      courseEnrollment: {
        upsert,
      },
    } as never);
    const dueAt = new Date("2026-07-10T12:00:00.000Z");

    await repository.assignEnrollment({
      userId: "user-1",
      courseId: "course-1",
      assignedById: "admin-1",
      source: "INDIVIDUAL",
      dueAt,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_courseId: { userId: "user-1", courseId: "course-1" } },
      create: {
        userId: "user-1",
        courseId: "course-1",
        assignedById: "admin-1",
        source: "INDIVIDUAL",
        dueAt,
        revokedAt: null,
      },
      update: {
        assignedById: "admin-1",
        source: "INDIVIDUAL",
        dueAt,
        revokedAt: null,
        assignedAt: expect.any(Date),
      },
    });
  });

  it("soft-revokes only active enrollments", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createEnrollmentRepository({
      courseEnrollment: {
        updateMany,
      },
    } as never);

    await repository.revokeEnrollment("user-1", "course-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", courseId: "course-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("finds active enrollments for a participant newest first", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = createEnrollmentRepository({
      courseEnrollment: {
        findMany,
      },
    } as never);

    await repository.findActiveEnrollmentsForUser("user-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      orderBy: { assignedAt: "desc" },
    });
  });

  it("finds active course enrollments with participant context", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = createEnrollmentRepository({
      courseEnrollment: {
        findMany,
      },
    } as never);

    await repository.findActiveEnrollmentsForCourse("course-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { courseId: "course-1", revokedAt: null },
      orderBy: { assignedAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, email: true, department: true },
        },
      },
    });
  });
});
