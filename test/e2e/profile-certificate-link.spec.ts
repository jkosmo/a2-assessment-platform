import { test, expect, type Page, type Route } from "@playwright/test";

// #550 follow-up: the Profile page ("Fullførte kurs") lists course completions with a certificate
// ID. It must link each row to the printable certificate view (/certificate?id=...). This e2e runs
// the real profile.js and asserts the link renders with the resolved i18n label + correct href.

async function mockProfile(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] },
        },
        calibrationWorkspace: { accessRoles: [] },
        flow: {},
        output: {},
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "participant-1", name: "Kari", email: "p@x.no", roles: ["PARTICIPANT"] },
        consent: { accepted: true, currentVersion: "1.0" },
      }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  await page.route("**/api/modules/completed**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [] }) }),
  );
}

test("profile: completed courses link to the printable certificate", async ({ page }) => {
  await mockProfile(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completions: [
          {
            courseId: "c1",
            certificateId: "cert-abc",
            completedAt: "2026-06-20T10:00:00.000Z",
            courseTitle: "Labour Law",
            certificationLevel: "basic",
          },
        ],
      }),
    }),
  );

  await page.goto("/profile");

  const link = page.locator('#coursesBody a[href="/certificate?id=cert-abc"]');
  await expect(link).toBeVisible();
  // i18n label resolved (not the raw key).
  await expect(link).toHaveText("View certificate");
  await expect(link).toHaveAttribute("target", "_blank");
});
