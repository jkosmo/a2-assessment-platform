import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { fasit } from "../support/mascotFasit.js";
import { COURSES, mockCourses, normalizedDom, progress, startFrozenCelebration } from "../support/mascotE2e.js";

// Maskotpakken, steg 0: fasit for figuren på fremdriftslinja i «Mine kurs» (doc/design/MASKOTPAKKE.md).
//
// To deler, for tilstandene ikke påbegynt, 1 av 300, 29 %, 30 %, fullført og feiring:
//   - normalisert DOM: elementene med navnerom, sorterte attributter og tekst; mellomrom mellom elementene og
//     `xmlns`-deklarasjoner er ikke med (navnerommet er det som teller, og det står på hvert element);
//   - skjermbilde av linja på 390 og 1280 px, med animasjonen fryst, null pikslers avvik.
//
// ⚠️ Skjermbildene er tatt på Windows (Chromium). Tegningen av kanter varierer mellom plattformene, så på en plattform
// uten egne skjermbilder (Linux i CI) hoppes de over. DOM-en sammenlignes overalt.

// Oppsettet og målingen står i test/support/mascotE2e.ts, som testen av et bytte (mascot-swap.spec.ts) også bruker.

// 2.152.0 (produkteier 2026-11-11): fullførte kurs står i ett kort med ÉN felles grønn linje; kursets egen linje er skjult der og
// vises bare mens båten feirer. Den fullførte tilstanden er derfor den felles linja.
const line = (page: Page, id: string, celebrating: boolean) =>
  id === "cDone" && !celebrating ? page.locator(".course-done-group-bar").first() : progress(page, id);

async function shoot(page: Page, id: string, name: string, frozenByTest: boolean) {
  const info = test.info();
  const baseline = info.snapshotPath(name, { kind: "screenshot" });
  const updating = info.config.updateSnapshots === "all" || info.config.updateSnapshots === "changed";
  if (!existsSync(baseline) && !updating) {
    info.annotations.push({ type: "hoppet over", description: `${name}: ingen skjermbilder for ${process.platform}` });
    return;
  }
  await expect(line(page, id, frozenByTest)).toHaveScreenshot(name, {
    maxDiffPixels: 0,
    threshold: 0,
    // Feiringen er fryst av testen over; Playwrights «disabled» ville spolt den til slutten, og da er båten borte.
    animations: frozenByTest ? "allow" : "disabled",
    caret: "hide",
  });
}

test.describe("maskotpakken, steg 0: figuren på fremdriftslinja", () => {
  test("normalisert DOM for hver tilstand", async ({ page }) => {
    await mockCourses(page);
    await page.goto("/participant");
    await expect(progress(page, "c30").locator(".course-boat")).toHaveCount(1);

    const actual: Record<string, unknown> = {};
    for (const course of COURSES) actual[course.state] = await normalizedDom(page, course.id);
    await startFrozenCelebration(page);
    actual.feiring = await normalizedDom(page, "cDone");

    expect(actual).toEqual(fasit("figure-dom.json", actual));
  });

  for (const width of [390, 1280]) {
    test(`skjermbilder på ${width} px, animasjonen fryst`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockCourses(page);
      await page.goto("/participant");
      await expect(progress(page, "c30").locator(".course-boat")).toHaveCount(1);
      // Skriftene først, så ingen omtegning kommer midt i et bilde.
      await page.evaluate(() => document.fonts.ready);

      for (const course of COURSES) await shoot(page, course.id, `figur-${course.id}-${width}.png`, false);
      await startFrozenCelebration(page);
      await shoot(page, "cDone", `figur-feiring-${width}.png`, true);
    });
  }
});
