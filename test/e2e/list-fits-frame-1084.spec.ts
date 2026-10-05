import { expect, test, type Page } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1084: på modullista var tabellen bredere enn ramma den står i, og «Mer» ytterst til høyre lå
// utenfor til man rullet tabellen sidelengs. Bak «Mer» ligger Eksporter, Avpubliser og Arkiver.
//
// ⚠️ Hvorfor ingen test så det: fiksturene i de andre listetestene har to korte rader. Feilen
// kommer av hvor MYE som står i en rad — et statusmerke med «Nyere utkast» ved siden av, et
// språkmerke, et langt nivånavn — og den ble først synlig da utgivelsestesten kjørte mot stage
// med 64 ekte moduler. Radene under er derfor laget etter de ekte: samme kolonner, samme merker,
// samme lengder.

type Moduler = NonNullable<NonNullable<Parameters<typeof mockCommonApis>[1]>["libraryModules"]>;

const rad = (id: string, title: string, ekstra: Record<string, unknown> = {}) => ({
  id, title, titleLocales: ["nb", "nn", "en-GB"], status: "published", certificationLevel: "basic", courseCount: 1, updatedAt: "2026-09-18T10:00:00Z", ...ekstra,
});

// Det bredeste som fantes i hver kolonne på stage 2026-10-04, samlet i samme liste.
const SOM_PÅ_STAGE = [
  rad("m1", "Agentflyt", { status: "published_with_draft" }),
  rad("m2", "Arbeid i ChatGPT – kunnskapstest", { status: "published_with_draft", certificationLevel: "intermediate" }),
  rad("m3", "Behandlingsgrunnlag i praksis", { status: "draft", titleLocales: ["nb"] }),
  rad("m4", "Offentlige anskaffelser: konkurransegrunnlag og tilbudsevaluering", { certificationLevel: "advanced", courseCount: 12 }),
  rad("m5", "Di2x: Analyse, innsikt og prioritering", { status: "published_with_draft", titleLocales: ["nb"], certificationLevel: "intermediate" }),
] as unknown as Moduler;

async function åpne(page: Page, bredde: number, moduler: Moduler = SOM_PÅ_STAGE) {
  await page.setViewportSize({ width: bredde, height: 900 });
  await mockCommonApis(page, { libraryModules: moduler });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content");
  await expect(page.locator(".list-table tbody tr").first()).toBeVisible();
}

/** Det nettleseren faktisk har tegnet: er tabellen bredere enn ramma, og hvilke knapper ligger utenfor? */
function mål(page: Page) {
  return page.locator(".list-table-wrap").evaluate((wrap) => {
    const ramme = wrap.getBoundingClientRect();
    const utenfor = [...wrap.querySelectorAll("tbody td.col-actions .row-action-btn, tbody td.col-actions .row-more > summary")]
      .filter((knapp) => knapp.getBoundingClientRect().width > 0 && knapp.getBoundingClientRect().right > ramme.right + 0.5)
      .map((knapp) => (knapp.textContent ?? "").trim());
    return {
      forBred: wrap.scrollWidth - wrap.clientWidth,
      utenfor: [...new Set(utenfor)],
      kolonner: [...wrap.querySelectorAll("thead th")].map((th) => `${(th.textContent ?? "").trim().split(/\s/)[0]}:${Math.round(th.getBoundingClientRect().width)}`).join(" "),
    };
  });
}

