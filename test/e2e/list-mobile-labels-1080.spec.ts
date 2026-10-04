import { expect, test, type Page } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1080: telefonvisningen av den felles listesida. Under 600 px blir hver rad et kort, og hver verdi
// skal stå ved siden av kolonnenavnet sitt, innenfor kortet.
//
// ⚠️ Påstandene MÅLES i nettleseren. At `data-label` finnes i HTML-en sier ikke at etiketten vises,
// og ikke at verdien får plass: feilen var at skrivebordsreglene vant over kortregelen.

const MODULER = [
  { id: "mod-ett", title: "Risikovurdering", titleLocales: [], status: "published", courseCount: 0, updatedAt: "2026-09-30T10:00:00Z" },
  { id: "mod-alle", title: "Sikkerhetskultur", titleLocales: ["nb", "nn", "en-GB"], status: "published", courseCount: 2, updatedAt: "2026-09-29T10:00:00Z" },
];

async function åpneLista(page: Page, bredde: number) {
  await page.setViewportSize({ width: bredde, height: 844 });
  await mockCommonApis(page, { libraryModules: MODULER });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content");
  await expect(page.getByText("Risikovurdering").first()).toBeVisible();
}

/** Det nettleseren faktisk tegner for hver celle i raden. */
function målCeller(page: Page, id: string) {
  return målRad(page, `tr[data-row-id="${id}"]`);
}

function målRad(page: Page, rad: string) {
  return page.locator(`${rad} td`).evaluateAll((tds) =>
    tds.map((td) => {
      const kort = td.closest(".list-table-wrap")!.getBoundingClientRect();
      const boks = td.getBoundingClientRect();
      return {
        klasse: td.className,
        etikettVist: getComputedStyle(td, "::before").content,
        bredde: Math.round(boks.width),
        utenforKortet: Math.max(0, Math.round(boks.right - kort.right)),
        klippet: td.scrollWidth > td.clientWidth,
      };
    }),
  );
}

