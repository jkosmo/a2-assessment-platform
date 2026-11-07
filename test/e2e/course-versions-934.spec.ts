import { test, expect, type Page, type Route } from "@playwright/test";

// #934 del 2: et kursbevis gjelder sin hovedversjon. Når kurset får en ny hovedversjon, står det gamle
// beviset — men kurset er ikke fullført i den nye. Dette er klientlaget (kortet under «Mine kurs»,
// kursbeviset, profilen og resultatsida); tjenersiden dekkes av test/m2-course-versions-934.test.ts.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockBase(page: Page, roles: string[] = ["PARTICIPANT"]) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: {
      participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles },
      reportReader: { userId: "participant-1", email: "p@x.no", name: "P", roles },
    },
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "participant-1", name: "Kari", email: "p@x.no", roles },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
}

function course(id: string, title: string, status: string) {
  return {
    id,
    title,
    description: null,
    moduleCount: 2,
    progress: { completed: 1, total: 2, moduleCompleted: 1, moduleTotal: 2, sectionCompleted: 0, sectionTotal: 0, courseStatus: status },
  };
}

test.describe("#934 — kursbevis per hovedversjon", () => {
  test("Mine kurs: kurset med bare et eldre bevis står som «Ny versjon», med lenke til det gamle beviset", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/courses", (r: Route) => r.fulfill(json({
      courses: [course("c-ny", "Arbeidsrett", "IN_PROGRESS"), course("c-vanlig", "Personvern", "IN_PROGRESS")],
    })));
    await page.route("**/api/courses/completions", (r: Route) => r.fulfill(json({
      completions: [
        // To eldre bevis for samme kurs: det NYESTE av dem skal vises.
        { courseId: "c-ny", certificateId: "cert-v1", completedAt: "2025-03-01T10:00:00.000Z", courseTitle: "Arbeidsrett", versionMajor: 1, versionMinor: 0, current: false },
        { courseId: "c-ny", certificateId: "cert-v2", completedAt: "2026-03-01T10:00:00.000Z", courseTitle: "Arbeidsrett", versionMajor: 2, versionMinor: 1, current: false },
      ],
    })));

    await page.goto("/participant");
    const ny = page.locator(".course-accordion-item", { hasText: "Arbeidsrett" });
    const vanlig = page.locator(".course-accordion-item", { hasText: "Personvern" });
    await expect(ny).toBeVisible();

    // Kurset er IKKE fullført — det står i lista over pågående, med eget merke.
    await expect(ny.locator(".course-new-version-badge")).toHaveText("Ny versjon");
    // Kontrollcase: et kurs uten eldre bevis får det vanlige merket.
    await expect(vanlig.locator(".course-new-version-badge")).toHaveCount(0);

    await ny.locator(".course-accordion-header").click();
    const lenke = ny.locator("a.course-certificate-link--earlier");
    await expect(lenke).toBeVisible();
    await expect(lenke).toHaveAttribute("href", "/certificate?id=cert-v2");
    await expect(lenke).toContainText("Kursbevis, versjon 2");
    await expect(vanlig.locator("a.course-certificate-link--earlier")).toHaveCount(0);
  });

  test("Mine kurs: et bevis for nåværende versjon gjør kurset fullført, uten merket «Ny versjon»", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/courses", (r: Route) => r.fulfill(json({
      courses: [course("c1", "Arbeidsrett", "COMPLETED")],
    })));
    await page.route("**/api/courses/completions", (r: Route) => r.fulfill(json({
      completions: [
        { courseId: "c1", certificateId: "cert-old", completedAt: "2025-03-01T10:00:00.000Z", courseTitle: "Arbeidsrett", versionMajor: 1, versionMinor: 0, current: false },
        { courseId: "c1", certificateId: "cert-new", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Arbeidsrett", versionMajor: 2, versionMinor: 0, current: true },
      ],
    })));

    await page.goto("/participant");
    const item = page.locator(".course-accordion-item", { hasText: "Arbeidsrett" });
    await expect(item).toBeVisible();
    await expect(item.locator(".course-new-version-badge")).toHaveCount(0);
    await expect(item.locator('a[href="/certificate?id=cert-new"]')).toHaveCount(1);
    await expect(item.locator('a[href="/certificate?id=cert-old"]')).toHaveCount(0);
  });

  test("kursbeviset viser versjonen fra versjon 2, og ikke for versjon 1", async ({ page }) => {
    await mockBase(page);
    const bevis = (id: string, versionMajor: number) => ({
      certificateId: id, courseId: "c1", courseTitle: "Arbeidsrett", certificationLevel: "basic",
      completedAt: "2026-06-20T10:00:00.000Z", participantName: "Kari Nordmann", moduleCount: 2,
      versionMajor, versionMinor: 0, current: true,
    });
    await page.route("**/api/courses/completions/cert-v2", (r: Route) => r.fulfill(json(bevis("cert-v2", 2))));
    await page.route("**/api/courses/completions/cert-v1", (r: Route) => r.fulfill(json(bevis("cert-v1", 1))));

    await page.goto("/certificate?id=cert-v2");
    await expect(page.locator("#certificate")).toBeVisible();
    await expect(page.locator("#certVersionWrap")).toBeVisible();
    await expect(page.locator("#certVersionWrap")).toHaveText(/Versjon\s+2/);

    await page.goto("/certificate?id=cert-v1");
    await expect(page.locator("#certificate")).toBeVisible();
    await expect(page.locator("#certVersionWrap")).toBeHidden();
  });

  test("profilen skiller to bevis for samme kurs med versjonen", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/courses/completions", (r: Route) => r.fulfill(json({
      completions: [
        { courseId: "c1", certificateId: "cert-v1", completedAt: "2025-03-01T10:00:00.000Z", courseTitle: "Arbeidsrett", versionMajor: 1, versionMinor: 0, current: false },
        { courseId: "c1", certificateId: "cert-v2", completedAt: "2026-10-01T10:00:00.000Z", courseTitle: "Arbeidsrett", versionMajor: 2, versionMinor: 0, current: true },
      ],
    })));

    await page.goto("/profile");
    const rader = page.locator("#coursesBody tr");
    await expect(rader).toHaveCount(2);
    await expect(page.locator("#coursesBody tr", { has: page.locator('a[href="/certificate?id=cert-v2"]') }).locator("td").first())
      .toHaveText("Arbeidsrett (versjon 2)");
    // Versjon 1 er alle bevis fra før kurs fikk versjoner — de får ingen tilføyelse.
    await expect(page.locator("#coursesBody tr", { has: page.locator('a[href="/certificate?id=cert-v1"]') }).locator("td").first())
      .toHaveText("Arbeidsrett");
  });

  test("resultatsida viser «Må ta ny versjon» for en deltaker med bare eldre bevis", async ({ page }) => {
    await mockBase(page, ["ADMINISTRATOR"]);
    await page.route("**/api/reports/pass-rates**", (r: Route) => r.fulfill(json({ rows: [] })));
    await page.route("**/api/reports/completion**", (r: Route) => r.fulfill(json({ rows: [] })));
    await page.route("**/api/reports/participants**", (r: Route) => r.fulfill(json({ rows: [] })));
    await page.route("**/api/reports/courses?**", (r: Route) => r.fulfill(json({
      rows: [{ courseId: "c1", courseTitle: "Arbeidsrett", enrolledParticipants: 2, completedParticipants: 1, completionRate: 0.5, moduleBreakdown: [] }],
    })));
    await page.route("**/api/reports/courses/details**", (r: Route) => r.fulfill(json({
      rows: [
        { userId: "u1", participantName: "Kari", participantEmail: "kari@x.no", participantDepartment: null, status: "NEEDS_NEW_VERSION", earlierCertificateVersion: 1, completedModules: 1, totalModules: 2, readSections: 0, totalSections: 0, score: null, latestActivityAt: null },
        { userId: "u2", participantName: "Ola", participantEmail: "ola@x.no", participantDepartment: null, status: "COMPLETED", completedModules: 2, totalModules: 2, readSections: 0, totalSections: 0, score: null, latestActivityAt: null },
      ],
    })));

    await page.goto("/results");
    await page.locator("#courseReportBody .report-row-button", { hasText: "Arbeidsrett" }).click();
    await expect(page.locator("#courseLearnerBody tr", { hasText: "Kari" })).toContainText("Må ta ny versjon");
    // Rå nøkkel skal aldri vises.
    await expect(page.locator("#courseLearnerBody")).not.toContainText("NEEDS_NEW_VERSION");
    await expect(page.locator("#courseLearnerBody tr", { hasText: "Ola" })).not.toContainText("Må ta ny versjon");
  });
});
