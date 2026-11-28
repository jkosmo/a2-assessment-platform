import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis, buildMockModuleExport, clickEnabledButton } from "./admin-content-helpers.js";

// #1189: på modulsida spurte «Publiser» ikke om ulagrede endringer. Den lagrede versjonen ble publisert, modulen lastet på nytt,
// og rettelsen forfatteren nettopp hadde skrevet i Rediger, var borte. Kurset lagrer først; seksjon og klasse spør. Modulen spør nå.

const LIVE = "module-1-version-1";
const UTKAST = "module-1-version-2";
const sporsmal = /unsaved changes|ulagrede endringer|ulagra endringar/;

async function aapneModulMedNyereUtkast(page: Page) {
  const bunt = buildMockModuleExport({ id: "module-1", title: "Test: Frihet under ansvar", moduleVersionId: UTKAST, activeVersionId: LIVE });
  const lagring = { ...bunt.selectedConfiguration.moduleVersion!, id: UTKAST, versionNo: 2 };
  const publisert = { ...bunt.selectedConfiguration.moduleVersion!, id: LIVE, versionNo: 1, versionMajor: 1, versionMinor: 0, publishedAt: "2026-11-13T08:00:00.000Z" };
  bunt.versions.moduleVersions = [lagring, publisert] as never;
  bunt.selectedConfiguration.moduleVersion = lagring as never;
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Test: Frihet under ansvar", activeVersion: { versionNo: 1 } }],
    moduleExports: { "module-1": bunt },
  });
  // Teller bare selve publiseringen (POST), ikke forhåndsvisningen før den (QA 2026-11-23: testen talte forhåndsvisningen).
  const publiseringer: string[] = [];
  await page.route("**/api/admin/content/modules/*/module-versions/*/publish-preview-versioned", async (route: Route) => {
    // Formen readVersionedPreview godtar. Ingen har bestått: publiseringen går rett gjennom uten spørsmål om versjon.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ moduleVersion: { id: UTKAST, versionMajor: null }, courses: [], currentMajor: 1, anyonePassed: false }),
    });
  });
  await page.route("**/api/admin/content/modules/*/module-versions/*/publish-versioned", async (route: Route) => {
    if (route.request().method() === "POST") publiseringer.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#previewEditTitle").waitFor();
  return publiseringer;
}

// #1169 skive 2: en publisert modul med nyere utkast har «Publiser utkastet» som hovedhandling.
const publiserKnapp = (page: Page) => page.locator("#moduleFormHead [data-ws-key=\"publish\"]");

test.describe("#1189 — modulens Publiser med ulagrede endringer", () => {
  test("spør først; nei publiserer ingenting og lar det som er skrevet stå", async ({ page }) => {
    const dialoger: string[] = [];
    page.on("dialog", (d) => { dialoger.push(d.message()); void d.dismiss(); });
    const publiseringer = await aapneModulMedNyereUtkast(page);
    await page.locator("#previewEditTitle").fill("Test: Frihet under ansvar (rettet)");
    await publiserKnapp(page).click();

    await expect.poll(() => dialoger.length, { message: "ingen advarsel før de ulagrede endringene gikk tapt" }).toBe(1);
    expect(dialoger[0]).toMatch(sporsmal);
    await page.waitForTimeout(800);
    expect(publiseringer).toHaveLength(0);
    await expect(page.locator("#previewEditTitle")).toHaveValue("Test: Frihet under ansvar (rettet)");
    // Handlingene står fortsatt, så forfatteren kan lagre og publisere etterpå.
    await expect(publiserKnapp(page)).toBeVisible();
  });

  // QA 2026-11-23: Rediger → Forhåndsvisning legger endringene i et utkast. Spørsmålet så bare på skjemaet og innstillingene.
  test("endringer som er tatt med til Forhåndsvisning, spørres også om", async ({ page }) => {
    const dialoger: string[] = [];
    page.on("dialog", (d) => { dialoger.push(d.message()); void d.dismiss(); });
    const publiseringer = await aapneModulMedNyereUtkast(page);
    await page.locator("#previewEditTitle").fill("Test: Frihet under ansvar (rettet)");
    await page.locator("#formTab-preview").click();
    await publiserKnapp(page).click();
    await expect.poll(() => dialoger.length, { message: "ingen advarsel etter fanebytte til Forhåndsvisning" }).toBe(1);
    expect(dialoger[0]).toMatch(sporsmal);
    await page.waitForTimeout(800);
    expect(publiseringer).toHaveLength(0);
  });

  test("ja publiserer det som er lagret", async ({ page }) => {
    const dialoger: string[] = [];
    page.on("dialog", (d) => { dialoger.push(d.message()); void d.accept(); });
    const publiseringer = await aapneModulMedNyereUtkast(page);
    await page.locator("#previewEditTitle").fill("Test: Frihet under ansvar (rettet)");
    await publiserKnapp(page).click();
    await expect.poll(() => publiseringer.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(dialoger.some((m) => sporsmal.test(m))).toBe(true);
  });

  // Avpubliser og Erstatt fra fil (før «Importer», #1169) laster også modulen på nytt. Begge spør nå når Rediger har ulagrede endringer.
  for (const [navn, tekst] of [["Avpubliser", /^(Avpubliser|Unpublish)$/], ["Erstatt fra fil", /^(Erstatt fra fil|Replace from file)$/]] as const) {
    test(`${navn} spør også først når Rediger har ulagrede endringer, og nei rører ingenting`, async ({ page }) => {
      const dialoger: string[] = [];
      page.on("dialog", (d) => { dialoger.push(d.message()); void d.dismiss(); });
      const avpubliseringer: string[] = [];
      await page.route("**/api/admin/content/modules/*/unpublish", async (route: Route) => {
        avpubliseringer.push(route.request().url());
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });
      await aapneModulMedNyereUtkast(page);
      await page.locator("#previewEditTitle").fill("Test: Frihet under ansvar (rettet)");
      await clickEnabledButton(page, tekst);
      await expect.poll(() => dialoger.length, { message: `ingen advarsel før ${navn}` }).toBeGreaterThan(0);
      expect(dialoger[0]).toMatch(sporsmal);
      await page.waitForTimeout(500);
      expect(avpubliseringer).toHaveLength(0);
      await expect(page.locator("#previewEditTitle")).toHaveValue("Test: Frihet under ansvar (rettet)");
    });
  }

  test("kontroll: uten ulagrede endringer spørres det ikke, og publiseringen går", async ({ page }) => {
    const dialoger: string[] = [];
    page.on("dialog", (d) => { dialoger.push(d.message()); void d.dismiss(); });
    const publiseringer = await aapneModulMedNyereUtkast(page);
    await publiserKnapp(page).click();
    await expect.poll(() => publiseringer.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(dialoger.filter((m) => sporsmal.test(m))).toEqual([]);
  });
});
