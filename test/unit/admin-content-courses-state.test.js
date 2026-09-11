import { describe, expect, it } from "vitest";
import {
  detectCoursesRoute,
  buildCourseItemHref,
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
        canManage: true,
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
        canManage: true,
      },
    ]);
  });

  // #787 slice 5: canManage passes through — absent ⇒ true (older payload / admin), explicit false ⇒ false.
  it("deriveCourseListRows carries canManage (false only when explicitly false)", () => {
    const rows = deriveCourseListRows(
      [
        { id: "owned", title: {}, canManage: true },
        { id: "not-owned", title: {}, canManage: false },
        { id: "legacy", title: {} },
      ],
      { localizeTitle: () => "", formatDate: () => "" },
    );
    expect(rows.map((r) => r.canManage)).toEqual([true, false, true]);
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

// ─────────────────────────────────────────────────────────────────────────────
// #1052: lenken fra kursets elementliste må bære opphavet.
//
// ⚠️ TRUKKET UT HIT FORDI MUTASJONSTESTING VISTE AT INGEN TEST SÅ DEN. Da jeg satte kursstien til
// tom streng i `renderModuleList()`, forble DOM-suiten grønn — lenken rendres inne i en funksjon
// som trenger hele kursflaten for å kjøre, og ingen test gjorde det.
//
// ⚠️ OG DET ER IKKE PYNT. Lenken åpnes med `target="_blank"`. I en fersk fane finnes ingen
// nettleserhistorikk, så appens egen «Tilbake» er det ENESTE som finnes. Uten `returnTo` står
// forfatteren i en blindvei — ikke bare på feil sted.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1052 — kurslenken bærer opphavet", () => {
  it("⚠️ en seksjon får returnTo på riktig skilletegn", () => {
    // Seksjons-URL-en har allerede `?id=`, så opphavet må henges på med `&`. En `?` her ville
    // gjort resten av spørrestrengen til en del av id-en.
    const href = buildCourseItemHref({ type: "SECTION", refId: "sec1" }, "kurs1");
    expect(href).toBe("/admin-content/sections?id=sec1&returnTo=%2Fadmin-content%2Fcourses%2Fkurs1");
  });

  it("⚠️ en modul får det med `?`, siden stien er ren", () => {
    const href = buildCourseItemHref({ type: "MODULE", refId: "mod1" }, "kurs1");
    expect(href).toBe("/admin-content/module/mod1/conversation?returnTo=%2Fadmin-content%2Fcourses%2Fkurs1");
  });

  it("⚠️ uten kurs-id er lenken uendret — kontrollcase", () => {
    // Blokkeringens makker. Uten denne kunne hjelperen hengt på en tom `returnTo=` overalt, og
    // testene over ville sett like grønne ut mens biblioteksvisningen fikk søppel i URL-en.
    expect(buildCourseItemHref({ type: "SECTION", refId: "sec1" }, null))
      .toBe("/admin-content/sections?id=sec1");
    expect(buildCourseItemHref({ type: "MODULE", refId: "mod1" }, ""))
      .toBe("/admin-content/module/mod1/conversation");
  });

  it("id-er kodes, så en id med skråstrek ikke bryter stien", () => {
    expect(buildCourseItemHref({ type: "SECTION", refId: "a/b" }, "k1")).toContain("id=a%2Fb");
  });
});
