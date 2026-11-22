import { test, expect, type Page, type Route } from "@playwright/test";

// #1159 — profilen var en blindvei for den som bare er deltaker. Lenka «Mine kurs» sto i siden, men regelen i shared.css
// skjulte menyen når den hadde færre enn to lenker. Nå skjules menyen bare når ingen lenke fører bort fra siden: på profilen
// fører «Mine kurs» tilbake, og står synlig, også på 390 px. Kjører de ekte sidene mot falske API-er, med menyen i den
// formen tjeneren lager den (`buildWorkspaceNavigationItems`).

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const NAV_ITEMS = [
  { id: "participant", path: "/participant", labelKey: "nav.participant", requiredRoles: [] },
  { id: "admin-content", path: "/admin-content/courses", labelKey: "nav.adminContent", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"], areaPaths: ["/admin-content"] },
  { id: "deltakere", path: "/deltakere/klasser", labelKey: "nav.deltakere", requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR", "REVIEWER", "APPEAL_HANDLER", "REPORT_READER"], areaPaths: ["/deltakere", "/review", "/results"] },
  { id: "admin-platform", path: "/admin-platform", labelKey: "nav.adminPlatform", requiredRoles: ["ADMINISTRATOR"] },
  { id: "profile", path: "/profile", labelKey: "nav.profile", requiredRoles: [] },
];

async function mock(page: Page, roles: string[]) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: NAV_ITEMS, workspaceItems: [] },
      identityDefaults: { participant: { userId: "p-1", email: "p@x.no", name: "P", department: "X", roles } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill(json({ user: { id: "p-1", name: "P", email: "p@x.no", roles }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/me/stats**", (route: Route) => route.fulfill(json({})));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses/completions**", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses", (route: Route) => route.fulfill(json({ courses: [] })));
}

for (const width of [1280, 390]) {
  test(`#1159 ${width} px: deltakeren ser «Mine kurs» på profilen, og lenka fører tilbake`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mock(page, ["PARTICIPANT"]);
    await page.goto("/profile");
    const back = page.locator("#workspaceNav a.workspace-nav-link", { hasText: "Mine kurs" });
    await expect(back).toHaveCount(1);
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/participant");
    // Lenka står innenfor skjermen, ikke rullet ut av en smal meny.
    const box = await back.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    await back.click();
    await expect(page).toHaveURL(/\/participant$/);
  });
}

test("#1159 kontroll: på «Mine kurs» er menyen fortsatt skjult for deltakeren — den eneste lenka er siden hen står på", async ({ page }) => {
  await mock(page, ["PARTICIPANT"]);
  await page.goto("/participant");
  await expect(page.locator("#profileNavLink")).toBeVisible();
  await expect(page.locator("#workspaceNav a.workspace-nav-link", { hasText: "Mine kurs" })).toHaveCount(1);
  await expect(page.locator("#workspaceNav")).toBeHidden();
});

test("#1159 kontroll: en innholdsprodusent ser hele menyen på profilen, som før", async ({ page }) => {
  await mock(page, ["PARTICIPANT", "SUBJECT_MATTER_OWNER"]);
  await page.goto("/profile");
  await expect(page.locator("#workspaceNav")).toBeVisible();
  await expect(page.locator("#workspaceNav a.workspace-nav-link")).toHaveCount(3);
});
