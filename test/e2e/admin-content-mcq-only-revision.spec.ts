import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import {
  mockCommonApis,
  clickEnabledButton,
  localizedText,
  buildMockModuleExport,
  type MockModuleExport,
} from "./admin-content-helpers.js";

// Regression coverage for #655 / #665 — client-layer bugs in Advanced/Conversation authoring
// of MCQ-only modules, invisible to supertest:
//   1. Module-type radios stretched full width (inherited width:100% from the base input
//      style; only checkboxes were exempted). Pinned by measuring the radio's box width.
//   2. A conversational revision of an MCQ-only module could not be saved: the loaded draft
//      dropped assessmentMode, so save-validation treated it as FREETEXT_PLUS_MCQ and demanded
//      scenario text (shell.save.taskRequired) that MCQ-only modules never have.
//   3. Direct-edit ("Edit directly") of an MCQ-only module exposed editable free-text fields and
//      dropped assessmentMode, so the subsequent save/publish hit the same scenario guard (#665).

// An existing, published MCQ-only module: a module version flagged MCQ_ONLY with NO free-text
// (empty taskText) plus a saved MCQ set — the shape the export endpoint returns for the MCQ-only
// authoring path.
function buildMcqOnlyExport(): MockModuleExport {
  const mcqQuestions = [
    {
      stem: localizedText("Question 1"),
      options: [localizedText("A"), localizedText("B"), localizedText("C"), localizedText("D")],
      correctAnswer: localizedText("B"),
      rationale: localizedText("Rationale"),
    },
  ];
  const moduleVersion = {
    id: "module-1-version-1",
    versionNo: 1,
    assessmentMode: "MCQ_ONLY",
    taskText: {},
    assessorExpectedContent: {},
    candidateTaskConstraints: {},
    assessmentPolicy: { passRules: { mcqMinPercent: 60 } },
  };
  const mcqSetVersion = { id: "module-1-mcq-1", title: localizedText("Trade unions"), questions: mcqQuestions };
  return {
    module: {
      id: "module-1",
      title: localizedText("Trade unions"),
      certificationLevel: "basic",
      activeVersionId: "module-1-version-1",
      archivedAt: null,
    },
    selectedConfiguration: {
      source: "draftModuleVersion",
      moduleVersion,
      rubricVersion: null,
      promptTemplateVersion: null,
      mcqSetVersion,
    },
    versions: {
      moduleVersions: [moduleVersion],
      rubricVersions: [],
      promptTemplateVersions: [],
      mcqSetVersions: [mcqSetVersion],
    },
    platformDefaults: { totalMin: 70 },
  };
}

