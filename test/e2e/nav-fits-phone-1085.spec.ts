import { expect, test, type Page } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1085: på telefonbredde var menylinja over listene bredere enn skjermen, så hele sida kunne rulles
// sidelengs. På innholdssidene stakk «Vurderingskvalitet» 13 px ut; på Klasser stakk «Resultater»
// 28 px ut.
//
// ⚠️ Hvorfor ingen test så det: de andre testene kjører som fagansvarlig, og den rollen har færre
// lenker i menyen. Feilen ble funnet av utgivelsestesten mot stage, der brukeren er administrator.
// Rollen er derfor satt her — uten den måler testen en meny som alltid har fått plass.

async function åpne(page: Page, rute: string, bredde: number) {
  await page.setViewportSize({ width: bredde, height: 844 });
  await mockCommonApis(page, {
    meRoles: ["ADMINISTRATOR"],
    libraryModules: [{ id: "m1", title: "Risikovurdering", titleLocales: ["nb", "nn", "en-GB"], status: "published", courseCount: 0, updatedAt: "2026-09-30T10:00:00Z" }] as never,
    courses: [{ id: "k1", title: "Arbeidsmiljø", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-09-30T10:00:00.000Z", publishedAt: null, archivedAt: null, modules: [] }] as never,
  });
  // «Vurderingskvalitet» vises bare for roller oppsettet gir tilgang. Den felles mocken sender ingen
  // slike roller, så lenka som stakk ut, ville ikke vært med i målingen. Registrert etter den felles
  // mocken, og vinner derfor.
  await page.route("**/participant/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [], profileItem: null },
        identityDefaults: { userId: "admin-1", email: "admin@example.test", name: "Admin", department: "Drift", roles: ["ADMINISTRATOR"] },
        calibrationWorkspace: { accessRoles: ["ADMINISTRATOR"] },
      }),
    }));
  await page.route("**/api/admin/content/sections", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [{ id: "s1", title: "Seksjon", titleLocales: [], versionNo: 1, activeVersionId: "v1", archivedAt: null, updatedAt: "2026-09-30T10:00:00.000Z", courseCount: 0, courses: [] }] }) }));
  await page.route("**/api/admin/content/classes", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [{ id: "c1", name: "Nyansatte", isSystem: false, _count: { members: 12, courseAssignments: 3 } }] }) }));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto(rute);
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible();
}

/** Det nettleseren har tegnet: kan sida rulles sidelengs, og hvilke menylenker stikker ut av skjermen? */
function mål(page: Page) {
  return page.evaluate(() => {
    const skjerm = document.documentElement.clientWidth;
    const lenker = [...document.querySelectorAll<HTMLElement>(".content-area-nav .content-area-nav-link")].filter((a) => a.getBoundingClientRect().width > 0);
    return {
      sidelengs: document.documentElement.scrollWidth - window.innerWidth,
      lenker: lenker.map((a) => (a.textContent ?? "").trim()),
      utenfor: lenker.filter((a) => a.getBoundingClientRect().right > skjerm + 0.5 || a.getBoundingClientRect().left < -0.5).map((a) => (a.textContent ?? "").trim()),
    };
  });
}

const SIDER = [
  { navn: "Moduler", rute: "/admin-content", skalHa: "Vurderingskvalitet" },
  { navn: "Kurs", rute: "/admin-content/courses", skalHa: "Vurderingskvalitet" },
  { navn: "Seksjoner", rute: "/admin-content/sections", skalHa: "Vurderingskvalitet" },
  { navn: "Klasser", rute: "/deltakere/klasser", skalHa: "Resultater" },
];

test.describe("#1085 — menylinja får plass på telefon", () => {
  for (const side of SIDER) {
    // 390 er bredden feilen ble målt på. 320 er den smaleste telefonen som fortsatt er i bruk.
    for (const bredde of [390, 320]) {
      test(`${side.navn}, ${bredde} px: sida kan ikke rulles sidelengs, og hver menylenke er innenfor skjermen`, async ({ page }) => {
        await åpne(page, side.rute, bredde);
        const m = await mål(page);
        // Kontroll: lenka som stakk ut, er med. Uten den måles en meny som alltid fikk plass.
        expect(m.lenker, `kontroll: menyen skal ha lenka «${side.skalHa}»`).toContain(side.skalHa);
        expect(m.utenfor, "menylenker som stikker ut av skjermen").toEqual([]);
        expect(m.sidelengs, "piksler sida kan rulles sidelengs").toBeLessThanOrEqual(0);
      });
    }
  }

  // At lenkene KAN brekke, er sikkerhetsnettet. På en vanlig telefon skal de ikke trenge det: de står
  // tettere der, så menyen er én linje — to linjer meny tar plass fra lista under.
  for (const side of SIDER) {
    test(`${side.navn}, 390 px: lenkene får plass på én linje`, async ({ page }) => {
      await åpne(page, side.rute, 390);
      const topper = await page.locator(".content-area-nav .content-area-nav-link:visible").evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);
      expect(topper, "linjer menyen står på").toHaveLength(1);
      expect((await mål(page)).lenker).toContain(side.skalHa);
    });
  }

  test("kontroll: på PC-bredde står menylenkene på én linje, som før", async ({ page }) => {
    await åpne(page, "/admin-content", 1280);
    const topper = await page.locator(".content-area-nav .content-area-nav-link:visible").evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);
    expect(topper).toHaveLength(1);
    expect((await mål(page)).lenker.length).toBeGreaterThanOrEqual(4);
  });

  test("den aktive lenka har fortsatt streken sin under seg når menyen brekker", async ({ page }) => {
    await åpne(page, "/admin-content", 320);
    const aktiv = page.locator(".content-area-nav .content-area-nav-link.active");
    await expect(aktiv).toHaveCount(1);
    await expect(aktiv).toBeInViewport({ ratio: 1 });
    expect(await aktiv.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("2px");
  });
});
