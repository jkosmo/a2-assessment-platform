import { test, expect, type Page, type Route } from "@playwright/test";
import { fasit, sha256 } from "../support/mascotFasit.js";

// Maskotpakken, steg 0: fasit for båten på profilen (doc/design/MASKOTPAKKE.md).
//
// Strukturelt, ikke skjermbilde: for fem humør (og et humør klienten ikke kjenner) × tre språk lagres linja, bildets
// bytes (sha256), alt, bredde og høyde. Og språkbyttet: linja følger språket med en gang, også når ny henting av
// statistikken feiler. Bildeadressen er IKKE med: den får pakkenavnet i flyttingen (`/static/mascot/seilbat/...`).

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const MOODS = ["mett", "sulten", "sur", "dramatisk", "ny", "anker"] as const;
const LOCALES = ["nb", "nn", "en-GB"] as const;

function stats(mood: string) {
  return { generatedAt: "2026-11-11T10:30:00.000Z", mood, lastActivityAt: null, weeks: [], recent: {}, totals: {}, passedModules: [] };
}

/** Statistikken svarer med humøret først; med `failAfterFirst` feiler hver henting etter den første. */
async function mockProfile(page: Page, mood: string, locale: string, { failAfterFirst = false } = {}) {
  await page.addInitScript((value) => {
    try { localStorage.setItem("participant.locale", value); } catch { /* ignore */ }
  }, locale);
  await page.route("**/participant/config", (route: Route) => route.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "p-1", email: "kari@example.com", name: "Kari", department: "Rådgivning", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({
    user: { id: "p-1", name: "Kari Nordmann", email: "kari@example.com", department: "Rådgivning", roles: ["PARTICIPANT"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  let calls = 0;
  await page.route("**/api/me/stats", (route: Route) => {
    calls += 1;
    return route.fulfill(failAfterFirst && calls > 1 ? json({ error: "boom" }, 500) : json(stats(mood)));
  });
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  return { statsCalls: () => calls };
}

async function boatView(page: Page) {
  const line = page.locator("#statsMoodLine");
  await expect(line).toBeVisible();
  const boat = page.locator(".stats-boat");
  await expect.poll(() => boat.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const view = await boat.evaluate((img: HTMLImageElement) => ({
    alt: img.getAttribute("alt"),
    width: img.getAttribute("width"),
    height: img.getAttribute("height"),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    src: img.currentSrc,
  }));
  const response = await page.request.get(view.src);
  expect(response.status(), view.src).toBe(200);
  const bytes = await response.body();
  const { src: _src, ...rest } = view;
  return { line: await line.textContent(), ...rest, image: { contentType: response.headers()["content-type"], bytes: bytes.length, sha256: sha256(bytes) } };
}

test.describe("maskotpakken, steg 0: båten på profilen", () => {
  test("fem humør og et ukjent × tre språk: linje, bildets bytes, alt, bredde og høyde", async ({ browser }) => {
    test.setTimeout(120_000);
    const actual: Record<string, unknown> = {};
    for (const mood of MOODS) {
      for (const locale of LOCALES) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await mockProfile(page, mood, locale);
        await page.goto("/profile");
        actual[`${mood} | ${locale}`] = await boatView(page);
        await context.close();
      }
    }
    expect(actual).toEqual(fasit("profile.json", actual));
  });

  test("språkbytte: linja følger språket med en gang, også når ny henting feiler", async ({ browser }) => {
    test.setTimeout(120_000);
    const actual: Record<string, unknown> = {};
    for (const mood of MOODS) {
      for (const failAfterFirst of [false, true]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const mocked = await mockProfile(page, mood, "nb", { failAfterFirst });
        await page.goto("/profile");
        const steps: Record<string, unknown> = { nb: await boatView(page) };
        for (const locale of ["en-GB", "nn", "nb"] as const) {
          const before = mocked.statsCalls();
          await page.selectOption("#localeSelect", locale);
          // Språkbyttet henter statistikken på nytt (og den feiler, når `failAfterFirst`): vent til det er gjort.
          await expect.poll(() => mocked.statsCalls()).toBeGreaterThan(before);
          await page.waitForLoadState("networkidle");
          steps[`etter bytte til ${locale}`] = await boatView(page);
        }
        actual[`${mood} | ${failAfterFirst ? "ny henting feiler" : "ny henting virker"}`] = steps;
        await context.close();
      }
    }
    expect(actual).toEqual(fasit("profile-locale-switch.json", actual));
  });
});
