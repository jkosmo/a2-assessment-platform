import { test, expect, type Page, type Route } from "@playwright/test";

// #580 follow-up: browser e2e for the "My course certificates" section on /participant/completed.
// Runs the real participant-completed.js in Chromium against mocked APIs in mock-auth mode. Guards
// the client-layer bug this fixes: course certificates were only fetched when the user clicked the
// "load completed modules" button (which is about modules), so the certificates section showed the
// empty state on page open even when a completion existed. They must auto-load on page open.

async function mockConfig(page: Page) {
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
}

test("completed page: auto-loads course certificates on open (no button click)", async ({ page }) => {
  await mockConfig(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });

  let completionsFetched = false;
  await page.route("**/api/courses/completions", (route: Route) => {
    completionsFetched = true;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completions: [
          {
            courseId: "c1",
            certificateId: "cert-abc",
            completedAt: "2026-06-20T10:00:00.000Z",
            courseTitle: "Reading Course",
            certificationLevel: "basic",
          },
        ],
      }),
    });
  });

  await page.goto("/participant/completed");

  // The certificate renders WITHOUT clicking the "load completed modules" button.
  const certList = page.locator("#courseCertList");
  await expect(certList).toContainText("Reading Course");
  await expect(certList.locator('a[href="/certificate?id=cert-abc"]')).toBeVisible();
  expect(completionsFetched).toBe(true);
});

// #767: the «Mine kurs» sub-nav (Pågående | Fullførte) marks the active tab by pathname. On the
// completed page «Fullførte» must be active even though `/participant` is a prefix of the URL — the
// more specific path has to win. The page is also course-framed: H1 is "Completed" (not "Completed
// Modules"), and it leads with the course-certificates section.
test("completed page: mine-kurs sub-nav marks «Fullførte» active (specific path wins)", async ({ page }) => {
  await mockConfig(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await page.goto("/participant/completed");

  const subnav = page.locator("#mineKursSubnav");
  await expect(subnav).toBeVisible();
  await expect(subnav.locator("#subnavPagaende")).toHaveText("Ongoing");
  await expect(subnav.locator("#subnavFullforte")).toHaveText("Completed");
  await expect(subnav.locator("#subnavFullforte")).toHaveClass(/active/);
  await expect(subnav.locator("#subnavPagaende")).not.toHaveClass(/active/);

  // Course-framing: H1 dropped "Modules", and the certificates section leads the page.
  await expect(page.locator("h1")).toHaveText("Completed");
  const cert = page.locator("#courseCertSection");
  const modules = page.locator("#completedBody");
  const certY = (await cert.boundingBox())?.y ?? Infinity;
  const modulesY = (await modules.boundingBox())?.y ?? -Infinity;
  expect(certY).toBeLessThan(modulesY);
});

test("completed page: shows the empty state when there are no certificates", async ({ page }) => {
  await mockConfig(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await page.goto("/participant/completed");

  await expect(page.locator("#courseCertList")).toContainText(/No course certificates yet/i);
});
