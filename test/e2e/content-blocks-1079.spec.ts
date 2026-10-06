import { test, expect, type Page, type Route } from "@playwright/test";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1079: innholdsblokkene slik deltakeren ser dem — uthevet boks, prompt-boks med «Kopier», kort
// med ikon, og en tabell med kolonnenavn på telefon. Teksten tegnes av plattformens egen
// gjengivelse (ikke en kopi i testen) og vises i leseren med sidens egne stiler.
//
// Prøvesiden produkteier godkjente 2026-10-05 er fasiten: kort med lys bunn og tynn ramme, ved
// siden av hverandre der det er plass og under hverandre på telefon; uthevet boks med merkelapp;
// prompt-boks med knapp som kopierer.

const F = "```";
const PROMPT = "Du skal skrive kapittel [nummer] i en rapport.\nLesere: [hvem som skal lese den]\nBruk bare kildene i prosjektet. Skriv «uklart» der kildene ikke sier noe, og en svært lang linje som må brekke pent på en smal skjerm uten å rulle sidelengs.\n\n[lim inn disposisjonen]";
const MARKDOWN = [
  "Fire arbeidsformer står til valg.",
  "",
  ":::kort",
  "### ![](asset:ikon-a) Chat (samtale)",
  "",
  "**Når bruke**",
  "",
  "Rask hjelp, idémyldring, utkast.",
  "",
  "- Raskt og fleksibelt",
  "- Lett å prøve ut ideer",
  "",
  "### ![](asset:ikon-b) Lerret (Canvas)",
  "",
  "Når du skal utvikle tekst stegvis over tid.",
  "",
  "> **Tips:** Bruk lerretet til selve rapportteksten.",
  "",
  "### Prosjekt",
  "",
  "Komplekse oppgaver med mange kilder.",
  "",
  "### Grundig tenkemodus",
  "",
  "Krevende analyser der kvalitet går foran fart.",
  ":::",
  "",
  "> **Husk:** Jo mer du legger i kontekstvinduet, desto viktigere er det å rydde.",
  "",
  "> **Viktig:** Du eier vurderingene og står ansvarlig for innholdet.",
  "",
  "## Slik ber du om et kapittelutkast",
  "",
  `${F}prompt`,
  PROMPT,
  F,
  "",
  "| Kapittel | Innhold | Eksempel på en god formulering i teksten |",
  "|---|---|---|",
  "| Sammendrag | Hovedfunn og **anbefalinger** til ledelsen | Førsteutkast fra ferdig rapport |",
  "| Metode | Hvordan dataene er samlet inn | Struktur og språk |",
].join("\n");

const IKON = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 96 96" fill="none" stroke="#33312b" stroke-width="6"><path d="M24 28h48M24 48h48M24 68h30"/></svg>';

async function åpneLeseren(page: Page, bredde: number) {
  await page.setViewportSize({ width: bredde, height: 900 });
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Rapportskriving med generativ KI", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "IN_PROGRESS" }, publishedAt: "2026-01-01T00:00:00.000Z" }] })));
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Rapportskriving med generativ KI", discussionsEnabled: true, items: [{ type: "SECTION", sectionId: "s1", title: "Arbeidsformer", read: false }] } })));
  // Plattformens egen gjengivelse av teksten, slik tjeneren ville svart.
  await page.route("**/api/courses/c1/sections/*", (route: Route) => route.fulfill(json({ title: "Arbeidsformer", html: renderSectionMarkdown(MARKDOWN, "nb") })));
  await page.route("**/api/content-assets/**", (route: Route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: IKON }));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").first().click();
  await expect(page.locator("#sectionReaderBody .content-cards")).toBeVisible();
}

