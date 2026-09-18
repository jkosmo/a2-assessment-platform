import { expect, test } from "@playwright/test";
import { mockCommonApis, localizedText, buildMockModuleExport, clickEnabledButton } from "./admin-content-helpers.js";

// #1062: «Spørsmål per forsøk» og «Stokk rekkefølgen» under Innstillinger lagres i modulens policy
// (assessmentPolicy.mcq). Tomt = alle (nøkkelen utelates); stokking på er standard og skrives ikke;
// stokking AV skrives som false.

const questions = ["q1", "q2", "q3"].map((id) => ({
  stem: localizedText(`Question ${id}`),
  options: [localizedText("Option A"), localizedText("Option B")],
  correctAnswer: localizedText("Option A"),
  rationale: localizedText("Because"),
}));

async function openSettings(page: import("@playwright/test").Page, policy: Record<string, unknown> | null) {
  const moduleExport = buildMockModuleExport({
    id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    taskText: localizedText("Norsk scenario"), mcqQuestions: questions,
  });
  if (policy) moduleExport.selectedConfiguration.moduleVersion.assessmentPolicy = policy;
  const state = await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
    moduleExports: { "module-1": moduleExport },
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#formTab-settings").click();
  await expect(page.locator("#settingsMcqPerAttempt")).toBeVisible();
  return state;
}

test("the fields show the bank size, blank per-attempt and shuffle ON when the module has no mcq policy", async ({ page }) => {
  await openSettings(page, null);
  await expect(page.locator("#settingsMcqPerAttempt")).toHaveValue("");
  await expect(page.locator("#settingsMcqShuffle")).toBeChecked();
  await expect(page.locator("#tabPanelSettings")).toContainText(/3 questions|3 spørsmål/);
});

test("setting 2 per attempt saves questionsPerAttempt and nothing about shuffle (on is the default)", async ({ page }) => {
  const state = await openSettings(page, null);
  await page.locator("#settingsMcqPerAttempt").fill("2");
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody?.assessmentPolicy?.mcq).toBeTruthy();
  expect(state.lastModuleVersionBody.assessmentPolicy.mcq).toEqual({ questionsPerAttempt: 2 });
});

test("turning shuffle off is written as false; clearing per-attempt removes the key", async ({ page }) => {
  const state = await openSettings(page, { passRules: { mcqMinPercent: 60 }, mcq: { questionsPerAttempt: 2 } });
  await expect(page.locator("#settingsMcqPerAttempt")).toHaveValue("2");
  await page.locator("#settingsMcqPerAttempt").fill("");
  await page.locator("#settingsMcqShuffle").uncheck();
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody?.assessmentPolicy).toBeTruthy();
  const policy = state.lastModuleVersionBody.assessmentPolicy;
  expect(policy.mcq).toEqual({ shuffleQuestions: false });
  // De andre reglene følger med uendret.
  expect(policy.passRules).toEqual({ mcqMinPercent: 60 });
});

test("a non-integer per-attempt value is refused with a message, nothing is saved", async ({ page }) => {
  const state = await openSettings(page, null);
  await page.locator("#settingsMcqPerAttempt").fill("2.5");
  await page.locator("#formSaveBtn").click();
  await expect(page.locator(".toast--error")).toBeVisible();
  await page.waitForTimeout(500);
  expect(state.lastModuleVersionBody).toBeNull();
});

// #1061: «Vis gjennomgang» lagres som reviewAfterSubmit: true; av skrives ikke.
test("review after submit: off by default, saved as true when turned on", async ({ page }) => {
  const state = await openSettings(page, { mcq: { questionsPerAttempt: 2 } });
  await expect(page.locator("#settingsMcqReview")).not.toBeChecked();
  await page.locator("#settingsMcqReview").check();
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody?.assessmentPolicy?.mcq).toBeTruthy();
  expect(state.lastModuleVersionBody.assessmentPolicy.mcq).toEqual({ questionsPerAttempt: 2, reviewAfterSubmit: true });
});

// #1062 leveranse 3: «Generer spørsmål» FYLLER PÅ banken — de gamle står, de nye legges til, og
// generatoren får bankens stammer som «ikke gjenta».
test("Generer spørsmål appends to the bank and sends the existing stems as avoidStems", async ({ page }) => {
  const moduleExport = buildMockModuleExport({
    id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    taskText: localizedText("Norsk scenario"), mcqQuestions: questions,
  });
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
    moduleExports: { "module-1": moduleExport },
  });
  let mcqBody: any = null;
  await page.route("**/api/admin/content/generate/mcq", async (route) => {
    mcqBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      questions: [{ stem: "Ny stamme", options: ["X", "Y"], correctAnswer: "X", rationale: "Fordi" }],
      validation: { valid: true, issues: [] },
    }) });
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);
  await expect(page.locator("[data-preview-edit-question]")).toHaveCount(3);

  await clickEnabledButton(page, /^Generate questions$|^Generer spørsmål$/);
  const dialog = page.locator("#dialogGenerate");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(page.locator("#dialogGenerateBankNote")).toContainText(/3 questions|3 spørsmål/);
  await expect(page.locator("#dialogGenerateQuestionCountLabel")).toHaveText(/new questions|nye spørsmål/);
  await page.locator("#dialogGenerate .chat-textarea").fill("Mer kildemateriale.");
  await page.locator("#dialogGenerate .chat-submit-btn").click();

  await expect.poll(() => mcqBody).toBeTruthy();
  expect(mcqBody.avoidStems).toHaveLength(3);
  expect(mcqBody.avoidStems.join(" ")).toContain("Question q1");
  // Banken er 3 + 1, ikke 1.
  await expect(page.locator("[data-preview-edit-question]")).toHaveCount(4, { timeout: 15000 });
  await expect(page.locator("#previewEditMcqStem3")).toHaveValue(/Ny stamme/);
});

