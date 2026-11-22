import { test, expect, type Page, type Route } from "@playwright/test";

// #736: switching the locale on the profile page must re-render the dynamically built
// completed-modules/courses tables too — not just the static [data-i18n] labels. Previously a
// switch left the value cells (pass/fail, "view certificate") in the old language while headers
// changed, producing a mixed-locale page.

async function mockProfile(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          participant: { userId: "p-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] },
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
      // No user.locale → the page keeps the localStorage locale (en-GB) so the manual switch is what's tested.
      body: JSON.stringify({
        user: { id: "p-1", name: "P", email: "p@x.no", roles: ["PARTICIPANT"] },
        consent: { accepted: true, currentVersion: "1.0" },
      }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  // #1138: beståtte moduler og statistikken kommer fra /api/me/stats. Serveren baker inn språket i
  // modultittelen, så svaret varierer med x-locale — som det ekte endepunktet.
  await page.route("**/api/me/stats", (route: Route) => {
    const locale = route.request().headers()["x-locale"] ?? "en-GB";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mood: "sur",
        weeks: [],
        recent: { weeks: 4, sectionsRead: 0, modulesPassed: 0, coursesCompleted: 0, readingMinutes: 0 },
        totals: { coursesCompleted: 1, modulesPassed: 1, sectionsRead: 0 },
        passedModules: [
          { moduleId: "m-a", moduleTitle: locale === "nb" ? "Modul A" : "Module A", passedAt: "2026-06-20T10:00:00.000Z", totalScore: 100 },
        ],
      }),
    });
  });
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completions: [
          { courseId: "c1", certificateId: "cert-1", completedAt: "2026-06-20T10:00:00.000Z", courseTitle: "Course A", certificationLevel: "basic" },
        ],
      }),
    }),
  );
  await page.addInitScript(() => {
    try {
      localStorage.setItem("participant.locale", "en-GB");
    } catch {
      /* ignore */
    }
  });
}

test("profile: switching locale re-renders the completed tables, not just the headers", async ({ page }) => {
  await mockProfile(page);
  await page.goto("/profile");

  // Loaded in English: the boat's line, the module title from the server and the certificate link.
  await expect(page.locator("#statsMoodLine")).toHaveText("We're stuck in dead water. I'm not saying anything. I'm just mentioning it.");
  await expect(page.locator("#modulesBody")).toContainText("Module A");
  await expect(page.locator("#modulesBody")).toContainText("Jun 2026");
  await expect(page.locator("#coursesBody")).toContainText("View certificate");

  // Switch to Norwegian bokmål.
  await page.selectOption("#localeSelect", "nb");

  // The dynamically built content must follow the new locale (no mixed-locale leftovers): what the
  // client formats (line, date, link) and what the server localises (module title, refetched).
  await expect(page.locator("#statsMoodLine")).toHaveText("Vi ligger i dødvannet. Jeg sier ikke noe. Jeg bare nevner det.");
  await expect(page.locator("#modulesBody")).toContainText("Modul A");
  await expect(page.locator("#modulesBody")).toContainText("juni 2026");
  await expect(page.locator("#coursesBody")).toContainText("Vis kursbevis");
  await expect(page.locator("#modulesBody")).not.toContainText("Module A");
  await expect(page.locator("#coursesBody")).not.toContainText("View certificate");
});

// Profilsiden hadde én nøkkel uten tekst i noen bunt (`identity.load`), så knappen i testbrukerpanelet
// viste nøkkelen. Ingen statisk tekst på siden skal være en rå nøkkel, på noe språk.
test("profile: ingen [data-i18n]-tekst på siden er en rå nøkkel (nb, nn, en-GB)", async ({ page }) => {
  await mockProfile(page);
  await page.goto("/profile");
  for (const locale of ["en-GB", "nb", "nn"]) {
    await page.selectOption("#localeSelect", locale);
    const tekster = await page.locator("[data-i18n]").evaluateAll((els) => els.map((el) => [el.getAttribute("data-i18n"), (el.textContent ?? "").trim()]));
    const raa = tekster.filter(([key, text]) => key && text === key);
    expect(raa, `rå nøkler på ${locale}`).toEqual([]);
  }
});
