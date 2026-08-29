import AxeBuilderModule from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const AxeBuilder = (AxeBuilderModule.default ?? AxeBuilderModule) as any;

import {
  mockCommonApis,
  clickEnabledButton,
  submitActiveChatInput,
  courseTextForLocale,
  localizedText,
  buildMockModuleExport,
} from "./admin-content-helpers.js";

// #613: the conversational shell (`admin-content.html`) has no bare production route — it lives at
// `/admin-content/module/:id/conversation`, while `/admin-content` serves the module library. The
// shell tests below exercise its in-page flows (idle "create new module", source step), so they load
// the shell HTML directly via its `/admin-content.html` file path (the static server's public-file
// fallback), independent of the library route.
test.describe("admin content browser coverage", () => {

  // #896 S5: version history. The rows have existed since the first «Mellomlagring» — every save
  // writes one. What was missing was any way to SEE them, so "I liked the previous wording better"
  // meant retyping from memory.
  test("Innstillinger lists saved versions and restores an earlier one as a new draft", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-3",
    });
    const current = moduleExport.selectedConfiguration.moduleVersion;
    current.versionNo = 3;
    current.createdAt = "2026-08-14T09:00:00.000Z";
    moduleExport.versions.moduleVersions = [
      current,
      { id: "module-1-version-2", versionNo: 2, createdAt: "2026-08-13T09:00:00.000Z", publishedAt: null },
      { id: "module-1-version-1", versionNo: 1, createdAt: "2026-08-12T09:00:00.000Z", publishedAt: null },
    ];

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let restoredFrom: string | null = null;
    let restoreKey: string | null = null;
    await page.route("**/api/admin/content/modules/*/module-versions/*/restore", async (route) => {
      const segments = new URL(route.request().url()).pathname.split("/");
      restoredFrom = decodeURIComponent(segments[segments.length - 2] ?? "");
      restoreKey = route.request().headers()["idempotency-key"] ?? null;
      // The real server appends a version, so the reload afterwards shows a DIFFERENT current
      // version. A mock that skips this would hide the client's reload check — which exists
      // precisely because loadModule swallows its own fetch errors.
      const restored = { ...current, id: "module-1-version-4", versionNo: 4, publishedAt: null };
      moduleExport.selectedConfiguration.moduleVersion = restored;
      moduleExport.versions.moduleVersions = [restored, ...moduleExport.versions.moduleVersions];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-4", versionNo: 4, publishedAt: null } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    const items = page.locator(".version-list .version-item");
    await expect(items).toHaveCount(3);
    // Newest first — the author's mental model is a stack, not a queue.
    await expect(items.nth(0)).toContainText("3");
    await expect(items.nth(2)).toContainText("1");

    // The loaded version offers no Restore: restoring it would copy the module onto itself.
    await expect(items.nth(0).locator(".version-restore")).toHaveCount(0);
    await expect(items.nth(1).locator(".version-restore")).toHaveCount(1);

    // Each button names its version. Four identically-labelled "Gjenopprett" buttons tell a
    // screen-reader user nothing about which one goes where.
    await expect(items.nth(2).locator(".version-restore")).toHaveAttribute(
      "aria-label",
      /(Gjenopprett|Restore) (versjon|version) 1/,
    );

    await items.nth(2).locator(".version-restore").click();

    await expect.poll(() => restoredFrom).toBe("module-1-version-1");
    // An Idempotency-Key rides along, so a retry after a lost response cannot produce a second
    // restored version.
    expect(restoreKey).toBeTruthy();

    // Restore is triggered from Innstillinger, but the author's next question is "what does it say
    // now?" — so the workspace returns to Rediger. That also puts the confirmation somewhere they
    // can actually see it: the chat log lives in the panel Innstillinger hides.
    await expect(page.locator("#tabEdit")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/gjenopprettet som et nytt utkast|restored as a new draft/).first()).toBeVisible();
  });

  // #896 S3c: the criteria editor moved from Rediger to Innstillinger. The spec's reason is that
  // it is a whole sub-editor that fills a lot of space and changes rarely once set — "the ordinary
  // task, adjust the scenario and save, should not pay for it every time".
  test("Innstillinger edits criteria and saves them as an inline rubric", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: {
        clarity: { label: "Clarity", description: "Is it clear?", maxScore: 5, weight: 0.5, candidateVisible: true },
        depth: { label: "Depth", description: "Is it deep?", maxScore: 5, weight: 0.5, candidateVisible: false },
      },
      scalingRule: { max_total: 10, practical_weight: 70 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let savedBody: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    // #896 S3c: expanded on arrival, with no toggle at all. Criteria vary enough between
    // generated modules that the author needs to see them, not be told they exist.
    await expect(page.locator("#settingsCriteriaEditor")).toBeVisible();
    await expect(page.locator("#settingsCriteriaToggle")).toHaveCount(0);
    await expect(page.locator("#settingsCriteriaEditor .vk-card")).toHaveCount(2);

    await page.locator("#settingsCriteriaEditor .vk-label").first().fill("Klarhet");
    await page.locator("#settingsSave").click();

    await expect.poll(() => savedBody !== null).toBe(true);
    // An INLINE rubric, not a reference. Referencing the existing rubricVersionId would carry the
    // old criteria forward and silently discard what was just typed.
    expect(savedBody.rubricVersionId).toBeUndefined();
    expect(savedBody.rubric?.criteria).toBeTruthy();
    const labels = Object.values(savedBody.rubric.criteria).map((c: any) => c.label);
    // #902: edited in en-GB, so the edit lands in en-GB and the stored bare string stays where
    // the locale contract reads it — nb. The untouched criterion is not rewritten at all.
    expect(labels).toContainEqual({ "en-GB": "Klarhet", nb: "Clarity" });
    expect(labels).toContain("Depth");
    // The scaling rule keeps its practical weight and recomputes the total from the criteria.
    expect(savedBody.rubric.scalingRule.practical_weight).toBe(70);
    expect(savedBody.rubric.scalingRule.max_total).toBe(10);
  });

  // #896 S3c: the assessment instruction. The composer writes promptTemplate VERBATIM — it does
  // not merge — so an editor that edits one language must merge the other two itself. That exact
  // mistake has been made three times in this epic already (title, description, certification
  // level), which is why this test looks at what happens to the languages nobody touched.
  test("Innstillinger edits the assessment instruction in one language and keeps the others", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.promptTemplateVersion = {
      id: "prompt-1",
      versionNo: 1,
      systemPrompt: { "en-GB": "You assess.", nb: "Du vurderer.", nn: "Du vurderer." },
      userPromptTemplate: { "en-GB": "Assess: {{a}}", nb: "Vurder: {{a}}", nn: "Vurder: {{a}}" },
      examples: [{ example: "Good" }],
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let savedBody: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await expect(page.locator("#settingsPromptEditor")).toBeHidden();
    await page.locator("#settingsPromptToggle").click();

    // One language at a time (§7) — the UI is en-GB here, so that is what is shown and edited.
    await expect(page.locator("#settingsPromptSystem")).toHaveValue("You assess.");
    await page.locator("#settingsPromptSystem").fill("You assess strictly.");
    await page.locator("#settingsSave").click();

    await expect.poll(() => savedBody !== null).toBe(true);
    // Inline prompt, not a reference to the old version.
    expect(savedBody.promptTemplateVersionId).toBeUndefined();
    expect(savedBody.promptTemplate.systemPrompt["en-GB"]).toBe("You assess strictly.");
    // The two languages the editor never showed are still there. This is the whole point.
    expect(savedBody.promptTemplate.systemPrompt.nb).toBe("Du vurderer.");
    expect(savedBody.promptTemplate.systemPrompt.nn).toBe("Du vurderer.");
    // Untouched fields ride along unchanged.
    expect(savedBody.promptTemplate.userPromptTemplate.nb).toBe("Vurder: {{a}}");
    expect(savedBody.promptTemplate.examples).toEqual([{ example: "Good" }]);
  });

  test("malformed examples JSON is reported instead of silently dropped", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.promptTemplateVersion = {
      id: "prompt-1",
      versionNo: 1,
      systemPrompt: { "en-GB": "You assess.", nb: "Du vurderer.", nn: "Du vurderer." },
      userPromptTemplate: { "en-GB": "Assess: {{a}}", nb: "Vurder: {{a}}", nn: "Vurder: {{a}}" },
      examples: [],
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let saveCalled = false;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      saveCalled = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await page.locator("#settingsPromptToggle").click();
    await page.locator("#settingsPromptExamples").fill("{not json");
    await page.locator("#settingsSave").click();

    // Nothing is sent, and the author is told why — rather than the examples quietly becoming [].
    await expect(page.getByText(/JSON-liste|JSON array/).first()).toBeVisible();
    expect(saveCalled).toBe(false);
  });

  // #896 S3c, last two settings fields. Both write to structures that carry more than the one
  // value being edited, so both are really tests about what is NOT lost.
  test("Innstillinger edits the answer field and the practical weight", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: { clarity: { label: "Clarity", description: "", maxScore: 5, weight: 1, candidateVisible: true } },
      scalingRule: { max_total: 5, practical_weight: 70 },
    };
    // Two fields: the admin UI edits only the first (#901), and the second must survive.
    moduleExport.selectedConfiguration.moduleVersion.submissionSchema = {
      fields: [
        { id: "response", label: { "en-GB": "Your answer", nb: "Ditt svar", nn: "Ditt svar" }, type: "textarea", required: true },
        { id: "notes", label: { "en-GB": "Notes", nb: "Notater", nn: "Notat" }, type: "text", required: false },
      ],
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let savedBody: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    // Practical weight is a plain row, not a collapsed section — it is one number.
    await expect(page.locator("#settingsPracticalWeight")).toHaveValue("70");
    await page.locator("#settingsPracticalWeight").fill("60");

    await page.locator("#settingsSchemaToggle").click();
    await expect(page.locator("#settingsSchemaLabel")).toHaveValue("Your answer");
    await page.locator("#settingsSchemaLabel").fill("Your response");

    await page.locator("#settingsSave").click();
    await expect.poll(() => savedBody !== null).toBe(true);

    // The weight lives on the rubric's scalingRule, so changing it writes a rubric — but the
    // criteria must come along unchanged rather than being rebuilt from nothing.
    expect(savedBody.rubric.scalingRule.practical_weight).toBe(60);
    expect(Object.keys(savedBody.rubric.criteria)).toHaveLength(1);

    // The edited locale changed; the other two did not.
    expect(savedBody.submissionSchema.fields[0].label["en-GB"]).toBe("Your response");
    expect(savedBody.submissionSchema.fields[0].label.nb).toBe("Ditt svar");
    // And the second field — which this UI never shows — is still there. Rebuilding the array
    // from one input would have deleted it.
    expect(savedBody.submissionSchema.fields).toHaveLength(2);
    expect(savedBody.submissionSchema.fields[1].id).toBe("notes");
  });

  // Found by the test above rather than by review: expanding a section re-renders the WHOLE panel
  // from the bundle, so a validity date typed a moment earlier silently reverted — and the author
  // would not notice, because their eyes were on the section they had just opened.
  test("typed settings survive expanding a section", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    await page.locator("#settingsCertLevel").selectOption("advanced");
    await page.locator("#settingsValidFrom").fill("2027-01-01");

    // Either collapsible section will do — both re-render the whole panel. (Criteria are always
    // expanded since S3c, so the prompt section is the one with a toggle left.)
    await page.locator("#settingsPromptToggle").click();
    await expect(page.locator("#settingsCertLevel")).toHaveValue("advanced");
    await expect(page.locator("#settingsValidFrom")).toHaveValue("2027-01-01");

    // And collapsing it again does not revert them either.
    await page.locator("#settingsPromptToggle").click();
    await expect(page.locator("#settingsCertLevel")).toHaveValue("advanced");
  });

  // QA found that §2 was NOT complete: only mcqMinPercent was editable, so an author who wanted to
  // change the overall pass mark still had to go to Avansert — the one thing this epic exists to
  // stop. The other three pass rules are now here.
  test("Innstillinger edits the whole pass policy, and blank means not set", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.moduleVersion.assessmentPolicy = {
      passRules: { totalMin: 65, mcqMinPercent: 70, practicalMinPercent: 50, borderlineWindow: { min: 60, max: 64 } },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let savedBody: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    await expect(page.locator("#settingsTotalMin")).toHaveValue("65");
    await page.locator("#settingsTotalMin").fill("70");
    // Emptying a field removes the per-module override; decisionService then uses the platform
    // rules. That is a real choice, distinct from setting it to 0.
    await page.locator("#settingsPracticalMin").fill("");
    await page.locator("#settingsSave").click();

    await expect.poll(() => savedBody !== null).toBe(true);
    expect(savedBody.assessmentPolicy.passRules.totalMin).toBe(70);
    expect(savedBody.assessmentPolicy.passRules).not.toHaveProperty("practicalMinPercent");
    // Untouched rules ride along.
    expect(savedBody.assessmentPolicy.passRules.mcqMinPercent).toBe(70);
    expect(savedBody.assessmentPolicy.passRules.borderlineWindow).toEqual({ min: 60, max: 64 });
  });

  test("a fractional threshold is rejected rather than silently truncated", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    let saveCalled = false;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      saveCalled = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    // parseInt("72.5") is 72 — the field said "whole number" and then quietly saved a different
    // number than the one on screen. A threshold the author did not choose is worse than a
    // rejected one.
    await page.locator("#settingsPracticalWeight").fill("72.5");
    await page.locator("#settingsSave").click();

    await expect(page.getByText(/helt tall|whole number/).first()).toBeVisible();
    expect(saveCalled).toBe(false);
    // And the Save button comes back, so the panel is not dead.
    await expect(page.locator("#settingsSave")).toBeEnabled();
  });

  test("unsaved criteria edits are caught by the same exit guard as the other settings", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: { clarity: { label: "Clarity", description: "", maxScore: 5, weight: 1, candidateVisible: true } },
      scalingRule: { max_total: 5 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await page.locator("#settingsCriteriaEditor .vk-label").first().fill("Endret kriterium");

    // Criteria are settings work too. Leaving without saving must warn, or the edit is gone —
    // the panel is rebuilt from the bundle on the way back.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeVisible();
    await page.locator("#tabSwitchStay").click();
    await expect(page.locator("#settingsCriteriaEditor .vk-label").first()).toHaveValue("Endret kriterium");
  });

  // QA 2026-08-16: switching to MCQ-only skips the whole rubric/prompt branch, so a criteria edit
  // made in the same save vanished — and switching back showed the OLD criteria, so it looked like
  // the edit had never been typed. Refused rather than guessed.
  test("switching to MCQ-only refuses to also discard an unsaved criteria edit", async ({ page }) => {
    let saveCalled = false;
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
      mcqQuestions: [
        {
          stem: localizedText("Question 1"),
          options: [localizedText("Option A"), localizedText("Option B")],
          correctAnswer: localizedText("Option B"),
          rationale: localizedText("Rationale"),
        },
      ],
    });
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: { clarity: { label: "Clarity", description: "", maxScore: 5, weight: 1, candidateVisible: true } },
      scalingRule: { max_total: 5, practical_weight: 70 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });
    await page.route("**/api/admin/content/modules/module-1/versions", async (route) => {
      saveCalled = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ moduleVersion: { id: "v2", versionNo: 2 } }) });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await page.locator("#settingsCriteriaEditor .vk-label").first().fill("Endret kriterium");
    await page.locator("#settingsModuleType").selectOption("MCQ_ONLY");
    await page.locator("#settingsSave").click();

    await expect(page.getByText(/Lagre endringene i kriterier|Save your criteria/).first()).toBeVisible();
    expect(saveCalled).toBe(false);
    // The edit is still on screen, and Lagre still works — nothing has to be retyped.
    await expect(page.locator("#settingsCriteriaEditor .vk-label").first()).toHaveValue("Endret kriterium");
    await expect(page.locator("#settingsSave")).toBeEnabled();
  });

  // QA 2026-08-16: the four pass-rule fields added in v2.18.9 were missing from the draft
  // preservation AND the dirty check — the id list lived in six places and only two were updated.
  // This pins every field in the panel at once, so the next one added fails here rather than on
  // stage.
  test("every settings field survives a re-render and is seen by the exit guard", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.moduleVersion.assessmentPolicy = {
      passRules: { totalMin: 65, mcqMinPercent: 70, practicalMinPercent: 50, borderlineWindow: { min: 60, max: 64 } },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    const edits: Record<string, string> = {
      settingsCertLevel: "advanced",
      settingsValidFrom: "2027-01-01",
      settingsValidTo: "2027-12-31",
      settingsMcqMinPercent: "75",
      settingsTotalMin: "70",
      settingsPracticalMin: "55",
      settingsBorderlineMin: "66",
      settingsBorderlineMax: "69",
      settingsPracticalWeight: "60",
    };
    const originals: Record<string, string> = {};
    for (const id of Object.keys(edits)) {
      originals[id] = await page.locator(`#${id}`).inputValue();
    }

    // settingsCertLevel is a <select> (the level is a fixed scale), the rest are inputs.
    const setField = async (id: string, value: string) => {
      if (id === "settingsCertLevel") await page.locator(`#${id}`).selectOption(value);
      else await page.locator(`#${id}`).fill(value);
    };
    for (const [id, value] of Object.entries(edits)) {
      await setField(id, value);
    }

    // Expanding a section rebuilds the whole panel from the bundle.
    await page.locator("#settingsPromptToggle").click();
    for (const [id, value] of Object.entries(edits)) {
      await expect(page.locator(`#${id}`), `${id} reverted on re-render`).toHaveValue(value);
    }

    // And each one on its own must be enough to trigger the unsaved-changes guard. Checked one at
    // a time, because a check that only looks at the first field passes while the rest are silent.
    // Between fields the value is put back, which is what makes the panel clean again.
    for (const id of Object.keys(edits)) {
      await setField(id, originals[id]);
    }
    await expect(page.locator("#settingsCertLevel")).toHaveValue(originals.settingsCertLevel);

    for (const id of Object.keys(edits)) {
      await setField(id, edits[id]);
      await page.locator("#tabEdit").click();
      await expect(page.locator("#dialogUnsavedTabSwitch"), `${id} did not trigger the exit guard`).toBeVisible();
      await page.locator("#tabSwitchStay").click();
      await setField(id, originals[id]);
    }
  });

  // #902: the criteria editor shows one language and used to write a bare string back, deleting
  // the other two. It is now the ONLY place criteria are edited and it is always open, so the
  // exposure went up rather than down. Same merge rule as the title, description and instruction.
  test("editing a criterion in one language keeps the other two", async ({ page }) => {
    let savedBody: any = null;
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: {
        evidence: {
          label: { "en-GB": "Evidence", nb: "Dokumentasjon", nn: "Dokumentasjon" },
          description: { "en-GB": "Cites sources", nb: "Viser til kilder", nn: "Viser til kjelder" },
          maxScore: 5,
          weight: 1,
          candidateVisible: true,
        },
      },
      scalingRule: { max_total: 5, practical_weight: 70 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });
    await page.route("**/api/admin/content/modules/module-1/versions", async (route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    // The panel opens in en-GB, which is the reviewer's own scenario: edit the English label,
    // and the two Norwegian ones must be exactly as they were.
    await expect(page.locator("#settingsCriteriaEditor .vk-label").first()).toHaveValue("Evidence");
    await page.locator("#settingsCriteriaEditor .vk-label").first().fill("Evidence quality");
    await page.locator("#settingsSave").click();

    await expect.poll(() => savedBody !== null).toBe(true);
    const saved: any = Object.values(savedBody.rubric.criteria)[0];
    // Not a bare string: that would read as "one language, untranslated" and lose two.
    expect(typeof saved.label).toBe("object");
    expect(saved.label["en-GB"]).toBe("Evidence quality");
    expect(saved.label.nb).toBe("Dokumentasjon");
    expect(saved.label.nn).toBe("Dokumentasjon");
    // The untouched description survives whole, in all three.
    expect(saved.description["en-GB"]).toBe("Cites sources");
    expect(saved.description.nb).toBe("Viser til kilder");
    expect(saved.description.nn).toBe("Viser til kjelder");
  });

  // QA round 3: my own round-2 fix broke Add and Remove. The draft sync re-reads the DOM, and it
  // ran from setState — before the redraw — so Add saw one card too few and dropped the new
  // criterion, and Remove read the removed card straight back in. Both are silent.
  //
  // NOTE ON WHAT THIS DOES AND DOES NOT COVER: that bug only fired when a session draft existed,
  // and this test has none, so it would have been green against the broken code too. It is kept
  // as a plain guard that Add and Remove reach the save at all — which nothing covered before —
  // and the draft-specific path stays a manual check in doc/pilot/STAGE_TEST_896.md.
  test("adding and removing criteria survives to the save", async ({ page }) => {
    let savedBody: any = null;
    const moduleExport = buildMockModuleExport({
      id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: {
        clarity: { label: "Clarity", description: "", maxScore: 5, weight: 0.5, candidateVisible: true },
        depth: { label: "Depth", description: "", maxScore: 5, weight: 0.5, candidateVisible: true },
      },
      scalingRule: { max_total: 10, practical_weight: 70 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });
    await page.route("**/api/admin/content/modules/module-1/versions", async (route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201, contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await expect(page.locator("#settingsCriteriaEditor .vk-card")).toHaveCount(2);

    // Add one...
    await page.locator("#settingsCriteriaEditor .vk-add").click();
    await expect(page.locator("#settingsCriteriaEditor .vk-card")).toHaveCount(3);
    await page.locator("#settingsCriteriaEditor .vk-label").last().fill("Structure");

    // ...and remove the first, so both structural paths are exercised in one save.
    await page.locator("#settingsCriteriaEditor .vk-remove").first().click();
    await expect(page.locator("#settingsCriteriaEditor .vk-card")).toHaveCount(2);

    await page.locator("#settingsSave").click();
    await expect.poll(() => savedBody !== null).toBe(true);

    const labels = Object.values(savedBody.rubric.criteria).map((c: any) =>
      typeof c.label === "string" ? c.label : c.label?.["en-GB"]);
    expect(labels, "the added criterion never reached the save").toContain("Structure");
    expect(labels, "the removed criterion came back").not.toContain("Clarity");
    expect(labels).toContain("Depth");
  });

  // Stage-tilbakemelding 2026-08-18: the special-category warning belongs where the assignment is
  // written. Standing on all three tabs made it wallpaper.
  test("the privacy warning shows on Rediger only", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await expect(page.locator("#privacyNotice")).toBeVisible();

    await page.locator("#tabPreview").click();
    await expect(page.locator("#privacyNotice")).toBeHidden();

    await page.locator("#tabSettings").click();
    await expect(page.locator("#privacyNotice")).toBeHidden();

    await page.locator("#tabEdit").click();
    await expect(page.locator("#privacyNotice")).toBeVisible();
  });

  // Stage-tilbakemelding 2026-08-17: poengreglene forklarte seg ikke. The explanation lives behind
  // an i-button, opened by CLICK (hover is unreachable on touch and from the keyboard).
  //
  // The first attempt looked like a dead button: `renderSettingsPanel` replaces `host.innerHTML`
  // but not `host`, so a listener attached there accumulated one copy per render — the first copy
  // opened the popover and the second read it as already-open and closed it, within one click.
  // This test re-renders the panel before clicking, which is what makes it catch that.
  test("the pass-rule help opens on click, and still works after a re-render", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    // Expanding a section re-renders the whole panel — the step that used to add the second listener.
    await page.locator("#settingsPromptToggle").click();
    await page.locator("#settingsPromptToggle").click();

    const info = page.locator(".settings-info[data-info='totalMin']");
    await expect(info).toHaveAttribute("aria-expanded", "false");
    await info.click();

    const popover = page.locator(".settings-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/platform default|plattformens standardverdi/);
    await expect(info).toHaveAttribute("aria-expanded", "true");

    // Clicking it again closes; only one is ever open.
    await info.click();
    await expect(popover).toHaveCount(0);

    await page.locator(".settings-info[data-info='mcqThreshold']").click();
    await page.locator(".settings-info[data-info='practicalWeight']").click();
    await expect(page.locator(".settings-popover")).toHaveCount(1);

    // Escape closes it, so a keyboard user is not stuck with it covering the fields below.
    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-popover")).toHaveCount(0);
  });

  // Stage-tilbakemelding 2026-08-17: an empty pass-rule field means different things per field, and
  // the placeholder has to say which. Filling the values in instead — the first suggestion — would
  // switch ON a gate that is currently off, which is the QA-round-7 defect all over again.
  test("an empty pass rule says what empty actually does for that rule", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    // The two component gates are OFF when blank — decisionService resolves them to null.
    await expect(page.locator("#settingsMcqMinPercent")).toHaveAttribute("placeholder", /No limit|Ingen grense|Inga grense/);
    await expect(page.locator("#settingsPracticalMin")).toHaveAttribute("placeholder", /No limit|Ingen grense|Inga grense/);
    // ⚠️ Grensesonen sto her og krevde «Ingen» — altså «tomt betyr av». Det sluttet å være sant da
    // plattformen fikk et standardbånd: tomt felt betyr nå at båndet under modulens terskel gjelder.
    // En plassholder som sa «Ingen» ville fortalt forfatteren at ingen saker rutes på score alene,
    // mens de faktisk gjør det.
    //
    // Grensesonen hører nå sammen med totalMin: begge navngir tallet de faller tilbake på.
    await expect(page.locator("#settingsBorderlineMin")).toHaveAttribute("placeholder", /60/);
    await expect(page.locator("#settingsBorderlineMax")).toHaveAttribute("placeholder", /70/);
    await expect(page.locator("#settingsTotalMin")).toHaveAttribute("placeholder", /70/);
  });

  // QA round 5: a section is saved as a unit, so editing the system instruction ran the locale
  // merge over the user template too — turning a stored bare string (= "one language, not
  // translated") into a two-locale map claiming the same text is valid English. A translation
  // nobody wrote, and the publish gate would then believe it.
  test("editing one field in a section does not mark its untouched siblings as translated", async ({ page }) => {
    let savedBody: any = null;
    const moduleExport = buildMockModuleExport({
      id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.promptTemplateVersion = {
      id: "prompt-1",
      versionNo: 1,
      systemPrompt: { "en-GB": "Old system", nb: "Gammel system", nn: "Gammal system" },
      // A legacy bare string: one language, untranslated.
      userPromptTemplate: "Vurder: {{answer}}",
      examples: [],
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });
    await page.route("**/api/admin/content/modules/module-1/versions", async (route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201, contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await page.locator("#settingsPromptToggle").click();
    await page.locator("#settingsPromptSystem").fill("New system instruction");
    await page.locator("#settingsSave").click();

    await expect.poll(() => savedBody !== null).toBe(true);
    expect(savedBody.promptTemplate.systemPrompt["en-GB"]).toBe("New system instruction");
    // The untouched template is byte-for-byte what it was — still a bare string.
    expect(savedBody.promptTemplate.userPromptTemplate).toBe("Vurder: {{answer}}");
  });

  // QA round 5: "Forkast" cleared what was on screen but not the cache holding folded-away
  // sections, so a discarded instruction came back the next time it was opened.
  test("discarding settings also discards edits in a collapsed section", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.promptTemplateVersion = {
      id: "prompt-1", versionNo: 1,
      systemPrompt: { "en-GB": "Old system", nb: "Gammel system", nn: "Gammal system" },
      userPromptTemplate: { "en-GB": "Old user", nb: "Gammel bruker", nn: "Gammal brukar" },
      examples: [],
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await page.locator("#settingsPromptToggle").click();
    await page.locator("#settingsPromptSystem").fill("Text the author will discard");
    await page.locator("#settingsPromptToggle").click();

    // Leave the tab and choose Forkast.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeVisible();
    await page.locator("#tabSwitchDiscard").click();

    await page.locator("#tabSettings").click();
    await page.locator("#settingsPromptToggle").click();
    await expect(
      page.locator("#settingsPromptSystem"),
      "the discarded text came back",
    ).toHaveValue("Old system");
  });

  // QA round 3: a folded-away edit is not an undone edit. `promptDirty` read only live DOM, so
  // editing the instruction and then collapsing the section meant "ingen endringer" and no POST.
  // And opening a sibling section wiped the cached value outright.
  test("a collapsed section keeps its edit, and the save sends it", async ({ page }) => {
    let savedBody: any = null;
    const moduleExport = buildMockModuleExport({
      id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
    });
    moduleExport.selectedConfiguration.promptTemplateVersion = {
      id: "prompt-1",
      versionNo: 1,
      systemPrompt: { "en-GB": "Old system", nb: "Gammel system", nn: "Gammal system" },
      userPromptTemplate: { "en-GB": "Old user", nb: "Gammel bruker", nn: "Gammal brukar" },
      examples: [],
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });
    await page.route("**/api/admin/content/modules/module-1/versions", async (route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201, contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    await page.locator("#settingsPromptToggle").click();
    await page.locator("#settingsPromptSystem").fill("New system instruction");
    await page.locator("#settingsPromptToggle").click();
    await expect(page.locator("#settingsPromptSystem")).toHaveCount(0);

    // Opening a sibling section used to replace the whole cache and drop the folded edit.
    await page.locator("#settingsSchemaToggle").click();
    await page.locator("#settingsSchemaToggle").click();

    // Still there when unfolded...
    await page.locator("#settingsPromptToggle").click();
    await expect(page.locator("#settingsPromptSystem")).toHaveValue("New system instruction");
    await page.locator("#settingsPromptToggle").click();

    // ...and sent, even though the field is folded away at the moment of saving.
    await page.locator("#settingsSave").click();
    await expect.poll(() => savedBody !== null).toBe(true);
    expect(savedBody.promptTemplate, "a folded edit was treated as no change").toBeTruthy();
    expect(savedBody.promptTemplate.systemPrompt["en-GB"]).toBe("New system instruction");
    // And the languages it never showed are untouched.
    expect(savedBody.promptTemplate.systemPrompt.nb).toBe("Gammel system");
    expect(savedBody.promptTemplate.systemPrompt.nn).toBe("Gammal system");
  });

  // QA round 2: three more ways the one-language editor lost the other two. Add/Remove rebuilt
  // every item from the DOM and dropped the locale metadata; the certification level compared
  // against the PREVIEW locale while being rendered in the UI locale; and switching UI language
  // left the previous language's text on screen tagged with the previous language.
  test("structural criteria edits and an untouched certification level keep every locale", async ({ page }) => {
    let savedBody: any = null;
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    // The mock helper types this as a plain string, but the API and the composer both accept a
    // locale map — which is the whole point of this test.
    (moduleExport.module as any).certificationLevel = { "en-GB": "advanced", nb: "videregaaende", nn: "vidaregaaande" };
    moduleExport.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: {
        evidence: {
          label: { "en-GB": "Evidence", nb: "Dokumentasjon", nn: "Dokumentasjon" },
          description: { "en-GB": "Cites sources", nb: "Viser til kilder", nn: "Viser til kjelder" },
          maxScore: 5, weight: 1, candidateVisible: true,
        },
      },
      scalingRule: { max_total: 5, practical_weight: 70 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });
    await page.route("**/api/admin/content/modules/module-1/versions", async (route) => {
      savedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    // Add a criterion: this rebuilds every existing card from the DOM, which is where the stored
    // locales used to be dropped.
    await page.locator("#settingsCriteriaEditor .vk-add").click();
    await page.locator("#settingsCriteriaEditor .vk-label").last().fill("Structure");
    await page.locator("#settingsSave").click();

    await expect.poll(() => savedBody !== null).toBe(true);
    const criteria: any = savedBody.rubric.criteria;
    const evidence: any = Object.values(criteria).find((c: any) =>
      typeof c.label === "object" && c.label["en-GB"] === "Evidence");
    expect(evidence, "the untouched criterion lost its locales on Add").toBeTruthy();
    expect(evidence.label.nb).toBe("Dokumentasjon");
    expect(evidence.label.nn).toBe("Dokumentasjon");
    expect(evidence.description.nn).toBe("Viser til kjelder");

    // The certification level was never touched, so it must not be in the payload at all — and
    // certainly not as a bare string that replaces the whole locale object.
    expect(savedBody.certificationLevel).toBeUndefined();
  });

  // #896 S3c: the Innstillinger editors live in module-level state, and loading another module did
  // not clear it. Before S3c that needed the author to open the criteria editor first; now the
  // criteria are always expanded, so simply LOOKING at module 1's settings was enough to carry its
  // rubric onto module 2 — and a save there would have written it.
  test("Innstillinger state does not leak from one module to the next", async ({ page }) => {
    const first = buildMockModuleExport({ id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1" });
    first.selectedConfiguration.rubricVersion = {
      id: "rubric-1",
      versionNo: 1,
      criteria: { clarity: { label: "Kriterium fra modul 1", description: "", maxScore: 5, weight: 1, candidateVisible: true } },
      scalingRule: { max_total: 5 },
    };
    const second = buildMockModuleExport({ id: "module-2", title: "Working time", moduleVersionId: "module-2-version-1" });
    second.selectedConfiguration.rubricVersion = {
      id: "rubric-2",
      versionNo: 1,
      criteria: { safety: { label: "Kriterium fra modul 2", description: "", maxScore: 5, weight: 1, candidateVisible: true } },
      scalingRule: { max_total: 5 },
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }, { id: "module-2", title: "Working time" }],
      moduleExports: { "module-1": first, "module-2": second },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await expect(page.locator("#settingsCriteriaEditor .vk-label").first()).toHaveValue("Kriterium fra modul 1");

    await page.goto("/admin-content/module/module-2/conversation");
    await page.locator("#tabSettings").click();
    await expect(page.locator("#settingsCriteriaEditor .vk-label").first()).toHaveValue("Kriterium fra modul 2");
    // And no phantom unsaved-changes warning on the way out, which is what a stale baseline gives.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeHidden();
  });

  // #896 S6 QA: the Innstillinger inputs live only in the DOM until Lagre, and every way OUT of
  // that tab re-renders the panel and destroys them. I guarded one exit and there were four. This
  // pins all of them, because the failure mode is silent — the value is simply gone.
  test("unsaved settings are protected on every exit from Innstillinger", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    const certInput = page.locator("#settingsCertLevel");
    await expect(certInput).toBeVisible();
    const original = await certInput.inputValue();
    // A select now (the level is a fixed scale), so pick a different option than the stored one.
    const edited = original === "advanced" ? "basic" : "advanced";
    await certInput.selectOption(edited);

    // Exit 1: tab switch. The dialog must be the DESTRUCTIVE one — settings are not kept, unlike
    // a draft, and telling the author "your draft is kept" here would be a lie about a different
    // thing entirely.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeVisible();
    await expect(page.locator("#unsavedTabSwitchBody")).toContainText(/forkast|discard/i);
    await page.locator("#tabSwitchStay").click();
    await expect(certInput).toHaveValue(edited);

    // Exit 2: UI language. This one had no guard at all — the panel re-rendered instantly.
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#localeSelect").selectOption("nb");
    await expect(certInput).toHaveValue(edited);
    // Declining puts the selector back, so the page is not left claiming a language it did not
    // switch to.
    await expect(page.locator("#localeSelect")).toHaveValue("en-GB");

    // Exit 3 was "Åpne avansert redigering", which called applyTabState directly and so went
    // around switchToTab and its guard. S3c deleted the page it opened; the button outlived its
    // click handler and was removed 2026-08-18. Worth noting that by then this step passed
    // trivially — clicking a button with no listener cannot leave the tab, so it asserted that
    // nothing happened after nothing happened.

    // And an untouched field must not trigger any of this — a guard that cries wolf gets clicked
    // through without reading.
    await certInput.selectOption(original);
    await page.locator("#tabEdit").click();
    await expect(page.locator("#tabEdit")).toHaveAttribute("aria-selected", "true");
  });

  // #896 S6: export packages the version the workspace is SHOWING, and leaves the author able to
  // keep working. Both halves were wrong: the endpoint defaults to the live version, and choosing
  // a chat action disables the menu, which nothing put back after a download.
  test("Rediger exports the version on screen and keeps the module actions usable", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-2",
    });
    // Live is v1; the workspace is showing the unpublished v2.
    moduleExport.module.activeVersionId = "module-1-version-1";

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let exportUrl: string | null = null;
    await page.route("**/api/admin/content/modules/*/export-package*", async (route) => {
      exportUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ envelope: { exportFormat: "a2-content-export/v1", scope: "module" } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    const download = page.waitForEvent("download");
    await clickEnabledButton(page, /Eksporter modulpakke|Export module package/);
    await download;

    // The request names the displayed version. Without it the file holds the published v1 and the
    // author's newest work never leaves the machine.
    await expect.poll(() => exportUrl).toContain("moduleVersionId=module-1-version-2");

    // And the workspace is still usable — the menu comes back rather than dead-ending on a
    // download.
    await expect(
      page.getByRole("button", { name: /Eksporter modulpakke|Export module package/ }).last(),
    ).toBeEnabled();
  });

  // #896 S6: import belongs on Rediger and goes INTO the module you are in, as a new unpublished
  // version. Creating a new module beside it is the module list's job, and publishing stays an
  // explicit act — so a package whose source was live still lands as a draft.
  test("Rediger imports a package into this module as a new unpublished version", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": moduleExport },
    });

    let importBody: Record<string, unknown> | null = null;
    let importKey: string | null = null;
    await page.route("**/api/admin/content/modules/import", async (route) => {
      importBody = route.request().postDataJSON() as Record<string, unknown>;
      importKey = route.request().headers()["idempotency-key"] ?? null;
      // The real endpoint appends a version, so the reload afterwards selects a different one.
      // A mock that skips this hides the client's reload check — which exists because loadModule
      // swallows its own fetch errors and would otherwise announce success over stale content.
      const imported = { ...moduleExport.selectedConfiguration.moduleVersion, id: "module-1-version-2", versionNo: 2 };
      moduleExport.selectedConfiguration.moduleVersion = imported;
      moduleExport.versions.moduleVersions = [imported, ...moduleExport.versions.moduleVersions];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleId: "module-1", moduleVersionId: "module-1-version-2" }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");

    const chooser = page.waitForEvent("filechooser");
    await clickEnabledButton(page, /Importer pakke i denne modulen|Import package into this module/);
    await (await chooser).setFiles({
      name: "module.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ exportFormat: "a2-content-export/v1", scope: "module", module: {} }),
      ),
    });

    await expect.poll(() => importBody?.mode).toBe("replaceExisting");
    // `targetId` is the schema's field name. This assertion used to read `targetModuleId`, which
    // the mock happily accepted and the real endpoint strips — so every import 400'd while the
    // suite stayed green. `test/m2-workspace-export-import-896.test.ts` now exercises the real
    // endpoint with the same body; this one only guards the client's half.
    expect(importBody!.targetId).toBe("module-1");
    expect(importBody!.targetModuleId).toBeUndefined();
    // #896 §9: import always lands unpublished, whatever the source's state was.
    expect(importBody!.autoPublish).toBe(false);
    // A retry after a lost response must not turn one package into two versions.
    expect(importKey).toBeTruthy();
    await expect(page.getByText(/ny upublisert versjon|new unpublished version/).first()).toBeVisible();
  });

  test("Rediger refuses a course package instead of sending it to the module importer", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    let importCalled = false;
    await page.route("**/api/admin/content/modules/import", async (route) => {
      importCalled = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
    });

    await page.goto("/admin-content/module/module-1/conversation");

    const chooser = page.waitForEvent("filechooser");
    await clickEnabledButton(page, /Importer pakke i denne modulen|Import package into this module/);
    await (await chooser).setFiles({
      name: "course.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ exportFormat: "a2-content-export/v1", scope: "course" })),
    });

    // Said so before sending it, rather than failing deep inside the importer.
    await expect(page.getByText(/kurspakke|course package/).first()).toBeVisible();
    expect(importCalled).toBe(false);
  });

  test("shell can create a new module, generate content, and save without losing the module ID", async ({ page }) => {
    await mockCommonApis(page);

    await page.goto("/admin-content.html");

    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Trade unions");
    // #555: unified order — source material is the first question, then module-type, then
    // (for free-text) scenario → cert level. Pick "Free-text + MCQ" and "auto" scenario.
    await submitActiveChatInput(page, "Source notes about labour rights and worker organising.");
    await clickEnabledButton(page, "Free-text + MCQ");
    await clickEnabledButton(page, "Let the LLM decide");
    await clickEnabledButton(page, "Basic");

    // v1.1.54 removed the "Vanlig/Grundig" (Ordinary/Thorough) generation-mode prompt
    // (always "thorough" now). After cert level the next interactive step is the
    // blueprint preview (v1.1.53). Pin BOTH facts:
    //   - no Ordinary/Thorough button exists in this conversation
    //   - blueprint accept/skip buttons DO appear
    await expect(page.getByRole("button", { name: /^Ordinary$|^Vanlig$|^Thorough$|^Grundig$/i })).toHaveCount(0);
    await clickEnabledButton(page, /Use this plan|Bruk denne planen/);

    // v1.1.96 removed the "Yes/No, generate MCQ" dialog — MCQ is required for save from
    // the shell, so the "No" branch was a dead-end. Flow now goes directly to the count
    // question after the blueprint is accepted.
    await clickEnabledButton(page, "3 questions");
    await clickEnabledButton(page, "4 options");

    await expect(page.getByText("Module created.")).toBeVisible();
    await clickEnabledButton(page, "Save draft");

    await expect(page.getByText("Open or create a module before saving.")).toHaveCount(0);
    await expect(page.getByText(/Trade unions.*loaded\./)).toBeVisible();
  });

  // #918: the title an author types into the conversation exists in exactly one language — the one
  // they typed it in. Sending `{nb, nn, "en-GB"}` filled with that one string is the encoding for
  // "this IS translated" (#892/#905), so the publish gate found no gap in a title nobody had
  // translated, and Norwegian participants got the English one. The module library has always sent
  // a plain string; `localizedTextSchema` is `string | {all three}` and accepts it.
  //
  // Two creation paths, one test: free-text and MCQ-only are separate functions that made the same
  // mistake in the same words, which is precisely the "correct fix, incomplete surface" class.
  test("the conversation creates a module with a one-language title, not three copies of it", async ({ page }) => {
    const state = await mockCommonApis(page);

    await page.goto("/admin-content.html");
    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Incident response");
    await submitActiveChatInput(page, "Source notes about handling security incidents.");
    await clickEnabledButton(page, "Free-text + MCQ");
    await clickEnabledButton(page, "Let the LLM decide");
    await clickEnabledButton(page, "Basic");
    // The module shell is created inside `confirmAndGenerate`, which the blueprint step gates.
    await clickEnabledButton(page, /Use this plan|Bruk denne planen/);

    // ⚠️ #918 krevde en REN STRENG her, for å bevise at tittelen ikke var kopiert til tre språk.
    // #930 går ett skritt videre: en ren streng bærer ikke noe språkmerke, og leses som bokmål. En
    // tittel skrevet på engelsk ble dermed lagret som norsk, og publiseringsgaten navnga feil språk
    // som manglende.
    //
    // Påstanden er derfor STRENGERE nå, ikke svakere: ett språk, og vi vet hvilket.
    await expect.poll(() => state.lastModuleCreateBody?.title).toEqual({ "en-GB": "Incident response" });
    expect(
      Object.keys(state.lastModuleCreateBody.title),
      "et trespråkskart påstår en oversettelse forfatteren aldri laget",
    ).toEqual(["en-GB"]);

    // MCQ-only takes its own route to the same endpoint.
    await page.goto("/admin-content.html");
    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Safety quiz");
    await submitActiveChatInput(page, "Source notes for an MCQ-only quiz about safety rules.");
    await clickEnabledButton(page, "MCQ only");
    await clickEnabledButton(page, "Basic");

    await expect.poll(() => state.lastModuleCreateBody?.title).toEqual({ "en-GB": "Safety quiz" });
    expect(Object.keys(state.lastModuleCreateBody.title)).toEqual(["en-GB"]);
  });

  // #918, third creation path. This is the one where the lie survives all the way to the publish
  // gate: the other two put a bare string in `sessionDraft.title`, so the first save corrects the
  // module row. The import put the tri-locale map there too, and `normalizeModuleTitlePatch` passed
  // it on to the save — the gate reads that value, saw three locales, and let the module publish.
  test("an external-LLM import carries the title's real language through to the save", async ({ page }) => {
    const state = await mockCommonApis(page);

    const importJson = (title: unknown) => JSON.stringify({
      module: { title, certificationLevel: "basic" },
      moduleVersion: {
        taskText: "Handle a reported security incident from first alert to closure.",
        assessorExpectedContent: "A strong answer names containment, escalation and reporting.",
      },
      mcqSet: {
        questions: [
          {
            stem: "Who must be notified first?",
            options: ["The duty officer", "The press"],
            correctAnswer: "The duty officer",
            rationale: "Escalation starts with the duty officer.",
          },
        ],
      },
    });

    const runImport = async (payload: string) => {
      await page.goto("/admin-content.html");
      await clickEnabledButton(page, "Create new module");
      await submitActiveChatInput(page, "Ignored — the import carries its own title");
      await clickEnabledButton(page, "Use external LLM");
      await page.locator("#externalLlmJsonInput").fill(payload);
      await page.locator('[data-ext-action="import"]').click();
      await expect(page.getByText("Module imported.")).toBeVisible();
    };

    await runImport(importJson("Incident response"));
    expect(state.lastModuleCreateBody.title).toEqual({ "en-GB": "Incident response" });

    await clickEnabledButton(page, "Save draft");
    // The value the publish gate reads. Three identical copies here is the module telling the gate
    // it is translated; a bare string is it admitting it is not.
    await expect.poll(() => state.lastModuleVersionBody?.title).toBe("Incident response");

    // The caveat that makes this a merge and not a downgrade: an import MAY carry a real
    // translation, and a locale object must pass through untouched rather than being flattened.
    const translated = { "en-GB": "Incident response", nb: "Hendelseshåndtering", nn: "Hendingshandtering" };
    await runImport(importJson(translated));
    expect(state.lastModuleCreateBody.title).toEqual(translated);
  });

  // #927 (#896 §11): the last uncovered finish criterion — an e2e that follows the NEW-MODULE
  // journey end to end through the tab surface, not just "create and save".
  //
  // The path is not arbitrary. Every single leg of it has had a silent data-loss bug during this
  // epic, all found by cross-model review or by the product owner on stage, none by the suite:
  //   - criteria edited in Innstillinger never reached the draft save (QA round 2)
  //   - the panel was unreachable in the new-module flow because `bundle` never loaded (round 3)
  //   - background generation overwrote manual edits (round 4)
  //   - Add/Remove lost locale metadata (round 4)
  //   - rebuilding the panel erased what had been typed (round 6)
  //
  // I gave up on this test three times during the epic: the harness tore the chat menu down on
  // tab switch. v2.19.0 moved the actions to a fixed bar outside the log, which is what made it
  // writable — the actions no longer scroll away or get rebuilt when the tab changes.
  //
  // The assertion is on the SAVE PAYLOAD, deliberately. Asserting a reload against a mocked API
  // would only prove the mock echoes what it was handed; the payload is what the server would
  // actually have persisted.
  test("a new module carries criteria edited in Innstillinger all the way into the save", async ({ page }) => {
    await mockCommonApis(page);

    // Held open so Innstillinger can be opened WHILE generation is in flight — the case round 3
    // and round 7 both broke on, and the one an author hits whenever they are quicker than the LLM.
    // Seeded with a no-op rather than null: TypeScript cannot see that a Promise executor runs
    // synchronously, so it narrows a `| null` binding to `never` at the call site below.
    let releaseRubric: () => void = () => {};
    const rubricInFlight = new Promise<void>((resolve) => { releaseRubric = resolve; });
    await page.route("**/api/admin/content/generate/rubric", async (route: Route) => {
      await rubricInFlight;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rubric: {
            criteria: [
              { id: "clarity", label: "Generert klarhet", description: "Generert beskrivelse", maxScore: 5 },
              { id: "depth", label: "Generert dybde", description: "Generert beskrivelse", maxScore: 5 },
            ],
          },
        }),
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let versionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      versionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-1", versionNo: 1 } }),
      });
    });

    await page.goto("/admin-content.html");

    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Trade unions");
    await submitActiveChatInput(page, "Source notes about labour rights and worker organising.");
    await clickEnabledButton(page, "Free-text + MCQ");
    await clickEnabledButton(page, "Let the LLM decide");
    await clickEnabledButton(page, "Basic");
    await clickEnabledButton(page, /Use this plan|Bruk denne planen/);
    await clickEnabledButton(page, "3 questions");
    await clickEnabledButton(page, "4 options");

    await expect(page.getByText("Module created.")).toBeVisible();

    // Innstillinger opens on a module that has no bundle — it was created in this session, not
    // loaded. Round 3: the panel was empty here because it read only from `bundle`.
    //
    // The tab guard fires on the way: an unsaved draft exists. That dialog is the non-destructive
    // one — it says the draft is KEPT, which is true — so confirming it is what an author does,
    // not something the test is working around.
    await page.locator("#tabSettings").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeVisible();
    await expect(page.locator("#unsavedTabSwitchBody")).toContainText(/kept|beholdes|bevart/i);
    await page.locator("#tabSwitchDiscard").click();
    await expect(page.locator("#tabPanelSettings")).toBeVisible();

    // Now let the generated criteria land, into a panel that is already on screen.
    releaseRubric();
    await expect(page.locator(".vk-card")).toHaveCount(2);
    await expect(page.locator(".vk-label").first()).toHaveValue("Generert klarhet");

    // Edit one, add one, remove one — the three operations round 4 lost locale metadata on.
    await page.locator(".vk-label").first().fill("Redigert klarhet");
    await clickEnabledButton(page, /Add criterion|Legg til kriterium/);
    await expect(page.locator(".vk-card")).toHaveCount(3);
    await page.locator(".vk-label").nth(2).fill("Nytt kriterium");
    await page.locator(".vk-card").nth(1).locator(".vk-remove").click();
    await expect(page.locator(".vk-card")).toHaveCount(2);

    // Back to Rediger, then save. Round 2: the edits never left the panel.
    //
    // The same non-destructive dialog on the way back. It says the draft is kept — and the
    // criteria edits are part of what it is promising to keep, because `unsavedTabSwitchKind`
    // absorbs them into the draft BEFORE it decides what to warn about. The save assertion below
    // is what proves that promise was honoured.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toBeVisible();
    await expect(page.locator("#unsavedTabSwitchBody")).toContainText(/kept|beholdes|bevart/i);
    await page.locator("#tabSwitchDiscard").click();
    await expect(page.locator("#previewEditTaskText")).toBeVisible();

    await clickEnabledButton(page, "Save draft");

    // Exactly the two criteria the author left behind — the edited one and the added one, with
    // the removed one gone. Asserting the SET and not just a count is the point: an earlier bug
    // saved the right number of criteria with the generated labels.
    await expect.poll(() => {
      const criteria = versionPayload?.rubric?.criteria;
      if (!criteria) return null;
      return Object.values(criteria)
        .map((c: any) => (typeof c?.label === "string" ? c.label : c?.label?.nb ?? c?.label?.["en-GB"]))
        .sort();
    }).toEqual(["Nytt kriterium", "Redigert klarhet"]);
  });

  // #578: the conversation can author a FREETEXT_ONLY module — free-text + LLM assessment, no MCQ.
  // After source the author picks "Free-text only"; the scenario/blueprint steps run but the MCQ
  // step is skipped, and the saved version sends assessmentMode=FREETEXT_ONLY with no mcqSetVersionId.
  test("shell can create a FREETEXT_ONLY module via the conversation", async ({ page }) => {
    await mockCommonApis(page);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let versionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      versionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-1", versionNo: 1 } }),
      });
    });
    // A free-text-only module must never create an MCQ set.
    let mcqSetCreated = false;
    await page.route("**/api/admin/content/modules/*/mcq-set-versions", async (route: Route) => {
      mcqSetCreated = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ mcqSetVersion: { id: "mcq-1" } }) });
    });

    await page.goto("/admin-content.html");
    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Essay module");
    await submitActiveChatInput(page, "Source notes for a free-text-only essay module.");
    await clickEnabledButton(page, "Free-text only");
    // Free-text-only keeps the scenario + blueprint steps (it is LLM-assessed free text).
    await clickEnabledButton(page, "Let the LLM decide");
    await clickEnabledButton(page, "Basic");
    await clickEnabledButton(page, /Use this plan|Bruk denne planen/);

    // No MCQ question-count step on the free-text-only path.
    await expect(page.getByText(/How many MCQ questions/i)).toHaveCount(0);
    await expect(page.getByText("Module created.")).toBeVisible();
    await clickEnabledButton(page, "Save draft");

    await expect.poll(() => versionPayload?.assessmentMode).toBe("FREETEXT_ONLY");
    expect(versionPayload?.mcqSetVersionId).toBeUndefined();
    expect(versionPayload?.taskText).toBeTruthy();
    expect(mcqSetCreated).toBe(false);
  });

  // #479 Slice B: the source step can crawl a whole site section. Clicking "Crawl site" prompts
  // for a start URL, POSTs to /source-material/crawl-url, and adds ONE combined source chip
  // labelled with the hostname + page count. Client-layer behaviour (prompt → fetch → combine →
  // chip) invisible to supertest, so it ships as an e2e alongside the feature.
  test("shell source step can crawl a site and adds a combined source chip", async ({ page }) => {
    await mockCommonApis(page);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let crawlBody: any = null;
    await page.route("**/api/admin/content/source-material/crawl-url", async (route: Route) => {
      crawlBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          startHostname: "example.com",
          pages: [
            { url: "https://example.com/", title: "Home", extractedText: "Home page text", fetchedBytes: 100 },
            { url: "https://example.com/a", title: "A", extractedText: "Page A text", fetchedBytes: 100 },
          ],
          pagesCrawled: 2,
          pagesSkipped: 0,
          totalBytes: 200,
          truncated: false,
        }),
      });
    });

    await page.goto("/admin-content.html");
    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Crawl module");

    // At the source step: accept the URL prompt, then click "Crawl site".
    page.once("dialog", (dialog) => dialog.accept("https://example.com/start"));
    await clickEnabledButton(page, "Crawl site");

    // One combined source chip appears, labelled host + page count.
    await expect(page.locator(".source-chip-label")).toContainText("example.com (2 pages)");
    expect(crawlBody?.url).toBe("https://example.com/start");
  });

  // #479 Slice A regression: the CLIENT file-size guard must allow files up to 10 MB. It was
  // left at 2 MB while the toast message + server cap already said 10 MB, so a 2.6 MB upload was
  // rejected client-side ("Filen er for stor … opptil 10 MB"). Upload a ~3 MB file and assert it
  // is accepted (extracted into a source chip), not rejected as too large.
  test("shell source step accepts a file between 2 and 10 MB", async ({ page }) => {
    await mockCommonApis(page);

    await page.goto("/admin-content.html");
    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Big file module");

    const threeMb = Buffer.alloc(3 * 1024 * 1024, 0x41);
    await page.locator('input[type="file"]').setInputFiles({
      name: "big.pdf",
      mimeType: "application/pdf",
      buffer: threeMb,
    });

    // Accepted: a source chip with the filename appears and no "too large" toast is shown.
    await expect(page.locator(".source-chip-label")).toContainText("big.pdf");
    await expect(page.getByText(/too large/i)).toHaveCount(0);
  });

  // #601 Fase 1: when extraction reports lowTextDensity (image-heavy / sparse text), the author
  // gets a warning toast — otherwise the thin source would silently produce a thin module. The
  // file is still accepted (chip appears); the author is just informed. Client-layer behaviour.
  test("shell source step warns when an uploaded file is image-heavy (low text density)", async ({ page }) => {
    await mockCommonApis(page);

    // Override the extract poll to report low text density (registered after mockCommonApis so it wins).
    await page.route("**/api/admin/content/source-material/extract/*", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "done",
          fileName: "deck.pptx",
          format: "pptx",
          extractedText: "Title slide only",
          extractedChars: 16,
          lowTextDensity: true,
        }),
      });
    });

    await page.goto("/admin-content.html");
    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Image-heavy module");

    await page.locator('input[type="file"]').setInputFiles({
      name: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.alloc(2 * 1024 * 1024, 0x41),
    });

    // The file is accepted (chip appears) AND the image-heavy warning toast is shown.
    await expect(page.locator(".source-chip-label")).toContainText("deck.pptx");
    await expect(page.locator(".toast--warning")).toContainText(/image-heavy/i);
  });

  // #454/#599 characterization: the source step can fetch a single URL. Clicking "Fetch from URL"
  // prompts for a URL, POSTs to /source-material/fetch-url, and adds a source chip labelled with
  // the returned hostname. This client fetch-layer flow had no e2e (baseline gap §4.1); pins
  // current behaviour before the #596/#598 refactors touch the shell.
  test("shell source step fetches a single URL and adds a source chip", async ({ page }) => {
    await mockCommonApis(page);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fetchBody: any = null;
    await page.route("**/api/admin/content/source-material/fetch-url", async (route: Route) => {
      fetchBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          extractedText: "Main article text extracted from the page.",
          sourceHostname: "example.org",
          fetchedBytes: 1234,
        }),
      });
    });

    await page.goto("/admin-content.html");
    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "URL module");

    page.once("dialog", (dialog) => dialog.accept("https://example.org/article"));
    await clickEnabledButton(page, "Fetch from URL");

    await expect(page.locator(".source-chip-label")).toContainText("example.org");
    expect(fetchBody?.url).toBe("https://example.org/article");
  });

  // #555: the conversation can author an MCQ-only module. After source material the author
  // picks "MCQ only", skips scenario/blueprint entirely, and the saved version sends
  // assessmentMode=MCQ_ONLY with the default 70% pass mark (no rubric/prompt/taskText).
  test("shell can create an MCQ-only module via the conversation", async ({ page }) => {
    await mockCommonApis(page);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let versionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      versionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-1", versionNo: 1 } }),
      });
    });

    await page.goto("/admin-content.html");

    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Quiz module");
    await submitActiveChatInput(page, "Source notes for an MCQ-only quiz about safety rules.");
    // #555: pick MCQ-only — no scenario or blueprint step should follow, straight to cert level.
    await clickEnabledButton(page, "MCQ only");
    await clickEnabledButton(page, "Basic");

    // No scenario or blueprint buttons exist on the MCQ-only path.
    await expect(page.getByRole("button", { name: /Let the LLM decide|Use this plan/i })).toHaveCount(0);

    await clickEnabledButton(page, "3 questions");
    await clickEnabledButton(page, "4 options");

    await expect(page.getByText("Module created.")).toBeVisible();
    await clickEnabledButton(page, "Save draft");

    await expect.poll(() => versionPayload?.assessmentMode).toBe("MCQ_ONLY");
    expect(versionPayload?.taskText).toBeUndefined();
    expect(versionPayload?.rubricVersionId).toBeUndefined();
    expect(versionPayload?.promptTemplateVersionId).toBeUndefined();
    expect(versionPayload?.assessmentPolicy?.passRules?.mcqMinPercent).toBe(70);
  });

  // Stage-tilbakemelding 2026-08-17: this used to switch on the UI language selector. The two are
  // separate now — the menus are one thing, the language the module is written in is another — so
  // the assertion moved to the control that actually governs the content.
  test("the content-language switcher changes the rendered task text; the UI language does not", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          assessorExpectedContent: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk spørsmål", nn: "Nynorsk spørsmål" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.getByText("English scenario")).toBeVisible();

    // Menus only.
    await page.locator("#localeSelect").selectOption("nb");
    await expect(
      page.getByText("English scenario"),
      "switching the menu language moved the content with it",
    ).toBeVisible();

    // Content.
    await page.locator("#previewLocaleBar button", { hasText: /Norsk bokmål/ }).click();
    await expect(page.getByText("Norsk scenario")).toBeVisible();
    await expect(page.getByText("English scenario")).toHaveCount(0);
  });

  test("shell workspace nav keeps profile on the right and preserves participant link for multi-role users", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
      navigationItems: [
        { id: "participant", path: "/participant", labelKey: "nav.participant", requiredRoles: ["PARTICIPANT"] },
        { id: "calibration", path: "/calibration", labelKey: "nav.calibration" },
        { id: "admin-content", path: "/admin-content", labelKey: "nav.adminContent" },
        { id: "results", path: "/results", labelKey: "nav.results" },
        { id: "profile", path: "/profile", labelKey: "nav.profile" },
      ],
      meRoles: ["SUBJECT_MATTER_OWNER", "PARTICIPANT"],
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.locator("#workspaceNav .workspace-nav-link")).toHaveCount(4);
    await expect(page.locator('#workspaceNav .workspace-nav-link[href="/participant"]')).toBeVisible();
    await expect(page.locator('#workspaceNav .workspace-nav-link[href="/profile"]')).toHaveCount(0);
    await expect(page.locator('.locale-picker #profileNavLink[href="/profile"]')).toBeVisible();
  });

  // #896 S1: the module workspace is three views on one module. These two guard the
  // structure itself - the default landing view, what each tab shows, and the one thing a
  // tab switch can destroy (an open direct-edit form).
  test("module workspace opens on Rediger and the tabs switch between the three views", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await expect(page.locator("#moduleWorkspaceTitle")).toBeVisible();

    // Rediger is the default: both panes visible.
    await expect(page.locator("#tabEdit")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".preview-pane")).toBeVisible();
    await expect(page.locator(".chat-pane")).toBeVisible();
    await expect(page.locator("#tabPanelSettings")).toBeHidden();

    // Forhaandsvisning: preview only, chat gone.
    await page.locator("#tabPreview").click();
    await expect(page.locator("#tabPreview")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".preview-pane")).toBeVisible();
    await expect(page.locator(".chat-pane")).toBeHidden();

    // Innstillinger: the edit grid goes away entirely. Asserting hidden here is the point -
    // .workspace-shell sets display:grid, so a class-based toggle would silently do nothing.
    await page.locator("#tabSettings").click();
    await expect(page.locator("#tabPanelSettings")).toBeVisible();
    await expect(page.locator("#tabPanelModule")).toBeHidden();
    // The panel shows the module's setup, not a pointer to somewhere else — the "Åpne avansert
    // redigering" button that stood here belonged to a page deleted in S3c.
    await expect(page.locator("#settingsSummary")).toBeVisible();
    await expect(page.locator("#settingsOpenAdvanced")).toHaveCount(0);

    // ...and back, with the preview content still rendered.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#tabPanelModule")).toBeVisible();
    await expect(page.getByText("Norsk scenario")).toBeVisible();
  });

  test("an unsaved draft warns on tab switch and is carried along, not discarded", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // Produce an unsaved draft without opening the edit form: confirm a direct edit, which
    // leaves a sessionDraft behind and makes the status rail say "unsaved".
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Bearbeidet scenario");
    await page.locator("#previewEditConfirm").click();
    await expect(page.locator("#previewEditTaskText")).toHaveCount(0);
    await expect(page.getByText("Bearbeidet scenario")).toBeVisible();

    // A draft is an investment whoever made it, so the switch is not silent...
    await page.locator("#tabPreview").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toHaveAttribute("open", "");
    // ...but nothing is destroyed by switching, so the wording and the button say so.
    await expect(page.locator("#unsavedTabSwitchBody")).toContainText(/kept when you switch|beholdes/);
    await expect(page.locator("#tabSwitchDiscard")).toHaveText(/Switch anyway|Bytt likevel/);

    await page.locator("#tabSwitchStay").click();
    await expect(page.locator("#tabEdit")).toHaveAttribute("aria-selected", "true");

    // Switching anyway keeps the draft - it is still what the preview renders.
    await page.locator("#tabPreview").click();
    await page.locator("#tabSwitchDiscard").click();
    await expect(page.locator("#tabPreview")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Bearbeidet scenario")).toBeVisible();
  });

  // #896 S2: Lagre is one commitment - translate, then write. These guard the three rules
  // that make that safe: no edit costs nothing, an abort writes nothing, and a locale that
  // fails to translate leaves a hole rather than a copy of the source text.
  test("Lagre translates and saves in one step, and an untouched form does neither", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          // A FREETEXT_PLUS_MCQ module needs its MCQ set, or the save stops on its own guard.
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // Opening and closing without editing must not spend a translation or write a version.
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditConfirm").click();
    await expect(page.getByText(/Nothing changed|Ingenting er endret/)).toBeVisible();
    expect(state.lastDraftLocalizationBody).toBeFalsy();

    // A real edit translates and saves without a second click.
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Bearbeidet scenario");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastDraftLocalizationBody?.sourceLocale).toBeTruthy();
    await expect(
      page.getByText(/Draft saved as a new module version|Utkastet er lagret som en ny modulversjon/).first(),
    ).toBeVisible();
  });

  test("cancelling the save writes nothing and hands the fields back", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    // Hold the translation open so the abort button can be pressed mid-flight.
    await page.route("**/generate/module-draft/localize", async () => {
      await new Promise(() => {});
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Halvferdig endring");
    await page.locator("#previewEditConfirm").click();

    await clickEnabledButton(page, /Cancel|Avbryt/);

    // The form is still standing, still holding the typed text, and nothing was written.
    // Scoped to the chat: the same text also reaches #shellStatusAnnouncer for screen
    // readers, which is intended - it just makes an unscoped locator ambiguous.
    await expect(page.locator("#chatMessages").getByText(/nothing was saved|ingenting ble lagret/)).toBeVisible();
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Halvferdig endring");
    // No version was written: the save never got past the (blocked) translation step.
    await expect(
      page.getByText(/Draft saved as a new module version|Utkastet er lagret som en ny modulversjon/),
    ).toHaveCount(0);
  });

  test("discarding while a save is running writes nothing", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    // Hold the translation open so the discard lands mid-save.
    await page.route("**/generate/module-draft/localize", async () => {
      await new Promise(() => {});
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Skal forkastes");
    await page.locator("#previewEditConfirm").click();

    // The form's own Cancel is disabled while saving, so the discard has to abort the save
    // itself - otherwise the translation resolves later and saves what was just discarded.
    await page.locator("#tabPreview").click();
    await page.locator("#tabSwitchDiscard").click();

    await expect(page.locator("#previewEditTaskText")).toHaveCount(0);
    await expect(
      page.getByText(/Draft saved as a new module version|Utkastet er lagret som en ny modulversjon/),
    ).toHaveCount(0);
  });

  test("a failed translation saves one language honestly instead of three copies", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.route("**/generate/module-draft/localize", async (route: Route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTitle").fill("Fagforeninger");
    await page.locator("#previewEditConfirm").click();

    // The save still goes through - but the untranslated locales must stay untranslated.
    // Copying the source text into all three is precisely the #892 bug.
    //
    // #896 S4 QA: the surviving locale is now sent as a ONE-KEY MAP rather than a bare string.
    // Both mean "written in one language, not translated yet"; only the map records WHICH one.
    // The bare string forced the publish gate to assume nb, so an author working in English was
    // told English was missing and the gap-fill filled the wrong two languages.
    // This spec runs with the UI in en-GB, so en-GB is the working language — and the saved value
    // says so. That is the whole improvement: under the old bare-string encoding this same save
    // was indistinguishable from Norwegian, and the gate would have reported en-GB as missing.
    await expect.poll(() => state.lastTitlePatchBody?.title).toBeTruthy();
    expect(state.lastTitlePatchBody.title).toEqual({ "en-GB": "Fagforeninger" });
    expect(state.lastTitlePatchBody.title.nb).toBeUndefined();
    expect(state.lastTitlePatchBody.title.nn).toBeUndefined();
  });

  test("discarding an open form into Forhaandsvisning leaves the workspace usable", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Halvferdig endring");

    // Switching to Forhaandsvisning re-renders the preview for a different audience, which
    // removes the form's own Cancel button. If teardown runs after that render, the editing
    // state is never cleaned up and the workspace is stuck until reload.
    await page.locator("#tabPreview").click();
    await page.locator("#tabSwitchDiscard").click();
    await expect(page.locator(".preview-pane--editing")).toHaveCount(0);

    // Back in Rediger the module is editable again, not frozen mid-edit.
    await page.locator("#tabEdit").click();
    await expect(page.getByText("Norsk scenario")).toBeVisible();
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);
  });

  test("moving between the two non-Rediger tabs does not re-ask about the draft", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Bearbeidet scenario");
    await page.locator("#previewEditConfirm").click();
    await expect(page.locator("#previewEditTaskText")).toHaveCount(0);

    // Leaving Rediger asks once...
    await page.locator("#tabPreview").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toHaveAttribute("open", "");
    await page.locator("#tabSwitchDiscard").click();

    // ...and moving on between two tabs that hold no editing surface must not ask again.
    await page.locator("#tabSettings").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).not.toHaveAttribute("open", "");
    await expect(page.locator("#tabPanelSettings")).toBeVisible();
  });

  test("the active tab survives a reload through the URL", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await expect(page).toHaveURL(/[?&]tab=settings/);

    await page.reload();
    await expect(page.locator("#tabSettings")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tabPanelSettings")).toBeVisible();
    // QA round 6: the tab was selected and the panel visible, but the CONTENT was still "load a
    // module to see the settings" — the panel is drawn during init, before the module arrives, and
    // was never redrawn. This assertion is the difference between the two.
    await expect(page.locator("#settingsSummary")).not.toContainText(/Last inn en modul|Load a module/);
    await expect(page.locator("#settingsModuleType")).toBeVisible();

    // Rediger is the default, so it stays out of the URL rather than pinning the plain route.
    await page.locator("#tabEdit").click();
    await expect(page).not.toHaveURL(/[?&]tab=/);
  });

  // #896 S3a: Innstillinger reads the module's setup out of the loaded bundle. Module type
  // comes first because it decides which fields Rediger even shows.
  test("Innstillinger shows the module's setup, module type first", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    const list = page.locator("#settingsSummary .settings-list").first();
    await expect(list).toBeVisible();

    // Module type is the first row, and reads as a phrase rather than an enum value.
    const firstTerm = list.locator("dt").first();
    await expect(firstTerm).toHaveText(/Module type|Modultype/);
    await expect(list.locator("dd").first()).toHaveText(/Free text and multiple choice|Fritekst og flervalg/);
    await expect(list.locator("dd").first()).not.toHaveText(/FREETEXT_PLUS_MCQ/);

    // Certification level belongs to the same group: it describes the module, not the assessment.
    await expect(list).toContainText(/Certification level|Sertifiseringsniv/);

    // "The hand-off is still there until S3b wires the rows up" — S3b wired them, S3c deleted the
    // page, and the button was removed 2026-08-18. Assert it stays gone: a link back to a deleted
    // page is a 404 waiting for an author.
    await expect(page.locator("#settingsOpenAdvanced")).toHaveCount(0);
  });

  // #896 S3c: reported from stage — "vurderingskriteria ligger nå 4 steder ... UI for
  // instillinger er ikke systematisk". The panel is now four blocks in a fixed order, each with
  // exactly one heading, and Lagre sits after all of them but before the history.
  test("Innstillinger is grouped, and Lagre comes after the settings but before the history", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    const titles = page.locator("#settingsSummary .settings-group-title");
    await expect(titles).toHaveText([
      /The module|Modulen/,
      /Assessment|Vurdering/,
      /Submission form|Innsendingsskjema/,
      /Saved versions|Lagrede versjoner|Lagra versjonar/,
    ]);

    // Criteria and the assessment instruction sit INSIDE Vurdering, one level down — they are not
    // peers of the groups. This is the duplication that was reported: the same weight everywhere.
    const assessment = page.locator("#settingsSummary .settings-group").nth(1);
    await expect(assessment.locator(".settings-subsection-title")).toHaveText([
      /Assessment criteria|Vurderingskriterier/,
      /Assessment instruction|Vurderingsinstruks/,
    ]);
    // ...and nowhere else. Criteria appearing twice in one panel is the bug this fixes.
    await expect(page.locator("#settingsSummary").getByRole("heading", { name: /Vurderingskriterier|Assessment criteria/ }))
      .toHaveCount(1);

    // QA caught a malformed CSS comment that killed the whole .settings-group rule while this test
    // still passed — text and document order say nothing about whether the hierarchy is visible.
    // So measure it: the group title must be visually distinct from a subsection title, and the
    // second group must carry its separator.
    const groupTitleWeight = await titles.first().evaluate((el) => getComputedStyle(el).textTransform);
    expect(groupTitleWeight).toBe("uppercase");
    const separator = await page.locator("#settingsSummary .settings-group").nth(1)
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(parseFloat(separator)).toBeGreaterThan(0);
    const subsection = await assessment.locator(".settings-subsection-title").first()
      .evaluate((el) => getComputedStyle(el).textTransform);
    expect(subsection).toBe("none");

    // Document order: every setting, then Lagre, then the history.
    const order = await page.locator("#settingsSummary").evaluate((host) => {
      const nodes = [...host.querySelectorAll("#settingsSave, .settings-group-title, .settings-criteria-section")];
      return nodes.map((n) => (n.id === "settingsSave" ? "save" : n.className.includes("group-title") ? `title:${n.textContent?.trim()}` : "section"));
    });
    expect(order.indexOf("save")).toBeGreaterThan(order.findIndex((x) => /Innsendingsskjema|Submission/i.test(x)));
    expect(order.indexOf("save")).toBeLessThan(order.findIndex((x) => /Lagrede versjoner|Lagra versjonar|Saved versions/i.test(x)));
  });

  // #896 S3b: module type is editable from Innstillinger, and only the types the module has
  // components for are offered — the rest are disabled with the reason, instead of being
  // selectable and then rejected by the API.
  // Stage-tilbakemelding 2026-08-19, med skjermbilde: en modul uten MCQ-sett viste
  // «Fritekst og fleirval — krev oppgåvetekst, rubrikk og MCQ-sett». Modulen HADDE oppgavetekst og
  // rubrikk — den er jo «Bare fritekst» — så forfatteren leste tre mangler der det var én, og hadde
  // ingen måte å se hvilken.
  //
  // Suffikset listet typens KRAV. Det skal navngi HULLET, samme regel som publiseringsgaten i §4.
  //
  // Merk hvorfor dette ikke ble fanget av testen under: den bygger en modul som har ALT, så ingen
  // valg er deaktivert og suffikset rendres aldri. Mocken var antakelsen som feilet.
  test("a disabled module type names what is missing, not what the type requires", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          assessmentMode: "FREETEXT_ONLY",
          // Ingen MCQ — det er nettopp modulen fra skjermbildet.
          mcqQuestions: [],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    const combined = page.locator('#settingsModuleType option[value="FREETEXT_PLUS_MCQ"]');
    await expect(combined).toBeDisabled();

    const label = (await combined.textContent()) ?? "";
    // Det som mangler skal stå der …
    expect(label).toMatch(/MCQ/i);
    // … og det modulen ALLEREDE har skal ikke stå der, for da leses det som en mangel.
    expect(label).not.toMatch(/oppgåvetekst|oppgavetekst|task text/i);
    expect(label).not.toMatch(/rubrikk|rubric/i);
  });

  test("Innstillinger can change the module type, and only offers types the module supports", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    const select = page.locator("#settingsModuleType");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("FREETEXT_PLUS_MCQ");

    // Switching to MCQ-only saves a new version through the composed endpoint.
    await select.selectOption("MCQ_ONLY");
    await page.locator("#settingsSave").click();

    await expect.poll(() => state.lastModuleVersionBody?.assessmentMode).toBe("MCQ_ONLY");
    // MCQ-only carries no free-text: the fields are left off rather than sent empty.
    expect(state.lastModuleVersionBody.taskText).toBeUndefined();
    expect(state.lastModuleVersionBody.rubricVersionId).toBeUndefined();
    expect(state.lastModuleVersionBody.mcqSetVersionId).toBeTruthy();

    // ...and the switch is reversible. The new version no longer points at the rubric or the
    // prompt, but the module still HAS them, so the free-text modes must stay available — and
    // switching back must reference them again. Reading availability off the current version
    // instead of the module's history stranded the module in whatever type it was last saved as.
    // Wait for the panel to be REBUILT from the reloaded bundle, not just for the value we
    // typed. Asserting the value alone passes instantly — it is what was selected by hand — and
    // the re-render then replaces the select underneath the next interaction.
    await expect(page.locator("#chatMessages")).toContainText(/Settings saved|Innstillingene er lagret/);
    await expect(page.locator("#settingsModuleType")).toHaveValue("MCQ_ONLY");
    await expect(page.locator('#settingsModuleType option[value="FREETEXT_PLUS_MCQ"]')).not.toBeDisabled();

    await page.locator("#settingsModuleType").selectOption("FREETEXT_PLUS_MCQ");
    await page.locator("#settingsSave").click();

    await expect.poll(() => state.lastModuleVersionBody?.assessmentMode).toBe("FREETEXT_PLUS_MCQ");
    expect(state.lastModuleVersionBody.rubricVersionId).toBeTruthy();
    expect(state.lastModuleVersionBody.promptTemplateVersionId).toBeTruthy();
    expect(state.lastModuleVersionBody.taskText).toBeTruthy();
  });

  // #896 S3c: migrated from "advanced editor authors an MCQ-only module version". That test was
  // the only cover for what an MCQ-only save actually SENDS, and it lived on a page that no longer
  // exists — so it moved here before Avansert was deleted, not after.
  //
  // The guarantees are the same four: the mode, no free-text, no rubric/prompt reference carried
  // over from the type it used to be, and the threshold the author set.
  test("switching to MCQ-only sends the mode, the threshold, and no free-text leftovers", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    await page.locator("#settingsModuleType").selectOption("MCQ_ONLY");
    // The criteria and instruction editors disappear with the type — a save cannot carry them,
    // so offering them would be offering an action that fails.
    await expect(page.locator("#settingsCriteriaEditor")).toHaveCount(0);
    await expect(page.locator("#settingsPromptToggle")).toHaveCount(0);

    await page.locator("#settingsMcqMinPercent").fill("80");
    await page.locator("#settingsSave").click();

    await expect.poll(() => state.lastModuleVersionBody?.assessmentMode).toBe("MCQ_ONLY");
    const sent = state.lastModuleVersionBody;
    expect(sent.assessmentPolicy?.passRules?.mcqMinPercent).toBe(80);
    // Free-text content and its two references must NOT ride along. The version model keeps them
    // on the previous version, which is what makes switching back non-destructive.
    expect(sent.taskText).toBeUndefined();
    expect(sent.rubricVersionId).toBeUndefined();
    expect(sent.rubric).toBeUndefined();
    expect(sent.promptTemplateVersionId).toBeUndefined();
    expect(sent.promptTemplate).toBeUndefined();
  });

  test("switching to free-text only keeps the pass rules it did not touch", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    // A module whose author has set real pass rules beyond the MCQ threshold.
    await page.addInitScript(() => {
      (window as unknown as { __seedPolicy?: unknown }).__seedPolicy = true;
    });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.evaluate(() => {
      const w = window as unknown as { __shellTestHook?: unknown };
      void w;
    });

    await page.locator("#tabSettings").click();
    await page.locator("#settingsModuleType").selectOption("FREETEXT_ONLY");
    await page.locator("#settingsSave").click();

    await expect.poll(() => state.lastModuleVersionBody?.assessmentMode).toBe("FREETEXT_ONLY");
    // The MCQ rule goes, because there is no MCQ any more. Everything else in the policy is
    // the author's and must survive — dropping it silently reverts pass/fail to platform
    // defaults, which changes who passes.
    const sent = state.lastModuleVersionBody.assessmentPolicy;
    if (sent?.passRules) {
      expect(sent.passRules.mcqMinPercent).toBeUndefined();
    }
    expect(state.lastModuleVersionBody.mcqSetVersionId).toBeUndefined();
  });

  // #896 S3b: certification level and validity were create-only — the only update path on a
  // module was the title, so a typo at creation was permanent. They now ride the composed save.
  test("Innstillinger can correct certification level and validity, and only sends what changed", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    await page.locator("#settingsCertLevel").selectOption("advanced");
    await page.locator("#settingsValidFrom").fill("2026-09-01");
    await page.locator("#settingsSave").click();

    // ONE value on a fixed scale, replaced outright — not a per-locale patch. An earlier pass
    // merged it and produced {"en-GB":"advanced",nb:"basic"}, which claims the module is advanced
    // in English and basic in Norwegian. The three labels are translated; the value is not.
    await expect.poll(() => state.lastModuleVersionBody?.certificationLevel).toBe("advanced");
    expect(state.lastModuleVersionBody.validFrom).toBe("2026-09-01");
    // Untouched fields are omitted, so a settings save never rewrites what it only displayed.
    expect(state.lastModuleVersionBody.validTo).toBeUndefined();
    expect(state.lastModuleVersionBody.description).toBeUndefined();
  });

  // #896 S3b: the description is participant-visible in the module list, so it is content and
  // lives in Rediger. It is sent as a locale patch so the composer merges it onto the stored
  // value — writing the whole object would delete the languages the author did not touch, the
  // same failure #892, #902 and #905 each produced in their own corner.
  test("the description can be corrected from Rediger and is sent as a locale patch", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();

    const description = page.locator("#previewEditDescription");
    await expect(description).toBeVisible();
    await description.fill("Rettet beskrivelse");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastModuleVersionBody?.description).toBeTruthy();
    const sent = state.lastModuleVersionBody.description;
    // A patch keyed by the edited locale — not a bare string, and not all three locales.
    expect(typeof sent).toBe("object");
    expect(Object.values(sent)).toContain("Rettet beskrivelse");
    expect(Object.keys(sent).length).toBe(1);
  });

  test("Innstillinger rejects a validity window that ends before it starts", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();

    await page.locator("#settingsValidFrom").fill("2026-09-01");
    await page.locator("#settingsValidTo").fill("2026-08-01");
    await page.locator("#settingsSave").click();

    // Caught before the request: a window that can never open is the author's mistake to see.
    await expect(page.locator(".toast, [role='alert']").first()).toContainText(/end date|Sluttdatoen/);
    expect(state.lastModuleVersionBody).toBeNull();
  });

  test("Innstillinger refuses to save settings while an unsaved draft exists", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // Produce an unsaved draft, then look at Innstillinger.
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Bearbeidet scenario");
    await page.locator("#previewEditConfirm").click();
    await expect(page.locator("#previewEditTaskText")).toHaveCount(0);

    await page.locator("#tabSettings").click();
    await page.locator("#tabSwitchDiscard").click();

    // A settings save would carry the STORED content forward and quietly drop the draft, so it
    // is blocked with the reason rather than offered.
    await expect(page.locator("#settingsSave")).toHaveCount(0);
    await expect(page.locator("#settingsSummary")).toContainText(/unsaved draft|ulagret utkast/);
  });

  test("Forhaandsvisning withholds the answer key and assessor-only content", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          assessorExpectedContent: localizedText("Maa nevne risikoreduserende tiltak"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Fordi B er riktig"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // Rediger is the author's view, and since v2.18.13 it is the EDIT FORM — so the assessor-only
    // material appears as editable fields rather than as read-out text. Everything is still on the
    // table, which is the half of this test that matters for Rediger.
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator("#previewEditGuidanceText")).toHaveValue(/Maa nevne risikoreduserende tiltak/);
    await expect(page.locator("#previewEditMcqRationale0")).toHaveValue(/Fordi B er riktig/);

    // Forhaandsvisning claims to show what the participant meets - so the assessor
    // expectation, the rationale and the marked correct option must all be gone.
    await page.locator("#tabPreview").click();
    await expect(page.getByText("Norsk scenario")).toBeVisible();
    await expect(page.getByText("Maa nevne risikoreduserende tiltak")).toHaveCount(0);
    await expect(page.getByText("Fordi B er riktig")).toHaveCount(0);
    await expect(page.locator(".preview-mcq-option.correct")).toHaveCount(0);
    // The answer is also spelled out in a meta line, which must go too - the options
    // themselves stay, unmarked, exactly as a learner sees them.
    await expect(page.locator(".preview-mcq-meta")).toHaveCount(0);
    await expect(page.locator(".preview-mcq-option", { hasText: "Option B" })).toHaveCount(1);
    // And no editable field leaked into the participant's view.
    await expect(page.locator("#previewEditGuidanceText")).toHaveCount(0);

    // ...and back: the author gets the full picture again, editable.
    await page.locator("#tabEdit").click();
    await expect(page.locator("#previewEditGuidanceText")).toHaveValue(/Maa nevne risikoreduserende tiltak/);
  });

  test("Escape on the unsaved-changes dialog behaves like staying", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    // Wait for the module to have LANDED, not just for the form to exist. The form is drawn once
    // during init and again when loadModule resolves; typing between the two put the text into a
    // form that was about to be replaced, and the unsaved-changes guard then had nothing to find.
    await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);
    await page.locator("#previewEditTaskText").fill("Halvferdig endring");

    await page.locator("#tabEdit").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#dialogUnsavedTabSwitch")).toHaveAttribute("open", "");

    // Escape bypasses every button, so it must not leave focus and selection disagreeing.
    await page.keyboard.press("Escape");
    await expect(page.locator("#dialogUnsavedTabSwitch")).not.toHaveAttribute("open", "");
    await expect(page.locator("#tabEdit")).toHaveAttribute("aria-selected", "true");
    // `toBeFocused` also requires the browser WINDOW to hold OS focus, which it does not reliably
    // do part-way through a long serial run — the assertion then failed for a reason that has
    // nothing to do with the app. What is under test is which element the page focused.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? null))
      .toBe("tabEdit");
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Halvferdig endring");

    // The stale pending switch must not fire on the next, unrelated switch either.
    await page.locator("#previewEditCancel").click();
    await page.locator("#tabSettings").click();
    await expect(page.locator("#tabPanelSettings")).toBeVisible();
  });

  test("the tablist is one tab stop and the arrow keys move both focus and view", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // One tab stop, established on load - not only after the first switch.
    await expect(page.locator("#tabEdit")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#tabPreview")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("#tabSettings")).toHaveAttribute("tabindex", "-1");

    await page.locator("#tabEdit").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#tabPreview")).toBeFocused();
    await expect(page.locator("#tabPreview")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tabPreview")).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("End");
    await expect(page.locator("#tabSettings")).toBeFocused();
    await expect(page.locator("#tabPanelSettings")).toBeVisible();

    await page.keyboard.press("Home");
    await expect(page.locator("#tabPreview")).toBeFocused();
  });

  test("staying after an arrow-key switch returns focus to the selected tab", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Halvferdig endring");

    // Arrowing focuses the target tab before the dialog appears, so "stay" must hand focus
    // back - otherwise it sits on a tab that is not the selected one.
    await page.locator("#tabEdit").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#dialogUnsavedTabSwitch")).toHaveAttribute("open", "");
    await page.locator("#tabSwitchStay").click();

    await expect(page.locator("#tabEdit")).toBeFocused();
    await expect(page.locator("#tabEdit")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Halvferdig endring");
  });

  test("help on the module route explains the tabs, not the module library", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator(".workspace-help-trigger").click();

    // The canonical module route carries the module in the PATH; help used to require it in
    // the query string and fell through to module-library help on this very page.
    await expect(page.locator("#workspaceHelpTitle")).toHaveText(/Conversation editing|Innholdsforvaltning: samtale/);
    await expect(page.locator("#workspaceHelpBody")).toContainText(/Edit tab|fanen Rediger/);
    await expect(page.locator("#workspaceHelpBody")).toContainText(/Settings holds the module type|Innstillinger holder modultype/);
  });

  test("leaving Rediger with an open edit form warns, and staying keeps the typed values", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Halvferdig endring");

    await page.locator("#tabPreview").click();
    await expect(page.locator("#dialogUnsavedTabSwitch")).toHaveAttribute("open", "");

    // Stay: same tab, same unsaved text.
    await page.locator("#tabSwitchStay").click();
    await expect(page.locator("#tabEdit")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Halvferdig endring");

    // Discard: the form is gone and the switch goes through.
    await page.locator("#tabPreview").click();
    await page.locator("#tabSwitchDiscard").click();
    await expect(page.locator("#tabPreview")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#previewEditTaskText")).toHaveCount(0);
    await expect(page.locator(".chat-pane")).toBeHidden();
  });

  // #905: a locale whose translation failed must be ABSENT from what is saved. Leaving the
  // source copy behind is what made "not translated yet" invisible to the publish gate (#896 S4)
  // and to the translation-status list (#894).
  // #982: en oversettelse som feiler skal sies fra om, ikke fylles med kildetekst.
  //
  // ⚠️ HVA DENNE MÅLER: direkte-redigering (`#previewEditConfirm`), som skriver til loggen selv og
  // ikke går gjennom `commitOrProposeGenerated`. Oppdaget ved mutasjonstesting — jeg fjernet
  // advarselen fra de tre kallerne jeg hadde endret, og denne forble grønn.
  //
  // Den parkerte grenen dekkes av «… også når forslaget parkeres bak åpne felter» lenger nede.
  test("en feilet oversettelse sier fra i loggen", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    // Begge målspråkene feiler, så advarselen MÅ komme.
    await page.route("**/generate/module-draft/localize", (route: Route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Bearbeidet scenario");
    await page.locator("#previewEditConfirm").click();

    await expect(page.locator("#chatMessages")).toContainText(
      /Ikke oversatt til|Not translated to|Ikkje omsett til/,
      { timeout: 10000 },
    );
  });

  test("a failed locale is left out of the saved draft, not filled with the source text", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("Option A"), localizedText("Option B")],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    // One target locale translates, the other fails outright.
    let call = 0;
    await page.route("**/generate/module-draft/localize", async (route: Route) => {
      call += 1;
      if (call === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ draft: { title: "Oversatt tittel", taskText: "Oversatt scenario" } }),
        });
        return;
      }
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTaskText").fill("Bearbeidet scenario");
    // #896 S2 merged Bekreft and Lagre: this one click translates and writes. The test was
    // written against the old two-step flow on a branch off main, and the extra "Lagre utkast"
    // click had nothing left to press once the branches met on dev.
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastModuleVersionBody?.taskText).toBeTruthy();
    const savedTaskText = state.lastModuleVersionBody.taskText;

    // Whatever survived, no locale may hold a copy of the source text - that is the bug.
    if (typeof savedTaskText === "object") {
      const values = Object.values(savedTaskText);
      expect(values.filter((v) => v === "Bearbeidet scenario").length).toBeLessThanOrEqual(1);
      expect(Object.keys(savedTaskText).length).toBeLessThan(3);
    } else {
      expect(savedTaskText).toBe("Bearbeidet scenario");
    }
  });

  test("direct edit localizes from the active preview locale and save sends a title patch", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          assessorExpectedContent: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk spÃ¸rsmÃ¥l", nn: "Nynorsk spÃ¸rsmÃ¥l" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    // #896 S3c: the handoff that carried the content locale is gone with Avansert. The
    // content-language bar is where that choice lives now.
    await page.locator("#previewLocaleBar button", { hasText: /Norsk bokmål/ }).click();

    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Norsk scenario");
    await page.locator("#previewEditTaskText").fill("Oppdatert norsk scenario");
    await page.locator("#previewEditGuidanceText").fill("Oppdatert norsk veiledning");
    await page.locator("#previewEditTitle").fill("Fagforeninger");
    await page.locator("#previewEditConfirm").click();

    // #896 S2: Lagre translates and writes in one commitment - no separate "Lagre utkast".
    await expect.poll(() => state.lastDraftLocalizationBody?.sourceLocale).toBe("nb");

    await expect.poll(() => state.lastTitlePatchBody?.title?.nb).toBe("Fagforeninger");
    await expect(state.lastTitlePatchBody?.title?.["en-GB"]).toContain("[en-GB]");
    // QA r7 #1: the module name was removed from the status rail (redundant with the module card).
    // The rename is verified by the title-patch body above.
  });

  test("chat revision can rename the module title through a bounded free-text instruction", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          assessorExpectedContent: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk sporsmal", nn: "Nynorsk sporsmal" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation?resumeEditing=1");

    // v1.1.56 made the unified-revision textarea an explicit step: the action menu
    // now contains a "Request changes in chat" button instead of auto-opening the
    // textarea below Save draft. Pin both: no textarea before click, textarea after.
    await expect(page.locator(".chat-textarea:enabled")).toHaveCount(0);
    await clickEnabledButton(page, /Request changes in chat|Be om endringer i chat/);

    const revisionInput = page.locator(".chat-textarea:enabled").last();
    await revisionInput.fill('Rename the module title to "Trade union dialogue"');
    await clickEnabledButton(page, /Revise|Revider/);

    await expect(page.getByText('I will update the module title to "Trade union dialogue" and refresh the localized variants.')).toBeVisible();
    await expect.poll(() => state.lastDraftLocalizationBody?.title).toBe("Trade union dialogue");

    await clickEnabledButton(page, /Save draft|Lagre utkast/);

    // QA r7 #1: module name removed from the status rail; rename verified via the localization + patch bodies.
    await expect.poll(() => state.lastTitlePatchBody?.title?.["en-GB"]).toBe("Trade union dialogue");
  });

  // #926 (#896 §6 krav 1): «Samtalen foreslår — den overskriver aldri.»
  //
  // The exact scenario the issue describes: the author writes a scenario by hand, asks the chat
  // for a revision, and used to get their own work replaced without ever saying yes. Worse, with
  // the edit form open the fields were NOT repainted, so the overwrite was invisible until save.
  //
  // Two tests, because the two halves fail differently: a gate that never proposes loses work
  // silently, and a gate that never commits makes every generation cost an extra click.
  // #982: advarselen om språk som ikke ble oversatt må vises OGSÅ når forslaget parkeres bak
  // åpne felter — det er den forfatteren som oftest ber om en revisjon møter.
  //
  // ⚠️ Jeg påsto først at denne grenen ikke kunne testes «fordi den krever chat-klassifisering».
  // Det var feil: klassifiseringen er klient-side og deterministisk, og testen rett under driver
  // allerede nøyaktig denne grenen. Påstanden var en antakelse, ikke et funn.
  test("en feilet oversettelse sier fra også når forslaget parkeres bak åpne felter", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          assessorExpectedContent: localizedText("Norsk veiledning"),
        }),
      },
    });

    await page.route("**/generate/module-draft/revise", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          draft: {
            taskText: "Generert scenario",
            assessorExpectedContent: "Generert veiledning",
            candidateTaskConstraints: "",
          },
        }),
      }));

    // Begge målspråkene feiler. Denne overstyrer default-mocken i `mockCommonApis`.
    await page.route("**/generate/module-draft/localize", (route: Route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));

    await page.goto("/admin-content/module/module-1/conversation?resumeEditing=1");
    await expect(
      page.locator("#workspaceActions").getByRole("button", { name: /Request changes in chat|Be om endringer i chat/ }),
    ).toBeEnabled();

    const taskField = page.locator("#previewEditTaskText");
    await expect(taskField).not.toHaveValue("");
    await taskField.fill("Skrevet for hånd");

    await clickEnabledButton(page, /Request changes in chat|Be om endringer i chat/);
    await page.locator(".chat-textarea:enabled").last().fill("Skjerp scenarioet");
    await clickEnabledButton(page, /Revise|Revider/);

    // Forutsetningen: forslaget ER parkert. Uten denne ville påstanden under kunne vært grønn
    // fordi vi målte den direkte stien i stedet.
    await expect(page.locator("#chatMessages").getByText(/Suggestion ready|Forslag klart/)).toBeVisible();

    // Og advarselen skal stå i den parkerte beskjeden.
    await expect(page.locator("#chatMessages")).toContainText(
      /Ikke oversatt til|Not translated to|Ikkje omsett til/,
    );
  });

  test("a revision lands as a proposal when the fields hold unsaved typing", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          assessorExpectedContent: localizedText("Norsk veiledning"),
        }),
      },
    });

    await page.route("**/generate/module-draft/revise", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          draft: {
            taskText: "Generert scenario",
            assessorExpectedContent: "Generert veiledning",
            candidateTaskConstraints: "",
          },
        }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation?resumeEditing=1");

    // Wait for the draft-ready state to settle before typing. `resumeEditing` builds a session
    // draft and repaints the form, so text filled in before that lands in a textarea that is
    // about to be replaced — the test would then be measuring the repaint, not the gate.
    await expect(
      page.locator("#workspaceActions").getByRole("button", { name: /Request changes in chat|Be om endringer i chat/ }),
    ).toBeEnabled();

    // The author's own work goes in first — this is what must survive.
    const taskField = page.locator("#previewEditTaskText");
    await expect(taskField).not.toHaveValue("");
    await taskField.fill("Skrevet for hånd");
    await expect(taskField).toHaveValue("Skrevet for hånd");

    await clickEnabledButton(page, /Request changes in chat|Be om endringer i chat/);
    await expect(taskField).toHaveValue("Skrevet for hånd");
    await page.locator(".chat-textarea:enabled").last().fill("Skjerp scenarioet");
    await clickEnabledButton(page, /Revise|Revider/);

    // The proposal is offered, and the field is untouched. Asserting the VALUE and not just the
    // presence of the buttons is the point: the old failure wrote the draft underneath a form
    // that kept showing the author's text, so a presence-only check would have passed then too.
    await expect(page.locator("#chatMessages").getByText(/Suggestion ready|Forslag klart/)).toBeVisible();
    await expect(taskField).toHaveValue("Skrevet for hånd");

    // Forkast leaves it that way.
    await clickEnabledButton(page, /^(Discard|Forkast)$/);
    await expect(taskField).toHaveValue("Skrevet for hånd");

    // Bruk replaces it — and repaints, so the author sees what they accepted.
    await clickEnabledButton(page, /Request changes in chat|Be om endringer i chat/);
    await page.locator(".chat-textarea:enabled").last().fill("Skjerp scenarioet igjen");
    await clickEnabledButton(page, /Revise|Revider/);
    await clickEnabledButton(page, /^(Use|Bruk)$/);
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Generert scenario");
  });

  // QA før prod, 2026-08-18. Fanget av ingen av de 199 e2e-ene, fordi ingen av dem lot menyspråket
  // og innholdsspråket peke hver sin vei — og etter v2.18.12 er nettopp det normaltilstanden så
  // snart forfatteren bytter meny én gang.
  //
  // Feilen: revisjonsstien leste `currentLocale` (MENYspråket) når den hentet teksten som skulle
  // revideres, og merket den med samme språk. Skriver du på bokmål og bytter menyen til engelsk,
  // sendes den norske teksten merket `en-GB` — LLM-en svarer på engelsk, oversettingen
  // maskinoversetter tilbake til nb, og originalteksten din er borte.
  test("a revision reads and tags the CONTENT language, not the menu language", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: { "en-GB": "English scenario", nb: "Norsk scenario", nn: "Nynorsk scenario" },
          assessorExpectedContent: { "en-GB": "English guidance", nb: "Norsk veiledning", nn: "Nynorsk rettleiing" },
        }),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let revisePayload: any = null;
    await page.route("**/generate/module-draft/revise", async (route: Route) => {
      revisePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          draft: { taskText: "Revidert", assessorExpectedContent: "Revidert", candidateTaskConstraints: "" },
        }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation?resumeEditing=1");
    await page.locator("#previewEditTaskText").waitFor();

    // Innholdsspråket settes til bokmål — dette er språket modulen skrives i.
    await page.locator("#previewLocaleBar .preview-locale-btn", { hasText: "Norsk bokmål" }).click();
    await expect(page.locator("#previewEditTaskText")).toHaveValue(/Norsk scenario/);

    // Menyspråket byttes til engelsk. Innholdsspråket skal IKKE følge med — det er hele poenget
    // med skillet, og vaktdialogen bekreftes bort her siden vi ikke har ulagrede endringer.
    await page.locator("#localeSelect").selectOption("en-GB");
    await expect(page.locator("#tabEdit")).toHaveText(/Edit/);

    await clickEnabledButton(page, /Request changes in chat|Be om endringer i chat/);
    await page.locator(".chat-textarea:enabled").last().fill("make the task shorter");
    await clickEnabledButton(page, /Revise|Revider/);

    // Begge halvdelene må holde: teksten som sendes er den NORSKE, og den er merket som norsk.
    // Uten den andre halvdelen oversettes svaret inn i feil språk og overskriver originalen.
    await expect.poll(() => revisePayload?.locale).toBe("nb");
    expect(revisePayload?.taskText).toContain("Norsk scenario");
    expect(revisePayload?.taskText).not.toContain("English scenario");
  });

  test("an untouched form takes the revision straight in, with no extra click", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: localizedText("Norsk scenario"),
          assessorExpectedContent: localizedText("Norsk veiledning"),
        }),
      },
    });

    await page.route("**/generate/module-draft/revise", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          draft: {
            taskText: "Generert scenario",
            assessorExpectedContent: "Generert veiledning",
            candidateTaskConstraints: "",
          },
        }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation?resumeEditing=1");
    await page.locator("#previewEditTaskText").waitFor();

    await clickEnabledButton(page, /Request changes in chat|Be om endringer i chat/);
    await page.locator(".chat-textarea:enabled").last().fill("Skjerp scenarioet");
    await clickEnabledButton(page, /Revise|Revider/);

    // Since v2.18.13 the Rediger form is open from the moment the tab is, so gating on presence
    // rather than dirtiness would turn every single generation into a proposal. Nothing was
    // typed here, so nothing is at risk and nothing should be asked.
    await expect(page.locator("#chatMessages").getByText(/scenario and guidance ready|scenario og veiledning er klart/)).toBeVisible();
    await expect(page.locator("#chatMessages").getByText(/Suggestion ready|Forslag klart/)).toHaveCount(0);
  });

  test("direct edit keeps MCQ visible and editable through translation and save", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-2", title: "Workplace dialogue", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-2": buildMockModuleExport({
          id: "module-2",
          title: "Workplace dialogue",
          moduleVersionId: "module-2-version-1",
          taskText: {
            "en-GB": "English scenario",
            nb: "Norsk scenario",
            nn: "Nynorsk scenario",
          },
          assessorExpectedContent: {
            "en-GB": "English guidance",
            nb: "Norsk veiledning",
            nn: "Nynorsk rettleiing",
          },
          mcqQuestions: [
            {
              stem: { "en-GB": "English question", nb: "Norsk sporsmal", nn: "Nynorsk sporsmal" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A", nn: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
                { "en-GB": "Option C", nb: "Alternativ C", nn: "Alternativ C" },
                { "en-GB": "Option D", nb: "Alternativ D", nn: "Alternativ D" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B", nn: "Alternativ B" },
              rationale: { "en-GB": "English rationale", nb: "Norsk begrunnelse", nn: "Nynorsk grunngjeving" },
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-2/conversation");

    await page.locator("#previewEditTitle").waitFor();
    // #896 S3c: the handoff that carried the content locale is gone with Avansert. The
    // content-language bar is where that choice lives now — and the form has to be open before
    // switching, because the switch rebuilds it in the language it moves to.
    await page.locator("#previewLocaleBar button", { hasText: /Norsk bokmål/ }).click();
    await expect(page.locator("#previewEditMcqStem0")).toHaveValue("Norsk sporsmal");
    await page.locator("#previewEditMcqStem0").fill("Oppdatert norsk sporsmal");
    await page.locator("#previewEditMcqOption0_1").fill("Oppdatert alternativ B");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastMcqLocalizationBody?.sourceLocale).toBe("nb");

    // v2.18.13: Rediger stays in edit mode after a save — the form is the tab, so dropping to a
    // read-out would leave the author looking at a read-only "Rediger". The MCQ therefore survives
    // as editable fields holding the saved values, not as rendered text.
    await expect(page.locator("#previewEditMcqStem0")).toHaveValue("Oppdatert norsk sporsmal");
    await expect(page.locator("#previewEditMcqOption0_1")).toHaveValue("Oppdatert alternativ B");
  });

  // #896 S4: the publish translation gate, seen from the author's side. The server decides; this
  // test is about what the author is told and what they can do about it. A 422 that renders as
  // `422: {"error":...,"issues":[...]}` in the chat log is technically a report and practically
  // a dead end — the whole point of the gate is that the next step is one click away.
  test("shell publish names the missing languages and offers to fill only the gaps", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          // nn is missing on the task text — the case the gate exists for.
          taskText: { "en-GB": "Scenario text (EN)", nb: "Scenario text (NB)" },
          // The gap-fill ends in an ordinary save, and an ordinary save of a FREETEXT_PLUS_MCQ
          // module refuses to run without questions. Without these the flow stops one step
          // short and the test would be asserting the wrong thing.
          mcqQuestions: [
            {
              stem: localizedText("Which body ratifies the agreement?"),
              options: [localizedText("The board"), localizedText("The members")],
              correctAnswer: localizedText("The members"),
              rationale: localizedText("Members vote on ratification."),
            },
          ],
        }),
      },
    });

    // Registered after mockCommonApis, so it wins: the first publish is blocked, the second (after
    // the gap is filled) succeeds — which is what makes "fill the gaps, then publish" verifiable
    // rather than merely plausible.
    let publishAttempts = 0;
    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      publishAttempts += 1;
      if (publishAttempts === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "publish_blocked_by_validation",
            message: "Pre-publish validation found blocking issues.",
            issues: [
              {
                severity: "blocking",
                code: "translation_incomplete",
                message: "taskText: missing nn",
                field: "taskText",
                missingLocales: ["nn"],
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    // #896 S3c: the handoff that carried the content locale is gone with Avansert. The
    // content-language bar is where that choice lives now.
    await page.locator("#previewLocaleBar button", { hasText: /Norsk bokmål/ }).click();
    await clickEnabledButton(page, /Publish|Publiser/);

    // The author must be able to read which field and which language, without opening devtools.
    // .first(): the chat bubble and the aria-live announcer both carry the text — by design, so
    // a screen-reader user hears the block too.
    await expect(page.getByText(/ikke ferdig oversatt|not fully translated/).first()).toBeVisible();
    await expect(page.getByText(/Oppgavetekst|Task text/).first()).toBeVisible();

    await clickEnabledButton(page, /Oversett det som mangler|Translate what is missing/);

    // Only the missing locale is requested — "translate what is missing" must not quietly
    // re-translate (and overwrite) the languages the author already wrote.
    await expect.poll(() => state.lastDraftLocalizationBody?.targetLocale).toBe("nn");

    // The save that follows carries all three locales, with en-GB and nb byte-identical to what
    // they were. A gap-fill that rewrites existing text is a different, unwanted feature.
    await expect.poll(() => state.lastModuleVersionBody?.taskText?.nn).toBeTruthy();
    expect(state.lastModuleVersionBody.taskText["en-GB"]).toBe("Scenario text (EN)");
    expect(state.lastModuleVersionBody.taskText.nb).toBe("Scenario text (NB)");

    // And publishing was retried automatically — the author asked to publish, and did.
    await expect.poll(() => publishAttempts).toBe(2);
  });

  // #896 S4 QA round 1 found two ways the gap-fill could never complete. Both are about the flow
  // guessing at things it should read: which languages the source can come from, and what type of
  // module it is saving.
  test("gap-fill works on a FREETEXT_ONLY module, where there is no MCQ and no assessor guidance", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          assessmentMode: "FREETEXT_ONLY",
          taskText: { "en-GB": "Scenario text (EN)", nb: "Scenario text (NB)" },
          // No assessor guidance either — the other half of the case that could not pick a source.
          assessorExpectedContent: {},
          mcqQuestions: [],
        }),
      },
    });

    let publishAttempts = 0;
    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      publishAttempts += 1;
      if (publishAttempts === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "publish_blocked_by_validation",
            issues: [
              {
                severity: "blocking",
                code: "translation_incomplete",
                message: "taskText: missing nn",
                field: "taskText",
                missingLocales: ["nn"],
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);
    await clickEnabledButton(page, /Oversett det som mangler|Translate what is missing/);

    // The save has to know the module is FREETEXT_ONLY. Reading the mode from `sessionDraft`
    // alone — which is null here, since nothing was edited — made the save demand an MCQ set,
    // fail its own guard, and never retry publish.
    await expect.poll(() => state.lastModuleVersionBody?.assessmentMode).toBe("FREETEXT_ONLY");
    await expect.poll(() => publishAttempts).toBe(2);
  });

  test("gap-fill can source a title-only gap on a module with no task text", async ({ page }) => {
    const mcqOnlyExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
      assessmentMode: "MCQ_ONLY",
      taskText: {},
      mcqQuestions: [
        {
          stem: localizedText("Which body ratifies the agreement?"),
          options: [localizedText("The board"), localizedText("The members")],
          correctAnswer: localizedText("The members"),
          rationale: localizedText("Members vote on ratification."),
        },
      ],
    });
    // The gap itself: the title genuinely lacks nn, so the fill has something to do. The helper
    // always builds complete three-locale titles, so it is knocked out here.
    mcqOnlyExport.module.title = { "en-GB": "Trade unions", nb: "Fagforeninger" };

    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": mcqOnlyExport },
    });

    let publishAttempts = 0;
    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      publishAttempts += 1;
      if (publishAttempts === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "publish_blocked_by_validation",
            issues: [
              {
                severity: "blocking",
                code: "translation_incomplete",
                message: "title: missing nn",
                field: "title",
                missingLocales: ["nn"],
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);
    await clickEnabledButton(page, /Oversett det som mangler|Translate what is missing/);

    // Requiring task text AND assessor guidance to pick a source locale made this unreachable:
    // an MCQ-only module has neither, so the action reported "no source language" even though
    // the title it needed to translate was right there.
    //
    // The title goes through the PER-FIELD localizer: the module-draft endpoint's schema demands a
    // task text and answer key this module does not have, so calling it would 400 and take the
    // rest of the fill down with it.
    await expect.poll(() => state.lastSectionLocalizationBody?.targetLocale).toBe("nn");
    expect(state.lastDraftLocalizationBody).toBeNull();
    await expect.poll(() => publishAttempts).toBe(2);
  });

  // #896 S4 QA round 2. Three ways the gap-fill could complete "successfully" and still leave the
  // author blocked on exactly the same 422.
  test("gap-fill fills a description gap, which the draft localizer cannot translate", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          description: { "en-GB": "About unions", nb: "Om fagforeninger" },
          // The fill ends in an ordinary save, which refuses to run on a FREETEXT_PLUS_MCQ module
          // with no questions.
          mcqQuestions: [
            {
              stem: localizedText("Which body ratifies the agreement?"),
              options: [localizedText("The board"), localizedText("The members")],
              correctAnswer: localizedText("The members"),
              rationale: localizedText("Members vote on ratification."),
            },
          ],
        }),
      },
    });

    let publishAttempts = 0;
    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      publishAttempts += 1;
      if (publishAttempts === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "publish_blocked_by_validation",
            issues: [
              {
                severity: "blocking",
                code: "translation_incomplete",
                message: "description: missing nn",
                field: "description",
                missingLocales: ["nn"],
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);

    // The message names the field in the author's language, not as the raw key `description`.
    await expect(page.getByText(/Beskrivelse|Description/).first()).toBeVisible();

    await clickEnabledButton(page, /Oversett det som mangler|Translate what is missing/);

    // The description was translated by the PER-FIELD localizer. The module-draft one never
    // returns a description, so a description-only gap used to survive the "successful" fill and
    // fail publish again on the very same issue.
    await expect.poll(() => state.lastSectionLocalizationBody?.targetLocale).toBe("nn");
    await expect.poll(() => state.lastModuleVersionBody?.description?.nn).toBeTruthy();
    // The languages the author already wrote are untouched.
    expect(state.lastModuleVersionBody.description["en-GB"]).toBe("About unions");
    expect(state.lastModuleVersionBody.description.nb).toBe("Om fagforeninger");
    await expect.poll(() => publishAttempts).toBe(2);
  });

  test("gap-fill leaves an absent optional field absent rather than sending an empty string", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: { "en-GB": "Scenario text (EN)", nb: "Scenario text (NB)" },
          mcqQuestions: [
            {
              stem: localizedText("Which body ratifies the agreement?"),
              options: [localizedText("The board"), localizedText("The members")],
              correctAnswer: localizedText("The members"),
              rationale: localizedText("Members vote on ratification."),
            },
          ],
        }),
      },
    });

    let publishAttempts = 0;
    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      publishAttempts += 1;
      await route.fulfill(
        publishAttempts === 1
          ? {
              status: 422,
              contentType: "application/json",
              body: JSON.stringify({
                error: "publish_blocked_by_validation",
                issues: [
                  {
                    severity: "blocking",
                    code: "translation_incomplete",
                    message: "taskText: missing nn",
                    field: "taskText",
                    missingLocales: ["nn"],
                  },
                ],
              }),
            }
          : {
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
            },
      );
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);
    await clickEnabledButton(page, /Oversett det som mangler|Translate what is missing/);

    await expect.poll(() => state.lastModuleVersionBody?.taskText?.nn).toBeTruthy();
    // This module has no description. Writing "" for it would make the save send an empty string,
    // which the localized-text schema rejects — the fill would succeed and the save would 400.
    expect(state.lastModuleVersionBody.description).toBeUndefined();
    await expect.poll(() => publishAttempts).toBe(2);
  });

  // MCQ gaps are reported per question, so their field name carries an index (`mcq.question3`)
  // and cannot have one i18n key each. The label is built from the pattern — and if that ever
  // breaks, the author reads a raw internal key.
  test("shell publish names an MCQ gap by question number, not by its internal field key", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "publish_blocked_by_validation",
          issues: [
            {
              severity: "blocking",
              code: "translation_incomplete",
              message: "mcq.question2: missing nn",
              field: "mcq.question2",
              missingLocales: ["nn"],
            },
          ],
        }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);

    await expect(
      page.getByText(/Multiple-choice question 2|Flervalgsspørsmål 2/).first(),
    ).toBeVisible();
    await expect(page.getByText("mcq.question2")).toHaveCount(0);
  });

  // #896 S4 QA round 3: the fallback is only a fallback if it can rescue the attempt. Deciding
  // "did this locale fail" from a thrown exception rather than from the gaps that remain meant a
  // fully successful fallback still reported failure and skipped the republish the author asked
  // for.
  test("gap-fill succeeds when the batch localizer fails but the per-field fallback fills every gap", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: { "en-GB": "Scenario text (EN)", nb: "Scenario text (NB)" },
          mcqQuestions: [
            {
              stem: localizedText("Which body ratifies the agreement?"),
              options: [localizedText("The board"), localizedText("The members")],
              correctAnswer: localizedText("The members"),
              rationale: localizedText("Members vote on ratification."),
            },
          ],
        }),
      },
    });

    // The batch localizer is down. The per-field one (mocked in the helpers) still works.
    await page.route("**/api/admin/content/generate/module-draft/localize", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });

    let publishAttempts = 0;
    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      publishAttempts += 1;
      await route.fulfill(
        publishAttempts === 1
          ? {
              status: 422,
              contentType: "application/json",
              body: JSON.stringify({
                error: "publish_blocked_by_validation",
                issues: [
                  {
                    severity: "blocking",
                    code: "translation_incomplete",
                    message: "taskText: missing nn",
                    field: "taskText",
                    missingLocales: ["nn"],
                  },
                ],
              }),
            }
          : {
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
            },
      );
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);
    await clickEnabledButton(page, /Oversett det som mangler|Translate what is missing/);

    // The gap really was filled — by the fallback.
    await expect.poll(() => state.lastModuleVersionBody?.taskText?.nn).toBeTruthy();
    // And because it was filled, publishing was retried. The author is not told the translation
    // failed when it plainly did not.
    await expect.poll(() => publishAttempts).toBe(2);
    await expect(page.getByText(/Fikk ikke oversatt alt|Could not translate every gap/)).toHaveCount(0);
  });

  // #896 S4 QA round 4: MCQ gap-fill on a question that legitimately has no rationale, where one
  // target locale succeeds and the other fails. Three separate ways this used to go wrong.
  test("MCQ gap-fill keeps partial success, invents no rationale, and omits an absent one", async ({ page }) => {
    const mcqExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
      assessmentMode: "MCQ_ONLY",
      taskText: {},
      mcqQuestions: [
        {
          // nb only, and NO rationale — a legal saved question.
          stem: { nb: "Hvem ratifiserer avtalen?" } as Record<string, string>,
          options: [{ nb: "Styret" } as Record<string, string>, { nb: "Medlemmene" } as Record<string, string>],
          correctAnswer: { nb: "Medlemmene" } as Record<string, string>,
          rationale: {} as Record<string, string>,
        },
      ],
    });
    mcqExport.module.title = { "en-GB": "Trade unions", nb: "Fagforeninger", nn: "Fagforeiningar" };

    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: { "module-1": mcqExport },
    });

    // en-GB translates; nn fails. The successful half must survive.
    const mcqBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/generate/mcq/localize", async (route) => {
      const body = route.request().postDataJSON() as { targetLocale?: string; questions?: unknown[] };
      mcqBodies.push(body);
      if (body.targetLocale === "nn") {
        await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          questions: [
            {
              stem: "Who ratifies the agreement?",
              options: ["The board", "The members"],
              correctAnswer: "The members",
              // The response contract makes the model return one even though none was sent.
              rationale: "Invented by the model.",
            },
          ],
        }),
      });
    });

    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "publish_blocked_by_validation",
          issues: [
            {
              severity: "blocking",
              code: "translation_incomplete",
              message: "mcq.question1: missing en-GB, nn",
              field: "mcq.question1",
              missingLocales: ["en-GB", "nn"],
            },
          ],
        }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);
    await clickEnabledButton(page, /Oversett det som mangler|Translate what is missing/);

    await expect.poll(() => state.lastModuleVersionBody?.mcqSet?.questions?.[0]?.stem?.["en-GB"]).toBeTruthy();
    const saved = state.lastModuleVersionBody.mcqSet.questions[0];

    // 1. The en-GB translation that DID succeed is kept. Collapsing to a bare source string
    //    because nn failed threw away work the author had already paid for.
    expect(saved.stem["en-GB"]).toBe("Who ratifies the agreement?");
    expect(saved.stem.nb).toBe("Hvem ratifiserer avtalen?");
    expect(saved.stem.nn).toBeUndefined();

    // 2. No invented rationale. The endpoint's response contract demands one; storing it would
    //    put assessor-facing text nobody wrote in front of a participant — and only in the target
    //    locales, so the next publish attempt would flag it as a gap anyway.
    expect(saved.rationale).toBeUndefined();

    // 3. The request omitted rationale rather than sending "", which the endpoint rejects.
    const sentQuestion = (mcqBodies[0]?.questions as Array<Record<string, unknown>>)[0];
    expect(sentQuestion.rationale).toBeUndefined();
  });

  // #896 S4 QA round 5: a publish response can carry a blueprint mismatch alongside the
  // translation gaps — the route appends gate issues to the existing validation list. Showing only
  // the gaps meant the author translated, retried, and failed again on a blocker nobody had
  // mentioned. A gate that hides half the reason teaches authors to distrust it.
  test("shell publish lists a non-translation blocker alongside the translation gaps", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.route("**/api/admin/content/modules/*/module-versions/*/publish", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "publish_blocked_by_validation",
          issues: [
            {
              severity: "blocking",
              code: "translation_incomplete",
              message: "taskText: missing nn",
              field: "taskText",
              missingLocales: ["nn"],
            },
            {
              severity: "blocking",
              code: "MCQ_COUNT_FAR_BELOW_BLUEPRINT",
              message: "The module has 2 MCQ questions but the blueprint asks for 10.",
            },
          ],
        }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, /Publish|Publiser/);

    await expect(page.getByText(/Task text|Oppgavetekst/).first()).toBeVisible();
    await expect(page.getByText(/blueprint asks for 10/).first()).toBeVisible();
  });

  test("shell publish keeps the module loaded and shows module actions", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // v1.1.55 removed the second "Confirm publish" dialog — publish now fires
    // immediately on the first click. Two clicks would race against the next bubble.
    await clickEnabledButton(page, /Publish|Publiser/);

    // v1.2.32 (#361/#442): after publishing, the shell reloads the module (now Live) and offers
    // its actions again instead of dropping the author back into the full module picker.
    //
    // v2.19.0: those actions live in the fixed bar, not in a chat bubble — the prompt sentence
    // went with the bubble, so the assertion is now that the bar has something to press.
    await expect(page.locator("#workspaceActions")).toBeVisible();
    await expect(page.locator("#workspaceActions .workspace-action-btn").first()).toBeEnabled();
    // The full module picker is NOT shown after publish.
    await expect(page.locator(".module-list .module-list-item")).toHaveCount(0);
  });

  // #555: regen on an existing module follows the unified order too — source material BEFORE
  // scenario (forfatter-feedback 2026-06-21: scenario-first felt wrong here as well).
  test("shell regen flow asks for source, then module type, then scenario", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, "Generate new content from source material");

    // Source material is asked first; neither module-type nor scenario shown yet.
    await expect(page.getByText("Paste source material")).toBeVisible();
    await expect(page.getByText("What kind of module is this?")).toHaveCount(0);
    await expect(page.getByText("Should the task use a scenario?")).toHaveCount(0);

    // #579: after source, the module-type question appears in regen too (not scenario directly).
    await submitActiveChatInput(page, "Updated source notes about labour rights and organising.");
    await expect(page.getByText("What kind of module is this?")).toBeVisible();
    await expect(page.getByText("Should the task use a scenario?")).toHaveCount(0);

    // Free-text branch then leads to the scenario question.
    await clickEnabledButton(page, "Free-text + MCQ");
    await expect(page.getByText("Should the task use a scenario?")).toBeVisible();
  });

  // #579: choosing "MCQ only" when regenerating skips scenario and goes straight to MCQ count.
  test("shell regen flow can switch the module to MCQ-only", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, "Generate new content from source material");
    await submitActiveChatInput(page, "Source notes for an MCQ-only quiz.");
    await expect(page.getByText("What kind of module is this?")).toBeVisible();
    await clickEnabledButton(page, "MCQ only");

    // No scenario on the MCQ-only branch — straight to the question-count question.
    await expect(page.getByText("Should the task use a scenario?")).toHaveCount(0);
    await expect(page.getByText(/How many MCQ questions/i)).toBeVisible();
  });

  // #578: regen can switch an existing module to FREETEXT_ONLY — scenario/blueprint run, MCQ is
  // skipped, and the saved version is FREETEXT_ONLY with no mcqSetVersionId.
  test("shell regen flow can switch the module to FREETEXT_ONLY", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
        }),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let versionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      versionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await clickEnabledButton(page, "Generate new content from source material");
    await submitActiveChatInput(page, "Updated source for a free-text-only version.");
    await expect(page.getByText("What kind of module is this?")).toBeVisible();
    await clickEnabledButton(page, "Free-text only");

    // Scenario + blueprint run; cert level is reused (known) so it is not asked again.
    await clickEnabledButton(page, "Let the LLM decide");
    await clickEnabledButton(page, /Use this plan|Bruk denne planen/);

    // No MCQ step on the free-text-only path.
    await expect(page.getByText(/How many MCQ questions/i)).toHaveCount(0);
    await clickEnabledButton(page, "Save draft");

    await expect.poll(() => versionPayload?.assessmentMode).toBe("FREETEXT_ONLY");
    expect(versionPayload?.mcqSetVersionId).toBeUndefined();
  });

  test("shell source-material upload keeps extracted content out of the input and sends it to generation", async ({ page }) => {
    const state = await mockCommonApis(page);

    await page.goto("/admin-content.html");

    await clickEnabledButton(page, "Create new module");
    await submitActiveChatInput(page, "Upload module");
    // #555: source material is now the first question (before module-type/scenario/cert).

    const fileInput = page.locator('input[type="file"]').last();
    await fileInput.setInputFiles({
      name: "source.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("fake-word-content"),
    });

    await expect(page.getByText("source.docx")).toBeVisible();
    const sourceTextarea = page.locator(".chat-textarea:enabled").last();
    await sourceTextarea.fill("Use a practical workplace framing.");
    await clickEnabledButton(page, /Next|Neste|Næste/i);
    // #555: module-type then scenario then cert follow the source step.
    await clickEnabledButton(page, "Free-text + MCQ");
    await clickEnabledButton(page, "Let the LLM decide");
    await clickEnabledButton(page, "Basic");

    // v1.1.54 removed Ordinary/Thorough generation-mode buttons — the flow goes
    // directly to the blueprint preview after cert-level selection.
    await clickEnabledButton(page, /Use this plan|Bruk denne planen/);

    await expect
      .poll(() => state.lastDraftGenerationBody?.sourceMaterial ?? "")
      .toContain("Extracted source material from source.docx");
    await expect
      .poll(() => state.lastDraftGenerationBody?.sourceMaterial ?? "")
      .toContain("Use a practical workplace framing.");
  });

  test("courses conversational flow creates the course on certification choice and opens the editor (#506)", async ({ page }) => {
    const state = await mockCommonApis(page, {
      libraryModules: [
        { id: "module-1", title: "Trade unions" },
        { id: "module-2", title: "Collective bargaining" },
      ],
    });

    await page.goto("/admin-content/courses/new");

    const titleInput = page.locator("#convTitleInput");
    await titleInput.fill("Labour rights");
    await titleInput.press("Enter");
    // #506: etter nivå-valg opprettes kurset direkte (tittel + nivå, ingen moduler) og editoren åpnes —
    // moduler OG seksjoner legges til der. Det gamle modul-søk-steget i samtalen er fjernet.
    await clickEnabledButton(page, "Basic");

    await expect(page).toHaveURL(/\/admin-content\/courses\/[^/]+$/);
    await expect.poll(() => state.mutableCourses.length).toBe(1);
    await expect.poll(() => state.mutableCourses[0]?.certificationLevel).toBe("basic");
    await expect.poll(() => state.mutableCourses[0]?.modules?.length ?? 0).toBe(0);
  });

  test("course detail view renders when backend returns null description for an existing course", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: "Labour rights",
          description: null,
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-04-18T12:00:00.000Z",
          publishedAt: null,
          archivedAt: null,
          modules: [],
        },
      ],
    });

    await page.goto("/admin-content/courses/course-1");

    await expect(page.locator("#detailPageTitle")).toContainText("Labour rights");
    await expect(page.locator("#desc-en-GB")).toHaveValue("");
    await expect(page.locator(".page-loading")).toHaveCount(0);
  });

  // #660 follow-up: the course list exposes an "Arkiver" action (the delete-blocked error tells
  // authors to archive instead). Archiving marks the course and removes the archive button.
  test("course list can archive a course, which hides it from the default list; toggle reveals it with restore (#673)", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: "Labour rights",
          description: null,
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-04-18T12:00:00.000Z",
          publishedAt: "2026-04-18T12:00:00.000Z",
          archivedAt: null,
          modules: [],
        },
      ],
    });
    // The shared harness's `courses/*` glob does not match the two-segment archive path, so
    // register the archive endpoint here: mark the course archived in the mock state so the
    // list re-render reflects it.
    await page.route("**/api/admin/content/courses/*/archive", async (route: Route) => {
      const segments = new URL(route.request().url()).pathname.split("/");
      const courseId = decodeURIComponent(segments[segments.length - 2] ?? "");
      const course = state.mutableCourses.find((c) => c.id === courseId);
      if (course) course.archivedAt = "2026-04-18T12:00:00.000Z";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course }) });
    });

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-action="archive"]')).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await row.locator('[data-action="archive"]').click();

    // #673/#705-UX(A): after archiving the course is hidden from the default "Aktive" filter; the
    // "Arkiverte" filter pill reveals it.
    await expect(page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" })).toHaveCount(0);
    const archivedFilter = page.locator('.list-filter-btn[data-filter="archived"]');
    await expect(archivedFilter).toBeVisible();
    await archivedFilter.click();

    // Now visible under the filter: carries the Archived badge, archive action gone, restore present.
    // (#705: the course badge is now localised via shared i18n; e2e boots on en-GB → English labels.)
    const archivedRow = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
    await expect(archivedRow).toContainText("Archived");
    await expect(archivedRow.locator('[data-action="archive"]')).toHaveCount(0);
    await expect(archivedRow.locator('[data-action="restore"]')).toBeVisible();
  });

  // #645/#496: the course detail form exposes a visibility (enrollmentPolicy) control so an author
  // can make a course RESTRICTED (only visible to enrolled / class-assigned participants).
  test("course detail can set visibility (enrollmentPolicy) to RESTRICTED", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: "Labour rights",
          description: null,
          certificationLevel: "basic",
          enrollmentPolicy: "OPEN",
          moduleCount: 0,
          updatedAt: "2026-04-18T12:00:00.000Z",
          publishedAt: null,
          archivedAt: null,
          modules: [],
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let putBody: any = null;
    await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
      const course = state.mutableCourses.find((c) => c.id === "course-1");
      if (route.request().method() === "PUT") {
        putBody = route.request().postDataJSON();
        if (course) course.enrollmentPolicy = putBody.enrollmentPolicy;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course }) });
    });

    await page.goto("/admin-content/courses/course-1");

    const select = page.locator("#enrollmentPolicy");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("OPEN");
    await select.selectOption("RESTRICTED");
    await page.locator("#saveCourseBtn").click();

    await expect.poll(() => putBody?.enrollmentPolicy).toBe("RESTRICTED");
  });

  test("shell idle flow opens the module picker and renders existing module choices", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [
        { id: "module-1", title: "Trade unions", activeVersion: { versionNo: 2 } },
        { id: "module-2", title: "Collective bargaining" },
      ],
    });

    await page.goto("/admin-content.html");

    await expect(page.locator("#moduleWorkspaceTitle")).toBeVisible();
    await expect(page.getByText("What would you like to do?")).toBeVisible();
    await page.getByRole("button", { name: "Open existing module" }).click();

    await expect(page.getByRole("button", { name: /Trade unions/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Collective bargaining/ })).toBeVisible();
  });

  test("courses conversational flow accepts Enter on course title and advances to certification choices", async ({ page }) => {
    await mockCommonApis(page, { libraryModules: [] });

    await page.goto("/admin-content/courses/new");

    const titleInput = page.locator("#convTitleInput");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Labour rights");
    await titleInput.press("Enter");

    await expect(titleInput).toBeDisabled();
    await expect(page.getByRole("button", { name: "Basic" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Intermediate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Advanced" })).toBeVisible();
  });

  test("courses creation and detail view localize certification level labels to the active UI locale", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger", nn: "Fagforeiningar" },
          description: {
            "en-GB": "English description",
            nb: "Norsk beskrivelse",
            nn: "Nynorsk skildring",
          },
          certificationLevel: "basic",
          moduleCount: 1,
          updatedAt: "2026-04-18T10:30:00.000Z",
          modules: [],
        },
      ],
      libraryModules: [],
    });

    await page.goto("/admin-content/courses/new");
    await page.locator("#localeSelect").selectOption("nb");
    await page.locator("#convTitleInput").fill("Arbeidsmiljo");
    await page.locator("#convTitleInput").press("Enter");

    await expect(page.getByRole("button", { name: "Grunnleggende" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Videregående" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Avansert" })).toBeVisible();

    await page.goto("/admin-content/courses/course-1");
    await expect(page.locator("#detailPageTitle")).toContainText("Fagforeninger");
    await expect(page.locator("#certLevel")).toContainText("Grunnleggende");
    await expect(page.locator("#tab-nb")).toHaveClass(/active/);
    await expect(page.locator("#title-nb")).toHaveValue("Fagforeninger");
    await expect(page.locator("#desc-nb")).toHaveValue("Norsk beskrivelse");
  });

  test("courses conversational creation stores the typed title in the active locale and localizes the other variants", async ({ page }) => {
    const state = await mockCommonApis(page, {
      libraryModules: [],
    });

    await page.goto("/admin-content/courses/new");
    await page.locator("#localeSelect").selectOption("nn");
    await page.locator("#convTitleInput").fill("Arbeidsmiljøkurs");
    await page.locator("#convTitleInput").press("Enter");
    // #506: nivå-valget oppretter kurset direkte og åpner editoren.
    await page.locator('[data-cert="basic"]').click();

    // #673-followup: opprettelse går nå rett til kurs-editoren (der seksjoner legges til), ikke lista.
    await expect(page).toHaveURL(/\/admin-content\/courses\/[^/]+$/);
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "nn")).toBe("Arbeidsmiljøkurs");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "en-GB")).toBe("Arbeidsmiljøkurs [en-GB]");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "nb")).toBe("Arbeidsmiljøkurs [nb]");
    await expect.poll(() => state.lastCourseLocalizationBodies.map((body) => body.targetLocale).sort()).toEqual(["en-GB", "nb"]);
  });

  test("course detail save refreshes other locales when title and description are edited in one language", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger", nn: "Fagforeiningar" },
          description: {
            "en-GB": "English description",
            nb: "Norsk beskrivelse",
            nn: "Nynorsk skildring",
          },
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-04-18T10:30:00.000Z",
          modules: [],
        },
      ],
    });

    await page.goto("/admin-content/courses/course-1");
    await page.locator("#tab-nn").click();
    await page.locator("#title-nn").fill("Nytt nynorsk kursnamn");
    await page.locator("#desc-nn").fill("Oppdatert nynorsk skildring");
    await page.locator("#saveCourseBtn").click();

    await expect(page.locator("#title-nn")).toHaveValue("Nytt nynorsk kursnamn");
    await expect(page.locator("#title-en-GB")).toHaveValue("Nytt nynorsk kursnamn [en-GB]");
    await expect(page.locator("#desc-nb")).toHaveValue("Oppdatert nynorsk skildring [nb]");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "nn")).toBe("Nytt nynorsk kursnamn");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.title, "en-GB")).toBe("Nytt nynorsk kursnamn [en-GB]");
    await expect.poll(() => courseTextForLocale(state.mutableCourses[0]?.description, "nb")).toBe("Oppdatert nynorsk skildring [nb]");
    await expect.poll(() => state.lastCourseLocalizationBodies.map((body) => body.targetLocale).slice(-2).sort()).toEqual(["en-GB", "nb"]);
  });

  test("courses conversational flow has no module-search step after certification choice (#506)", async ({ page }) => {
    const state = await mockCommonApis(page, {
      libraryModules: [{ id: "module-1", title: "Trade unions" }],
    });

    await page.goto("/admin-content/courses/new");

    await page.locator("#convTitleInput").fill("Labour rights");
    await page.locator("#convTitleInput").press("Enter");
    // #506: ingen modul-søk-steg lenger — nivå-valget oppretter kurset og åpner editoren.
    await clickEnabledButton(page, "Basic");

    await expect(page).toHaveURL(/\/admin-content\/courses\/[^/]+$/);
    await expect.poll(() => state.mutableCourses.length).toBe(1);
  });

  test("courses list refreshes 'Sist endret' after saving course changes", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions" },
          description: { "en-GB": "Original description" },
          certificationLevel: "basic",
          moduleCount: 0,
          updatedAt: "2026-04-18T10:30:00.000Z",
          modules: [],
        },
      ],
    });

    await page.goto("/admin-content/courses/course-1");
    await page.locator("#desc-en-GB").fill("Updated description");
    // Race fix: wait for the PUT response, not just the UI button state. CI is
    // slower than local and the next page.goto would otherwise outrun the mock's
    // in-memory updatedAt update (#432 follow-up; observed in run 26107095823).
    const saveResponse = page.waitForResponse((response) =>
      response.url().includes("/api/admin/content/courses/course-1") &&
      response.request().method() === "PUT" &&
      response.status() === 200,
    );
    await page.locator("#saveCourseBtn").click();
    await saveResponse;
    await expect(page.locator("#saveCourseBtn")).toBeEnabled();

    await page.goto("/admin-content/courses");
    await expect(page.locator("#coursesTableBody")).toContainText("23 Apr 2026");
  });

  test("courses list can publish a saved course with modules", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions" },
          description: { "en-GB": "Original description" },
          certificationLevel: "basic",
          moduleCount: 1,
          updatedAt: "2026-04-18T10:30:00.000Z",
          publishedAt: null,
          modules: [{ moduleId: "module-1", sortOrder: 1, moduleTitle: { "en-GB": "Trade unions" } }],
        },
      ],
    });

    await page.goto("/admin-content/courses");
    await expect(page.locator('[data-action="publish"][data-course-id="course-1"]')).toBeVisible();

    await page.locator('[data-action="publish"][data-course-id="course-1"]').click();

    await expect.poll(() => state.mutableCourses[0]?.publishedAt ?? null).toBe("2026-04-18T12:00:00.000Z");
    await expect(page.locator('[data-action="publish"][data-course-id="course-1"]')).toHaveCount(0);
  });

  test("courses list opens a delete dialog bound to the chosen course", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions", nb: "Fagforeninger" },
          certificationLevel: "advanced",
          moduleCount: 3,
          updatedAt: "2026-04-18T10:30:00.000Z",
          // #705-UX: Slett vises kun for arkiverte kurs, så denne må være arkivert.
          archivedAt: "2026-04-18T12:00:00.000Z",
        },
      ],
    });

    await page.goto("/admin-content/courses");

    await expect(page.getByRole("table", { name: "Kursliste" })).toBeVisible();
    // Arkiverte er skjult under default «Aktive»-filter — bytt til «Arkiverte».
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    await page.locator('[data-action="delete"]').first().click();

    await expect(page.locator("#deleteDialog")).toHaveAttribute("open", "");
    await expect(page.locator("#deleteDialogText")).toContainText("Trade unions");
  });

  // #705: enhetlig livssyklus — kurslista har nå Avpubliser (motstykke til Publiser) + status-merkelapp.
  test("courses list can unpublish a published course (#705)", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [
        {
          id: "course-1",
          title: { "en-GB": "Trade unions" },
          certificationLevel: "basic",
          moduleCount: 1,
          updatedAt: "2026-04-18T10:30:00.000Z",
          publishedAt: "2026-04-18T12:00:00.000Z",
          modules: [{ moduleId: "module-1", sortOrder: 1, moduleTitle: { "en-GB": "Trade unions" } }],
        },
      ],
    });
    // The shared catch-all only matches single-segment courses/*; register the two-segment unpublish path.
    await page.route("**/api/admin/content/courses/*/unpublish", async (route: Route) => {
      const segments = new URL(route.request().url()).pathname.split("/");
      const courseId = decodeURIComponent(segments[segments.length - 2] ?? "");
      const course = state.mutableCourses.find((c) => c.id === courseId);
      if (course) course.publishedAt = null;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course }) });
    });

    await page.goto("/admin-content/courses");
    const row = page.locator("#coursesTableBody tr").filter({ hasText: "Trade unions" });
    // #705: course badge is now shared-i18n; e2e boots on en-GB → English labels.
    await expect(row.locator(".status-badge")).toHaveText("Published");
    await expect(row.locator('[data-action="unpublish"]')).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await row.locator('[data-action="unpublish"]').click();

    await expect.poll(() => state.mutableCourses[0]?.publishedAt ?? null).toBeNull();
    // Etter avpublisering: status → Utkast, og Publiser-knappen kommer tilbake.
    await expect(page.locator("#coursesTableBody tr").filter({ hasText: "Trade unions" }).locator(".status-badge")).toHaveText("Draft");
    await expect(page.locator('[data-action="publish"][data-course-id="course-1"]')).toBeVisible();
  });

  // #705: seksjonslista fikk samme status-merkelapp + Publiser/Avpubliser/Arkiver/Gjenopprett.
  test("sections list shows status and runs the lifecycle actions (#705)", async ({ page }) => {
    await mockCommonApis(page);
    const sections: Array<{ id: string; title: string; versionNo: number; activeVersionId: string | null; archivedAt: string | null; updatedAt: string }> = [
      { id: "section-1", title: "Intro", versionNo: 2, activeVersionId: "v2", archivedAt: null, updatedAt: "2026-04-18T10:30:00.000Z" },
    ];
    await page.route("**/api/admin/content/sections", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections }) });
    });
    await page.route("**/api/admin/content/sections/*/unpublish", async (route: Route) => {
      sections[0].activeVersionId = null;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: sections[0] }) });
    });
    await page.route("**/api/admin/content/sections/*/publish", async (route: Route) => {
      sections[0].activeVersionId = "v2";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: sections[0] }) });
    });

    // Seksjonssida er lokalisert; e2e booter på en-GB, så vi sjekker engelske etiketter her.
    await page.goto("/admin-content/sections");
    const row = page.locator("#sectionsTableBody tr").filter({ hasText: "Intro" });
    await expect(row.locator(".status-badge")).toHaveText("Published");
    await expect(row.locator('[data-action="unpublish"]')).toBeVisible();

    await row.locator('[data-action="unpublish"]').click();
    // Etter avpublisering: status → Draft, og Publish-knappen vises.
    const row2 = page.locator("#sectionsTableBody tr").filter({ hasText: "Intro" });
    await expect(row2.locator(".status-badge")).toHaveText("Draft");
    await expect(row2.locator('[data-action="publish"]')).toBeVisible();
  });

  test("shell and courses routes pass an accessibility smoke check", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [],
    });

    await page.goto("/admin-content.html");
    const shellResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const shellViolations = shellResults.violations.filter((violation: { impact?: string | null }) =>
      ["critical", "serious"].includes(violation.impact || ""),
    );
    expect(shellViolations).toEqual([]);

    await page.goto("/admin-content/courses");
    const coursesResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const courseViolations = coursesResults.violations.filter((violation: { impact?: string | null }) =>
      ["critical", "serious"].includes(violation.impact || ""),
    );
    expect(courseViolations).toEqual([]);
  });

  // Rapportert fra stage: omdøping av en modul uten «rammer for kandidaten» ga
  //   400 validation_error · path ["candidateTaskConstraints","nb"]
  // Oversettelsen fyller alle tre språk med tom streng, og et objekt er alltid truthy — så
  // `verdi || undefined` slapp {"en-GB":"", nb:"", nn:""} rett gjennom til et skjema som krever
  // minst ett tegn per språk. Samme test dekker "[object Object]" til rubrikk-generereren.
  test("saving a module without candidate constraints omits the field instead of sending blanks", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: { "en-GB": "English scenario", nb: "Norsk scenario", nn: "Nynorsk scenario" },
          assessorExpectedContent: { "en-GB": "English guidance", nb: "Norsk veiledning", nn: "Nynorsk rettleiing" },
          mcqQuestions: [
            {
              stem: { "en-GB": "Q", nb: "Q", nn: "Q" },
              options: [
                { "en-GB": "A", nb: "A", nn: "A" },
                { "en-GB": "B", nb: "B", nn: "B" },
              ],
              correctAnswer: { "en-GB": "B", nb: "B", nn: "B" },
              rationale: { "en-GB": "R", nb: "R", nn: "R" },
            },
          ],
        }),
      },
    });

    let versionBody: any = null;
    let ensureBody: any = null;
    await page.route("**/api/admin/content/modules/*/rubric-versions/ensure", async (route: Route) => {
      ensureBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rubricVersion: { id: "rubric-1", versionNo: 1 } }),
      });
    });
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      versionBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTitle").fill("Fagforeninger");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => versionBody !== null).toBe(true);

    // The save must not be blocked, and the empty field must simply not be there.
    await expect(page.getByText(/candidateTaskConstraints/)).toHaveCount(0);
    expect(versionBody.candidateTaskConstraints).toBeUndefined();

    // The rubric generator is fed the scenario, not a stringified object.
    expect(ensureBody?.taskText).not.toContain("[object Object]");
    expect(ensureBody?.taskText).toContain("scenario");
  });

  // Reported from stage: rename a module, press save, and get
  //   400 · path ["candidateTaskConstraints","nb"] · String must contain at least 1 character
  //
  // The cause is the combination, not either half alone. The module has NO candidate constraints,
  // so the map is seeded blank for all three locales — and the real localizer, asked to translate
  // a draft, returns a constraints string for SOME target locale anyway. One locale filled, two
  // empty. `hasText` was then true, so the map went out verbatim with two empty strings in it.
  //
  // The old helper omitted a localized value only when EVERY locale was blank, on the reasoning
  // that a partial map was a real problem the server should report rather than something the
  // client should paper over by copying one locale into the others (#892). That was right when a
  // copy was the only alternative. Since #905 there is a third option and it is the contract:
  // an absent locale means "not translated"; an empty one is invalid.
  test("saving strips blank locales instead of sending them and failing validation", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: { "en-GB": "English scenario", nb: "Norsk scenario", nn: "Nynorsk scenario" },
          assessorExpectedContent: { "en-GB": "English guidance", nb: "Norsk veiledning", nn: "Nynorsk rettleiing" },
          // No constraints on the module at all — the state the author was actually in.
          mcqQuestions: [
            {
              stem: { "en-GB": "Q", nb: "Q", nn: "Q" },
              options: [
                { "en-GB": "A", nb: "A", nn: "A" },
                { "en-GB": "B", nb: "B", nn: "B" },
              ],
              correctAnswer: { "en-GB": "A", nb: "A", nn: "A" },
              rationale: { "en-GB": "R", nb: "R", nn: "R" },
            },
          ],
        }),
      },
    });

    let versionBody: any = null;
    await page.route("**/api/admin/content/modules/*/rubric-versions/ensure", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rubricVersion: { id: "rubric-1", versionNo: 1 } }),
      });
    });
    // The half that made it happen: the localizer volunteers constraints for ONE target locale
    // even though the source had none. Registered after mockCommonApis so it wins.
    await page.route("**/api/admin/content/generate/module-draft/localize", async (route: Route) => {
      const body = route.request().postDataJSON() as { targetLocale?: string };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: `Fagforeninger [${body.targetLocale}]`,
          taskText: `Scenario [${body.targetLocale}]`,
          assessorExpectedContent: `Guidance [${body.targetLocale}]`,
          ...(body.targetLocale === "nn" ? { candidateTaskConstraints: "Maks 500 ord" } : {}),
        }),
      });
    });
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      versionBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTitle").fill("Fagforeninger");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => versionBody !== null).toBe(true);

    // The save goes through at all — this is the 400 the author hit on stage.
    expect(versionBody).not.toBeNull();
    // The blank locales are GONE, not sent as "", which the schema rejects outright.
    expect(versionBody.candidateTaskConstraints?.nb).toBeUndefined();
    expect(versionBody.candidateTaskConstraints?.["en-GB"]).toBeUndefined();
    // ...and the one locale that DID get text survives. Dropping the whole field would have been
    // the other way to make the 400 go away, and it would have thrown that text away.
    expect(versionBody.candidateTaskConstraints?.nn).toBe("Maks 500 ord");
  });

  // Rapportert fra stage: bytt språk mens du står i Direkte redigering, og du havner i lesemodus
  // med en samtale som fortsatt sier «rediger feltene og trykk Bekreft» — mens handlingsknappene
  // er brukt opp og deaktiverte. Ingen vei videre uten å laste siden på nytt. Årsaken er at
  // redigeringen bygges INN i forhåndsvisningsruten, som språkbyttet river.
  //
  // #920 rewrote this test. It used to switch language with an UNTOUCHED form and conclude that
  // "the editor stays open" was the whole contract — which is why it stayed green while the
  // language switch threw away typed text without a word. Openness is now the SECOND half; the
  // first is that unsaved typing is not discarded behind the author's back.
  test("switching language with an untouched editor is silent, and keeps the editor open", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: { "en-GB": "English scenario", nb: "Norsk scenario", nn: "Nynorsk scenario" },
          assessorExpectedContent: { "en-GB": "English guidance", nb: "Norsk veiledning", nn: "Nynorsk rettleiing" },
        }),
      },
    });

    // Not decoration: the guard must fire on DIRTY, not on the form being present. Since v2.18.13
    // the form is open the entire time Rediger is, so a presence check would put a confirm in
    // front of every single language switch — the same mistake §6 documents for the generation
    // port. Any dialog here fails the test.
    let dialogs = 0;
    page.on("dialog", async (dialog) => { dialogs += 1; await dialog.accept(); });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator("#previewEditTaskText")).toHaveValue("English scenario");

    // Stage-tilbakemelding 2026-08-17: the UI language and the CONTENT language are separate now.
    // Switching the menus to Norwegian must NOT move the author to a different language's text —
    // that was the surprise being reported ("står i preview på bokmål, endrer UI til nynorsk...").
    await page.locator("#localeSelect").selectOption("nb");
    await expect(page.locator("#previewEditConfirm")).toBeVisible();
    await expect(
      page.locator("#previewEditTaskText"),
      "the UI language moved the content language with it",
    ).toHaveValue("English scenario");

    // The content-language switcher is the one that changes what is being authored, and the editor
    // survives it — that is the original bug this test was written for.
    await page.locator("#previewLocaleBar button", { hasText: /Norsk bokmål/ }).click();
    await expect(page.locator("#previewEditConfirm")).toBeVisible();
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Norsk scenario");

    // And confirming from there must still work — the way forward is intact. Since v2.18.13 the
    // form stays open after the save (Rediger IS the form), showing the values that were written.
    await page.locator("#previewEditConfirm").click();
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Norsk scenario");

    expect(dialogs, "an untouched form must not be asked about").toBe(0);
  });

  // #920 (§7): «Rediger direkte» → skriv → bytt språk. §7 requires the same warning on a language
  // change as on a tab change, and for the same reason: both re-render the pane the edit form is
  // built INTO, so its fields are DOM-only work that the re-render destroys. The guard covered
  // `activeTab === "settings"` only, so Rediger lost the typing in silence.
  //
  // Both switchers are exercised. They are separate handlers with separate histories — the UI
  // selector got its guard in #896 S6, the content bar in S3c — and a fix to one is not a fix.
  test("switching language with unsaved edits asks first, and staying keeps the typed text", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: { "en-GB": "English scenario", nb: "Norsk scenario", nn: "Nynorsk scenario" },
          assessorExpectedContent: { "en-GB": "English guidance", nb: "Norsk veiledning", nn: "Nynorsk rettleiing" },
        }),
      },
    });

    const dialogMessages: string[] = [];
    // Default answer is "stay" — Playwright dismisses a dialog with no listener, and the point of
    // the first two legs is that staying really does leave everything where it was.
    let answer: "accept" | "dismiss" = "dismiss";
    page.on("dialog", async (dialog) => {
      dialogMessages.push(dialog.message());
      if (answer === "accept") await dialog.accept();
      else await dialog.dismiss();
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await expect(page.locator("#previewEditTaskText")).toHaveValue("English scenario");

    await page.locator("#previewEditTaskText").fill("Unsaved English rewrite");

    // 1. The content-language bar. Staying leaves the typed text AND the language alone.
    await page.locator("#previewLocaleBar button", { hasText: /Norsk bokmål/ }).click();
    expect(dialogMessages, "the content-language switch did not ask").toHaveLength(1);
    expect(dialogMessages[0]).toMatch(/not saved|ikke lagret/i);
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Unsaved English rewrite");
    await expect(
      page.locator("#previewLocaleBar button[aria-pressed='true']"),
      "staying still moved the content language",
    ).toHaveText("English (UK)");

    // 2. The UI-language selector, same form, same unsaved text. Staying also puts the selector
    // itself back — a menu showing "Norsk bokmål" over an English UI is its own small lie.
    await page.locator("#localeSelect").selectOption("nb");
    expect(dialogMessages, "the UI-language switch did not ask").toHaveLength(2);
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Unsaved English rewrite");
    await expect(page.locator("#localeSelect")).toHaveValue("en-GB");

    // 3. Discarding on purpose: the switch goes through, the fields show the new language, and the
    // conversation says what was lost rather than leaving the author to notice.
    answer = "accept";
    await page.locator("#previewLocaleBar button", { hasText: /Norsk bokmål/ }).click();
    expect(dialogMessages).toHaveLength(3);
    await expect(page.locator("#previewEditConfirm")).toBeVisible();
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Norsk scenario");
    await expect(page.getByText(/did not confirm is gone|uten å bekrefte, er borte/i).first()).toBeVisible();
  });

  // Stage-tilbakemelding 2026-08-17: Innstillinger edited in the UI language while Rediger edited
  // in the content language, so the same module answered "which language am I writing in" two ways.
  test("Innstillinger authors in the content language, not the UI language", async ({ page }) => {
    const moduleExport = buildMockModuleExport({
      id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1",
      taskText: { "en-GB": "English scenario", nb: "Norsk scenario", nn: "Nynorsk scenario" },
    });
    moduleExport.selectedConfiguration.promptTemplateVersion = {
      id: "prompt-1", versionNo: 1,
      systemPrompt: { "en-GB": "English system", nb: "Norsk system", nn: "Nynorsk system" },
      userPromptTemplate: { "en-GB": "English user", nb: "Norsk bruker", nn: "Nynorsk brukar" },
      examples: [],
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": moduleExport },
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#tabSettings").click();
    await page.locator("#settingsPromptToggle").click();
    await expect(page.locator("#settingsPromptSystem")).toHaveValue("English system");

    // The switcher is reachable from Innstillinger at all — it used to live inside the preview
    // pane, hidden from the one tab that is not a preview.
    const bar = page.locator("#previewLocaleBar");
    await expect(bar).toBeVisible();

    // Changing the MENU language leaves the content alone. (The section stays expanded across
    // both switches, so there is nothing to re-open.)
    await page.locator("#localeSelect").selectOption("nb");
    await expect(page.locator("#settingsPromptSystem")).toHaveValue("English system");

    // Changing the CONTENT language moves every surface, this one included.
    await bar.locator("button", { hasText: /Norsk bokmål/ }).click();
    await expect(page.locator("#settingsPromptSystem")).toHaveValue("Norsk system");
  });

  // ---------------------------------------------------------------------------
  // #919: the drift dialog's accept paths.
  //
  // Same class as #892/#902/#905 and the same rule as doc/FEATURE_SURFACE_MAP.md point 21: the
  // composition writes localized fields VERBATIM, so a surface showing ONE language has to merge
  // that language in itself. `/generate/rubric` is asked for `contentLocale` and answers in it, so
  // accepting a proposal wholesale wrote a one-locale map over a criterion that had three and
  // deleted two translations that were never shown and never edited.
  //
  // NOTE on how these two tests reach the banner. `[data-drift-banner]` is rendered by
  // `renderPreview()`, and since #896 S3c / v2.18.13 there is no tab where that output is both
  // drawn AND visible: Rediger immediately overwrites the pane with the edit form, Forhåndsvisning
  // suppresses the banner as a participant view, and Innstillinger hides the whole panel. The
  // element is in the DOM (count 1 after Forhåndsvisning → Innstillinger) but `isVisible()` is
  // false, so the click is dispatched rather than performed. That is a REACHABILITY defect in its
  // own right, reported separately — it is not what these tests are about, and the handler chain
  // they exercise from there is the real one.
  // ---------------------------------------------------------------------------

  const CLARITY_LABEL = { "en-GB": "Clarity", nb: "Klarhet", nn: "Klårleik" };
  const CLARITY_DESCRIPTION = {
    "en-GB": "Explains the reasoning.",
    nb: "Forklarer resonnementet.",
    nn: "Forklarar resonnementet.",
  };
  const ACCURACY_LABEL = { "en-GB": "Accuracy", nb: "Nøyaktighet", nn: "Nøyaktigheit" };
  const ACCURACY_DESCRIPTION = {
    "en-GB": "Gets the facts right.",
    nb: "Får fakta riktig.",
    nn: "Får fakta rett.",
  };

  async function mockDriftedModule(page: Page) {
    const moduleExport = buildMockModuleExport({
      id: "module-1",
      title: "Trade unions",
      moduleVersionId: "module-1-version-1",
    });
    // Drift is "the plan the criteria were generated from is not the plan that is stored now".
    // A blueprint plus a stale hash on the rubric is the whole condition.
    moduleExport.selectedConfiguration.moduleVersion.assessmentBlueprint = {
      criteria: [{ id: "clarity", label: "Clarity" }, { id: "accuracy", label: "Accuracy" }],
    };
    moduleExport.selectedConfiguration.rubricVersion.criteria = {
      clarity: {
        label: CLARITY_LABEL, description: CLARITY_DESCRIPTION,
        maxScore: 5, weight: 0.5, candidateVisible: true,
      },
      accuracy: {
        label: ACCURACY_LABEL, description: ACCURACY_DESCRIPTION,
        maxScore: 5, weight: 0.5, candidateVisible: true,
      },
    };
    moduleExport.selectedConfiguration.rubricVersion.scalingRule = {
      generated_from_blueprint_hash: "a-hash-from-the-previous-plan",
      practical_weight: 70,
      max_total: 10,
    };

    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": moduleExport },
    });

    // The generator answers in the ONE language it was asked for — the whole premise of the bug.
    // `accuracy` comes back identical, so it lands in the diff's "unchanged" bucket: the control
    // that says an untouched criterion is not quietly rewritten either.
    await page.route("**/api/admin/content/generate/rubric", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rubric: {
            criteria: [
              { id: "clarity", label: "Clarity of reasoning", description: "Explains the reasoning.", maxScore: 5, candidateVisible: true },
              { id: "accuracy", label: "Accuracy", description: "Gets the facts right.", maxScore: 5, candidateVisible: true },
              { id: "structure", label: "Structure", description: "Follows a clear order.", maxScore: 4, candidateVisible: true },
            ],
          },
        }),
      });
    });

    return state;
  }

  async function openDriftDiff(page: Page) {
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    // Forhåndsvisning → Innstillinger is the one transition that re-renders the preview pane and
    // then leaves it alone; see the NOTE above.
    await page.locator("#tabPreview").click();
    await page.locator("#tabSettings").click();
    await expect(page.locator("[data-drift-banner]")).toHaveCount(1);
    await page.locator('[data-drift-action="show-diff"]').dispatchEvent("click");
    await expect(page.locator(".drift-diff-overlay")).toBeVisible();
  }

  test("accepting a drift proposal keeps the two languages it was not shown in", async ({ page }) => {
    const state = await mockDriftedModule(page);
    await openDriftDiff(page);

    // Deselect the new criterion, so this also proves the selective path still selects.
    await page.locator('input[data-diff-checkbox][data-criterion-id="structure"]').uncheck();
    await clickEnabledButton(page, "Accept selected");

    await expect.poll(() => state.lastRubricVersionBody?.criteria).toBeTruthy();
    const criteria = state.lastRubricVersionBody.criteria;

    // The accepted change lands in the language it was proposed in — and ONLY there.
    expect(criteria.clarity.label).toEqual({ ...CLARITY_LABEL, "en-GB": "Clarity of reasoning" });
    // The description was not part of the change, so it is byte-for-byte what was stored.
    expect(criteria.clarity.description).toEqual(CLARITY_DESCRIPTION);
    // An unchanged criterion is carried over whole.
    expect(criteria.accuracy.label).toEqual(ACCURACY_LABEL);
    expect(criteria.accuracy.description).toEqual(ACCURACY_DESCRIPTION);
    // Deselected, so it is not in the new rubric at all.
    expect(criteria.structure).toBeUndefined();
  });

  test("accept-all merges too, and a brand-new criterion is stored as the one language it has", async ({ page }) => {
    const state = await mockDriftedModule(page);
    await openDriftDiff(page);

    // «Godta alle» used to hand the raw proposal to the save, skipping the merge entirely — and it
    // is the button an author in a hurry presses.
    await clickEnabledButton(page, "Accept all");

    await expect.poll(() => state.lastRubricVersionBody?.criteria).toBeTruthy();
    const criteria = state.lastRubricVersionBody.criteria;

    expect(criteria.clarity.label).toEqual({ ...CLARITY_LABEL, "en-GB": "Clarity of reasoning" });
    expect(criteria.clarity.description).toEqual(CLARITY_DESCRIPTION);
    expect(criteria.accuracy.label).toEqual(ACCURACY_LABEL);

    // A criterion that did not exist before has nothing to merge against, and inventing the other
    // two languages here would be the very lie #892 exists to stop. One key, honestly.
    expect(criteria.structure.label).toEqual({ "en-GB": "Structure" });
    expect(criteria.structure.description).toEqual({ "en-GB": "Follows a clear order." });
  });
});
