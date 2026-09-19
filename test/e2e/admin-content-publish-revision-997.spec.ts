import { expect, test, type Route } from "@playwright/test";
import { mockCommonApis, buildMockModuleExport } from "./admin-content-helpers.js";

// #997: forfatteren må ta stilling til om publiseringen er en REVISJON som gjør tidligere bestått
// ugyldig — og spørsmålet bærer tallet, fordi «ja» sender ett varsel per person.
//
// ⚠️ Påstanden er på HVA som sendes, ikke på at dialogen finnes. En dialog som alltid sender
// `true` (eller alltid `false`) ville sett riktig ut på skjermen og vært feil i databasen.

const MODULE = { id: "module-1" };

async function openModule(page: import("@playwright/test").Page, passedCount: number) {
  const moduleExport = buildMockModuleExport({
    id: MODULE.id,
    title: "Risikovurdering",
    moduleVersionId: "module-1-version-2",
  });
  const current = moduleExport.selectedConfiguration.moduleVersion;
  current.versionNo = 2;
  current.publishedAt = null;
  moduleExport.versions.moduleVersions = [
    current,
    { id: "module-1-version-1", versionNo: 1, createdAt: "2026-09-18T09:00:00.000Z", publishedAt: "2026-09-18T10:00:00.000Z" },
  ];

  await mockCommonApis(page, {
    modules: [{ id: MODULE.id, title: "Risikovurdering" }],
    moduleExports: { [MODULE.id]: moduleExport },
  });
  await page.route("**/api/admin/content/modules/*/passed-count", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ passedCount }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

/** Fanger kroppen publiseringen sender, og svarer som en vellykket publisering. */
function capturePublish(page: import("@playwright/test").Page) {
  const captured: { body: { supersedesEarlierPasses?: boolean } | null } = { body: null };
  void page.route("**/module-versions/*/publish", (route: Route) => {
    captured.body = JSON.parse(route.request().postData() ?? "{}") as { supersedesEarlierPasses?: boolean };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2, publishedAt: "2026-09-19T10:00:00.000Z" }, validationWarnings: [] }),
    });
  });
  return captured;
}

test.describe("#997 — publisering spør om dette er en revisjon", () => {
  test("med tidligere beståtte: spørsmålet viser tallet, og «Ja» sender flagget", async ({ page }) => {
    await openModule(page, 3);
    const captured = capturePublish(page);

    await page.goto(`/admin-content/module/${MODULE.id}/conversation`);
    await page.getByRole("button", { name: /^Publiser$/ }).click();

    const dialog = page.locator("#dialogChoice");
    await expect(dialog).toBeVisible();
    // Tallet er selve poenget: «ja» sender tre e-poster.
    await expect(page.locator("#dialogChoiceBody")).toContainText("3");
    await expect(page.locator("#dialogChoiceBody")).toContainText(/revisjon/i);
    // Publiseringen har IKKE skjedd ennå — spørsmålet kommer før handlingen.
    expect(captured.body).toBeNull();

    await page.getByRole("button", { name: /Ja — erstatt tidligere bestått/ }).click();
    await expect.poll(() => captured.body?.supersedesEarlierPasses).toBe(true);
  });

  test("«Nei» publiserer uten å erstatte", async ({ page }) => {
    await openModule(page, 3);
    const captured = capturePublish(page);

    await page.goto(`/admin-content/module/${MODULE.id}/conversation`);
    await page.getByRole("button", { name: /^Publiser$/ }).click();
    await expect(page.locator("#dialogChoice")).toBeVisible();
    await page.getByRole("button", { name: /Nei — tidligere bestått gjelder fortsatt/ }).click();

    await expect.poll(() => captured.body?.supersedesEarlierPasses).toBe(false);
  });

  test("har ingen bestått modulen, spørres det ikke — det er ingenting å erstatte", async ({ page }) => {
    await openModule(page, 0);
    const captured = capturePublish(page);

    await page.goto(`/admin-content/module/${MODULE.id}/conversation`);
    await page.getByRole("button", { name: /^Publiser$/ }).click();

    await expect.poll(() => captured.body?.supersedesEarlierPasses).toBe(false);
    await expect(page.locator("#dialogChoice")).toBeHidden();
  });
});
