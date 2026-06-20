import { test, expect, type Page, type Route } from "@playwright/test";

// Browser e2e for the participant course → section reader flow (#476/#492/#483). Runs the REAL
// participant.js in Chromium against mocked APIs in mock-auth mode — covering the client-layer
// path manual testing exercised: load courses, expand a course, open a section, render an
// asset-backed image (hydrated with auth headers), and "mark as read". This is the flow whose
// bugs (#542 dropped headers, image auth) were invisible to supertest.

const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function mockParticipant(page: Page) {
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
}

test("participant: open a course section, render its image, and mark it read", async ({ page }) => {
  await mockParticipant(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  // Course detail: a mixed sequence containing one SECTION (#491).
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ course: { id: "c1", title: "Kurs", items: [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false }] } }),
    }),
  );
  // Section content: server-rendered, sanitised HTML referencing a private asset image.
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: "Seksjon", html: '<p>Innhold</p><img src="/api/content-assets/a1" alt="bilde">' }),
    }),
  );
  // The asset image is fetched with auth headers and swapped to an object URL (hydration).
  await page.route("**/api/content-assets/a1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG }),
  );
  let markReadCalled = false;
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
    markReadCalled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/participant");

  // #541: the load button is disabled until the identity form is populated, then enabled.
  const loadBtn = page.locator("#loadCoursesBtn");
  await expect(loadBtn).toBeEnabled();
  await loadBtn.click();

  // Expand the course → loads detail → renders the section row.
  await page.locator(".course-accordion-header").click();
  const sectionRow = page.locator(".course-module-row");
  await expect(sectionRow).toBeVisible();
  await sectionRow.click();

  // The reader overlay opens with the section title and body.
  await expect(page.locator("#sectionReaderTitle")).toHaveText("Seksjon");
  await expect(page.locator("#sectionReaderBody")).toContainText("Innhold");

  // The asset image hydrates to a blob: URL (not the raw /api/content-assets path that would 401).
  const img = page.locator("#sectionReaderBody img");
  await expect(img).toHaveCount(1);
  await expect.poll(async () => (await img.getAttribute("src")) ?? "").toMatch(/^blob:/);

  // Mark as read fires the POST and updates the button.
  await page.locator("#sectionReaderMarkRead").click();
  await expect.poll(() => markReadCalled).toBe(true);
  await expect(page.locator("#sectionReaderMarkRead")).not.toBeEnabled();
});