test.describe("#1084 — lista får plass i ramma si, og «Mer» er synlig uten å rulle", () => {
  test("kontroll: radene i testen har det som gjorde lista for bred — to merker i status, språkmerke, langt nivånavn", async ({ page }) => {
    await åpne(page, 1280);
    await expect(page.locator('tr[data-row-id="m1"] td.col-status')).toContainText("Nyere utkast");
    await expect(page.locator('tr[data-row-id="m3"] td.col-lang')).toContainText("mangler");
    await expect(page.locator('tr[data-row-id="m2"] td.col-level')).toContainText("Videregående");
    await expect(page.locator('tr[data-row-id="m1"] td.col-actions .row-more > summary')).toHaveCount(1);
  });

  // 1280 er bredden feilen ble målt på; ramma er like bred derfra og oppover.
  for (const bredde of [1280, 1920]) {
    test(`${bredde} px: tabellen er ikke bredere enn ramma, og ingen knapp ligger utenfor`, async ({ page }) => {
      await åpne(page, bredde);
      const m = await mål(page);
      expect(m.forBred, `piksler tabellen er bredere enn ramma (kolonner: ${m.kolonner})`).toBeLessThanOrEqual(0);
      expect(m.utenfor, "knapper som ligger utenfor ramma").toEqual([]);
      await expect(page.locator('tr[data-row-id="m1"] .row-more > summary')).toBeInViewport({ ratio: 1 });
    });
  }

  // I et smalere vindu får ikke sju kolonner plass. Da skal resten av raden rulle inn under
  // handlingene, som står igjen innenfor ramma. Dette er garantien som ikke avhenger av innholdet.
  for (const bredde of [1024, 800]) {
    test(`${bredde} px: tabellen er for bred, men handlingene står innenfor ramma — også etter rulling`, async ({ page }) => {
      await åpne(page, bredde);
      const før = await mål(page);
      expect(før.forBred, "kontroll: her ER tabellen bredere enn ramma").toBeGreaterThan(0);
      expect(før.utenfor, "knapper som ligger utenfor ramma").toEqual([]);
      const mer = page.locator('tr[data-row-id="m1"] .row-more > summary');
      await expect(mer).toBeInViewport({ ratio: 1 });

      // Rullet helt til høyre og tilbake: handlingene flytter seg ikke.
      const plass = () => mer.evaluate((el) => Math.round(el.getBoundingClientRect().right));
      const høyre = await plass();
      await page.locator(".list-table-wrap").evaluate((wrap) => { wrap.scrollLeft = wrap.scrollWidth; });
      expect(await plass()).toBe(høyre);
      expect((await mål(page)).utenfor).toEqual([]);

      // …og «Mer» kan åpnes: menyen ligger oppå radene under, ikke bak dem.
      await page.locator(".list-table-wrap").evaluate((wrap) => { wrap.scrollLeft = 0; });
      await mer.click();
      const valg = page.locator('tr[data-row-id="m1"] .row-more-menu .row-action-btn');
      await expect(valg.first()).toBeVisible();
      const dekket = await valg.evaluateAll((knapper) => knapper.filter((k) => {
        const r = k.getBoundingClientRect();
        const øverst = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(øverst === k || k.contains(øverst));
      }).map((k) => (k.textContent ?? "").trim()));
      expect(dekket, "valg i menyen som er dekket av noe annet").toEqual([]);
    });
  }

  test("handlingene står fortsatt på én linje (D5): raden brekker statusmerkene, ikke knappene", async ({ page }) => {
    await åpne(page, 1024);
    const knapper = page.locator('tr[data-row-id="m1"] td.col-actions').locator(".row-action-btn:visible, .row-more > summary");
    const topper = await knapper.evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);
    expect(topper, "alle knappene i raden står på samme linje").toHaveLength(1);
    expect(await knapper.count()).toBeGreaterThanOrEqual(4);
    // …og statusmerkene gir plassen: «Publisert» og «Nyere utkast» står under hverandre, så
    // statuskolonnen er ett merke bred og ikke to. Hvert merke er fortsatt hele på én linje.
    const merker = page.locator('tr[data-row-id="m1"] td.col-status > *');
    expect(await merker.count()).toBe(2);
    // Under hverandre betyr at det andre begynner der det første slutter. (Toppene alene sier ikke
    // det: merkene er ulike høye, så toppene er forskjellige også når de står side om side.)
    const [første, andre] = await merker.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { topp: r.top, bunn: r.bottom }; }));
    expect(andre!.topp, "det andre statusmerket står under det første").toBeGreaterThanOrEqual(første!.bunn - 1);
    // Plassen går til navnet: statuskolonnen er ett merke bred.
    const statusbredde = (await page.locator('tr[data-row-id="m1"] td.col-status').boundingBox())!.width;
    expect(statusbredde, "statuskolonnen er ett merke bred, ikke to").toBeLessThan(130);
  });

  test("navnet beholder plassen sin: det lengste navnet brekkes på hele ord, ikke bokstav for bokstav", async ({ page }) => {
    await åpne(page, 1280);
    const navn = page.locator('tr[data-row-id="m4"] td.col-name');
    const boks = (await navn.boundingBox())!;
    expect(boks.width, "navnekolonnen er minst 180 px").toBeGreaterThanOrEqual(180);
    // 65 tegn på 180+ px skal gi noen få linjer, ikke en smal søyle.
    expect(boks.height, "navnet står på høyst fire linjer").toBeLessThan(110);
  });

  test("en liste med én kort rad: lista fyller ramma, og begge statusmerkene er hele", async ({ page }) => {
    await åpne(page, 1920, [rad("k1", "Kort", { status: "published_with_draft" })] as unknown as Moduler);
    const merker = page.locator('tr[data-row-id="k1"] td.col-status > *');
    // Navnekolonnen beholder sin andel, så statusmerkene står under hverandre. Begge er synlige,
    // og hele merket står på én linje — det er MERKENE som brekker fra hverandre, ikke teksten i dem.
    expect(await merker.count()).toBe(2);
    const høyder = await merker.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(Math.max(...høyder), "hvert merke er én linje høyt").toBeLessThan(30);
    expect((await mål(page)).forBred).toBeLessThanOrEqual(0);
  });
});

test("#1084: en overskrift som brekker over to linjer, har sorteringspila ved siste ord — ikke alene på en egen linje", async ({ page }) => {
  await åpne(page, 1280);
  const overskrift = page.locator(".list-table thead th.col-courses");
  const mål = await overskrift.evaluate((th) => {
    const tekst = [...th.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0)!;
    const område = document.createRange();
    område.selectNodeContents(tekst);
    const linjer = [...område.getClientRects()].filter((r) => r.width > 1);
    const pil = th.querySelector(".sort-indicator")!.getBoundingClientRect();
    const siste = linjer.at(-1)!;
    return { antallLinjer: new Set(linjer.map((r) => Math.round(r.top))).size, pilPåSisteLinje: Math.abs((pil.top + pil.height / 2) - (siste.top + siste.height / 2)) < 6 };
  });
  expect(mål.antallLinjer, "kontroll: overskriften «Brukt i kurs» brekker faktisk her").toBeGreaterThanOrEqual(2);
  expect(mål.pilPåSisteLinje).toBe(true);
});
