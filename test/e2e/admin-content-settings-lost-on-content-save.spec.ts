import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis, localizedText, buildMockModuleExport } from "./admin-content-helpers.js";

// Prod 2.154.0, forfatterens rekkefølge: kryss av i Innstillinger → Rediger → endre tittelen → Lagre.
// Innholdslagringen tok ikke med avkrysningen, og modulen ble lastet på nytt etterpå — avkrysningen
// var borte uten et ord (samme stille tap som FEATURE_SURFACE_MAP §20 beskriver). Det minste:
// forfatteren får vite det FØR noe forsvinner, og kan la være.

const A = localizedText("Purpose");
const B = localizedText("Colour");
const C = localizedText("Legal basis");
const D = localizedText("Font");
const multiple = { questionType: "multiple", stem: localizedText("Which ones?"), options: [A, B, C, D], correctAnswers: [A, C], correctAnswer: A, rationale: localizedText("Art. 30") };

async function tickThenEditTitle(page: Page) {
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Test: Frihet under ansvar", activeVersion: { versionNo: 1 } }],
    moduleExports: {
      "module-1": buildMockModuleExport({
        id: "module-1", title: "Test: Frihet under ansvar", moduleVersionId: "module-1-version-1", activeVersionId: "module-1-version-1",
        assessmentMode: "FREETEXT_PLUS_MCQ", mcqQuestions: [multiple as never],
      }),
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posts: any[] = [];
  await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ moduleVersion: { id: `module-1-version-${posts.length + 1}`, versionNo: posts.length + 1 } }) });
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#previewEditTitle").waitFor();
  await page.locator("#formTab-settings").click();
  await page.locator("#settingsMcqReview").check();
  await page.locator("#formTab-edit").click();
  await page.locator("#previewEditTitle").fill("Test: Frihet under ansvar 2");
  return posts;
}

const settingsLost = /unsaved changes in Settings|ulagrede endringer i Innstillinger|ulagra endringar i Innstillingar/;

test.describe("prod 2.154.0: ulagrede innstillinger ved lagring fra Rediger", () => {
  test("Lagre i Rediger spør først; nei lagrer ingenting og beholder avkrysningen", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    const posts = await tickThenEditTitle(page);
    await page.locator("#formSaveBtn").click();

    await expect.poll(() => dialogs.length, { message: "ingen advarsel før innstillingene gikk tapt" }).toBe(1);
    expect(dialogs[0]).toMatch(settingsLost);
    await page.waitForTimeout(1000);
    expect(posts).toHaveLength(0);
    await page.locator("#formTab-settings").click();
    await expect(page.locator("#settingsMcqReview")).toBeChecked();
  });

  test("ja lagrer innholdet én gang, og Innstillinger kan lagres etterpå", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.accept(); });
    const posts = await tickThenEditTitle(page);
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);
    expect(dialogs.some((m) => settingsLost.test(m))).toBe(true);

    // Tilstanden forfatteren står i etter lagringen: Rediger → Innstillinger, kryss av, Lagre.
    await expect(page.locator("#previewEditTitle")).toBeVisible();
    await page.locator("#formTab-settings").click();
    await expect(page.locator("#tabPanelSettings")).not.toContainText(/unsaved draft in Edit|ulagret utkast i Rediger/);
    await page.locator("#settingsMcqReview").check();
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => posts.length, { timeout: 5000 }).toBe(2);
    expect(posts[1].assessmentPolicy?.mcq?.reviewAfterSubmit).toBe(true);
  });
});
