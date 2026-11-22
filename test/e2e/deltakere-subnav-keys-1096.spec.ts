import { test, type Page, type Route } from "@playwright/test";
import { forventUndermenyMedOrd } from "../support/deltakereSubnav.js";

// #1096: under Deltakere viste undermenyen rå nøkler (`area.classes`, `area.status`, …) i prod. Se
// test/support/deltakereSubnav.ts for hvorfor.
//
// Testgjennomgangen 2026-11 (4.1-2): /results, /review og /deltakere/aktivitet på tre språk ble lastet både her og i
// page-title.spec.ts, med nesten lik mock. Undermenyen sjekkes nå inne i page-title-testen for de tre sidene. Her står
// /deltakere/status, som page-title ikke laster.

const ROLLER = ["ADMINISTRATOR", "SUBJECT_MATTER_OWNER", "REVIEWER", "APPEAL_HANDLER", "REPORT_READER"];

async function mockAlt(page: Page, locale: string) {
  // Alt som ikke er nevnt under: et tomt, gyldig svar, så sidene kommer gjennom oppstarten.
  await page.route("**/api/**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "adm-1", email: "adm@x.no", name: "Admin", roles: ROLLER }, userId: "adm-1", email: "adm@x.no", name: "Admin", roles: ROLLER },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ROLLER }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.addInitScript((loc) => {
    try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ }
  }, locale);
}

for (const side of ["/deltakere/status"]) {
  for (const locale of ["nb", "nn", "en-GB"]) {
    test(`${side} (${locale}): undermenyen under Deltakere viser ord, ikke nøkler`, async ({ page }) => {
      await mockAlt(page, locale);
      await page.goto(side);
      await forventUndermenyMedOrd(page, locale);
    });
  }
}
