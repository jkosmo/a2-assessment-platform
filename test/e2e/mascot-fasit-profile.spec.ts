import { test, expect } from "@playwright/test";
import { fasit } from "../support/mascotFasit.js";
import { boatView, mockProfile, PROFILE_LOCALES, PROFILE_MOODS } from "../support/mascotE2e.js";

// Maskotpakken, steg 0: fasit for båten på profilen (doc/design/MASKOTPAKKE.md).
//
// Strukturelt, ikke skjermbilde: for fem humør (og et humør klienten ikke kjenner) × tre språk lagres linja, bildets
// bytes (sha256), alt, bredde og høyde. Og språkbyttet: linja følger språket med en gang, også når ny henting av
// statistikken feiler. Bildeadressen er IKKE med: den får pakkenavnet i flyttingen (`/static/mascot/seilbat/...`).
// Oppsettet og målingen står i test/support/mascotE2e.ts, som testen av et bytte (mascot-swap.spec.ts) også bruker.

test.describe("maskotpakken, steg 0: båten på profilen", () => {
  test("fem humør og et ukjent × tre språk: linje, bildets bytes, alt, bredde og høyde", async ({ browser }) => {
    test.setTimeout(120_000);
    const actual: Record<string, unknown> = {};
    for (const mood of PROFILE_MOODS) {
      for (const locale of PROFILE_LOCALES) {
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
    for (const mood of PROFILE_MOODS) {
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
