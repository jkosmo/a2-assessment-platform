import { test, expect, type Page, type Route } from "@playwright/test";

// #836: the rebranded «Vurderingskvalitet» flate (was Kalibrering). Drives the real front-end JS against
// mocked module-library + calibration APIs: owner/course filters keep the list short, signals render as
// colour cards, the score histogram + client-side preview drive threshold-setting, and publishing sends
// the contextual thresholds and shows a LOCALISED toast (the old raw-i18n-key bug).

const MODULES = [
  { id: "mod-own", title: "Avvikshåndtering", status: "published", ownedByMe: true, courses: [{ id: "c1", title: "HMS-kurs" }] },
  { id: "mod-own-2", title: "Personvern", status: "published", ownedByMe: true, courses: [] },
  { id: "mod-other", title: "Andres modul", status: "published", ownedByMe: false, courses: [{ id: "c2", title: "Annet kurs" }] },
];

function snapshot(totalMin: number) {
  // 6 outcomes with scores 40,55,62,70,80,90 → at totalMin=60, four pass.
  const scores = [40, 55, 62, 70, 80, 90];
  return {
    module: { id: "mod-own", title: "Avvikshåndtering" },
    signals: {
      outcomeCount: scores.length,
      passRate: 0.67,
      manualReviewRate: 0.4,
      averageTotalScore: 66,
      benchmarkPromptTemplateCount: 2,
      coveredPromptTemplateCount: 1,
      benchmarkCoverageRate: 0.45,
      flags: [],
    },
    outcomes: scores.map((s, i) => ({
      submissionId: `s${i}`,
      submittedAt: "2026-07-19T00:00:00.000Z",
      submissionStatus: "COMPLETED",
      moduleVersionNo: 4,
      moduleVersionId: "v4",
      decision: { totalScore: s, passFailTotal: s >= totalMin },
      llm: { manualReviewRecommended: s < 60 },
    })),
    benchmarkAnchors: [],
    effectiveThresholds: { totalMin, mcqMinPercent: null, practicalMinPercent: null, source: "module_policy" },
  };
}

async function mockBase(page: Page, meRoles: string[]) {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { userId: "c1", email: "c@x.no", name: "C", roles: meRoles },
      calibrationWorkspace: { accessRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"], defaults: { maxRows: 120, statuses: ["COMPLETED", "UNDER_REVIEW"] }, signalThresholds: { passRateMinimum: 0.6, manualReviewRateMaximum: 0.35, benchmarkCoverageMinimum: 0.5 } },
    }) }));
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "e2e" }) }));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reviews: 0, appeals: 0 }) }));
  await page.route("**/api/me", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "c1", email: "c@x.no", name: "C", roles: meRoles }, consent: { accepted: true } }) }));
  await page.route("**/api/admin/content/modules/library**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: MODULES }) }));
  await page.route("**/api/admin/content/modules/*/export", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moduleExport: { versions: [{ id: "v4", versionNo: 4, publishedAt: "2026-07-19T00:00:00.000Z" }, { id: "v3", versionNo: 3, publishedAt: null }] } }) }));
}

