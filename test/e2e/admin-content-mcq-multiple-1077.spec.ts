import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { mockCommonApis, localizedText, buildMockModuleExport } from "./admin-content-helpers.js";

// #1077: forfatteren lager og redigerer «velg alle som stemmer» i redigeringsskjemaet. Det som måles:
// et lagret «velg alle» åpnes med bryteren på og alle de riktige avkrysset; bryteren gjør et vanlig
// spørsmål om til et «velg alle» på stedet; og lagringen sender typen og ALLE de riktige — også etter
// at spørsmålet har gått gjennom oversettelsen, der typen tidligere ville blitt borte.

const A = localizedText("Purpose");
const B = localizedText("Colour");
const C = localizedText("Legal basis");
const D = localizedText("Font");

function moduleWith(question: Record<string, unknown>) {
  const mod = buildMockModuleExport({
    id: "module-1",
    title: "Records",
    moduleVersionId: "module-1-version-1",
    taskText: localizedText("Scenario"),
    mcqQuestions: [question as never],
  });
  return mod;
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

test.describe("#1077 — «velg alle som stemmer» i editoren", () => {
  test("et lagret «velg alle» åpnes med bryteren på og alle de riktige avkrysset", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Records" }],
      moduleExports: { "module-1": moduleWith({ questionType: "multiple", stem: localizedText("What must the record state?"), options: [A, B, C, D], correctAnswers: [A, C], correctAnswer: A, rationale: localizedText("Art. 30") }) },
    });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    await expect(page.locator('[data-preview-edit-multiple="0"]')).toBeChecked();
    const correct = page.locator('input[name="previewEditCorrectAnswer0"]');
    await expect(correct).toHaveCount(4);
    for (const input of await correct.all()) await expect(input).toHaveAttribute("type", "checkbox");
    await expect(correct.nth(0)).toBeChecked();
    await expect(correct.nth(1)).not.toBeChecked();
    await expect(correct.nth(2)).toBeChecked();
    await expect(correct.nth(3)).not.toBeChecked();
  });

  test("bryteren gjør et vanlig spørsmål om til «velg alle», og lagringen sender typen og alle de riktige", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Records" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("What must the record state?"), options: [A, B, C, D], correctAnswer: A, rationale: localizedText("Art. 30") }) },
    });
    const saved = await captureSave(page);
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    const toggle = page.locator('[data-preview-edit-multiple="0"]');
    const correct = page.locator('input[name="previewEditCorrectAnswer0"]');
    await expect(toggle).not.toBeChecked();
    await expect(correct.first()).toHaveAttribute("type", "radio");

    await toggle.check();
    for (const input of await correct.all()) await expect(input).toHaveAttribute("type", "checkbox");
    // Det som var riktig, står fortsatt avkrysset; ett til legges til.
    await expect(correct.nth(0)).toBeChecked();
    await correct.nth(2).check();
    await expect(correct.nth(0)).toBeChecked();

    await page.locator("#formSaveBtn").click();
    await expect.poll(() => saved.payload).not.toBeNull();
    const question = saved.payload.mcqSet?.questions?.[0];
    expect(question?.questionType).toBe("multiple");
    expect(question?.correctAnswers).toHaveLength(2);
    // Fasiten er de to alternativene på plass 0 og 2 — på alle språk, ikke bare det som ble redigert.
    expect(question.correctAnswers[0]).toEqual(question.options[0]);
    expect(question.correctAnswers[1]).toEqual(question.options[2]);
  });

  test("kontroll: tilbake til ett riktig svar beholder det første avkryssede, og lagres som vanlig spørsmål", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Records" }],
      moduleExports: { "module-1": moduleWith({ questionType: "multiple", stem: localizedText("What must the record state?"), options: [A, B, C, D], correctAnswers: [B, C], correctAnswer: B, rationale: localizedText("Art. 30") }) },
    });
    const saved = await captureSave(page);
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    await page.locator('[data-preview-edit-multiple="0"]').uncheck();
    const correct = page.locator('input[name="previewEditCorrectAnswer0"]');
    await expect(correct.first()).toHaveAttribute("type", "radio");
    await expect(correct.nth(1)).toBeChecked();
    await expect(correct.nth(2)).not.toBeChecked();

    await page.locator("#formSaveBtn").click();
    await expect.poll(() => saved.payload).not.toBeNull();
    const question = saved.payload.mcqSet?.questions?.[0];
    expect(question?.questionType ?? "single").toBe("single");
    expect(question?.correctAnswers).toBeUndefined();
    expect(question?.correctAnswer).toEqual(question.options[1]);
  });
});
