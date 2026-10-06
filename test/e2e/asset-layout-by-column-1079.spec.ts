import { test, expect, type Page, type Route } from "@playwright/test";

// #1079: en figur kan ha et smalt oppsett ved siden av det brede. En SVG som vises som bilde, har
// fast form, så det er klienten som velger: `hydrateContentAssetImages` henter hver figur og vet
// hvor bred spalten er. Her kjører den EKTE participant.js i Chromium mot et mocket API, og
// nettleseren blir spurt hva som faktisk vises.
//
// Det som måles: hvilket oppsett som blir bedt om, hvilket bilde som står på sida, og at ingenting
// hentes oftere enn det trengs.

const svg = (bredde: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${bredde}" height="100" viewBox="0 0 ${bredde} 100"><rect width="${bredde}" height="100" fill="#eef"/></svg>`;

async function åpneSeksjonen(page: Page, figur: { layouts: string; svar: (layout: string | null) => { layout: string; bredde: number } }) {
  const forespørsler: Array<string | null> = [];
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
        calibrationWorkspace: { accessRoles: [] },
        flow: {},
        output: {},
      }),
    }),
  );
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Kurs", items: [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false }] } })),
  );
  // Slik tjeneren rendrer en figur i en seksjon: et bilde i et avsnitt, med språket i adressen.
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill(json({ title: "Seksjon", html: '<p>Innhold</p><p><img src="/api/content-assets/a1?locale=nb" alt="Saksgang"></p>' })),
  );
  await page.route("**/api/content-assets/a1**", (route: Route) => {
    // Nettleseren prøver også selv å laste bildet idet HTML-en settes inn. Den forespørselen har
    // ingen innlogging og får 401 i virkeligheten (#483) — det er derfor figurene hentes av skript.
    // Det som telles her, er skriptets egne hentinger.
    if (route.request().resourceType() !== "fetch") return route.fulfill({ status: 401, body: "" });
    const url = new URL(route.request().url());
    const bedtOm = url.searchParams.get("layout");
    forespørsler.push(bedtOm);
    // Språket fra den rendrede adressen skal være med videre, også når oppsettet legges til.
    if (url.searchParams.get("locale") !== "nb") return route.fulfill({ status: 400, body: "locale mangler" });
    const { layout, bredde } = figur.svar(bedtOm);
    return route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      headers: { "X-Asset-Layout": layout, "X-Asset-Layouts": figur.layouts },
      body: svg(bredde),
    });
  });

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Innhold");
  const bilde = page.locator("#sectionReaderBody img");
  await expect.poll(async () => (await bilde.getAttribute("src")) ?? "").toMatch(/^blob:/);
  return { bilde, forespørsler };
}

/** Bredden på bildet nettleseren faktisk har lastet: 848 for det brede oppsettet, 480 for det smale. */
const vistBredde = (bilde: ReturnType<Page["locator"]>) => bilde.evaluate((el) => new Promise<number>((ferdig) => {
  const img = el as HTMLImageElement;
  if (img.complete && img.naturalWidth > 0) ferdig(img.naturalWidth);
  else img.addEventListener("load", () => ferdig(img.naturalWidth), { once: true });
}));

/** Venter til sida er tegnet på nytt etter en endring av bredde, og en henting som startet da, har rukket å gå. */
async function tegnetOgRolig(page: Page) {
  await page.evaluate(() => new Promise<void>((ferdig) => requestAnimationFrame(() => requestAnimationFrame(() => ferdig()))));
  await page.waitForTimeout(300);
}

const beggeOppsett = { layouts: "wide,narrow", svar: (bedtOm: string | null) => (bedtOm === "narrow" ? { layout: "narrow", bredde: 480 } : { layout: "wide", bredde: 848 }) };
const bareBredt = { layouts: "wide", svar: () => ({ layout: "wide", bredde: 848 }) };

