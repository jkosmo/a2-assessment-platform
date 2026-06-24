import { test, expect, type Page, type Route } from "@playwright/test";

// #630: guard for the FOURTH course-certificate surface (Feature Surface Map §6) — the result
// banner in the participant course accordion (public/participant.js). The other three surfaces
// (/certificate, /participant/completed, /profile) have e2e guards; this one had none. The bug class
// it protects against is exactly the one #627 fixed elsewhere: certificates fetched but not surfaced
// on render. The banner's completion data comes from `/api/courses` + `/api/courses/completions`
// loaded together when the course list is loaded — if a refactor breaks that, the banner silently
// vanishes. Runs the real participant.js in mock-auth mode against mocked APIs.

async function mockBase(page: Page) {
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
      body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [] }) }),
  );
}

test("participant: a completed course shows the certificate banner with a link to the printable view", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          {
            id: "c1",
            title: "Labour Law",
            description: "",
            moduleCount: 1,
            progress: { completed: 1, total: 1, courseStatus: "COMPLETED" },
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
          {
            courseId: "c1",
            certificateId: "cert-xyz",
            completedAt: "2026-06-20T10:00:00.000Z",
            courseTitle: "Labour Law",
            certificationLevel: "basic",
          },
        ],
      }),
    }),
  );

  await page.goto("/participant");
  await page.locator("#loadCoursesBtn").click();

  // The banner is rendered for the completed course (it would be ABSENT if completions weren't
  // loaded — the regression this guards). It lives in the collapsed accordion body, so assert it
  // exists in the DOM with the correct printable-certificate link first…
  const banner = page.locator(".course-certificate-banner");
  await expect(banner).toHaveCount(1);
  await expect(banner.locator('a[href="/certificate?id=cert-xyz"]')).toHaveCount(1);

  // …then expand the course and assert the link is actually visible/clickable.
  await page.locator(".course-accordion-header").first().click();
  await expect(banner.locator('a[href="/certificate?id=cert-xyz"]')).toBeVisible();
});

test("participant: a course with no certificate shows no banner", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          {
            id: "c2",
            title: "In Progress Course",
            description: "",
            moduleCount: 2,
            progress: { completed: 1, total: 2, courseStatus: "IN_PROGRESS" },
          },
        ],
      }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await page.goto("/participant");
  await page.locator("#loadCoursesBtn").click();

  // The course renders, but with no completion there must be no certificate banner.
  await expect(page.locator(".course-accordion-item")).toHaveCount(1);
  await expect(page.locator(".course-certificate-banner")).toHaveCount(0);
});