test("vurderingskvalitet: owner filter, load, signals, histogram, preview, publish", async ({ page }) => {
  await mockBase(page, ["SUBJECT_MATTER_OWNER"]);
  let currentMin = 60;
  // Regex, not glob: a glob `workspace?**` would also match `/workspace/publish-thresholds` (`?` is a
  // wildcard). Match only the query form so the publish POST reaches its own handler.
  await page.route(/\/api\/calibration\/workspace\?/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot(currentMin)) }));
  let publishBody: any = null;
  await page.route("**/api/calibration/workspace/publish-thresholds", (route: Route) => {
    publishBody = JSON.parse(route.request().postData() ?? "{}");
    currentMin = publishBody.totalMin;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/admin-content/calibration");

  // Rebranded title + owner filter defaults to "Mine moduler" → 2 owned modules, not 3.
  await expect(page.locator("h1")).toHaveText("Vurderingskvalitet");
  await expect(page.locator("#qModuleCount")).toContainText("2");
  await expect(page.locator('#qOwnerSeg button[data-owner="mine"]')).toHaveClass(/on/);

  // Switch to "Alle" → all 3 modules.
  await page.locator('#qOwnerSeg button[data-owner="all"]').click();
  await expect(page.locator("#qModuleCount")).toContainText("3");
  await page.locator('#qOwnerSeg button[data-owner="mine"]').click();

  // Pick an owned module → version dropdown fills + "you own this" pill.
  await page.locator("#qModuleSelect").selectOption("mod-own");
  await expect(page.locator("#qOwnPill")).toBeVisible();
  await expect(page.locator("#qVersionSelect option")).toHaveCount(3); // "all" + v4 + v3

  // Load quality → signals cards, histogram bars, threshold + preview.
  await page.locator("#qLoad").click();
  await expect(page.locator("#qSignals .q-sig")).toHaveCount(3);
  await expect(page.locator("#qHistogram .bar")).toHaveCount(20);
  await expect(page.locator("#qPreview")).toContainText("60");
  await expect(page.locator("#qPreview")).toContainText("4"); // 4 of 6 pass at 60

  // Lower the threshold to 50 → preview recomputes (5 of 6 pass) with a delta.
  await page.locator("#qTotalMin").fill("50");
  await page.locator("#qTotalMin").dispatchEvent("input");
  await expect(page.locator("#qPreview")).toContainText("5");
  await expect(page.locator("#qPreview .delta")).toBeVisible();

  // Publish → confirm dialog → localised toast (NOT a raw i18n key).
  page.once("dialog", (d) => d.accept());
  await page.locator("#qPublish").click();
  await expect(page.locator(".toast, #toast, [role='status']").first()).toContainText(/publisert/i);
  expect(publishBody.totalMin).toBe(50);
  expect(publishBody.moduleId).toBe("mod-own");
});

test("vurderingskvalitet: no access shows the access-denied state", async ({ page }) => {
  await mockBase(page, ["CANDIDATE"]);
  await page.goto("/admin-content/calibration");
  await expect(page.locator(".access-denied-title")).toBeVisible();
  await expect(page.locator("#qModuleSelect")).toHaveCount(0);
});

// QA r5 #4: for MCQ_ONLY modules pass/fail is decided by the MCQ percentage — totalScore is the MCQ
// score scaled into its weighting band, so the total-score histogram/threshold view is misleading.
// The card must swap to the MCQ-minimum rule and publish must keep totalMin unchanged.
test("vurderingskvalitet: MCQ-only module shows the MCQ rule instead of the total histogram", async ({ page }) => {
  await mockBase(page, ["SUBJECT_MATTER_OWNER"]);
  // Override the export: active version is MCQ_ONLY.
  await page.route("**/api/admin/content/modules/*/export", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moduleExport: {
      module: { activeVersionId: "v4" },
      versions: [{ id: "v4", versionNo: 4, publishedAt: "2026-07-19T00:00:00.000Z", assessmentMode: "MCQ_ONLY" }],
    } }) }));
  await page.route(/\/api\/calibration\/workspace\?/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot(60)) }));
  let publishBody: any = null;
  await page.route("**/api/calibration/workspace/publish-thresholds", (route: Route) => {
    publishBody = JSON.parse(route.request().postData() ?? "{}");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/admin-content/calibration");
  await page.locator("#qModuleSelect").selectOption("mod-own");
  await page.locator("#qLoad").click();

  // Distribution/total hidden; MCQ rule shown with the explanatory note.
  await expect(page.locator("#qModeNote")).toBeVisible();
  await expect(page.locator("#qDistBlock")).toBeHidden();
  await expect(page.locator("#qMcqField")).toBeVisible();
  await expect(page.locator("#qTotalMin")).toBeHidden();

  // Publish keeps totalMin at the effective value and sends the edited MCQ minimum.
  await page.locator("#qMcqMin").fill("80");
  page.once("dialog", (d) => d.accept());
  await page.locator("#qPublish").click();
  await expect(page.locator(".toast, #toast, [role='status']").first()).toContainText(/publisert/i);
  expect(publishBody.totalMin).toBe(60);
  expect(publishBody.mcqMinPercent).toBe(80);
});