test.describe("#1079 — klienten velger oppsett etter spaltebredden", () => {
  test("bred spalte (1280 px): det brede oppsettet hentes, én gang, uten å be om noe oppsett", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { bilde, forespørsler } = await åpneSeksjonen(page, beggeOppsett);
    expect(await vistBredde(bilde)).toBe(848);
    expect(forespørsler).toEqual([null]);
    await expect(bilde).toHaveAttribute("data-asset-layout", "wide");
  });

  test("smal spalte (390 px): det smale oppsettet hentes, én gang", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { bilde, forespørsler } = await åpneSeksjonen(page, beggeOppsett);
    expect(await vistBredde(bilde)).toBe(480);
    expect(forespørsler).toEqual(["narrow"]);
    await expect(bilde).toHaveAttribute("data-asset-layout", "narrow");
    // Spalten er smalere enn grensa — ellers ville testen målt noe annet enn den sier.
    expect(await bilde.evaluate((el) => (el.parentElement as HTMLElement).clientWidth)).toBeLessThan(640);
  });

  test("spalten endrer bredde: figuren bytter oppsett, og bytter tilbake", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { bilde, forespørsler } = await åpneSeksjonen(page, beggeOppsett);
    expect(await vistBredde(bilde)).toBe(848);

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(bilde).toHaveAttribute("data-asset-layout", "narrow");
    expect(await vistBredde(bilde)).toBe(480);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(bilde).toHaveAttribute("data-asset-layout", "wide");
    expect(await vistBredde(bilde)).toBe(848);
    expect(forespørsler).toEqual([null, "narrow", null]);
  });

  test("en endring som ikke krysser grensa, henter ingenting", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { bilde, forespørsler } = await åpneSeksjonen(page, beggeOppsett);
    await page.setViewportSize({ width: 500, height: 800 });
    await page.setViewportSize({ width: 420, height: 800 });
    await page.waitForTimeout(300);
    expect(forespørsler).toEqual(["narrow"]);
    expect(await vistBredde(bilde)).toBe(480);
  });

  test("en figur med bare ett oppsett: det spørres én gang, og aldri igjen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { bilde, forespørsler } = await åpneSeksjonen(page, bareBredt);
    expect(await vistBredde(bilde)).toBe(848);
    await expect(bilde).toHaveAttribute("data-asset-layout", "wide");

    // Hver bredde får stå til sida er tegnet og en eventuell henting har rukket å gå. To endringer
    // rett etter hverandre slås sammen til én av nettleseren, og da måles bare sluttbredden — slik
    // sto testen først, og den var grønn også da figurer med ett oppsett ble fulgt (mutasjon K4).
    await page.setViewportSize({ width: 1280, height: 900 });
    await tegnetOgRolig(page);
    expect(forespørsler, "bredere spalte: figuren har ikke noe annet oppsett å bytte til").toEqual(["narrow"]);
    await page.setViewportSize({ width: 390, height: 800 });
    await tegnetOgRolig(page);
    expect(forespørsler).toEqual(["narrow"]);
    expect(await vistBredde(bilde)).toBe(848);
  });

  // Språk går foran oppsett: figuren har det smale oppsettet, men ikke på leserens språk, så
  // tjeneren svarer med det brede. Klienten skal ikke spørre på nytt så lenge spalten er like smal.
  test("tjeneren svarer med det brede selv om det smale ble bedt om: klienten spør ikke på nytt", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { bilde, forespørsler } = await åpneSeksjonen(page, { layouts: "wide,narrow", svar: () => ({ layout: "wide", bredde: 848 }) });
    expect(await vistBredde(bilde)).toBe(848);
    await page.setViewportSize({ width: 500, height: 800 });
    await page.waitForTimeout(300);
    expect(forespørsler).toEqual(["narrow"]);
  });

  test("det gamle bildet slippes når oppsettet byttes — nettleseren holder ikke på begge", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { bilde } = await åpneSeksjonen(page, beggeOppsett);
    const første = (await bilde.getAttribute("src"))!;
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(bilde).toHaveAttribute("data-asset-layout", "narrow");
    expect(await bilde.getAttribute("src")).not.toBe(første);
    // En tilbakekalt objekt-URL lar seg ikke lenger hente.
    const fortsattTilgjengelig = await page.evaluate((url) => fetch(url).then(() => true, () => false), første);
    expect(fortsattTilgjengelig).toBe(false);
  });
});

