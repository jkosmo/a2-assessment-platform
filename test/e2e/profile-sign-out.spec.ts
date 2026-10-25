import { test, expect, type Page, type Route } from "@playwright/test";

// 2.104.0 — «Logg ut».
//
// Produkteier, 2026-10-25: «Hvordan får jeg logget meg ut, jeg er inne med jko@a-2.no … og det er ikke
// noe konsistent måte å bytte til joakim.kosmo@gmail.com». Appen hadde ingen «Logg ut» utenom
// samtykkevinduet, og den knappen sendte bare til forsiden — der man ble logget inn igjen.
//
// Lokalt kjører appen uten Entra, så Microsoft-utloggingen kan ikke prøves her. Det som måles: knappen
// finnes og gjør noe, og NESTE innlogging ber om kontovelgeren — én gang, ikke i hver ny fane.

async function mockProfile(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "p-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill(json({ user: { id: "p-1", name: "P", email: "p@x.no", roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/modules/completed**", (route: Route) => route.fulfill(json({ modules: [] })));
  await page.route("**/api/courses/completions**", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem("satt")) { localStorage.setItem("participant.locale", "nb"); sessionStorage.setItem("satt", "1"); } } catch { /* ignore */ } });
}

const loginRequest = (page: Page) =>
  page.evaluate(async (modul) => (await import(modul)).loginRequestFor(["api://x/.default"]), "/static/api-client.js");

test("profilsiden har «Logg ut», og etter den spør neste innlogging hvilken konto — én gang", async ({ page }) => {
  await mockProfile(page);
  await page.goto("/profile");
  const knapp = page.locator("#signOutBtn");
  await expect(knapp).toBeVisible();
  await expect(knapp).toHaveText("Logg ut");

  // Kontroll: før utlogging er innloggingen vanlig — ingen kontovelger i hver ny fane.
  expect(await loginRequest(page)).toEqual({ scopes: ["api://x/.default"] });

  await knapp.click();
  await page.waitForURL((url) => url.pathname === "/");
  expect(await page.evaluate(() => localStorage.getItem("a2.auth.chooseAccount"))).toBe("1");
  expect(await loginRequest(page)).toEqual({ scopes: ["api://x/.default"], prompt: "select_account" });
  // Brukt én gang: innloggingen etter den igjen er vanlig.
  expect(await loginRequest(page)).toEqual({ scopes: ["api://x/.default"] });
});

test("samtykkevinduets «Logg ut» logger ut — det sendte bare til forsiden", async ({ page }) => {
  await mockProfile(page);
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "p-1", name: "P", email: "p@x.no", roles: ["PARTICIPANT"] }, consent: { accepted: false, currentVersion: "1.0" } }) }));
  await page.route("**/api/me/consent", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "1.0", body: "Personvern.", changelog: [], platformName: "A-2", dpoName: "P", dpoEmail: "p@x.no" }) }));
  await page.goto("/profile");
  const knapp = page.locator("#consent-logout-btn");
  await expect(knapp).toBeVisible();
  await knapp.click();
  await page.waitForURL((url) => url.pathname === "/");
  expect(await page.evaluate(() => localStorage.getItem("a2.auth.chooseAccount"))).toBe("1");
});