// #1062 leveranse 3: over fem spørsmål står de sammenfoldet med stammen som overskrift; et nytt
// står åpent. Feltene leses like fullt ved lagring.
test("a large bank folds each question; a new one opens; the summary follows the stem", async ({ page }) => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    stem: localizedText(`Stem number ${i + 1}`), options: [localizedText("A"), localizedText("B")], correctAnswer: localizedText("A"), rationale: localizedText("R"),
  }));
  const moduleExport = buildMockModuleExport({ id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1", taskText: localizedText("Norsk scenario"), mcqQuestions: many });
  await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }], moduleExports: { "module-1": moduleExport } });
  await page.goto("/admin-content/module/module-1/conversation");
  await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);
  const items = page.locator("details[data-preview-edit-question]");
  await expect(items).toHaveCount(7);
  for (let i = 0; i < 7; i++) await expect(items.nth(i)).not.toHaveAttribute("open", "");
  await expect(page.locator('[data-mcq-summary="2"]')).toContainText("Stem number 3");
  // Åpne ett og skriv: overskriften følger.
  await items.nth(2).locator("summary").click();
  await expect(page.locator("#previewEditMcqStem2")).toBeVisible();
  await page.locator("#previewEditMcqStem2").fill("Omskrevet stamme");
  await expect(page.locator('[data-mcq-summary="2"]')).toHaveText("Omskrevet stamme");
  // Et nytt spørsmål står åpent.
  await page.locator("#previewEditAddQuestion").click();
  await expect(items).toHaveCount(8);
  await expect(items.nth(7)).toHaveAttribute("open", "");
  await expect(page.locator("#previewEditMcqStem7")).toBeVisible();
});

// Stage 18.09 (produkteier): «Spørsmål per forsøk» = 3 forsvant da nye spørsmål ble lagret fra
// Rediger. Lagringen fra Rediger sendte hele policyen som `{ passRules: { mcqMinPercent } }` for
// rene flervalgsmoduler, og ingen policy for de andre typene. Nå bæres den hel.
test("saving from Rediger on an MCQ-only module keeps mcq.* and the other pass rules", async ({ page }) => {
  const moduleExport = buildMockModuleExport({
    id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    taskText: localizedText("Norsk scenario"), mcqQuestions: questions, assessmentMode: "MCQ_ONLY",
  });
  moduleExport.selectedConfiguration.moduleVersion.assessmentPolicy = {
    passRules: { mcqMinPercent: 65, totalMin: 70, borderlineWindow: { min: 60, max: 64 } },
    mcq: { questionsPerAttempt: 3, reviewAfterSubmit: true },
    aiInfluence: { enabled: true },
  };
  const state = await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
    moduleExports: { "module-1": moduleExport },
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await expect(page.locator("#previewEditMcqStem0")).toBeVisible();
  await page.locator("#previewEditMcqStem0").fill("Endret stamme");
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody?.assessmentPolicy).toBeTruthy();
  expect(state.lastModuleVersionBody.assessmentPolicy).toEqual({
    passRules: { mcqMinPercent: 65, totalMin: 70, borderlineWindow: { min: 60, max: 64 } },
    mcq: { questionsPerAttempt: 3, reviewAfterSubmit: true },
    aiInfluence: { enabled: true },
  });
});

test("saving from Rediger on a free-text + MCQ module sends the stored policy (it used to send none)", async ({ page }) => {
  const moduleExport = buildMockModuleExport({
    id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    taskText: localizedText("Norsk scenario"), mcqQuestions: questions,
  });
  moduleExport.selectedConfiguration.moduleVersion.assessmentPolicy = {
    passRules: { mcqMinPercent: 60, practicalMinPercent: 50 },
    mcq: { questionsPerAttempt: 2, shuffleQuestions: false },
  };
  const state = await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
    moduleExports: { "module-1": moduleExport },
  });
  await page.goto("/admin-content/module/module-1/conversation");
  await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);
  await page.locator("#previewEditTaskText").fill("Nytt scenario");
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody?.assessmentPolicy).toBeTruthy();
  expect(state.lastModuleVersionBody.assessmentPolicy).toEqual({
    passRules: { mcqMinPercent: 60, practicalMinPercent: 50 },
    mcq: { questionsPerAttempt: 2, shuffleQuestions: false },
  });
});
