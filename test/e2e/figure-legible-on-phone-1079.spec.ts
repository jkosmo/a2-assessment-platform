import { test, expect, type Page, type Route } from "@playwright/test";
import { drawFlowFigure } from "../../skills/a2-authoring-api/scripts/draw-flow-figure.mjs";

// #1079: det smale oppsettet skal kunne LESES på en telefon. Første utgave (2.81.0) besto alle
// målingene av at riktig oppsett ble valgt — og etikettene var 5 px høye på skjermen.
//
// ⚠️ Hvorfor ingen test så det: det smale oppsettet ble tegnet for en spalte på 480 px, et tall fra
// en prototypeside. Ingen test målte spalten deltakeren faktisk leser i. På en telefon på 390 px var
// den 201 px, fordi leseren ligger inni tre rammer som hver tar sin marg. Utgivelsestesten mot stage
// fant det, på et skjermbilde.
//
// Her måles derfor det som teller: hvor store etikettene blir på skjermen, i den EKTE deltakersida,
// med figuren skriptet faktisk tegner (åtte steg — det meste en figur rommer).

const { wide: BRED, narrow: SMAL } = drawFlowFigure({
  name: "flyt",
  title: "Arbeidsflyt i åtte steg",
  desc: "Åtte steg i rekkefølge, fordelt på tre faser.",
  phases: {
    a: { label: "Forbered", grunn: "#d9e8dd", lys: "#6fae87", tekst: "#3f7a57" },
    b: { label: "Vurder", grunn: "#dce7f2", lys: "#7fa3c7", tekst: "#44699a" },
    c: { label: "Avslutt", grunn: "#e7e2f0", lys: "#a99bc9", tekst: "#6b5a94" },
  },
  steps: [
    { label: ["Motta", "saken"], phase: "a" }, { label: ["Sjekk", "vedlegg"], phase: "a" }, { label: ["Klargjør", "kilder"], phase: "a" },
    { label: ["Vurder", "vilkårene"], phase: "b" }, { label: ["Drøft", "med kollega"], phase: "b" }, { label: ["Kvalitetssikre"], phase: "b" },
    { label: ["Skriv", "vedtaket"], phase: "c" }, { label: ["Arkiver"], phase: "c" },
  ],
});
const viewBoxBredde = (svg: string) => Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
/** Etikettene under stegene er satt i 12 px i figurens egne mål (draw-flow-figure.mjs). */
const ETIKETT_PX = 12;
/** Det minste som kan leses. Samme grense som det brede oppsettet er regnet etter (MAX_STEPS). */
const MINST_LESBAR_PX = 9;

async function åpneSeksjonen(page: Page) {
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
    route.fulfill(json({ courses: [{ id: "c1", title: "Saksbehandling for nyansatte", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] })));
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Saksbehandling for nyansatte", items: [{ type: "SECTION", sectionId: "s1", title: "Saksgangen", read: false }] } })));
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill(json({ title: "Saksgangen", html: '<p>En sak går gjennom åtte steg fra den kommer inn til den er arkivert.</p><p><img src="/api/content-assets/a1?locale=nb" alt="Arbeidsflyt i åtte steg"></p><p>Hvert steg har en ansvarlig.</p>' })));
  await page.route("**/api/content-assets/a1**", (route: Route) => {
    if (route.request().resourceType() !== "fetch") return route.fulfill({ status: 401, body: "" });
    const smal = new URL(route.request().url()).searchParams.get("layout") === "narrow";
    return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "X-Asset-Layout": smal ? "narrow" : "wide", "X-Asset-Layouts": "wide,narrow" }, body: smal ? SMAL : BRED });
  });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();
  const bilde = page.locator("#sectionReaderBody img");
  await expect.poll(async () => (await bilde.getAttribute("src")) ?? "").toMatch(/^blob:/);
  return bilde;
}

