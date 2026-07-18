import { test, expect, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #524 (U3): the course builder can add a reusable learning section from the library. It must appear in
// the mixed content list as a [SEKSJON] row — colour-coded / distinct from modules via data-item-type +
// the type badge — with its title.
test("course builder: add a section from the library renders it as a [SEKSJON] row", async ({ page }) => {
  await mockCommonApis(page, {
    courses: [
      { id: "course-1", title: { nb: "Kurs" }, certificationLevel: "basic", moduleCount: 0, modules: [] },
    ],
    libraryModules: [],
  });

  // Library sections available to the picker (GET /api/admin/content/sections). Registered after
  // mockCommonApis so this handler wins for the GET; other methods fall through.
  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sections: [{ id: "sec-1", title: { nb: "Innføring" } }] }),
    });
  });

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });

  await page.goto("/admin-content/courses/course-1");

  // The picker is populated, and there is no section row yet.
  await expect(page.locator("#sectionSelect option[value='sec-1']")).toHaveCount(1);
  await expect(page.locator('#moduleList .module-list-item[data-item-type="SECTION"]')).toHaveCount(0);

  // Add the section from the library.
  await page.locator("#sectionSelect").selectOption("sec-1");
  await page.locator("#addSectionBtn").click();

  // It appears as a distinct [SEKSJON] row carrying the section title.
  const sectionRow = page.locator('#moduleList .module-list-item[data-item-type="SECTION"]');
  await expect(sectionRow).toHaveCount(1);
  await expect(sectionRow.locator(".item-type-badge")).toHaveText("SEKSJON");
  await expect(sectionRow).toContainText("Innføring");

  // And it is no longer offered in the picker (can't add the same section twice).
  await expect(page.locator("#sectionSelect option[value='sec-1']")).toHaveCount(0);
});
