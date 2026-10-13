import { test, expect, type Page, type Route } from "@playwright/test";

// #1096: under Deltakere viste undermenyen rå nøkler (`area.classes`, `area.status`, …) i prod.
// Ordene kommer fra `content-area-nav-i18n.js` (admin-buntens `area.*`), men sidene Status,
// Resultater og Manuell behandling oversatte ALLE `[data-i18n]` med sin egen bunt etterpå — og der
// finnes ikke `area.*`, så oversetteren ga nøkkelen tilbake og skrev den over menyteksten.

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

const FORVENTET: Record<string, Record<string, string>> = {
  nb: { subnavKlasser: "Klasser", subnavStatus: "Status", subnavReview: "Manuell behandling", subnavResults: "Resultater" },
  nn: { subnavKlasser: "Klassar", subnavStatus: "Status", subnavReview: "Manuell behandling", subnavResults: "Resultat" },
  "en-GB": { subnavKlasser: "Classes", subnavStatus: "Status", subnavReview: "Manual review", subnavResults: "Results" },
};

for (const side of ["/deltakere/status", "/results", "/review"]) {
  for (const locale of ["nb", "nn", "en-GB"]) {
    test(`${side} (${locale}): undermenyen under Deltakere viser ord, ikke nøkler`, async ({ page }) => {
      await mockAlt(page, locale);
      await page.goto(side);
      const nav = page.locator("#deltakereSubnav");
      await expect(nav).toBeVisible();
      // Gi sidens egen oversettelse tid til å kjøre (den gikk etter menyens og skrev over den).
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      for (const [id, tekst] of Object.entries(FORVENTET[locale]!)) {
        const lenke = page.locator(`#${id}`);
        if ((await lenke.count()) === 0) continue; // rollestyrt bort
        await expect(lenke).toHaveText(tekst);
      }
      const alle = await nav.locator("a").allInnerTexts();
      expect(alle.filter((t) => t.trim().startsWith("area.")), "rå nøkler i undermenyen").toEqual([]);
    });
  }
}
