import { test, expect, type Page, type Route } from "@playwright/test";

// #953: e2e for administratorflaten «Vurderinger som ga opp».
//
// ⚠️ Denne testen finnes fordi spesifikasjonen krevde den (issue #953, krav 4: «Playwright-e2e for
// hovedflyten, per stående ordre. En integrasjonstest som beviser radendringen er ikke nok — det var
// nettopp det som manglet begge gangene»).
//
// Og den fant noe: første utgave av knappen kalte deltakerruta `POST /api/assessments/:id/run`, som
// er eierskapssjekket mot INNSENDEREN. En administrator eier ikke deltakerens innlevering, så
// knappen fikk 404 hver eneste gang — hele handlingsflaten var død ved levering. Enhetstesten så
// det ikke: den sjekket at strengen «/run» fantes i skriptet, altså at jeg hadde skrevet noe, ikke
// at det virket.
//
// Derfor er påstanden her på HVILKEN rute som treffes, ikke bare på at knappen finnes.

const FAILED_ROW = {
  jobId: "job-1",
  submissionId: "sub-1",
  attempts: 6,
  maxAttempts: 6,
  errorMessage: "LLM-tjenesten svarte ikke",
  failedAt: "2026-08-26T10:00:00.000Z",
  submissionStatus: "PROCESSING",
  submittedAt: "2026-08-26T09:00:00.000Z",
  participantName: "Kari Nordmann",
  participantEmail: "kari@company.com",
  moduleId: "module-1",
  moduleTitle: JSON.stringify({ "en-GB": "Module One", nb: "Modul Én", nn: "Modul Éin" }),
};

async function mockAdminApis(page: Page, failedAssessments: unknown[]) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          contentAdmin: { userId: "admin-1", email: "admin@x.no", name: "Admin", roles: ["ADMINISTRATOR"] },
        },
        calibrationWorkspace: { accessRoles: [] },
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
        user: { roles: ["ADMINISTRATOR"] },
        consent: { accepted: true, currentVersion: "1.0" },
      }),
    }),
  );
  await page.route("**/api/admin/platform", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ platformName: "A2", consentBody: {}, certificateBackground: false }),
    }),
  );
  await page.route("**/api/admin/platform/failed-assessments", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ failedAssessments }),
    }),
  );
}

test.describe("#953 — vurderinger som ga opp", () => {
  test("kortet vises IKKE når det ikke finnes noen feilede vurderinger", async ({ page }) => {
    await mockAdminApis(page, []);
    await page.goto("/admin-platform");

    // Produkteier 2026-08-26: «vis dette kun hvis det er noen elementer å vise».
    //
    // ⚠️ `toBeHidden()` alene er en VAKUØS påstand: den er sann også for et element som ikke finnes.
    // Første utgave av denne testen besto mot en side som ga 404. Krev derfor at kortet FINNES i
    // DOM-en først — det er forskjellen på «skjult» og «aldri lastet».
    const card = page.locator("#failedAssessmentsCard");
    await expect(card).toHaveCount(1);
    await expect(card).toBeHidden();
  });

  test("kortet vises med raden, og knappen treffer ADMINISTRATORENS rute — ikke deltakerens", async ({ page }) => {
    await mockAdminApis(page, [FAILED_ROW]);

    // ⚠️ Deltakerruta er eierskapssjekket. Treffer klienten den, er knappen død. Vi svarer 404 her
    // for å speile hva serveren faktisk ville gjort — så testen feiler hvis noen kobler den om.
    let hitParticipantRoute = false;
    await page.route("**/api/assessments/**/run", (route: Route) => {
      hitParticipantRoute = true;
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_found", message: "Submission not found." }),
      });
    });

    let retriedSubmissionId: string | null = null;
    await page.route("**/api/admin/platform/failed-assessments/*/retry", (route: Route) => {
      retriedSubmissionId = decodeURIComponent(
        route.request().url().split("/failed-assessments/")[1].replace("/retry", ""),
      );
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true, jobId: "job-2" }),
      });
    });

    await page.goto("/admin-platform");

    const card = page.locator("#failedAssessmentsCard");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Kari Nordmann");
    // Modultittelen er lokalisert JSON lagret som TEKST — den skal slås opp, ikke vises rå.
    await expect(card).not.toContainText('{"en-GB"');

    await page.locator("#failedAssessmentsBody button").first().click();

    await expect.poll(() => retriedSubmissionId).toBe("sub-1");
    expect(hitParticipantRoute).toBe(false);
  });
});
