import { test, expect, type Page, type Route } from "@playwright/test";

// #550: browser e2e for the printable course certificate view (/certificate). Runs the real
// certificate.js in Chromium against mocked APIs in mock-auth mode — covering the client-layer
// path: resolve identity, read ?id, fetch the completion, and render the certificate (or the
// not-found state). The certificate ID is shown as a code; this view turns it into a document.

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
}

test("certificate: renders the completion as a printable document", async ({ page }) => {
  await mockBase(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });

  await page.route("**/api/courses/completions/cert-1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        certificateId: "cert-1",
        courseId: "c1",
        courseTitle: "Labour Law",
        certificationLevel: "intermediate",
        completedAt: "2026-06-20T10:00:00.000Z",
        participantName: "Kari Nordmann",
        moduleCount: 3,
      }),
    }),
  );

  await page.goto("/certificate?id=cert-1");

  // The certificate card is shown (loading state hidden) with the completion details.
  await expect(page.locator("#certificate")).toBeVisible();
  await expect(page.locator("#certState")).toBeHidden();
  await expect(page.locator("#certName")).toHaveText("Kari Nordmann");
  await expect(page.locator("#certCourse")).toHaveText("Labour Law");
  await expect(page.locator("#certLevel")).toHaveText("Intermediate");
  await expect(page.locator("#certModules")).toHaveText("3");
  await expect(page.locator("#certId")).toHaveText("cert-1");

  // Print control is available (no-print in the printed output, visible on screen).
  await expect(page.locator("#printBtn")).toBeVisible();
});

test("certificate: shows a not-found state for someone else's / missing certificate", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/courses/completions/nope", (route: Route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) }),
  );

  await page.goto("/certificate?id=nope");

  await expect(page.locator("#certState")).toBeVisible();
  await expect(page.locator("#certState")).toHaveText(/not found|do not have access|don't have access/i);
  await expect(page.locator("#certificate")).toBeHidden();
});

test("certificate: shows a message when no id is supplied", async ({ page }) => {
  await mockBase(page);
  await page.goto("/certificate");
  await expect(page.locator("#certState")).toBeVisible();
  await expect(page.locator("#certState")).toHaveText(/no certificate was specified/i);
});
