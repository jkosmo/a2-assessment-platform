import { test, expect, type Page, type Route } from "@playwright/test";

// #924 + #923 — seksjonsleseren.
//
// #924: To knapper der den ene alltid fulgte den andre er ikke et valg. «Marker seksjon lest, og gå
//       videre» er én handling. «Videre» følger kursets ELEMENTREKKE, ikke elementtypen: er neste
//       element en modul, skal deltakeren dit — ikke forbi vurderingen som var lagt der med vilje.
//       Knappeteksten må si hvilken av delene det er.
// #923: Diskusjon finnes bare på kursnivå. Leseren har ikke lenger sitt eget board — tre nivåer
//       delte en liten samtale i tre halvdøde tråder.
//
// Alt dette lever i klientlaget og er usynlig for supertest.

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
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 3, courseStatus: "NOT_STARTED" } }],
      }),
    }),
  );
}

// Kursrekka: seksjon → seksjon → modul. Diskusjon er påslått både på kurset og på hvert element,
// nettopp for at #923-vakten skal bevise at inngangen er fjernet og ikke bare skrudd av.
const readSections = new Set<string>();

async function mockCourse(page: Page) {
  readSections.clear();
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        course: {
          id: "c1",
          title: "Kurs",
          discussionsEnabled: true,
          items: [
            { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: "Første seksjon", read: readSections.has("s1"), discussionsEnabled: true },
            { type: "SECTION", sectionId: "s2", courseItemId: "ci2", title: "Andre seksjon", read: readSections.has("s2"), discussionsEnabled: true },
            { type: "MODULE", moduleId: "m1", courseItemId: "ci3", title: "Testen", moduleStatus: "NOT_STARTED", available: true, discussionsEnabled: true },
          ],
        },
      }),
    }),
  );
  for (const [id, title] of [["s1", "Første seksjon"], ["s2", "Andre seksjon"]]) {
    await page.route(`**/api/courses/c1/sections/${id}`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title, html: `<p>Tekst i ${id}</p>` }) }),
    );
    await page.route(`**/api/courses/c1/sections/${id}/read`, (route: Route) => {
      readSections.add(id);
      return route.fulfill({ status: 204, body: "" });
    });
  }
  // Modul-arbeidsflaten trenger modulen i deltakerens modul-liste.
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m1", title: "Testen", description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Oppgave", activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    }),
  );
  await page.route("**/api/courses/c1/discussions**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads: [], canPost: true }) }),
  );
}

async function openCourse(page: Page) {
  await page.goto("/participant");
  await expect(page.locator(".course-accordion-item")).toHaveCount(1);
  await page.locator(".course-accordion-header").click();
  await expect(page.locator(".course-sequence")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
});

test("#924: neste element er en seksjon — én knapp som markerer lest og åpner neste", async ({ page }) => {
  await mockBase(page);
  await mockCourse(page);
  await openCourse(page);

  const first = page.locator('.course-item[data-key="ci1"]');
  await first.locator(".course-module-row").click();
  await expect(first.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  // Én knapp — ikke «marker lest» pluss «gå til neste».
  await expect(first.locator(".course-inline-actions button")).toHaveCount(1);
  await expect(first.locator("#sectionReaderMarkRead")).toHaveText("Marker seksjon lest, og gå videre");

  await first.locator("#sectionReaderMarkRead").click();

  // Lesningen er registrert, OG neste element står åpent. Ett klikk, begge deler.
  await expect.poll(() => readSections.has("s1")).toBe(true);
  const second = page.locator('.course-item[data-key="ci2"]');
  await expect(second.locator("#sectionReaderBody")).toContainText("Tekst i s2");
  await expect(first.locator("#sectionReaderBody")).toHaveCount(0);
});

test("#924: neste element er en MODUL — knappen sier det, og fører dit", async ({ page }) => {
  await mockBase(page);
  await mockCourse(page);
  await openCourse(page);

  // Andre seksjon: neste element i rekka er en modul, ikke en seksjon.
  const second = page.locator('.course-item[data-key="ci2"]');
  await second.locator(".course-module-row").click();
  await expect(second.locator("#sectionReaderBody")).toContainText("Tekst i s2");

  // Knappen sier det den faktisk gjør. Den generiske «gå videre» ville skjult at det som kommer
  // er en vurdering.
  await expect(second.locator("#sectionReaderMarkRead")).toHaveText("Marker seksjon lest, og gå til testen");

  await second.locator("#sectionReaderMarkRead").click();

  await expect.poll(() => readSections.has("s2")).toBe(true);
  // Modulen åpnes inline under sin egen rad — deltakeren hoppet ikke forbi den til «neste seksjon».
  const moduleItem = page.locator('.course-item[data-key="ci3"]');
  await expect(moduleItem.locator(".course-inline-panel #submissionSection")).toBeVisible();
});

test("#923: seksjonsleseren har ikke lenger sitt eget diskusjonsboard — kursnivået har det", async ({ page }) => {
  await mockBase(page);
  await mockCourse(page);
  await openCourse(page);

  const first = page.locator('.course-item[data-key="ci1"]');
  await first.locator(".course-module-row").click();
  await expect(first.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  // Elementet har discussionsEnabled:true og en courseItemId — likevel skal leseren ikke ha noe
  // board. Inngangen er fjernet, ikke skrudd av: eksisterende tråder ligger urørt i basen.
  await expect(first.locator("#sectionReaderDiscussion")).toHaveCount(0);
  await expect(first.locator(".discussion-panel")).toHaveCount(0);

  // Kursnivået er den ene gjenværende diskusjonen — den skal fortsatt være der (kollapset).
  await expect(page.locator(".course-discussion-toggle")).toBeVisible();
  await page.locator(".course-discussion-toggle").click();
  await expect(page.locator(".course-discussion-body .discussion-panel")).toHaveCount(1);
});
