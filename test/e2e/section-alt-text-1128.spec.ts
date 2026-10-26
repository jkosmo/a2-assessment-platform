import { test, expect, type Page, type Route } from "@playwright/test";

// #1128: en seksjon lagres med et bilde der alt-teksten bare er en tittel — lagringen går gjennom, og
// kvitteringen sier hvilket bilde som mangler beskrivelse. Uten funn: den vanlige kvitteringen.

async function mockBase(page: Page, altWarnings: unknown[]) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>forhåndsvisning</p>" }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  const tittel = JSON.stringify({ nb: "Enhetstesting", nn: "Einingstesting", "en-GB": "Unit testing" });
  const sek = { id: "sec-x", title: tittel, bodyMarkdown: JSON.stringify({ nb: "Tekst", nn: "Tekst", "en-GB": "Text" }), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: false, assets: [] };
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [{ id: "sec-x", title: tittel, activeVersionId: "v1", archivedAt: null, versionNo: 1, courseCount: 0, updatedAt: "2026-10-26T08:00:00.000Z", lifecycle: "published", canManage: true }] }) }),
  );
  await page.route("**/api/admin/content/sections/sec-x", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: sek }) }));
  await page.route("**/api/admin/content/sections/sec-x/title", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: sek }) }));
  await page.route("**/api/admin/content/sections/sec-x/content", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: sek, altWarnings }) }),
  );
}

test("lagring med et bilde uten beskrivelse: lagret, og varselet nevner bildet", async ({ page }) => {
  await mockBase(page, [{ code: "alt_is_title", alt: "Enhetstest" }]);
  await page.goto("/admin-content/sections?id=sec-x");
  await page.locator("#markdownInput").fill("Slik ser testen ut.\n\n![Enhetstest](asset:a)");
  await page.locator("#formSaveBtn").click();
  await expect(page.locator(".toast--warning .toast__message").last()).toContainText("Noen bilder er ikke beskrevet:");
  await expect(page.locator(".toast--warning .toast__detail").last()).toContainText("Bildet «Enhetstest» har en tittel som beskrivelse.");
});

test("lagring uten funn: den vanlige kvitteringen", async ({ page }) => {
  await mockBase(page, []);
  await page.goto("/admin-content/sections?id=sec-x");
  await page.locator("#markdownInput").fill("Slik ser testen ut.");
  await page.locator("#formSaveBtn").click();
  await expect(page.locator(".toast__message").last()).toBeVisible();
  await expect(page.locator(".toast--warning")).toHaveCount(0);
});
