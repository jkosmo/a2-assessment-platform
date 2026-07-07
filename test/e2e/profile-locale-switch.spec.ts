import { test, expect, type Page, type Route } from "@playwright/test";

// #736: switching the locale on the profile page must re-render the dynamically built
// completed-modules/courses tables too — not just the static [data-i18n] labels. Previously a
// switch left the value cells (pass/fail, "view certificate") in the old language while headers
// changed, producing a mixed-locale page.

async function mockProfile(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          participant: { userId: "p-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] },
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
      // No user.locale → the page keeps the localStorage locale (en-GB) so the manual switch is what's tested.
      body: JSON.stringify({
        user: { id: "p-1", name: "P", email: "p@x.no", roles: ["PARTICIPANT"] },
        consent: { accepted: true, currentVersion: "1.0" },
      }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  await page.route("**/api/modules/completed**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          {
            moduleTitle: "Module A",
            latestCompletedAt: "2026-06-20T10:00:00.000Z",
            latestDecision: { totalScore: 100, passFailTotal: true },
          },
        ],
      }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completions: [
          { courseId: "c1", certificateId: "cert-1", completedAt: "2026-06-20T10:00:00.000Z", courseTitle: "Course A", certificationLevel: "basic" },
        ],
      }),
    }),
  );
  await page.addInitScript(() => {
    try {
      localStorage.setItem("participant.locale", "en-GB");
    } catch {
      /* ignore */
    }
  });
}

test("profile: switching locale re-renders the completed tables, not just the headers", async ({ page }) => {
  await mockProfile(page);
  await page.goto("/profile");

  // Loaded in English: pass value + certificate link are the en-GB strings.
  await expect(page.locator("#modulesBody")).toContainText("Pass");
  await expect(page.locator("#coursesBody")).toContainText("View certificate");

  // Switch to Norwegian bokmål.
  await page.selectOption("#localeSelect", "nb");

  // The dynamically built value cells must follow the new locale (no mixed-locale leftovers).
  await expect(page.locator("#modulesBody")).toContainText("Bestått");
  await expect(page.locator("#coursesBody")).toContainText("Vis bevis");
  await expect(page.locator("#modulesBody")).not.toContainText("Pass");
  await expect(page.locator("#coursesBody")).not.toContainText("View certificate");
});
