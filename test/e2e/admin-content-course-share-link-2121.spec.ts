import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// 2.121.0: kursskjemaet viser delingslenka under «Innstillinger» når kurset er publisert, og ellers
// hvorfor det ikke finnes noen ennå.

async function openCourse(page: Page, course: Record<string, unknown>) {
  await mockCommonApis(page, {
    courses: [{ id: "course-1", title: "Velkommen", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-10-31T12:00:00.000Z", publishedAt: null, archivedAt: null, sortOrder: null, modules: [], ...course }],
    libraryModules: [],
  });
  await page.route("**/api/admin/content/courses/*/items", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/courses/course-1");
  await page.locator('[data-form-tab-btn="innstillinger"]').click();
}

test.describe("2.121.0 kursskjemaet — lenke til kurset", () => {
  test("publisert kurs: lenka står der og kan kopieres", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openCourse(page, { slug: "velkommen", publishedAt: "2026-10-30T12:00:00.000Z" });
    const origin = new URL(baseURL ?? page.url()).origin;
    await expect(page.locator("#courseShareLink")).toHaveValue(`${origin}/kurs/velkommen`);
    await page.locator("#courseShareLinkCopy").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/kurs/velkommen`);
  });

  test("ikke publisert ennå: ingen lenke, bare hvorfor", async ({ page }) => {
    await openCourse(page, {});
    await expect(page.locator("#courseShareLink")).toHaveText("Lenken lages første gang kurset publiseres. Til da kan du endre tittelen fritt.");
    await expect(page.locator("#courseShareLinkCopy")).toHaveCount(0);
  });
});
