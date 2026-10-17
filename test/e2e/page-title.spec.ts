import { test, expect, type Page, type Route } from "@playwright/test";

// Sidetittelen: «A-2 læringsplattform – Mine kurs», på brukerens språk, uten versjonsnummer.
// Før: «A2 Participant Test Console v2.90.0» — engelsk uansett språk, og med versjonen i lenker og bokmerker.

const ROLLER = ["PARTICIPANT", "ADMINISTRATOR", "SUBJECT_MATTER_OWNER", "REVIEWER", "REPORT_READER"];

async function mock(page: Page, locale: string) {
  await page.route("**/api/**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { userId: "u-1", email: "u@x.no", name: "Bruker", roles: ROLLER },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "9.9.9" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ROLLER }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, locale);
}

const SIDER: Array<[string, Record<string, string>]> = [
  ["/participant", { nb: "Mine kurs", nn: "Kursa mine", "en-GB": "My courses" }],
  ["/participant/completed", { nb: "Fullførte moduler", nn: "Fullførte modular", "en-GB": "Completed modules" }],
  ["/profile", { nb: "Profil", nn: "Profil", "en-GB": "Profile" }],
  ["/review", { nb: "Manuell behandling", nn: "Manuell handsaming", "en-GB": "Manual review" }],
  ["/results", { nb: "Resultater", nn: "Resultat", "en-GB": "Results" }],
  ["/deltakere/aktivitet", { nb: "Aktivitet", nn: "Aktivitet", "en-GB": "Activity" }],
  ["/admin-content", { nb: "Moduler", nn: "Modular", "en-GB": "Modules" }],
  ["/admin-content/courses", { nb: "Kurs", nn: "Kurs", "en-GB": "Courses" }],
];
const MERKE: Record<string, string> = { nb: "A-2 læringsplattform", nn: "A-2 læringsplattform", "en-GB": "A-2 learning platform" };

for (const [rute, navn] of SIDER) {
  for (const locale of ["nb", "nn", "en-GB"]) {
    test(`${rute} (${locale}): tittelen er merket og sidens navn, uten versjon`, async ({ page }) => {
      await mock(page, locale);
      await page.goto(rute);
      await expect(page).toHaveTitle(`${MERKE[locale]} – ${navn[locale]}`);
      // Versjonen er hentet (9.9.9) og skal ikke ha havnet i tittelen.
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveTitle(`${MERKE[locale]} – ${navn[locale]}`);
    });
  }
}

test("språkbytte skifter tittelen uten ny lasting", async ({ page }) => {
  await mock(page, "nb");
  await page.goto("/participant");
  await expect(page).toHaveTitle("A-2 læringsplattform – Mine kurs");
  await expect(page.locator("#localeSelect option[value='en-GB']")).toHaveCount(1);
  await page.locator("#localeSelect").selectOption("en-GB");
  await expect(page).toHaveTitle("A-2 learning platform – My courses");
});

test("profilen: når språket hos tjeneren avviker fra nettleserens, følger tittelen med", async ({ page }) => {
  await mock(page, "en-GB");
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ROLLER, locale: "nb" }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.goto("/profile");
  await expect(page.locator("#localeSelect")).toHaveValue("nb");
  await expect(page).toHaveTitle("A-2 læringsplattform – Profil");
});
