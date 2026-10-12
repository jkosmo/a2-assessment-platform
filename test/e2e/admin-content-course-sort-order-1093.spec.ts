import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #1093: «Mine kurs» sorteres alfabetisk, og et kurs kan få en plassering i kursskjemaet. Feltet
// viser den lagrede plasseringen, sender et tall når det er fylt ut, og null når det tømmes — null
// er det vanlige, og betyr «alfabetisk».

test.describe("#1093 kursskjemaet — plassering i «Mine kurs»", () => {
  test("feltet viser lagret plassering, sender tallet ved lagring, og null når det tømmes", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: "Velkommen",
          description: null,
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-10-11T12:00:00.000Z",
          publishedAt: null,
          archivedAt: null,
          sortOrder: 3,
          modules: [],
        },
      ],
      libraryModules: [],
    });
    await page.route("**/api/admin/content/courses/*/items", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
    const sendt: unknown[] = [];
    await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      sendt.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
    });

    await page.goto("/admin-content/courses/course-1");
    // Feltet ligger under fanen «Innstillinger», sammen med synlighet og diskusjon.
    const innstillinger = page.locator('[data-form-tab-btn="innstillinger"]');
    await innstillinger.click();
    const felt = page.locator("#sortOrder");
    await expect(felt).toHaveValue("3");

    await felt.fill("5");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ sortOrder: 5 });

    if (!(await felt.isVisible())) await innstillinger.click();
    await felt.fill("");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sendt.length).toBe(2);
    expect(sendt[1]).toMatchObject({ sortOrder: null });
  });
});
