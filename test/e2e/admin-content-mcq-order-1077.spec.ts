import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { mockCommonApis, localizedText, buildMockModuleExport } from "./admin-content-helpers.js";

// #1077 leveranse 2: forfatteren lager og redigerer «sett i riktig rekkefølge». Det som måles: et lagret
// spørsmål åpnes med avkrysningen på og elementene nummerert i riktig rekkefølge, uten valg av fasit;
// avkrysningen gjør et vanlig spørsmål om på stedet; lagringen sender typen og elementene i den
// rekkefølgen de står — også etter oversettelsen; og et spørsmål med for få elementer stoppes før
// oversettelsen. «Flere riktige svar» og «Sett i riktig rekkefølge» utelukker hverandre.

const STEPS = ["Receive", "Assess", "Decide", "Archive"].map((s) => localizedText(s));

function moduleWith(question: Record<string, unknown>) {
  return buildMockModuleExport({
    id: "module-1",
    title: "Cases",
    moduleVersionId: "module-1-version-1",
    taskText: localizedText("Scenario"),
    mcqQuestions: [question as never],
  });
}

async function captureSave(page: import("@playwright/test").Page) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saved: { payload: any } = { payload: null };
  await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
    saved.payload = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }) });
  });
  return saved;
}

const itemValues = (page: import("@playwright/test").Page) =>
  page.locator('[data-preview-edit-question="0"] [data-preview-edit-option]').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));

test.describe("#1077 leveranse 2 — «sett i riktig rekkefølge» i editoren", () => {
  test("et lagret spørsmål åpnes nummerert i riktig rekkefølge, uten valg av fasit", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ questionType: "order", stem: localizedText("Order the steps"), options: STEPS, correctAnswer: STEPS[0], rationale: localizedText("Why") }) },
    });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator('[data-preview-edit-order="0"]')).toBeChecked();
    await expect(page.locator('[data-preview-edit-multiple="0"]')).not.toBeChecked();
    await expect(page.locator('input[name="previewEditCorrectAnswer0"]')).toHaveCount(0);
    expect(await itemValues(page)).toEqual(["Receive (EN)", "Assess (EN)", "Decide (EN)", "Archive (EN)"]);
    await expect(page.locator('[data-preview-edit-question="0"] .preview-edit-order-number').first()).toHaveText("1.");
  });

  test("avkrysningen gjør et vanlig spørsmål om, et element legges til, og lagringen sender typen og rekkefølgen", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("Order the steps"), options: STEPS.slice(0, 3), correctAnswer: STEPS[0], rationale: localizedText("Why") }) },
    });
    const saved = await captureSave(page);
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    await page.locator('[data-preview-edit-order="0"]').check();
    await expect(page.locator('input[name="previewEditCorrectAnswer0"]')).toHaveCount(0);
    expect(await itemValues(page)).toEqual(["Receive (EN)", "Assess (EN)", "Decide (EN)"]);

    await page.locator('[data-add-order-item="0"]').click();
    await page.locator("#previewEditMcqOption0_3").fill("Archive");
    // Forfatteren bytter de to midterste: rekkefølgen i skjemaet ER fasiten.
    await page.locator("#previewEditMcqOption0_1").fill("Decide");
    await page.locator("#previewEditMcqOption0_2").fill("Assess");

    await page.locator("#formSaveBtn").click();
    await expect.poll(() => saved.payload).not.toBeNull();
    const question = saved.payload.mcqSet?.questions?.[0];
    expect(question?.questionType).toBe("order");
    expect(question?.correctAnswers).toBeUndefined();
    expect(question.options.map((o: Record<string, string> | string) => (typeof o === "string" ? o : o["en-GB"]))).toEqual(["Receive (EN)", "Decide", "Assess", "Archive"]);
  });

  test("for få elementer stoppes før oversettelsen, med en melding som sier hvilket spørsmål", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("Order the steps"), options: STEPS.slice(0, 2), correctAnswer: STEPS[0], rationale: localizedText("Why") }) },
    });
    const saved = await captureSave(page);
    let translated = false;
    page.on("request", (r) => { if (r.url().includes("/api/") && r.url().includes("/localize")) translated = true; });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator('[data-preview-edit-order="0"]').check();
    // Tre felt vises alltid; det tredje står tomt og tas ikke med.
    expect(await itemValues(page)).toEqual(["Receive (EN)", "Assess (EN)", ""]);
    await page.locator("#formSaveBtn").click();
    await expect(page.getByText(/Question 1 is «put in the right order» and needs 3 to 6 items/).first()).toBeVisible();
    expect(saved.payload).toBeNull();
    expect(translated).toBe(false);
  });

  test("«Flere riktige svar» og «Sett i riktig rekkefølge» utelukker hverandre", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("Order the steps"), options: STEPS, correctAnswer: STEPS[0], rationale: localizedText("Why") }) },
    });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator('[data-preview-edit-multiple="0"]').check();
    await page.locator('[data-preview-edit-order="0"]').check();
    await expect(page.locator('[data-preview-edit-multiple="0"]')).not.toBeChecked();
    await page.locator('[data-preview-edit-multiple="0"]').check();
    await expect(page.locator('[data-preview-edit-order="0"]')).not.toBeChecked();
    // Tilbake til valg av fasit, med avkrysning.
    for (const input of await page.locator('input[name="previewEditCorrectAnswer0"]').all()) await expect(input).toHaveAttribute("type", "checkbox");
  });
});
