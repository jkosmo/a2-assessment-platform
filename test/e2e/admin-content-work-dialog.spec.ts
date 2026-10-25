import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// 2.101.2 (produkteier 25.10): «Når man importerer så jobber systemet uten at det markeres at det jobbes
// og UI er fortsatt responsivt» — og «Kursor bør spinne, hvis ikke kan man risikere … at man
// reimporterer på nytt.» Mens importen går: et vindu som sier hva som skjer, ventepeker, og siden er
// sperret, så et nytt klikk ikke starter en import til. Når den er ferdig, er alt borte.
//
// Svaret holdes tilbake til testen slipper det, så tilstanden «underveis» kan måles uten å gjette på tid.

function heldResponse(page: Page, pattern: string, body: unknown, status = 201) {
  const sent: unknown[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  void page.route(pattern, async (route: Route) => {
    sent.push(route.request().postDataJSON());
    await released;
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return { sent, release };
}

const coursePackage = {
  exportFormat: "a2-content-export/v1",
  exportedAt: "2026-10-25T08:00:00.000Z",
  exportedBy: null,
  exportedByEmail: null,
  scope: "course",
  course: { course: { title: { nb: "Nytt kurs", nn: "Nytt kurs", "en-GB": "New course" }, description: null, certificationLevel: null, audit: { publishedAt: null, publishedBy: null, publishedByEmail: null, sourceVersionNo: null }, items: [] } },
};

const isWorking = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("is-working"));

test.describe("2.101.2 «systemet jobber» under import", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, modules: [] }],
      libraryModules: [{ id: "module-1", title: "Trade unions", status: "published" }],
    });
  });

  test("kursimport: vindu og ventepeker mens den går, siden er sperret, alt borte etterpå", async ({ page }) => {
    const held = heldResponse(page, "**/api/admin/content/courses/import", { courseId: "course-1", moduleIds: [], heldBackByTranslationGate: false });
    await page.goto("/admin-content/courses");
    await expect(page.locator(".list-table")).toBeVisible();
    await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(coursePackage)) });

    const dialog = page.locator(".work-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Importing the course");
    await expect(dialog).toContainText("Do not close the page");
    expect(await isWorking(page)).toBe(true);
    await expect(page.locator(".work-dialog-spinner")).toBeVisible();

    // Siden bak er inert: et klikk på «Importer» når ikke fram, og Esc lukker ikke vinduet.
    await page.locator("#importCoursePackageBtn").click({ force: true, timeout: 2000 }).catch(() => undefined);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(held.sent).toHaveLength(1);

    held.release();
    await expect(page).toHaveURL(/\/admin-content\/courses\/course-1$/);
    await expect(page.locator(".work-dialog")).toHaveCount(0);
    expect(await isWorking(page)).toBe(false);
  });

  test("feiler importen, forsvinner vinduet og feilen vises — ventepekeren henger ikke igjen", async ({ page }) => {
    const held = heldResponse(page, "**/api/admin/content/courses/import", { error: "validation_error", message: "bad" }, 400);
    await page.goto("/admin-content/courses");
    await expect(page.locator(".list-table")).toBeVisible();
    await page.setInputFiles("#importCoursePackageFile", { name: "kurs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(coursePackage)) });
    await expect(page.locator(".work-dialog")).toBeVisible();
    held.release();
    await expect(page.locator(".toast--error .toast__message")).toContainText("Course import failed");
    await expect(page.locator(".work-dialog")).toHaveCount(0);
    expect(await isWorking(page)).toBe(false);
  });

  test("modulimport viser det samme vinduet", async ({ page }) => {
    const held = heldResponse(page, "**/api/admin/content/modules/import", { moduleId: "module-9" });
    await page.goto("/admin-content");
    await expect(page.locator(".list-table")).toBeVisible();
    const modulePackage = { exportFormat: "a2-content-export/v1", exportedAt: "2026-10-25T08:00:00.000Z", scope: "module", module: { module: { title: { nb: "M" } } } };
    await page.setInputFiles("#importModulePackageFile", { name: "modul.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(modulePackage)) });
    await expect(page.locator(".work-dialog")).toContainText("Importing the module");
    expect(await isWorking(page)).toBe(true);
    held.release();
    await expect(page).toHaveURL(/\/admin-content\/module\/module-9\/conversation$/);
  });
});
