import { test, expect, type Page, type Route } from "@playwright/test";

// #1145: et kursbevis registrert av administrator for et kurs tatt utenfor plattformen har ingen kjent dato. Overalt der det vises,
// står «Tatt utenfor plattformen» i stedet for en dato: kursbeviset (som «Status», ikke «Fullført»), «Beståtte kurs» på profilen,
// og kursrapporten (ved statusen, i tabellen og i fila). Et vanlig bevis ved siden av viser datoen som før.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockBase(page: Page, identity: Record<string, unknown>) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: identity,
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
}

test("kursbeviset: «Status: Tatt utenfor plattformen», ingen dato", async ({ page }) => {
  await mockBase(page, { participant: { userId: "p-1", email: "kari@example.com", name: "Kari", department: "X", roles: ["PARTICIPANT"] } });
  await page.route("**/api/courses/completions/cert-ute", (r: Route) => r.fulfill(json({
    certificateId: "cert-ute",
    courseId: "c1",
    courseTitle: "Repetisjon kurs 1 – Møtearbeid",
    certificationLevel: "basic",
    completedAt: null,
    source: "external",
    participantName: "Kari Nordmann",
    moduleCount: 0,
    versionMajor: 1,
    versionMinor: 0,
    current: true,
  })));
  await page.goto("/certificate?id=cert-ute");
  await expect(page.locator("#certificate")).toBeVisible();
  await expect(page.locator("#certCompletedAtLabel")).toHaveText("Status");
  await expect(page.locator("#certCompletedAt")).toHaveText("Tatt utenfor plattformen");
  await expect(page.locator("#certModulesWrap")).toBeHidden();
});

test("kursbeviset: et vanlig bevis har fortsatt «Fullført» og datoen", async ({ page }) => {
  await mockBase(page, { participant: { userId: "p-1", email: "kari@example.com", name: "Kari", department: "X", roles: ["PARTICIPANT"] } });
  await page.route("**/api/courses/completions/cert-1", (r: Route) => r.fulfill(json({
    certificateId: "cert-1", courseId: "c1", courseTitle: "Kurs", certificationLevel: "basic",
    completedAt: "2026-06-20T10:00:00.000Z", source: "platform", participantName: "Kari", moduleCount: 2,
  })));
  await page.goto("/certificate?id=cert-1");
  await expect(page.locator("#certCompletedAtLabel")).toHaveText("Fullført");
  await expect(page.locator("#certCompletedAt")).toHaveText("20. juni 2026");
});

test("profilen, «Beståtte kurs»: «Tatt utenfor plattformen» i datokolonnen; det vanlige beviset har dato", async ({ page }) => {
  await mockBase(page, { participant: { userId: "p-1", email: "kari@example.com", name: "Kari", department: "X", roles: ["PARTICIPANT"] } });
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "p-1", name: "Kari Nordmann", email: "kari@example.com", department: "X", roles: ["PARTICIPANT"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/me/stats", (r: Route) => r.fulfill(json({
    generatedAt: "2026-11-10T08:00:00.000Z", mood: "ny", lastActivityAt: null, weeks: [], recent: { weeks: 4, sectionsRead: 0, modulesPassed: 0, coursesCompleted: 0, readingMinutes: 0 },
    totals: { coursesCompleted: 2, modulesPassed: 0, sectionsRead: 0 }, passedModules: [],
  })));
  await page.route("**/api/courses/completions", (r: Route) => r.fulfill(json({ completions: [
    { courseId: "c1", certificateId: "cert-ute", completedAt: null, source: "external", courseTitle: "Repetisjon kurs 1 – Møtearbeid", certificationLevel: "basic", versionMajor: 1, current: true },
    { courseId: "c2", certificateId: "cert-1", completedAt: "2026-06-20T10:00:00.000Z", source: "platform", courseTitle: "Vanlig kurs", certificationLevel: "basic", versionMajor: 1, current: true },
  ] })));
  await page.goto("/profile");
  await page.getByRole("tab", { name: /Beståtte kurs/ }).click();
  const rows = page.locator("#coursesBody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Tatt utenfor plattformen");
  await expect(rows.nth(1)).not.toContainText("Tatt utenfor plattformen");
  await expect(rows.nth(1)).toContainText("2026");
});

test("kursrapporten: statusen merkes, og det står ingen siste aktivitet", async ({ page }) => {
  await mockBase(page, { reportReader: { userId: "rep", email: "r@x.no", name: "Leser", roles: ["REPORT_READER"] } });
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { id: "rep", roles: ["REPORT_READER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/reports/pass-rates**", (r: Route) => r.fulfill(json({ rows: [] })));
  await page.route("**/api/reports/completion**", (r: Route) => r.fulfill(json({ rows: [] })));
  await page.route("**/api/reports/courses**", (r: Route) => r.fulfill(json({ rows: [
    { courseId: "a", courseTitle: "Repetisjon kurs 1", enrolledParticipants: 2, completedParticipants: 2, completionRate: 1, moduleBreakdown: [] },
  ] })));
  await page.route("**/api/reports/courses/details**", (r: Route) => r.fulfill(json({ rows: [
    { participantId: "u1", participantName: "Ute Person", participantEmail: "ute@example.com", participantDepartment: null, status: "COMPLETED", completionSource: "external",
      completedModules: 0, totalModules: 1, readSections: 0, totalSections: 2, score: null, latestActivityAt: null, completedAt: null },
    { participantId: "u2", participantName: "Plattform Person", participantEmail: "pl@example.com", participantDepartment: null, status: "COMPLETED", completionSource: "platform",
      completedModules: 1, totalModules: 1, readSections: 2, totalSections: 2, score: 90, latestActivityAt: "2026-11-07T07:12:00.000Z", completedAt: "2026-11-07T07:12:00.000Z" },
  ] })));
  await page.goto("/results");
  await page.locator("#courseReportBody tr").first().click();
  const rows = page.locator("#courseLearnerBody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("td").nth(3)).toHaveText("Fullført (Tatt utenfor plattformen)");
  await expect(rows.nth(1).locator("td").nth(3)).toHaveText("Fullført");
  await expect(rows.nth(0).locator("td").nth(7)).not.toContainText("2026");
});
