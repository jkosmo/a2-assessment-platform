import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// Produkteier 2026-11-01: «Når man eksporterer et kurs går det 2–3 sekunder før noe skjer.» Pakka
// bygges på tjeneren, og knappen ga ingen tegn til at den jobbet. Nå er den opptatt (låst, merket
// aria-busy) til fila er lastet ned, og meldingen etterpå følger språket — den sto på bokmål uansett.
//
// Tjenerens svar holdes igjen til testen slipper det, så opptatt-tilstanden kan sees.

function holdExport(page: Page, pattern: string, envelope: unknown) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  void page.route(pattern, async (route: Route) => {
    calls.push(new URL(route.request().url()).pathname);
    await released;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ envelope }) });
  });
  return { release: () => release(), calls };
}

const COURSE = { id: "course-1", title: "Velkommen", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: null, archivedAt: null, sortOrder: null, modules: [] };

test("kurslista: «Export» er opptatt mens pakka bygges, og meldingen etterpå er på engelsk", async ({ page }) => {
  await mockCommonApis(page, { courses: [COURSE], libraryModules: [] });
  const held = holdExport(page, "**/api/admin/content/courses/course-1/export-package", { exportFormat: "a2-content-export/v1", scope: "course", course: { course: { title: "Velkommen", items: [] } } });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ } });
  await page.goto("/admin-content/courses");

  const knapp = page.locator('.list-table tbody tr[data-row-id="course-1"] [data-action="export"]');
  await revealRowAction(page, knapp);
  const download = page.waitForEvent("download");
  await knapp.click();
  await expect.poll(() => held.calls.length).toBe(1);
  await expect(knapp).toHaveAttribute("aria-busy", "true");
  await expect(knapp).toBeDisabled();
  // Et klikk til mens den jobber, starter ingen ny eksport.
  await knapp.click({ force: true });

  held.release();
  await download;
  await expect(knapp).not.toHaveAttribute("aria-busy", "true");
  await expect(knapp).toBeEnabled();
  await expect(page.locator("#toastRegion")).toContainText("Course «Velkommen» exported.");
  expect(held.calls).toHaveLength(1);
});

test("modulbiblioteket: «Eksporter» er opptatt mens pakka bygges", async ({ page }) => {
  await mockCommonApis(page, { libraryModules: [{ id: "module-1", title: "Modul én", status: "draft", courseCount: 0, canManage: true }] });
  const held = holdExport(page, "**/api/admin/content/modules/module-1/export-package", { exportFormat: "a2-content-export/v1", scope: "module", module: {} });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content");

  const knapp = page.locator('[data-action="export"][data-module-id="module-1"]');
  await revealRowAction(page, knapp);
  const download = page.waitForEvent("download");
  await knapp.click();
  await expect.poll(() => held.calls.length).toBe(1);
  await expect(knapp).toHaveAttribute("aria-busy", "true");

  held.release();
  await download;
  await expect(knapp).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#toastRegion")).toContainText("Modul «Modul én» er eksportert.");
});
