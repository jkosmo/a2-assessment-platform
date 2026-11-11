import { test, expect, type Page, type Route } from "@playwright/test";

// #1139: «Send til meg nå» på administratorsiden (produkteier 2026-11-11). Påstanden er på HVILKEN rute knappen treffer og hva
// som står etterpå, som i admin-failed-assessments.spec.ts.

async function mockAdminApis(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "admin-1", email: "admin@x.no", name: "Admin", roles: ["ADMINISTRATOR"] } },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["ADMINISTRATOR"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/admin/platform", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ platformName: "A2", consentBody: {}, certificateBackground: false }) }),
  );
  await page.route("**/api/admin/platform/failed-assessments", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ failedAssessments: [] }) }),
  );
}

async function clickSend(page: Page, reply: { status: number; body: unknown }) {
  const calls: string[] = [];
  await page.route("**/api/admin/platform/weekly-email/send-to-me", (route: Route) => {
    calls.push(route.request().method());
    return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  await page.addInitScript(() => localStorage.setItem("participant.locale", "nb"));
  await page.goto("/admin-platform");
  await page.getByRole("button", { name: "Send til meg nå" }).click();
  return calls;
}

test.describe("#1139 — ukens e-post til meg selv", () => {
  test("sendt: POST til ruta, og beskjeden står", async ({ page }) => {
    await mockAdminApis(page);
    const calls = await clickSend(page, { status: 200, body: { sent: true } });
    await expect(page.locator("#weeklyEmailFeedback")).toHaveText("Sendt til e-postadressen din.");
    expect(calls).toEqual(["POST"]);
    await expect(page.getByRole("button", { name: "Send til meg nå" })).toBeEnabled();
  });

  test("ingenting utestående: sier det, ikke som feil", async ({ page }) => {
    await mockAdminApis(page);
    await clickSend(page, { status: 200, body: { sent: false, reason: "nothing_outstanding" } });
    await expect(page.locator("#weeklyEmailFeedback")).toHaveText("Du har ingenting utestående, så det er ingen e-post å sende.");
  });

  test("ikke levert: feilbeskjed med årsaken fra sendingen", async ({ page }) => {
    await mockAdminApis(page);
    await clickSend(page, { status: 200, body: { sent: false, reason: "not_delivered", detail: "channel_disabled" } });
    await expect(page.locator("#weeklyEmailFeedback")).toHaveText("E-posten ble ikke sendt. (channel_disabled)");
  });

  test("avbrutt underveis: kan ha gått, sjekk innboksen", async ({ page }) => {
    await mockAdminApis(page);
    await clickSend(page, { status: 200, body: { sent: false, reason: "uncertain", detail: "timeout" } });
    await expect(page.locator("#weeklyEmailFeedback")).toHaveText("Sendingen ble avbrutt, og e-posten kan ha gått. Sjekk innboksen før du prøver igjen.");
  });

  test("mens den sender: «Sender …» og knappen er av", async ({ page }) => {
    await mockAdminApis(page);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/admin/platform/weekly-email/send-to-me", async (route: Route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: true }) });
    });
    await page.addInitScript(() => localStorage.setItem("participant.locale", "nb"));
    await page.goto("/admin-platform");
    const button = page.getByRole("button", { name: "Send til meg nå" });
    await button.click();
    await expect(page.locator("#weeklyEmailFeedback")).toHaveText("Sender …");
    await expect(button).toBeDisabled();
    release();
    await expect(page.locator("#weeklyEmailFeedback")).toHaveText("Sendt til e-postadressen din.");
    await expect(button).toBeEnabled();
  });
});
