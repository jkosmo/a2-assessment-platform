import { test, expect, type Page, type Route } from "@playwright/test";
import { revealRowAction } from "./admin-content-helpers.js";

// #1095 oppfølging: en kursoppdatering legger en ny, upublisert versjon på en seksjon som er
// publisert. Lista og redigereren viste da bare «Avpubliser», og «Lagre» var grå uten endring — den
// nye versjonen kunne ikke publiseres uten omvei. Nå: «Publiser ny versjon» i lista og i redigereren,
// og merket «Nyere utkast» i redigererens hode. Serveren aktiverer nyeste versjon (publishSection).

async function mockBase(page: Page) {
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
}

const tittel = JSON.stringify({ nb: "Tilbud: prompter", nn: "Tilbod: prompter", "en-GB": "Bids: prompts" });
const rad = (id: string, lifecycle: string) => ({ id, title: tittel, activeVersionId: "v1", archivedAt: null, versionNo: 2, courseCount: 1, updatedAt: "2026-10-13T08:00:00.000Z", lifecycle, canManage: true });

test.describe("#1095 — publiser den nye versjonen av en publisert seksjon", () => {
  test("lista: «Publiser ny versjon» står først for en seksjon med nyere utkast, og publiserer; uten nyere utkast finnes knappen ikke", async ({ page }) => {
    await mockBase(page);
    let liste = [rad("sec-ny", "published_with_draft"), rad("sec-lik", "published")];
    await page.route("**/api/admin/content/sections", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: liste }) }),
    );
    const publisert: string[] = [];
    await page.route("**/api/admin/content/sections/*/publish", (route: Route) => {
      const id = route.request().url().split("/").slice(-2)[0]!;
      publisert.push(id);
      liste = liste.map((s) => (s.id === id ? { ...s, lifecycle: "published" } : s));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id, activeVersionId: "v2", hasUnpublishedChanges: false } }) });
    });

    await page.goto("/admin-content/sections");
    const knapp = page.locator('[data-action="publish-new"][data-id="sec-ny"]');
    await expect(knapp).toBeVisible();
    await expect(knapp).toHaveText("Publiser ny versjon");
    await expect(page.locator('[data-action="publish-new"][data-id="sec-lik"]')).toHaveCount(0);
    // Den står synlig (ikke under «Mer»): den er rett i raden.
    expect(await knapp.evaluate((el) => Boolean(el.closest("details.row-more")))).toBe(false);

    await knapp.click();
    await expect.poll(() => publisert).toEqual(["sec-ny"]);
    await expect(page.locator(".toast__message")).toContainText("Ny versjon publisert.");
    await expect(page.locator('[data-action="publish-new"]')).toHaveCount(0);
    // «Avpubliser» finnes fortsatt for den publiserte seksjonen.
    await expect(await revealRowAction(page, page.locator('[data-action="unpublish"][data-id="sec-ny"]'))).toHaveCount(1);
  });

  test("redigereren: merket «Nyere utkast» og «Publiser ny versjon»; etter publisering er begge borte", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/admin/content/sections", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad("sec-ny", "published_with_draft")] }) }),
    );
    let venter = true;
    await page.route("**/api/admin/content/sections/sec-ny", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ section: { id: "sec-ny", title: tittel, bodyMarkdown: JSON.stringify({ nb: "Ny tekst", nn: "Ny tekst", "en-GB": "New text" }), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: venter, assets: [] } }),
      }),
    );
    let publiseringer = 0;
    await page.route("**/api/admin/content/sections/sec-ny/publish", (route: Route) => {
      publiseringer += 1;
      venter = false;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-ny", activeVersionId: "v2", archivedAt: null, hasUnpublishedChanges: false } }) });
    });

    await page.goto("/admin-content/sections?id=sec-ny");
    await expect(page.locator(".status-chip")).toHaveText("Nyere utkast");
    const knapp = page.locator("#sectionPublishNewBtn");
    await expect(knapp).toBeVisible();
    await expect(knapp).toHaveText("Publiser ny versjon");

    await knapp.click();
    await expect.poll(() => publiseringer).toBe(1);
    await expect(page.locator(".toast__message")).toContainText("Ny versjon publisert.");
    await expect(page.locator("#sectionPublishNewBtn")).toHaveCount(0);
    await expect(page.locator(".status-chip")).toHaveCount(0);
  });

  test("redigereren: en publisert seksjon uten nyere versjon har ingen slik knapp", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/admin/content/sections", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad("sec-lik", "published")] }) }),
    );
    await page.route("**/api/admin/content/sections/sec-lik", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-lik", title: tittel, bodyMarkdown: JSON.stringify({ nb: "Tekst", nn: "Tekst", "en-GB": "Text" }), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: false, assets: [] } }) }),
    );
    await page.goto("/admin-content/sections?id=sec-lik");
    await expect(page.locator("#formPageTitle")).toBeVisible();
    await expect(page.locator("#sectionPublishNewBtn")).toHaveCount(0);
    await expect(page.locator(".status-chip")).toHaveCount(0);
  });
});
