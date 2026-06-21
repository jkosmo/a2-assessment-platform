import { test, expect, type Page, type Route } from "@playwright/test";

// #525 participant UI: an MCQ-only module must skip the free-text submission step — no answer
// fields, no acknowledgement — while a normal free-text module still renders them. Runs the real
// participant.js in mock-auth mode against mocked APIs (client-layer behavior invisible to supertest).

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
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m-mcq", title: "MCQ Modul", description: null, assessmentMode: "MCQ_ONLY", submissionSchema: null, assessmentPolicy: null, taskText: null, activeVersion: { versionNo: 1 }, participantStatus: null },
          { id: "m-ft", title: "Fritekst Modul", description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Skriv et svar", activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    }),
  );
}

test("participant: MCQ-only module hides the free-text step; free-text module keeps it", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.goto("/participant");
  await page.locator("#loadModules").click();

  // Select the MCQ-only module → no free-text textarea, the MCQ-only note is shown, ack hidden.
  await page.locator(".module-card", { hasText: "MCQ Modul" }).click();
  await expect(page.locator("#submissionFields textarea")).toHaveCount(0);
  await expect(page.locator("#submissionFields")).toContainText("flervalgsspørsmål");
  await expect(page.locator("#ack")).toBeHidden();

  // Switch to the free-text module → the answer textarea + acknowledgement come back.
  // (Selecting a module collapses the list, so re-expand it first.)
  await page.locator("#loadModules").click();
  await page.locator(".module-card", { hasText: "Fritekst Modul" }).click();
  await expect(page.locator("#submissionFields textarea")).not.toHaveCount(0);
  await expect(page.locator("#ack")).toBeVisible();
});
