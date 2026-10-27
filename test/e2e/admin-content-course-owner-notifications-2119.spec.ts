import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// 2.119.0: under «Innstillinger» kan kursets eiere slå av e-posten de får når en deltaker stiller et
// nytt spørsmål. Bryteren viser lagret verdi, står på når feltet mangler, og sendes ved lagring.

async function openCourse(page: Page, course: Record<string, unknown>) {
  await mockCommonApis(page, {
    courses: [{ id: "course-1", title: "Velkommen", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-10-27T12:00:00.000Z", publishedAt: null, archivedAt: null, sortOrder: null, modules: [], ...course }],
    libraryModules: [],
  });
  await page.route("**/api/admin/content/courses/*/items", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  const sendt: Array<Record<string, unknown>> = [];
  await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    sendt.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/courses/course-1");
  await page.locator('[data-form-tab-btn="innstillinger"]').click();
  return sendt;
}

test.describe("2.119.0 kursskjemaet — e-post til eierne om nye spørsmål", () => {
  test("viser lagret «av», og sender «på» når den slås på", async ({ page }) => {
    const sendt = await openCourse(page, { discussionOwnerNotifications: false });
    const bryter = page.locator("#discussionOwnerNotifications");
    await expect(bryter).not.toBeChecked();
    await expect(page.getByText("Send e-post til kursets eiere når en deltaker stiller et nytt spørsmål")).toBeVisible();

    await bryter.check();
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ discussionOwnerNotifications: true });
  });

  test("står på når feltet mangler, og sender «av» når den slås av", async ({ page }) => {
    const sendt = await openCourse(page, {});
    const bryter = page.locator("#discussionOwnerNotifications");
    await expect(bryter).toBeChecked();

    await bryter.uncheck();
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ discussionOwnerNotifications: false, discussionsEnabled: true });
  });
});
