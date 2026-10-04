import { expect, test, type Page } from "@playwright/test";
import { applySvgTextTranslations, sanitizeSvg } from "../../src/modules/course/svgSanitizer.js";

// #1083: en figur med hardt mellomrom i en etikett ble lagret som noe nettleseren ikke kunne lese,
// og deltakeren så ingen figur. Enhetstesten spør en XML-parser om resultatet er lesbart. Denne
// spør NETTLESEREN, på den måten figuren faktisk vises: som <img> med image/svg+xml.

const figur = (innhold: string, rotAttributter = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60"${rotAttributter}>${innhold}</svg>`;

/** Bredden nettleseren gir bildet: over 0 når fila lot seg lese, 0 når den ikke gjorde det. */
async function bildebredde(page: Page, svg: string): Promise<number> {
  await page.setContent(`<img id="f" alt="">`);
  return page.evaluate((kilde) => new Promise<number>((ferdig) => {
    const bilde = document.getElementById("f") as HTMLImageElement;
    bilde.onload = () => ferdig(bilde.naturalWidth);
    bilde.onerror = () => ferdig(0);
    bilde.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(kilde)}`;
  }), svg);
}

test.describe("#1083 — det rensingen lagrer, kan nettleseren vise", () => {
  test("kontroll: målingen skiller en lesbar figur fra det rensingen skrev ut før", async ({ page }) => {
    expect(await bildebredde(page, figur(`<text x="10" y="30">§ 12</text>`))).toBe(200);
    // Nøyaktig formen den gamle utskriften hadde: &nbsp; finnes ikke i XML.
    expect(await bildebredde(page, figur(`<text x="10" y="30">§&nbsp;12</text>`))).toBe(0);
    expect(await bildebredde(page, figur(`<rect width="5" height="5"/>`, ` aria-label="a < b"`))).toBe(0);
  });

  for (const [navn, inn] of [
    ["hardt mellomrom i en etikett", figur(`<text x="10" y="30">§ 12 og 10 %</text>`)],
    ["&nbsp; skrevet som entitet i kilden", figur(`<text x="10" y="30">kr&nbsp;500</text>`)],
    ["< i en attributtverdi", figur(`<rect width="5" height="5"/>`, ` aria-label="a &lt; b"`)],
    ["hardt mellomrom i en attributtverdi", figur(`<rect width="5" height="5"/>`, ` aria-label="§ 12"`)],
  ] as const) {
    test(`${navn}: figuren vises etter rensing`, async ({ page }) => {
      const ren = sanitizeSvg(inn);
      expect(ren).not.toBe("");
      expect(await bildebredde(page, ren)).toBe(200);
    });
  }

  test("en oversatt variant med hardt mellomrom vises også", async ({ page }) => {
    const norsk = sanitizeSvg(figur(`<text x="10" y="30">Paragraf 12</text>`));
    const engelsk = applySvgTextTranslations(norsk, { "Paragraf 12": "Section 12" });
    expect(await bildebredde(page, engelsk)).toBe(200);
  });
});
