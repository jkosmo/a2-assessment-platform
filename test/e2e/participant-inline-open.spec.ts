import { test, expect, type Page, type Route } from "@playwright/test";

// #865 browser e2e: sections AND modules must open the SAME way — inline, in-place under their row in
// the course accordion (no modal overlay, no far-below workspace), one item open at a time. Runs the
// real participant.js in Chromium against mocked APIs (client-layer behaviour invisible to supertest).

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
}

test("participant: section and module both open inline in-place; only one open at a time", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 2, courseStatus: "NOT_STARTED" } }] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  // A mixed sequence: one SECTION followed by one MODULE.
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        course: {
          id: "c1", title: "Kurs", items: [
            { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: "Seksjon", read: false },
            { type: "MODULE", moduleId: "m1", courseItemId: "ci2", title: "Modul", moduleStatus: "NOT_STARTED", available: true },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Seksjon", html: "<p>Seksjonstekst</p>" }) }),
  );
  // The module workspace needs the module in the participant module list.
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m1", title: "Modul", description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Oppgave", activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    }),
  );

  await page.goto("/participant");
  await expect(page.locator("#loadCoursesBtn")).toBeEnabled();
  await page.locator("#loadCoursesBtn").click();
  await page.locator(".course-accordion-header").click();

  const sectionItem = page.locator('.course-item[data-type="SECTION"]');
  const moduleItem = page.locator('.course-item[data-type="MODULE"]');
  await expect(sectionItem.locator(".course-module-row")).toBeVisible();
  await expect(moduleItem.locator(".course-module-row")).toBeVisible();

  // Open the SECTION → its content renders inline in-place under its row (no modal).
  await sectionItem.locator(".course-module-row").click();
  await expect(page.locator("#sectionReaderOverlay")).toHaveCount(0);
  await expect(sectionItem.locator(".course-inline-panel")).toBeVisible();
  await expect(sectionItem.locator("#sectionReaderBody")).toContainText("Seksjonstekst");

  // Open the MODULE → the workspace relocates INLINE under the module row (in-place, same pattern),
  // and the section panel collapses (one open at a time).
  await moduleItem.locator(".course-module-row").click();
  await expect(moduleItem.locator(".course-inline-panel #submissionSection")).toBeVisible();
  await expect(page.locator("#sectionReaderBody")).toHaveCount(0); // section collapsed

  // The relocated workspace is a descendant of the module's inline panel, not a far-below sibling.
  await expect(moduleItem.locator('.course-inline-panel #moduleWorkspace')).toHaveCount(1);
});
