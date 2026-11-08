import { existsSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";
import { fasit } from "../support/mascotFasit.js";

// Maskotpakken, steg 0: fasit for figuren på fremdriftslinja i «Mine kurs» (doc/design/MASKOTPAKKE.md).
//
// To deler, for tilstandene ikke påbegynt, 1 av 300, 29 %, 30 %, fullført og feiring:
//   - normalisert DOM: elementene med navnerom, sorterte attributter og tekst; mellomrom mellom elementene og
//     `xmlns`-deklarasjoner er ikke med (navnerommet er det som teller, og det står på hvert element);
//   - skjermbilde av linja på 390 og 1280 px, med animasjonen fryst, null pikslers avvik.
//
// ⚠️ Skjermbildene er tatt på Windows (Chromium). Tegningen av kanter varierer mellom plattformene, så på en plattform
// uten egne skjermbilder (Linux i CI) hoppes de over. DOM-en sammenlignes overalt.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const COURSES = [
  { id: "cNot", state: "ikke påbegynt", done: 0, total: 8, status: "NOT_STARTED" },
  { id: "c1of300", state: "1 av 300", done: 1, total: 300, status: "IN_PROGRESS" },
  { id: "c29", state: "29 %", done: 29, total: 100, status: "IN_PROGRESS" },
  { id: "c30", state: "30 %", done: 30, total: 100, status: "IN_PROGRESS" },
  { id: "cDone", state: "fullført", done: 8, total: 8, status: "COMPLETED" },
];

async function mockCourses(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (r: Route) => r.fulfill(json({
    courses: COURSES.map((c) => ({
      id: c.id,
      title: c.state,
      description: null,
      moduleCount: 0,
      progress: { completed: c.done, total: c.total, sectionCompleted: c.done, sectionTotal: c.total, courseStatus: c.status },
      themes: [],
    })),
    themes: [],
  })));
  await page.route("**/api/courses/completions", (r: Route) => r.fulfill(json({
    completions: [{ courseId: "cDone", certificateId: "cert-1", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "fullført" }],
  })));
}

const progress = (page: Page, id: string) => page.locator(`.course-accordion-item[data-course-id="${id}"] .course-progress`).first();

/** Elementtreet som data: navnerom, navn, sorterte attributter (uten xmlns), tekst uten rene mellomrom. */
function normalizedDom(page: Page, id: string) {
  return progress(page, id).evaluate((root) => {
    type Node_ = { ns: string | null; tag: string; attrs: Array<[string, string]>; children: Array<Node_ | string> };
    const walk = (el: Element): Node_ => ({
      ns: el.namespaceURI,
      tag: el.localName,
      attrs: Array.from(el.attributes)
        .filter((a) => a.name !== "xmlns" && !a.name.startsWith("xmlns:"))
        .map((a) => [a.name, a.value] as [string, string])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      children: Array.from(el.childNodes).flatMap((child): Array<Node_ | string> => {
        if (child.nodeType === Node.ELEMENT_NODE) return [walk(child as Element)];
        if (child.nodeType === Node.TEXT_NODE && child.textContent!.trim()) return [child.textContent!.trim()];
        return [];
      }),
    });
    return walk(root);
  });
}

/** Feiringen, slik den startes når et kurs fullføres i økta, fryst 600 ms inn (båten er inne, konfettien i lufta). */
async function startFrozenCelebration(page: Page) {
  await page.evaluate(async () => {
    const { launchCourseBoatCelebration } = await import("/static/course-progress-boat.js" as string);
    const el = document.querySelector('.course-accordion-item[data-course-id="cDone"] .course-progress');
    // Sikkerhetsnettet (setTimeout) ville fjernet båten mens skjermbildet tas; animasjonen står stille her.
    const realSetTimeout = window.setTimeout;
    window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
    try {
      launchCourseBoatCelebration(el, { reducedMotion: false });
    } finally {
      window.setTimeout = realSetTimeout;
    }
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 600;
    }
  });
  await expect(progress(page, "cDone").locator(".course-boat")).toHaveAttribute("data-boat-mood", "feirer");
}

async function shoot(page: Page, id: string, name: string, frozenByTest: boolean) {
  const info = test.info();
  const baseline = info.snapshotPath(name, { kind: "screenshot" });
  const updating = info.config.updateSnapshots === "all" || info.config.updateSnapshots === "changed";
  if (!existsSync(baseline) && !updating) {
    info.annotations.push({ type: "hoppet over", description: `${name}: ingen skjermbilder for ${process.platform}` });
    return;
  }
  await expect(progress(page, id)).toHaveScreenshot(name, {
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
