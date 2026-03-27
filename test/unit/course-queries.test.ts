import { describe, expect, it } from "vitest";
import { computeCourseStatus } from "../../src/modules/course/courseQueries.js";

describe("computeCourseStatus", () => {
  it("returns NOT_STARTED when a course has no modules", () => {
    expect(computeCourseStatus(0, 0)).toBe("NOT_STARTED");
  });

  it("returns COMPLETED when all modules are passed", () => {
    expect(computeCourseStatus(2, 2)).toBe("COMPLETED");
    expect(computeCourseStatus(3, 2)).toBe("COMPLETED");
  });

  it("returns IN_PROGRESS when the participant has started but not completed the course", () => {
    expect(computeCourseStatus(1, 3)).toBe("IN_PROGRESS");
    expect(computeCourseStatus(0, 3, true)).toBe("IN_PROGRESS");
  });

  it("returns NOT_STARTED when nothing has been passed or started yet", () => {
    expect(computeCourseStatus(0, 3, false)).toBe("NOT_STARTED");
  });
});
