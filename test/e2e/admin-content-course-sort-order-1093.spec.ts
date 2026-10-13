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

  test("#1094: et ugyldig tall lagres ikke stille — melding, fanen «Innstillinger» og feltet i fokus; ingenting sendes", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Velkommen", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: null, archivedAt: null, sortOrder: 3, modules: [] }],
      libraryModules: [],
    });
    await page.route("**/api/admin/content/courses/*/items", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
    const sendt: unknown[] = [];
    await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      sendt.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/courses/course-1");
    const innstillinger = page.locator('[data-form-tab-btn="innstillinger"]');
    const felt = page.locator("#sortOrder");
    for (const ugyldig of ["1-", "1e2", "10000", "2.5"]) {
      if (!(await felt.isVisible())) await innstillinger.click();
      await felt.fill("");
      await felt.pressSequentially(ugyldig);
      // Gå til en annen fane, så lagringen må hente oss tilbake til feltet.
      await page.locator('[data-form-tab-btn]').first().click();
      await page.locator("#formSaveBtn").click();
      // Synlig, ikke bare i DOM-en: banneret lå i «Rediger»-fanen og ble skjult når skjemaet byttet fane.
      await expect(page.locator("#formErrorBanner")).toBeVisible();
      await expect(page.locator("#formErrorBanner")).toContainText("helt tall fra 0 til 9999");
      await expect(felt).toBeVisible();
      await expect(felt).toBeFocused();
    }
    expect(sendt).toEqual([]);
    // Et gyldig tall går gjennom etterpå.
    await felt.fill("7");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ sortOrder: 7 });
  });

  test("#1094: kurslista viser plasseringen som merke ved navnet, og ingenting for kurs uten plassering", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        { id: "course-1", title: "Velkommen", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: null, archivedAt: null, sortOrder: 2, modules: [] },
        { id: "course-2", title: "Rutiner", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: null, archivedAt: null, sortOrder: null, modules: [] },
      ],
      libraryModules: [],
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/courses");
    const rad = (navn: string) => page.locator(".list-table tbody tr", { hasText: navn });
    await expect(rad("Velkommen").locator(".course-placement-chip")).toHaveText("Nr. 2");
    await expect(rad("Rutiner").locator(".course-placement-chip")).toHaveCount(0);
  });
});
