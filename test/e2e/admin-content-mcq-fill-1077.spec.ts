import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { mockCommonApis, localizedText, buildMockModuleExport } from "./admin-content-helpers.js";

// #1077 leveranse 3: forfatteren lager og redigerer «fyll inn ordet som mangler». Det som måles: et lagret
// spørsmål åpnes med avkrysningen på og de godkjente svarene i feltene, uten valg av fasit; avkrysningen
// gjør et vanlig spørsmål om på stedet; lagringen sender typen og svarene; og et spørsmål uten lukke
// stoppes før oversettelsen. De tre typene utelukker hverandre.

const ANSWERS = ["three", "3"].map((s) => localizedText(s));

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

const answerValues = (page: import("@playwright/test").Page) =>
  page.locator('[data-preview-edit-question="0"] [data-preview-edit-option]').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));

test.describe("#1077 leveranse 3 — «fyll inn ordet som mangler» i editoren", () => {
  test("et lagret spørsmål åpnes med de godkjente svarene, uten valg av fasit", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ questionType: "fill", stem: localizedText("The deadline is ___ weeks"), options: ANSWERS, correctAnswer: ANSWERS[0], rationale: localizedText("Why") }) },
    });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator('[data-preview-edit-fill="0"]')).toBeChecked();
    await expect(page.locator('[data-preview-edit-order="0"]')).not.toBeChecked();
    await expect(page.locator('[data-preview-edit-multiple="0"]')).not.toBeChecked();
    await expect(page.locator('input[name="previewEditCorrectAnswer0"]')).toHaveCount(0);
    expect(await answerValues(page)).toEqual(["three (EN)", "3 (EN)"]);
  });

  test("avkrysningen gjør et vanlig spørsmål om, et svar legges til, og lagringen sender typen og svarene", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("The deadline is ___ weeks"), options: [localizedText("three"), localizedText("four")], correctAnswer: localizedText("three"), rationale: localizedText("Why") }) },
    });
    const saved = await captureSave(page);
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    await page.locator('[data-preview-edit-fill="0"]').check();
    await expect(page.locator('input[name="previewEditCorrectAnswer0"]')).toHaveCount(0);
    // Det som var skrevet, blir de første godkjente svarene — forfatteren retter dem.
    expect(await answerValues(page)).toEqual(["three (EN)", "four (EN)"]);
    await page.locator("#previewEditMcqOption0_1").fill("3");
    await page.locator('[data-add-fill-answer="0"]').click();
    await page.locator("#previewEditMcqOption0_2").fill("tre");

    await page.locator("#formSaveBtn").click();
    await expect.poll(() => saved.payload).not.toBeNull();
    const question = saved.payload.mcqSet?.questions?.[0];
    expect(question?.questionType).toBe("fill");
    expect(question?.correctAnswers).toBeUndefined();
    expect(question.options.map((o: Record<string, string> | string) => (typeof o === "string" ? o : o["en-GB"]))).toEqual(["three (EN)", "3", "tre"]);
  });

  test("uten lukke i spørsmålet stoppes lagringen før oversettelsen, med en melding som sier hvilket spørsmål", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("The deadline is three weeks"), options: ANSWERS, correctAnswer: ANSWERS[0], rationale: localizedText("Why") }) },
    });
    const saved = await captureSave(page);
    let translated = false;
    page.on("request", (r) => { if (r.url().includes("/api/") && r.url().includes("/localize")) translated = true; });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator('[data-preview-edit-fill="0"]').check();
    await page.locator("#formSaveBtn").click();
    await expect(page.getByText(/Question 1 is «fill in» and needs exactly one blank/).first()).toBeVisible();
    expect(saved.payload).toBeNull();
    expect(translated).toBe(false);
  });

  test("de tre typene utelukker hverandre", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Cases" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("The deadline is ___ weeks"), options: ANSWERS, correctAnswer: ANSWERS[0], rationale: localizedText("Why") }) },
    });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator('[data-preview-edit-fill="0"]').check();
    await page.locator('[data-preview-edit-order="0"]').check();
    await expect(page.locator('[data-preview-edit-fill="0"]')).not.toBeChecked();
    await page.locator('[data-preview-edit-fill="0"]').check();
    await expect(page.locator('[data-preview-edit-order="0"]')).not.toBeChecked();
    await page.locator('[data-preview-edit-multiple="0"]').check();
    await expect(page.locator('[data-preview-edit-fill="0"]')).not.toBeChecked();
    for (const input of await page.locator('input[name="previewEditCorrectAnswer0"]').all()) await expect(input).toHaveAttribute("type", "checkbox");
  });
});
