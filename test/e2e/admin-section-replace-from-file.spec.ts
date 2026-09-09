import { test, expect, type Page, type Route } from "@playwright/test";

// #1012: erstatt innholdet i en EKSISTERENDE seksjon fra fil.
//
// ⚠️ Påstanden er på HVA som sendes, ikke på at knappen finnes. Klienten kunne importere fra før,
// men sendte `mode: "createNew"` hardkodet — så en knapp som «virket» ville laget en ny seksjon i
// stedet for å erstatte den man står i. En test som bare klikker og ser at kallet gikk, ville vært
// grønn for nøyaktig den feilen.

const SECTION = {
  id: "sec-1",
  title: JSON.stringify({ "en-GB": "Quality assurance", nb: "Kvalitetssikring", nn: "Kvalitetssikring" }),
  bodyMarkdown: JSON.stringify({ "en-GB": "# Before", nb: "# Før", nn: "# Før" }),
  activeVersionId: "ver-1",
  versionNo: 3,
  hasUnpublishedChanges: false,
  updatedAt: "2026-08-27T08:00:00.000Z",
  archivedAt: null,
};

async function mockAuthoring(page: Page) {
  await page.route("**/participant/config", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
      calibrationWorkspace: { accessRoles: [] },
    }),
  }));
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"version":"test"}' }));
  await page.route("**/api/me", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }),
  }));
  await page.route("**/api/admin/content/sections/sec-1", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ section: SECTION }),
  }));
  await page.route("**/api/admin/content-owners**", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }),
  }));
}

const PACKAGE = JSON.stringify({
  scope: "section",
  section: { title: { "en-GB": "After", nb: "Etter", nn: "Etter" }, bodyMarkdown: { "en-GB": "# After", nb: "# Etter", nn: "# Etter" } },
});

test.describe("#1012 — erstatt seksjonsinnhold fra fil", () => {
  test("knappen sender replaceExisting med targetId, ikke createNew", async ({ page }) => {
    await mockAuthoring(page);

    // ⚠️ Holderobjekt, ikke en `let`. TypeScript smalner en `let` som bare tilordnes inne i en
    // closure til `never` ved lesing etterpå, og påstanden slutter å typesjekke.
    const captured: { body: { mode?: string; targetId?: string } | null } = { body: null };
    await page.route("**/api/admin/content/sections/import", (route: Route) => {
      captured.body = JSON.parse(route.request().postData() ?? "{}") as { mode?: string; targetId?: string };
      return route.fulfill({
        status: 201, contentType: "application/json",
        body: JSON.stringify({ sectionId: "sec-1", sectionVersionId: "ver-2", assetCount: 0 }),
      });
    });

    // Bekreftelsen står foran handlingen med vilje — «erstatt» leses som noe som ikke kan angres.
    page.on("dialog", (d) => d.accept());

    await page.goto("/admin-content/sections?id=sec-1");
    await page.waitForSelector("#replaceFromFileBtn");

    await page.locator("#replaceFromFileInput").setInputFiles({
      name: "seksjon.json", mimeType: "application/json", buffer: Buffer.from(PACKAGE, "utf8"),
    });

    await expect.poll(() => captured.body?.mode).toBe("replaceExisting");
    expect(captured.body?.targetId).toBe("sec-1");
  });

  test("knappen finnes IKKE for en ny seksjon — «erstatt» har ingenting å erstatte", async ({ page }) => {
    await mockAuthoring(page);
    await page.goto("/admin-content/sections?new");
    await page.waitForSelector("#saveBtn");

    // ⚠️ Krev at LAGRE-knappen finnes først. Uten den ville påstanden under vært sann bare fordi
    // siden aldri rendret redigeringen — «finnes ikke» og «ble aldri lastet» ser like ut.
    await expect(page.locator("#saveBtn")).toHaveCount(1);
    await expect(page.locator("#replaceFromFileBtn")).toHaveCount(0);
  });

  test("en modulpakke avvises med en beskjed som peker videre, ikke en rå serverfeil", async ({ page }) => {
    await mockAuthoring(page);

    let importCalled = false;
    await page.route("**/api/admin/content/sections/import", (route: Route) => {
      importCalled = true;
      return route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"scope_mismatch"}' });
    });
    page.on("dialog", (d) => d.accept());

    await page.goto("/admin-content/sections?id=sec-1");
    await page.waitForSelector("#replaceFromFileBtn");

    await page.locator("#replaceFromFileInput").setInputFiles({
      name: "modul.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ scope: "module", module: {} }), "utf8"),
    });

    // Vakten skal stoppe fila FØR den når serveren.
    await expect(page.locator(".toast, [role='status'], [role='alert']").first()).toBeVisible({ timeout: 5000 });
    expect(importCalled).toBe(false);
  });
});
