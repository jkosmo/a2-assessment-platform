import { readFileSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";

// #1073 — en animert figur i deltakerflaten.
//
// Figuren vises som <img>, og nettleseren tar IKKE leserens «redusert bevegelse» med inn i en SVG som
// vises som bilde (målt i Chromium 2026-10-03). Plattformen gjør det derfor selv: med innstillingen på
// vises stillbildet. Uten den spilles figuren av når den kommer til syne, og igjen ved klikk.
//
// Hva som beveger seg INNI et bilde, kan ikke leses fra sida. Det måles derfor i to deler: hvilket
// bilde sida viser (her), og at stillbildet faktisk står stille når det åpnes som dokument (nederst).

function malen(heading: string): string {
  const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
  const match = doc.split(heading)[1]?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!match) throw new Error(`fant ikke malen «${heading}» i figure-design.md`);
  return match[1];
}
const STI = malen("### path drawn (animated)");
const FLYT = malen("### flow (animated)");
const STILLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><rect x="10" y="10" width="80" height="40" fill="#eef"/></svg>';

async function åpneSeksjonen(page: Page, figur: string, opts: { langtFør?: boolean } = {}) {
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
    route.fulfill(json({ courses: [{ id: "c1", title: "Ruten", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] })));
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Ruten", items: [{ type: "SECTION", sectionId: "s1", title: "Veien", read: false }] } })));
  const fyll = opts.langtFør ? Array.from({ length: 40 }, (_, i) => `<p>Avsnitt ${i + 1} før figuren, så den står langt nede på sida.</p>`).join("") : "";
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill(json({ title: "Veien", html: `<p>Slik går veien.</p>${fyll}<p><img src="/api/content-assets/a1?locale=nb" alt="Veien fra start til mål"></p><p>Slutt.</p>` })));
  await page.route("**/api/content-assets/a1**", (route: Route) => {
    if (route.request().resourceType() !== "fetch") return route.fulfill({ status: 401, body: "" });
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: figur });
  });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();
  const bilde = page.locator("#sectionReaderBody img");
  await expect.poll(async () => (await bilde.getAttribute("src")) ?? "").toMatch(/^blob:/);
  return bilde;
}

/** Teksten i bildet sida viser nå. */
const vist = (page: Page) => page.locator("#sectionReaderBody img").evaluate(async (img) => (await fetch((img as HTMLImageElement).src)).text());

test.describe("#1073 — animerte figurer i deltakerflaten", () => {
  test("med «redusert bevegelse» vises stillbildet — for begge malene", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const figur of [STI, FLYT]) {
      const bilde = await åpneSeksjonen(page, figur);
      await expect(bilde).toHaveAttribute("data-asset-animated", "still");
      expect(await vist(page)).toContain("animation:none !important");
      // Et stillbilde spilles ikke av igjen ved klikk.
      const før = await bilde.getAttribute("src");
      await bilde.click();
      expect(await bilde.getAttribute("src")).toBe(før);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("uten innstillingen vises figuren som den er, og et klikk spiller den av på nytt", async ({ page }) => {
    const bilde = await åpneSeksjonen(page, STI);
    await expect(bilde).toHaveAttribute("data-asset-animated", "moving");
    expect(await vist(page)).not.toContain("animation:none !important");
    const før = await bilde.getAttribute("src");
    await bilde.click();
    await expect.poll(() => bilde.getAttribute("src")).not.toBe(før);
    // Samme figur, lastet på nytt — ikke stillbildet.
    expect(await vist(page)).toBe(STI);
  });

  test("en figur langt nede spilles av når den kommer til syne — én gang", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    const bilde = await åpneSeksjonen(page, STI, { langtFør: true });
    await expect(bilde).not.toBeInViewport();
    const lastet = await bilde.getAttribute("src");
    await page.waitForTimeout(700);
    expect(await bilde.getAttribute("src"), "ikke spilt av før den er synlig").toBe(lastet);
    await bilde.scrollIntoViewIfNeeded();
    await expect.poll(() => bilde.getAttribute("src")).not.toBe(lastet);
    const spilt = await bilde.getAttribute("src");
    // Ut av syne og inn igjen: ikke en gang til. Det er klikket som spiller av igjen.
    await page.evaluate(() => window.scrollTo(0, 0));
    await bilde.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect(await bilde.getAttribute("src")).toBe(spilt);
  });

  test("kontroll: en stillestående figur merkes ikke, og et klikk gjør ingenting", async ({ page }) => {
    const bilde = await åpneSeksjonen(page, STILLE);
    await expect(bilde).not.toHaveAttribute("data-asset-animated", /.+/);
    const før = await bilde.getAttribute("src");
    await bilde.click();
    expect(await bilde.getAttribute("src")).toBe(før);
  });
});

test.describe("#1073 — stillbildet står stille", () => {
  const åpne = (page: Page, svg: string) => page.goto(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const løpende = (page: Page) => page.evaluate(() => document.getAnimations().length);
  /** Stillbildet slik deltakerflaten lager det: plattformens egen funksjon, kjørt i nettleseren. */
  async function stillbilde(page: Page, svg: string): Promise<string> {
    await page.goto("/participant");
    // Stien som argument: en nettleseradresse, ikke en modul TypeScript skal finne på disk.
    return page.evaluate(async ([figur, modul]) => (await import(modul)).stillSvg(figur), [svg, "/static/api-client.js"]);
  }

  for (const [navn, figur] of [["stien", STI], ["flyten", FLYT]] as const) {
    test(`${navn}: malen beveger seg, stillbildet av den gjør det ikke`, async ({ page }) => {
      const stille = await stillbilde(page, figur);
      await åpne(page, figur);
      expect(await løpende(page), "kontroll: malen har animasjoner").toBeGreaterThan(0);
      await åpne(page, stille);
      expect(await løpende(page)).toBe(0);
    });
  }
});