// Det andre stedet figurer hentes: forhåndsvisningen i seksjonseditoren. Den bruker samme funksjon,
// men har en egenhet deltakervisningen ikke har — hele innholdet byttes ut hver gang forfatteren
// stopper å skrive. En figur som fulgte spalten sin, er da borte fra sida, og må glemmes.
test.describe("#1079 — forhåndsvisningen i seksjonseditoren", () => {
  async function åpneForhåndsvisning(page: Page) {
    const forespørsler: Array<string | null> = [];
    const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/participant/config", (route: Route) =>
      route.fulfill(json({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
        calibrationWorkspace: { accessRoles: [] },
      })),
    );
    await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
    await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill(json({ sections: [] })));
    await page.route("**/api/admin/content/sections/preview", (route: Route) =>
      route.fulfill(json({ html: '<p>Tekst</p><p><img src="/api/content-assets/a1?locale=nb" alt="Saksgang"></p>' })),
    );
    await page.route("**/api/content-assets/a1**", (route: Route) => {
      if (route.request().resourceType() !== "fetch") return route.fulfill({ status: 401, body: "" });
      const bedtOm = new URL(route.request().url()).searchParams.get("layout");
      forespørsler.push(bedtOm);
      const smal = bedtOm === "narrow";
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        headers: { "X-Asset-Layout": smal ? "narrow" : "wide", "X-Asset-Layouts": "wide,narrow" },
        body: svg(smal ? 480 : 848),
      });
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });

    await page.goto("/admin-content/sections");
    await page.getByRole("button", { name: /Ny seksjon/ }).click();
    await page.locator("#markdownInput").fill("# Hei\n\n![Saksgang](asset:a1)");
    await page.locator('[data-form-tab-btn="forhandsvisning"]').click();
    const bilde = page.locator("#previewPane img");
    await expect.poll(async () => (await bilde.getAttribute("src")) ?? "").toMatch(/^blob:/);
    return { bilde, forespørsler };
  }

  test("forhåndsvisningen viser oppsettet som passer bredden den selv har", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { bilde, forespørsler } = await åpneForhåndsvisning(page);
    // Forhåndsvisningen kan tegnes mer enn én gang når fanen åpnes, og da byttes bildet ut. Spaltens
    // bredde og oppsettet som vises, leses derfor i ETT oppslag, på bildet som står på sida akkurat da.
    // Testen påstår ikke hvor bred forhåndsvisningen ER — den påstår at valget følger bredden.
    const stand = () => page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>("#previewPane img");
      const spalte = img?.parentElement?.clientWidth ?? 0;
      if (!img || !img.dataset.assetLayout || spalte === 0) return null;
      return { vist: img.dataset.assetLayout, passer: spalte < 640 ? "narrow" : "wide" };
    });
    await expect.poll(async () => { const s = await stand(); return s !== null && s.vist === s.passer; }).toBe(true);
    const bredt = await stand();
    expect(bredt?.passer).toBe("wide");
    // Hver henting ba om det brede oppsettet.
    expect(forespørsler.length).toBeGreaterThanOrEqual(1);
    expect(new Set(forespørsler)).toEqual(new Set([null]));

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(bilde).toHaveAttribute("data-asset-layout", "narrow");
    expect((await stand())?.passer).toBe("narrow");
    expect(await vistBredde(bilde)).toBe(480);
  });

  test("når forhåndsvisningen tegnes på nytt, glemmes figurene som ble byttet ut", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await åpneForhåndsvisning(page);
    const fulgt = () => page.evaluate(async (modul) => ((await import(modul)) as { watchedAssetImageCount: () => number }).watchedAssetImageCount(), "/static/api-client.js");
    expect(await fulgt()).toBe(1);

    // Fem runder med skriving: forhåndsvisningen tegnes på nytt hver gang.
    for (let runde = 1; runde <= 5; runde++) {
      await page.locator('[data-form-tab-btn="rediger"]').click();
      await page.locator("#markdownInput").fill(`# Hei ${runde}\n\n![Saksgang](asset:a1)`);
      await page.locator('[data-form-tab-btn="forhandsvisning"]').click();
      await expect.poll(async () => (await page.locator("#previewPane img").getAttribute("src")) ?? "").toMatch(/^blob:/);
    }
    // Én figur på sida, én figur fulgt — ikke seks.
    await expect(page.locator("#previewPane img")).toHaveCount(1);
    await expect.poll(fulgt).toBe(1);
  });
});
