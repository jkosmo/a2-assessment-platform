import { expect, test, type Page, type Route } from "@playwright/test";

// #1190: «Deltakere» i toppmenyen går alltid til /deltakere/klasser, men bare fagansvarlig og administrator har tilgang til
// klasse-API-et. Vurderer, ankebehandler og rapportleser fikk 403 og en tom side. Undermenyen sender dem nå videre til den
// første undersiden de har tilgang til.

async function mockSom(page: Page, roller: string[]) {
  await page.route("**/api/**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "u-1", email: "u@x.no", name: "U", roles: roller }, userId: "u-1", email: "u@x.no", name: "U", roles: roller },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: roller }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

const VIDERE: Array<[string, string[], RegExp]> = [
  ["rapportleser", ["REPORT_READER"], /\/deltakere\/status$/],
  ["vurderer", ["REVIEWER"], /\/review$/],
  ["ankebehandler", ["APPEAL_HANDLER"], /\/review$/],
];

for (const [navn, roller, forventet] of VIDERE) {
  test(`${navn} som åpner /deltakere/klasser, havner på en side hen har tilgang til`, async ({ page }) => {
    await mockSom(page, roller);
    await page.goto("/deltakere/klasser");
    await expect(page).toHaveURL(forventet);
  });
}

// Kontroll: den som har tilgang, blir stående; og en side brukeren HAR tilgang til, forlates ikke.
test("fagansvarlig blir stående på /deltakere/klasser", async ({ page }) => {
  await mockSom(page, ["SUBJECT_MATTER_OWNER"]);
  await page.goto("/deltakere/klasser");
  await expect(page.locator("#deltakereSubnav")).toHaveAttribute("data-roles-resolved", "true");
  await expect(page).toHaveURL(/\/deltakere\/klasser$/);
});

test("rapportleser blir stående på /deltakere/status", async ({ page }) => {
  await mockSom(page, ["REPORT_READER"]);
  await page.goto("/deltakere/status");
  await expect(page.locator("#deltakereSubnav")).toHaveAttribute("data-roles-resolved", "true");
  await expect(page).toHaveURL(/\/deltakere\/status$/);
});
