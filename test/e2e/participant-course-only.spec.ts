import { test, expect, type Page, type Route } from "@playwright/test";

// #495-follow-up: når config.courseOnly er på, skjuler deltaker-UI den frittstående modul-seksjonen
// (#moduleListSection). Kurs-seksjonen forblir. Kjører ekte participant.js i mock-modus.

async function mockBase(page: Page, courseOnly: boolean) {
  await page.route("**/participant/config", (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    authMode: "mock", courseOnly, navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "p1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] }, flow: {}, output: {},
  }) }));
  await page.route("**/version", (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }) }));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }));
  await page.route("**/api/courses/enrollments", (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enrollments: [] }) }));
  await page.route("**/api/courses/completions", (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }));
  await page.route("**/api/courses", (r: Route) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }));
}

test("deltaker: modul-seksjonen skjules når courseOnly er på", async ({ page }) => {
  await mockBase(page, true);
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* */ } });
  await page.goto("/participant");
  await expect(page.locator("#courseSection")).toBeVisible();
  await expect(page.locator("#moduleListSection")).toBeHidden();
});

test("deltaker: modul-seksjonen vises når courseOnly er av", async ({ page }) => {
  await mockBase(page, false);
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* */ } });
  await page.goto("/participant");
  await expect(page.locator("#moduleListSection")).toBeVisible();
});
