import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mockCommonApis, buildMockModuleExport } from "./admin-content-helpers.js";

// #1193: «Fjern», «Legg til» og «Generer på nytt» for kriteriene i Innstillinger sendte ingen input-hendelse. Hodet sa «Alt lagret»,
// Lagre var grå, og lukkes fanen, varslet sida ikke (form-page.js leser det speilede svaret). Fjerningen var tapt uten et ord.

async function aapneInnstillinger(page: Page) {
  const bunt = buildMockModuleExport({ id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1" });
  bunt.selectedConfiguration.rubricVersion = {
    id: "rubric-1",
    versionNo: 1,
    criteria: {
      clarity: { label: "Clarity", description: "Is it clear?", maxScore: 5, weight: 0.5, candidateVisible: true },
      depth: { label: "Depth", description: "Is it deep?", maxScore: 5, weight: 0.5, candidateVisible: false },
    },
    scalingRule: { max_total: 10, practical_weight: 70 },
  } as never;
  await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": bunt } });
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#formTab-settings").click();
  await expect(page.locator("#settingsCriteriaEditor .vk-card")).toHaveCount(2);
  await expect(page.locator("#formPageDirty")).not.toHaveClass(/is-dirty/);
}

test.describe("#1193 — kriterieendringer i Innstillinger vises som ulagret", () => {
  test("Fjern gjør modulen ulagret, og Lagre blir aktiv", async ({ page }) => {
    await aapneInnstillinger(page);
    await page.locator("#settingsCriteriaEditor .vk-remove").first().click();
    await expect(page.locator("#settingsCriteriaEditor .vk-card")).toHaveCount(1);
    await expect(page.locator("#formPageDirty")).toHaveClass(/is-dirty/);
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
  });

  // Kontroll: et tomt, nytt kriterium droppes ved lagring, så det er ingen endring før noe er skrevet i det. Da sier hodet fra.
  test("kontroll: Legg til uten tekst er ingen endring; teksten i det nye kriteriet er det", async ({ page }) => {
    await aapneInnstillinger(page);
    await page.locator("#settingsCriteriaEditor .vk-add").click();
    await expect(page.locator("#settingsCriteriaEditor .vk-card")).toHaveCount(3);
    await expect(page.locator("#formPageDirty")).not.toHaveClass(/is-dirty/);
    await page.locator("#settingsCriteriaEditor .vk-label").last().fill("Originality");
    await expect(page.locator("#formPageDirty")).toHaveClass(/is-dirty/);
  });

  test("lukking av fanen etter Fjern varsler (beforeunload)", async ({ page }) => {
    await aapneInnstillinger(page);
    await page.locator("#settingsCriteriaEditor .vk-remove").first().click();
    await expect(page.locator("#formPageDirty")).toHaveClass(/is-dirty/);
    const varsel = page.waitForEvent("dialog");
    void page.close({ runBeforeUnload: true });
    const d = await varsel;
    expect(d.type()).toBe("beforeunload");
    await d.dismiss();
  });
});
