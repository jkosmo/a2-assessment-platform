import { test, expect, type Page, type Route } from "@playwright/test";

// 2.134.1, tilbakemelding fra en deltaker: «Så står det fortsatt "ikke startet" på testen etter innlevering.» Kursdetaljene i minnet ble
// bare hentet på nytt etter en bestått. Kjører den ekte participant.js mot falske API-er, der serveren fortsatt svarer det den svarte da
// kurset ble åpnet, så testen måler det siden selv gjør.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mock(page: Page, assessmentMode: "MCQ_ONLY" | "FREETEXT_ONLY") {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: { autoStartAfterMcq: false },
      output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Kurset", description: null, moduleCount: 1, progress: { completed: 0, total: 1, moduleCompleted: 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: "NOT_STARTED" } }] })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/enrollments", (route: Route) => route.fulfill(json({ enrollments: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Kurset", items: [{ type: "MODULE", moduleId: "m-1", courseItemId: "i-1", sortOrder: 0, title: "Modulen", moduleStatus: "NOT_STARTED", available: true, required: true, discussionsEnabled: false }] } })),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill(json({ modules: [{ id: "m-1", title: "Modulen", description: null, assessmentMode, submissionSchema: null, assessmentPolicy: null, taskText: assessmentMode === "MCQ_ONLY" ? null : "Skriv et essay", activeVersion: { id: "mv-1", versionNo: 1 }, participantStatus: null }] })),
  );
  await page.route("**/api/submissions", (route: Route) => route.fulfill(json({ submission: { id: "s-1", submissionStatus: "SUBMITTED" } }, 201)));
  await page.route("**/api/assessments/*/run", (route: Route) => route.fulfill(json({ ok: true })));
  await page.route("**/api/submissions/*/result", (route: Route) => route.fulfill(json({ status: "PROCESSING" })));
  await page.route("**/api/modules/*/mcq/start**", (route: Route) =>
    route.fulfill(json({ attemptId: "a1", questions: [{ id: "q1", stem: "Spørsmålet", options: ["A", "B"] }] })),
  );
}

async function openCourse(page: Page) {
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  const row = page.locator(".course-module-row").first();
  await expect(row).toContainText("Ikke startet");
  await expect(page.locator(".course-accordion-header .module-status-badge").first()).toContainText("Ikke startet");
  return row;
}

test("fritekst: etter innleveringen står modulen og kurset som «Påbegynt», og kursdetaljen er ikke tegnet på nytt", async ({ page }) => {
  await mock(page, "FREETEXT_ONLY");
  const row = await openCourse(page);
  await row.click();
  const field = page.locator("#submissionFields textarea").first();
  await expect(field).toBeVisible();
  for (const ta of await page.locator("#submissionFields textarea").all()) await ta.fill("Et tilstrekkelig langt fritekstsvar for vurdering.");

  // Merket står bare så lenge raden ikke tegnes på nytt. Å tegne kursdetaljen på nytt ville slettet en usendt tekst i kursdiskusjonen.
  await page.locator(".course-item").first().evaluate((el) => { (el as HTMLElement).dataset.urort = "ja"; });
  await page.locator("#createSubmission").click();

  await expect(page.locator(".course-module-row").first()).toContainText("Påbegynt");
  await expect(page.locator(".course-module-row").first()).not.toContainText("Ikke startet");
  await expect(page.locator(".course-accordion-header .module-status-badge").first()).toContainText("Påbegynt");
  await expect(page.locator(".course-item[data-urort='ja']")).toHaveCount(1);
});

test("flervalg: innleveringen kommer med en gang modulen åpnes, og spørsmålene står urørt", async ({ page }) => {
  await mock(page, "MCQ_ONLY");
  const row = await openCourse(page);
  await row.click();
  await expect(page.locator(".mcq-question-card")).toContainText("Spørsmålet");
  await expect(page.locator(".course-module-row").first()).toContainText("Påbegynt");
  await expect(page.locator(".course-accordion-header .module-status-badge").first()).toContainText("Påbegynt");
  await expect(page.locator(".mcq-question-card")).toContainText("Spørsmålet");
});
