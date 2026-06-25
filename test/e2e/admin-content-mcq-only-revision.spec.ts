import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import {
  mockCommonApis,
  clickEnabledButton,
  localizedText,
  buildMockModuleExport,
  type MockModuleExport,
} from "./admin-content-helpers.js";

// Regression coverage for #655 — two client-layer bugs in Advanced authoring that are
// invisible to supertest:
//   1. Module-type radios stretched full width (inherited width:100% from the base input
//      style; only checkboxes were exempted). Pinned by measuring the radio's box width.
//   2. A conversational revision of an MCQ-only module could not be saved: the loaded draft
//      dropped assessmentMode, so save-validation treated it as FREETEXT_PLUS_MCQ and demanded
//      scenario text (shell.save.taskRequired) that MCQ-only modules never have.

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
    // An existing, published MCQ-only module: a module version flagged MCQ_ONLY with NO
    // free-text (empty taskText) plus a saved MCQ set. This is the shape the export endpoint
    // returns for a module authored via the MCQ-only path.
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
    const mcqSetVersion = {
      id: "module-1-mcq-1",
      title: localizedText("Trade unions"),
      questions: mcqQuestions,
    };
    const mcqOnlyExport: MockModuleExport = {
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
    };

    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: { "module-1": mcqOnlyExport },
    });

    // Capture the saved module-version payload to prove the MCQ-only save path ran.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let savedVersionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/module-versions", async (route: Route) => {
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
});
