import { test, expect, type Page, type Route } from "@playwright/test";

// #1072: «Tenk først» i deltakerens lesevisning. Tjeneren tegner `:::tenk` som <details>/<summary>
// (test/unit/section-content-blocks-1079.test.ts); her prøves det deltakeren møter i nettleseren,
// etter klientens egen rensing (public/static/sanitize.js): spørsmålet vises, svaret er skjult, og
// det åpnes med klikk eller tastatur.

const HTML =
  '<p>Innledning.</p>' +
  '<details class="content-think"><summary class="content-think-question">' +
  '<span class="content-think-label">Tenk først</span>' +
  '<span class="content-think-text">Hva tror du skjer hvis du laster opp <strong>hele</strong> anbudet?</span>' +
  '<span class="content-think-hint">Vis svaret</span>' +
  '</summary><div class="content-think-answer"><p>KI leser alt, men sammendraget blir generelt.</p></div></details>' +
  '<p>Etterpå.</p>';

async function mockParticipant(page: Page) {
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
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] }) }),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "c1", title: "Kurs", items: [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false }] } }) }),
  );
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Seksjon", html: HTML }) }),
  );
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

test.describe("#1072 «Tenk først» i lesevisningen", () => {
  test("spørsmålet vises, svaret er skjult; ett klikk viser det, og hintet forsvinner", async ({ page }) => {
    await mockParticipant(page);
    await page.goto("/participant");
    await page.locator(".course-accordion-header").click();
    await page.locator(".course-module-row").click();

    const boks = page.locator(".content-think");
    await expect(boks).toBeVisible();
    await expect(boks.locator(".content-think-label")).toHaveText("Tenk først");
    await expect(boks.locator(".content-think-text")).toContainText("hele anbudet");
    await expect(boks.locator(".content-think-answer")).toBeHidden();
    await expect(boks.locator(".content-think-hint")).toBeVisible();

    await boks.locator("summary").click();
    await expect(boks.locator(".content-think-answer")).toBeVisible();
    await expect(boks.locator(".content-think-answer")).toContainText("sammendraget blir generelt");
    await expect(boks.locator(".content-think-hint")).toBeHidden();
  });

  test("tastaturet: Enter og mellomrom på spørsmålet åpner og lukker svaret", async ({ page }) => {
    await mockParticipant(page);
    await page.goto("/participant");
    await page.locator(".course-accordion-header").click();
    await page.locator(".course-module-row").click();

    const sporsmal = page.locator(".content-think summary");
    await expect(sporsmal).toBeVisible();
    await sporsmal.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".content-think-answer")).toBeVisible();
    await page.keyboard.press(" ");
    await expect(page.locator(".content-think-answer")).toBeHidden();
  });

  test("på telefon (390 px) brekker spørsmålet og boksen ruller ikke sidelengs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockParticipant(page);
    await page.goto("/participant");
    await page.locator(".course-accordion-header").click();
    await page.locator(".course-module-row").click();
    const boks = page.locator(".content-think");
    await expect(boks).toBeVisible();
    const mål = await boks.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right }));
    expect(mål.scroll).toBeLessThanOrEqual(mål.client + 1);
    expect(mål.right).toBeLessThanOrEqual(390);
  });
});
