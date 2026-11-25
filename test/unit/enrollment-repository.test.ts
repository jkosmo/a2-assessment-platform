import { describe, expect, it, vi } from "vitest";
import { createEnrollmentRepository } from "../../src/modules/course/enrollmentRepository.js";

describe("enrollment repository", () => {
  // #1192 punkt 2: først én UPDATE som bare treffer en rad med annen frist (eller trukket tilbake) og skriver `dueSetAt`; treffer
  // den ingenting, går upserten uten å røre `dueSetAt` i oppdateringen. Atferden mot databasen måles i m2-effective-deadline-1192.
  it("upserts an enrollment and clears revokedAt on re-assignment; dueSetAt only when the deadline changes", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "enrollment-1" });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = createEnrollmentRepository({
      courseEnrollment: {
        upsert,
        updateMany,
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

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", courseId: "course-1", OR: [{ OR: [{ dueAt: null }, { dueAt: { not: dueAt } }] }, { revokedAt: { not: null } }] },
      data: { assignedById: "admin-1", source: "INDIVIDUAL", dueAt, revokedAt: null, dueSetAt: expect.any(Date), assignedAt: expect.any(Date) },
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
        dueSetAt: expect.any(Date),
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

  it("a changed deadline is written by the conditional update, and the upsert is skipped", async () => {
    const upsert = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createEnrollmentRepository({ courseEnrollment: { upsert, updateMany } } as never);
    await repository.assignEnrollment({ userId: "user-1", courseId: "course-1", assignedById: null, source: "INDIVIDUAL", dueAt: null });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dueAt: null, dueSetAt: null }) }));
    expect(upsert).not.toHaveBeenCalled();
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
          // #968: activeStatus/isAnonymized følger med så publikummet kan filtrere med én regel.
          select: { id: true, name: true, email: true, department: true, activeStatus: true, isAnonymized: true },
        },
      },
    });
  });
});
