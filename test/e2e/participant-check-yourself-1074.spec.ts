import { test, expect, type Page, type Route } from "@playwright/test";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1074 «Sjekk deg selv» i deltakerens lesevisning. HTML-en lages av tjenerens egen tegning og rensing
// (renderSectionMarkdown), og går så gjennom klientens rensing — det deltakeren faktisk får.

const MD = [
  "Innledning.",
  "",
  ":::sjekk Hvilken kilde er viktigst?",
  "- [ ] Innkallingen",
  "- [x] Notatene fra møtet",
  "- [ ] Fjorårets referat",
  "",
  "Notatene viser hva som ble bestemt.",
  ":::",
  "",
  "Etterpå.",
].join(String.fromCharCode(10));

async function mockParticipant(page: Page, html: string) {
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Seksjon", html }) }),
  );
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

async function openSection(page: Page, locale = "nb") {
  await mockParticipant(page, renderSectionMarkdown(MD, locale));
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();
  const box = page.locator(".content-check");
  await expect(box).toBeVisible();
  return box;
}

test.describe("#1074 «Sjekk deg selv» i lesevisningen", () => {
  test("før svar: spørsmål og tre alternativer, ingen forklaring", async ({ page }) => {
    const box = await openSection(page);
    await expect(box.locator(".content-check-label")).toHaveText("Sjekk deg selv");
    await expect(box.locator(".content-check-option")).toHaveCount(3);
    await expect(box.locator(".content-check-explanation")).toBeHidden();
    await expect(box.locator(".content-check-verdict")).toHaveText("");
  });

  test("feil svar: valget markeres feil, det riktige markeres, forklaringen vises", async ({ page }) => {
    const box = await openSection(page);
    const options = box.locator(".content-check-option");
    await options.nth(0).click();
    await expect(options.nth(0)).toHaveClass(/is-wrong/);
    await expect(options.nth(1)).toHaveClass(/is-correct/);
    await expect(options.nth(2)).toHaveClass(/is-dimmed/);
    await expect(box.locator(".content-check-verdict")).toHaveText("Ikke helt. Riktig svar er markert.");
    await expect(box.locator(".content-check-explanation")).toBeVisible();
    await expect(box.locator(".content-check-explanation")).toContainText("Notatene viser hva som ble bestemt.");
    // Skjermleseren får vite hvilket som er riktig og hvilket som ble valgt, ikke bare fargen.
    await expect(options.nth(1).locator(".sr-only")).toHaveText(" (riktig svar)");
    await expect(options.nth(0).locator(".sr-only")).toHaveText(" (ditt svar)");
    await expect(options.nth(1)).toHaveAccessibleName(/Notatene fra møtet.*riktig svar/);
    // Låst etter første svar: et nytt klikk endrer ingenting.
    await options.nth(2).click({ force: true });
    await expect(options.nth(2)).not.toHaveClass(/is-wrong/);
    await expect(options.nth(0)).toHaveAttribute("aria-pressed", "true");
  });

  test("riktig svar med tastaturet: bekreftelse, og fokus blir stående på knappen", async ({ page }) => {
    const box = await openSection(page);
    const right = box.locator(".content-check-option").nth(1);
    await right.focus();
    await page.keyboard.press("Enter");
    await expect(right).toHaveClass(/is-correct/);
    await expect(box.locator(".content-check-verdict")).toHaveText("Riktig!");
    await expect(right).toBeFocused();
    await expect(box.locator(".content-check-feedback")).toHaveAttribute("aria-live", "polite");
  });

  test("engelsk: merkelapp og tilbakemelding på engelsk", async ({ page }) => {
    const box = await openSection(page, "en-GB");
    await expect(box.locator(".content-check-label")).toHaveText("Check yourself");
    await box.locator(".content-check-option").nth(1).click();
    await expect(box.locator(".content-check-verdict")).toHaveText("Correct!");
  });

  test("telefon (390 px): alternativene har plass, og siden rulles ikke sidelengs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await openSection(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const width = await box.locator(".content-check-option").first().evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(250);
  });
});
