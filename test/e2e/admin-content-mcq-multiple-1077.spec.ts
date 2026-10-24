import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { mockCommonApis, localizedText, buildMockModuleExport, clickEnabledButton } from "./admin-content-helpers.js";

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

  // Den felles regelen `input { width: 100% }` gjorde bryteren til en fullbredde stripe med teksten
  // på linja under. Boksen skal være liten og stå på linje med teksten.
  test("bryteren er en liten boks på linje med teksten", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Records" }],
      moduleExports: { "module-1": moduleWith({ stem: localizedText("What must the record state?"), options: [A, B, C, D], correctAnswer: A, rationale: localizedText("Art. 30") }) },
    });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    const box = (await page.locator('[data-preview-edit-multiple="0"]').boundingBox())!;
    const label = (await page.locator(".preview-edit-mcq-multiple").first().boundingBox())!;
    expect(box.width).toBeLessThan(30);
    // Én linje: etiketten er ikke høyere enn boksen pluss litt luft.
    expect(label.height).toBeLessThan(box.height + 12);
    await page.locator(".preview-edit-mcq-multiple").first().screenshot({ path: "test-results/1077-bryter.png" });
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

  // QA 2.99.0: tjenerens 422 for «velg alle» ble aldri nådd — editoren bygde spørsmålene på nytt uten
  // typen og sendte et vanlig spørsmål til KI-en. Nå stopper editoren selv, med en forståelig melding.
  test("KI-revisjon av et sett med «velg alle» stoppes i editoren, og ingenting sendes", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Records", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": moduleWith({ questionType: "multiple", stem: localizedText("What must the record state?"), options: [A, B, C, D], correctAnswers: [A, C], correctAnswer: A, rationale: localizedText("Art. 30") }) },
    });
    let reviseCalled = false;
    await page.route("**/generate/mcq/revise", (route: Route) => {
      reviseCalled = true;
      return route.fulfill({ status: 500, body: "" });
    });
    await page.goto("/admin-content/module/module-1/conversation?resumeEditing=1");
    await page.locator("#previewEditTitle").waitFor();
    await clickEnabledButton(page, /^Request a change$|^Be om endring$/);
    await page.locator("#dialogReviseInput").fill("Make the questions harder");
    await page.locator("#dialogReviseSubmit").click();

    await expect(page.getByText(/AI revision supports questions with one correct answer only|KI-revisjon støtter foreløpig bare|KI-revisjon støttar førebels berre/).first()).toBeVisible();
    expect(reviseCalled).toBe(false);
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
