import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #734: publishing a course with unpublished modules/sections must open a cascade-publish dialog that
// lists them and offers to publish them together with the course. When every item is already
// published the course publishes directly (no dialog). When an item cannot be published the dialog
// explains why and blocks publishing (no "course only" escape hatch — that would leave broken content).

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

async function mockPublishPreview(page: Page, preview: unknown) {
  await page.route("**/api/admin/content/courses/*/publish-preview", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preview) });
  });
}

// Capture the publish POST body; returns a getter for the last publishItems flag.
async function mockPublish(page: Page, captured: { publishItems: boolean | null }) {
  await page.route("**/api/admin/content/courses/*/publish", async (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as { publishItems?: boolean };
    captured.publishItems = body.publishItems ?? false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ course: { id: "course-1", publishedAt: "2026-04-18T12:00:00.000Z" }, publishedItems: [] }),
    });
  });
}

test.describe("course cascade publish (#734)", () => {
  test("Publiser on a course with unpublished items opens the dialog listing them; confirming cascades", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }] });
    await mockPublishPreview(page, {
      courseId: "course-1",
      allPublished: false,
      publishable: true,
      unpublishedItems: [
        { type: "MODULE", id: "module-1", title: "Trade unions", publishable: true, blockers: [] },
        { type: "SECTION", id: "section-1", title: "Introduction", publishable: true, blockers: [] },
      ],
    });
    const captured = { publishItems: null as boolean | null };
    await mockPublish(page, captured);

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await row.locator('[data-action="publish"]').click();

    // Dialog opens and lists the unpublished module + section.
    const dialog = page.locator("#cascadePublishDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Trade unions");
    await expect(dialog).toContainText("Introduction");

    // Confirm → publish POST is sent with publishItems: true.
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => captured.publishItems).toBe(true);
    await expect(page.locator(".toast--success")).toContainText("Course published.");
  });

  test("all-published course publishes directly with no dialog", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }] });
    await mockPublishPreview(page, {
      courseId: "course-1",
      allPublished: true,
      publishable: true,
      unpublishedItems: [],
    });
    const captured = { publishItems: null as boolean | null };
    await mockPublish(page, captured);

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await row.locator('[data-action="publish"]').click();

    // No dialog; publish fires directly with publishItems: false.
    await expect.poll(() => captured.publishItems).toBe(false);
    await expect(page.locator("#cascadePublishDialog")).toBeHidden();
    await expect(page.locator(".toast--success")).toContainText("Course published.");
  });

  test("dialog blocks publishing when an item cannot be published, showing why", async ({ page }) => {
    await mockCommonApis(page, { courses: [{ ...DRAFT_COURSE }] });
    await mockPublishPreview(page, {
      courseId: "course-1",
      allPublished: false,
      publishable: false,
      unpublishedItems: [
        {
          type: "MODULE",
          id: "module-1",
          title: "Trade unions",
          publishable: false,
          blockers: [{ code: "module_no_content", message: "The module has no content to publish." }],
        },
      ],
    });
    let publishCalled = false;
    await page.route("**/api/admin/content/courses/*/publish", async (route: Route) => {
      publishCalled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: {}, publishedItems: [] }) });
    });

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await row.locator('[data-action="publish"]').click();

    const dialog = page.locator("#cascadePublishDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("The module has no content to publish.");
    // No cascade action offered; publish is never sent.
    await expect(page.locator("#cascadePublishConfirmBtn")).toBeHidden();
    await page.locator("#cascadePublishCancelBtn").click();
    expect(publishCalled).toBe(false);
  });
});
