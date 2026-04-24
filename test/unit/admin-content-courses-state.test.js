import { describe, expect, it } from "vitest";
import {
  detectCoursesRoute,
  buildCourseDeleteDialogText,
  deriveCourseListRows,
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
      },
      {
        courseId: "course-2",
        title: "course-2",
        certificationLevel: "basic",
        moduleCount: 0,
        updatedLabel: "formatted:2026-03-02T08:15:00.000Z",
        publishedAt: "2026-03-02T08:15:00.000Z",
        archivedAt: null,
      },
    ]);
  });
});