test.describe("admin content — module-type bugs (#655)", () => {
  test("module-type radios are not stretched full width", async ({ page }) => {
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

    await page.goto("/admin-content/module/module-1/advanced");
    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");

    const radio = page.locator('input[name="moduleVersionType"]').first();
    await expect(radio).toBeVisible();
    const box = await radio.boundingBox();
    expect(box).not.toBeNull();
    // A real radio control is ~13–20px wide. Before the fix it inherited width:100% and
    // spanned the whole panel (hundreds of px), pushing its label to the far right.
    expect(box!.width).toBeLessThan(40);
  });

  test("an MCQ-only module can be revised in chat and saved without scenario text", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": buildMcqOnlyExport() },
    });

    // Capture the saved module-version payload to prove the MCQ-only save path ran.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let savedVersionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      savedVersionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // Module actions menu → "Continue editing in chat" (resumeChatEdit). This is the exact
    // path that builds the revision draft from the loaded module (#655 bug 2).
    await clickEnabledButton(page, /Continue editing in chat|Fortsett å redigere i chat|Hald fram med å redigere i chat/);

    // Draft-ready actions → "Save draft".
    await clickEnabledButton(page, /^Save draft$|^Lagre utkast$/);

    // The save must succeed — NOT be blocked by the scenario-required guard.
    await expect(
      page.getByText(/The draft needs scenario text|Utkastet må ha scenario\/oppgavetekst|Utkastet må ha scenario\/oppgåvetekst/),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Draft saved as a new module version|Utkastet er lagret som en ny modulversjon|Utkastet er lagra som ein ny modulversjon/).first(),
    ).toBeVisible();

    // And the version that was saved carries the MCQ-only mode + the loaded pass threshold.
    expect(savedVersionPayload?.assessmentMode).toBe("MCQ_ONLY");
    expect(savedVersionPayload?.taskText).toBeUndefined();
    expect(savedVersionPayload?.assessmentPolicy?.passRules?.mcqMinPercent).toBe(60);
  });

  test("an MCQ-only module edited via 'Edit directly' hides free-text fields and still saves (#665)", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": buildMcqOnlyExport() },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let savedVersionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/versions", async (route: Route) => {
      savedVersionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");

    // Module actions → "Edit directly" (directEdit → enterPreviewEditMode).
    await page.locator("#previewEditTitle").waitFor();

    // The free-text editor fields must NOT exist for an MCQ-only module, but the MCQ editor must.
    await expect(page.locator("#previewEditTaskText")).toHaveCount(0);
    await expect(page.locator("#previewEditGuidanceText")).toHaveCount(0);
    await expect(page.locator("#previewEditMcqStem0")).toBeVisible();

    // #896 S2: Lagre translates and saves in one step - and an untouched form saves
    // nothing at all, so make a real edit first.
    await page.locator("#previewEditMcqStem0").fill("Oppdatert MCQ-only stamme");
    await page.locator("#previewEditConfirm").click();

    // Save must not hit the scenario-required guard, and must persist MCQ_ONLY.
    await expect(
      page.getByText(/The draft needs scenario text|Utkastet må ha scenario\/oppgavetekst|Utkastet må ha scenario\/oppgåvetekst/),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Draft saved as a new module version|Utkastet er lagret som en ny modulversjon|Utkastet er lagra som ein ny modulversjon/).first(),
    ).toBeVisible();
    expect(savedVersionPayload?.assessmentMode).toBe("MCQ_ONLY");
    expect(savedVersionPayload?.assessmentPolicy?.passRules?.mcqMinPercent).toBe(60);
  });

  test("renaming an MCQ-only module translates the title instead of copying it into every locale", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": buildMcqOnlyExport() },
    });

    // The module-draft localiser requires taskText AND assessorExpectedContent (min 1 char). An
    // MCQ-only module has neither, so the real server answers 400 — mirror that here, because the
    // client used to swallow it and keep the source title in all three locales (#892 signature).
    const draftLocalizeCalls: string[] = [];
    await page.route("**/api/admin/content/generate/module-draft/localize", async (route: Route) => {
      draftLocalizeCalls.push(String((route.request().postDataJSON() as { targetLocale?: string })?.targetLocale));
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "validation_error" }) });
    });

    const titleLocalizeCalls: Array<{ title?: string; targetLocale?: string }> = [];
    // Full sti — adminSectionsRouter er montert under /api/admin/content. En glob på
    // **/api/admin/sections/localize ville matchet en sti som ikke finnes, og testen ville pinnet
    // en 404-sti som «riktig».
    await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
      const body = route.request().postDataJSON() as { title?: string; targetLocale?: string };
      titleLocalizeCalls.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ title: `${body.title} [${body.targetLocale}]` }),
      });
    });

    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("#previewEditTitle").fill("Union basics");
    await page.locator("#previewEditConfirm").click();

    // Translation runs in the background. v2.18.13: Rediger stays in edit mode after the save, so
    // "settled" is no longer "the form went away" — it is the localisation calls having landed.
    await expect.poll(() => titleLocalizeCalls.length).toBe(2);

    // The title went to the title-only endpoint, once per target locale, carrying the NEW title.
    // The workspace is in en-GB here, so the two targets are the Norwegian pair.
    expect(titleLocalizeCalls.map((c) => c.targetLocale).sort()).toEqual(["nb", "nn"]);
    for (const call of titleLocalizeCalls) expect(call.title).toBe("Union basics");

    // And the draft localiser — the one that 400s for MCQ-only — was not used for this at all.
    expect(draftLocalizeCalls).toEqual([]);
  });

});
