import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #762: ADMINISTRATOR-only cascade delete — delete a course together with the modules/sections it
// exclusively owns. The row action must be hidden for a SUBJECT_MATTER_OWNER and shown for an
// ADMINISTRATOR; clicking it opens a confirmation dialog listing the preview (deleted / spared /
// blockers); confirming fires the delete POST.

const DRAFT_COURSE = {
  id: "course-1",
  title: "Labour rights",
  description: null,
  certificationLevel: "basic",
  moduleCount: 1,
  updatedAt: "2026-04-18T12:00:00.000Z",
  publishedAt: null,
  archivedAt: null,
  modules: [],
};

const PREVIEW = {
  courseId: "course-1",
  courseTitle: "Labour rights",
  deletableModules: [{ id: "module-1", title: "Intro modul", reason: "Kun brukt i dette kurset – slettes." }],
  deletableSections: [{ id: "section-1", title: "Intro seksjon", reason: "Kun brukt i dette kurset – slettes." }],
  sparedModules: [{ id: "module-2", title: "Delt modul", reason: "Delt med 1 annet kurs: «Annet kurs»." }],
  sparedSections: [],
  blockers: [],
  deletable: true,
};

async function mockCascadePreview(page: Page, preview: unknown) {
  await page.route("**/api/admin/content/courses/*/cascade-delete-preview", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preview) });
  });
}

test.describe("course cascade delete (#762)", () => {
  test("the cascade-delete action is hidden for a SUBJECT_MATTER_OWNER", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }], meRoles: ["SUBJECT_MATTER_OWNER"] });

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-action="cascade-delete"]')).toHaveCount(0);
  });

  test("ADMINISTRATOR sees the action; it opens the confirm dialog listing the preview; confirming fires delete", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }], meRoles: ["ADMINISTRATOR"] });
    await mockCascadePreview(page, PREVIEW);

    let deleteCalled = false;
    await page.route("**/api/admin/content/courses/*/cascade-delete", async (route: Route) => {
      deleteCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          deletedCourseId: "course-1",
          deletedModuleIds: ["module-1"],
          deletedSectionIds: ["section-1"],
          sparedModuleIds: ["module-2"],
          sparedSectionIds: [],
        }),
      });
    });

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await row.locator('[data-action="cascade-delete"]').click();

    const dialog = page.locator("#cascadeDeleteDialog");
    await expect(dialog).toBeVisible();
    // Lists what will be deleted and what will be spared.
    await expect(dialog).toContainText("Intro modul");
    await expect(dialog).toContainText("Intro seksjon");
    await expect(dialog).toContainText("Delt modul");

    // No blockers → confirm button is shown and enabled.
    const confirmBtn = page.locator("#cascadeDeleteConfirmBtn");
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect.poll(() => deleteCalled).toBe(true);
    await expect(page.locator(".toast--success")).toContainText("slettet");
  });

  test("the confirm button is hidden when the preview reports blockers", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }], meRoles: ["ADMINISTRATOR"] });
    await mockCascadePreview(page, {
      courseId: "course-1",
      courseTitle: "Labour rights",
      deletableModules: [],
      deletableSections: [],
      sparedModules: [],
      sparedSections: [],
      blockers: [{ id: "module-1", title: "Intro modul", reason: "Modulen «Intro modul» har 2 innleveringer og kan ikke slettes." }],
      deletable: false,
    });
    let deleteCalled = false;
    await page.route("**/api/admin/content/courses/*/cascade-delete", async (route: Route) => {
      deleteCalled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await row.locator('[data-action="cascade-delete"]').click();

    const dialog = page.locator("#cascadeDeleteDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("innleveringer");
    await expect(page.locator("#cascadeDeleteConfirmBtn")).toBeHidden();

    await page.locator("#cascadeDeleteCancelBtn").click();
    expect(deleteCalled).toBe(false);
  });
});
