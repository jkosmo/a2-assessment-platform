import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// Kursskjemaet på telefon (målt under #934 skive 3 og rettet i 2.130.0): på 360 px fløt handlingsraden
// øverst (Lagre, Avbryt, Eksporter …) 13 px ut over kanten på bokmål, så siden kunne rulles sidelengs.
// Raden får bryte i stedet. Målt i nettleseren — en tom boks eller en lang etikett har bredde, uansett
// hva CSS-en «burde» gi.

function course() {
  return {
    id: "course-1",
    title: { "en-GB": "Generativ KI", nb: "Generativ KI", nn: "Generativ KI" },
    description: null,
    certificationLevel: "basic",
    moduleCount: 0,
    updatedAt: "2026-10-11T12:00:00.000Z",
    publishedAt: "2026-10-11T12:00:00.000Z",
    archivedAt: null,
    modules: [],
    versionMajor: 3,
    versionMinor: 1,
    certificateHolders: 0,
  };
}

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await mockCommonApis(page, { courses: [course() as never], libraryModules: [] });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.route("**/api/admin/content/courses/*/items", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.goto("/admin-content/courses/course-1");
  await expect(page.locator(".form-page-actions")).toBeVisible();
}

for (const width of [360, 390]) {
  test(`kursskjemaet på ${width} px: handlingsraden holder seg innenfor, ingen vannrett rulling`, async ({ page }) => {
    await open(page, width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const actions = await page.locator(".form-page-actions").boundingBox();
    expect(actions!.x + actions!.width).toBeLessThanOrEqual(width);
    // Kontrollcase: knappene finnes og er synlige — «skjul raden» ville også gitt null overflyt.
    await expect(page.locator(".form-page-actions button").first()).toBeVisible();
  });
}
