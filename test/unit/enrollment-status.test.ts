import { describe, expect, it } from "vitest";
import { deriveEnrollmentStatus } from "../../src/modules/course/enrollmentStatus.js";

describe("deriveEnrollmentStatus", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");

  it("keeps completed enrollments completed even after the due date", () => {
    expect(
      deriveEnrollmentStatus({
        isCompleted: true,
        hasStarted: true,
        dueAt: new Date("2026-06-30T12:00:00.000Z"),
        now,
      }),
    ).toBe("COMPLETED");
  });

  it("marks incomplete past-due enrollments as overdue before in-progress", () => {
    expect(
      deriveEnrollmentStatus({
        isCompleted: false,
        hasStarted: true,
        dueAt: new Date("2026-06-30T12:00:00.000Z"),
        now,
      }),
    ).toBe("OVERDUE");
  });

  it("marks started non-overdue enrollments as in progress", () => {
    expect(
      deriveEnrollmentStatus({
        isCompleted: false,
        hasStarted: true,
        dueAt: new Date("2026-07-02T12:00:00.000Z"),
        now,
      }),
    ).toBe("IN_PROGRESS");
  });

  it("leaves untouched non-started enrollments assigned", () => {
    expect(
      deriveEnrollmentStatus({
        isCompleted: false,
        hasStarted: false,
        dueAt: null,
        now,
      }),
    ).toBe("ASSIGNED");
  });
});
