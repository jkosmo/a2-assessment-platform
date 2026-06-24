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

test.describe("admin content browser coverage", () => {
  test("advanced editor can save, publish, and unpublish a module version", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [
                localizedText("Option A"),
                localizedText("Option B"),
                localizedText("Option C"),
                localizedText("Option D"),
              ],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/advanced");

    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");
    await page.locator("#saveContentBundle").click();
    await expect(page.locator("#publishModuleVersionId")).not.toHaveValue("");

    await page.locator("#publishModuleVersion").click();
    await expect(page.getByText("Module version published.")).toBeVisible();
    await expect(page.locator("#moduleStatusLive")).toContainText("Module v1");
    await expect(page.locator("#unpublishModuleBtn")).toBeVisible();

    await page.locator("#unpublishModuleBtn").click();
    await page.locator("#dlgSimpleConfirmOk").click();
    await expect(page.getByText("Module unpublished.")).toBeVisible();
    await expect(page.locator("#moduleStatusLive")).toContainText("No published version");
  });

  // #525/#546: the advanced editor can author an MCQ-only module version — toggling MCQ-only
  // hides the free-text fields, shows the threshold, and the saved version sends
  // assessmentMode=MCQ_ONLY with the chosen mcqMinPercent (no rubric/prompt/taskText).
  test("advanced editor authors an MCQ-only module version", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [localizedText("A"), localizedText("B"), localizedText("C"), localizedText("D")],
              correctAnswer: localizedText("B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let versionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/module-versions", async (route: Route) => {
      versionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-1", versionNo: 1 } }),
      });
    });

    await page.goto("/admin-content/module/module-1/advanced");
    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");

    // Free-text fields + content cards visible, threshold hidden by default.
    await expect(page.locator("#moduleVersionFreetextFields")).toBeVisible();
    await expect(page.locator("#moduleVersionMcqThresholdRow")).toBeHidden();
    await expect(page.locator("#contentCard_rubric")).toBeVisible();

    // Select MCQ-only → free-text fields + free-text content cards hidden, threshold shown.
    // (#578: 3-way module-type radio replaced the MCQ-only checkbox.)
    await page.locator('input[name="moduleVersionType"][value="MCQ_ONLY"]').check();
    await expect(page.locator("#moduleVersionFreetextFields")).toBeHidden();
    await expect(page.locator("#moduleVersionMcqThresholdRow")).toBeVisible();
    await expect(page.locator("#contentCard_rubric")).toBeHidden();
    await expect(page.locator("#contentCard_prompt")).toBeHidden();
    await page.locator("#moduleVersionMcqMinPercent").fill("80");

    await page.locator("#saveContentBundle").click();

    await expect.poll(() => versionPayload?.assessmentMode).toBe("MCQ_ONLY");
    expect(versionPayload?.taskText).toBeUndefined();
    expect(versionPayload?.rubricVersionId).toBeUndefined();
    expect(versionPayload?.promptTemplateVersionId).toBeUndefined();
    expect(versionPayload?.assessmentPolicy?.passRules?.mcqMinPercent).toBe(80);
  });

  // #578: the advanced editor can author a FREETEXT_ONLY module version — selecting "Free-text only"
  // hides the MCQ card/section + threshold, keeps the free-text fields + rubric/prompt, and the saved
  // version sends assessmentMode=FREETEXT_ONLY with no mcqSetVersionId.
  test("advanced editor authors a FREETEXT_ONLY module version", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({ id: "module-1", title: "Trade unions", moduleVersionId: "module-1-version-1" }),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let versionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/module-versions", async (route: Route) => {
      versionPayload = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ moduleVersion: { id: "module-1-version-2", versionNo: 2 } }) });
    });
    let mcqSetCreated = false;
    await page.route("**/api/admin/content/modules/*/mcq-set-versions", async (route: Route) => {
      mcqSetCreated = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ mcqSetVersion: { id: "mcq-1" } }) });
    });

    await page.goto("/admin-content/module/module-1/advanced");
    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");

    // Select Free-text only → free-text fields + rubric/prompt stay, MCQ card/section + threshold hide.
    await page.locator('input[name="moduleVersionType"][value="FREETEXT_ONLY"]').check();
    await expect(page.locator("#moduleVersionFreetextFields")).toBeVisible();
    await expect(page.locator("#contentCard_rubric")).toBeVisible();
    await expect(page.locator("#contentCard_mcq")).toBeHidden();
    await expect(page.locator("#sectionMcq")).toBeHidden();
    await expect(page.locator("#moduleVersionMcqThresholdRow")).toBeHidden();

    await page.locator("#saveContentBundle").click();

    await expect.poll(() => versionPayload?.assessmentMode).toBe("FREETEXT_ONLY");
    expect(versionPayload?.mcqSetVersionId).toBeUndefined();
    expect(versionPayload?.taskText).toBeTruthy();
    expect(mcqSetCreated).toBe(false);
  });

  test("advanced editor persists a renamed module title when saving content", async ({ page }) => {
    const state = await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [
                localizedText("Option A"),
                localizedText("Option B"),
                localizedText("Option C"),
                localizedText("Option D"),
              ],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/advanced");
    await expect(page.locator("#moduleStatusTitle")).toContainText("Trade unions");

    await page.locator("#editBtn_moduleDetails").click();
    await expect(page.locator("#dialogModuleDetails")).toHaveAttribute("open", "");
    await page.locator("#dlgMD_title_enGB").fill("Renamed module");
    await page.locator('#dialogModuleDetails .dialog-locale-tab[data-locale-tab="nb"]').click();
    await page.locator("#dlgMD_title_nb").fill("Omdøpt modul");
    await page.locator('#dialogModuleDetails .dialog-locale-tab[data-locale-tab="nn"]').click();
    await page.locator("#dlgMD_title_nn").fill("Omdøypt modul");
    await page.locator("#dialogModuleDetailsApply").click();

    await page.locator("#saveAllCards").click();

    await expect.poll(() => state.lastTitlePatchBody?.title?.["en-GB"]).toBe("Renamed module");
    await expect.poll(() => state.lastTitlePatchBody?.title?.nb).toBe("Omdøpt modul");
    await expect.poll(() => state.exportMap.get("module-1")?.module.title?.["en-GB"]).toBe("Renamed module");
    await expect.poll(() => state.exportMap.get("module-1")?.module.title?.nb).toBe("Omdøpt modul");
  });

  test("advanced editor hands unsaved task text back to the conversational workspace", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions" }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          taskText: {
            "en-GB": "Original scenario",
            nb: "Originalt scenario",
            nn: "Opphavleg scenario",
          },
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/advanced");

    await page.locator("#editBtn_versionDetails").click();
    await expect(page.locator("#dialogVersionDetails")).toHaveAttribute("open", "");
    await page.locator("#dlgVD_task_enGB").fill("Edited in advanced editor");
    await page.locator("#dialogVersionDetailsApply").click();
    await page.locator("#modeSwitchConversation").click();
    await expect(page.locator("#dialogUnsavedHandoff")).toHaveAttribute("open", "");
    await page.locator("#dlgUnsavedDiscard").click();

    await expect(page).toHaveURL(/\/admin-content\/module\/module-1\/conversation\?resumeEditing=1$/);
    await expect(page.getByText("Edited in advanced editor")).toBeVisible();
    await expect(page.getByText("The current module draft is ready for further editing in chat.")).toBeVisible();
  });

  test("shell can create a new module, generate content, and save without losing the module ID", async ({ page }) => {
    await mockCommonApis(page);

    await page.goto("/admin-content");

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

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect(page.getByText("Open or create a module before saving.")).toHaveCount(0);
    await expect(page.getByText(/Trade unions.*loaded\./)).toBeVisible();
  });

  // #578: the conversation can author a FREETEXT_ONLY module — free-text + LLM assessment, no MCQ.
  // After source the author picks "Free-text only"; the scenario/blueprint steps run but the MCQ
  // step is skipped, and the saved version sends assessmentMode=FREETEXT_ONLY with no mcqSetVersionId.
  test("shell can create a FREETEXT_ONLY module via the conversation", async ({ page }) => {
    await mockCommonApis(page);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let versionPayload: any = null;
    await page.route("**/api/admin/content/modules/*/module-versions", async (route: Route) => {
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

    await page.goto("/admin-content");
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

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
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

    await page.goto("/admin-content");
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

    await page.goto("/admin-content");
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

    await page.goto("/admin-content");
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

    await page.goto("/admin-content");
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
    await page.route("**/api/admin/content/modules/*/module-versions", async (route: Route) => {
      versionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ moduleVersion: { id: "module-1-version-1", versionNo: 1 } }),
      });
    });

    await page.goto("/admin-content");

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

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect.poll(() => versionPayload?.assessmentMode).toBe("MCQ_ONLY");
    expect(versionPayload?.taskText).toBeUndefined();
    expect(versionPayload?.rubricVersionId).toBeUndefined();
    expect(versionPayload?.promptTemplateVersionId).toBeUndefined();
    expect(versionPayload?.assessmentPolicy?.passRules?.mcqMinPercent).toBe(70);
  });

  test("shell locale switching updates the rendered task text", async ({ page }) => {
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
    await page.locator("#localeSelect").selectOption("nb");
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

    await page.addInitScript(() => {
      sessionStorage.setItem("adminContent.handoff", JSON.stringify({
        moduleId: "module-1",
        source: "shell",
        draft: null,
        locale: "en-GB",
        previewLocale: "nb",
        timestamp: Date.now(),
      }));
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.getByText("Norsk scenario")).toBeVisible();

    await clickEnabledButton(page, /Edit directly|Rediger direkte/);
    await expect(page.locator("#previewEditTaskText")).toHaveValue("Norsk scenario");
    await page.locator("#previewEditTaskText").fill("Oppdatert norsk scenario");
    await page.locator("#previewEditGuidanceText").fill("Oppdatert norsk veiledning");
    await page.locator("#previewEditTitle").fill("Fagforeninger");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastDraftLocalizationBody?.sourceLocale).toBe("nb");
    await clickEnabledButton(page, /Save draft|Lagre utkast/);

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect.poll(() => state.lastTitlePatchBody?.title?.nb).toBe("Fagforeninger");
    await expect(state.lastTitlePatchBody?.title?.["en-GB"]).toContain("[en-GB]");
    await expect(page.locator("#srModuleName")).toHaveText("Fagforeninger");
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
    await expect(page.locator("#srModuleName")).toHaveText("Trade union dialogue");

    await clickEnabledButton(page, /Save draft|Lagre utkast/);

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect.poll(() => state.lastTitlePatchBody?.title?.["en-GB"]).toBe("Trade union dialogue");
    await expect(page.locator("#srModuleName")).toHaveText("Trade union dialogue");
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

    await page.addInitScript(() => {
      sessionStorage.setItem("adminContent.handoff", JSON.stringify({
        moduleId: "module-2",
        source: "shell",
        draft: null,
        locale: "en-GB",
        previewLocale: "nb",
        timestamp: Date.now(),
      }));
    });

    await page.goto("/admin-content/module/module-2/conversation");

    await clickEnabledButton(page, /Edit directly|Rediger direkte/);
    await expect(page.locator("#previewEditMcqStem0")).toHaveValue("Norsk sporsmal");
    await page.locator("#previewEditMcqStem0").fill("Oppdatert norsk sporsmal");
    await page.locator("#previewEditMcqOption0_1").fill("Oppdatert alternativ B");
    await page.locator("#previewEditConfirm").click();

    await expect.poll(() => state.lastMcqLocalizationBody?.sourceLocale).toBe("nb");
    await expect(page.getByText("Oppdatert norsk sporsmal")).toBeVisible();
    await expect(page.getByText("Oppdatert alternativ B").first()).toBeVisible();

    await clickEnabledButton(page, /Save draft|Lagre utkast/);

    await expect(page.locator("#shellStatusAnnouncer")).toHaveText("Draft saved as a new module version.");
    await expect(page.getByText("Oppdatert norsk sporsmal")).toBeVisible();
    await expect(page.getByText("Oppdatert alternativ B").first()).toBeVisible();
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

    // v1.2.32 (#361/#442): after publishing, the shell reloads the module (now Live)
    // and shows the module-actions prompt instead of dropping the author back into the
    // full module picker. "Pick another module" remains available from there.
    await expect(
      page.getByText(/What would you like to do with this module|Hva vil du gjøre med denne modulen/),
    ).toBeVisible();
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
    await page.route("**/api/admin/content/modules/*/module-versions", async (route: Route) => {
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

    await page.goto("/admin-content");

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

  test("shell advanced mode switch preserves the selected module in the route", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
      moduleExports: {
        "module-1": buildMockModuleExport({
          id: "module-1",
          title: "Trade unions",
          moduleVersionId: "module-1-version-1",
          mcqQuestions: [
            {
              stem: localizedText("Question 1"),
              options: [
                localizedText("Option A"),
                localizedText("Option B"),
                localizedText("Option C"),
                localizedText("Option D"),
              ],
              correctAnswer: localizedText("Option B"),
              rationale: localizedText("Rationale"),
            },
          ],
        }),
      },
    });

    await page.goto("/admin-content/module/module-1/conversation");

    await expect(page.locator("#moduleWorkspaceTitle")).toBeVisible();
    await clickEnabledButton(page, "Advanced");

    await expect(page).toHaveURL(/\/admin-content\/module\/module-1\/advanced$/);
    await expect(page.locator("#modeSwitchAdvanced")).toHaveAttribute("aria-pressed", "true");
  });

  test("courses conversational flow goes straight to module selection and returns to the course list after save", async ({ page }) => {
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
    await clickEnabledButton(page, "Basic");

    await page.locator("#convComboboxInput").fill("Trade");
    await page.locator(".combobox-option").first().click();
    await page.locator("#convAddModuleItemBtn").click();
    await expect(page.locator("#convModuleListContainer")).toContainText("Trade unions");

    await page.locator("#convCreateBtn").click();
    await expect(page).toHaveURL(/\/admin-content\/courses$/);
    await expect(page.getByRole("table", { name: "Kursliste" })).toBeVisible();
    await expect(page.locator("#coursesTableBody")).toContainText("Labour rights");
    await expect.poll(() => state.mutableCourses[0]?.modules?.length ?? 0).toBe(1);
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

  test("shell idle flow opens the module picker and renders existing module choices", async ({ page }) => {
    await mockCommonApis(page, {
      modules: [
        { id: "module-1", title: "Trade unions", activeVersion: { versionNo: 2 } },
        { id: "module-2", title: "Collective bargaining" },
      ],
    });

    await page.goto("/admin-content");

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
    await page.locator('[data-cert="basic"]').click();
    await page.locator("#convCreateBtn").click();

    await expect(page).toHaveURL(/\/admin-content\/courses$/);
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

  test("courses conversational flow goes directly from certification choice to module search", async ({ page }) => {
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1", title: "Trade unions" }],
    });

    await page.goto("/admin-content/courses/new");

    await page.locator("#convTitleInput").fill("Labour rights");
    await page.locator("#convTitleInput").press("Enter");
    await clickEnabledButton(page, "Basic");

    await expect(page.locator("#convComboboxInput")).toBeVisible();
    await expect(page.locator("#convCreateBtn")).toBeVisible();
    await expect(page.getByText("Du kan også opprette kurset direkte")).toBeVisible();
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
        },
      ],
    });

    await page.goto("/admin-content/courses");

    await expect(page.getByRole("table", { name: "Kursliste" })).toBeVisible();
    await page.locator('[data-action="delete"]').first().click();

    await expect(page.locator("#deleteDialog")).toHaveAttribute("open", "");
    await expect(page.locator("#deleteDialogText")).toContainText("Trade unions");
  });

  test("shell and courses routes pass an accessibility smoke check", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [],
    });

    await page.goto("/admin-content");
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
});
