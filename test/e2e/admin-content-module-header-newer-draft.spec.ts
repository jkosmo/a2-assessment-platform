import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mockCommonApis, buildMockModuleExport } from "./admin-content-helpers.js";

// Prod 13.11.2026: modulen var «Publisert v1.2» med en nyere, upublisert lagring åpen i skjemaet. Hodet sa «Publisert v1.2»
// og «Utkast», og forfatteren så ikke at det hen så på, var et utkast oppå den publiserte. Kurs og seksjoner sier «Nyere
// utkast» i samme situasjon; modulen gjør det nå også.

const LIVE = "module-1-version-1";
const UTKAST = "module-1-version-2";
const nyereUtkast = /^Nyere utkast$|^Newer draft$/;
const bareUtkast = /^Utkast$|^Draft$/;

async function aapneModul(page: Page, { live, lastet }: { live: string | null; lastet: string }) {
  const bunt = buildMockModuleExport({ id: "module-1", title: "Test: Frihet under ansvar", moduleVersionId: lastet, activeVersionId: live });
  // Versjonene slik tjeneren sender dem: den publiserte har nummer, en lagring etterpå har det ikke.
  const lagring = { ...bunt.selectedConfiguration.moduleVersion!, id: UTKAST, versionNo: 2 };
  const publisert = { ...bunt.selectedConfiguration.moduleVersion!, id: LIVE, versionNo: 1, versionMajor: 1, versionMinor: 2, publishedAt: "2026-11-13T08:00:00.000Z" };
  const versjoner = live ? [lagring, publisert] : [lagring];
  bunt.versions.moduleVersions = versjoner as never;
  bunt.selectedConfiguration.moduleVersion = (lastet === LIVE ? publisert : lagring) as never;
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Test: Frihet under ansvar", ...(live ? { activeVersion: { versionNo: 1 } } : {}) }],
    moduleExports: { "module-1": bunt },
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#previewEditTitle").waitFor();
}

test.describe("modulhodet sier «Nyere utkast» når skjemaet viser en lagring oppå den publiserte", () => {
  test("publisert med en nyere lagring åpen: «Publisert v1.2» og «Nyere utkast», ikke bare «Utkast»", async ({ page }) => {
    await aapneModul(page, { live: LIVE, lastet: UTKAST });
    const tilstand = page.locator("#moduleFormHead .form-page-state");
    await expect(tilstand.locator(".status-badge--published")).toHaveText(/v1\.2/);
    await expect(tilstand.locator(".status-chip")).toHaveText(nyereUtkast);
    await expect(tilstand.locator(".status-badge--draft")).toHaveCount(0);
  });

  test("kontroll: aldri publisert er fortsatt «Utkast», uten brikken", async ({ page }) => {
    await aapneModul(page, { live: null, lastet: UTKAST });
    const tilstand = page.locator("#moduleFormHead .form-page-state");
    await expect(tilstand.locator(".status-badge--draft")).toHaveText(bareUtkast);
    await expect(tilstand.locator(".status-chip")).toHaveCount(0);
    await expect(tilstand.locator(".status-badge--published")).toHaveCount(0);
  });

  test("kontroll: den publiserte versjonen åpen gir bare «Publisert v1.2»", async ({ page }) => {
    await aapneModul(page, { live: LIVE, lastet: LIVE });
    const tilstand = page.locator("#moduleFormHead .form-page-state");
    await expect(tilstand.locator(".status-badge--published")).toHaveText(/v1\.2/);
    await expect(tilstand.locator(".status-chip")).toHaveCount(0);
    await expect(tilstand.locator(".status-badge--draft")).toHaveCount(0);
  });
});
