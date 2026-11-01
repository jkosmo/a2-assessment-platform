import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// 2.126.0 (produkteier 2026-11-01): kurslista i innholdsforvaltningen vises etter tema eller
// alfabetisk, som «Mine kurs». Samme regler som der: temaene alfabetisk, et kurs med flere tema
// under hvert av dem, kurs uten tema sist; valget huskes; valget vises ikke når ingen kurs har tema.

const GRUNN = { id: "t-grunn", name: "Grunnleggende KI" };
const SIKK = { id: "t-sikk", name: "Sikkerhet" };
const kurs = (id: string, title: string, themes: Array<{ id: string; name: string }>, moduleCount = 1) => ({
  id, title, description: null, certificationLevel: "basic", moduleCount, updatedAt: "2026-10-11T12:00:00.000Z",
  publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, sortOrder: null, modules: [], themes,
});
const KURS = [
  kurs("c-ref", "Referat med KI", [GRUNN], 1),
  kurs("c-risk", "Risikovurdering", [SIKK], 5),
  kurs("c-mote", "Møtearbeid", [GRUNN, SIKK], 3),
  kurs("c-stat", "Statens prosjektmodell", []),
];

async function open(page: Page, courses = KURS) {
  await mockCommonApis(page, { courses, libraryModules: [] });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/courses");
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible();
}

const overskrifter = (page: Page) => page.locator(".list-table .list-group-heading");
const radTitler = (page: Page) => page.locator(".list-table tbody tr[data-row-id] td.col-title");

test("etter tema er standard: temaene alfabetisk, kurs med to tema under begge, kurs uten tema sist", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-list-view="group"]')).toHaveAttribute("aria-pressed", "true");
  await expect(overskrifter(page)).toHaveText(["Grunnleggende KI", "Sikkerhet", "Kurs uten tema"]);
  await expect(page.locator(".list-group-count")).toHaveText(["2 kurs", "2 kurs", "1 kurs"]);
  // Innad i gruppen: alfabetisk på navn (standardsorteringen).
  const titler = (await radTitler(page).allInnerTexts()).map((s) => s.trim());
  expect(titler).toEqual(["Møtearbeid", "Referat med KI", "Møtearbeid", "Risikovurdering", "Statens prosjektmodell"]);
});

test("sortering på en kolonne gjelder innad i hvert tema", async ({ page }) => {
  await open(page);
  await page.locator('th[data-sort-key="moduleCount"]').click();
  await page.locator('th[data-sort-key="moduleCount"]').click();
  const titler = (await radTitler(page).allInnerTexts()).map((s) => s.trim());
  expect(titler).toEqual(["Møtearbeid", "Referat med KI", "Risikovurdering", "Møtearbeid", "Statens prosjektmodell"]);
  await expect(overskrifter(page)).toHaveText(["Grunnleggende KI", "Sikkerhet", "Kurs uten tema"]);
});

test("alfabetisk: ingen overskrifter, hvert kurs én gang med temaene under navnet — og valget huskes", async ({ page }) => {
  await open(page);
  await page.locator('[data-list-view="alphabetical"]').click();
  await expect(page.locator('[data-list-view="alphabetical"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-list-view="alphabetical"]')).toBeFocused();
  await expect(overskrifter(page)).toHaveCount(0);
  await expect(radTitler(page)).toHaveCount(4);
  await expect(page.locator('tr[data-row-id="c-mote"] .list-group-themes')).toHaveText("Grunnleggende KI · Sikkerhet");
  await expect(page.locator('tr[data-row-id="c-stat"] .list-group-themes')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-list-view="alphabetical"]')).toHaveAttribute("aria-pressed", "true");
  await expect(overskrifter(page)).toHaveCount(0);
});

test("ingen kurs har tema: valget vises ikke, og lista står uten overskrifter", async ({ page }) => {
  await open(page, [kurs("c-a", "Alfa", []), kurs("c-b", "Beta", [])]);
  await expect(page.locator(".list-view-toggle")).toHaveCount(0);
  await expect(overskrifter(page)).toHaveCount(0);
  await expect(radTitler(page)).toHaveCount(2);
});

test("filter og søk virker i temavisningen; et tema uten treff forsvinner", async ({ page }) => {
  await open(page);
  await page.locator("#coursesSearch").fill("risiko");
  await expect(overskrifter(page)).toHaveText(["Sikkerhet"]);
  await expect(radTitler(page)).toHaveCount(1);
});

// QA-porten 2026-11-01: kurset står én gang per tema, med hver sin eksportknapp. Låsen må gjelde kurset.
test("eksport av et kurs under to tema: den andre knappen er låst mens den første jobber", async ({ page }) => {
  await open(page);
  const kall: string[] = [];
  let slipp: () => void = () => {};
  const holdt = new Promise<void>((resolve) => { slipp = resolve; });
  await page.route("**/api/admin/content/courses/c-mote/export-package", async (route: Route) => {
    kall.push("export");
    await holdt;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ envelope: { exportFormat: "a2-content-export/v1", scope: "course", course: { course: { title: "Møtearbeid", items: [] } } } }) });
  });
  const første = page.locator('tr[data-row-id="c-mote"]').nth(0).locator('[data-action="export"]');
  const andre = page.locator('tr[data-row-id="c-mote"]').nth(1).locator('[data-action="export"]');
  await revealRowAction(page, første);
  await første.click();
  await expect.poll(() => kall.length).toBe(1);
  await expect(andre).toBeDisabled();
  await andre.evaluate((b: HTMLButtonElement) => { b.disabled = false; b.click(); });
  slipp();
  await expect(andre).toBeEnabled();
  expect(kall).toEqual(["export"]);
});

test("handlingene virker på et kurs som står under to tema", async ({ page }) => {
  await open(page);
  const kall: string[] = [];
  await page.route("**/api/admin/content/courses/c-mote/export-package", async (route: Route) => {
    kall.push("export");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ envelope: { exportFormat: "a2-content-export/v1", scope: "course", course: { course: { title: "Møtearbeid", items: [] } } } }) });
  });
  const knapp = page.locator('tr[data-row-id="c-mote"]').nth(1).locator('[data-action="export"]');
  await revealRowAction(page, knapp);
  await knapp.click();
  await expect.poll(() => kall).toEqual(["export"]);
});
