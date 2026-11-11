import { test, expect, type Page, type Route } from "@playwright/test";

// #1139 skive 2 (doc/design/PLAN_1139.md, punkt 5 og 9): bryteren «Ukentlig e-post fra båten» på profilen. Vises bare når tjeneren
// sender `preferences`; lagres med en gang; feiler lagringen, settes bryteren tilbake.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockProfile(page: Page, preferences: unknown) {
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
    route.fulfill(json({ user: { id: "p-1", name: "P", email: "p@x.no", roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" }, ...(preferences === undefined ? {} : { preferences }) })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses/completions**", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

test("bryteren står på og lagres av med en gang; «Lagret.»; PUT sender bare innstillingen", async ({ page }) => {
  await mockProfile(page, { weeklyEmail: true });
  const sent: unknown[] = [];
  await page.route("**/api/me/preferences", async (route: Route) => {
    sent.push(route.request().postDataJSON());
    expect(route.request().method()).toBe("PUT");
    await route.fulfill(json({ preferences: { weeklyEmail: false } }));
  });
  await page.goto("/profile");
  const toggle = page.getByRole("switch", { name: "Ukentlig e-post fra båten" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.locator("#weeklyEmailStatus")).toHaveText("Lagret.");
  await expect(toggle).not.toBeChecked();
  expect(sent).toEqual([{ weeklyEmail: false }]);
});

test("feiler lagringen, settes bryteren tilbake, og meldingen sier det", async ({ page }) => {
  await mockProfile(page, { weeklyEmail: true });
  await page.route("**/api/me/preferences", (route: Route) => route.fulfill(json({ error: "boom" }, 500)));
  await page.goto("/profile");
  const toggle = page.getByRole("switch", { name: "Ukentlig e-post fra båten" });
  await toggle.click();
  await expect(page.locator("#weeklyEmailStatus")).toHaveText("Kunne ikke lagre. Prøv igjen.");
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
});

test("avslått fra før vises avslått; en eldre tjener uten `preferences` gir ingen bryter", async ({ page }) => {
  await mockProfile(page, { weeklyEmail: false });
  await page.goto("/profile");
  await expect(page.getByRole("switch", { name: "Ukentlig e-post fra båten" })).not.toBeChecked();

  const old = await page.context().newPage();
  await mockProfile(old, undefined);
  await old.goto("/profile");
  await expect(old.locator("#profileName")).toHaveText("P");
  await expect(old.locator("#profileEmailSection")).toBeHidden();
});
