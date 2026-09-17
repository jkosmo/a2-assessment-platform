import { expect, test } from "@playwright/test";
import { mockCommonApis, localizedText, buildMockModuleExport } from "./admin-content-helpers.js";

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
