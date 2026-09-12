import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #977: kursdetaljens modulsøk kunne ikke brukes uten mus. Piltastene gjorde ingenting, ingen
// aria-activedescendant, og «Legg til modul» forble deaktivert for en tastaturbruker. Varianten
// med tastaturstøtte (samtaleveiviserens) var alt fjernet da dette ble rettet; den gjenværende
// har nå det samme.

test.describe("#977 — modulsøket i kursbyggeren kan betjenes med tastatur", () => {
  test("piltast ned markerer, Enter velger, «Legg til modul» blir aktiv — uten mus", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        { id: "course-1", title: "Kurs", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-04-18T12:00:00.000Z", publishedAt: null, archivedAt: null, modules: [] },
      ],
      libraryModules: [
        { id: "module-1", title: "Arbeidsrett", status: "published" },
        { id: "module-2", title: "Arbeidsmiljø", status: "published" },
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
    const addBtn = page.locator("#addModuleBtn");
    await expect(input).toBeVisible();
    await expect(addBtn).toBeDisabled();

    await input.click();
    await input.pressSequentially("Arbeids");
    await expect(page.locator("#comboboxDropdown .combobox-option")).toHaveCount(2);

    // ⚠️ Kjernen: bare tastatur herfra.
    await input.press("ArrowDown");
    await expect(page.locator("#comboboxOption-0")).toHaveClass(/highlighted/);
    await expect(input).toHaveAttribute("aria-activedescendant", "comboboxOption-0");
    await input.press("ArrowDown");
    await expect(page.locator("#comboboxOption-1")).toHaveClass(/highlighted/);
    await expect(input).toHaveAttribute("aria-activedescendant", "comboboxOption-1");

    await input.press("Enter");
    await expect(addBtn).toBeEnabled();
    await expect(input).toHaveValue("Arbeidsmiljø");
    await expect(page.locator("#comboboxDropdown")).toBeHidden();

    await addBtn.press("Enter");
    await expect(page.locator('.module-list-item[data-item-type="MODULE"]')).toHaveCount(1);
    await expect(page.locator('.module-list-item[data-item-type="MODULE"]')).toContainText("Arbeidsmiljø");
  });

  test("Escape lukker lista uten å velge", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Kurs", description: null, certificationLevel: "basic", moduleCount: 0, updatedAt: "2026-04-18T12:00:00.000Z", publishedAt: null, archivedAt: null, modules: [] }],
      libraryModules: [{ id: "module-1", title: "Arbeidsrett", status: "published" }],
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
    await input.pressSequentially("Arb");
    await expect(page.locator("#comboboxDropdown")).toBeVisible();
    await input.press("Escape");
    await expect(page.locator("#comboboxDropdown")).toBeHidden();
    await expect(page.locator("#addModuleBtn")).toBeDisabled();
  });
});