/** Hva i leseren stikker ut av sin egen ramme eller av skjermen? */
function utenfor(page: Page) {
  return page.evaluate(() => {
    const leser = document.querySelector<HTMLElement>("#sectionReaderBody")!;
    const kant = leser.getBoundingClientRect().right + 0.5;
    const skjerm = document.documentElement.clientWidth + 0.5;
    return [...leser.querySelectorAll<HTMLElement>("*")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && (r.right > kant || r.right > skjerm || r.left < -0.5); })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${Math.round(el.getBoundingClientRect().right)} > ${Math.round(kant)}`);
  });
}

/** Sett BLOKK_BILDER til en mappe for å få skjermbilder å se på. */
const BILDER = process.env.BLOKK_BILDER ?? "";

test.describe("innholdsblokker i leseren (#1079)", () => {
  test("PC: fire kort ved siden av hverandre, bokser med farge, tabell med rammer — og «Kopier» kopierer prompten", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await åpneLeseren(page, 1280);
    if (BILDER) await page.screenshot({ path: `${BILDER}/blokker-1280.png`, fullPage: true });

    const kort = page.locator("#sectionReaderBody .content-card");
    await expect(kort).toHaveCount(4);
    const topper = await kort.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(topper).size, `kortene står på én rad: ${topper.join(", ")}`).toBe(1);
    // Ikonet står i overskriften i sin egen størrelse, ikke som et bilde over hele bredden.
    const ikon = page.locator("#sectionReaderBody .content-card-title img.content-icon").first();
    await expect(ikon).toBeVisible();
    expect((await ikon.boundingBox())!.width).toBeLessThanOrEqual(26);
    const tittel = await page.locator("#sectionReaderBody .content-card-title").first().evaluate((el) => getComputedStyle(el).display);
    expect(tittel).toBe("flex");

    // Boksene har en bakgrunn, og varselet skiller seg fra den nøytrale.
    const farger = await page.locator("#sectionReaderBody .content-callout").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    expect(farger).toHaveLength(3);
    for (const farge of farger) expect(farge).not.toBe("rgba(0, 0, 0, 0)");
    const varsel = await page.locator("#sectionReaderBody .content-callout--warning").evaluate((el) => getComputedStyle(el));
    expect(varsel.backgroundColor).not.toBe(farger[0]);
    expect(await page.locator("#sectionReaderBody .content-callout--warning").evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe("3px");

    // Tabellen har synlige rammer på PC.
    expect(await page.locator("#sectionReaderBody .content-table td").first().evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");

    // Prompten: teksten ordrett, og knappen legger den på utklippstavla.
    await expect(page.locator("#sectionReaderBody .content-prompt-text")).toHaveText(PROMPT);
    const knapp = page.locator("#sectionReaderBody .content-prompt-copy");
    await expect(knapp).toHaveText("Kopier");
    await knapp.click();
    await expect(knapp).toHaveText("Kopiert");
    // Windows gir linjeskiftene tilbake som CRLF fra utklippstavla; teksten er den samme.
    const lest = await page.evaluate(() => navigator.clipboard.readText());
    expect(lest.split(String.fromCharCode(13)).join("")).toBe(PROMPT);
    await expect(knapp).toHaveText("Kopier", { timeout: 4000 });

    expect(await utenfor(page)).toEqual([]);
  });

  for (const bredde of [390, 360]) {
    test(`${bredde} px: kortene står under hverandre, tabellcellene har kolonnenavn, og ingenting går ut av leseren`, async ({ page }) => {
      await åpneLeseren(page, bredde);
      if (BILDER) await page.screenshot({ path: `${BILDER}/blokker-${bredde}.png`, fullPage: true });

      const kanter = await page.locator("#sectionReaderBody .content-card").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
      expect(kanter).toHaveLength(4);
      for (let i = 1; i < kanter.length; i += 1) expect(kanter[i]!.top, `kort ${i + 1} står under kort ${i}`).toBeGreaterThanOrEqual(kanter[i - 1]!.bottom);

      // Tabellen er stablet, og hver celle sier hvilken kolonne den er — det leseren ellers ikke ser.
      const merker = await page.locator("#sectionReaderBody .content-table td").evaluateAll((els) => els.map((el) => getComputedStyle(el, "::before").content));
      expect(merker).toEqual(['"Kapittel"', '"Innhold"', '"Eksempel på en god formulering i teksten"', '"Kapittel"', '"Innhold"', '"Eksempel på en god formulering i teksten"']);
      // QA-porten: et langt kolonnenavn skjøv verdien ut av skjermen. Verdien skal være synlig innenfor leseren.
      const verdi = page.locator("#sectionReaderBody .content-table td", { hasText: "Førsteutkast" }).locator("span");
      const leser = (await page.locator("#sectionReaderBody").boundingBox())!;
      const v = (await verdi.boundingBox())!;
      expect(v.width, "verdien har plass").toBeGreaterThan(100);
      expect(v.x + v.width, "verdien står innenfor leseren").toBeLessThanOrEqual(leser.x + leser.width + 0.5);
      expect(await page.locator("#sectionReaderBody .content-table thead").evaluate((el) => getComputedStyle(el).display)).toBe("none");
      // QA-porten: cellen er flex på telefon, og uten ett element rundt innholdet ble hvert ord og
      // hver fete bit sitt eget flex-element — «ut k a st». Innholdet står på sammenhengende linjer.
      const celle = page.locator("#sectionReaderBody .content-table td", { hasText: "anbefalinger" });
      const biter = await celle.evaluate((td) => {
        const r = document.createRange();
        const linjer = new Set<number>();
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          r.selectNodeContents(node);
          for (const rect of r.getClientRects()) if (rect.width > 0) linjer.add(Math.round(rect.top));
        }
        // childNodes, ikke children: tekstbitene mellom de fete ordene er også flex-elementer.
        return { linjer: linjer.size, barn: td.childNodes.length, tekst: td.textContent?.trim() };
      });
      expect(biter.barn, "ett flex-element i cellen: alt innholdet samlet").toBe(1);
      // Linjetallet avhenger av skrifttypen og er bare til opplysning i feilmeldingen; childNodes-sjekken over er den som fanger feilen.
      expect(biter.linjer, `innholdet «${biter.tekst}» står på ${biter.linjer} linjer`).toBeGreaterThan(0);

      // Prompten brekker; den ruller ikke sidelengs.
      const prompt = page.locator("#sectionReaderBody .content-prompt-text");
      expect(await prompt.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

      expect(await utenfor(page), "det som går ut av leseren eller skjermen").toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }
});
