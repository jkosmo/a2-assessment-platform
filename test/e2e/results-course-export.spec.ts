import { readFileSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";

// Resultater: lista over deltakere i ett kurs kan lastes ned som en fil for Excel (produkteier 2026-11-07).
// Sorteringen er serverens og måles i test/unit/course-report-audience-969.test.ts. Her: fila er det tabellen viser.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test.use({ timezoneId: "Europe/Oslo" });

const learner = (over: Record<string, unknown>) => ({
  participantId: "u",
  participantName: "Ola Nordmann",
  participantEmail: "ola@example.com",
  participantDepartment: null,
  status: "COMPLETED",
  completedModules: 3,
  totalModules: 4,
  readSections: 2,
  totalSections: 2,
  score: 82.5,
  latestActivityAt: "2026-11-07T07:12:00.000Z",
  ...over,
});

const COURSE_ROWS = [
  { courseId: "a", courseTitle: "Kurs A", enrolledParticipants: 3, completedParticipants: 1, completionRate: 0.33, moduleBreakdown: [] },
  { courseId: "b", courseTitle: "Kurs: B/C", enrolledParticipants: 1, completedParticipants: 0, completionRate: 0, moduleBreakdown: [] },
];

async function mockResults(page: Page, details: (courseId: string) => Promise<unknown[]> | unknown[]) {
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
  await page.route("**/api/me", (r: Route) => r.fulfill(json({ user: { id: "rep", roles: ["REPORT_READER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/reports/pass-rates**", (r: Route) => r.fulfill(json({ rows: [] })));
  await page.route("**/api/reports/completion**", (r: Route) => r.fulfill(json({ rows: [] })));
  await page.route("**/api/reports/courses**", (r: Route) => r.fulfill(json({ rows: COURSE_ROWS })));
  await page.route("**/api/reports/courses/details**", async (r: Route) => {
    const courseId = new URL(r.request().url()).searchParams.get("selectedCourseId") ?? "";
    const rows = await details(courseId);
    await r.fulfill(json({ rows }));
  });
}

async function download(page: Page) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator("#exportCourseView").click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test.describe("Resultater: eksport av deltakerne i ett kurs", () => {
  test("knappen vises først når et kurs er valgt og har deltakere", async ({ page }) => {
    await mockResults(page, (courseId) => (courseId === "a" ? [learner({})] : []));
    await page.goto("/results");
    await expect(page.locator("#courseReportBody tr")).toHaveCount(2);
    await expect(page.locator("#exportCourseView")).toBeHidden();

    await page.locator("#courseReportBody tr").first().click();
    await expect(page.locator("#exportCourseView")).toBeVisible();
    await expect(page.locator("#exportCourseView")).toHaveText("Eksporter denne listen (CSV)");

    await page.locator("#courseReportBody tr").nth(1).click();
    await expect(page.locator("#exportCourseView")).toBeHidden();
  });

  test("fila er tabellen: samme rekkefølge, norske overskrifter, klar for Excel", async ({ page }) => {
    await mockResults(page, () => [
      learner({}),
      learner({ participantName: "=SUM(A1)", participantEmail: "kari@example.com", participantDepartment: "Drift; Nord", status: "IN_PROGRESS", score: null }),
      learner({ participantName: "Per \"Sjef\" Hansen", participantEmail: "per@example.com", status: "NOT_STARTED", completedModules: 0, readSections: 0, score: null, latestActivityAt: null }),
    ]);
    await page.goto("/results");
    await page.locator("#courseReportBody tr").first().click();
    await expect(page.locator("#courseLearnerBody tr")).toHaveCount(3);

    const { name, bytes } = await download(page);
    expect(name).toMatch(/^Kurs A \d{4}-\d{2}-\d{2}\.csv$/);
    // Merket Excel trenger for å lese æøå riktig.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8").split("\r\n")).toEqual([
      "Kurs;Navn;E-post;Avdeling;Kursstatus;Fullførte moduler;Leste seksjoner;Skår;Siste aktivitet",
      "Kurs A;Ola Nordmann;ola@example.com;;Fullført;3 av 4;2 av 2;82,5;2026-11-07 08:12",
      "Kurs A;'=SUM(A1);kari@example.com;\"Drift; Nord\";Pågår;3 av 4;2 av 2;;2026-11-07 08:12",
      "Kurs A;\"Per \"\"Sjef\"\" Hansen\";per@example.com;;Ikke startet;0 av 4;0 av 2;;",
    ]);
  });

  test("tegn et filnavn ikke kan ha, blir bindestrek", async ({ page }) => {
    await mockResults(page, () => [learner({})]);
    await page.goto("/results");
    await page.locator("#courseReportBody tr").nth(1).click();
    await expect(page.locator("#courseLearnerBody tr")).toHaveCount(1);
    expect((await download(page)).name).toMatch(/^Kurs- B-C \d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("klikk på et annet kurs under hentingen: svaret på det første blir verken tabellen eller fila", async ({ page }) => {
    let releaseA: () => void = () => {};
    const a = new Promise<void>((resolve) => { releaseA = resolve; });
    let aAnswered = false;
    await mockResults(page, async (courseId) => {
      if (courseId !== "a") return [learner({ participantName: "Deltaker B" })];
      await a;
      aAnswered = true;
      return [learner({ participantName: "Deltaker A" })];
    });
    await page.goto("/results");
    await page.locator("#courseReportBody tr").first().click();
    await page.locator("#courseReportBody tr").nth(1).click();
    await expect(page.locator("#courseLearnerBody")).toContainText("Deltaker B");

    releaseA();
    await expect.poll(() => aAnswered).toBe(true);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#courseLearnerBody")).not.toContainText("Deltaker A");
    await expect(page.locator("#courseDetailMeta")).toContainText("Kurs: B/C");
    const { name, bytes } = await download(page);
    expect(name).toMatch(/^Kurs- B-C /);
    expect(bytes.toString("utf8")).toContain("Deltaker B");
  });

  test("nytt datofilter under hentingen: den ufiltrerte lista blir verken tabellen eller fila", async ({ page }) => {
    let releaseFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstAnswered = false;
    let calls = 0;
    await mockResults(page, async () => {
      calls += 1;
      if (calls > 1) return [learner({ participantName: "Filtrert" })];
      await first;
      firstAnswered = true;
      return [learner({ participantName: "Ufiltrert" })];
    });
    await page.goto("/results");
    await page.locator("#courseReportBody tr").first().click();
    await expect.poll(() => calls).toBe(1);
    await page.fill("#filterDateFrom", "2026-10-01");
    await page.locator("#filterDateFrom").dispatchEvent("change");
    await expect(page.locator("#courseLearnerBody")).toContainText("Filtrert");

    releaseFirst();
    await expect.poll(() => firstAnswered).toBe(true);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#courseLearnerBody")).not.toContainText("Ufiltrert");
    expect((await download(page)).bytes.toString("utf8")).toContain("Filtrert");
  });

  test("klikk på en annen modul under hentingen: svaret på den første legger seg ikke over", async ({ page }) => {
    let releaseA: () => void = () => {};
    const a = new Promise<void>((resolve) => { releaseA = resolve; });
    let aAnswered = false;
    await mockResults(page, () => []);
    const moduleRow = (moduleId: string, moduleTitle: string) => ({ moduleId, moduleTitle, attempts: 1, passes: 1, passRate: 1, started: 1, completed: 1, passed: 1, failed: 0, underReview: 0, completionRate: 1 });
    const modules = [moduleRow("m-a", "Modul A"), moduleRow("m-b", "Modul B")];
    await page.route("**/api/reports/pass-rates**", (r: Route) => r.fulfill(json({ rows: modules })));
    await page.route("**/api/reports/completion**", (r: Route) => r.fulfill(json({ rows: modules })));
    await page.route("**/api/reports/completion/details**", async (r: Route) => {
      const moduleId = new URL(r.request().url()).searchParams.get("selectedModuleId");
      if (moduleId === "m-a") {
        await a;
        aAnswered = true;
        await r.fulfill(json({ rows: [{ participantName: "Deltaker A", participantEmail: "a@example.com", status: "COMPLETED" }] }));
        return;
      }
      await r.fulfill(json({ rows: [{ participantName: "Deltaker B", participantEmail: "b@example.com", status: "COMPLETED" }] }));
    });
    await page.goto("/results");
    await page.locator("#completionBody tr").first().click();
    await page.locator("#completionBody tr").nth(1).click();
    await expect(page.locator("#participantBody")).toContainText("b@example.com");

    releaseA();
    await expect.poll(() => aAnswered).toBe(true);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#participantBody")).not.toContainText("a@example.com");
    await expect(page.locator("#moduleDetailMeta")).toContainText("Modul B");
  });
});
