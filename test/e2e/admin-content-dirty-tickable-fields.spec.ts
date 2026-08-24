import { expect, test } from "@playwright/test";

import { buildMockModuleExport, localizedText, mockCommonApis } from "./admin-content-helpers.js";

// #973: the dirty check never saw a tickable field.
//
// `stampEditFormValues` stamped `el.value` for a hand-written list of classes, and `hasOpenEditForm`
// compared `el.value` back. For a checkbox `value` is the constant "on" and for a radio it is the
// option index — neither changes when the author ticks it — so the state of every tickable field in
// the edit form was invisible to the guard. The live victim is the MCQ correct answer: pick a
// different one, switch tab, and the form is rebuilt from `bundle` with the choice gone and no
// warning at any point.
//
// Each "an edit warns" case here has its control-case twin ("an untouched form does not"), because a
// test that only proves the dialog appears cannot tell a working dirty check from one that warns
// always — and a warning that always fires is the failure mode the guard was written to avoid.
test.describe("#973 unsaved-changes guard covers tickable fields", () => {
  const mcqModule = () =>
    buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
      taskText: localizedText("Scenario"),
      mcqQuestions: [
        {
          stem: localizedText("Which duty applies?"),
          options: [localizedText("Option A"), localizedText("Option B"), localizedText("Option C")],
          correctAnswer: localizedText("Option B"),
          rationale: localizedText("B is the strongest fit"),
        },
      ],
    });

  test("a changed MCQ correct answer warns on a tab switch; an untouched form does not", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": mcqModule() },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    const answers = page.locator('input[name="previewEditCorrectAnswer0"]');
    await expect(answers).toHaveCount(3);
    await expect(answers.nth(1)).toBeChecked();

    // CONTROL: nothing touched, so leaving Rediger must be silent.
    await page.locator("#tabSettings").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeHidden();
    await page.locator("#tabEdit").click();
    await page.locator("#previewEditTitle").waitFor();

    // The author corrects the answer key — the one field on this form that holds its state in
    // `checked` rather than in `value`.
    await answers.nth(2).check();

    await page.locator("#tabSettings").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeVisible();
    // The FORM wording, not the settings or draft one: what is at risk here is the edit fields.
    await expect(page.locator("#unsavedTabSwitchBody")).toContainText(
      /changes in the edit fields|endringer i redigeringsfeltene/i,
    );

    // Staying must keep the corrected answer — the warning is only worth anything if the work it
    // warns about is still there afterwards.
    await page.locator("#tabSwitchStay").click();
    await expect(page.locator('input[name="previewEditCorrectAnswer0"]').nth(2)).toBeChecked();
  });

  test("a changed MCQ correct answer warns on a content-language switch too", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": mcqModule() },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    const answers = page.locator('input[name="previewEditCorrectAnswer0"]');
    await answers.nth(2).check();

    // A language switch rebuilds the form from the other language, so it destroys exactly the same
    // work a tab switch does — `confirmLocaleSwitchDiscard` asks about "form" for that reason.
    let asked = false;
    page.once("dialog", (dialog) => {
      asked = true;
      void dialog.dismiss();
    });
    await page.locator("#localeSelect").selectOption("nb");
    await expect.poll(() => asked, { message: "the language switch asked nothing" }).toBe(true);
    // Declined, so the corrected answer is still on screen.
    await expect(page.locator('input[name="previewEditCorrectAnswer0"]').nth(2)).toBeChecked();
  });

  // Dekningsvakt (CLAUDE.md): a hardcoded selector list cannot cover the field nobody thought of —
  // which is exactly how the MCQ radios were missed. This asserts the property instead of the list:
  // EVERY author-editable control in the form carries a stamp, so the next field type added to the
  // form is covered the day it is added, or this goes red.
  test("every author-editable control in the edit form is stamped", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": mcqModule() },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    const audit = await page.evaluate(() => {
      const skip = new Set(["button", "submit", "reset", "image", "file", "hidden"]);
      const controls = Array.from(
        document.getElementById("previewContent")?.querySelectorAll("input, select, textarea") ?? [],
      ) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
      const editable = controls.filter((el) => !skip.has((el as HTMLInputElement).type));
      return {
        total: editable.length,
        tickable: editable.filter((el) => ["checkbox", "radio"].includes((el as HTMLInputElement).type)).length,
        unstamped: editable
          .filter((el) => el.dataset.renderedValue === undefined)
          .map((el) => `${el.tagName.toLowerCase()}[type=${(el as HTMLInputElement).type}]#${el.id}`),
        // A radio must be stamped by its checked state, never by its value ("2"), or the
        // comparison can never see the author move the answer key.
        radioStamps: editable
          .filter((el) => (el as HTMLInputElement).type === "radio")
          .map((el) => el.dataset.renderedValue),
      };
    });

    expect(audit.total).toBeGreaterThan(0);
    // Without this the guard would pass on a form that happens to contain no tickable field at all.
    expect(audit.tickable, "fixture no longer renders any tickable field").toBeGreaterThan(0);
    expect(audit.unstamped, "edit-form controls the dirty check cannot see").toEqual([]);
    expect(new Set(audit.radioStamps)).toEqual(new Set(["checked", "unchecked"]));
  });

  // The field the issue was reported on. It lives in Innstillinger, whose guard reads the criteria
  // editor through `captureLatestCriteriaState` (which already read `.checked`) — so this is the
  // regression pin for the surface that was NOT broken, and the control case that separates
  // "the checkbox is seen" from "the dialog fires on every exit".
  test("toggling «synlig for kandidat» warns on the way out of Innstillinger; visiting it does not", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: {
        clarity: { label: "Klar kommunikasjon", description: "", maxScore: 5, weight: 1, candidateVisible: true },
      },
      scalingRule: { max_total: 5 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    const visible = page.locator("#settingsCriteriaEditor .vk-visible").first();
    await expect(visible).toBeChecked();

    // CONTROL: looking at the criteria is not editing them.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeHidden();
    await page.locator("#tabSettings").click();

    await page.locator("#settingsCriteriaEditor .vk-visible-toggle").first().click();
    await expect(visible).not.toBeChecked();

    await page.locator("#tabEdit").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeVisible();
    await expect(page.locator("#unsavedTabSwitchBody")).toContainText(
      /changed settings|endret innstillinger/i,
    );
    await page.locator("#tabSwitchStay").click();
    await expect(page.locator("#settingsCriteriaEditor .vk-visible").first()).not.toBeChecked();
  });
});
