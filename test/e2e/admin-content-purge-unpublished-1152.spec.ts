import { test, expect, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1152 (QA-porten 4a): «Rydd upubliserte» sletter bare det dialogen viste.
//
// Før laget tjeneren kandidatlista på nytt da administratoren bekreftet, og slettet alt i den: en modul som ble laget mens dialogen
// sto åpen, forsvant uten at noen så den. Nå sender klienten id-ene den viste som «slettes» (`expectedModuleIds`), og en side uten
// lista får `409 purge_confirmation_outdated`. Testen fester klientlaget: hva som sendes, og at avslaget vises på forfatterens språk.
// At tjeneren bare sletter de viste, festes i test/m2-content-delete-1152.test.ts.

const PREVIEW = {
  candidates: [
    { id: "mod-shown", title: "Vist modul", updatedAt: "2026-11-01T00:00:00.000Z", submissions: 0, courseModules: 0, courseDrafts: 0, versions: 0, reasonSkipped: null },
    { id: "mod-skipped", title: "Hoppes over", updatedAt: "2026-11-01T00:00:00.000Z", submissions: 2, courseModules: 0, courseDrafts: 0, versions: 1, reasonSkipped: "2 submissions" },
  ],
};

async function openPurge(page: Page, purgeResponse: { status: number; body: object }) {
  await mockCommonApis(page, { libraryModules: [], meRoles: ["ADMINISTRATOR"] });
  await page.route("**/api/admin/content/modules/purge-unpublished/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PREVIEW) }));
  const bodies: unknown[] = [];
  await page.route("**/api/admin/content/modules/purge-unpublished", (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: purgeResponse.status, contentType: "application/json", body: JSON.stringify(purgeResponse.body) });
  });
  await page.goto("/admin-content-library.html");
  await page.locator("#purgeUnpublishedBtn").click();
  await expect(page.locator("#purgeDeleteList")).toContainText("Vist modul");
  await page.locator("#purgeConfirmInput").fill("SLETT");
  await page.locator("#purgeConfirmBtn").click();
  return bodies;
}

test.describe("#1152 — «Rydd upubliserte» sletter bare det dialogen viste", () => {
  test("bekreftelsen sender id-ene som ble vist som «slettes», ikke de som hoppes over", async ({ page }) => {
    const bodies = await openPurge(page, { status: 200, body: { deleted: [{ id: "mod-shown", title: "Vist modul" }], skipped: [], failed: [] } });
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ confirmation: "SLETT", expectedModuleIds: ["mod-shown"] });
    await expect(page.locator("#purgeUnpublishedDialog")).not.toBeVisible();
  });

  test("409 purge_confirmation_outdated: teksten på forfatterens språk, ikke tjenerens, og dialogen står", async ({ page }) => {
    const bodies = await openPurge(page, { status: 409, body: { error: "purge_confirmation_outdated", message: "SERVERTEKST outdated" } });
    await expect.poll(() => bodies.length).toBe(1);
    const error = page.locator("#purgeError");
    await expect(error).toContainText("This page is from an older version and did not send the list of modules it showed. Reload the page and try again. Nothing was deleted.");
    await expect(error).not.toContainText("SERVERTEKST");
    await expect(page.locator("#purgeUnpublishedDialog")).toBeVisible();
  });
});
