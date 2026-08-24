import { test, expect, type Page, type Route } from "@playwright/test";

// #978: samme innlevering, to flater, to svar.
//
// ⚠️ Scenariet fra saken: en modul med `passFailTotal: false` mens innleveringen fortsatt er
// UNDER_REVIEW. /profile og /participant/completed hadde hver sin tri-state-mapping som IGNORERTE
// statusen, og viste rød «Ikke bestått». Resultatbanneret i participant.js — den ene varianten som
// leste statusen — holdt den nøytral. Samme deltaker, samme økt, to svar.
//
// En unit-test på `deriveOutcome` fanger ikke dette: feilen var at flatene aldri SPURTE. Derfor
// kjøres den ekte bundlen i Chromium her.
//
// Hver blokkering har en makker: kontrollcaset bekrefter at en AVGJORT stryk fortsatt vises rød.
// Uten den ville testen bestått av at cellen var tom uansett.

const UNDER_REVIEW_MODULE = {
  moduleId: "m-review",
  moduleTitle: "Module under review",
  latestSubmissionId: "s-review",
  latestCompletedAt: "2026-06-20T10:00:00.000Z",
  latestStatus: "UNDER_REVIEW",
  latestDecision: { passFailTotal: false, totalScore: 41 },
};

const SETTLED_FAIL_MODULE = {
  moduleId: "m-failed",
  moduleTitle: "Module settled as failed",
  latestSubmissionId: "s-failed",
  latestCompletedAt: "2026-06-21T10:00:00.000Z",
  latestStatus: "COMPLETED",
  latestDecision: { passFailTotal: false, totalScore: 33 },
};

async function mockProfile(page: Page, modules: unknown[]) {
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
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  await page.route("**/api/modules/completed**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules }) }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* ignore */ }
  });
});

test("#978 /profile: en stryk UNDER VURDERING vises ikke som stryk", async ({ page }) => {
  await mockProfile(page, [UNDER_REVIEW_MODULE]);
  await page.goto("/profile");

  const row = page.locator("#modulesBody tr").first();
  await expect(row).toContainText("Module under review");

  // Verdien er ikke avgjort, så den skal verken si «Fail» eller males rød.
  await expect(row).not.toContainText("Fail");
  await expect(row.locator(".outcome--fail")).toHaveCount(0);
});

test("#978 KONTROLLCASE /profile: en AVGJORT stryk vises fortsatt som stryk", async ({ page }) => {
  // ⚠️ Uten denne ville testen over bestått selv om cellen aldri fikk innhold i det hele tatt.
  await mockProfile(page, [SETTLED_FAIL_MODULE]);
  await page.goto("/profile");

  const row = page.locator("#modulesBody tr").first();
  await expect(row).toContainText("Module settled as failed");
  await expect(row).toContainText("Fail");
  await expect(row.locator(".outcome--fail")).toHaveCount(1);
});

test("#978 begge radene samtidig — flaten skiller dem, den maler ikke alt likt", async ({ page }) => {
  await mockProfile(page, [UNDER_REVIEW_MODULE, SETTLED_FAIL_MODULE]);
  await page.goto("/profile");

  const rows = page.locator("#modulesBody tr");
  await expect(rows).toHaveCount(2);
  // Nøyaktig én av de to er rød. Det er hele funnet i #978, målt i én assertion.
  await expect(page.locator("#modulesBody .outcome--fail")).toHaveCount(1);
});
