import { expect, test } from "@playwright/test";
import { mockCommonApis, localizedText, buildMockModuleExport } from "./admin-content-helpers.js";

// #1124 del 2: eksempelsvaret og «Vis eksempelsvaret …» under Innstillinger. Teksten lagres på språket
// som redigeres og flettes inn i de andre; den sendes bare når den er endret (utelatt beholder tjeneren
// den). Visningen er av som standard og skrives bare når den er PÅ (`assessmentPolicy.practical`).

const questions = ["q1"].map((id) => ({
  stem: localizedText(`Question ${id}`),
  options: [localizedText("Option A"), localizedText("Option B")],
  correctAnswer: localizedText("Option A"),
  rationale: localizedText("Because"),
}));

async function openSettings(
  page: import("@playwright/test").Page,
  { modelAnswer, policy }: { modelAnswer?: unknown; policy?: Record<string, unknown> | null } = {},
) {
  const moduleExport = buildMockModuleExport({
    id: "module-1", title: "Referat", moduleVersionId: "module-1-version-1",
    taskText: localizedText("Skriv referatet"), mcqQuestions: questions,
  });
  const version = moduleExport.selectedConfiguration.moduleVersion as Record<string, unknown>;
  if (modelAnswer !== undefined) version.modelAnswer = modelAnswer;
  if (policy) version.assessmentPolicy = policy;
  const state = await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Referat", activeVersion: { versionNo: 1 } }],
    moduleExports: { "module-1": moduleExport },
  });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#formTab-settings").click();
  await expect(page.locator("#settingsModelAnswer")).toBeVisible();
  return state;
}

test("tomt og av som standard; å skrive og slå på sender teksten på språket som redigeres", async ({ page }) => {
  const state = await openSettings(page);
  await expect(page.locator("#settingsModelAnswer")).toHaveValue("");
  await expect(page.locator("#settingsModelAnswerShow")).not.toBeChecked();
  await page.locator("#settingsModelAnswer").fill("Vedtak: budsjettet ble godkjent.");
  await page.locator("#settingsModelAnswerShow").check();
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody?.modelAnswer).toBeTruthy();
  expect(state.lastModuleVersionBody.modelAnswer).toEqual({ nb: "Vedtak: budsjettet ble godkjent." });
  expect(state.lastModuleVersionBody.assessmentPolicy.practical).toEqual({ modelAnswerAfterAssessment: true });
});

test("et lagret svar vises; endret på bokmål flettes inn, de andre språkene står", async ({ page }) => {
  const state = await openSettings(page, {
    modelAnswer: { nb: "Gammelt svar.", nn: "Gammalt svar.", "en-GB": "Old answer." },
    policy: { practical: { modelAnswerAfterAssessment: true } },
  });
  await expect(page.locator("#settingsModelAnswer")).toHaveValue("Gammelt svar.");
  await expect(page.locator("#settingsModelAnswerShow")).toBeChecked();
  await page.locator("#settingsModelAnswer").fill("Nytt svar.");
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody?.modelAnswer).toBeTruthy();
  expect(state.lastModuleVersionBody.modelAnswer).toEqual({ nb: "Nytt svar.", nn: "Gammalt svar.", "en-GB": "Old answer." });
});

test("bare bryteren endret: teksten sendes ikke (tjeneren beholder den), visningen av skrives ikke", async ({ page }) => {
  const state = await openSettings(page, {
    modelAnswer: { nb: "Svar." },
    policy: { practical: { modelAnswerAfterAssessment: true }, passRules: { totalMin: 60 } },
  });
  await page.locator("#settingsModelAnswerShow").uncheck();
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody).toBeTruthy();
  expect(state.lastModuleVersionBody).not.toHaveProperty("modelAnswer");
  expect(state.lastModuleVersionBody.assessmentPolicy).not.toHaveProperty("practical");
  expect(state.lastModuleVersionBody.assessmentPolicy.passRules).toEqual({ totalMin: 60 });
});

test("tømt i det eneste språket: sendes som null", async ({ page }) => {
  const state = await openSettings(page, { modelAnswer: { nb: "Svar." } });
  await page.locator("#settingsModelAnswer").fill("");
  await page.locator("#formSaveBtn").click();
  await expect.poll(() => state.lastModuleVersionBody).toBeTruthy();
  expect(state.lastModuleVersionBody.modelAnswer).toBeNull();
});