/** Det nettleseren har tegnet: oppsettet som vises, hvor bredt bildet er på skjermen, og hva sida kan rulles sidelengs. */
async function mål(page: Page) {
  const bilde = page.locator("#sectionReaderBody img");
  await expect.poll(async () => bilde.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  return bilde.evaluate((el) => {
    const img = el as HTMLImageElement;
    const kjede: string[] = [];
    for (let e: HTMLElement | null = img; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      kjede.push(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.className && typeof e.className === "string" ? `.${e.className.trim().split(/\s+/).join(".")}` : ""} bredde=${Math.round(e.getBoundingClientRect().width)} padding=${s.paddingLeft}/${s.paddingRight} margin=${s.marginLeft}/${s.marginRight} kant=${s.borderLeftWidth}`);
    }
    return {
      oppsett: img.dataset.assetLayout,
      bildebredde: img.getBoundingClientRect().width,
      skjerm: document.documentElement.clientWidth,
      sidelengs: document.documentElement.scrollWidth - window.innerWidth,
      kjede,
    };
  });
}

const BILDER = process.env.FIGUR_BILDER ?? "";

test.describe("#1079 — figuren kan leses på telefon", () => {
  // 390 er den vanligste telefonbredden (og den feilen ble målt på). 360 er den vanlige på Android.
  for (const bredde of [390, 360]) {
    test(`telefon, ${bredde} px: det smale oppsettet vises, og etikettene er minst ${MINST_LESBAR_PX} px på skjermen`, async ({ page }) => {
      await page.setViewportSize({ width: bredde, height: 844 });
      const bilde = await åpneSeksjonen(page);
      await expect(bilde).toHaveAttribute("data-asset-layout", "narrow");
      const m = await mål(page);
      const etikett = (ETIKETT_PX * m.bildebredde) / viewBoxBredde(SMAL);
      expect(etikett, `etikettene er ${etikett.toFixed(1)} px når bildet er ${Math.round(m.bildebredde)} px bredt\n${m.kjede.join("\n")}`).toBeGreaterThanOrEqual(MINST_LESBAR_PX);
      expect(m.sidelengs, "piksler sida kan rulles sidelengs").toBeLessThanOrEqual(0);
      if (BILDER) { await bilde.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${BILDER}/telefon-${bredde}.png` }); }
    });
  }

  // Spalten er smalere enn 640 px, så det smale oppsettet vises — men det er tegnet for en telefon.
  // Uten en egen størrelse ville det fylt hele spalten, med etiketter på 30 px.
  test("nettbrett på høykant (768 px): det smale oppsettet blåses ikke opp — det står i sin egen størrelse", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const bilde = await åpneSeksjonen(page);
    await expect(bilde).toHaveAttribute("data-asset-layout", "narrow");
    const m = await mål(page);
    // Kontroll: spalten er bredere enn figuren, så det er figurens egen størrelse som holder den igjen.
    const spalte = await bilde.evaluate((el) => el.parentElement!.clientWidth);
    expect(spalte).toBeGreaterThan(400);
    expect(m.bildebredde).toBe(300);
    const etikett = (ETIKETT_PX * m.bildebredde) / viewBoxBredde(SMAL);
    expect(etikett).toBe(15);
    // Høyden følger bredden: figuren er ikke strukket.
    const forhold = await bilde.evaluate((el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
    expect(Math.abs(forhold - 240 / 472)).toBeLessThan(0.01);
    if (BILDER) { await bilde.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${BILDER}/nettbrett-768.png` }); }
  });

  test("kontroll: på PC vises det brede oppsettet, og det fyller spalten", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const bilde = await åpneSeksjonen(page);
    await expect(bilde).toHaveAttribute("data-asset-layout", "wide");
    const m = await mål(page);
    const spalte = await bilde.evaluate((el) => el.parentElement!.clientWidth);
    expect(Math.abs(m.bildebredde - spalte)).toBeLessThan(1);
    expect((ETIKETT_PX * m.bildebredde) / viewBoxBredde(BRED)).toBeGreaterThanOrEqual(MINST_LESBAR_PX);
    if (BILDER) { await bilde.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${BILDER}/pc-1280.png` }); }
  });
});
