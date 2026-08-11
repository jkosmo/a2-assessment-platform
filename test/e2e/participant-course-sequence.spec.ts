import { test, expect, type Page, type Route } from "@playwright/test";

// Browser e2e for the serial course sequence in the participant console.
//
// The course IS serial, but the old list rendered every step as an equally heavy button — the
// participant feedback was "uoversiktlig ... for høy frihetsgrad". The sequence now renders as one
// spine with a single focal point: the next incomplete step is a card with an action, completed
// steps collapse to one line, later steps are quiet titles.
//
// Two invariants this guards, both invisible to supertest:
//   1. Exactly ONE step is presented as the current one, and it is the first incomplete entry.
//   2. Reading material and tests are distinguishable — kind label in text, marker shape in CSS.
//
// Deliberately NOT asserted as locked: later steps stay clickable. This is a presentation change
// only; `available` means "published", not "unlocked", and no backend gating was introduced.

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
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { id: "c1", title: "Kurs", description: null, moduleCount: 3, progress: { completed: 2, total: 5, moduleCompleted: 1, moduleTotal: 3, sectionCompleted: 1, sectionTotal: 2, courseStatus: "IN_PROGRESS" } },
        ],
      }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  // Two done, then the next incomplete (a section), then a future module, then an unavailable one.
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        course: {
          id: "c1",
          title: "Kurs",
          items: [
            { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: "Lest seksjon", read: true },
            { type: "MODULE", moduleId: "m1", courseItemId: "ci2", title: "Bestått test", moduleStatus: "PASSED", available: true },
            { type: "SECTION", sectionId: "s2", courseItemId: "ci3", title: "Neste seksjon", read: false },
            { type: "MODULE", moduleId: "m2", courseItemId: "ci4", title: "Senere test", moduleStatus: "NOT_STARTED", available: true },
            { type: "MODULE", moduleId: "m3", courseItemId: "ci5", title: "Utilgjengelig test", moduleStatus: "NOT_STARTED", available: false },
          ],
        },
      }),
    }),
  );
}

async function openCourse(page: Page) {
  await page.goto("/participant");
  await expect(page.locator("#loadCoursesBtn")).toBeEnabled();
  await page.locator("#loadCoursesBtn").click();
  await page.locator(".course-accordion-header").click();
  await expect(page.locator(".course-sequence")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
});

test("exactly one step is current, and it is the first incomplete entry", async ({ page }) => {
  await mockBase(page);
  await openCourse(page);

  // One focal point — not five equally weighted buttons.
  await expect(page.locator(".course-step--now")).toHaveCount(1);

  const now = page.locator('.course-item[data-key="ci3"]');
  await expect(now).toHaveClass(/is-now/);
  await expect(now.locator(".course-step--now")).toBeVisible();
  await expect(now.locator(".course-step-title")).toHaveText("Neste seksjon");
  // Position is spelled out, so the participant knows where in the sequence they are.
  await expect(now.locator(".course-step-position")).toContainText("Steg 3 av 5");
  await expect(now.locator(".course-step-cta")).toHaveText("Les");

  // Completed steps collapse to one quiet line each.
  await expect(page.locator(".course-step--done")).toHaveCount(2);
  await expect(page.locator('.course-item[data-key="ci1"]')).toHaveClass(/is-done/);
  await expect(page.locator('.course-item[data-key="ci2"] .module-status-badge')).toHaveText("Bestått");

  // Later steps are present but quiet — visible scope without an invitation.
  await expect(page.locator(".course-step--ahead")).toHaveCount(2);

  // #492's separate "Fortsett der du slapp" button is gone: it was a duplicate entry point to
  // exactly the step the card now IS, and duplicate entry points were half the complaint.
  await expect(page.locator(".course-resume-btn")).toHaveCount(0);
});

test("reading material and tests are distinguishable at a glance", async ({ page }) => {
  await mockBase(page);
  await openCourse(page);

  // Kind is carried in text, not only in the marker shape (the shape alone is inaccessible).
  await expect(page.locator('.course-item[data-key="ci1"] .course-step-kind')).toHaveText("Lesestoff");
  await expect(page.locator('.course-item[data-key="ci2"] .course-step-kind')).toHaveText("Test");
  await expect(page.locator('.course-item[data-key="ci4"] .course-step-kind')).toHaveText("Test");

  // A legend is mandatory: a diamond means nothing to someone who was never told.
  await expect(page.locator(".course-sequence-legend")).toBeVisible();
  await expect(page.locator(".course-sequence-legend")).toContainText("Lesestoff");
  await expect(page.locator(".course-sequence-legend")).toContainText("Test");

  // The marker shape differs: sections stay round, modules are rotated squares.
  const sectionRadius = await page.locator('.course-item[data-key="ci1"] .course-step-mark')
    .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  const moduleTransform = await page.locator('.course-item[data-key="ci2"] .course-step-mark')
    .evaluate((el) => getComputedStyle(el).transform);
  expect(sectionRadius).toBe("50%");
  expect(moduleTransform).not.toBe("none"); // rotate(45deg) → a matrix

  // Status colour must not be the channel that carries type — a passed module and a read section
  // share the same "completed" badge class.
  await expect(page.locator('.course-item[data-key="ci1"] .module-status-badge')).toHaveClass(/completed/);
  await expect(page.locator('.course-item[data-key="ci2"] .module-status-badge')).toHaveClass(/completed/);
});

test("an unavailable module is not a dead end, and the current step still opens inline", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/courses/c1/sections/s2", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Neste seksjon", html: "<p>Seksjonstekst</p>" }) }),
  );
  await openCourse(page);

  // #502-followup: unpublished content is visibly inert rather than a click that fails.
  await expect(page.locator('.course-item[data-key="ci5"] .course-module-row')).toBeDisabled();
  await expect(page.locator('.course-item[data-key="ci5"] .module-status-badge')).toHaveText("Ikke tilgjengelig");

  // The card opens the step inline, in place (#865 model preserved through the redesign).
  await page.locator('.course-item[data-key="ci3"] .course-module-row').click();
  await expect(page.locator('.course-item[data-key="ci3"] .course-inline-panel')).toBeVisible();
  await expect(page.locator("#sectionReaderBody")).toContainText("Seksjonstekst");
});
