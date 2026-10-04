import { expect, test, type Page } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1081: «Mer»-menyen i nederste listerad lå skjult bak rammekanten rundt tabellen. Handlingene
// under den (Eksporter, Avpubliser) kunne bare nås ved å rulle INNI tabellen.
//
// ⚠️ Målt i nettleseren, mot ramma som klipper: menyen skal ligge innenfor ramma, og ramma skal
// ikke ha fått et rullefelt. `toBeVisible()` er ikke nok — et klippet element er «synlig» for DOM-en.

const modul = (id: string, title: string) =>
  ({ id, title, titleLocales: ["nb", "nn", "en-GB"], status: "published", courseCount: 0, updatedAt: "2026-09-30T10:00:00Z" });

type Moduler = NonNullable<NonNullable<Parameters<typeof mockCommonApis>[1]>["libraryModules"]>;

async function åpneLista(page: Page, bredde: number, moduler: Moduler) {
  await page.setViewportSize({ width: bredde, height: 844 });
  await mockCommonApis(page, { libraryModules: moduler });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content");
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible();
}

function mål(page: Page) {
  return page.locator(".list-table-wrap").evaluate((wrap) => {
    const meny = wrap.querySelector("details.row-more[open] .row-more-menu");
    return {
      menyUnderRamma: meny ? Math.max(0, Math.round(meny.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom)) : null,
      rullerInni: wrap.scrollHeight > wrap.clientHeight,
      høyde: Math.round(wrap.getBoundingClientRect().height),
    };
  });
}

for (const bredde of [1280, 390]) {
  for (const [navn, moduler] of [
    ["to rader", [modul("mod-a", "Risikovurdering"), modul("mod-b", "Sikkerhetskultur")]],
    ["én rad", [modul("mod-b", "Sikkerhetskultur")]],
  ] as const) {
    test(`${bredde} px, ${navn}: hele «Mer»-menyen i nederste rad ligger innenfor ramma`, async ({ page }) => {
      await åpneLista(page, bredde, [...moduler]);
      const før = await mål(page);
      const rad = page.locator('tr[data-row-id="mod-b"]');

      await rad.locator(".row-more > summary").click();
      const valg = rad.locator(".row-more-menu .row-action-btn");
      await expect(valg.first()).toBeVisible();
      await expect.poll(async () => (await mål(page)).menyUnderRamma).toBe(0);
      expect((await mål(page)).rullerInni, "ramma skal ikke få rullefelt").toBe(false);
      // Hvert valg, ikke bare det første: det var de nederste som forsvant. Målt mot RAMMA og ikke
      // mot skjermen — på telefon kan lista være lengre enn skjermen, og da ruller man sida.
      const utenfor = await valg.evaluateAll((knapper) => {
        const ramme = knapper[0].closest(".list-table-wrap")!.getBoundingClientRect();
        return knapper.filter((k) => k.getBoundingClientRect().bottom > ramme.bottom).map((k) => k.textContent);
      });
      expect(utenfor, "valg som ligger under rammekanten").toEqual([]);
      expect(await valg.count()).toBeGreaterThanOrEqual(2);

      // Lufta er lånt, ikke gitt: når menyen lukkes, er ramma like høy som før.
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await mål(page)).høyde).toBe(før.høyde);
    });
  }
}

test("kontroll: en meny som har plass, flytter ikke på noe", async ({ page }) => {
  const mange = Array.from({ length: 8 }, (_, i) => modul(`mod-${i}`, `Modul ${i}`));
  await åpneLista(page, 1280, mange);
  const før = await mål(page);
  await page.locator('tr[data-row-id="mod-0"] .row-more > summary').click();
  await expect(page.locator('tr[data-row-id="mod-0"] .row-more-menu')).toBeVisible();
  expect((await mål(page)).høyde).toBe(før.høyde);
});
