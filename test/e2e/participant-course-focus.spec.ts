import { test, expect, type Page, type Route } from "@playwright/test";

// #921 + #922 — kurslista og det åpne kurset er TO TILSTANDER, ikke to ting side om side.
//
// Produkteier om lesevisningen (stage 2026-08-18): «Dette skjermbildet må være optimalisert for
// lesning og konsentrasjon med færrest mulig distraksjoner.»
//
// Det gir to krav som bare henger sammen hvis man ser dem som en reise:
//   #921  Førstemøtet er «hvilke kurs har jeg?». Svaret skal ikke ligge bak et klikk — lista henter
//         seg selv og står ekspandert, med progresjon og kursbevis synlig.
//   #922  Går man INN i et kurs, viker lista helt. Ikke krympet, ikke dempet — borte. Og da må det
//         finnes en tydelig vei tilbake, øverst til venstre, der man leter etter den.
//
// Begge er usynlige for supertest: dette er cascade, klasse-toggling og history-API i nettleseren.

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
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { id: "c1", title: "Kurs én", description: null, moduleCount: 1, progress: { completed: 0, total: 1, sectionCompleted: 0, sectionTotal: 1, courseStatus: "NOT_STARTED" } },
          { id: "c2", title: "Kurs to", description: null, moduleCount: 1, progress: { completed: 0, total: 1, sectionCompleted: 0, sectionTotal: 1, courseStatus: "NOT_STARTED" } },
        ],
      }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  for (const id of ["c1", "c2"]) {
    await page.route(`**/api/courses/${id}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          course: {
            id,
            title: id === "c1" ? "Kurs én" : "Kurs to",
            items: [
              { type: "SECTION", sectionId: `${id}-s1`, courseItemId: `${id}-ci1`, title: `Seksjon i ${id}`, read: false },
            ],
          },
        }),
      }),
    );
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
});

test("#921: kurslista henter seg selv og står ekspandert — ingen «Last kurs» først", async ({ page }) => {
  await mockBase(page);
  await page.goto("/participant");

  // Ingen klikk på #loadCoursesBtn her. Det er hele poenget: klikket lå mellom deltakeren og det
  // eneste spørsmålet de kom for å få svar på.
  await expect(page.locator(".course-accordion-item")).toHaveCount(2);
  await expect(page.locator(".course-accordion-title").first()).toHaveText("Kurs én");

  // «Ekspandert» betyr at kortet faktisk viser noe: progresjonen står der, ikke bak en pil.
  // .course-accordion-body var display:none uten .open — den regelen er borte.
  await expect(page.locator(".course-accordion-item").first().locator(".course-progress-bar")).toBeVisible();
  await expect(page.locator(".course-accordion-item").nth(1).locator(".course-progress-bar")).toBeVisible();

  // Lista er lista: kursets innhold (sekvensen) hører til kursvisningen, ikke hit.
  await expect(page.locator(".course-sequence")).toHaveCount(0);
  await expect(page.locator("#courseBackBar")).toBeHidden();
});

test("#922: et åpnet kurs får flaten alene, og lista viker helt", async ({ page }) => {
  await mockBase(page);
  await page.goto("/participant");
  await expect(page.locator(".course-accordion-item")).toHaveCount(2);

  const first = page.locator('.course-accordion-item[data-course-id="c1"]');
  const other = page.locator('.course-accordion-item[data-course-id="c2"]');
  await first.locator(".course-accordion-header").click();

  // Det andre kurset er ikke bare dempet — det er borte. toBeHidden(), ikke «har en klasse»:
  // .hidden ville tapt cascaden her, og elementet ville blitt stående synlig (CLAUDE.md § 7).
  await expect(other).toBeHidden();
  await expect(first).toBeVisible();
  await expect(first.locator(".course-sequence")).toBeVisible();

  // Veien tilbake står øverst til venstre. «Oppdater kurslista» hører til lista, ikke til lesingen.
  await expect(page.locator("#courseBackBar")).toBeVisible();
  await expect(page.locator("#courseBackBtn")).toHaveText("← Alle kurs");
  await expect(page.locator("#loadCoursesBtn")).toBeHidden();
});

test("#922: tilbake-lenka fører til kurslista igjen", async ({ page }) => {
  await mockBase(page);
  await page.goto("/participant");
  await expect(page.locator(".course-accordion-item")).toHaveCount(2);
  await page.locator('.course-accordion-item[data-course-id="c1"] .course-accordion-header').click();
  await expect(page.locator('.course-accordion-item[data-course-id="c2"]')).toBeHidden();

  await page.locator("#courseBackBtn").click();

  await expect(page.locator('.course-accordion-item[data-course-id="c2"]')).toBeVisible();
  await expect(page.locator('.course-accordion-item[data-course-id="c1"]')).toBeVisible();
  await expect(page.locator("#courseBackBar")).toBeHidden();
  await expect(page.locator("#loadCoursesBtn")).toBeVisible();
  // Sekvensen hører til kursvisningen — tilbake i lista skal den ikke bli stående.
  await expect(page.locator(".course-sequence")).toBeHidden();
});

test("#922: nettleserens tilbakeknapp gjør det samme som tilbake-lenka", async ({ page }) => {
  await mockBase(page);
  await page.goto("/participant");
  await expect(page.locator(".course-accordion-item")).toHaveCount(2);
  await page.locator('.course-accordion-item[data-course-id="c1"] .course-accordion-header').click();
  await expect(page.locator('.course-accordion-item[data-course-id="c2"]')).toBeHidden();
  // Kurset har sin egen adresse, så en oppfriskning lander samme sted som deltakeren sto.
  await expect(page).toHaveURL(/courseId=c1/);

  await page.goBack();

  await expect(page.locator('.course-accordion-item[data-course-id="c2"]')).toBeVisible();
  await expect(page.locator("#courseBackBar")).toBeHidden();
});
