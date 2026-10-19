import { test, expect, type Route } from "@playwright/test";

// «Fullføring per modul» teller personer, ikke forsøk (produkteier 2026-10-19). Klientens del: hodet
// sier «Deltakere», og en ny siste kolonne «Forsøk» viser alle forsøk — i riktig kolonne, siden
// cellene legges ut i rekkefølge og ikke etter navn. Tallene selv er målt mot Postgres i
// test/completion-per-person.test.ts.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test("Resultater: «Deltakere» og «Forsøk» står over riktige tall", async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { reportReader: { userId: "rep", email: "r@x.no", name: "Leser", roles: ["REPORT_READER"] } },
    calibrationWorkspace: { accessRoles: [] },
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "rep", roles: ["REPORT_READER"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
  // Tallene fra skjermbildet, etter endringen: fem personer, én av dem strøk og tok modulen på nytt.
  await page.route("**/api/reports/pass-rates**", (r: Route) => r.fulfill(json({ rows: [
    { moduleId: "m-1", moduleTitle: "Referatskriving", totalSubmissions: 5, decisionCount: 4, passCount: 4, failCount: 0, underReviewCount: 1, passRate: 1 },
  ] })));
  await page.route("**/api/reports/completion**", (r: Route) => r.fulfill(json({ rows: [
    { moduleId: "m-1", moduleTitle: "Referatskriving", totalSubmissions: 5, completedSubmissions: 4, underReviewSubmissions: 1, completionRate: 0.8, attempts: 6 },
  ] })));
  await page.route("**/api/reports/courses**", (r: Route) => r.fulfill(json({ rows: [] })));
  await page.route("**/api/reports/participants**", (r: Route) => r.fulfill(json({ rows: [] })));

  await page.goto("/results");
  const row = page.locator("#completionBody tr").first();
  await expect(row).toContainText("Referatskriving");

  const headers = (await page.locator("#completionBody").locator("xpath=ancestor::table").locator("thead th").allTextContents()).map((h) => h.trim());
  const cells = (await row.locator("td").allTextContents()).map((c) => c.trim());
  expect(headers).toHaveLength(cells.length);
  const under = (header: string) => cells[headers.indexOf(header)];
  expect(headers).not.toContain("Totalt");
  expect(under("Deltakere")).toBe("5");
  expect(under("Bestått")).toBe("4");
  expect(under("Ikke bestått")).toBe("0");
  expect(under("Forsøk")).toBe("6");

  // Nøkkeltallet teller nå personer med et avgjort siste forsøk.
  await expect(page.locator("#resultsKpi")).toContainText("vurderte");
});
