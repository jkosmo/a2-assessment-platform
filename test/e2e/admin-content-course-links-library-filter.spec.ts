import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// e2e for #744 (course-builder "Åpne" links) + #745 (library course filter).
//
// Reuses the shared admin-content mock harness. The library HTML is reached via its static
// file path (the e2e static server maps `/admin-content` to the conversational shell — see
// admin-content-module-library.spec.ts). The course builder + sections list are reached via
// their canonical routes, which the static server serves (as in admin-content-workspaces.spec.ts).
const LIBRARY_PATH = "/admin-content-library.html";

test.describe("#744 course builder — per-item 'Åpne' editor links (new tab)", () => {
  test("module row links to its conversation editor and section row to the section editor, both target=_blank", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: "Labour rights",
          description: null,
          certificationLevel: "basic",
          moduleCount: 1,
          updatedAt: "2026-04-18T12:00:00.000Z",
          publishedAt: null,
          archivedAt: null,
          modules: [],
        },
      ],
      libraryModules: [{ id: "module-1", title: "Trade unions", status: "published" }],
    });

    // The course builder loads its interleaved item list from `/courses/:id/items` — not covered
    // by the shared harness glob (two path segments). Provide one MODULE + one SECTION item.
    await page.route("**/api/admin/content/courses/*/items", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { type: "MODULE", moduleId: "module-1", title: "Trade unions", sortOrder: 0, discussionsEnabled: true },
            { type: "SECTION", sectionId: "section-1", title: "Intro reading", sortOrder: 1, discussionsEnabled: true },
          ],
        }),
      });
    });
    // Section picker load in the builder — return an empty library (not under test here).
    await page.route("**/api/admin/content/sections", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
    });

    await page.goto("/admin-content/courses/course-1");

    const moduleRow = page.locator('.module-list-item[data-item-type="MODULE"]');
    const sectionRow = page.locator('.module-list-item[data-item-type="SECTION"]');
    await expect(moduleRow).toBeVisible();
    await expect(sectionRow).toBeVisible();

    // Module item → conversation editor, new tab.
    const moduleOpen = moduleRow.getByRole("link", { name: "Åpne" });
    await expect(moduleOpen).toHaveAttribute("href", "/admin-content/module/module-1/conversation");
    await expect(moduleOpen).toHaveAttribute("target", "_blank");
    await expect(moduleOpen).toHaveAttribute("rel", /noopener/);

    // Section item → section editor, new tab.
    const sectionOpen = sectionRow.getByRole("link", { name: "Åpne" });
    await expect(sectionOpen).toHaveAttribute("href", "/admin-content/sections?id=section-1");
    await expect(sectionOpen).toHaveAttribute("target", "_blank");

    // The "Åpne" link sits next to "Fjern" in the row's action area.
    await expect(moduleRow.locator(".module-list-item-actions")).toContainText("Åpne");
    await expect(moduleRow.locator(".module-list-item-actions")).toContainText("Fjern");
  });
});

test.describe("#745 module library — filter by course", () => {
  test("selecting a course keeps only its modules; 'Ikke i noe kurs' keeps course-less modules; 'Alle kurs' shows all", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-x", title: "Module X", status: "published", courseCount: 1, courses: [{ id: "course-a", title: "Kurs A" }] },
        { id: "module-y", title: "Module Y", status: "published", courseCount: 0, courses: [] },
      ],
    });

    await page.goto(LIBRARY_PATH);

    const table = page.locator(".library-table");
    await expect(table).toContainText("Module X");
    await expect(table).toContainText("Module Y");

    const courseSelect = page.locator("#libraryCourseFilter");
    // The dropdown was rebuilt from the data: it offers "Kurs A" plus the two fixed groups.
    await expect(courseSelect.locator("option")).toContainText(["Alle kurs", "Kurs A", "Ikke i noe kurs"]);

    // Select "Kurs A" → only X survives.
    await courseSelect.selectOption("course-a");
    await expect(table).toContainText("Module X");
    await expect(table).not.toContainText("Module Y");

    // Select "Ikke i noe kurs" → only Y survives.
    await courseSelect.selectOption("__none__");
    await expect(table).toContainText("Module Y");
    await expect(table).not.toContainText("Module X");

    // Back to "Alle kurs" → both visible.
    await courseSelect.selectOption("__all__");
    await expect(table).toContainText("Module X");
    await expect(table).toContainText("Module Y");
  });

  test("course filter composes with the search box", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [
        { id: "module-x", title: "Trade unions", status: "published", courseCount: 1, courses: [{ id: "course-a", title: "Kurs A" }] },
        { id: "module-z", title: "Bargaining basics", status: "published", courseCount: 1, courses: [{ id: "course-a", title: "Kurs A" }] },
      ],
    });

    await page.goto(LIBRARY_PATH);
    await page.locator("#libraryCourseFilter").selectOption("course-a");
    await expect(page.locator(".library-table")).toContainText("Trade unions");
    await expect(page.locator(".library-table")).toContainText("Bargaining basics");

    // Search narrows within the course-filtered set.
    await page.locator("#librarySearch").fill("bargaining");
    await expect(page.locator(".library-table")).toContainText("Bargaining basics");
    await expect(page.locator(".library-table")).not.toContainText("Trade unions");
  });
});

test.describe("#745 section library — filter by course", () => {
  test("selecting a course keeps only its sections; 'Ikke i noe kurs' keeps course-less sections; 'Alle kurs' shows all", async ({ page }) => {
    await mockCommonApis(page);

    const sections = [
      {
        id: "section-x",
        title: "Section X",
        versionNo: 1,
        activeVersionId: "v1",
        archivedAt: null,
        updatedAt: "2026-04-18T12:00:00.000Z",
        courseCount: 1,
        courses: [{ id: "course-a", title: "Kurs A" }],
      },
      {
        id: "section-y",
        title: "Section Y",
        versionNo: 1,
        activeVersionId: "v1",
        archivedAt: null,
        updatedAt: "2026-04-18T12:00:00.000Z",
        courseCount: 0,
        courses: [],
      },
    ];
    await page.route("**/api/admin/content/sections", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections }) });
    });

    await page.goto("/admin-content/sections");

    const table = page.locator(".sections-table");
    await expect(table).toContainText("Section X");
    await expect(table).toContainText("Section Y");

    const courseSelect = page.locator("#sectionCourseFilter");
    await expect(courseSelect).toBeVisible();
    // The sections library is localized (L()); in the default en-GB e2e locale the fixed options
    // render in English — this guards against hardcoded Norwegian creeping back onto this page.
    await expect(courseSelect.locator("option")).toContainText(["All courses", "Kurs A", "Not in any course"]);

    await courseSelect.selectOption("course-a");
    await expect(page.locator(".sections-table")).toContainText("Section X");
    await expect(page.locator(".sections-table")).not.toContainText("Section Y");

    await page.locator("#sectionCourseFilter").selectOption("__none__");
    await expect(page.locator(".sections-table")).toContainText("Section Y");
    await expect(page.locator(".sections-table")).not.toContainText("Section X");

    await page.locator("#sectionCourseFilter").selectOption("__all__");
    await expect(page.locator(".sections-table")).toContainText("Section X");
    await expect(page.locator(".sections-table")).toContainText("Section Y");
  });
});
