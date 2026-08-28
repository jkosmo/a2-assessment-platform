import { test, expect, type Page, type Route } from "@playwright/test";

// #498: browser e2e for the teacher/SMO cohort-status dashboard. Runs the real cohort-status.js against
// mocked APIs — the picker → load → status-cards + per-class flow, and the «Status» sub-tab wiring.

async function mockBase(page: Page, roles: string[] = ["SUBJECT_MATTER_OWNER"]) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles } },
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
      body: JSON.stringify({ user: { roles }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
}

test("cohort dashboard: pick a course → status counts + per-class breakdown, with the Status tab active", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/cohort-status/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs A" }] }) }),
  );
  await page.route("**/api/cohort-status/course/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courseId: "c1",
        total: 5,
        counts: { ASSIGNED: 2, IN_PROGRESS: 1, OVERDUE: 1, COMPLETED: 1 },
        byClass: [{ classId: "cl1", className: "Kull 2026", total: 2, counts: { ASSIGNED: 1, IN_PROGRESS: 0, OVERDUE: 0, COMPLETED: 1 } }],
        generatedAt: "2026-07-18T20:00:00.000Z",
      }),
    }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });

  await page.goto("/deltakere/status");

  await expect(page.locator("h1")).toContainText("Kohort-status");
  // The «Status» sub-tab is present and marked active; the reviewer-only tab is gated out for an SMO.
  await expect(page.locator("#subnavStatus")).toHaveClass(/active/);
  await expect(page.locator("#subnavReview")).toHaveCount(0);

  // Empty state until a course is chosen.
  await expect(page.locator("#cohortEmpty")).toBeVisible();
  // #975: `toBeHidden()` sto her og var grønn av feil grunn. `.status-grid{display:grid}` slo
  // `hidden`-attributtet, så rutenettet var ALDRI skjult — det var bare tomt, og et tomt grid har
  // høyde 0, som Playwright regner som skjult. Mål display direkte, ellers måler vi tomheten.
  await expect(page.locator("#statusCards")).toHaveCSS("display", "none");

  // Pick the course.
  await expect(page.locator("#courseSelect option[value='c1']")).toHaveCount(1);
  await page.locator("#courseSelect").selectOption("c1");

  // Status cards render with the counts.
  const cards = page.locator("#statusCards");
  await expect(cards).toBeVisible();
  // Makkeren til display-sjekken over: rutenettet skal faktisk komme TILBAKE som grid.
  await expect(cards).toHaveCSS("display", "grid");
  await expect(cards.locator(".status-card--total .status-value")).toHaveText("5");
  await expect(cards.locator(".status-card--assigned .status-value")).toHaveText("2");
  await expect(cards.locator(".status-card--in_progress .status-value")).toHaveText("1");
  await expect(cards.locator(".status-card--overdue .status-value")).toHaveText("1");
  await expect(cards.locator(".status-card--completed .status-value")).toHaveText("1");

  // Per-class breakdown row.
  const classRow = page.locator("#byClassBody tr");
  await expect(classRow).toHaveCount(1);
  await expect(classRow).toContainText("Kull 2026");
});

// #967: ⚠️ QA-porten sa det rett ut: uten denne testen finnes det ingen automatisert kontroll som
// ser det brukeren ser. Feltene `coursePublished`/`courseArchived` kunne blitt død last i UI-et
// uten at noe ble rødt — og da ville dashbordhalvparten av #967 ikke levert verdi til noen.
//
// To ting krever den, og begge må holde: kurset skal STÅ i velgeren (merket), og skjermen skal SI
// hvorfor tallene står stille.
test("#967: et avpublisert kurs står merket i velgeren, og dashbordet sier hvorfor tallene står stille", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/cohort-status/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { id: "c-ok", title: "Publisert kurs", published: true, archived: false },
          { id: "c-unpub", title: "Avpublisert kurs", published: false, archived: false },
          { id: "c-arch", title: "Arkivert kurs", published: true, archived: true },
        ],
      }),
    }),
  );
  await page.route("**/api/cohort-status/course/c-unpub", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courseId: "c-unpub",
        total: 7,
        counts: { ASSIGNED: 0, IN_PROGRESS: 0, OVERDUE: 7, COMPLETED: 0 },
        byClass: [],
        generatedAt: "2026-08-28T12:00:00.000Z",
        coursePublished: false,
        courseArchived: false,
      }),
    }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/status");

  // ⚠️ Kjernen i F1: kurset FANTES ikke i velgeren før. Da så skjermen helt normal ut — kurset var
  // bare borte, og fagansvarlig hadde ingenting å lete etter.
  await expect(page.locator("#courseSelect option[value='c-unpub']")).toHaveCount(1);
  await expect(page.locator("#courseSelect option[value='c-unpub']")).toHaveText(/ikke publisert/i);
  await expect(page.locator("#courseSelect option[value='c-arch']")).toHaveText(/arkivert/i);
  // Et vanlig kurs skal IKKE merkes — ellers er merket støy og betyr ingenting.
  await expect(page.locator("#courseSelect option[value='c-ok']")).toHaveText("Publisert kurs");

  await expect(page.locator("#cohortUnavailable")).toBeHidden();

  await page.locator("#courseSelect").selectOption("c-unpub");

  // Tallene vises fortsatt — publikum tømmes ikke — men nå med en forklaring ved siden av.
  await expect(page.locator("#statusCards")).toContainText("7");
  const warning = page.locator("#cohortUnavailable");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(/ikke publisert/i);
  // Fargen skal skille den fra vanlig brødtekst — et varsel ingen ser, er ikke et varsel.
  await expect(warning).toHaveCSS("color", "rgb(122, 75, 0)");
});