test.describe("#1080 — listene på telefon", () => {
  test("hver verdi står ved siden av kolonnenavnet sitt", async ({ page }) => {
    await åpneLista(page, 390);
    const celler = await målCeller(page, "mod-ett");
    const etiketter = Object.fromEntries(celler.map((c) => [c.klasse, c.etikettVist]));

    expect(etiketter["col-name"]).toBe('"Navn"');
    expect(etiketter["col-status"]).toBe('"Status"');
    expect(etiketter["col-updated"]).toBe('"Sist endret"');
    // ⚠️ Ingen datakolonne uten navn — også de denne testen ikke kjenner teksten til.
    for (const c of celler.filter((c) => c.klasse !== "col-actions")) {
      expect(c.etikettVist, `${c.klasse} skal ha et synlig kolonnenavn`).toMatch(/^"[^"]+"$/);
    }
    // Handlingene har ikke noe kolonnenavn, og skal ikke holde av plass til et.
    expect(etiketter["col-actions"]).toBe("none");
  });

  test("ingen celle går ut av kortet, og ingen verdi er klippet", async ({ page }) => {
    await åpneLista(page, 390);
    for (const id of ["mod-ett", "mod-alle"]) {
      for (const c of await målCeller(page, id)) {
        expect(c.utenforKortet, `${id} ${c.klasse}: piksler utenfor kortet`).toBe(0);
        expect(c.klippet, `${id} ${c.klasse}: innholdet er bredere enn cellen`).toBe(false);
      }
    }
    // Navnet får hele bredden og brekkes ikke midt i ordet.
    const navn = page.locator('tr[data-row-id="mod-alle"] td.col-name');
    const høyde = (await navn.boundingBox())!.height;
    expect(høyde, "«Sikkerhetskultur» skal stå på én linje").toBeLessThan(40);
  });

  test("«Mer» er synlig og kan åpnes", async ({ page }) => {
    await åpneLista(page, 390);
    const mer = page.locator('tr[data-row-id="mod-ett"] .row-more > summary');
    await expect(mer).toBeInViewport({ ratio: 1 });
    await mer.click();
    // Menyen skal også få plass: en meny som åpner seg utenfor skjermen er like utilgjengelig.
    const eksporter = page.locator('tr[data-row-id="mod-ett"] .row-more-menu').getByText("Eksporter");
    await expect(eksporter).toBeInViewport({ ratio: 1 });
  });

  test("«Døp om» (#894) får plass i kortet: feltet ligger i navnecellen, og Escape avbryter", async ({ page }) => {
    await åpneLista(page, 390);
    const rad = page.locator('tr[data-row-id="mod-ett"]');
    await rad.getByRole("button", { name: "Døp om" }).click();

    const felt = rad.locator(".row-rename input");
    await expect(felt).toBeFocused();
    const mål = await felt.evaluate((el) => {
      const f = el.getBoundingClientRect();
      const celle = el.closest("td")!.getBoundingClientRect();
      return { venstre: f.left >= celle.left, høyre: f.right <= celle.right, bredde: Math.round(f.width) };
    });
    expect(mål.venstre && mål.høyre, "feltet skal ligge innenfor navnecellen").toBe(true);
    // Bredt nok til å skrive i: en tittel på 15 tegn skal være lesbar uten å rulle i feltet.
    expect(mål.bredde).toBeGreaterThan(150);

    await page.keyboard.press("Escape");
    await expect(felt).toHaveCount(0);
    await expect(rad.locator("td.col-name")).toContainText("Risikovurdering");
  });

  // Kurs- og seksjonslista kaller navnekolonnen `col-title`, modul- og klasselista `col-name`.
  // Det er to velgere i stilarket, så begge måles: en regel som bare dekket den ene ville latt
  // to av fire lister stå igjen.
  test("kurslista (col-title) får samme kort: navn på alle verdier, ingenting utenfor", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCommonApis(page, {
      courses: [{
        id: "kurs-1", title: "Arbeidsmiljø og sikkerhetskultur", description: null, certificationLevel: "basic",
        moduleCount: 1, updatedAt: "2026-09-30T10:00:00.000Z", publishedAt: null, archivedAt: null, modules: [],
      }],
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/courses");
    const rad = "#coursesTableBody tr";
    await expect(page.locator(rad).first()).toBeVisible();

    const celler = await målRad(page, rad);
    const tittel = celler.find((c) => c.klasse === "col-title");
    expect(tittel, "kurslista skal ha en col-title-celle").toBeTruthy();
    // ⚠️ Skrivebordsregelen gir navnet 28 % (minst 180 px). I kortet skal det ha hele bredden.
    expect(tittel!.bredde, "navnecella skal fylle kortet").toBeGreaterThan(300);
    for (const c of celler) {
      if (c.klasse !== "col-actions") expect(c.etikettVist, `${c.klasse} skal ha et synlig kolonnenavn`).toMatch(/^"[^"]+"$/);
      expect(c.utenforKortet, `${c.klasse}: piksler utenfor kortet`).toBe(0);
      expect(c.klippet, `${c.klasse}: innholdet er bredere enn cellen`).toBe(false);
    }
  });

  // De to siste listene. Fire sider deler `list-page.js`, men hver side velger sine egne kolonner
  // og klasser — og det var nettopp «rettet på én liste, glemt på de andre» #1080 handlet om.
  async function forventKort(page: Page, rad: string, navneklasse: string) {
    await expect(page.locator(rad).first()).toBeVisible();
    const celler = await målRad(page, `${rad}:first-child`);
    const navn = celler.find((c) => c.klasse === navneklasse);
    expect(navn, `lista skal ha en ${navneklasse}-celle`).toBeTruthy();
    expect(navn!.bredde, "navnecella skal fylle kortet").toBeGreaterThan(300);
    for (const c of celler) {
      if (c.klasse !== "col-actions") expect(c.etikettVist, `«${c.klasse}» skal ha et synlig kolonnenavn`).toMatch(/^"[^"]+"$/);
      expect(c.utenforKortet, `«${c.klasse}»: piksler utenfor kortet`).toBe(0);
      expect(c.klippet, `«${c.klasse}»: innholdet er bredere enn cellen`).toBe(false);
    }
  }

  test("seksjonslista (col-title) får samme kort", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCommonApis(page);
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    const sections = [{
      id: "seksjon-1", title: "Arbeidsmiljø og sikkerhetskultur", titleLocales: [], versionNo: 1, activeVersionId: "v1",
      archivedAt: null, updatedAt: "2026-09-30T10:00:00.000Z", courseCount: 1, courses: [{ id: "kurs-a", title: "Kurs A" }],
    }];
    await page.route("**/api/admin/content/sections", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections }) }));
    await page.goto("/admin-content/sections");
    await forventKort(page, ".list-table tbody tr", "col-title");
  });

  test("klasselista (col-name, og kolonner uten egen klasse) får samme kort", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCommonApis(page);
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    const classes = [{ id: "klasse-1", name: "Nyansatte høsten 2026", isSystem: false, _count: { members: 12, courseAssignments: 3 } }];
    await page.route("**/api/admin/content/classes", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes }) }));
    await page.goto("/deltakere/klasser");
    await forventKort(page, ".list-table tbody tr", "col-name");
  });

  test("kontroll: på skrivebord vises tabellhodet, og cellene får ingen etikett foran seg", async ({ page }) => {
    await åpneLista(page, 1280);
    await expect(page.locator(".list-table thead")).toBeVisible();
    for (const c of await målCeller(page, "mod-ett")) {
      expect(c.etikettVist, `${c.klasse}: ingen etikett på skrivebord`).toBe("none");
    }
  });
});
