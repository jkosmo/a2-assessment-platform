import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// Prod 2.154.2, 13.11.2026: modulen «Test: Frihet under ansvar» var publisert (versjon 1.0 live), men
// kom ikke opp i kursbyggerens søk. Den hadde to nyere, upubliserte lagringer, og står da som
// «published_with_draft» i biblioteket. Velgeren slapp bare gjennom nøyaktig «published» (#440).
//
// Regelen fra #440 er «bare publiserte moduler kan legges i et kurs». En modul med en live versjon og
// et nyere utkast ER publisert: deltakerne får den live versjonen.

const kurs = { id: "course-1", title: "Kurs", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-04-18T12:00:00.000Z", publishedAt: null, archivedAt: null, modules: [] };

test.describe("kursbyggerens søk tilbyr alle moduler som er live", () => {
  test("live med nyere utkast tilbys og kan legges til; upublisert og arkivert tilbys ikke", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [kurs],
      libraryModules: [
        { id: "m-live", title: "Test: Bare publisert", status: "published" },
        { id: "m-utkast", title: "Test: Frihet under ansvar", status: "published_with_draft" },
        { id: "m-aldri", title: "Test: Aldri publisert", status: "unpublished_draft" },
        { id: "m-tom", title: "Test: Tomt skall", status: "ready" },
        { id: "m-arkivert", title: "Test: Arkivert", status: "archived" },
      ],
    });
    await page.route("**/api/admin/content/courses/*/items", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    });
    await page.route("**/api/admin/content/sections", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
    });
    await page.goto("/admin-content/courses/course-1");

    const input = page.locator("#comboboxInput");
    await expect(input).toBeVisible();
    await input.click();
    // Som i meldingen fra prod: «test:».
    await input.pressSequentially("test:");
    const valg = page.locator("#comboboxDropdown .combobox-option");
    await expect(valg).toHaveCount(2);
    await expect(valg.nth(0)).toContainText("Test: Bare publisert");
    await expect(valg.nth(1)).toContainText("Test: Frihet under ansvar");

    await valg.nth(1).click();
    await page.locator("#addItemBtn").click();
    await expect(page.locator('.form-row[data-item-type="MODULE"]')).toHaveCount(1);
    await expect(page.locator('.form-row[data-item-type="MODULE"]')).toContainText("Test: Frihet under ansvar");
  });

  // Samme melding fra prod: kurset sto som «Ulagrede endringer» bare fordi forfatteren hadde skrevet i søket.
  test("å søke er ikke en endring i kurset; å legge til er det", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [kurs],
      libraryModules: [{ id: "m-live", title: "Test: Bare publisert", status: "published" }],
    });
    await page.route("**/api/admin/content/courses/*/items", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    });
    await page.route("**/api/admin/content/sections", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
    });
    await page.goto("/admin-content/courses/course-1");

    const input = page.locator("#comboboxInput");
    await input.click();
    await input.pressSequentially("test:");
    await expect(page.locator("#comboboxDropdown .combobox-option")).toHaveCount(1);
    await expect(page.locator("#formPageDirty")).toHaveText(/^Alt lagret$|^All saved$/);
    await expect(page.locator("#formSaveBtn")).toBeDisabled();

    // Kontroll: et element lagt til ER en endring.
    await page.locator("#comboboxDropdown .combobox-option").first().click();
    await page.locator("#addItemBtn").click();
    await expect(page.locator("#formPageDirty")).toHaveText(/^Ulagrede endringer$|^Unsaved changes$/);
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
  });

  // Forfatteren publiserer modulen i en annen fane. Kurset har ulagret arbeid, så å laste sida på nytt er ingen utvei.
  for (const hendelse of ["visibilitychange", "focus"] as const) {
    test(`lista hentes på nytt når forfatteren kommer tilbake (${hendelse}); feiler hentingen, står den forrige`, async ({ page }) => {
      await mockCommonApis(page, { courses: [kurs], libraryModules: [] });
      let moduler: Array<{ id: string; title: string; status: string; lifecycle: string }> = [
        { id: "m-live", title: "Test: Bare publisert", status: "published", lifecycle: "published" },
        { id: "m-ny", title: "Test: Frihet under ansvar", status: "unpublished_draft", lifecycle: "draft" },
      ];
      let feiler = false;
      let hentinger = 0;
      await page.route("**/api/admin/content/modules/library**", async (route: Route) => {
        hentinger += 1;
        if (feiler) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "list_library_failed" }) });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: moduler }) });
      });
      await page.route("**/api/admin/content/courses/*/items", async (route: Route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      });
      await page.route("**/api/admin/content/sections", async (route: Route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
      });
      await page.goto("/admin-content/courses/course-1");
      const komTilbake = () =>
        page.evaluate((navn) => {
          if (navn === "focus") window.dispatchEvent(new Event("focus"));
          else document.dispatchEvent(new Event("visibilitychange"));
        }, hendelse);

      const input = page.locator("#comboboxInput");
      await input.click();
      await input.pressSequentially("test:");
      const valg = page.locator("#comboboxDropdown .combobox-option");
      await expect(valg).toHaveCount(1);
      const foer = hentinger;

      // Modulen publiseres «i den andre fanen», og forfatteren kommer tilbake. Søketeksten står.
      moduler = moduler.map((m) => (m.id === "m-ny" ? { ...m, status: "published", lifecycle: "published" } : m));
      await komTilbake();
      await expect(valg).toHaveCount(2);
      await expect(valg.nth(1)).toContainText("Test: Frihet under ansvar");
      await expect(input).toHaveValue("test:");
      expect(hentinger).toBe(foer + 1);

      // Feiler neste henting, står lista som den var — den tømmes ikke.
      feiler = true;
      await komTilbake();
      await expect.poll(() => hentinger).toBe(foer + 2);
      await expect(valg).toHaveCount(2);
    });
  }
});
