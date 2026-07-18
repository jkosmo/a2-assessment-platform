import { describe, expect, it } from "vitest";
import {
  detectCoursesRoute,
  buildCourseDeleteDialogText,
  deriveCourseListRows,
  moveItem,
  courseItemTypeBadge,
} from "../../public/static/admin-content-courses-state.js";

describe("admin content courses state helpers", () => {
  it("detects list, new-course, and detail routes", () => {
    expect(detectCoursesRoute("/admin-content/courses")).toEqual({ view: "list" });
    expect(detectCoursesRoute("/admin-content/courses/new")).toEqual({
      view: "detail",
      courseId: null,
    });
    expect(detectCoursesRoute("/admin-content/courses/course-123")).toEqual({
      view: "detail",
      courseId: "course-123",
    });
  });

  it("builds stable delete dialog copy", () => {
    expect(buildCourseDeleteDialogText("Arbeidsliv")).toContain("Arbeidsliv");
    expect(buildCourseDeleteDialogText("Arbeidsliv")).toContain("Modulene forblir i biblioteket uendret.");
  });

  it("derives course-list rows with localized titles and updated labels", () => {
    const rows = deriveCourseListRows(
      [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger" },
          certificationLevel: "advanced",
          moduleCount: 4,
          updatedAt: "2026-04-18T10:30:00.000Z",
        },
        {
          id: "course-2",
          title: {},
          certificationLevel: "basic",
          publishedAt: "2026-03-02T08:15:00.000Z",
        },
      ],
      {
        localizeTitle: (value) => value?.nb ?? value?.["en-GB"] ?? "",
        formatDate: (value) => `formatted:${value}`,
      },
    );

    expect(rows).toEqual([
      {
        courseId: "course-1",
        title: "Fagforeninger",
        certificationLevel: "advanced",
        moduleCount: 4,
        updatedLabel: "formatted:2026-04-18T10:30:00.000Z",
        publishedAt: null,
        archivedAt: null,
        inProgressCount: 0,
      },
      {
        courseId: "course-2",
        title: "course-2",
        certificationLevel: "basic",
        moduleCount: 0,
        updatedLabel: "formatted:2026-03-02T08:15:00.000Z",
        publishedAt: "2026-03-02T08:15:00.000Z",
        archivedAt: null,
        inProgressCount: 0,
      },
    ]);
  });

  // #524 (U3): the course-builder mixed module/section list — reorder + type-badge logic.
  describe("moveItem (reorder)", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("moves an item up one step (returns a new array)", () => {
      const result = moveItem(list, 1, "up");
      expect(result.map((x) => x.id)).toEqual(["b", "a", "c"]);
      expect(result).not.toBe(list); // immutable — original untouched
      expect(list.map((x) => x.id)).toEqual(["a", "b", "c"]);
    });

    it("moves an item down one step", () => {
      expect(moveItem(list, 1, "down").map((x) => x.id)).toEqual(["a", "c", "b"]);
    });

    it("is a no-op at the boundaries (top up, bottom down) and for bad indices", () => {
      expect(moveItem(list, 0, "up").map((x) => x.id)).toEqual(["a", "b", "c"]);
      expect(moveItem(list, 2, "down").map((x) => x.id)).toEqual(["a", "b", "c"]);
      expect(moveItem(list, 5, "up").map((x) => x.id)).toEqual(["a", "b", "c"]);
      expect(moveItem(undefined, 0, "down")).toEqual([]);
    });
  });

  describe("courseItemTypeBadge", () => {
    it("distinguishes sections from modules", () => {
      expect(courseItemTypeBadge("SECTION")).toBe("SEKSJON");
      expect(courseItemTypeBadge("MODULE")).toBe("MODUL");
      expect(courseItemTypeBadge(undefined)).toBe("MODUL");
    });
  });
});
